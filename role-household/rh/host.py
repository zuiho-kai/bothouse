"""本地角色主机：meeting / brain / lock 留在本机，作为 bot 客户端连云端频道（rh.hub）。

AI 是 `claude -p`，用用户自己的订阅，不能放云端；云端只做频道和网页。

- 收到用户消息就开讨论；角色发言（含“在说”状态和说完/被打断）发回云端，网页的虚拟头照旧亮。
- 断线自动重连；重连后补上断线期间的新话题（记住已读到的云端消息 id，存在 data/host-state-<云端地址>.json）。
- 断线就停讲：本机正在进行的讨论停掉，还没发上去的发言丢掉（云端那边已把“在说”改成被打断）。
  网页是云端的投影，云端看不到的讨论不该在本机继续，否则重连后旧发言排在新话题后面。

    uv run python -m rh.host [--hub http://...] [--config roles.toml] [--no-voice] [--feed-audio FILE]

语音默认开：麦克风（系统默认输入设备）常开收音，按停顿切句、转文字；叫了角色名或产品名的才作为用户消息发到云端频道
（叫了谁只有她回），「暂停」立刻停下，「闭麦」停下并不再收音、只认「开麦」「暂停」「闭麦」（rh/wake.py，roles.toml [wake]）；
角色发言用 roles.toml 里的 voice 合成：该角色有设备在线（网页点了“开声音”）就经 hub 推给设备播放，设备回执才交棒；
没有设备在线就用本机 Mac 喇叭播放，播完才交棒（rh/device.py）。--no-voice 关掉收音和播放（纯文字）。
--feed-audio 先把一段音频文件当麦克风输入喂一次（端到端自测用），再照常收麦克风。

云端地址和 token 从环境变量 RH_HUB_URL / RH_HUB_TOKEN 读，没有就读仓库根目录的 .env（不进 git）。

多频道（rh/hub.py 模块说明「多频道」）：一个频道一个会话。主机订全部频道，每个频道一份 Meeting（自己的对话记录）
和一套角色大脑（自己的 claude 会话，目录 data/sessions/<session_key(频道 id)>/<角色>），切频道不串上下文。
默认频道用传进来的 meeting（语音收音、播放、板子表盘都在它上面）；别的频道纯文字，第一次有消息时用 room_meeting 建。
线上（main）不给 room_meeting：主机只管默认频道，别的频道由 cc-connect 接进来的 bot 回（见 main 里的注释）。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import signal
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

import aiohttp

from . import config as cfgmod
from .brain import ClaudeBrain
from .meeting import Meeting, Message
from .hub import WS_REPLACED, session_key
from . import voice as voicemod
from . import vpio as vpiomod
from .device import DeviceSpeaker
from . import wake as wakemod
from . import kws as kwsmod
from . import xiaozhi as xiaozhimod
from . import dial as dialmod
from . import discord_body as discordmod
from . import board_mic as board_micmod

ROOT = Path(__file__).resolve().parent.parent

RECONNECT_MIN = 1.0  # 重连/重试首次等待秒数，之后每次翻倍。来源：实现者定。
RECONNECT_MAX = 30.0  # 重连/重试最长等待秒数。来源：实现者定。
HEARTBEAT = 30.0  # WebSocket 心跳秒数，发现断掉的连接。来源：实现者定，和 rh/hub.py 的 HEARTBEAT 一致。
HTTP_TIMEOUT = 15.0  # 单次 HTTP 请求超时秒数。来源：实现者定。
# 叫了名字的一句之后，这么多秒内接着说的（没叫名字）也算对同一个人说：一句话中间停顿超过
# rh/voice.py END_SILENCE_MS（0.7 秒）就被切成两段。来源：2026-10-19 真机验收，「小家，我看已经有声音了，你们再跑还是怎么样」
# 合成音频里句中停顿最长 0.69 秒，隔空收音后被切成两段，后半段「你们在跑还是怎么样」因没叫名字被丢；取约两倍。
FOLLOW_SEC = 1.5
# 语音「大声点」「小声点」一次调多少（板子音量 0-100）。来源：固件板子上音量键一次 ±10
# （~/code/role-household-fw/xiaozhi-esp32 main/boards/doit-s3-aibox/doit_s3_aibox.cc 第 74、89 行等）。
VOLUME_STEP = 10
# 板子麦克风和 Mac 麦克风都听见同一句：另一路这么多秒内听到的同一句（或同一个口令）算重复，只按先到的那路处理。
# 来源：实现者定，同 FOLLOW_SEC（一句话被停顿切开的间隔）一个量级；两路切句的结束时刻差在一两帧到几百毫秒。
DUP_SEC = 1.5
# 两路收音的去重记录保留多久（秒）：按墙钟清理，不按和当前句的时间差（一路转写慢了，另一路后面的句子会把它那条清掉，
# 慢的那路转完就查不到、发第二遍；代码审查 ~/.claude/reviews/rh-board-mic-code.md 必须修 3）。
# 一条要活到慢的那路把同一句转完：单次转写最多 rh/voice.py ASR_TIMEOUT，再加 DUP_SEC。来源：实现者定。
HEARD_KEEP_SEC = voicemod.ASR_TIMEOUT + DUP_SEC


def build_tts(cfg: cfgmod.Config, log=lambda s: print(s, flush=True), vpio=None) -> DeviceSpeaker:
    """roles.toml [voice] backend：say = macOS say；qwen = 本机 Qwen3-TTS 常驻进程，单句出错改用 say。
    vpio（[voice] player = "vpio" 时给，rh/vpio.py）：本机喇叭改走系统语音处理播，收音那边就能减掉回声；
    不给就是旧方式（say 直接念 / afplay）。"""
    if cfg.voice_backend != "qwen":
        if vpio is not None:
            say = voicemod.SaySynth()
            return DeviceSpeaker(say, vpiomod.VPIOPlayTTS(say, vpio, voicemod.PlayTTS(say), log))
        return DeviceSpeaker(voicemod.SaySynth(), voicemod.SayTTS())
    worker = Path(__file__).with_name("qwen_worker.py")
    qwen = voicemod.QwenSynth([cfg.qwen_python, "-I", str(worker), cfg.qwen_model],
                              {r.voice: (r.qwen_speaker, r.qwen_instruct) for r in cfg.roles if r.voice and r.qwen_speaker},
                              log)
    try:
        qwen.start()
    except Exception as e:   # 起不来不拦主机：每句会再试一次，不行就用 say
        log(f"[voice] Qwen3-TTS 启动失败，先用 say：{e!r}")
    synth = voicemod.FallbackSynth(qwen, voicemod.SaySynth(), log)
    local = voicemod.PlayTTS(synth)
    if vpio is not None:
        local = vpiomod.VPIOPlayTTS(synth, vpio, local, log)
    return DeviceSpeaker(synth, local)


def brief_error(e: BaseException) -> str:
    """异常写进日志用的短说明：类型 + 状态码/原因。不用 repr(e)：aiohttp 的 ClientResponseError
    （含握手失败 WSServerHandshakeError、ContentTypeError）repr 里带请求头，会把 Authorization: Bearer <token> 打进日志。"""
    if isinstance(e, aiohttp.ClientResponseError):
        return f"{type(e).__name__} HTTP {e.status} {e.message}"[:300]
    return f"{type(e).__name__}: {e}"[:300]


def room_session_dir(root: Path, room_id: int, role_id: str) -> Path:
    """一个频道里一个角色的会话目录：会话键只由频道 id 定（rh/hub.py session_key）。"""
    return root / "data" / "sessions" / session_key(room_id) / role_id


def build(cfg: cfgmod.Config, log_path: Path, tts=None, room_id: int | None = None) -> Meeting:
    """room_id=None：默认频道（旧的会话目录 data/sessions/<角色>）；否则那个频道自己的会话目录。"""
    brains = {}
    for r in cfg.roles:
        others = [o.name for o in cfg.roles if o.id != r.id]
        workdir = ROOT / "data" / "sessions" / r.id if room_id is None else room_session_dir(ROOT, room_id, r.id)
        brains[r.id] = ClaudeBrain(r, others, cfg.model, cfg.timeout_sec, workdir)
    return Meeting(cfg.roles, brains, cfg.max_turns_per_topic, cfg.chars_per_sec, log_path=log_path,
                   tts=tts)


def state_path_for(hub_url: str) -> Path:
    """已读位置按云端地址分文件：本机 hub 和云端 hub 的消息 id 各算各的，混用一个文件会补错话题。"""
    netloc = urlsplit(hub_url).netloc or "hub"
    return ROOT / "data" / f"host-state-{re.sub(r'[^0-9A-Za-z.-]', '_', netloc)}.json"


def read_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


class Host:
    def __init__(self, meeting: Meeting, hub_url: str, token: str, state_path: Path,
                 reconnect_min: float = RECONNECT_MIN, reconnect_max: float = RECONNECT_MAX,
                 config_dir: Path = ROOT, speaker: DeviceSpeaker | None = None,
                 words: wakemod.Words | None = None, log=lambda s: print(s, flush=True),
                 boards: xiaozhimod.XiaozhiServer | None = None,
                 room_meeting: Callable[[int], Meeting] | None = None):
        self.meeting = meeting   # 默认频道的（语音在这里）
        # 别的频道：频道 id -> 建一份新 Meeting（纯文字）。None = 只管默认频道（旧用法），别的频道不订。
        self.room_meeting = room_meeting
        self.meetings: dict[int, Meeting] = {}   # 频道 id -> 它的会话；默认频道在 ready 后登记为 self.meeting
        self._execs: dict[int, ThreadPoolExecutor] = {}   # 每个频道一条，频道之间不互相等
        self._archived: set[int] = set()   # 云端说已归档的频道：不建会话、不补漏（补了会真的调 claude 花钱）
        self._room_stamps: dict[int, float] = {}   # 频道 id -> 建频道时刻：对不上说明云端库换过
        # 语音口令；None = 不要唤醒词，听到的都进频道（旧行为，测试用）。
        self.words = words
        self.log = log
        self.mic_on = True   # 云端的闭麦开关（ready 帧、mic 推送）；False 时语音只认「开麦」「暂停」「闭麦」
        self._voice_targets: dict[str, list[str] | None] = {}   # 语音消息的 client_key -> 叫了谁（None = 轮流）
        self._woken: tuple[float, list[str] | None] | None = None   # 上一句叫了名字的语音：(结束时刻, 叫了谁)
        # 语音口令两路进来：唤醒模型在读麦线程（on_kws），转文字在转写线程（on_voice），改 mic_on 等要排队。
        self._wake_mu = threading.RLock()
        self.speaker = speaker   # 推给设备、收回执；None = 不推设备
        if speaker is not None:
            speaker.link = self
        self.device_roles: set[str] = set()   # hub 说有设备在线的角色
        # 小智板子（rh/xiaozhi.py）：角色绑定的板子连着就先推给板子，否则走 hub 的网页设备，都没有就 Mac 喇叭。
        self.boards = boards
        self.dial = None   # 板子上的表盘（rh/dial.py）：谁在想、谁在说也推给板子；main() 里有板子服务时接上
        self._routes: dict[str, str] = {}   # play_id -> "board" / "hub"：开始说时定下，同一播放后面的帧都走同一路
        # 形态 B（rh/discord_body.py）：Discord 里 bot 回应主人的话在板子上念；main() 里配了 [[discord.bots]] 才接上。
        # 暂停、闭麦时一起停（_act、_set_mic）。
        self.discord = None
        if boards is not None and speaker is not None:
            boards.on_receipt = self._board_receipt
            boards.on_change = self._boards_changed
        if boards is not None:
            boards.on_volume = self._report_volumes
        self._last_speaker: str | None = None   # 正在说或最近说完的角色（语音调音量没叫名字时调她的板子）
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._ws_lock: asyncio.Lock | None = None
        self._stopped: set[str] = set()   # 已发 stop 的 play_id：排在锁后面还没发出的同一播放的帧作废
        self.config_dir = config_dir   # roles.toml 所在目录，头像路径相对它
        self.hub = hub_url.rstrip("/")
        self.token = token
        self.state_path = state_path
        self.reconnect_min, self.reconnect_max = reconnect_min, reconnect_max
        self.cursor: int | None = self._load_cursor()   # 已读到的云端消息 id；None = 第一次启动
        self.room: int | None = None
        self.connected = asyncio.Event()
        self._exec = ThreadPoolExecutor(max_workers=1)  # 用户消息按顺序交给 meeting（user_say 会阻塞）
        self._queue: asyncio.Queue | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._hub_ids: dict[tuple[int | None, int], int] = {}   # (频道 id, 本地 meeting 消息序号) -> 云端消息 id
        # 本进程的 id：和 meeting 消息序号拼成 client_key，重试同一条时云端去重（序号每次启动从 0 开始，所以要带进程 id）。
        self._boot = uuid.uuid4().hex
        self._stop = asyncio.Event()
        self.ready_timeout = HTTP_TIMEOUT   # 等 ready 帧的秒数，同单次 HTTP 请求超时
        self._idle = asyncio.Event()   # 没有请求在路上时为 set；退出前等它，让路上的请求回来补发“被打断”
        self._idle.set()
        self._gen = 0   # 连接代数：每次断线加 1，上一代没发出去的发言作废
        self._http: aiohttp.ClientSession | None = None
        self._said = 0   # 语音转出的用户消息序号，拼进 client_key
        # 最近几路收音处理过的 (哪一路, 时刻, 标准写法的文字, 口令动作或 None)，两路去重用（voice_from）
        self._heard: list[tuple[str, float, str, str | None]] = []
        self._spotted: list[tuple[str, float, str]] = []   # 最近几路唤醒模型听到的 (哪一路, 时刻, 词)

    # ---------- 多路收音（Mac 麦克风 + 板子麦克风，rh/board_mic.py） ----------
    def voice_from(self, source: str):
        """给一路收音用的 (on_voice, on_kws)：和 on_voice / on_kws 一样，只是另一路 DUP_SEC 内已处理过的同一句、
        同一个口令不再处理第二遍（用户说一句，Mac 和板子都听见）。
        同一句：先按 Words.correct 换成标准写法再比（两路 ASR 常转成不同的同音字：「鲸鱼娘在吗」「金玉良在吗」）；
        口令（暂停、闭麦、开麦）按动作比，不看文字（「暂停」和「暂停一下」）；唤醒模型当场执行的也记进去。"""
        def remember(t: float, text: str, action: str | None) -> None:
            now = time.time()
            self._heard = [x for x in self._heard if now - x[1] <= HEARD_KEEP_SEC] + [(source, t, text, action)]

        def dup_of(t: float, text: str, action: str | None) -> str | None:
            for src, t2, other, act in self._heard:
                if src == source or abs(t - t2) > DUP_SEC:
                    continue
                if action is not None and action == act:
                    return "口令"
                if text and other and (text == other or voicemod.echo_score(text, other) >= voicemod.ECHO_MATCH):
                    return "这句"
            return None

        def on_kws(hit) -> None:
            with self._wake_mu:
                now = getattr(hit, "t", time.time())
                self._spotted = [x for x in self._spotted if now - x[1] <= DUP_SEC]
                if any(src != source and lab == hit.label for src, _, lab in self._spotted):
                    if hit.action in (wakemod.PAUSE, wakemod.MUTE, wakemod.UNMUTE):
                        hit.done = hit.action   # 另一路已当场执行过：这句转完文字后也不再执行
                    return self.log(f"[wake] {source} 的唤醒模型也听到「{hit.label}」，另一路已处理，不重复")
                self._spotted.append((source, now, hit.label))
                self.on_kws(hit)
                if hit.done:   # 当场执行了暂停/闭麦/开麦：另一路转文字认出同一个口令时不再执行
                    remember(now, "", hit.done)

        def on_voice(text: str, t0: float | None = None, t1: float | None = None, kws=None, muted: bool = False) -> None:
            with self._wake_mu:
                end = time.time() if t1 is None else t1
                norm, action = text, None
                if self.words is not None:
                    norm = self.words.correct(text)
                    act = self.words.classify(norm, muted=muted or not self.mic_on).action
                    action = act if act in (wakemod.PAUSE, wakemod.MUTE, wakemod.UNMUTE) else None
                why = dup_of(end, norm, action)
                if why:
                    return self.log(f"[voice] {source} 也听到{why}，另一路已处理，不重复（{len(text)} 字）")
                remember(end, norm, action)
                self.on_voice(text, t0, t1, kws=kws, muted=muted)
        return on_voice, on_kws

    def _board_receipt(self, pid: str, result: str, started: bool | None = None) -> None:
        """板子的回执：会议的播放和 Discord 的播放各有一个 DeviceSpeaker，各自只认自己的 play_id。"""
        self.speaker.on_receipt(pid, result, started, board=True)
        if self.discord is not None:
            self.discord.speaker.on_receipt(pid, result, started, board=True)

    def _boards_changed(self) -> None:
        self.speaker.devices_changed()
        if self.discord is not None:
            self.discord.speaker.devices_changed()

    def spoken_between(self, t0: float, t1: float) -> list[str]:
        """这段时间里角色在念的话（小家讨论 + Discord 回应）：收音线程拿它判断回声。"""
        out = self.meeting.spoken_between(t0, t1)
        if self.discord is not None:
            out += self.discord.spoken_between(t0, t1)
        return out

    # ---------- 语音输入 -> 云端 ----------
    def on_kws(self, hit) -> None:
        """读麦线程里调用：本地唤醒模型（rh/kws.py）听到一个词。暂停、闭麦当场执行（不等转文字，停住正在说的，
        和转文字认出口令走同一条路）；闭麦中只认开麦、暂停、闭麦（闭麦时 Discord 回应照样会念，暂停、闭麦要能停下它，
        用户 2026-10-19「我暂停闭麦他都没有反应」）。名字不在这里处理，等这句转完文字和 on_voice 一起定谁回答。"""
        if self.words is None:
            return
        with self._wake_mu:
            if not self.mic_on:
                if hit.action in (wakemod.UNMUTE, wakemod.PAUSE, wakemod.MUTE):
                    hit.done = hit.action
                    self._act(wakemod.Heard(hit.action), hit.label, "kws")
                else:
                    self.log(f"[wake] 闭麦中，唤醒模型听到「{hit.label}」不理")
            elif hit.action in (wakemod.PAUSE, wakemod.MUTE):
                hit.done = hit.action
                self._act(wakemod.Heard(hit.action), hit.label, "kws")

    def on_voice(self, text: str, t0: float | None = None, t1: float | None = None, kws=None,
                 muted: bool = False) -> None:
        """收音线程里调用：按口令处理一句转写。没叫名字的不进频道、不打断
        （紧接在叫了名字的一句后面、FOLLOW_SEC 内开始的除外：那是同一句话被停顿切开的后半句）。
        kws：本地唤醒模型在这句里听到的词（rh/kws.py Hit）。和转文字并联，任一认出即生效：
        转文字漏了名字、唤醒模型听到了，就由它听到的名字决定谁回答（只让被叫到的回答，不是大家一起回）。
        muted：这句是闭麦中切出的（rh/voice.py Listener._stamp）。这时就算已经开麦了，也只拿它认开麦、暂停、闭麦。"""
        if self.words is None:
            if not muted:
                self.say_as_user(text)
            return
        with self._wake_mu:
            self._on_voice(text, t0, t1, list(kws or []), muted)

    def _on_voice(self, text: str, t0: float | None, t1: float | None, hits: list, muted: bool = False) -> None:
        muted = muted or not self.mic_on
        h = self.words.classify(text, muted=muted)
        # 按拼音认出的名字、口令换成标准写法再进频道和日志（「金玉良在吗」→「鲸鱼娘在吗」，见 Words.correct）；
        # 原始转写另记一行方便排查。闭麦中别的话不记原文（私话），只在这句是「开麦」时记。
        raw, text = text, self.words.correct(text)
        if text != raw and (not muted or h.action == wakemod.UNMUTE):
            self.log(f"[wake] 转写原文：{raw} → {text}")
        done = {x.done for x in hits if x.done}
        if done:
            # 唤醒模型已在 on_kws 里当场执行了暂停/闭麦/开麦：这句不再执行第二遍，只记转文字那边有没有也认出。
            both = h.action in done
            self.log(f"[wake] 这句的「{'、'.join(x.label for x in hits if x.done)}」已由唤醒模型执行，"
                     f"转文字{'也认出' if both else '没认出'}（认出：{'都有' if both else 'kws'}）：{text}")
            return
        kinds = {x.action for x in hits}
        if h.action in (wakemod.PAUSE, wakemod.MUTE, wakemod.UNMUTE):
            return self._act(h, text, "都有" if h.action in kinds else "asr")
        if h.action in (wakemod.LOUDER, wakemod.QUIETER):
            # 调音量：唤醒模型听到的名字也算叫到（转文字漏了名字时）
            kws_names = [x.role for x in hits if x.action == wakemod.SAY and x.role]
            named = [rid for rid, _ in self.words.roles if rid in (h.targets or []) or rid in kws_names]
            return self._act(wakemod.Heard(h.action, named or None), text, "asr")
        if muted:
            # 闭麦中（口令上面已处理）：别的话丢掉，日志不记原文（私话）
            return self.log(f"[wake] 闭麦中，这句不进频道（{len(text)} 字，原文不记）")
        asr_names = h.targets if h.action == wakemod.SAY and h.targets else []
        asr_any = h.action == wakemod.SAY
        kws_names = [x.role for x in hits if x.action == wakemod.SAY and x.role]
        kws_any = any(x.action == wakemod.SAY for x in hits)
        source = "都有" if asr_any and kws_any else ("kws" if kws_any else "asr")
        named = [rid for rid, _ in self.words.roles if rid in asr_names or rid in kws_names]
        if named:
            h = wakemod.Heard(wakemod.SAY, named)
        elif kws_any:
            h = wakemod.Heard(wakemod.SAY, None)   # 唤醒模型只听到产品名：按轮流
        if not voicemod.worth_sending(text) and kws_any:
            # 转文字没转出字（或只是回声），唤醒模型听到了名字：拿听到的词当这句话发，被叫到的人照样回。
            text = "、".join(dict.fromkeys(x.label for x in hits if x.action == wakemod.SAY))
        follow = False
        if (h.action == wakemod.IGNORE and self._woken is not None and t0 is not None
                and t0 - self._woken[0] <= FOLLOW_SEC):
            h, follow, source = wakemod.Heard(wakemod.SAY, self._woken[1]), True, "接上一句"
        self._woken = (t1, h.targets) if h.action == wakemod.SAY and t1 is not None else None
        detail = (f"转文字={'、'.join(asr_names) or ('产品名' if asr_any else '无')} "
                  f"唤醒模型={'、'.join(x.label for x in hits) or '无'}")
        self._act(h, text, source, follow, detail)

    def _act(self, h: wakemod.Heard, text: str, source: str, follow: bool = False, detail: str = "") -> None:
        """执行一个口令。source：哪一边认出的（kws / asr / 都有），记进日志给真人调参用（README「本地唤醒模型」）。"""
        by = f"（认出：{source}{'；' + detail if detail else ''}）"
        if h.action == wakemod.IGNORE:
            self.log(f"[wake] {h.why}，不进频道{by}：{text}")
        elif h.action == wakemod.PAUSE:
            self.log(f"[wake] 听到安全词，停下{by}：{text}")
            self._stop_discord()
            self.meeting.stop()
            if self.boards is not None:
                self.boards.stop_all()   # 所有板子一起停
            self._post_soon(self._post_system(f"听到「{self.words.pause}」，停下了。"))
        elif h.action == wakemod.MUTE:
            self.log(f"[wake] 闭麦{by}：{text}")
            self.mic_on = False
            self._stop_discord()
            self.meeting.stop()
            self._post_soon(self._post_mic(False))
        elif h.action == wakemod.UNMUTE:
            self.log(f"[wake] 开麦{by}：{text}")
            self.mic_on = True
            self._post_soon(self._post_mic(True))
        elif h.action in (wakemod.LOUDER, wakemod.QUIETER):
            self._volume_by_voice(h, text, by)
        else:
            who = "轮流" if h.targets is None else "、".join(h.targets)
            if follow:
                who += "（接上一句）"
            self.log(f"[wake] 叫到 {who}{by}：{text}")
            self.say_as_user(text, h.targets)

    def _stop_discord(self) -> None:
        """先作废 Discord 排队的话，再停会议（会议发言锁被打断，Discord 正在念的那句也停下）。"""
        if self.discord is not None:
            self.discord.stop()

    def _volume_by_voice(self, h: wakemod.Heard, text: str, by: str) -> None:
        """「大声点」「小声点」：叫了名字调她们的板子；没叫名字调正在说或最近说的那个角色的板子；
        还没人说过话就调所有在线的板子。不进频道。"""
        step = VOLUME_STEP if h.action == wakemod.LOUDER else -VOLUME_STEP
        word = "调大" if step > 0 else "调小"
        if self.boards is None:
            return self.log(f"[wake] 听到{word}音量，但没开小智板子服务，不处理{by}：{text}")
        if h.targets:
            roles, why = h.targets, "叫到的"
        elif self._last_speaker is not None:
            roles, why = [self._last_speaker], "最近说话的"
        else:
            roles, why = self.boards.roles_online(), "所有在线的"
        self.log(f"[wake] 音量{word}{abs(step)}，{why}板子 {'、'.join(roles) or '无'}{by}：{text}")
        for r in roles:
            self.boards.set_volume(r, step=step)

    def set_volume(self, role: str, volume: int) -> None:
        """网页滑条（经 hub 推来）：把 role 的板子音量设成 volume。"""
        if self.boards is None:
            return self.log(f"[host] 网页要调 {role} 的音量，但没开小智板子服务")
        self.boards.set_volume(role, volume=volume)

    def _report_volumes(self) -> None:
        """板子音量变了（问到、调过、断开）：报给 hub，网页滑条跟着动。"""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        def send():
            ws = self._ws
            if ws is not None and not ws.closed and self.connected.is_set() and self.boards is not None:
                asyncio.ensure_future(self._send_one(ws, {"type": "volumes", "volumes": self.boards.volumes()}))
        loop.call_soon_threadsafe(send)

    def _post_soon(self, coro) -> None:
        loop = self._loop
        if loop is None or self._stop.is_set():
            coro.close()
            return
        asyncio.run_coroutine_threadsafe(coro, loop)

    async def _post_system(self, text: str, tag: str = "wake", notify: bool = False) -> None:
        self._said += 1
        body = {"author_kind": "system", "text": text, "client_key": f"{self._boot}:{tag}:{self._said}"}
        if notify:
            body["notify"] = True   # hub 给登记过的手机弹通知（rh/hub.py「手机通知」）
        await self._retry(lambda: self._req(self._http, "POST", f"/api/rooms/{self.room}/messages", body))

    def agent_event(self, role: str, project: str, state: str | None, text: str | None, notify: bool = False) -> None:
        """事件通道（rh/discord_body.py on_agent_event）：Discord 里这个角色出错 / 等批准 / 做完 / 会话关掉。
        做完、会话关掉、已报过的又一条出错 text 是 None：只改表盘，不往大厅发、不弹通知。
        表盘：这个 project 停在 state（None = 清掉）；网页复用 hub 现有消息列表，有 text 就发一条系统消息（手机打开同一网页就能看）。"""
        if self.dial is not None:
            self.dial.hold(role, project, state)
        if text:
            self._post_soon(self._post_system(text, tag="event", notify=notify))

    async def _post_mic(self, on: bool) -> None:
        await self._retry(lambda: self._req(self._http, "POST", "/api/mic", {"on": on}))

    def _set_mic(self, on: bool) -> None:
        """云端推来的闭麦开关（网页按钮或本机语音）：闭麦就停掉正在说的。"""
        changed = on != self.mic_on
        self.mic_on = on
        if not on:
            self._stop_discord()
            self.meeting.stop()
        if changed:
            self.log(f"[wake] 云端开关：{'开麦' if on else '闭麦，停下正在说的，不再收音'}")

    def say_as_user(self, text: str, targets: list[str] | None = None) -> None:
        """收音线程里调用：把转出的文字作为用户消息发到云端频道（作者是用户）。
        和网页发的一样，云端推回来后由 _handle_message 交给 meeting，按发言锁规则打断在说的角色。
        叫的是映射了 Discord bot 的角色（rh/discord_body.py，[discord] relay 开着）：这句改发进 Discord，由群里那个
        有当前会话的 bot 来答（用户 2026-10-19「不太行啊，还没接进来，没有我们现在会话的东西」）；没映射的角色照旧进自建频道。"""
        loop = self._loop
        if loop is None or self._stop.is_set():
            return
        if targets and self.discord is not None:
            bots = self.discord.bots_for(targets)
            if bots:
                if not self.mic_on:   # 闭麦时不发（收音那边已挡住，这里再守一道）
                    return self.log(f"[discord] 闭麦中，这句不发进 Discord（{len(text)} 字）")
                asyncio.run_coroutine_threadsafe(self.discord.relay_user(text, bots), loop)
                targets = [t for t in targets if t not in {b.role for b in bots}]
                if not targets:
                    return
        self._said += 1
        key = f"{self._boot}:voice:{self._said}"
        self._voice_targets[key] = targets
        asyncio.run_coroutine_threadsafe(self._post_user(text, key), loop)

    async def _post_user(self, text: str, key: str) -> None:
        body = {"author_kind": "user", "text": text, "client_key": key}
        await self._retry(lambda: self._req(self._http, "POST", f"/api/rooms/{self.room}/messages", body))

    # ---------- 设备（DeviceSpeaker 在 meeting 线程里调用） ----------
    def device_online(self, role: str) -> bool:
        if self.boards is not None and self.boards.online(role):
            return True
        return self.connected.is_set() and role in self.device_roles

    def send_device(self, frames: list[dict]) -> bool:
        pid = frames[0].get("play_id") if frames else None
        if frames and frames[0].get("event") == "start":
            board = self.boards is not None and self.boards.online(frames[0].get("role", ""))
            # DeviceSpeaker 一次只播一段（meeting 线程里依次调用），新的开始说之后旧的不会再有帧：只记这一个。
            self._routes = {pid: "board" if board else "hub"}
        route = self._routes.get(pid, "hub")
        if route == "board":
            return self.boards.send(frames)
        return self._send_hub(frames)

    def _send_hub(self, frames: list[dict]) -> bool:
        loop, ws = self._loop, self._ws
        if loop is None or ws is None or ws.closed or not self.connected.is_set():
            return False
        asyncio.run_coroutine_threadsafe(self._send_frames(ws, frames), loop)
        return True

    async def _send_frames(self, ws: aiohttp.ClientWebSocketResponse, frames: list[dict]) -> None:
        if len(frames) == 1 and frames[0].get("event") == "stop":
            # 打断不排在前面几批音频后面（审查第 5 条）：不等锁直接发（不压缩的帧一次写完，不会和别的帧交错）；
            # 同一播放还在排队的帧作废。等排在它前面的批次都过完锁，再把记号删掉。
            pid = frames[0].get("play_id")
            self._stopped.add(pid)
            await self._send_one(ws, frames[0])
            asyncio.ensure_future(self._forget_stop(pid))
            return
        async with self._ws_lock:   # 一批帧（开始说 + 音频）连着发，顺序不乱
            for f in frames:
                if f.get("play_id") in self._stopped:
                    continue
                if not await self._send_one(ws, f):
                    return

    async def _forget_stop(self, pid: str) -> None:
        async with self._ws_lock:
            self._stopped.discard(pid)

    async def _send_one(self, ws: aiohttp.ClientWebSocketResponse, f: dict) -> bool:
        if ws.closed:
            return False
        try:
            await ws.send_json(f)
            return True
        except (aiohttp.ClientError, ConnectionError, RuntimeError) as e:
            print(f"[device] 发给 hub 失败：{brief_error(e)}", flush=True)
            return False

    # ---------- 已读位置 ----------
    def _load_cursor(self) -> int | None:
        try:
            return int(json.loads(self.state_path.read_text())["cursor"])
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _save_cursor(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"cursor": self.cursor}))
        tmp.replace(self.state_path)

    # ---------- meeting -> 云端 ----------
    def _on_think(self, role: str | None, room: int | None = None) -> None:
        """meeting 线程里调用：谁在想，推给云端（网页显示“思考中”）和板子表盘。room=None：默认频道。"""
        if self.dial is not None and room is None:
            self.dial.think(role)
        loop = self._loop
        if loop is None:
            return
        def send():
            ws = self._ws
            if ws is not None and not ws.closed and self.connected.is_set():
                asyncio.ensure_future(self._send_one(ws, {"type": "thinking", "role": role,
                                                          "room": self.room if room is None else room}))
        loop.call_soon_threadsafe(send)

    def _targets(self, m: dict) -> list[str] | None:
        """这条用户消息叫了谁：语音的看收音时认出的；网页打字的按字找角色名。None = 轮流。"""
        key = m.get("client_key")
        if key in self._voice_targets:
            return self._voice_targets.pop(key)
        return self.words.typed_targets(m["text"]) if self.words is not None else None

    def _on_event(self, event: str, msg: Message, room: int | None = None) -> None:
        """meeting 线程里调用（持有 meeting 的锁），只丢进队列，不阻塞。room=None：默认频道（语音、表盘只跟它）。"""
        if room is None and event == "start" and msg.author not in ("user", "system"):
            self._last_speaker = msg.author
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (self._gen, room, event, msg))
        if self.dial is not None and room is None:
            self.dial.event(event, msg)

    async def _sender(self, http: aiohttp.ClientSession) -> None:
        """按顺序把发言发到云端；网络失败就等重连后重试同一条，保证先后顺序不乱。"""
        members = [{"id": r.id, "name": r.name, "avatar": cfgmod.avatar_data_url(r, self.config_dir)}
                   for r in self.meeting.roles]
        await self._retry(lambda: self._req(http, "PUT", "/api/members", members))
        while True:
            gen, room, event, msg = await self._queue.get()
            await self._retry(lambda: self._push(http, event, msg, gen, room), gen)

    async def _push(self, http: aiohttp.ClientSession, event: str, msg: Message, gen: int | None = None,
                    room: int | None = None) -> None:
        """room=None：默认频道。"""
        path = f"/api/rooms/{self.room if room is None else room}/messages"
        if event == "start":
            body = {"author_kind": "role", "author": msg.author, "name": msg.name,
                    "text": msg.text, "status": "speaking", "client_key": self._key(msg, room)}
            got = await self._req(http, "POST", path, body)
            if gen is not None and gen != self._gen:
                # 发出去时还是这一代，回来时已断线过（或被新主机踢了）：讨论已停，它的“说完”事件已作废，
                # 云端可能在清过“在说”之后才收到这条。马上改成被打断，否则它会一直亮着。
                try:
                    await self._req(http, "PATCH", f"/api/messages/{got['id']}", {"status": "interrupted"})
                except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as e:
                    print(f"[host] 补发“被打断”失败（云端下次主机连上时会清掉）：{brief_error(e)}", flush=True)
                return
            self._hub_ids[(room, msg.id)] = got["id"]
        elif event == "end":
            hub_id = self._hub_ids.pop((room, msg.id), None)
            if hub_id is not None:
                await self._req(http, "PATCH", f"/api/messages/{hub_id}",
                                {"status": msg.status, "spoken": msg.spoken})
        elif event == "system":
            await self._req(http, "POST", path,
                            {"author_kind": "system", "text": msg.text, "client_key": self._key(msg, room)})

    def _key(self, msg: Message, room: int | None = None) -> str:
        # 每个频道的 meeting 消息序号各从 0 数，别的频道要带上频道 id，否则云端按 client_key 去重会吞掉。
        return f"{self._boot}:{msg.id}" if room is None else f"{self._boot}:r{room}:{msg.id}"

    async def _req(self, http: aiohttp.ClientSession, method: str, path: str, body) -> dict:
        async with http.request(method, self.hub + path, json=body) as r:
            if r.status >= 500:
                raise aiohttp.ClientError(f"{method} {path}: {r.status}")
            if r.status >= 400:  # 请求本身不对，重试也没用
                raise ValueError(f"{method} {path}: {r.status} {(await r.text())[:200]}")
            return await r.json()

    async def _retry(self, fn, gen: int | None = None) -> None:
        delay = self.reconnect_min
        while True:
            await self.connected.wait()   # 掉线时先等重连，避免对着断网狂发
            if gen is not None and gen != self._gen:
                return   # 断线前的发言：讨论已停，丢掉
            self._idle.clear()
            try:
                await fn()
                return
            except ValueError as e:
                print(f"[host] 云端拒收，跳过：{e}", flush=True)
                return
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as e:
                print(f"[host] 发到云端失败，{delay:.0f} 秒后重试：{brief_error(e)}", flush=True)
            finally:
                self._idle.set()
            await asyncio.sleep(delay)   # 只有网络失败会走到这里
            delay = min(delay * 2, self.reconnect_max)

    # ---------- 云端 -> meeting ----------
    # ---------- 多频道：每个频道一个会话 ----------
    def _meeting_for(self, room_id: int | None) -> tuple[int | None, Meeting | None]:
        """这条消息所在频道的 (会话键, 会话)：默认频道是 (None, self.meeting)；别的频道没有就建，不管别的频道时为 None。"""
        if room_id is None or room_id == self.room:
            return None, self.meeting
        if room_id in self._archived:
            return room_id, None
        m = self.meetings.get(room_id)
        if m is None and self.room_meeting is not None:
            m = self.room_meeting(room_id)
            m.on_event = lambda event, msg, r=room_id: self._on_event(event, msg, r)
            m.on_think = lambda role, r=room_id: self._on_think(role, r)
            self.meetings[room_id] = m
            self._execs[room_id] = ThreadPoolExecutor(max_workers=1)   # 同一频道的用户消息按顺序交给它
            print(f"[host] 频道 {room_id} 开了自己的会话（{session_key(room_id)}）", flush=True)
        return room_id, m

    def _exec_for(self, key: int | None) -> ThreadPoolExecutor:
        return self._exec if key is None else self._execs[key]

    def _drop_meeting(self, room_id: int) -> None:
        m = self.meetings.pop(room_id)
        m.stop()
        self._execs.pop(room_id).shutdown(wait=False)

    def _rooms_changed(self, rooms: list[dict]) -> None:
        """云端推来全部频道（含归档的）。归档的停掉会话；会话目录和里面存的会话 id 留着
        （rh/brain.py），恢复后再有消息会新建 Meeting，角色大脑用 --resume 接着原来的 claude 会话。"""
        self._archived = {r["id"] for r in rooms if r.get("archived_at") is not None}
        self._room_stamps = {r["id"]: r.get("created_at") for r in rooms}
        for room_id in self._archived & self.meetings.keys() - {self.room}:
            self._drop_meeting(room_id)
            print(f"[host] 频道 {room_id} 已归档，停掉它的会话", flush=True)

    async def _handle_ready(self, ready: dict) -> None:
        self.room = ready["room"]["id"]
        for k in [k for k, v in self.meetings.items() if v is self.meeting]:   # 换了云端：默认频道 id 可能变
            del self.meetings[k]
        self.meetings[self.room] = self.meeting
        rooms = ready.get("rooms", [])
        msgs = ready["messages"]
        last = ready.get("last_id", 0)
        stamps = {r["id"]: r.get("created_at") for r in rooms}
        others = self.meetings.keys() - {self.room}
        if (self.cursor is not None and self.cursor > last) or any(
                k not in stamps or stamps[k] != self._room_stamps.get(k) for k in others):
            # 云端库换过（清空、换机器）：同一个 id 可能已是另一个频道，旧会话的上下文不能接上去。
            for k in list(others):
                self._drop_meeting(k)
            if others:
                print(f"[host] 云端频道对不上（库换过？），扔掉旧的频道会话 {sorted(others)}", flush=True)
        self._rooms_changed(rooms)
        self.device_roles = set(ready.get("devices", []))
        if self.cursor is not None and self.cursor > last:
            # 云端库被清空或换了：id 从头开始，旧的已读位置会让新消息全被当成“已处理过”。
            print(f"[host] 已读位置 {self.cursor} 比云端最新消息 {last} 还大（云端库被清空过？），重置为 {last}", flush=True)
            self.cursor = last
        top = max((m["id"] for m in msgs), default=self.cursor or 0)
        if self.cursor is None:
            # 第一次启动：不把云端旧历史当新话题。
            self.cursor = top
            self._save_cursor()
            return
        self.mic_on = ready.get("mic", True) is not False
        missed_all = [m for m in msgs if m["id"] > self.cursor and m["author_kind"] == "user"]
        by_room: dict[int | None, list[dict]] = {}
        for m in missed_all:   # 按频道分开补，每个频道只进它自己的会话
            by_room.setdefault(m.get("room_id"), []).append(m)
        for room_id, missed_msgs in by_room.items():
            key, meeting = self._meeting_for(room_id)
            if meeting is None:   # 已归档的频道、或本主机不管的频道：跳过，不建会话
                continue
            missed = [m["text"] for m in missed_msgs]
            print(f"[host] 补上断线期间的 {len(missed)} 条用户消息（频道 {room_id}）", flush=True)
            ts = [self._targets(m) for m in missed_msgs]
            only = None if any(t is None for t in ts) else sorted({r for t in ts for r in t})
            await self._loop.run_in_executor(self._exec_for(key), meeting.user_say_many, missed, only)
        # 交给 meeting 之后才落盘：中间被杀的话，下次启动还会补这几条，不会丢。
        self.cursor = max(self.cursor, top)
        self._save_cursor()

    async def _handle_message(self, m: dict) -> None:
        if self.cursor is not None and m["id"] <= self.cursor:
            return   # 状态更新（多半是自己发的）或已处理过
        if m["author_kind"] == "user":
            key, meeting = self._meeting_for(m.get("room_id"))
            if meeting is not None:   # 不管别的频道（没给 room_meeting）时跳过，不塞进默认频道的会话
                await self._loop.run_in_executor(self._exec_for(key), meeting.user_say, m["text"], self._targets(m))
        self.cursor = m["id"]   # 交给 meeting 之后才落盘，同上
        self._save_cursor()

    async def _session(self, http: aiohttp.ClientSession) -> None:
        ws_url = "ws" + self.hub[len("http"):] + "/ws/host"   # 主机专用入口（大帧上限，握手带 token 头）
        async with http.ws_connect(ws_url, heartbeat=HEARTBEAT) as ws:
            hello = {"type": "hello", "token": self.token, "kind": "host", "since": self.cursor}
            if self.room_meeting is not None:
                hello["rooms"] = "all"   # 订全部频道（rh/hub.py「多频道」）；旧 hub 不认这个字段，照旧只给默认频道
            await ws.send_json(hello)
            first = await ws.receive(timeout=self.ready_timeout)   # 云端不回 ready 就算连接失败，重连
            if first.type != aiohttp.WSMsgType.TEXT:
                raise ConnectionError(f"云端拒绝连接：{first.type} {ws.close_code}")
            await self._handle_ready(json.loads(first.data))
            self._ws = ws
            self.connected.set()
            self._report_volumes()   # hub 重启或主机重连后，网页滑条要知道板子现在的音量
            print(f"[host] 已连上云端 {self.hub}，频道 {self.room}，已读到 {self.cursor}，"
                  f"有设备的角色 {sorted(self.device_roles) or '无'}", flush=True)
            async for frame in ws:
                if frame.type != aiohttp.WSMsgType.TEXT:
                    break
                data = json.loads(frame.data)
                if data.get("type") == "message":
                    await self._handle_message(data["message"])
                elif data.get("type") == "rooms":
                    self._rooms_changed(data.get("rooms") or [])
                elif data.get("type") == "mic":
                    self._set_mic(data.get("on") is not False)
                elif data.get("type") == "volume":
                    if isinstance(data.get("role"), str) and isinstance(data.get("volume"), int):
                        self.set_volume(data["role"], data["volume"])
                elif data.get("type") == "devices":
                    self.device_roles = set(data.get("roles", []))
                    if hasattr(self.speaker, "devices_changed"):
                        self.speaker.devices_changed()
                    print(f"[device] 有设备在线的角色：{sorted(self.device_roles) or '无'}", flush=True)
                elif data.get("type") == "receipt" and self.speaker is not None:
                    self.speaker.on_receipt(str(data.get("play_id")), str(data.get("result")), data.get("started"))
        if ws.close_code == WS_REPLACED:
            # 云端只留一个角色主机：别处起了新的，这个退出，不重连（否则两个互相踢）。
            print("[host] 另一个角色主机连上了云端，本机这个退出", flush=True)
            self.stop()

    async def run(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()
        self._ws_lock = asyncio.Lock()
        self.meeting.on_event = self._on_event
        self.meeting.on_think = self._on_think
        if self.discord is not None:
            self.discord.on_notice = self.agent_event   # 事件通道：Discord 里出错 / 等批准 → 网页和表盘；做完只回表盘
            if self.dial is not None:   # 队友状态文件里忙变闲 = 一轮结束：没出错的那几个 project 清「出错已报」记号（红圈 Dial 自己清）
                self.dial.on_idle = self.discord.role_idle
        if self.boards is not None:
            try:
                await self.boards.start()
            except Exception as e:   # 如端口被占：只是没有板子，Mac 喇叭和 hub 照常
                self.log(f"[host] 小智协议服务起不来（端口 {self.boards.port}）：{e!r}；这次不用板子，其余照常")
                try:
                    await self.boards.close()
                except Exception:
                    pass
                self.boards = None
        headers = {"Authorization": f"Bearer {self.token}"}
        async with aiohttp.ClientSession(headers=headers,
                                         timeout=aiohttp.ClientTimeout(total=HTTP_TIMEOUT)) as http:
            self._http = http
            sender = asyncio.create_task(self._sender(http))
            delay = self.reconnect_min
            try:
                while not self._stop.is_set():
                    sess = asyncio.create_task(self._session(http))
                    stopper = asyncio.create_task(self._stop.wait())
                    await asyncio.wait({sess, stopper}, return_when=asyncio.FIRST_COMPLETED)
                    stopper.cancel()
                    if not sess.done():   # 要退出了：关掉连接
                        sess.cancel()
                    try:
                        await sess
                        delay = self.reconnect_min
                    except asyncio.CancelledError:
                        if not self._stop.is_set():
                            raise
                    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ConnectionError) as e:
                        print(f"[host] 连接云端失败：{brief_error(e)}", flush=True)
                    self.connected.clear()
                    self._ws = None
                    self.device_roles = set()
                    # 断线就停讲。先停 meeting 再加代数：停的时候发出的“被打断”事件也算上一代，一起丢掉。
                    for m in {id(x): x for x in [self.meeting, *self.meetings.values()]}.values():
                        m.stop()
                    self._gen += 1
                    self._hub_ids.clear()
                    if self._stop.is_set():
                        break
                    print(f"[host] {delay:.0f} 秒后重连", flush=True)
                    try:
                        await asyncio.wait_for(self._stop.wait(), delay)
                    except asyncio.TimeoutError:
                        pass
                    delay = min(delay * 2, self.reconnect_max)
            finally:
                try:   # 有一条正在路上就等它回来（回来后会补发“被打断”），最多一个请求超时
                    await asyncio.wait_for(self._idle.wait(), HTTP_TIMEOUT)
                except asyncio.TimeoutError:
                    pass
                sender.cancel()
                if self.boards is not None:
                    await self.boards.close()

    def stop(self) -> None:
        self._stop.set()


def main() -> None:
    env = {**read_dotenv(ROOT / ".env"), **os.environ}
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "roles.toml"))
    ap.add_argument("--hub", default=env.get("RH_HUB_URL", ""))
    ap.add_argument("--state", help="已读位置文件，默认 data/host-state-<云端地址>.json")
    ap.add_argument("--log", default=str(ROOT / "logs" / f"speech-{time.strftime('%Y%m%d-%H%M%S')}.jsonl"))
    ap.add_argument("--no-voice", action="store_true", help="不收音、不播放，纯文字")
    ap.add_argument("--feed-audio", help="先把这段音频当麦克风输入喂一次（端到端自测），再照常收麦克风")
    ap.add_argument("--asr-url", default=env.get("RH_ASR_URL", "http://127.0.0.1:8787/v1"))
    a = ap.parse_args()
    token = env.get("RH_HUB_TOKEN", "")
    if not a.hub or not token:
        raise SystemExit("需要 RH_HUB_URL 和 RH_HUB_TOKEN（环境变量或仓库根目录 .env）")
    cfg = cfgmod.load(a.config)
    # 播放：有设备在线推给设备（等回执），没有就用本机 Mac 喇叭。
    # [voice] player = "vpio"：本机喇叭和收音都走系统语音处理（rh/vpio.py）；辅助进程编译不出来就直接报错退出，不悄悄退回旧方式。
    vpio = None
    if not a.no_voice and cfg.voice_player == "vpio":
        vpio = vpiomod.VPIO([str(vpiomod.build_helper())])
    tts = None if a.no_voice else build_tts(cfg, vpio=vpio)
    meeting = build(cfg, Path(a.log), tts=tts)
    state = Path(a.state) if a.state else state_path_for(a.hub)
    words = wakemod.Words.from_config(cfg)
    # 小智板子：roles.toml 有 [xiaozhi] 段且开着语音才起服务（README「小智板子」）。token 可选，读 RH_XIAOZHI_TOKEN。
    boards = None
    if tts is not None and cfg.xiaozhi_port is not None:
        boards = xiaozhimod.XiaozhiServer(cfg.xiaozhi_boards, token=env.get("RH_XIAOZHI_TOKEN", ""), port=cfg.xiaozhi_port)
    # 别的频道（非默认频道）主机不建会话、不回话（room_meeting=None，hello 也不订别的频道），让 cc-connect 经 cloud_web
    # 接进来的 bot（能干活、有记忆）回。来源：2026-10-20 现场，room 2「@橘 …」收到两条回复——hub 消息 229 作者 ju
    # （主机的 claude -p 角色）和 230 作者 maomao（cc-connect 的橘），同一个角色回了两遍。默认频道（大厅，语音和板子）不变。
    # Host 仍支持 room_meeting（tests/test_rooms.py），要主机自己管别的频道时在这里传工厂（build(..., room_id=)）。
    host = Host(meeting, a.hub, token, state, config_dir=Path(a.config).resolve().parent, speaker=tts, words=words,
                boards=boards, room_meeting=None)
    if boards is not None:
        # 名牌里的工作状态：按 [[discord.bots]] 的 project 读 ~/im-bridge/team/<project>.json（rh/dial.py read_busy）
        host.dial = dialmod.Dial(boards, cfg.roles, Path(a.config).resolve().parent, bots=cfg.discord_bots)
        # 板子固件经 Wi-Fi 升级（rh/xiaozhi.py XiaozhiServer.firmware）：设了 RH_XIAOZHI_FIRMWARE 才管
        if env.get("RH_XIAOZHI_FIRMWARE"):
            boards.firmware = Path(env["RH_XIAOZHI_FIRMWARE"]).expanduser()
            boards.fw_asked_file = ROOT / "logs" / "xiaozhi-fw-asked.txt"   # 已让升过的 (MAC, 固件 sha)，重启后也不再重升
    # 形态 B：Discord 里 bot 回应主人的话（cc-connect 钩子 / gate 转来）在板子上念。要有板子服务和 [[discord.bots]] 映射；
    # 真板播放开关 [discord] play 默认关，关着只记日志（rh/discord_body.py）。
    # [discord] relay 开着：板子听到叫 bot 对应的角色，把这句以 webhook 身份发进 Discord；发到哪个频道、念摘要、新建频道
    # 都按 roles.toml [discord] 配（rh/discord_body.py build，没配的退回现状）。地址和 token 只从环境变量 / .env 读，不打日志；
    # 开了 relay 却既没默认频道 webhook 也没 bot token 直接报错退出，不悄悄退回自建频道（同 vpio、唤醒模型）。
    if boards is not None and cfg.discord_bots:
        host.discord = discordmod.build(cfg, env, boards, tts.synth, meeting.lock, on_event=host.dial.event)
        boards.routes.extend(host.discord.routes())
        # 启动自检（rh/discord_body.py selfcheck）：token、默认频道、webhook 配错就在这里报清楚怎么改并退出，
        # 不等第一句话才悄悄失败；连不上 Discord 只警告、照常启动。
        if cfg.discord_relay:
            bad, warn = asyncio.run(host.discord.selfcheck())
            for w in warn:
                print(f"[discord] 自检：{w}", flush=True)
            if bad:
                host.discord.close()
                raise SystemExit("roles.toml / .env 的 Discord 配置不对：\n- " + "\n- ".join(bad))
            print("[discord] 自检通过" if not warn else "[discord] 自检有项没核成，见上", flush=True)
        host.discord.warm()   # 开机预热选频道模型（后台），免得第一句等冷启动超时进默认频道
    listener = board_listener = None
    asr = None if a.no_voice else voicemod.gateway_asr(a.asr_url, print)
    if asr is not None:
        def sources(stop):
            if a.feed_audio:
                yield voicemod.file_frames(a.feed_audio, os.environ.get("FFMPEG", "ffmpeg"))
            yield voicemod.mic_frames(stop) if vpio is None else voicemod.resilient(vpio.mic, stop, print)
        # 本地唤醒模型（rh/kws.py）：配了就必须加载成功，缺模型直接报错退出（同 vpio：不悄悄退回只靠转文字）。
        spotter = None
        if cfg.wake_kws_model:
            try:
                spotter = kwsmod.Spotter(words, cfg.wake_kws_model)
            except Exception as e:
                raise SystemExit(f"本地唤醒模型加载失败：{e}") from e
        stamp = time.strftime('%Y%m%d-%H%M%S')
        mac_voice, mac_kws = host.voice_from("mac")
        listener = voicemod.Listener(asr, mac_voice, sources, playing=host.spoken_between,
                                     urgent=words.stop_word, timed=True,
                                     kws=spotter, on_kws=mac_kws, muted=lambda: not host.mic_on,
                                     save_dir=ROOT / "logs" / f"utter-{stamp}")
        # 板子收音（rh/board_mic.py）：板子上传的麦克风进同一条链路（叫名字才应、暂停、闭麦、开麦），自己一个唤醒模型实例。
        # 现在板子上的固件不上传（role-household-fw 分支 rh 禁了上行），这一路就一直空着。
        if boards is not None:
            mic = board_micmod.BoardMic()
            boards.on_mic, boards.on_mic_end = mic.on_packet, mic.on_end
            board_spotter = kwsmod.Spotter(words, cfg.wake_kws_model) if spotter is not None else None
            board_voice, board_kws = host.voice_from("board")
            board_listener = voicemod.Listener(asr, board_voice, lambda stop: [mic.frames(stop)], playing=host.spoken_between,
                                               urgent=words.stop_word, timed=True, kws=board_spotter, on_kws=board_kws,
                                               muted=lambda: not host.mic_on, save_dir=ROOT / "logs" / f"utter-board-{stamp}",
                                               log=lambda s: print(s.replace("[voice]", "[voice/板子]", 1)
                                                                    .replace("[kws]", "[kws/板子]", 1), flush=True))
        print(f"唤醒模型={'关' if spotter is None else '、'.join(spotter.labels)}  每句音频存 logs/utter-{stamp}/", flush=True)
    voices = "关" if a.no_voice else "、".join(
        f"{r.name}={(r.qwen_speaker if cfg.voice_backend == 'qwen' and r.qwen_speaker else r.voice) or '无'}"
        for r in cfg.roles)
    print(f"角色主机 云端={a.hub}  模型={cfg.model}  播放={voices}  收音={'开' if listener else '关'}"
          f"  本机播放和收音={'系统语音处理（回声消除）' if vpio is not None else '直接（afplay/say + 麦克风）'}"
          f"  发言日志={a.log}  唤醒词={'、'.join(n for _, ns in words.roles for n in ns)}、{'、'.join(words.product)}"
          f"  安全词={words.pause}  闭麦={words.mute}/{words.unmute}"
          f"  Discord 回应={'未配' if host.discord is None else ('板子念' if cfg.discord_play else '只记日志')}"
          f"  板子的话进 Discord={'开' if host.discord is not None and cfg.discord_relay else '关'}", flush=True)

    async def runner():
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, host.stop)
        task = asyncio.create_task(host.run())   # stop() 后 run 自己收尾退出（会等路上的请求回来）
        await asyncio.sleep(0)   # 让 run 先记下事件循环，收音线程才能往里投消息
        for li in (listener, board_listener):
            if li:
                li.start()
        try:
            await task
        finally:
            for li in (listener, board_listener):
                if li:
                    li.stop()

    try:
        asyncio.run(runner())
    finally:
        # 退出时杀掉还在跑的 claude，别留孤儿进程继续耗额度。
        for b in meeting.brains.values():
            b.cancel()
        if host.discord is not None:
            host.discord.close()
        if tts is not None:   # 还在念的 say 也杀掉，不留孤儿把话念完
            tts.close()


if __name__ == "__main__":
    main()
