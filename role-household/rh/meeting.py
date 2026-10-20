"""会议调度：用户发话题 -> 角色按顺序发言，每句先拿发言锁，“说完”再交棒。

- 同一时刻最多一个角色在说（SpeakingLock）。
- 用户发言立即打断在说的角色、释放锁、作废旧话题里还在生成的回复，开新一轮。
- 每个话题最多 max_turns_per_topic 轮角色发言，到了就停。
- 用户叫了某几个角色（only）：只有她们按顺序各回一句，别人不出声。
- 角色轮到时可以不说话（大脑只输出 PASS）：不发消息、不出声；除了最后说话的人，其余都不说话了就算话题结束。
- 有 TTS 且角色配了音色时，“在说”时长 = 真实播放时长（TTS.speak 阻塞到播完）；否则按字数估算。
"""
from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, asdict, replace
from pathlib import Path
from typing import Callable, Protocol

from .lock import SpeakingLock
from .brain import PASS, Cancelled
from .config import Role
from .voice import TTS


class Brain(Protocol):
    def reply(self, new_messages: str) -> str: ...
    def cancel(self) -> None: ...


@dataclass
class Message:
    id: int
    author: str          # 角色 id，用户是 "user"，系统提示是 "system"
    name: str
    text: str
    status: str          # speaking / done / interrupted / user / system
    start: float
    end: float | None = None
    spoken: int | None = None   # 被打断时估算已说出的字数


USER, SYSTEM = "user", "system"

# 用户单条消息最多多少字，超出截断。来源：橘定，防止一条超长消息撑爆每个角色的 prompt、反复耗额度。
MAX_TEXT_CHARS = 2000
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_PUNCT = re.compile(r"[\s\W_]+", re.UNICODE)


def is_pass(text: str) -> bool:
    """角色这一轮不说话：输出里有 PASS 标记（或只写了“跳过”），或者什么都没写。"""
    bare = _PUNCT.sub("", text)
    return PASS in text or bare in ("", "跳过")


def clean(text: str, limit: int = MAX_TEXT_CHARS) -> str:
    """去掉控制字符（保留换行、制表）并限制长度：坏消息不能进频道、不能卡住后面的话题。
    limit：cc-connect 的 bot 回复另有上限（rh/cloudweb.py MAX_BOT_CHARS）。"""
    # 落单代理字符（如 JSON 里的 "\ud800"）编码不了 UTF-8，会让日志、/api/state、stdin 全崩，替换成 "?"。
    text = text.encode("utf-8", "replace").decode("utf-8")
    return _CTRL.sub("", text).strip()[:limit]


def strip_own_prefix(text: str, name: str) -> str:
    """兜底：去掉开头的“本角色名字：”“名字发言：”“名字说：”，不然频道里显示、TTS 也会念出来。
    只认本角色自己的名字，别人的名字开头（如“橘说得对”）是正常的话，不动。"""
    m = re.match(rf"\s*{re.escape(name)}\s*(?:发言|说)?\s*[：:]\s*", text)
    return text[m.end():] if m and text[m.end():] else text


class Meeting:
    def __init__(self, roles: list[Role], brains: dict[str, Brain], max_turns: int,
                 chars_per_sec: float, log_path: Path | None = None,
                 sleep_scale: float = 1.0, on_error: Callable[[str], None] | None = None,
                 on_event: Callable[[str, Message], None] | None = None,
                 tts: "TTS | None" = None):
        self.roles = roles
        self.tts = tts  # 有它且角色有 voice 时用真实播放交棒
        self.brains = brains
        self.max_turns = max_turns
        self.chars_per_sec = chars_per_sec
        self.sleep_scale = sleep_scale  # 测试用，把“在说”时长缩短
        self.lock = SpeakingLock()
        self.messages: list[Message] = []
        self._mu = threading.RLock()
        self._say_mu = threading.Lock()  # 串行处理用户发言
        self._epoch = 0
        self._turn = 0
        self._seen: dict[str, int] = {r.id: 0 for r in roles}  # 每个角色已读到第几条
        self._unsaid: dict[str, str] = {}  # 生成了但没说出去的话，下次告诉这个角色
        self._thread: threading.Thread | None = None
        self._log_path = log_path
        self._log_mu = threading.Lock()
        if log_path:
            log_path.parent.mkdir(parents=True, exist_ok=True)
        self.on_error = on_error
        # 角色/系统消息出现或状态变化时回调 (事件, 消息副本)：start / end / system。
        # 在 self._mu 里调用，回调不能阻塞（rh.host 只把它丢进队列）。
        self.on_event = on_event
        # 谁在想（生成中）：角色 id，没人在想为 None。不能阻塞（rh.host 推给网页显示“思考中”）。
        self.on_think: Callable[[str | None], None] | None = None

    # ---------- 日志 ----------
    def _log(self, **ev) -> None:
        if not self._log_path:
            return
        with self._log_mu, open(self._log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")

    def _emit(self, event: str, msg: Message) -> None:
        if self.on_event:
            self.on_event(event, replace(msg))

    # ---------- 对外 ----------
    def user_say(self, text: str, only: list[str] | None = None) -> None:
        self.user_say_many([text], only)

    def user_say_many(self, texts: list[str], only: list[str] | None = None) -> None:
        """几条用户消息一起进频道，只开一轮讨论（角色主机断线重连后补话题用）。
        only：用户叫了名字的角色 id，只有她们回；None = 大家轮流。"""
        texts = [t for t in (clean(x) for x in texts) if t]
        if not texts:
            return
        with self._say_mu:
            self._user_say(texts, only)

    def _user_say(self, texts: list[str], only: list[str] | None = None) -> None:
        with self._mu:
            self._interrupt_locked()
            self._epoch += 1
            self._turn = 0
            now = time.time()
            for text in texts:
                self.messages.append(Message(len(self.messages), USER, "用户", text, USER, now, now))
                self._log(event="user", msg_id=len(self.messages) - 1, t=now, text=text)
            epoch = self._epoch
            old = self._thread
        # 作废旧话题：杀掉还在生成的 claude，等旧调度线程退出，避免两个线程同时用一个角色的会话。
        while old is not None and old.is_alive():
            for b in self.brains.values():
                b.cancel()
            old.join(0.05)
        t = threading.Thread(target=self._run_topic, args=(epoch, only), daemon=True)
        self._thread = t
        t.start()

    def stop(self) -> None:
        """停掉当前话题，不开新的（角色主机和云端断线时用）：正在说的改成被打断，正在生成的 claude 杀掉。"""
        with self._mu:
            self._interrupt_locked()
            self._epoch += 1
        for b in self.brains.values():
            b.cancel()
        if self.on_think:
            self.on_think(None)

    def speaking(self) -> Message | None:
        with self._mu:
            for m in reversed(self.messages):
                if m.status == "speaking":
                    return m
        return None

    def spoken_between(self, t0: float, t1: float) -> list[str]:
        """t0-t1（time.time()）这段时间里角色在说的话（含正在说的）：收音线程拿它判断麦克风收到的是不是角色的回声。"""
        with self._mu:
            return [m.text for m in self.messages if m.author not in (USER, SYSTEM)
                    and m.start <= t1 and (m.end is None or m.end >= t0)]

    def snapshot(self) -> dict:
        with self._mu:
            sp = self.speaking()
            return {
                "roles": [{"id": r.id, "name": r.name, "avatar": bool(r.avatar)} for r in self.roles],
                "messages": [asdict(m) for m in self.messages],
                "speaking": asdict(sp) if sp else None,
                "turn": self._turn,
                "max_turns": self.max_turns,
            }

    def wait_idle(self, timeout: float | None = None) -> None:
        t = self._thread
        if t:
            t.join(timeout)

    # ---------- 内部 ----------
    def _interrupt_locked(self) -> None:
        who = self.lock.interrupt()
        if who is None:
            return
        now = time.time()
        for m in reversed(self.messages):
            if m.status == "speaking":
                m.status, m.end = "interrupted", now
                # 按“在说”时长估算的语速反推说出去了几个字；第二阶段换成真实播放进度。
                said = int((now - m.start) / self.sleep_scale * self.chars_per_sec)
                m.spoken = max(0, min(len(m.text), said))
                self._log(event="end", msg_id=m.id, role=m.author, t=now, reason="interrupted")
                self._emit("end", m)
                break

    def _transcript_for(self, role_id: str) -> tuple[str, int]:
        """这个角色上次发言后的新消息；第二个值是读到的位置，生成成功后才记为已读。"""
        with self._mu:
            upto = len(self.messages)
            msgs = self.messages[self._seen[role_id]:upto]
            unsaid = self._unsaid.get(role_id)
        lines = []
        if unsaid:
            lines.append(f"（你上次想说「{unsaid}」，但用户先开口了，这句没说出去，大家都没听到。）")
        for m in msgs:
            if m.author == SYSTEM:
                continue
            if m.author == role_id:
                if m.status == "interrupted":
                    lines.append(f"（你上一句只说出了「{m.text[:m.spoken]}」就被用户打断了，后面的大家没听到。）")
                continue
            if m.status == "interrupted":
                lines.append(f"{m.name}说「{m.text[:m.spoken]}……」（话没说完就被用户打断了）")
            else:
                # 写成“谁说「…」”而不是“谁：…”：后者是剧本行格式，模型会照着在自己的话前面加“名字：”。
                lines.append(f"{m.name}说「{m.text}」")
        return "[频道新消息]\n" + ("\n".join(lines) if lines else "（没有新消息）"), upto

    def _think(self, epoch: int, role_id: str | None) -> None:
        with self._mu:
            if epoch != self._epoch:
                return
        if self.on_think:
            self.on_think(role_id)

    def _run_topic(self, epoch: int, only: list[str] | None = None) -> None:
        try:
            self._run_turns(epoch, only)
        finally:
            self._think(epoch, None)

    def _run_turns(self, epoch: int, only: list[str] | None) -> None:
        roles = self.roles if only is None else [r for r in self.roles if r.id in only] or self.roles
        n = len(roles)
        # 叫了名字：她们各回一句就完；没叫（产品名、网页打字）：轮流到上限。
        turns = self.max_turns if only is None else n
        passes, spoke = 0, False
        for turn in range(turns):
            role = roles[turn % n]
            with self._mu:
                if epoch != self._epoch:
                    return
            self._think(epoch, role.id)
            transcript, upto = self._transcript_for(role.id)
            try:
                text = strip_own_prefix(clean(self.brains[role.id].reply(transcript)), role.name)
            except Cancelled:
                return
            except Exception as e:  # 生成失败：停掉这个话题，告诉用户
                self._system(epoch, f"{role.name} 出错，本话题停止：{e}")
                if self.on_error:
                    self.on_error(str(e))
                return
            with self._mu:
                self._seen[role.id] = upto
                self._unsaid.pop(role.id, None)
                if epoch == self._epoch and is_pass(text):
                    self._log(event="pass", role=role.id, t=time.time(), text=text)
            if is_pass(text):
                passes += 1
                # 最后说话的那个人之后没有新消息，不用再问她；还没人说过就要全员都不说。
                if passes >= n - (1 if spoke else 0):
                    with self._mu:
                        if epoch == self._epoch:
                            self._log(event="topic_end", t=time.time(), reason="all_pass")
                    return
                continue
            passes, spoke = 0, True
            self._think(epoch, None)
            got = self._acquire(epoch, role, text, turn + 1)
            if got is None:
                # 话题已换：这句已进了角色的 claude 会话，但没说出去，下次告诉它。
                with self._mu:
                    self._unsaid[role.id] = text
                return
            msg, token, cancel = got
            if not self._play(role, text, cancel):
                return  # 被用户打断；状态已由 user_say 更新
            with self._mu:
                if self.lock.release(role.id, token):
                    now = time.time()
                    msg.status, msg.end = "done", now
                    self._log(event="end", msg_id=msg.id, role=role.id, t=now, reason="done",
                              secs=round(now - msg.start, 2))
                    self._emit("end", msg)
                else:
                    return
        if only is None:
            self._system(epoch, f"本话题已到上限 {self.max_turns} 轮，讨论停止。发新消息开始下一轮。")

    def _play(self, role: Role, text: str, cancel: threading.Event) -> bool:
        """持锁期间“说”这句：True 说完，False 被打断。"""
        if self.tts is not None and role.voice:
            try:
                return self.tts.speak(text, role.voice, cancel, role=role.id)
            except Exception as e:
                # 播放坏了不停讨论，日志里留一笔，直接交棒：不再按字数把锁多占一遍
                # （say 可能已念了一半才出错，再等一整段估算时长就白占了）。
                self._log(event="tts_error", role=role.id, t=time.time(), error=repr(e))
                return True
        duration = max(len(text), 1) / self.chars_per_sec * self.sleep_scale
        return not cancel.wait(duration)

    def _acquire(self, epoch: int, role: Role, text: str, turn: int):
        """先到先得拿锁；拿不到就稍等再试（不排队）。话题已换则放弃。"""
        while True:
            with self._mu:
                if epoch != self._epoch:
                    return None
                got = self.lock.try_acquire(role.id)
                if got is not None:
                    token, cancel = got
                    now = time.time()
                    msg = Message(len(self.messages), role.id, role.name, text, "speaking", now)
                    self.messages.append(msg)
                    self._turn = turn
                    self._log(event="start", msg_id=msg.id, role=role.id, t=now, text=text,
                              voice=role.voice if self.tts is not None else "")
                    self._emit("start", msg)
                    return msg, token, cancel
            time.sleep(0.02)

    def _system(self, epoch: int, text: str) -> None:
        with self._mu:
            if epoch != self._epoch:
                return
            now = time.time()
            msg = Message(len(self.messages), SYSTEM, "系统", text, SYSTEM, now, now)
            self.messages.append(msg)
            self._log(event="system", t=now, text=text)
            self._emit("system", msg)
