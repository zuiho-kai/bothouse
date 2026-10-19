"""云端频道服务（hub）：频道、消息、成员；HTTP 发消息 + WebSocket 实时推送（历史在连上时的 ready 帧里）；同一服务发网页。

数据模型参考 Campfire（github.com/basecamp/once-campfire，MIT）：rooms / messages，
成员分人和 bot（这里是角色），bot 用 HTTP 发消息。只参考结构，不照搬 Rails。

鉴权：一个共享 token（环境变量 RH_HUB_TOKEN）。HTTP 带 `Authorization: Bearer <token>`；
WebSocket 连上后第一帧发 hello 带 token（浏览器的 WebSocket 不能自定义请求头）。

    RH_HUB_TOKEN=... uv run python -m rh.hub [--host 0.0.0.0] [--port 8790] [--db data/hub.sqlite3]

WebSocket 协议（JSON 文本帧）：
    客户端 -> {"type":"hello","token":..., "kind":"web"|"host", "since": 消息id 或 null}
              网页连 /ws；主机连 /ws/host（握手要带 Authorization: Bearer 头，单帧上限大，用来推音频）
    服务端 -> {"type":"ready","room":{...},"members":[...],"messages":[...],"last_id": 频道最新消息 id}
              since 为 null 时给最近 HISTORY_LIMIT 条；否则给 id > since 的全部消息（角色主机补话题用）
    服务端 -> {"type":"message","message":{...}}   新消息或状态变化（同 id 覆盖）
    服务端 -> {"type":"members","members":[...]}

设备（每个角色的躯体，现在是网页虚拟头）：事件定义见 rh/device.py。hub 只做转发：
    网页   -> {"type":"device_hello","roles":[角色 id...]}   这个页面当这些角色的设备（用户点了“开声音”）
    主机   -> {"type":"device","event":"start"|"audio"|"stop",...}   start 时按角色挑设备并记住，后面同一 play_id 只发给它
    设备   -> {"type":"receipt","play_id":...,"result":...}          只认这次播放被发往的那个页面，转给主机
    服务端 -> 主机 {"type":"devices","roles":[有设备在线的角色]}（ready 帧里也带 devices）

闭麦（用户 2026-10-19「我没有一个闭麦按钮，或者我希望可以语音闭麦」）：开关存在库里（hub 重启不丢），
    网页按钮或主机（语音「闭麦」「开麦」）POST /api/mic {"on": bool}；hub 推给所有连接 {"type":"mic","on":...}，
    ready 帧里也带 mic。主机收到 on=false 就停掉正在说的、不再收音（只认「开麦」）。
板子音量（用户 2026-10-19「声音太小了，预期可以我通过语音让它调大，或者说我在这个网页端可以调大」）：
    主机 -> {"type":"volumes","volumes":{角色: 0-100}}（在线板子的音量），hub 记下推给网页（ready 帧里也带 volumes）；
    网页滑条 POST /api/volume {"role", "volume": 0-100}，hub 转给主机 {"type":"volume","role","volume"}，主机经 MCP 调板子。
思考中：主机 -> {"type":"thinking","role": 角色 id 或 null}，hub 记下并推给网页（ready 帧里也带 thinking）。
    角色可以不说话、叫了名字只有她回，网页不能再按轮流顺序猜谁在想。
一个角色有多个页面都开了声音时，用最早开的那个（同 conest：重复页面不接管正在播的）；它断了才轮到下一个。
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import sqlite3
import time
from collections import deque
from pathlib import Path

from aiohttp import WSCloseCode, WSMsgType, web

from .meeting import MAX_TEXT_CHARS, clean
from .voice import SAMPLE_RATE

STATIC = Path(__file__).resolve().parent / "static"
# 头像图片（表盘页 /dial 用 avatars/dial/ 下的 466×466 头肩特写）。部署时 deploy.sh 一起同步，镜像里在 /app/avatars。
AVATARS = Path(__file__).resolve().parent.parent / "avatars"
KINDS = {"user", "role", "system"}
STATUSES = {"user", "speaking", "done", "interrupted", "system"}
DEFAULT_STATUS = {"user": "user", "role": "speaking", "system": "system"}
DEFAULT_ROOM = "大厅"  # 启动时没有频道就建这一个。来源：实现者定（用户没要建频道的功能）。

# 网页连上时发最近多少条历史。来源：实现者定。
HISTORY_LIMIT = 200
# WebSocket 连上后多少秒内必须发 hello，否则断开。来源：实现者定。
HELLO_TIMEOUT = 10.0
# WebSocket 心跳间隔（秒），用来发现断掉的连接（角色主机掉线时及时把“在说”改成被打断）。来源：实现者定。
HEARTBEAT = 30.0
# 请求体上限：每字最多 4 字节 UTF-8，再留 1KB 给 JSON 外壳。来源：由 MAX_TEXT_CHARS 推出。
MAX_BODY = MAX_TEXT_CHARS * 4 + 1024
# 成员名字最长多少字。来源：实现者定。
MAX_NAME = 64
# 头像（data:image/... URL）最长多少字符。来源：实现者定；仓库里 240×240 的 avatars/ju.png 实测 92KB，
# base64 后约 123KB，留一倍多余量。
MAX_AVATAR = 300_000
# 头像只收这几种图片类型（网页把它放进 <img src>）。主机端 rh/config.py avatar_data_url 也按它和 MAX_AVATAR 先查。
AVATAR_TYPES = ("image/png", "image/jpeg", "image/webp")
# PUT /api/members 请求体上限：最多 8 个角色都带满额头像。来源：由 MAX_AVATAR 推出，8 个角色是实现者定。
MAX_MEMBERS_BODY = MAX_AVATAR * 8 + MAX_BODY
# 消息去重 key 最长多少字。来源：实现者定；host 用的是 32 位 uuid hex + ":" + 序号，远小于此。
MAX_KEY = 128
# 主机入口 /ws/host 的 WebSocket 单帧上限（网页入口 /ws 用 MAX_BODY）：主机推给设备的一块音频（一句话，16 位单声道 WAV，base64 后 ×4/3）。
# 来源：由 MAX_TEXT_CHARS 推出（一条发言最多这么多字、最坏一句到底），按 2026-10-18 实测 say 中文约每秒 4.3 字取 4 字/秒。
MAX_WS_FRAME = MAX_TEXT_CHARS // 4 * SAMPLE_RATE * 2 * 4 // 3 + MAX_BODY
MAX_PLAY_ID = 64  # play_id 最长多少字符。来源：主机用 32 位 uuid hex，留一倍。
RECEIPTS = {"done", "stopped", "failed"}
DEVICE_EVENTS = {"start", "audio", "stop"}
WS_UNAUTHORIZED = 4001  # WebSocket 关闭码。来源：RFC 6455 第 7.4.2 节，4000-4999 留给应用自定义。
WS_BAD_HELLO = 4002  # 来源：同上（RFC 6455 应用自定义关闭码段）。
WS_REPLACED = 4003  # 有新的角色主机连上，旧的被踢。来源：同上（RFC 6455 应用自定义关闭码段）。

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS members(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, position INTEGER NOT NULL,
  avatar TEXT NOT NULL DEFAULT '');  -- 头像 data URL，没有为空
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  author_kind TEXT NOT NULL,   -- user / role / system
  author TEXT NOT NULL,        -- 角色 id；人是 "user"，系统是 "system"
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,        -- user / speaking / done / interrupted / system
  spoken INTEGER,              -- 被打断时已说出的字数，未知为 NULL
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  client_key TEXT);            -- 发送方给的唯一 key，重试时去重；网页发的为 NULL
CREATE INDEX IF NOT EXISTS messages_room ON messages(room_id, id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 开关，如 mic = on/off
"""
# 旧库（没有 client_key 列）补列；唯一索引单独建（SQLite 的 ADD COLUMN 不能带 UNIQUE）。
MIGRATE_KEY = "ALTER TABLE messages ADD COLUMN client_key TEXT"
KEY_INDEX = "CREATE UNIQUE INDEX IF NOT EXISTS messages_key ON messages(client_key)"
MIGRATE_AVATAR = "ALTER TABLE members ADD COLUMN avatar TEXT NOT NULL DEFAULT ''"


class BadRequest(Exception):
    pass


class DeviceOut:
    """发给一个设备页面的帧队列（审查第 5 条）：hub 转发主机帧时不等慢设备收完大音频，
    主机发来的 stop 插到队首，并丢掉同一播放还没发出去的帧；正在发的那一帧发完就轮到 stop。"""

    def __init__(self, ws: web.WebSocketResponse):
        self.ws = ws
        self.q: deque[tuple[str, str]] = deque()   # (原始帧, play_id)
        self.wake = asyncio.Event()
        self.task = asyncio.ensure_future(self._run())

    def put(self, data: str, play_id: str, stop: bool) -> None:
        if stop:
            self.q = deque(x for x in self.q if x[1] != play_id)
            self.q.appendleft((data, play_id))
        else:
            self.q.append((data, play_id))
        self.wake.set()

    async def _run(self) -> None:
        while True:
            await self.wake.wait()
            self.wake.clear()
            while self.q:
                data, _ = self.q.popleft()
                try:
                    await self.ws.send_str(data)
                except Exception:  # 对方已断，等它的处理协程自己清理
                    pass

    def close(self) -> None:
        self.q.clear()
        self.task.cancel()


class Hub:
    """所有方法都在事件循环线程里调用；SQLite 是同步的，单用户量级够用。"""

    def __init__(self, db_path: str | Path, token: str):
        if not token:
            raise ValueError("RH_HUB_TOKEN 不能为空")
        self.token = token
        if str(db_path) != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path))
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        if "client_key" not in {r["name"] for r in self.db.execute("PRAGMA table_info(messages)")}:
            self.db.execute(MIGRATE_KEY)
        self.db.execute(KEY_INDEX)
        if "avatar" not in {r["name"] for r in self.db.execute("PRAGMA table_info(members)")}:
            self.db.execute(MIGRATE_AVATAR)
        # 上次进程留下的“在说”：说话的那个 host 连接已经不在了，改成被打断，否则网页上一直亮着。
        self.db.execute("UPDATE messages SET status='interrupted', updated_at=? WHERE status='speaking'", (time.time(),))
        if not self.db.execute("SELECT 1 FROM rooms").fetchone():
            self.db.execute("INSERT INTO rooms(name, created_at) VALUES(?, ?)", (DEFAULT_ROOM, time.time()))
            self.db.commit()
        self.subs: dict[web.WebSocketResponse, dict] = {}
        # 开了声音的页面 -> 它当哪些角色的设备；按开的先后排（dict 保持插入顺序）。
        self.devices: dict[web.WebSocketResponse, set[str]] = {}
        # 正在播的 play_id -> {"ws": 设备页面, "role": 角色}
        self.plays: dict[str, dict] = {}
        self.outs: dict[web.WebSocketResponse, DeviceOut] = {}   # 设备页面 -> 发给它的帧队列
        self.thinking: str | None = None   # 主机说谁在想
        self.volumes: dict[str, int] = {}   # 主机报的板子音量（只有在线的板子）

    def token_ok(self, token: object) -> bool:
        return isinstance(token, str) and hmac.compare_digest(token.encode(), self.token.encode())

    # ---------- 数据 ----------
    def room(self, room_id: int) -> dict | None:
        r = self.db.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
        return dict(r) if r else None

    def members(self) -> list[dict]:
        return [dict(r) for r in self.db.execute("SELECT * FROM members ORDER BY position, id")]

    def set_members(self, members: object) -> list[dict]:
        """角色主机启动时上报角色列表（整表替换）。"""
        if not isinstance(members, list):
            raise BadRequest("members must be a list")
        rows = []
        for i, m in enumerate(members):
            if not (isinstance(m, dict) and isinstance(m.get("id"), str) and isinstance(m.get("name"), str)):
                raise BadRequest("member must be {id: str, name: str}")
            mid, name = clean(m["id"])[:MAX_NAME], clean(m["name"])[:MAX_NAME]
            if not mid or not name or mid in ("user", "system"):
                raise BadRequest("bad member id/name")
            avatar = m.get("avatar") or ""
            # 只收图片 data URL：网页把它放进 <img src>，不能是 javascript: 或外站地址。
            if not isinstance(avatar, str) or len(avatar) > MAX_AVATAR or (
                    avatar and not avatar.startswith(tuple(f"data:{t};base64," for t in AVATAR_TYPES))):
                raise BadRequest("bad avatar")
            rows.append((mid, name, "role", i, avatar))
        with self.db:
            self.db.execute("DELETE FROM members")
            self.db.executemany("INSERT OR REPLACE INTO members(id, name, kind, position, avatar) VALUES(?,?,?,?,?)",
                                rows)
        return self.members()

    def first_room(self) -> int:
        return self.db.execute("SELECT id FROM rooms ORDER BY id LIMIT 1").fetchone()[0]

    def history(self, room_id: int, since: int | None) -> list[dict]:
        if since is None:
            rows = self.db.execute(
                "SELECT * FROM (SELECT * FROM messages WHERE room_id=? ORDER BY id DESC LIMIT ?) ORDER BY id",
                (room_id, HISTORY_LIMIT))
        else:
            rows = self.db.execute("SELECT * FROM messages WHERE room_id=? AND id>? ORDER BY id", (room_id, since))
        return [dict(r) for r in rows]

    def last_id(self, room_id: int) -> int:
        """频道里最新一条消息的 id，没有消息为 0（角色主机用来发现云端库被清空）。"""
        return self.db.execute("SELECT COALESCE(MAX(id), 0) FROM messages WHERE room_id=?", (room_id,)).fetchone()[0]

    def message(self, msg_id: int) -> dict | None:
        r = self.db.execute("SELECT * FROM messages WHERE id=?", (msg_id,)).fetchone()
        return dict(r) if r else None

    def create(self, room_id: int, body: object) -> tuple[dict, bool]:
        """返回 (消息, 是否新建)。同一个 client_key 重发时不再插入，直接返回已有那条。"""
        if not isinstance(body, dict):
            raise BadRequest("body must be an object")
        key = body.get("client_key")
        if key is not None and not (isinstance(key, str) and 0 < len(key) <= MAX_KEY):
            raise BadRequest("bad client_key")
        if key is not None:
            r = self.db.execute("SELECT id FROM messages WHERE client_key=?", (key,)).fetchone()
            if r:
                return self.message(r["id"]), False
        kind = body.get("author_kind", "user")
        if kind not in KINDS:
            raise BadRequest("bad author_kind")
        text = body.get("text")
        if not isinstance(text, str) or not clean(text):
            raise BadRequest("text must be a non-empty string")
        defaults = {"user": ("user", "用户"), "system": ("system", "系统")}
        author, name = defaults.get(kind, (None, None))
        if kind == "role":
            author, name = body.get("author"), body.get("name")
            if not (isinstance(author, str) and isinstance(name, str) and clean(author) and clean(name)):
                raise BadRequest("role message needs author and name")
            author, name = clean(author)[:MAX_NAME], clean(name)[:MAX_NAME]
        status = body.get("status", DEFAULT_STATUS[kind])
        if status not in STATUSES:
            raise BadRequest("bad status")
        now = time.time()
        cur = self.db.execute(
            "INSERT INTO messages(room_id, author_kind, author, name, text, status, spoken, created_at, updated_at,"
            " client_key) VALUES(?,?,?,?,?,?,NULL,?,?,?)",
            (room_id, kind, author, name, clean(text), status, now, now, key))
        self.db.commit()
        return self.message(cur.lastrowid), True

    def update(self, msg_id: int, body: object) -> dict | None:
        """角色主机改自己发的角色消息状态：speaking -> done / interrupted（带已说出字数）。用户、系统消息不能改。"""
        if not isinstance(body, dict):
            raise BadRequest("body must be an object")
        msg = self.message(msg_id)
        if msg is None:
            return None
        if msg["author_kind"] != "role":
            raise BadRequest("only role messages can be updated")
        status, spoken = body.get("status"), body.get("spoken")
        if status not in ("done", "interrupted"):
            raise BadRequest("bad status")
        if spoken is not None and (not isinstance(spoken, int) or isinstance(spoken, bool) or spoken < 0):
            raise BadRequest("bad spoken")
        self.db.execute("UPDATE messages SET status=?, spoken=?, updated_at=? WHERE id=?",
                        (status, spoken, time.time(), msg_id))
        self.db.commit()
        return self.message(msg_id)

    def interrupt_speaking(self, room_id: int) -> list[dict]:
        """角色主机掉线：它没说完的话不能一直亮着，改成被打断（已说字数未知）。"""
        ids = [r["id"] for r in self.db.execute(
            "SELECT id FROM messages WHERE room_id=? AND status='speaking'", (room_id,))]
        for i in ids:
            self.db.execute("UPDATE messages SET status='interrupted', updated_at=? WHERE id=?", (time.time(), i))
        self.db.commit()
        return [self.message(i) for i in ids]

    # ---------- 闭麦 ----------
    def mic_on(self) -> bool:
        r = self.db.execute("SELECT value FROM settings WHERE key='mic'").fetchone()
        return r is None or r["value"] != "off"

    def set_mic(self, body: object) -> bool:
        if not (isinstance(body, dict) and isinstance(body.get("on"), bool)):
            raise BadRequest("body must be {on: bool}")
        self.db.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('mic', ?)", ("on" if body["on"] else "off",))
        self.db.commit()
        return body["on"]

    # ---------- 设备 ----------
    def device_for(self, role: str) -> web.WebSocketResponse | None:
        for ws, roles in self.devices.items():
            if role in roles:
                return ws
        return None

    def out(self, ws: web.WebSocketResponse) -> DeviceOut:
        if ws not in self.outs:
            self.outs[ws] = DeviceOut(ws)
        return self.outs[ws]

    def device_roles(self) -> list[str]:
        return sorted(set().union(*self.devices.values())) if self.devices else []

    def hosts(self) -> list[web.WebSocketResponse]:
        return [w for w, i in self.subs.items() if i["kind"] == "host"]

    async def to_hosts(self, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        await asyncio.gather(*(self._send(w, data) for w in self.hosts()))

    async def notify_devices(self) -> None:
        await self.to_hosts({"type": "devices", "roles": self.device_roles()})

    async def from_web(self, ws: web.WebSocketResponse, d: dict) -> None:
        if d.get("type") == "device_hello":
            roles = d.get("roles")
            if not (isinstance(roles, list) and all(isinstance(r, str) and 0 < len(r) <= MAX_NAME for r in roles)):
                return
            self.devices[ws] = set(roles)
            await self.notify_devices()
        elif d.get("type") == "receipt":
            pid, result = d.get("play_id"), d.get("result")
            play = self.plays.get(pid) if isinstance(pid, str) else None
            if play is None or play["ws"] is not ws or result not in RECEIPTS:
                return   # 不是发给这个页面的（重复页面、旧播放），不认
            del self.plays[pid]
            await self.to_hosts({"type": "receipt", "play_id": pid, "role": play["role"], "result": result,
                                 "started": d.get("started") is True})

    async def set_thinking(self, role: str | None) -> None:
        if self.thinking != role:
            self.thinking = role
            await self.broadcast({"type": "thinking", "role": role})

    async def set_volumes(self, vols: dict[str, int]) -> None:
        if vols != self.volumes:
            self.volumes = vols
            await self.broadcast({"type": "volumes", "volumes": vols})

    async def from_host(self, raw: str, d: dict) -> None:
        if d.get("type") == "volumes":
            v = d.get("volumes")
            if isinstance(v, dict):
                await self.set_volumes({r: x for r, x in v.items() if isinstance(r, str) and 0 < len(r) <= MAX_NAME
                                        and isinstance(x, int) and not isinstance(x, bool) and 0 <= x <= 100})
            return
        if d.get("type") == "thinking":
            role = d.get("role")
            if role is None or (isinstance(role, str) and 0 < len(role) <= MAX_NAME):
                await self.set_thinking(role)
            return
        if d.get("type") != "device" or d.get("event") not in DEVICE_EVENTS:
            return
        pid, role = d.get("play_id"), d.get("role")
        if not (isinstance(pid, str) and 0 < len(pid) <= MAX_PLAY_ID and isinstance(role, str)):
            return
        if d["event"] == "start":
            dev = self.device_for(role)
            if dev is None:
                await self.to_hosts({"type": "receipt", "play_id": pid, "role": role, "result": "no_device"})
                return
            self.plays[pid] = {"ws": dev, "role": role}
        play = self.plays.get(pid)
        if play is None:
            return
        if d["event"] == "stop":
            del self.plays[pid]   # 停了就不再等这次的回执
        self.out(play["ws"]).put(raw, pid, stop=d["event"] == "stop")   # 不等设备收完，接着读主机的下一帧

    async def device_gone(self, ws: web.WebSocketResponse) -> None:
        """设备页面断了：它没播完的都回执 lost，主机马上交棒。"""
        if self.devices.pop(ws, None) is None:
            return
        for pid in [p for p, v in self.plays.items() if v["ws"] is ws]:
            play = self.plays.pop(pid)
            await self.to_hosts({"type": "receipt", "play_id": pid, "role": play["role"], "result": "lost"})
        await self.notify_devices()

    async def host_gone(self) -> None:
        """主机断了：设备上还在播的都停掉（主机那边讨论已停），也没人在想了。"""
        await self.set_thinking(None)
        await self.set_volumes({})   # 板子挂在主机上：主机不在就不知道音量
        plays, self.plays = self.plays, {}
        for pid, play in plays.items():
            self.out(play["ws"]).put(json.dumps({"type": "device", "event": "stop", "role": play["role"],
                                                 "play_id": pid}), pid, stop=True)

    # ---------- 推送 ----------
    async def broadcast(self, payload: dict, room_id: int | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        targets = [ws for ws, info in self.subs.items() if room_id is None or info["room"] == room_id]
        await asyncio.gather(*(self._send(ws, data) for ws in targets))

    async def _send(self, ws: web.WebSocketResponse, data: str) -> None:
        try:
            await ws.send_str(data)
        except Exception:  # 对方已断，等它的处理协程自己清理
            pass


# ---------- HTTP ----------
HUB_KEY = web.AppKey("hub", Hub)


def make_app(hub: Hub) -> web.Application:
    @web.middleware
    async def auth(request: web.Request, handler):
        if request.path.startswith("/api/"):
            h = request.headers.get("Authorization", "")
            if not (h.startswith("Bearer ") and hub.token_ok(h[len("Bearer "):])):
                raise web.HTTPUnauthorized(text="unauthorized")
        try:
            return await handler(request)
        except BadRequest as e:
            raise web.HTTPBadRequest(text=str(e))

    async def body_json(request: web.Request, limit: int = MAX_BODY) -> object:
        raw = await request.read()
        if len(raw) > limit:
            raise web.HTTPRequestEntityTooLarge(max_size=limit, actual_size=len(raw))
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise BadRequest("bad json")

    def room_or_404(request: web.Request) -> int:
        try:
            room_id = int(request.match_info["room"])
        except ValueError:
            raise web.HTTPNotFound()
        if hub.room(room_id) is None:
            raise web.HTTPNotFound()
        return room_id

    async def player_js(request):
        return web.FileResponse(STATIC / "queue-player.js", headers={"Cache-Control": "no-store"})

    async def client_js(request):
        return web.FileResponse(STATIC / "rh-client.js", headers={"Cache-Control": "no-store"})

    async def index(request):
        return web.FileResponse(STATIC / "hub.html", headers={"Cache-Control": "no-store"})

    async def dial(request):
        return web.FileResponse(STATIC / "dial.html", headers={"Cache-Control": "no-store"})

    async def put_members(request):
        members = hub.set_members(await body_json(request, MAX_MEMBERS_BODY))
        await hub.broadcast({"type": "members", "members": members})
        return web.json_response(members)

    async def post_message(request):
        room_id = room_or_404(request)
        msg, new = hub.create(room_id, await body_json(request))
        if new:
            await hub.broadcast({"type": "message", "message": msg}, room_id)
        return web.json_response(msg)

    async def post_mic(request):
        on = hub.set_mic(await body_json(request))
        await hub.broadcast({"type": "mic", "on": on})
        return web.json_response({"on": on})

    async def post_volume(request):
        b = await body_json(request)
        v = b.get("volume") if isinstance(b, dict) else None
        if not (isinstance(b, dict) and isinstance(b.get("role"), str) and 0 < len(b["role"]) <= MAX_NAME
                and isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100):
            raise BadRequest("body must be {role: str, volume: 0-100}")
        hosts = hub.hosts()
        if not hosts:
            raise web.HTTPServiceUnavailable(text="角色主机没连上")
        await hub.to_hosts({"type": "volume", "role": b["role"], "volume": v})
        return web.json_response({"role": b["role"], "volume": v})

    async def patch_message(request):
        try:
            msg_id = int(request.match_info["id"])
        except ValueError:
            raise web.HTTPNotFound()
        msg = hub.update(msg_id, await body_json(request))
        if msg is None:
            raise web.HTTPNotFound()
        await hub.broadcast({"type": "message", "message": msg}, msg["room_id"])
        return web.json_response(msg)

    async def ws_handler(request):
        return await serve_ws(request, host_path=False)

    async def ws_host_handler(request):
        # 主机专用入口：要推大音频帧，单帧上限大；所以握手时就要带 token 头，没 token 的连接收不到大帧的额度。
        h = request.headers.get("Authorization", "")
        if not (h.startswith("Bearer ") and hub.token_ok(h[len("Bearer "):])):
            raise web.HTTPUnauthorized(text="unauthorized")
        return await serve_ws(request, host_path=True)

    async def serve_ws(request, host_path: bool):
        # 网页连接只发回执和开声音，单帧上限同 HTTP 请求体（hello 之前也是）。
        ws = web.WebSocketResponse(heartbeat=HEARTBEAT, max_msg_size=MAX_WS_FRAME if host_path else MAX_BODY)
        await ws.prepare(request)
        try:
            first = await ws.receive(timeout=HELLO_TIMEOUT)
            hello = json.loads(first.data) if first.type == WSMsgType.TEXT else None
        except (asyncio.TimeoutError, ValueError):
            hello = None
        if not isinstance(hello, dict) or hello.get("type") != "hello" or not hub.token_ok(hello.get("token")):
            await ws.close(code=WS_UNAUTHORIZED, message=b"unauthorized")
            return ws
        room_id = hello.get("room") or hub.first_room()
        since = hello.get("since")
        if (not isinstance(room_id, int) or hub.room(room_id) is None
                or (since is not None and (not isinstance(since, int) or isinstance(since, bool)))):
            await ws.close(code=WS_BAD_HELLO, message=b"bad hello")
            return ws
        kind = "host" if hello.get("kind") == "host" else "web"
        if (kind == "host") != host_path:   # 主机只能走 /ws/host，网页只能走 /ws
            await ws.close(code=WS_BAD_HELLO, message=b"bad hello")
            return ws
        if kind == "host":
            # 只允许一个角色主机：新连接踢掉旧连接（旧主机收到 WS_REPLACED 就退出，不再重连）。
            # 选“新的优先”而不是“拒绝新的”：主机重启或换网络时，旧连接要等心跳（最长约 2 个 HEARTBEAT）
            # 才会被发现断了，拒绝新的会让正常重连卡住一分钟。
            for old in hub.hosts():
                hub.subs.pop(old, None)   # 先摘掉，不再给它推送
                asyncio.ensure_future(old.close(code=WS_REPLACED, message=b"replaced by new host"))
            await hub.host_gone()
            # 旧主机没说完的话不会再有人改状态了，改成被打断（新主机的 ready 里看到的就是被打断）。
            for m in hub.interrupt_speaking(room_id):
                await hub.broadcast({"type": "message", "message": m}, room_id)
        # 先登记再取历史：两步之间没有 await，不会漏掉中间插进来的消息。
        hub.subs[ws] = {"room": room_id, "kind": kind}
        try:
            await ws.send_str(json.dumps({
                "type": "ready", "room": hub.room(room_id), "members": hub.members(),
                "messages": hub.history(room_id, since), "last_id": hub.last_id(room_id),
                "devices": hub.device_roles(), "mic": hub.mic_on(), "thinking": hub.thinking,
                "volumes": hub.volumes}, ensure_ascii=False))
            # 频道消息的写入都走 HTTP；WebSocket 上收的只有设备事件（开声音、回执、主机推给设备的音频）。
            async for frame in ws:
                if frame.type != WSMsgType.TEXT:
                    continue
                try:
                    d = json.loads(frame.data)
                except ValueError:
                    continue
                if not isinstance(d, dict) or hub.subs.get(ws) is None:
                    continue   # 被新主机踢掉的旧主机：不再转发它的帧
                if kind == "host":
                    await hub.from_host(frame.data, d)
                else:
                    await hub.from_web(ws, d)
        finally:
            was_sub = hub.subs.pop(ws, None) is not None
            out = hub.outs.pop(ws, None)
            if out is not None:
                out.close()
            await hub.device_gone(ws)
            if kind == "host" and was_sub:
                await hub.host_gone()
            if kind == "host" and not any(i["kind"] == "host" and i["room"] == room_id for i in hub.subs.values()):
                for m in hub.interrupt_speaking(room_id):
                    await hub.broadcast({"type": "message", "message": m}, room_id)
        return ws

    # 总上限按最大的那种请求（成员表带头像）放；每个接口在 body_json 里再按自己的上限查。
    app = web.Application(middlewares=[auth], client_max_size=MAX_MEMBERS_BODY)
    app.add_routes([
        web.get("/", index),
        web.get("/ws", ws_handler),
        web.get("/ws/host", ws_host_handler),
        web.get("/queue-player.js", player_js),
        web.get("/rh-client.js", client_js),
        web.get("/dial", dial),
        web.put("/api/members", put_members),
        web.post("/api/rooms/{room}/messages", post_message),
        web.patch("/api/messages/{id}", patch_message),
        web.post("/api/mic", post_mic),
        web.post("/api/volume", post_volume),
    ])
    if AVATARS.is_dir():
        app.add_routes([web.static("/avatars", AVATARS)])

    async def close_all(app):  # 关服务时主动断开所有 WebSocket，否则 aiohttp 要等它们自己断
        for ws in list(hub.subs):
            await ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown")

    app.on_shutdown.append(close_all)
    app[HUB_KEY] = hub
    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    # 默认端口 8790。来源：实现者定；vps-arm 上 `ss -ltnp` 未占用，外网实测可达（2026-10-18）。
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--db", default=str(Path(__file__).resolve().parent.parent / "data" / "hub.sqlite3"))
    a = ap.parse_args()
    hub = Hub(a.db, os.environ.get("RH_HUB_TOKEN", ""))
    print(f"角色小家云端频道 http://{a.host}:{a.port}  数据库={a.db}", flush=True)
    web.run_app(make_app(hub), host=a.host, port=a.port, print=None)


if __name__ == "__main__":
    main()
