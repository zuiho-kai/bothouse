"""圆屏板子上的角色表盘：主机告诉板子「你是谁、现在在干什么」，并按板子屏幕大小给头像图。

用户 2026-10-19：「那个圆形表盘的那个动画啊，你给它放上去，而不是用现在默认傻逼小智的那个啊」。
板子固件（~/code/role-household-fw/xiaozhi-esp32 分支 rh，CONFIG_RH_DIAL，main/display/rh_dial_display.cc）照网页表盘页
（rh/static/dial.html）用 LVGL 自己画表盘、自己跑动画，盖住小智默认的表情、字幕和状态栏；固件里不写死任何角色。
哪块板子显示哪个角色只看 roles.toml 的 [[xiaozhi.boards]] 绑定（审稿 ~/.claude/reviews/rh-board-dial.md：外壳是可换的躯体）。

    主机 -> 板子（小智 WebSocket 上的一条 JSON，板子连上时发全量，之后状态变了再发）：
    {"type": "rh_dial", "role": "ju", "name": "橘", "color": "#f0a020", "live": true, "state": "idle",
     "avatar": "http://<主机>:8791/xiaozhi/dial/ju.rgb565", "avatar_think": "http://<主机>:8791/xiaozhi/dial/ju-thinking.rgb565"}
    state：idle / thinking / speaking / interrupted，判定同网页 rh/static/rh-client.js roleStates()。
    板子 GET 头像地址并加 ?size=<屏幕边长>，主机回 size×size 的 RGB565 小端裸像素（板子不用解码 JPEG）。
"""
from __future__ import annotations

import asyncio
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

from aiohttp import web

from .config import Role
from .meeting import Message
from .xiaozhi import XiaozhiServer, find_ffmpeg

MSG_TYPE = "rh_dial"
IMAGE_PATH = "/xiaozhi/dial/"
# 表盘颜色。来源：rh/static/dial.html 的 DIALS（网页表盘同一套颜色）；不在里面的角色用网页同一个默认灰。
COLORS = {"ju": "#f0a020", "jing": "#4aa8ff", "mao": "#c67bff", "long": "#b7c4e6"}
DEFAULT_COLOR = "#9aa0a6"
# 被打断的红圈亮多久（秒）。来源：rh/static/rh-client.js INTERRUPTED_MS = 2500。
INTERRUPTED_SEC = 2.5
# 板子能要的最大头像边长（像素）。来源：实现者定，防止乱传 size 让 ffmpeg 生成超大图；现有板子 240（GC9A01），网页表盘图 466。
MAX_SIZE = 466


class RoleStates:
    """每个角色现在的表盘状态。规则同网页 roleStates()：被打断（2.5 秒内）> 正在说 > 思考中 > 待机；
    有人在说时，思考中不显示（网页是有人在说就直接返回）。线程安全（meeting 线程写，事件循环读）。"""

    def __init__(self, roles: list[str], clock: Callable[[], float] = time.monotonic):
        self.roles, self.clock = list(roles), clock
        self.thinking: str | None = None
        self.speaking: str | None = None
        self.interrupted_until: dict[str, float] = {}
        self._mu = threading.Lock()

    def think(self, role: str | None) -> None:
        with self._mu:
            self.thinking = role

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
            if self.speaking in out:
                out[self.speaking] = "speaking"
                return out
            if self.thinking in out and out[self.thinking] == "idle":
                out[self.thinking] = "thinking"
            return out


class Dial:
    """接在 XiaozhiServer 上：板子连上发全量，角色状态变了发给该角色的板子；提供 /xiaozhi/dial/ 头像图。
    think / event 在 meeting 线程里调（Host._on_think / _on_event 转过来）。"""

    def __init__(self, server: XiaozhiServer, roles: list[Role], config_dir: Path,
                 log: Callable[[str], None] = lambda s: print(s, flush=True), clock: Callable[[], float] = time.monotonic):
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
        server.routes.append(("GET", IMAGE_PATH + "{name}", self._image))
        server.on_board = self._on_board
        server.on_notify = self._on_notify

    # ---------- 状态 ----------
    def think(self, role: str | None) -> None:
        self.st.think(role)
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
        for r, s in changed.items():
            self.log(f"[dial] {r} 的板子表盘 → {s}")

    def message(self, role: str, base: str) -> dict:
        """板子连上时发的全量：身份、颜色、头像地址、当前状态。"""
        r = self.roles.get(role)
        return {"type": MSG_TYPE, "role": role, "name": r.name if r else role, "color": COLORS.get(role, DEFAULT_COLOR),
                "live": True, "state": self.st.states().get(role, "idle"),
                "avatar": f"{base}{IMAGE_PATH}{role}.rgb565", "avatar_think": self._think_url(role, base)}

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

    def _on_board(self, role: str, base: str) -> None:
        with self._mu:   # 同 _push_changes：全量里的状态和 _sent、推送顺序要一致
            m = self.message(role, base)
            self._base[role] = base
            self._sent[role] = m["state"]
            self.server.push(role, m)
        self.log(f"[dial] 告诉 {role} 的板子：{m['name']}，{m['state']}，头像 {m['avatar']}")

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

    async def _image(self, req: web.Request) -> web.Response:
        name = req.match_info["name"]
        if not name.endswith(".rgb565"):
            raise web.HTTPNotFound()
        stem = name[:-len(".rgb565")]
        thinking = stem.endswith("-thinking")
        role = stem[:-len("-thinking")] if thinking else stem
        try:
            size = int(req.query.get("size", "240"))
        except ValueError:
            raise web.HTTPBadRequest(text="size 要是整数")
        if role not in self.roles or not 16 <= size <= MAX_SIZE:
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
