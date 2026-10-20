"""形态 B：板子当现有平台（我们的 Discord）里 bot 的躯体。

用户 2026-10-19：「我预期有两种形态……一种就是进入现有的平台，别人现有的一个team下面，例如我们的discord」。

两条路（第二步起，用户 2026-10-19 对着板子叫小橘、自建平台的橘答了之后：「不太行啊，还没接进来，没有我们现在会话的东西」）：

1. 主人对板子说的话进 Discord（relay，[discord] relay 开关）：
   收音认出叫的是映射了 Discord bot 的角色（[[discord.bots]]）→ 不再发进自建频道，改以 webhook 身份（用户名「板子」）
   发进 Discord。发到哪个频道由小模型按意思选（现有频道 / 默认 [discord] channel / 新建频道），每个频道用主机自己建的
   webhook；没配就只进默认频道（rh/discord_route.py，配置项见 roles.example.toml、docs/DISCORD_BODY.md）。
   webhook 地址不进 git、不打日志。
   正文让群里的 bot 一眼知道这是主人本人的话，不是一个叫「板子」的陌生人（审稿 ~/.claude/reviews/rh-discord-relay.md 第 2 条）：
       <@bot_id> （主人对着板子说的，语音转文字）原话
   没映射的角色、叫产品名「小家」、没叫名字的话仍走原来的自建频道；闭麦时不发。
   发出去就记下「替主人在哪个频道问了哪个 bot、什么时候」，等她回。

2. bot 的回复回到板子念出来：
   a. cc-connect 的 message.sent 钩子 ──POST /rh/discord/hook {event, project, session_key, content, extra}──▶ 这里
      webhook 发消息时带 ?wait=true，拿到这条 Discord 消息的 ID，记成「等她回」。
      钩子的 extra.trigger_message_ids（maomao 分支 cc-connect：触发这一轮回复的消息 ID）里有这个 ID、而且是那个 bot
      → 这条就是对板子那句话的回复，念出来、清掉等待（审查建议 1：按消息 ID 精确对账）。
      钩子不带 ID（别人的旧 cc-connect）：退回按 (bot, 频道) 对，只认 PENDING_TTL 之内的等待。
      对不上的（她在群里和别人说话、交接给队友）只记日志。
   b. 旧路保留当后备：gate（~/im-bridge/gate/rhbody.py）──POST /rh/discord/say {bot_id, text, truncated}──▶ 这里。
      同一条回复两条路都会送来：按 (bot, 文字结尾) 去重，谁先到念谁。
   两条路都 ──▶ DiscordBody.submit ──▶ 排队（一次念一句） ──▶ 压成一两句口语摘要（没配念全文，配了但失败只念第一句；
      频道里的文字不动）──▶ 拿会议的发言锁（和小家里的讨论不叠音）
      ──▶ DeviceSpeaker（只推板子）──▶ 板子

只念回应板子主人的话（用户「你可能指定跟他们说他们才会应你，否则就当不存在」；审稿 ~/.claude/reviews/rh-two-forms.md 第 1 条）：
钩子那条路靠「等她回」的记录，gate 那条路的判定在 gate 那边（被主人 @、开头点名、或主人回复她的消息之后，她的下一条回复）。

3. 事件通道（角色小家第一幕①；用户「我现在基本不在电脑前面了」）：同一个 /rh/discord/hook 也收 cc-connect 的
   error、permission.requested 钩子（cc-connect maomao 分支 core/hooks.go:20-30，载荷同上，多 error 字段、
   permission.requested 的 extra.tool_name），message.sent 同时当「这一轮做完了」：
   - 出错、等批准 → 一句短话在这个 bot 对应角色的板子上念（走下面同一条念的路，同样受播放开关、板子在线、暂停管），
     网页消息列表多一条系统消息（Host.agent_event 发到 hub），表盘停在 interrupted / thinking（现有状态）到下一个事件。
   - 做完 → 只让表盘回待机、清「出错已报」记号，不进网页、不念（四个 bot 每轮都做完，进大厅会刷屏；
     2026-10-20 用户看大厅截图原话「你这什么狗屎，你是怎么验收过的，这叫对齐么」，要对齐 Discord）。
   - cc-connect 自己在重试的出错（RETRYING）只记日志：不进网页、不念、表盘不变红。上下文太长它只换新会话重跑一次，
     紧接着第二条「prompt is too long」就是它已放弃，按普通出错报（见 PROMPT_TOO_LONG）。
   - 同一 project 出错只报一次：记号到她真回上话（message.sent）、会话关掉、或者这一轮没出错正常结束（含静默回复
     NO_REPLY，没有 message.sent）才清。连着几轮都失败只报第一条，但每条出错都让表盘停在红圈。
   - 不在 [[discord.bots]] 里的 project 只记日志。

和小家同一套不出声规则（审稿 rh-two-forms 第 2 条；rh-discord-relay 第 1 条：半夜不出声在这条路上同样管用）：
- 半夜不出声 = 真板播放开关 [discord] play（主机里没有别的按时刻的规则，grep 半夜/quiet/night 无）：关着只记日志、不出声
  （用户不在、睡觉时不许出声；开关由用户在场时打开）。两条路都过 submit()，都受它管。
- 只推板子：板子不在线就不念，不退回 Mac 喇叭、不推网页。
- 安全词「暂停」、闭麦：Host 调 stop()，正在念的停下、排队的作废；会议发言锁被打断（用户插话）也停下。
- 念的话记下来给收音线程比对回声（同 meeting.spoken_between）。
"""
from __future__ import annotations

import asyncio
import queue
import re
import threading
import time
from pathlib import Path
from typing import Callable

import aiohttp
from aiohttp import web

from . import discord_route as route
from .config import DiscordBot, DiscordSettings, Role
from .device import RECEIPT_GRACE, DeviceSpeaker
from .lock import SpeakingLock
from .meeting import Message

SAY_PATH = "/rh/discord/say"
HOOK_PATH = "/rh/discord/hook"
# webhook 发言显示的名字：roles.toml [discord] username（默认「板子」，见 rh/config.py DiscordSettings）。
# 正文前缀：让 bot 知道这是主人本人对着板子说的话（审稿 rh-discord-relay 第 2 条）。
RELAY_PREFIX = "（主人对着板子说的，语音转文字）"
# 发 webhook 的超时秒数。来源：同 rh/host.py HTTP_TIMEOUT（单次 HTTP 请求超时）。
RELAY_TIMEOUT = 15.0
# 两条路送来同一条回复时按文字结尾这么多字去重。来源：橘派活时定的 200 字；比结尾不比开头，因为 gate 那条路只拿得到
# 回复的结尾一段（cc-connect last_reply 截后 600 字），长回复的开头两边不一样、结尾一样。
DEDUP_CHARS = 200
# 等发言锁时多久再试一次。来源：沿用 rh/meeting.py _acquire 的 0.02 秒重试间隔。
POLL_SEC = 0.02
# 按 (bot, 频道) 对账（钩子不带触发消息 ID 时）只认多久之内的等待（秒）。来源：实现者定，取 ~/.cc-connect/config.toml
# idle_timeout_mins = 15（agent 15 分钟没有事件就结束这一轮）的两倍，留给排在别的轮后面再答的情况；过了就不再按频道猜，
# 免得把她之后在这个频道说的别的话（交接、回别人）当成回板子念出来（审查建议 1）。
PENDING_TTL = 30 * 60.0
# 等待记录最多留多久（秒），只为内存不一直涨。来源：实现者定；按消息 ID 精确对账不怕念错，一天内答的都念。
PENDING_KEEP = 24 * 3600.0
# 念过的话留多久给回声比对（秒）。来源：实现者定，远大于 rh/voice.py 一句最长 MAX_UTTER_MS（30 秒）。
SPOKEN_KEEP_SEC = 120.0
LOOPBACK = ("127.0.0.1", "::1")
# 事件通道：cc-connect 钩子事件 → (网页里怎么叫, 表盘停在哪个现有状态；None = 回待机, 念不念)。
# 出错红圈、等批准思考中：rh/dial.py 现有的 interrupted / thinking（派活「表盘切到现有的状态之一」）；做完不念（派活方定）。
# agent.closed（会话关掉：空闲关闭、/new、换会话）只清表盘和「出错只报一次」的记号，不进网页、不念（代码审查裁决 1）。
# 做完同样不进网页（大厅刷屏修复，见文件头）。
AGENT_EVENTS = {"error": ("error", "interrupted", True), "permission.requested": ("permission", "thinking", True),
                "message.sent": ("done", None, False), "agent.closed": ("closed", None, False)}
# 网页里事件带上原文（要批准的操作）开头多少字；日志里报错也取这么多。来源：同 submit() 日志里回应开头取 40 字。
EVENT_HEAD = 40
# cc-connect 自己会重试的出错（报错里含这些字）：不进网页、不念、表盘不变红，只记日志。
# 来源：派活原话「cc-connect 自己在重试的（容量/429 重试中）不发」；字样取自 ~/code/cc-connect maomao 分支
# core/capacity_retry.go isModelCapacityError（"at capacity"，重试 3 次再冷却后自动重投）、
# core/handoff.go isPromptTooLongError（"prompt is too long"，换新会话重试）。
RETRYING = ("at capacity", "prompt is too long")
# 上下文太长：cc-connect 只换新会话重跑一次（core/handoff.go:166-173，msg.freshRetried 为真或没法换新会话就不再重试，
# 只往频道发一句出错，不另发钩子）。所以紧接着的第二条（中间没有回上话、没有一轮正常结束）一定是它已放弃。
# 第一条就放弃（没有可换的会话：agent 会话 ID 为空或 ContinueSession）钩子上和「在重试」一模一样，分不出，仍不报。
PROMPT_TOO_LONG = "prompt is too long"

_CODE = re.compile(r"```.*?(?:```|$)", re.S)
_MENTION = re.compile(r"<[@#][!&]?\d+>")
_URL = re.compile(r"https?://\S+")
_MARK = re.compile(r"[`*#|>~]+|-{3,}")   # Markdown 记号、表格分隔线
_SPACE = re.compile(r"[ \t]+")
# cc-connect 权限请求正文里要批准的操作在代码块里（core/i18n.go MsgPermissionPrompt：「Agent 想要使用 **%s**:\n\n```\n%s\n```」）
_FENCE = re.compile(r"```[^\n]*\n(.*?)(?:```|$)", re.S)


def relay_content(bot_ids: list[str], text: str) -> str:
    """发进 Discord 的正文：@ 被叫到的 bot，再说明这是主人对着板子说的（语音转文字），最后是原话。"""
    return " ".join(f"<@{b}>" for b in bot_ids) + " " + RELAY_PREFIX + text


def speakable(text: str, truncated: bool = False) -> str:
    """Discord 正文改成能念的：去掉代码块、@提及、链接、Markdown 记号（念出来是噪音）。
    truncated：gate 只拿得到回复的结尾一段（cc-connect last_reply 截后 600 字），开头半句不念，从第一个句末之后开始。"""
    t = _URL.sub("", _MENTION.sub("", _CODE.sub("", text)))
    t = _MARK.sub(" ", t)
    t = "\n".join(_SPACE.sub(" ", line).strip() for line in t.splitlines())
    t = re.sub(r"\n{2,}", "\n", t).strip()
    if truncated:
        m = route.FIRST_END.search(t)
        if m and t[m.end():].strip():
            t = t[m.end():].strip()
    return t


def channel_of(session_key: str) -> str:
    """cc-connect 的 Discord session_key → 频道 ID：discord:<频道>（share_session_in_channel = true）或
    discord:<频道>:<用户>（false，platform/discord/discord.go buildSessionKey）。别的格式 → 空。"""
    parts = session_key.split(":")
    return parts[1] if len(parts) >= 2 and parts[0] == "discord" and parts[1].isdigit() else ""


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
                 on_event: Callable[[str, Message], None] | None = None, grace: float = RECEIPT_GRACE,
                 relay: bool = False, webhook: str = "", channel: str = "", settings: DiscordSettings | None = None,
                 api: route.DiscordAPI | None = None, router: route.Router | None = None,
                 summarizer: route.Summarizer | None = None):
        self.bots = {b.bot_id: b for b in bots}
        self.by_role = {b.role: b for b in bots}
        self.by_project = {b.project: b for b in bots if b.project}
        self.roles = {r.id: r for r in roles}
        self.boards, self.lock, self.play, self.log, self.on_event = boards, lock, play, log, on_event
        # 事件通道的出口：on_notice(角色 id, 表盘状态或 None, 网页那条的文字)。Host.run 接上（发 hub、改表盘）；没接只记日志。
        # on_notice(角色 id, project, 表盘状态或 None, 网页那条的文字或 None = 不进网页, notify=要不要弹手机通知)
        self.on_notice: Callable[..., None] | None = None
        # 已报过出错、还没等到 message.sent / agent.closed / 一轮没出错正常结束的 project：连着几轮失败也只报一次
        # （裁决 4；大厅刷屏修复）
        self._errored: set[str] = set()
        # 上下文太长、cc-connect 正在换新会话重跑的 project（下一条 prompt is too long = 它已放弃）；清的时机同 _errored
        self._too_long: set[str] = set()
        # 轮次：角色 -> 第几轮（表盘每读到一次忙变闲 +1）；project -> 最近一次出错（含重试中的）落在她的第几轮。
        # 忙变闲时这一轮没有出错 = 正常结束，清记号（role_idle）。
        self._round: dict[str, int] = {}
        self._err_round: dict[str, int] = {}
        # 主人的话进 Discord：relay 开关、webhook 地址（不打日志）、频道（钩子只认这个频道的回复）
        self.relay, self.webhook, self.channel = relay, webhook, channel
        # 服务器相关的设置（rh/discord_route.py）：api 空 = 不列频道、不建频道/webhook；router 空 = 只进默认频道；
        # summarizer 没配模型 = 念全文
        self.settings = settings or DiscordSettings(webhooks_file="")   # 没给设置：webhook 只记在内存，不读写仓库 data/
        self.api, self.router = api, router
        self.summarizer = summarizer or route.Summarizer(None, self.settings.summary_chars, speakable)
        self.store = route.WebhookStore(self.settings.webhooks_file, self.settings.allow_bots_file)
        try:   # 启动对账：存着的 webhook 不在放行文件里的补上（审查建议 3）
            if fixed := self.store.reconcile():
                log(f"[discord] 放行名单 {self.settings.allow_bots_file} 补上了 {len(fixed)} 个主机建的 webhook ID：{' '.join(fixed)}")
        except OSError as e:
            log(f"[discord] 放行名单对账失败（{type(e).__name__}: {e}）：别的频道的话 cc-connect 可能收不到")
        self.channels = (route.Channels(api, self.settings.guild, self.settings.exclude_channels, log)
                         if api is not None and self.settings.guild else None)
        self._hook_lock: asyncio.Lock | None = None   # 建 webhook 一次一个（第一次用时在事件循环里建）
        self._make_lock: asyncio.Lock | None = None   # 建频道一次一个（找同名 + 建，审查建议 5）
        # 替主人发出的消息：Discord 消息 ID（没拿到 ID 时 noid:<序号>）→ {bots: 还没回的 bot ID, channel, at: 发出时刻}
        self._pending: dict[str, dict] = {}
        self._noid = 0
        self._last: dict[str, tuple[str, str]] = {}   # bot_id -> (哪条路送来的, 文字结尾)：另一条路再送同一条不念第二遍
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
    def routes(self) -> list[tuple[str, str, Callable]]:
        return [("POST", SAY_PATH, self._http), ("POST", HOOK_PATH, self._hook)]

    async def _body(self, req: web.Request) -> dict:
        if req.remote not in LOOPBACK:   # 板子服务听 0.0.0.0：只收本机 gate / cc-connect 发来的
            raise web.HTTPForbidden()
        try:
            d = await req.json()
        except ValueError:
            raise web.HTTPBadRequest()
        if not isinstance(d, dict):
            raise web.HTTPBadRequest()
        return d

    async def _http(self, req: web.Request) -> web.Response:
        d = await self._body(req)
        return web.json_response({"result": self.submit(str(d.get("bot_id", "")), str(d.get("text", "")),
                                                        d.get("truncated") is True)})

    async def _hook(self, req: web.Request) -> web.Response:
        """cc-connect 的钩子：{event, project, session_key, platform, content, error, extra}。
        message.sent：先按原来的规则看是不是回板子那句（返回它的结果），再当「做完」报给事件通道；
        error / permission.requested：只走事件通道（返回它的结果）。"""
        d = await self._body(req)
        text = lambda k: str(d.get(k) or "")   # 字段是 null 时当空（不显示 "None"，裁决 5）
        event, project, content = text("event"), text("project"), text("content")
        extra = d.get("extra") if isinstance(d.get("extra"), dict) else {}
        result = "ignored"
        if event == "message.sent":
            ids = extra.get("trigger_message_ids")
            triggers = [str(x) for x in ids if x] if isinstance(ids, list) else None
            result = self.on_sent(event, project, text("session_key"), content, triggers)
        got = self.on_agent_event(event, project, content, text("error"), str(extra.get("tool_name") or ""))
        return web.json_response({"result": result if event == "message.sent" else got})

    # ---------- 事件通道 ----------
    def on_agent_event(self, event: str, project: str, content: str = "", error: str = "", tool: str = "") -> str:
        """cc-connect 钩子事件 → 表盘一个状态；出错和等批准再进网页一条、念一句（做完只回表盘）。
        返回 ignored（不认识的事件）/ unmapped / 念的结果（off / no_board / queued）/ listed（做完：不进网页、不念）/
        retrying（cc-connect 在重试的出错）/ repeat（同一 project 的出错已报过）/ cleared（会话关掉）。"""
        if event not in AGENT_EVENTS:
            return "ignored"
        kind, state, speak = AGENT_EVENTS[event]
        bot = self.by_project.get(project)
        if bot is None:
            self.log(f"[event] {event}：project {project or '?'} 没映射到 [[discord.bots]]，只记日志")
            return "unmapped"
        role = self.roles[bot.role]
        tail = lambda x: f"：{x[:EVENT_HEAD]}" if x.strip() else ""   # 没有内容就不带冒号后那段（裁决 5）
        with self._mu:
            if kind == "error":
                self._err_round[project] = self._round.get(bot.role, 0)
                too_long = PROMPT_TOO_LONG in error
                gave_up = too_long and project in self._too_long   # 换新会话重跑也太长：cc-connect 已放弃
                if too_long:
                    self._too_long.add(project)
                if not gave_up and any(w in error for w in RETRYING):
                    self.log(f"[event] {bot.name}（{role.name}）出错，cc-connect 在重试，不报：{error[:EVENT_HEAD]}")
                    return "retrying"
                repeat = project in self._errored
                self._errored.add(project)
            else:   # 做完、会话关掉：下一次出错照报（等批准不清：等批准之后的出错仍是同一轮）
                repeat = False
                if kind in ("done", "closed"):
                    self._errored.discard(project)
                    self._too_long.discard(project)
        if repeat:
            # 已报过：不进网页、不念、不弹通知，但表盘照样停在红圈（不然第二轮失败结束时红圈就被清了）
            self.log(f"[event] {bot.name}（{role.name}）又一条出错，已报过，只记日志：{error[:EVENT_HEAD]}")
            if self.on_notice is not None:
                try:
                    self.on_notice(role.id, project, state, None, notify=False)
                except Exception as e:
                    self.log(f"[event] 事件没推到表盘：{e!r}")
            return "repeat"
        if kind == "error":
            # 原始报错只进日志，网页和念的都是一句人话（派活原话「原始报错不进正文」）
            line = f"{role.name}那边出错了，没回上话"
            say = line + "。"
            self.log(f"[event] {bot.name}（{role.name}）原始报错：{error[:EVENT_HEAD]}")
        elif kind == "permission":
            what = tool or "一个操作"
            m = _FENCE.search(content)   # 网页给要批准的那条操作本身（speakable 会把代码块去掉）
            op = _SPACE.sub(" ", m.group(1)).strip() if m else speakable(content)
            line = f"{role.name}在等你批准 {what}{tail(op)}"
            say = f"{role.name}在等你批准{what}。"
        else:   # 做完、会话关掉：不进网页（大厅刷屏修复）
            line, say = None, ""
        self.log(f"[event] {bot.name}（{role.name}）{kind}" + (f"：{line}" if line else "：清掉表盘停住的状态"))
        if self.on_notice is not None:
            try:
                # notify：出错、等批准要叫我（手机弹通知，rh/hub.py「手机通知」）；做完、会话关掉没有网页消息，也不叫
                self.on_notice(role.id, project, state, line, notify=kind in ("error", "permission"))
            except Exception as e:
                self.log(f"[event] 事件没推到网页 / 表盘：{e!r}")
        if kind == "closed":
            return "cleared"
        if not speak:
            return "listed"
        return self._enqueue(bot, role, say, what="事件")

    def role_idle(self, role: str) -> None:
        """表盘读到这个角色忙变闲（rh/dial.py refresh_busy）：这一轮结束了。她名下这一轮没出过错的 project 算正常结束
        （含静默回复 NO_REPLY，没有 message.sent），清掉「出错已报」和「上下文太长在重跑」的记号，下一次出错照报；
        这一轮出过错的不清，一轮接一轮都失败只报第一条（2026-10-20 大厅刷屏修复）。表盘红圈由 rh/dial.py 自己清。"""
        with self._mu:
            now = self._round.get(role, 0)
            for p in [b.project for b in self.by_project.values() if b.role == role]:
                if self._err_round.get(p) != now:
                    self._errored.discard(p)
                    self._too_long.discard(p)
            self._round[role] = now + 1

    # ---------- 主人的话进 Discord ----------
    def bots_for(self, role_ids: list[str]) -> list[DiscordBot]:
        """这些角色里映射了 Discord bot 的（relay 开着才算）。"""
        if not (self.relay and (self.webhook or self.api is not None)):
            return []
        return [self.by_role[r] for r in role_ids if r in self.by_role]

    async def relay_user(self, text: str, bots: list[DiscordBot]) -> bool:
        """把主人对板子说的一句以 webhook 身份发进 Discord，@ 这几个 bot；发成了记下这条消息的 ID 等她们回。
        发到哪个频道由 Router 按意思选（没配就是默认频道）；那个频道还没有主机的 webhook 就建一个。不记 URL（里面有 token）。
        Host 用 run_coroutine_threadsafe 调：出什么错都在这里记日志（不然被 future 吞掉），日志里抹掉 webhook 地址。"""
        try:
            return await self._relay_user(text, bots)
        except Exception as e:
            self.log(f"[discord] 替主人发进 Discord 出错（{type(e).__name__}: {route.scrub(str(e))}），这句没发出去：{text}")
            return False

    async def _relay_user(self, text: str, bots: list[DiscordBot]) -> bool:
        who = "、".join(b.name for b in bots)
        dest, where = await self._dest(text, [b.bot_id for b in bots])
        url = await self._webhook_for(dest)
        if not url:
            self.log(f"[discord] {where}没有能用的 webhook（没配 bot token 或建 webhook 失败），这句没发出去：{text}")
            return False
        body = {"content": relay_content([b.bot_id for b in bots], text), "username": self.settings.username,
                "allowed_mentions": {"parse": [], "users": [b.bot_id for b in bots]}}
        mid = ""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=RELAY_TIMEOUT)) as s:
                # wait=true：Discord 回这条消息（含 ID），钩子按它精确对账（审查建议 1）
                async with s.post(url, params={"wait": "true"}, json=body) as r:
                    if r.status // 100 != 2:
                        self.log(f"[discord] 替主人发进 Discord 失败（HTTP {r.status}），这句没发出去：{text}")
                        return False
                    try:
                        mid = str((await r.json(content_type=None) or {}).get("id", "") or "")
                    except (ValueError, AttributeError, aiohttp.ClientError):
                        mid = ""
        except Exception as e:   # 连不上、超时、地址不对：只记一笔（错误文字里若带地址，抹掉，地址里有 token）
            why = route.scrub(f"{type(e).__name__}: {e}".replace(url, "<webhook>"))
            self.log(f"[discord] 替主人发进 Discord 失败（{why}），这句没发出去：{text}")
            return False
        now = time.time()
        with self._mu:
            self._prune(now)
            if not mid:
                self._noid += 1
            self._pending[mid or f"noid:{self._noid}"] = {"bots": {b.bot_id for b in bots}, "channel": dest, "at": now}
        self.log(f"[discord] 替主人发进 Discord {where}（消息 {mid or '没拿到 ID'}），@{who}，等她回：{text}")
        return True

    def _prune(self, now: float) -> None:
        for k in [k for k, p in self._pending.items() if now - p["at"] > PENDING_KEEP]:
            del self._pending[k]

    def waiting(self) -> set[tuple[str, str]]:
        """还在等回的 (bot ID, 频道 ID)（测试、排查用）。"""
        with self._mu:
            return {(b, p["channel"]) for p in self._pending.values() for b in p["bots"]}

    async def _dest(self, text: str, bot_ids: list[str] | tuple = ()) -> tuple[str, str]:
        """这句发到哪个频道 → (频道 ID, 日志里怎么写)。小模型按意思选（审稿第 1 条）；没配、出错 → 默认频道。
        选了「新建」且 [discord] create_channels 开着 → 在服务器建文字频道（名字从这句话里取），这次发进去；
        之后的话照常按意思选，不粘在新频道（审稿第 2 条）。候选不含排除的频道和被叫到的 bot 看不到、不能发言的频道。"""
        if self.router is None or self.channels is None:
            return self.channel, "默认频道"
        loop = asyncio.get_running_loop()
        t0 = time.monotonic()
        try:
            chans = await self.channels.get(bot_ids)
        except Exception as e:
            self.log(f"[discord] 列频道失败（{type(e).__name__}: {e}），这句进默认频道")
            return self.channel, "默认频道"
        pick, why = await loop.run_in_executor(None, self.router.choose, text, chans, self.channel)
        ms = (time.monotonic() - t0) * 1000
        names = {c["id"]: c["name"] for c in chans}
        if pick == route.NEW:
            if not (self.settings.create_channels and self.api is not None):
                self.log(f"[discord] 选频道：新建（{why}，{ms:.0f}ms），但没开 create_channels，进默认频道")
                return self.channel, "默认频道"
            name = await loop.run_in_executor(None, self.router.name, text)
            if self._make_lock is None:
                self._make_lock = asyncio.Lock()
            async with self._make_lock:   # 同一时刻只建一个；排在后面的会在刷新后的列表里找到前一个建的
                # 先强制刷新一次频道列表，按名字找同名的：有就用（语音重复触发、上次建频道超时其实建成了，审查建议 5）
                try:
                    fresh = await self.channels.get(bot_ids, refresh=True)
                except Exception as e:
                    self.log(f"[discord] 新建频道前列频道失败（{type(e).__name__}: {e}），这句进默认频道")
                    return self.channel, "默认频道"
                same = next((c for c in fresh if route.clean_name(c["name"]) == name), None)
                if same is not None:
                    self.log(f"[discord] 选频道：新建（{why}，{ms:.0f}ms），已有同名频道 #{same['name']}（{same['id']}），直接用")
                    return same["id"], f"#{same['name']}"
                try:
                    c = await self.api.create_channel(self.settings.guild, name)
                except Exception as e:
                    self.log(f"[discord] 新建频道 #{name} 失败（{type(e).__name__}: {e}），这句进默认频道")
                    return self.channel, "默认频道"
                self.channels.add(c)
            self.log(f"[discord] 选频道：新建（{why}，{ms:.0f}ms），建好 #{c['name']}（{c['id']}）")
            return c["id"], f"新频道 #{c['name']}"
        if pick == route.DEFAULT or pick == self.channel:
            self.log(f"[discord] 选频道：默认（{why}，{ms:.0f}ms）")
            return self.channel, "默认频道"
        self.log(f"[discord] 选频道：#{names.get(pick, pick)}（{why}，{ms:.0f}ms）")
        return pick, f"#{names.get(pick, pick)}"

    async def selfcheck(self) -> tuple[list[str], list[str]]:
        """启动自检：核 bot token、默认频道、默认频道 webhook 是不是这个频道的（审计：配错时不报错，第一句话才失败）。
        → (配错了的, 没核成的)。配错 = Discord 明确回了 401/403/404 或对不上；没核成 = 连不上、超时、429、5xx（不当配错）。
        只读，不发消息。"""
        bad: list[str] = []
        warn: list[str] = []
        st = self.settings

        def unsure(what: str, e: Exception) -> None:
            warn.append(f"{what}没核成（{type(e).__name__}: {route.scrub(str(e))}），先照常启动")

        def config_error(e: Exception) -> bool:
            """Discord 明确说配错了才算（401 token 不对、403 没权限、404 没这个东西）；429 限流、5xx 只警告。"""
            return isinstance(e, route.DiscordHTTPError) and e.status in (401, 403, 404)

        async def get(coro):
            try:
                return await coro, None
            except Exception as e:
                return None, e

        # 三项一起查（Discord 慢或不通时只等一次超时，不串行累加）
        probe = self.api or route.DiscordAPI(st.api, "", RELAY_TIMEOUT)
        jobs = [get(self.api.me()) if self.api is not None else get(asyncio.sleep(0)),
                get(self.api.channel(self.channel)) if self.api is not None and self.channel else get(asyncio.sleep(0)),
                get(probe.webhook_info(self.webhook)) if self.webhook else get(asyncio.sleep(0))]
        (me, e_me), (ch, e_ch), (w, e_w) = await asyncio.gather(*jobs)
        token_bad = False
        if self.api is not None:
            if e_me is not None and config_error(e_me):
                token_bad = True
                bad.append(f"bot token（{st.token_env}）Discord 不认（HTTP {e_me.status}）：到 Discord 开发者后台 Bot 页"
                           f" Reset Token，把新的写进 .env 的 {st.token_env}")
            elif e_me is not None:
                unsure("bot token ", e_me)
            if self.channel and not token_bad:   # token 错时频道必然也查不到，不重复报
                if e_ch is not None and config_error(e_ch):
                    bad.append(f"默认频道 [discord] channel = {self.channel}：bot {(me or {}).get('username', '')} 看不到这个频道"
                               f"（HTTP {e_ch.status}）。在 Discord 里右键频道「复制频道 ID」重填，或者给 bot 这个频道的查看权限")
                elif e_ch is not None:
                    if e_me is None:   # token 那项也没核成时多半同一个原因（不通、限流），只报一次
                        unsure("默认频道", e_ch)
                elif st.guild and str(ch.get("guild_id", "")) != st.guild:
                    bad.append(f"默认频道 {self.channel} 不在 [discord] guild = {st.guild} 这个服务器里"
                               f"（在 {ch.get('guild_id')}）：右键服务器图标「复制服务器 ID」重填 guild")
        if self.webhook:
            if e_w is not None and config_error(e_w):
                bad.append(f"默认频道的 webhook（{st.webhook_env}）Discord 不认（HTTP {e_w.status}）：在频道设置「整合 → Webhook」"
                           f"里新建一个，把地址重填进 .env 的 {st.webhook_env}；或者删掉这一项，让主机用 bot token 自己建")
            elif e_w is not None:
                unsure("默认频道的 webhook ", e_w)
            elif self.channel and str(w.get("channel_id", "")) != self.channel:
                bad.append(f"{st.webhook_env} 这个 webhook 属于频道 {w.get('channel_id')}，不是默认频道 {self.channel}："
                           f"板子的话会发错地方。改 [discord] channel，或者在默认频道里重建 webhook")
        return bad, warn

    def warm(self) -> None:
        """开机预热选频道模型（后台线程，不挡启动）；没开自动选频道或没配模型什么都不做。"""
        if self.router is not None:
            threading.Thread(target=self.router.warm, args=(self.log,), daemon=True).start()

    def _lock(self) -> asyncio.Lock:
        if self._hook_lock is None:
            self._hook_lock = asyncio.Lock()
        return self._hook_lock

    async def _webhook_for(self, channel: str) -> str:
        """这个频道发消息用的 webhook 地址：默认频道用配好的（webhook_env）；否则用主机建过的；都没有就建一个
        （名字 = username），存进 webhooks_file，ID 追加进 allow_bots_file。"""
        if channel == self.channel and self.webhook:
            return self.webhook
        if url := self.store.url(channel):
            return url
        if self.api is None:
            return ""
        async with self._lock():
            if url := self.store.url(channel):
                return url
            try:
                wid, url = await self.api.create_webhook(channel, self.settings.username)
            except Exception as e:
                self.log(f"[discord] 给频道 {channel} 建 webhook 失败（{type(e).__name__}: {route.scrub(str(e))}）")
                return ""
            try:   # 先进放行名单再存（审查建议 3）：放行名单写不进去就不用这个 webhook，cc-connect 会丢它的消息
                self.store.add(channel, wid, url)
            except OSError as e:
                self.log(f"[discord] 给频道 {channel} 建了 webhook {wid}，但放行名单或存储写不进去"
                         f"（{type(e).__name__}: {route.scrub(str(e))}），这次不用它")
                return ""
            self.log(f"[discord] 给频道 {channel} 建了 webhook {wid}"
                     + (f"，已加进放行名单 {self.settings.allow_bots_file}" if self.settings.allow_bots_file else
                        "（没配 allow_bots_file：cc-connect 那边要手动放行这个 ID）"))
            return url

    def on_sent(self, event: str, project: str, session_key: str, content: str,
                triggers: list[str] | None = None) -> str:
        """钩子送来 bot 发了一条。triggers = 触发这一轮的消息 ID（maomao 分支 cc-connect 的 extra.trigger_message_ids）：
        - 带了：里面有主机替主人发的那条、而且在等这个 bot → 念；否则不念（精确对账）。
        - 没带（旧 cc-connect）：她在「替主人问过她」的频道里、PENDING_TTL 之内最早的那条等待 → 念。
        频道从 session_key 取（discord:<频道> 或 discord:<频道>:<用户>）。
        返回 ignored / other_channel / unmapped / not_waiting，或 submit 的结果。"""
        if event != "message.sent":
            return "ignored"
        bot = self.by_project.get(project)
        channel = channel_of(session_key)
        now = time.time()
        with self._mu:
            self._prune(now)
            known = bool(channel) and (channel == self.channel or any(p["channel"] == channel
                                                                      for p in self._pending.values()))
        if not known:
            return "other_channel"   # 板子没往这个频道说过话：和板子无关，不记（太多）
        if bot is None:
            self.log(f"[discord] 钩子：project {project or '?'} 没映射到 bot，不念（{len(content)} 字）")
            return "unmapped"
        with self._mu:
            if triggers:
                key = next((t for t in triggers if bot.bot_id in self._pending.get(t, {}).get("bots", ())), None)
                how = "按消息 ID"
            else:
                key = min((k for k, p in self._pending.items() if p["channel"] == channel and bot.bot_id in p["bots"]
                           and now - p["at"] <= PENDING_TTL), key=lambda k: self._pending[k]["at"], default=None)
                how = "钩子没带消息 ID，按频道"
            if key is not None:
                p = self._pending[key]
                p["bots"].discard(bot.bot_id)
                if not p["bots"]:
                    del self._pending[key]
        if key is None:
            self.log(f"[discord] 钩子：{bot.name} 在频道里发了一条，但不是回板子那句的（{how}对不上），不念（{len(content)} 字）")
            return "not_waiting"
        self.log(f"[discord] 钩子：{bot.name} 回板子了（{how}对上，问出去 {now - p['at']:.0f} 秒）")
        return self.submit(bot.bot_id, content, source="hook")

    def submit(self, bot_id: str, text: str, truncated: bool = False, source: str = "gate") -> str:
        """一句 bot 回应板子主人的话。source：哪条路送来的（gate = /rh/discord/say，hook = /rh/discord/hook）。
        返回 unmapped / empty / dup / off / no_board / queued（日志里同样写一行）。"""
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
        with self._mu:
            # 同一条回复两条路都会送来（gate 那条可能晚到很久：它要等主人下次在频道发话），按 (bot, 文字结尾) 去重：
            # 另一条路已送来同一条就不念第二遍；同一条路连着两次同样的话（她真说了两遍）照念。
            prev = self._last.get(bot_id)
            if prev is not None and prev[0] != source and prev[1] == say[-DEDUP_CHARS:]:
                self.log(f"[discord] {bot.name} 的这条回应 {prev[0]} 那条路已送来过，不念第二遍：{head}")
                return "dup"
            self._last[bot_id] = (source, say[-DEDUP_CHARS:])
        return self._enqueue(bot, role, say)

    def _enqueue(self, bot: DiscordBot, role: Role, say: str, what: str = "回应") -> str:
        """排进念的队列（回应和事件共用，what 只用于日志）：播放开关关着只记日志，板子不在线不念。不碰回应的去重记录。
        闭麦不挡（闭麦 = 不收音；暂停 / 闭麦那一刻正在念的和排队的由 stop() 停下，见 docs/DISCORD_BODY.md）。"""
        head = say[:40].replace("\n", " ")
        if not self.play:
            self.log(f"[discord] 收到 {bot.name}（{role.name}）的{what} {len(say)} 字，真板播放开关关着，只记日志：{head}")
            return "off"
        if not self.boards.online(role.id):
            self.log(f"[discord] 收到 {bot.name}（{role.name}）的{what}，但 {role.name} 的板子不在线，不念（这条路不用 Mac 喇叭）")
            return "no_board"
        with self._mu:
            self._q.put((self._gen, bot, role, say))
        self.log(f"[discord] {bot.name}（{role.name}）的{what} {len(say)} 字排队，在 {role.name} 的板子上念：{head}")
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
                if gen != self._gen:
                    continue
                # 念摘要，不念全文（用户「文字版是一个，但是你给我朗读出来的又是另一个」）；频道里的文字不动
                t0 = time.monotonic()
                say, how = self.summarizer.brief(text)
                if how not in ("short", "full"):
                    self.log(f"[discord] {bot.name} 的回应 {len(text)} 字，念"
                             f"{'摘要' if how == 'summary' else '第一句（' + how.removeprefix('first:') + '）'}"
                             f" {len(say)} 字（{(time.monotonic() - t0) * 1000:.0f}ms）：{say[:40]}")
                self._speak(gen, bot, role, say)
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


def build(cfg, env: dict[str, str], boards, synth, lock: SpeakingLock, on_event=None,
          log: Callable[[str], None] = lambda s: print(s, flush=True), grace: float = RECEIPT_GRACE) -> DiscordBody:
    """按 roles.toml [discord] 搭 DiscordBody。env = 环境变量 + 仓库 .env（host.main 拼好）。
    没配的项退回现状：没开 auto_channel（不写时看有没有配 [discord.router] 模型）/ 没 guild / 没 token → 只进默认频道；
    开了但没配模型 → 按频道名/别名读音匹配；没 summary → 念全文；没 create_channels → 不建频道。"""
    st: DiscordSettings = cfg.discord
    webhook = env.get(st.webhook_env, "") if st.webhook_env else ""
    token = env.get(st.token_env, "") if st.token_env else ""
    if not token and st.token_env and st.token_file:
        from .host import read_dotenv   # 放函数里：host 导入本模块
        token = read_dotenv(Path(st.token_file)).get(st.token_env, "")
    api = route.DiscordAPI(st.api, token, RELAY_TIMEOUT) if token else None
    if cfg.discord_relay and not (webhook or api is not None):
        raise SystemExit(f"roles.toml [discord] relay = true 要有默认频道 webhook（{st.webhook_env}）或 bot token"
                         f"（{st.token_env}），环境变量或仓库根目录 .env")
    router = None
    if st.router_note:
        log(f"[discord] {st.router_note}")
    if st.auto and st.guild and api is not None:
        # 选频道的后端（[discord.router] backend）：llm 或 jev；没配 url = 只按频道名/别名的读音匹配（rh/discord_route.py）
        llm = jev = None
        if st.router.url and st.router_backend == "jev":
            jev = route.JevClient(st.router, route.read_key(env, st.router), st.router_endpoint, route.ROUTER_TIMEOUT)
        elif st.router.url:
            llm = route.ChatLLM(st.router, route.read_key(env, st.router), route.ROUTER_TIMEOUT)
        router = route.Router(llm, jev, route.NameMatcher(st.channel_aliases))
    elif st.auto and (st.auto_channel or st.router.url):   # 只配了 guild（读音匹配是默认开的）没 token 时不啰嗦
        log(f"[discord] 开了自动选频道，但没配 guild 或没有 bot token（{st.token_env}）：列不了频道，只进默认频道")
    llm = route.ChatLLM(st.summary, route.read_key(env, st.summary), route.SUMMARY_TIMEOUT) if st.summary.url else None
    body = DiscordBody(cfg.discord_bots, cfg.roles, boards, synth, lock, play=cfg.discord_play, log=log,
                       on_event=on_event, grace=grace, relay=cfg.discord_relay, webhook=webhook,
                       channel=cfg.discord_channel, settings=st, api=api, router=router,
                       summarizer=route.Summarizer(llm, st.summary_chars, speakable))
    log(f"[discord] 选频道={router.backend if router else '只进默认频道'}"
        f"  新建频道={'开' if router and st.create_channels else '关'}"
        f"  朗读={'摘要 ' + st.summary.model if llm else '念全文'}")
    return body
