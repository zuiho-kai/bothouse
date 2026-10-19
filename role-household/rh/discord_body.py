"""形态 B：板子当现有平台（我们的 Discord）里 bot 的躯体。

用户 2026-10-19：「我预期有两种形态……一种就是进入现有的平台，别人现有的一个team下面，例如我们的discord」。
Discord 里的 bot 回应了板子主人，gate（~/im-bridge/gate/rhbody.py）把这句的正文 POST 到这里；主机按 roles.toml
[[discord.bots]] 的「bot ID → 角色」找到音色和板子，在那个角色的板子上念出来。

    gate ──POST /rh/discord/say {bot_id, text, truncated}──▶ DiscordBody.submit
         ──▶ 排队（一次念一句） ──▶ 拿会议的发言锁（和小家里的讨论不叠音）──▶ DeviceSpeaker（只推板子）──▶ 板子

只念回应板子主人的话：判定在 gate 那边（被主人 @、开头点名、或主人回复她的消息之后，她的下一条回复），
bot 之间互相说话、做别的任务的发言不转过来（审稿 ~/.claude/reviews/rh-two-forms.md 第 1 条，
用户「你可能指定跟他们说他们才会应你，否则就当不存在」）。

和小家同一套不出声规则（审稿第 2 条）：
- 真板播放开关 [discord] play 默认关：关着只记日志、不出声（用户不在、睡觉时不许出声；开关由用户在场时打开）。
- 只推板子：板子不在线就不念，不退回 Mac 喇叭、不推网页。
- 安全词「暂停」、闭麦：Host 调 stop()，正在念的停下、排队的作废；会议发言锁被打断（用户插话）也停下。
- 念的话记下来给收音线程比对回声（同 meeting.spoken_between）。
"""
from __future__ import annotations

import queue
import re
import threading
import time
from typing import Callable

from aiohttp import web

from .config import DiscordBot, Role
from .device import RECEIPT_GRACE, DeviceSpeaker
from .lock import SpeakingLock
from .meeting import Message

SAY_PATH = "/rh/discord/say"
# 等发言锁时多久再试一次。来源：沿用 rh/meeting.py _acquire 的 0.02 秒重试间隔。
POLL_SEC = 0.02
# 念过的话留多久给回声比对（秒）。来源：实现者定，远大于 rh/voice.py 一句最长 MAX_UTTER_MS（30 秒）。
SPOKEN_KEEP_SEC = 120.0
LOOPBACK = ("127.0.0.1", "::1")

_CODE = re.compile(r"```.*?(?:```|$)", re.S)
_MENTION = re.compile(r"<[@#][!&]?\d+>")
_URL = re.compile(r"https?://\S+")
_MARK = re.compile(r"[`*#|>~]+|-{3,}")   # Markdown 记号、表格分隔线
_SPACE = re.compile(r"[ \t]+")
_FIRST_END = re.compile(r"[。！？!?；;…\n]")


def speakable(text: str, truncated: bool = False) -> str:
    """Discord 正文改成能念的：去掉代码块、@提及、链接、Markdown 记号（念出来是噪音）。
    truncated：gate 只拿得到回复的结尾一段（cc-connect last_reply 截后 600 字），开头半句不念，从第一个句末之后开始。"""
    t = _URL.sub("", _MENTION.sub("", _CODE.sub("", text)))
    t = _MARK.sub(" ", t)
    t = "\n".join(_SPACE.sub(" ", line).strip() for line in t.splitlines())
    t = re.sub(r"\n{2,}", "\n", t).strip()
    if truncated:
        m = _FIRST_END.search(t)
        if m and t[m.end():].strip():
            t = t[m.end():].strip()
    return t


class BoardLink:
    """DeviceSpeaker 的线路：只认小智板子（不走 hub 的网页设备）。"""

    def __init__(self, boards):
        self.boards = boards

    def device_online(self, role: str) -> bool:
        return self.boards.online(role)

    def send_device(self, frames: list[dict]) -> bool:
        return self.boards.send(frames)


class DiscordBody:
    def __init__(self, bots: list[DiscordBot], roles: list[Role], boards, synth, lock: SpeakingLock, play: bool = False,
                 log: Callable[[str], None] = lambda s: print(s, flush=True),
                 on_event: Callable[[str, Message], None] | None = None, grace: float = RECEIPT_GRACE):
        self.bots = {b.bot_id: b for b in bots}
        self.roles = {r.id: r for r in roles}
        self.boards, self.lock, self.play, self.log, self.on_event = boards, lock, play, log, on_event
        # 不给本机设备：板子不在就不念（不退回 Mac 喇叭）
        self.speaker = DeviceSpeaker(synth, None, log=log, grace=grace)
        self.speaker.link = BoardLink(boards)
        self._q: queue.Queue = queue.Queue()
        self._gen = 0   # stop() 加 1：排队的、正在等锁的都作废
        self._mu = threading.Lock()
        self._spoken: list[list] = []   # [开始, 结束（还在念为 None）, 文字]
        self._closed = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    # ---------- 入口 ----------
    def route(self) -> tuple[str, str, Callable]:
        return ("POST", SAY_PATH, self._http)

    async def _http(self, req: web.Request) -> web.Response:
        if req.remote not in LOOPBACK:   # 板子服务听 0.0.0.0：只收本机 gate 发来的
            raise web.HTTPForbidden()
        try:
            d = await req.json()
        except ValueError:
            raise web.HTTPBadRequest()
        if not isinstance(d, dict):
            raise web.HTTPBadRequest()
        return web.json_response({"result": self.submit(str(d.get("bot_id", "")), str(d.get("text", "")),
                                                        d.get("truncated") is True)})

    def submit(self, bot_id: str, text: str, truncated: bool = False) -> str:
        """一句 bot 回应板子主人的话。返回 unmapped / empty / off / no_board / queued（日志里同样写一行）。"""
        bot = self.bots.get(bot_id)
        if bot is None:
            self.log(f"[discord] bot {bot_id} 没在 roles.toml [[discord.bots]] 里，不念（{len(text)} 字）")
            return "unmapped"
        role = self.roles[bot.role]
        say = speakable(text, truncated)
        if not say:
            self.log(f"[discord] {bot.name} 的回应去掉代码和链接后没有能念的字，不念")
            return "empty"
        head = say[:40].replace("\n", " ")
        if not self.play:
            self.log(f"[discord] 收到 {bot.name}（{role.name}）的回应 {len(say)} 字，真板播放开关关着，只记日志：{head}")
            return "off"
        if not self.boards.online(role.id):
            self.log(f"[discord] 收到 {bot.name}（{role.name}）的回应，但 {role.name} 的板子不在线，不念（这条路不用 Mac 喇叭）")
            return "no_board"
        with self._mu:
            self._q.put((self._gen, bot, role, say))
        self.log(f"[discord] {bot.name}（{role.name}）的回应 {len(say)} 字排队，在 {role.name} 的板子上念：{head}")
        return "queued"

    def stop(self) -> None:
        """安全词、闭麦（Host 调）：排队的作废、正在等锁的放弃；正在念的由会议发言锁被打断时停下（meeting.stop）。"""
        with self._mu:
            self._gen += 1
            n = 0
            while True:
                try:
                    self._q.get_nowait()
                    n += 1
                except queue.Empty:
                    break
        if n:
            self.log(f"[discord] 停下，排队的 {n} 句作废")

    def close(self) -> None:
        self._closed.set()
        self.stop()
        self._q.put(None)

    def spoken_between(self, t0: float, t1: float) -> list[str]:
        """t0-t1（time.time()）这段时间里板子在念的 Discord 回应：收音线程拿它判断回声（同 meeting.spoken_between）。"""
        with self._mu:
            return [s for a, b, s in self._spoken if a <= t1 and (b is None or b >= t0)]

    # ---------- 念 ----------
    def _run(self) -> None:
        while (item := self._q.get()) is not None:
            gen, bot, role, text = item
            try:
                self._speak(gen, bot, role, text)
            except Exception as e:   # 合成或推送出错：这句跳过，下一句照常
                self.log(f"[discord] {bot.name} 的回应没念成：{e!r}")

    def _speak(self, gen: int, bot: DiscordBot, role: Role, text: str) -> None:
        who = f"discord:{role.id}"
        while True:   # 和小家的讨论共用一把发言锁：她们在说就等，不叠音
            if self._closed.is_set() or gen != self._gen:
                return
            got = self.lock.try_acquire(who)
            if got is not None:
                break
            time.sleep(POLL_SEC)
        token, cancel = got
        start = time.time()
        msg = Message(-1, role.id, role.name, text, "speaking", start)
        with self._mu:
            if gen != self._gen:   # 拿锁的这一刻正好被停
                self.lock.release(who, token)
                return
            now = time.time()
            self._spoken = [x for x in self._spoken if x[1] is None or now - x[1] <= SPOKEN_KEEP_SEC]
            entry = [start, None, text]
            self._spoken.append(entry)
        self._emit("start", msg)
        done = False
        try:
            done = self.speaker.speak(text, role.voice, cancel, role=role.id)
        finally:
            self.lock.release(who, token)
            end = time.time()
            with self._mu:
                entry[1] = end
            msg.status, msg.end = ("done" if done else "interrupted"), end
            self._emit("end", msg)
            self.log(f"[discord] {bot.name}（{role.name}）的回应{'念完' if done else '被打断'}（{end - start:.1f} 秒）")

    def _emit(self, event: str, msg: Message) -> None:
        if self.on_event is not None:
            try:
                self.on_event(event, msg)
            except Exception as e:
                self.log(f"[discord] 表盘状态没推成：{e!r}")
