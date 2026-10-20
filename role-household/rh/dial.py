"""圆屏板子上的角色表盘：主机告诉板子「你是谁、现在在干什么」，并按板子屏幕大小给头像图。

用户 2026-10-19：「那个圆形表盘的那个动画啊，你给它放上去，而不是用现在默认傻逼小智的那个啊」。
板子固件（~/code/role-household-fw/xiaozhi-esp32 分支 rh，CONFIG_RH_DIAL，main/display/rh_dial_display.cc）照网页表盘页
（rh/static/dial.html）用 LVGL 自己画表盘、自己跑动画，盖住小智默认的表情、字幕和状态栏；固件里不写死任何角色。
哪块板子显示哪个角色只看 roles.toml 的 [[xiaozhi.boards]] 绑定（审稿 ~/.claude/reviews/rh-board-dial.md：外壳是可换的躯体）。

    主机 -> 板子（小智 WebSocket 上的一条 JSON，板子连上时发全量，之后状态变了再发）：
    {"type": "rh_dial", "role": "ju", "name": "橘", "color": "#f0a020", "live": true, "state": "idle",
     "avatar": "http://<主机>:8791/xiaozhi/dial/ju.rgb565", "avatar_think": "http://<主机>:8791/xiaozhi/dial/ju-thinking.rgb565"}
    state：idle / thinking / speaking / interrupted，判定同网页 rh/static/rh-client.js roleStates()。
    板子 GET 头像地址并加 ?size=<画布边长>，主机回 size×size 的 RGB565 小端裸像素（板子不用解码 JPEG）。
    画布边长 = 屏幕短边（conest firmware/dial DialMetrics::canvas()）：长方屏也要正方图，头像放在画布上，
    长边多出来的边带由板子填背景色（设计 ~/code/ref-conest/design-dial-abstraction.md 5.1、11.1）。

    工作状态（conest DECOR.md 3，板子名牌里的「· 工作中 / · 空闲中」）：
    {"type": "rh_dial", "role": "ju", "conest_status": {"busy": true}}
    来源是 ~/im-bridge/team/<project>.json 的 sessions[].busy（任一会话忙就算忙，同 conest PR #118），
    角色对应看 roles.toml [[discord.bots]] 的 project（一个角色绑几个 project 时任一忙就算忙）。
    文件读不到、过期（updated 超过 TEAM_STALE_SEC）时是「未知」：推 {"conest_status": {"busy": null}}，板子隐藏工作状态，不猜。

网页圆屏（conest prototypes/device-ui 的外部状态输入，conest Issue #90）：GET /rh/dial/events 是 SSE，
先给每个角色一条全量（头像是浏览器能直接显示的原图 /xiaozhi/dial/<角色>.jpg），之后谁的状态变了推谁；
开始说时带 emotion（同板子收到的 llm 表情 rh/xiaozhi.py SPEAK_EMOTION）。用户 2026-10-19
「https://github.com/Zssan12/conest 下面有一个device ui，你可以把动画还有表情都给它接到上面去」。
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

from aiohttp import web

from .config import DiscordBot, Role
from .meeting import Message
from .xiaozhi import SPEAK_EMOTION, XiaozhiServer, find_ffmpeg

MSG_TYPE = "rh_dial"
IMAGE_PATH = "/xiaozhi/dial/"
# 表盘颜色。来源：rh/static/dial.html 的 DIALS（网页表盘同一套颜色）；不在里面的角色用网页同一个默认灰。
COLORS = {"ju": "#f0a020", "jing": "#4aa8ff", "mao": "#c67bff", "long": "#b7c4e6"}
DEFAULT_COLOR = "#9aa0a6"
# 被打断的红圈亮多久（秒）。来源：rh/static/rh-client.js INTERRUPTED_MS = 2500。
INTERRUPTED_SEC = 2.5
# 板子能要的最大头像边长（像素），超出回 400。来源：表盘第二步独立代码审查（2026-10-20，第 5 条：466 挡住更大的屏、
# 放开到合理上限）；1024 = conest firmware/dial 单测扫的屏幕上限（tests/test_dial_metrics.cc TestSmallScreens/TestFontSizes 16..1024）。
# 仍要有上限：防止乱传 size 让 ffmpeg 生成超大图（1024×1024 RGB565 = 2 MB）。
MAX_SIZE = 1024
MIN_SIZE = 16
# 队友状态文件目录（每个 cc-connect project 一个 <project>.json，sessions[].busy）。来源：用户派活原话里给的路径。
TEAM_DIR = Path.home() / "im-bridge" / "team"
# 多久读一次队友状态文件（秒）。来源：实现者定：3 个几百字节的小文件，读一次不到 1 毫秒；2 秒内板子跟上忙闲变化。
BUSY_POLL_SEC = 2.0
# 队友状态文件多久没重写算过期（秒）：写的进程没了，忙闲按未知。来源：conest bridge/core/team.go:25-27 的约定——
# cc-connect 每 2 秒查一次（teamPollInterval）、内容没变也每 20 秒重写一次（teamHeartbeat），
# 读的一方 teamStaleAfter = 1 分钟没重写就当进程没了（team.go:210 now.Sub(f.Updated) > teamStaleAfter）。
TEAM_STALE_SEC = 60.0
EVENTS_PATH = "/rh/dial/events"
# SSE 空闲时多久发一行注释保活（秒）。来源：和 rh/xiaozhi.py KEEPALIVE_SEC 同值。
SSE_KEEPALIVE = 30.0


class RoleStates:
    """每个角色现在的表盘状态。规则同网页 roleStates()：被打断（2.5 秒内）> 正在说 > 思考中 > 待机；
    有人在说时，思考中不显示（网页是有人在说就直接返回）。线程安全（meeting 线程写，事件循环读）。"""

    def __init__(self, roles: list[str], clock: Callable[[], float] = time.monotonic):
        self.roles, self.clock = list(roles), clock
        self.thinking: str | None = None
        self.speaking: str | None = None
        self.interrupted_until: dict[str, float] = {}
        # Discord 里这个角色的 bot 出了事、等批准（事件通道，rh/discord_body.py on_agent_event）：停在一个现有状态。
        # 只用现有的 interrupted / thinking，不新设计状态种类（派活要求）。按 cc-connect project 分开记（一个角色可绑几个
        # project；permission.requested 不带 session_key，分不到会话），表盘取最严重的（出错 > 等批准，代码审查裁决 2）。
        # 角色 -> {project: (状态, 记下的时刻)}
        self.held: dict[str, dict[str, tuple[str, float]]] = {}
        # 角色 -> 上一次从忙变闲的时刻（队友状态文件，read_busy）。不用「看到忙」的时刻：轮询要晚几秒才看到忙，
        # 这一轮开头就到的出错会被当成上一轮的（复审 2026-10-20）。
        self.idle_since: dict[str, float] = {}
        self._mu = threading.Lock()

    def think(self, role: str | None) -> None:
        with self._mu:
            self.thinking = role

    def hold(self, role: str, project: str, state: str | None) -> None:
        """事件通道：role 的 project 停在 state（interrupted / thinking），None = 清掉这个 project 的。"""
        if role not in self.roles:
            return
        with self._mu:
            if state is None:
                self.held.get(role, {}).pop(project, None)
            else:
                self.held.setdefault(role, {})[project] = (state, self.clock())

    def went_idle(self, role: str) -> None:
        """队友状态文件里这个角色从忙变闲（这一轮结束，含静默结束 NO_REPLY、出错后没有 message.sent，代码审查裁决 1）：
        等批准一定不再等了，清掉；出错只清上一次忙变闲之前记下的（上一轮留下的）——出错本身会让这一轮结束，这时就清，
        红圈只亮两秒（一次队友状态轮询），人不在电脑前看不到；留到下一轮结束再清。"""
        with self._mu:
            now = self.clock()
            since = self.idle_since.get(role, float("-inf"))
            held = self.held.get(role, {})
            for p in [p for p, (st, at) in held.items() if st == "thinking" or at < since]:
                del held[p]
            self.idle_since[role] = now

    def event(self, event: str, msg: Message) -> None:
        if msg.author not in self.roles:
            return
        with self._mu:
            if event == "start":
                self.speaking = msg.author
            elif event == "end":
                if self.speaking == msg.author:
                    self.speaking = None
                if msg.status == "interrupted":
                    self.interrupted_until[msg.author] = self.clock() + INTERRUPTED_SEC

    def states(self) -> dict[str, str]:
        now = self.clock()
        with self._mu:
            out = {r: "idle" for r in self.roles}
            for r in self.roles:
                if self.interrupted_until.get(r, 0) > now:
                    out[r] = "interrupted"
                elif self.held.get(r):
                    kinds = {st for st, _ in self.held[r].values()}
                    out[r] = "interrupted" if "interrupted" in kinds else "thinking"
            if self.speaking in out:
                out[self.speaking] = "speaking"
                return out
            if self.thinking in out and out[self.thinking] == "idle":
                out[self.thinking] = "thinking"
            return out


def canvas_side(display: dict | None) -> int | None:
    """板子 hello 里 display 的画布边长（短边，同 conest DialMetrics::canvas()）；没有或不像样时 None。"""
    if not isinstance(display, dict):
        return None
    w, h = display.get("w"), display.get("h")
    if not (isinstance(w, int) and isinstance(h, int)) or w <= 0 or h <= 0:
        return None
    return min(w, h)


def _updated_at(v) -> float | None:
    """team 文件的 updated（Go time.Time 的 JSON：RFC 3339，小数秒最多 9 位，可能是 Z）转 Unix 秒；不像样时 None。"""
    if not isinstance(v, str):
        return None
    m = re.fullmatch(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)", v)
    if m is None:
        return None
    try:   # Python 只认 6 位小数：截到微秒
        t = datetime.fromisoformat(m[1] + (f".{m[2][:6].ljust(6, '0')}" if m[2] else "") + ("+00:00" if m[3] == "Z" else m[3]))
    except ValueError:
        return None
    return t.timestamp()


def _project_busy(path: Path, now: float) -> bool | None:
    """一个 project 的队友状态文件：任一会话 busy 为 True；"sessions": null（没有会话）为 False；
    文件不在、读不了、不是 JSON、没有 sessions 键或不是列表、updated 缺失或超过 TEAM_STALE_SEC 没重写的为 None（未知）。"""
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(d, dict) or "sessions" not in d:
        return None
    at = _updated_at(d.get("updated"))
    if at is None or now - at > TEAM_STALE_SEC:
        return None
    sessions = d["sessions"]
    if sessions is None:   # 实测（2026-10-20 ~/im-bridge/team/maomao.json）：没有会话时写的是 "sessions": null，即空闲
        sessions = []
    if not isinstance(sessions, list):
        return None
    return any(isinstance(x, dict) and x.get("busy") is True for x in sessions)


def read_busy(team_dir: Path, projects: dict[str, str], now: float | None = None) -> dict[str, bool]:
    """project -> 角色 的映射下，读每个 project 的队友状态文件，按角色合起来：
    一个角色绑的 project 里任一忙就算忙；都读得到且都空闲才算空闲；其余（有读不到或过期的、又没有忙的）
    这个角色不出现在结果里（未知，不当空闲）。now：Unix 秒，默认现在。"""
    now = time.time() if now is None else now
    per_role: dict[str, list[bool | None]] = {}
    for proj, role in projects.items():
        per_role.setdefault(role, []).append(_project_busy(Path(team_dir) / f"{proj}.json", now))
    out: dict[str, bool] = {}
    for role, vals in per_role.items():
        if any(v is True for v in vals):
            out[role] = True
        elif all(v is False for v in vals):
            out[role] = False
    return out


class Dial:
    """接在 XiaozhiServer 上：板子连上发全量，角色状态变了发给该角色的板子；提供 /xiaozhi/dial/ 头像图。
    think / event 在 meeting 线程里调（Host._on_think / _on_event 转过来）。"""

    def __init__(self, server: XiaozhiServer, roles: list[Role], config_dir: Path,
                 log: Callable[[str], None] = lambda s: print(s, flush=True), clock: Callable[[], float] = time.monotonic,
                 bots: list[DiscordBot] = (), team_dir: Path = TEAM_DIR, busy_poll: float | None = BUSY_POLL_SEC):
        self.server, self.config_dir, self.log = server, Path(config_dir), log
        self.roles = {r.id: r for r in roles}
        self.st = RoleStates(list(self.roles), clock)
        self._sent: dict[str, str] = {}      # 角色 -> 上次发给板子的状态
        self._base: dict[str, str] = {}      # 角色 -> 板子连进来用的主机地址 http://ip:port
        self._mu = threading.Lock()
        # 文件 -> (文件修改时间, 边长, 像素)。每个文件只留最近一个边长：同一角色的板子屏幕大小固定，
        # 按 (文件, 边长) 缓存会让乱传的 size 把内存撑大；文件数就是角色数×2，有上限。
        self._images: dict[str, tuple[float, int, bytes]] = {}
        # 角色 -> ((待机图, mtime, 思考图, mtime), 两张是否相同)：比较结果按修改时间缓存，不在事件循环里每次读两张图。
        self._same: dict[str, tuple[tuple, bool]] = {}
        self._subs: set[asyncio.Queue] = set()   # 网页圆屏的 SSE 订阅（事件循环里用）
        self._sse_sent: dict[str, str] = {}      # 角色 -> 上次推给网页的状态
        # 工作状态：cc-connect project -> 角色（roles.toml [[discord.bots]]，只要绑了小家角色的）
        self.team_dir = Path(team_dir)
        self._projects = {b.project: b.role for b in bots if b.project and b.role in self.roles}   # 一个角色可绑几个 project
        self._busy: dict[str, bool] = {}        # 角色 -> 最近读到的忙闲（读不到的不在里面）
        self._busy_sent: dict[str, bool] = {}   # 角色 -> 上次发给板子的忙闲
        self._stop = threading.Event()
        self.on_idle: Callable[[str], None] | None = None   # 角色忙变闲时调（Host.run 接到 DiscordBody.role_idle）
        if self._projects:
            self.refresh_busy()
            if busy_poll:
                threading.Thread(target=self._busy_loop, args=(busy_poll,), name="dial-busy", daemon=True).start()
        server.routes.append(("GET", EVENTS_PATH, self._events))
        server.routes.append(("GET", IMAGE_PATH + "{name}", self._image))
        server.on_board = self._on_board
        server.on_notify = self._on_notify

    # ---------- 状态 ----------
    def think(self, role: str | None) -> None:
        self.st.think(role)
        self._push_changes()

    def hold(self, role: str, project: str, state: str | None) -> None:
        """事件通道（Host.agent_event 调）：出错停在红圈、等批准停在思考中，做完 / 会话关掉清掉这个 project 的（state=None）。"""
        self.st.hold(role, project, state)
        self._push_changes()

    def event(self, event: str, msg: Message) -> None:
        self.st.event(event, msg)
        self._push_changes()
        if event == "end" and msg.status == "interrupted":
            loop = self.server._loop
            if loop is not None and not loop.is_closed():   # 红圈 2.5 秒后回待机（网页同样到点重画）
                loop.call_soon_threadsafe(loop.call_later, INTERRUPTED_SEC + 0.05, self._push_changes)

    def _push_changes(self) -> None:
        # 算状态、记 _sent、排队推送都在锁里：meeting 线程和事件循环（红圈到期回调）会同时调，
        # 锁外算的话，先算出的旧状态可能后写进 _sent、后推给板子，板子就一直停在旧状态。
        # server.push 只是 call_soon_threadsafe，锁里调不会卡；推送按排队顺序发出。
        with self._mu:
            states = self.st.states()
            changed = {r: s for r, s in states.items() if r in self._base and self._sent.get(r) != s}
            self._sent.update(changed)
            for r, s in changed.items():
                self.server.push(r, {"type": MSG_TYPE, "role": r, "state": s})
            page = {r: s for r, s in states.items() if self._sse_sent.get(r, "idle") != s}
            self._sse_sent.update(page)
            loop = self.server._loop
            if page and self._subs and loop is not None and not loop.is_closed():
                for r, s in page.items():
                    m = {"type": MSG_TYPE, "role": r, "state": s, **({"emotion": SPEAK_EMOTION} if s == "speaking" else {})}
                    loop.call_soon_threadsafe(self._broadcast, m)
        for r, s in changed.items():
            self.log(f"[dial] {r} 的板子表盘 → {s}")

    # ---------- 工作状态（busy） ----------
    def _busy_loop(self, every: float) -> None:
        while not self._stop.wait(every):
            try:
                self.refresh_busy()
            except Exception as e:   # 读文件线程不能死：记一行，下一轮再读
                self.log(f"[dial] 读队友状态出错：{e!r}")

    def close(self) -> None:
        self._stop.set()

    def refresh_busy(self) -> None:
        """读一遍队友状态文件，忙闲变了的角色推给它的板子（只推 conest_status，不动别的字段）。
        从已知变成未知（文件没了、读不懂、过期）推 busy: null，板子隐藏工作状态。"""
        now = read_busy(self.team_dir, self._projects)
        with self._mu:   # 同 _push_changes：记 _busy_sent 和排队推送在锁里，顺序一致
            went_idle = [r for r, b in now.items() if b is False and self._busy.get(r) is True]
            self._busy = now
            changed = {r: now.get(r) for r in set(self._projects.values())
                       if r in self._base and self._busy_sent.get(r) != now.get(r)}
            for r, b in changed.items():
                if b is None:
                    self._busy_sent.pop(r, None)
                else:
                    self._busy_sent[r] = b
                self.server.push(r, {"type": MSG_TYPE, "role": r, "conest_status": {"busy": b}})
        for r, b in changed.items():
            self.log(f"[dial] {r} 的板子工作状态 → {'未知（隐藏）' if b is None else '工作中' if b else '空闲中'}")
        for r in went_idle:   # 事件通道：这一轮结束，清掉停住的状态，并告诉 Discord 那边（出错只报一次的记号清掉）
            self.st.went_idle(r)
            if self.on_idle is not None:
                try:
                    self.on_idle(r)
                except Exception as e:
                    self.log(f"[dial] 忙变闲没通知到事件通道：{e!r}")
        if went_idle:
            self._push_changes()

    def message(self, role: str, base: str) -> dict:
        """板子连上时发的全量：身份、颜色、头像地址、当前状态；读得到忙闲时带上工作状态。"""
        r = self.roles.get(role)
        m = {"type": MSG_TYPE, "role": role, "name": r.name if r else role, "color": COLORS.get(role, DEFAULT_COLOR),
             "live": True, "state": self.st.states().get(role, "idle"),
             "avatar": f"{base}{IMAGE_PATH}{role}.rgb565", "avatar_think": self._think_url(role, base)}
        if role in self._busy:
            m["conest_status"] = {"busy": self._busy[role]}
        return m

    def _think_url(self, role: str, base: str) -> str:
        """思考图和待机图是同一张（或没有思考图）时给同一个地址：板子就只下一张、不做整屏淡入淡出（省帧率）。"""
        a, t = self.picture(role), self.picture(role, thinking=True)
        same = a == t
        if not same and a is not None and t is not None:
            key = (str(a), a.stat().st_mtime_ns, str(t), t.stat().st_mtime_ns)
            hit = self._same.get(role)
            if hit is None or hit[0] != key:
                hit = (key, a.read_bytes() == t.read_bytes())   # 图改过才重读（头像图几十 KB）
                self._same[role] = hit
            same = hit[1]
        return f"{base}{IMAGE_PATH}{role}{'' if same else '-thinking'}.rgb565"

    # ---------- 网页圆屏（SSE） ----------
    def page_message(self, role: str, base: str, state: str) -> dict:
        r = self.roles.get(role)
        return {"type": MSG_TYPE, "role": role, "name": r.name if r else role, "color": COLORS.get(role, DEFAULT_COLOR),
                "state": state, "avatar": f"{base}{IMAGE_PATH}{role}.jpg", "avatar_think": f"{base}{IMAGE_PATH}{role}-thinking.jpg"}

    def _broadcast(self, m: dict) -> None:
        for q in list(self._subs):
            q.put_nowait(m)

    async def _events(self, req: web.Request) -> web.StreamResponse:
        resp = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                           "Access-Control-Allow-Origin": "*"})   # 网页圆屏在别的源（conest 预览页）
        await resp.prepare(req)
        base, q = f"http://{req.host}", asyncio.Queue()
        self._subs.add(q)
        me = asyncio.current_task()
        self.server._tasks.add(me)   # 主机退出时 XiaozhiServer.close 取消它，不让关服务等这条长连接

        self.log(f"[dial] 网页圆屏连上 {req.remote}")
        try:
            states = self.st.states()
            for r in self.roles:
                await self._sse(resp, self.page_message(r, base, states.get(r, "idle")))
            while True:
                try:
                    m = await asyncio.wait_for(q.get(), SSE_KEEPALIVE)
                except asyncio.TimeoutError:
                    await resp.write(b": keepalive\n\n")
                    continue
                await self._sse(resp, m)
        except (ConnectionResetError, ConnectionError):
            pass
        finally:
            self._subs.discard(q)
            self.server._tasks.discard(me)
            self.log(f"[dial] 网页圆屏断开 {req.remote}")
        return resp

    @staticmethod
    async def _sse(resp: web.StreamResponse, m: dict) -> None:
        await resp.write(("data: " + json.dumps(m, ensure_ascii=False) + "\n\n").encode())

    def _on_board(self, role: str, base: str) -> None:
        with self._mu:   # 同 _push_changes：全量里的状态和 _sent、推送顺序要一致
            m = self.message(role, base)
            self._base[role] = base
            self._sent[role] = m["state"]
            if "conest_status" in m:
                self._busy_sent[role] = m["conest_status"]["busy"]
            else:
                self._busy_sent.pop(role, None)
            self.server.push(role, m)
        self.log(f"[dial] 告诉 {role} 的板子：{m['name']}，{m['state']}，头像 {m['avatar']}")
        b = self.server.by_role.get(role)
        side = canvas_side(getattr(b, "display", None))
        if side is not None:   # 新固件：板子按画布边长（短边）要头像
            note = "" if MIN_SIZE <= side <= MAX_SIZE else f"，超出主机能给的 {MIN_SIZE}..{MAX_SIZE}，头像会要不到"
            self.log(f"[dial] {role} 的板子画布边长 {side}，头像按 {side}×{side} 给{note}")

    def _on_notify(self, role: str | None, payload: dict) -> None:
        """板子报表盘帧率（固件 rh_dial_display.cc ReportStats：每段状态结束或每 30 秒一条）。"""
        if payload.get("method") != "notifications/rh_dial_stats":
            return
        p = payload.get("params") or {}
        self.log(f"[dial] {role} 的板子帧率：{p.get('state')} {p.get('secs')} 秒，{p.get('fps')} 帧/秒，"
                 f"每帧绘制 {p.get('render_ms')} 毫秒，定时器 {p.get('timer_hz')} 次/秒，内部内存剩 {p.get('heap_internal')} 字节")

    # ---------- 头像图 ----------
    def picture(self, role: str, thinking: bool = False) -> Path | None:
        """表盘用的图：avatars/dial/<角色>[-thinking].jpg（网页表盘同一张）；没有思考图用待机图；都没有用 roles.toml 的头像。"""
        d = self.config_dir / "avatars" / "dial"
        for f in ([d / f"{role}-thinking.jpg"] if thinking else []) + [d / f"{role}.jpg"]:
            if f.is_file():
                return f
        r = self.roles.get(role)
        if r is not None and r.avatar and (self.config_dir / r.avatar).is_file():
            return self.config_dir / r.avatar
        return None

    def pixels(self, src: Path, size: int) -> bytes:
        """居中裁成方图再缩成 size×size（同网页 dial.html .face 的 object-fit:cover），
        转 RGB565 小端裸像素（LVGL LV_COLOR_FORMAT_RGB565）。按文件修改时间缓存，每个文件只留最近一个边长。"""
        key, mtime = str(src), src.stat().st_mtime
        hit = self._images.get(key)
        if hit is not None and hit[0] == mtime and hit[1] == size:
            return hit[2]
        vf = f"crop='min(iw,ih)':'min(iw,ih)',scale={size}:{size}:flags=lanczos"   # crop 不给 x/y 默认居中
        p = subprocess.run([find_ffmpeg(), "-loglevel", "error", "-i", str(src), "-frames:v", "1",
                            "-vf", vf, "-pix_fmt", "rgb565le", "-f", "rawvideo", "pipe:1"],
                           capture_output=True, check=True)
        if len(p.stdout) != size * size * 2:
            raise ValueError(f"ffmpeg 输出 {len(p.stdout)} 字节，应为 {size * size * 2}")
        self._images[key] = (mtime, size, p.stdout)
        return p.stdout

    async def _image(self, req: web.Request) -> web.StreamResponse:
        name = req.match_info["name"]
        if name.endswith(".jpg"):   # 网页圆屏：原图（浏览器自己缩放）
            stem = name[:-len(".jpg")]
            thinking = stem.endswith("-thinking")
            role = stem[:-len("-thinking")] if thinking else stem
            src = self.picture(role, thinking) if role in self.roles else None
            if src is None:
                raise web.HTTPNotFound()
            return web.FileResponse(src)
        if not name.endswith(".rgb565"):
            raise web.HTTPNotFound()
        stem = name[:-len(".rgb565")]
        thinking = stem.endswith("-thinking")
        role = stem[:-len("-thinking")] if thinking else stem
        try:
            size = int(req.query.get("size", "240"))
        except ValueError:
            raise web.HTTPBadRequest(text="size 要是整数")
        if not MIN_SIZE <= size <= MAX_SIZE:
            raise web.HTTPBadRequest(text=f"size 要在 {MIN_SIZE}..{MAX_SIZE}")
        if role not in self.roles:
            raise web.HTTPNotFound()
        src = self.picture(role, thinking)
        if src is None:
            raise web.HTTPNotFound()
        try:
            data = await asyncio.get_running_loop().run_in_executor(None, self.pixels, src, size)
        except (OSError, subprocess.CalledProcessError, ValueError) as e:
            self.log(f"[dial] {role} 的头像转不出来：{e!r}")
            raise web.HTTPInternalServerError()
        return web.Response(body=data, content_type="application/octet-stream")
