"""云端频道服务（hub）：频道、消息、成员；HTTP 发消息 + WebSocket 实时推送（最近历史在连上时的 ready 帧里）；同一服务发网页。

数据模型参考 Campfire（github.com/basecamp/once-campfire，MIT）：rooms / messages，
成员分人和 bot（这里是角色），bot 用 HTTP 发消息。只参考结构，不照搬 Rails。

鉴权：一个共享 token（环境变量 RH_HUB_TOKEN）。HTTP 带 `Authorization: Bearer <token>`；
WebSocket 连上后第一帧发 hello 带 token（浏览器的 WebSocket 不能自定义请求头）。

    RH_HUB_TOKEN=... uv run python -m rh.hub [--host 0.0.0.0] [--port 8790] [--db data/hub.sqlite3]

WebSocket 协议（JSON 文本帧）：
    客户端 -> {"type":"hello","token":..., "kind":"web"|"host", "since": 消息id 或 null}
              网页连 /ws；主机连 /ws/host（握手要带 Authorization: Bearer 头，单帧上限大，用来推音频）
    服务端 -> {"type":"ready","room":{...},"members":[...],"messages":[...],"last_id": 频道最新消息 id,
               "last_read": 这个频道读到哪条, "unread": 之后别人（角色、系统）发了几条, "has_more": 这批之前还有没有}
              （last_read / unread / has_more 只给网页）
              since 为 null 时给最近 HISTORY_LIMIT 条；否则给 id > since 的全部消息（角色主机补话题、网页断线重连补缺用）
    服务端 -> {"type":"read","room":频道 id,"last_read":...}   已读位置变了（别的页面读过了）

历史与未读（用户 2026-10-20「你可以去修一下自建平台，那边感觉还是很垃圾」，差距：只看得到最近 200 条、不能翻页搜索、没有未读）：
    GET  /api/rooms/{room}/messages?before=id&limit=n   id 之前的一页（旧到新），{"messages":[...],"has_more":bool}
    GET  /api/rooms/{room}/messages?q=字&before=id&limit=n   正文含 q 的，新到旧，同上
    这一个只读接口也认 bot 的 token（RH_BOT_TOKEN）：cc-connect 补「频道里你上次看到之后的消息」用（同 Discord 读频道历史，
    conest bridge/platform/cloud-web/history.go）；消息的 from_turn=1 是 bot 在会话里写的回复，补发时跳过（rh/cloudweb.py）。
    POST /api/rooms/{room}/read {"last_read": id}   网页看到底了；只增不减，推给同频道的页面
    已读位置按频道存在库里（换设备、换标签页都接着算）；第一次连上时从当时最新一条算起，老消息不算未读。
    服务端 -> {"type":"message","message":{...}}   新消息或状态变化（同 id 覆盖）
    服务端 -> {"type":"members","members":[...]}

设备（每个角色的躯体，现在是网页虚拟头）：事件定义见 rh/device.py。hub 只做转发：
    网页   -> {"type":"device_hello","roles":[角色 id...]}   这个页面当这些角色的设备（用户点了“开声音”）
    网页   -> {"type":"ping"}   服务端 -> {"type":"pong"}   网页回到前台时探连接还活着没
    主机   -> {"type":"device","event":"start"|"audio"|"stop",...}   start 时按角色挑设备并记住，后面同一 play_id 只发给它
    设备   -> {"type":"receipt","play_id":...,"result":...}          只认这次播放被发往的那个页面，转给主机
    服务端 -> 主机 {"type":"devices","roles":[有设备在线的角色]}（ready 帧里也带 devices）

闭麦（用户 2026-10-19「我没有一个闭麦按钮，或者我希望可以语音闭麦」）：开关存在库里（hub 重启不丢），
    网页按钮或主机（语音「闭麦」「开麦」）POST /api/mic {"on": bool}；hub 推给所有连接 {"type":"mic","on":...}，
    ready 帧里也带 mic。主机收到 on=false 就停掉正在说的、不再收音（只认「开麦」「暂停」「闭麦」）。
板子音量（用户 2026-10-19「声音太小了，预期可以我通过语音让它调大，或者说我在这个网页端可以调大」）：
    主机 -> {"type":"volumes","volumes":{角色: 0-100}}（在线板子的音量），hub 记下推给网页（ready 帧里也带 volumes）；
    网页滑条 POST /api/volume {"role", "volume": 0-100}，hub 转给主机 {"type":"volume","role","volume"}，主机经 MCP 调板子。
思考中：主机 -> {"type":"thinking","role": 角色 id 或 null}，hub 记下并推给网页（ready 帧里也带 thinking）。
    角色可以不说话、叫了名字只有她回，网页不能再按轮流顺序猜谁在想。
一个角色有多个页面都开了声音时，用最早开的那个（同 conest：重复页面不接管正在播的）；它断了才轮到下一个。

多频道（用户 2026-10-19 产品核心「多频道管理……多agent多会话记忆管理」）：
    GET    /api/rooms[?archived=1]         列频道（默认只列没归档的；archived=1 连归档的一起，按 id 排）
    POST   /api/rooms {"name"}             建频道
    PATCH  /api/rooms/{id} {"name"?, "archived"?}   改名 / 归档(true) / 恢复(false)
    DELETE /api/rooms/{id}                 删除 = 归档：消息全留着，归档的频道只读（发消息 409），能打开看、能恢复
    频道有变化就推 {"type":"rooms","rooms":[全部频道含归档的]} 给所有连接；ready 帧里也带 rooms。
    默认频道（id 最小的那个，旧库里就是「大厅」）不能归档：语音收音、旧主机都落在它上面。
    网页切频道不断线：发 {"type":"join","room": id}，收到那个频道的 ready（断线会把开了声音的设备一起断掉）。
    主机 hello 带 "rooms":"all" 就订全部频道（含之后新建的）：推送是所有频道的消息，ready 的 messages 是所有频道
    id > since 的（消息 id 全库递增，一个已读位置就够），ready.room 是默认频道；不带 rooms 的旧主机只订默认频道。
    思考中按频道分：主机 {"type":"thinking","role","room"}，只推给那个频道（不带 room 算默认频道）。
cc-connect 的 bot（rh/cloudweb.py，用户 2026-10-20「你先看看距离discord差异有什么」，差距表见 feat/plat-botux 分支的说明）：
    ready 帧带 "bots":[{id,name,online}]（连过的都在，按第一次连上的先后）和 "bots_thinking":[这个频道里正在干活的 bot id]。
    服务端 -> {"type":"bots","bots":[...]}   有 bot 连上、断开
    服务端 -> {"type":"bot_thinking","room":频道 id,"bots":[...]}   只推给那个频道
    消息多一个 card 字段：bot 的进度卡片（JSON 字符串，见 rh/cloudweb.py card_from），普通消息为 null。
手机通知（Web Push，用户 2026-10-20「我现在基本不在电脑前面了」「然后还有就是其他易用性」，审稿 ~/.claude/reviews/rh-ux-1.md）：
    GET  /api/push                       {"key": VAPID 公钥}（网页 subscribe 的 applicationServerKey）
    POST /api/push PushSubscription.toJSON()   登记这台设备（同一 endpoint 再登记只是覆盖）；推送服务回 404/410 时自动删掉
    什么时候推：角色 / bot 的消息 @ 了我（@用户、@user、<@RH_USER_MENTION_ID>，代码块里的不算）；
    主机发的系统消息带 "notify": true（rh/host.py agent_event：Discord 里角色出错、等批准）。别的都不推。
    VAPID 私钥在库旁边的 vapid_private.pem（rh/webpush.py）。网页、service worker、manifest 见 rh/static/rh-push.js、sw.js。
会话键：频道 id 一经分配不再复用（删除只归档，不删行），一个频道 = 一个会话，会话键用 session_key(频道 id)。
    rh/host.py 每个频道一份 Meeting 和角色大脑；接进 hub 的别的 bot 也按这个键分会话，切频道不串上下文。
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import os
import re
import sqlite3
import sys
import time
from collections import deque
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import WSCloseCode, WSMsgType, web

from . import cloudweb, webpush
from .meeting import MAX_TEXT_CHARS, clean
from .voice import SAMPLE_RATE

STATIC = Path(__file__).resolve().parent / "static"
# 头像图片（表盘页 /dial 用 avatars/dial/ 下的 466×466 头肩特写）。部署时 deploy.sh 一起同步，镜像里在 /app/avatars。
AVATARS = Path(__file__).resolve().parent.parent / "avatars"
KINDS = {"user", "role", "system"}
STATUSES = {"user", "speaking", "done", "interrupted", "system"}
DEFAULT_STATUS = {"user": "user", "role": "speaking", "system": "system"}
DEFAULT_ROOM = "大厅"  # 启动时没有频道就建这一个。来源：沿用旧库里已有的默认频道名。

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
SQLITE_MAX_INT = 2 ** 63 - 1   # 消息 id 的上限。来源：SQLite INTEGER 是 64 位有符号整数，再大绑定时报 OverflowError。
MAX_PLAY_ID = 64  # play_id 最长多少字符。来源：主机用 32 位 uuid hex，留一倍。
RECEIPTS = {"done", "stopped", "failed"}
DEVICE_EVENTS = {"start", "audio", "stop"}
WS_UNAUTHORIZED = 4001  # WebSocket 关闭码。来源：RFC 6455 第 7.4.2 节，4000-4999 留给应用自定义。
WS_BAD_HELLO = 4002  # 来源：同上（RFC 6455 应用自定义关闭码段）。
WS_REPLACED = 4003  # 有新的角色主机连上，旧的被踢。来源：同上（RFC 6455 应用自定义关闭码段）。
VAPID_FILE = "vapid_private.pem"   # 放在库同一目录（线上是挂载的 /data，本机是 data/，都不进 git）
# 推送订阅的 endpoint 最长多少字符。来源：实现者定；FCM、苹果、Mozilla 的 endpoint 实际约 150-250 字符，留几倍。
MAX_ENDPOINT = 1024
# 通知正文最多多少字（手机锁屏上本来也只显示两三行）。来源：实现者定；整个推送体要在 4KB 以内（RFC 8030 第 7.2 节）。
PUSH_BODY = 200
# 只往这些推送服务发（代码审查：endpoint 是网页交上来的，hub 会去 POST 它，不能让它指向内网或任意网址）。
# 来源：代码审查给的名单——Chrome / 安卓（FCM）、苹果、Firefox、Edge / Windows 的推送服务域名。
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com")
PUSH_HOST_SUFFIXES = (".push.apple.com", ".notify.windows.com")
USER_ALIASES = ("用户", "user")   # 我在 hub 里的名字和 id（Hub.create 里用户消息的 author / name）
FENCE = "```"

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at REAL NOT NULL,
  archived_at REAL);           -- 归档（删除）时刻，没归档为 NULL
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
  client_key TEXT,             -- 发送方给的唯一 key，重试时去重；网页发的为 NULL
  card TEXT,                   -- bot 的进度卡片（JSON：title/state/steps/elapsed_sec，rh/cloudweb.py），不是卡片为 NULL
  from_turn INTEGER);          -- 1 = cc-connect bot 在会话里写的回复（reply 带 agent=true，rh/cloudweb.py），其余 NULL
CREATE INDEX IF NOT EXISTS messages_room ON messages(room_id, id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 开关，如 mic = on/off
CREATE TABLE IF NOT EXISTS reads(room_id INTEGER PRIMARY KEY, last_read INTEGER NOT NULL);  -- 每个频道读到哪条
-- 手机 / 浏览器的推送订阅（Web Push）。origin：订阅时网页的地址，当 VAPID 的 sub（苹果要求是 https 网址或 mailto）
CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
  origin TEXT NOT NULL, created_at REAL NOT NULL);
-- 连过 hub 的 cc-connect bot（rh/cloudweb.py）：成员栏按第一次连上的先后列出，断了显示离线
CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY, name TEXT NOT NULL, first_seen REAL NOT NULL);
"""
# 旧库（没有 client_key 列）补列；唯一索引单独建（SQLite 的 ADD COLUMN 不能带 UNIQUE）。
MIGRATE_KEY = "ALTER TABLE messages ADD COLUMN client_key TEXT"
KEY_INDEX = "CREATE UNIQUE INDEX IF NOT EXISTS messages_key ON messages(client_key)"
MIGRATE_AVATAR = "ALTER TABLE members ADD COLUMN avatar TEXT NOT NULL DEFAULT ''"
# 旧库（rooms 没有 archived_at）补列：旧频道都是 NULL = 没归档，消息不动。
MIGRATE_ARCHIVED = "ALTER TABLE rooms ADD COLUMN archived_at REAL"
MIGRATE_CARD = "ALTER TABLE messages ADD COLUMN card TEXT"   # 旧消息都是 NULL = 普通消息
MIGRATE_FROM_TURN = "ALTER TABLE messages ADD COLUMN from_turn INTEGER"   # 旧消息都是 NULL：补发时照常给 bot 看
# cc-connect team_workspace（#597 G1）：频道分聊天频道（chat）和工作区（workspace）。列的意思照抄
# conest bridge/core/dsh_bundle/collab/store.mjs:34-46：parent_id 现在的主（聊天频道），free=1 空闲（池里谁都能认领），
# claim_seq 认领号（每次认领 +1，桥 release 带上它，旧号拒绝 stale-claim），claim_bridge=1 是桥认领的。
# rh 没有任务表，所以没有 claim_task。旧频道都是 chat。
MIGRATE_WORKSPACE = [
    ("kind", "ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'"),
    ("parent_id", "ALTER TABLE rooms ADD COLUMN parent_id INTEGER REFERENCES rooms(id)"),
    ("free", "ALTER TABLE rooms ADD COLUMN free INTEGER NOT NULL DEFAULT 0"),
    ("claim_seq", "ALTER TABLE rooms ADD COLUMN claim_seq INTEGER NOT NULL DEFAULT 0"),
    ("claim_bridge", "ALTER TABLE rooms ADD COLUMN claim_bridge INTEGER NOT NULL DEFAULT 0"),
]
WORKSPACE_PREFIX = "工作区"   # 工作区名「工作区<n>」，同 store.mjs WORKSPACE_PREFIX
WORKSPACE_RE = re.compile(rf"^{WORKSPACE_PREFIX}(\d+)$")


def add_column(db: sqlite3.Connection, sql: str) -> None:
    """旧库补列。两个进程同时开同一个旧库时，查完“没这列”到 ALTER 之间另一个可能已经补上了：
    碰到 duplicate column 当作已补好，别的错照常抛。"""
    try:
        db.execute(sql)
    except sqlite3.OperationalError as e:
        if "duplicate column" not in str(e):
            raise


def session_key(room_id: int) -> str:
    """一个频道一个会话：会话键只由频道 id 定（id 不复用，见模块说明）。主机的会话目录、接进来的 bot 都用它。"""
    return f"room-{room_id}"


class BadRequest(Exception):
    pass


class Conflict(Exception):
    """频道重名、往归档的频道发消息：HTTP 409。"""


class WorkspaceError(Exception):
    """team_workspace 被拒；code 是桥认的错误串（conest bridge/platform/cloud-web/workspaces.go
    teamWorkspaceRequest：workspace-owned / stale-claim / room-missing / unsupported）。"""

    def __init__(self, code: str, msg: str = ""):
        super().__init__(msg or code)
        self.code = code


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

    def __init__(self, db_path: str | Path, token: str, bot_token: str | None = None,
                 user_mention_id: str | None = None):
        if not token:
            raise ValueError("RH_HUB_TOKEN 不能为空")
        self.token = token
        # cc-connect 的 bot 连 /cloud-web/ws 用的 token（环境变量 RH_BOT_TOKEN），和网页登录的分开：
        # 设了它，bot 只认它、网页接口不认它；没设时 bot 照旧用 RH_HUB_TOKEN（升级前的配置接着能连）。
        self.bot_token = bot_token or None
        if str(db_path) != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path))
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        if "client_key" not in {r["name"] for r in self.db.execute("PRAGMA table_info(messages)")}:
            add_column(self.db, MIGRATE_KEY)
        self.db.execute(KEY_INDEX)
        if "avatar" not in {r["name"] for r in self.db.execute("PRAGMA table_info(members)")}:
            add_column(self.db, MIGRATE_AVATAR)
        if "archived_at" not in {r["name"] for r in self.db.execute("PRAGMA table_info(rooms)")}:
            add_column(self.db, MIGRATE_ARCHIVED)
        if "card" not in {r["name"] for r in self.db.execute("PRAGMA table_info(messages)")}:
            add_column(self.db, MIGRATE_CARD)
        if "from_turn" not in {r["name"] for r in self.db.execute("PRAGMA table_info(messages)")}:
            add_column(self.db, MIGRATE_FROM_TURN)
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(rooms)")}
        for col, sql in MIGRATE_WORKSPACE:
            if col not in cols:
                add_column(self.db, sql)
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
        self.thinking: dict[int, str] = {}   # 频道 id -> 主机说谁在想（没人在想的频道不在表里）
        self.volumes: dict[str, int] = {}   # 主机报的板子音量（只有在线的板子）
        # 新消息建好、推给网页之后还要通知谁（rh/cloudweb.py：转给 cc-connect 驱动的 bot）
        self.listeners: list = []
        self.bots_online: set[str] = set()   # 现在连着的 cc-connect bot（rh/cloudweb.py 维护）
        self.bot_thinking: dict[int, list[str]] = {}   # 频道 id -> 正在干活的 bot（按开始的先后；空的不在表里）
        # 推送：VAPID 钥匙、怎么算 @ 我（bot 照 Discord 习惯写 <@我的 Discord ID> 时也认，ID 只收数字，同 cloudweb mention_id）
        self.vapid = webpush.Vapid.load(None if str(db_path) == ":memory:" else Path(db_path).parent / VAPID_FILE)
        alias = [re.escape("@" + a) + r"(?![A-Za-z0-9_])" for a in USER_ALIASES]
        if user_mention_id and user_mention_id.isascii() and user_mention_id.isdigit():
            alias.append(rf"<@!?{user_mention_id}>")
        self.me_re = re.compile("|".join(alias))
        self.push_insecure_ok = False   # 只有测试打开：假推送服务是本地 http
        self.push_tasks: set[asyncio.Task] = set()
        self.push_http: object | None = None   # aiohttp.ClientSession，第一次推送时建
        self.listeners.append(self._push_listener)

    def token_ok(self, token: object) -> bool:
        return isinstance(token, str) and hmac.compare_digest(token.encode(), self.token.encode())

    def bot_token_ok(self, token: object) -> bool:
        if self.bot_token is None:
            return self.token_ok(token)
        return isinstance(token, str) and hmac.compare_digest(token.encode(), self.bot_token.encode())

    # ---------- cc-connect 的 bot（rh/cloudweb.py） ----------
    def remember_bot(self, bot_id: str, name: str) -> None:
        with self.db:
            self.db.execute("INSERT INTO bots(id, name, first_seen) VALUES(?,?,?) "
                            "ON CONFLICT(id) DO UPDATE SET name=excluded.name", (bot_id, name, time.time()))

    def bot_list(self) -> list[dict]:
        """成员栏用：[{id, name, online}]，按第一次连上的先后。"""
        return [{"id": r["id"], "name": r["name"], "online": r["id"] in self.bots_online}
                for r in self.db.execute("SELECT id, name FROM bots ORDER BY first_seen, rowid")]

    async def bots_changed(self) -> None:
        await self.broadcast({"type": "bots", "bots": self.bot_list()})

    async def set_bot_thinking(self, room_id: int, bot_id: str, on: bool) -> None:
        cur = self.bot_thinking.get(room_id, [])
        new = (cur if bot_id in cur else cur + [bot_id]) if on else [b for b in cur if b != bot_id]
        if new == cur:
            return
        if new:
            self.bot_thinking[room_id] = new
        else:
            self.bot_thinking.pop(room_id, None)
        await self.broadcast({"type": "bot_thinking", "room": room_id, "bots": new}, room_id)

    @staticmethod
    def preview_key(bot_id: str, ref: str) -> str:
        """bot 用 preview_start 建的消息记在 client_key 里：只有这种能被它改、删（审查第 4 条）。"""
        return f"cw-preview:{bot_id}:{ref}"[:MAX_KEY]

    def bot_message(self, msg_id: int, bot_id: str) -> dict | None:
        """bot 自己用 preview_start 建的、还能改的那条（进度卡片）；正式回复、别人的、归档频道里的都不给。"""
        msg = self.message(msg_id)
        if msg is None or msg["author_kind"] != "role" or msg["author"] != bot_id or \
                not (msg["client_key"] or "").startswith(f"cw-preview:{bot_id}:"):
            return None
        room = self.room(msg["room_id"])
        return msg if room is not None and room["archived_at"] is None else None

    def bot_edit(self, msg_id: int, bot_id: str, text: str, card: str | None, max_chars: int) -> dict | None:
        if self.bot_message(msg_id, bot_id) is None or not clean(text, max_chars):
            return None
        self.db.execute("UPDATE messages SET text=?, card=?, updated_at=? WHERE id=?",
                        (clean(text, max_chars), card, time.time(), msg_id))
        self.db.commit()
        return self.message(msg_id)

    def bot_delete(self, msg_id: int, bot_id: str) -> dict | None:
        msg = self.bot_message(msg_id, bot_id)
        if msg is not None:
            self.db.execute("DELETE FROM messages WHERE id=?", (msg_id,))
            self.db.commit()
        return msg

    # ---------- 数据 ----------
    def room(self, room_id: int) -> dict | None:
        r = self.db.execute("SELECT * FROM rooms WHERE id=?", (room_id,)).fetchone()
        return dict(r) if r else None

    def rooms(self, archived: bool = False) -> list[dict]:
        """按 id 排；archived=False 只列没归档的。"""
        sql = "SELECT * FROM rooms" + ("" if archived else " WHERE archived_at IS NULL") + " ORDER BY id"
        return [dict(r) for r in self.db.execute(sql)]

    def _room_name(self, body: dict) -> str:
        name = body.get("name")
        if not isinstance(name, str) or not clean(name) or len(clean(name)) > MAX_NAME:
            raise BadRequest(f"name must be 1-{MAX_NAME} chars")
        return clean(name)

    def create_room(self, body: object) -> dict:
        if not isinstance(body, dict):
            raise BadRequest("body must be an object")
        name = self._room_name(body)
        try:
            with self.db:
                cur = self.db.execute("INSERT INTO rooms(name, created_at) VALUES(?, ?)", (name, time.time()))
        except sqlite3.IntegrityError:
            raise Conflict("同名频道已存在（可能在已归档里）")
        return self.room(cur.lastrowid)

    def update_room(self, room_id: int, body: object) -> dict:
        """改名、归档（archived=true）、恢复（archived=false）。频道和消息都不删。"""
        if not isinstance(body, dict) or not ({"name", "archived"} & body.keys()):
            raise BadRequest("body must be {name?: str, archived?: bool}")
        if "archived" in body and not isinstance(body["archived"], bool):
            raise BadRequest("archived must be bool")
        name = self._room_name(body) if "name" in body else None
        if body.get("archived") and room_id == self.first_room():
            raise BadRequest("默认频道不能删除")
        try:
            with self.db:
                if name is not None:
                    self.db.execute("UPDATE rooms SET name=? WHERE id=?", (name, room_id))
                if "archived" in body:
                    self.db.execute("UPDATE rooms SET archived_at=? WHERE id=?",
                                    (time.time() if body["archived"] else None, room_id))
        except sqlite3.IntegrityError:
            raise Conflict("同名频道已存在（可能在已归档里）")
        return self.room(room_id)

    # ---------- 工作区（cc-connect team_workspace，语义照 collab/store.mjs:346-460） ----------
    def _chat_of(self, room: dict) -> int:
        """工作区算它的主聊天频道，聊天频道算自己。"""
        return room["parent_id"] if room["kind"] == "workspace" and room["parent_id"] is not None else room["id"]

    def workspaces(self) -> list[dict]:
        """全服一个池：所有没归档的工作区。"""
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM rooms WHERE kind='workspace' AND archived_at IS NULL ORDER BY id")]

    def workspace_owner(self, room_id: int) -> int | None:
        """现在的主（聊天频道 id）；None = 空闲或不是工作区。"""
        r = self.room(room_id)
        return None if r is None or r["kind"] != "workspace" or r["free"] else r["parent_id"]

    def claim_id(self, room_id: int) -> str:
        r = self.room(room_id)
        return str(r["claim_seq"] if r else 0)

    def create_workspace(self, room_id: int, bridge: bool = True) -> dict:
        """给聊天频道 room_id 一个工作区：先用编号最小的空闲工作区，没有就建「工作区<n+1>」。
        n 取所有频道（含归档的、含同名的聊天频道）里最大的「工作区<k>」：rooms.name UNIQUE 且归档的也占名。"""
        room = self.room(room_id)
        if room is None:
            raise WorkspaceError("room-missing")
        parent = self._chat_of(room)
        num = lambda r: int(m.group(1)) if (m := WORKSPACE_RE.match(r["name"])) else 0
        with self.db:
            free = sorted((w for w in self.workspaces() if w["free"] and num(w) > 0), key=num)
            if free:
                wid = free[0]["id"]
                self.db.execute("UPDATE rooms SET parent_id=?, free=0, claim_bridge=?, claim_seq=claim_seq+1 WHERE id=?",
                                (parent, int(bridge), wid))
            else:
                n = max([0, *(num(dict(r)) for r in self.db.execute("SELECT name FROM rooms"))])
                cur = self.db.execute(
                    "INSERT INTO rooms(name, created_at, kind, parent_id, free, claim_seq, claim_bridge) "
                    "VALUES(?, ?, 'workspace', ?, 0, 1, ?)",
                    (f"{WORKSPACE_PREFIX}{n + 1}", time.time(), parent, int(bridge)))
                wid = cur.lastrowid
        return self.room(wid)

    def claim_workspace(self, chat_id: int, workspace_id: int, bridge: bool = True) -> dict:
        """chat_id（或它所在工作区的主频道）认领工作区 workspace_id，认领号 +1。别的频道占着就拒 workspace-owned。"""
        chat, ws = self.room(chat_id), self.room(workspace_id)
        if chat is None or ws is None or ws["archived_at"] is not None:
            raise WorkspaceError("room-missing")
        if ws["kind"] != "workspace":   # 默认频道等聊天频道不能被认领成工作区
            raise WorkspaceError("not-workspace")
        parent = self._chat_of(chat)
        owner = self.workspace_owner(ws["id"])
        if owner is not None and owner != parent:
            raise WorkspaceError("workspace-owned", f"{ws['name']} belongs to room {owner}")
        with self.db:
            self.db.execute("UPDATE rooms SET parent_id=?, free=0, claim_bridge=?, claim_seq=claim_seq+1 WHERE id=?",
                            (parent, int(bridge), ws["id"]))
        return self.room(ws["id"])

    def release_workspace(self, room_id: int, claim: str | None = None) -> bool:
        """放回池里（free=1）。claim 不是现在的认领号就拒 stale-claim（迟到的 release 不放掉新认领）。
        已空闲或不是工作区返回 False。rh 没有任务表，没有 busy。"""
        ws = self.room(room_id)
        if ws is None:
            raise WorkspaceError("room-missing")
        if ws["kind"] != "workspace" or self.workspace_owner(ws["id"]) is None:
            return False
        if claim is not None and str(claim) != self.claim_id(ws["id"]):
            raise WorkspaceError("stale-claim", f"{ws['name']} was claimed again since claim {claim}")
        with self.db:
            self.db.execute("UPDATE rooms SET free=1, claim_bridge=0 WHERE id=?", (ws["id"],))
        return True

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

    def history(self, room_id: int | None, since: int | None) -> list[dict]:
        """room_id=None：所有频道（订了全部频道的主机）。"""
        where, args = ("", ()) if room_id is None else ("room_id=? AND ", (room_id,))
        if since is None:
            rows = self.db.execute(
                f"SELECT * FROM (SELECT * FROM messages WHERE {where}1 ORDER BY id DESC LIMIT ?) ORDER BY id",
                (*args, HISTORY_LIMIT))
        else:
            rows = self.db.execute(f"SELECT * FROM messages WHERE {where}id>? ORDER BY id", (*args, since))
        return [dict(r) for r in rows]

    def page(self, room_id: int, before: int | None, limit: int, q: str | None = None) -> tuple[list[dict], bool]:
        """id < before 的最多 limit 条（before 为 None 从最新算起）。q 为 None 时旧到新；有 q 时只要正文含 q 的，新到旧。
        返回 (消息, 更早还有没有)。"""
        sql, args = "SELECT * FROM messages WHERE room_id=?", [room_id]
        if before is not None:
            sql += " AND id<?"; args.append(before)
        if q is not None:   # LIKE 的通配符当普通字符
            sql += " AND text LIKE ? ESCAPE '\\'"
            args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        rows = [dict(r) for r in self.db.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, limit + 1))]
        more = len(rows) > limit
        rows = rows[:limit]
        return (rows if q is not None else rows[::-1]), more

    def web_ready(self, room_id: int, messages: list[dict]) -> dict:
        """网页 ready 帧多带的：已读位置、未读数、这批消息之前还有没有（网页据此决定要不要往上加载）。
        只给网页：已读起点只看网页（主机连上不算用户看过）。"""
        first = min((m["id"] for m in messages), default=None)
        more = first is not None and self.db.execute(
            "SELECT 1 FROM messages WHERE room_id=? AND id<? LIMIT 1", (room_id, first)).fetchone() is not None
        return {"last_read": self.last_read(room_id), "unread": self.unread(room_id), "has_more": more}

    def last_read(self, room_id: int) -> int:
        """这个频道读到哪条。还没记过就从当前最新一条算起（老消息不算未读）并记下。"""
        r = self.db.execute("SELECT last_read FROM reads WHERE room_id=?", (room_id,)).fetchone()
        if r:
            return r["last_read"]
        v = self.last_id(room_id)
        self.db.execute("INSERT INTO reads(room_id, last_read) VALUES(?, ?)", (room_id, v))
        self.db.commit()
        return v

    def set_read(self, room_id: int, body: object) -> int:
        """网页看到底了：已读位置只往前挪，不超过最新一条。返回挪完的位置。"""
        v = body.get("last_read") if isinstance(body, dict) else None
        if not isinstance(v, int) or isinstance(v, bool) or v < 0:
            raise BadRequest("body must be {last_read: id}")
        v = max(self.last_read(room_id), min(v, self.last_id(room_id)))
        self.db.execute("UPDATE reads SET last_read=? WHERE room_id=?", (v, room_id))
        self.db.commit()
        return v

    def unread(self, room_id: int) -> int:
        """已读位置之后别人（角色、系统）发了几条；自己发的不算。"""
        return self.db.execute("SELECT COUNT(*) FROM messages WHERE room_id=? AND id>? AND author_kind!='user'",
                               (room_id, self.last_read(room_id))).fetchone()[0]

    def last_id(self, room_id: int | None) -> int:
        """发过的最大消息 id（含已删除的），没有为 0（角色主机用来发现云端库被清空）。
        取 AUTOINCREMENT 的序列值：用户删了最新一条，主机已读位置不会被误判成“比云端还大”而退回。
        序列是全库一个（不分频道），所以给了 room_id 时返回的也可能是别的频道里更新的 id：只用来比“云端是不是被清空了”，
        以及新频道已读起点（从当前最新算起）。room_id=None：全部频道（订了全部频道的主机）。"""
        seq = self.db.execute("SELECT seq FROM sqlite_sequence WHERE name='messages'").fetchone()
        where, args = ("", ()) if room_id is None else (" WHERE room_id=?", (room_id,))
        top = self.db.execute(f"SELECT COALESCE(MAX(id), 0) FROM messages{where}", args).fetchone()[0]
        return max(seq[0] if seq else 0, top)

    def message(self, msg_id: int) -> dict | None:
        r = self.db.execute("SELECT * FROM messages WHERE id=?", (msg_id,)).fetchone()
        return dict(r) if r else None

    def cards_upto(self, room_id: int, since: int) -> list[dict]:
        """这个频道 id <= since 的进度卡片（最近 HISTORY_LIMIT 张）：网页断线重连时卡片可能已经改过（审查第 2 条）。"""
        return [dict(r) for r in self.db.execute(
            "SELECT * FROM (SELECT * FROM messages WHERE room_id=? AND id<=? AND card IS NOT NULL ORDER BY id DESC LIMIT ?)"
            " ORDER BY id", (room_id, since, HISTORY_LIMIT))]

    def create(self, room_id: int, body: object, max_chars: int = MAX_TEXT_CHARS,
               card: str | None = None, from_turn: bool = False) -> tuple[dict, bool]:
        """返回 (消息, 是否新建)。同一个 client_key 重发时不再插入，直接返回已有那条。
        max_chars、card、from_turn 只给 rh/cloudweb.py 用（bot 回复的上限、进度卡片、会话里写的回复），HTTP 发的消息照旧。"""
        if not isinstance(body, dict):
            raise BadRequest("body must be an object")
        key = body.get("client_key")
        if key is not None and not (isinstance(key, str) and 0 < len(key) <= MAX_KEY):
            raise BadRequest("bad client_key")
        if key is not None:
            r = self.db.execute("SELECT id FROM messages WHERE client_key=?", (key,)).fetchone()
            if r:
                return self.message(r["id"]), False
        room = self.room(room_id)
        if room is not None and room["archived_at"] is not None:
            raise Conflict("频道已归档，先恢复才能发消息")
        kind = body.get("author_kind", "user")
        if kind not in KINDS:
            raise BadRequest("bad author_kind")
        text = body.get("text")
        if not isinstance(text, str) or not clean(text, max_chars):
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
            " client_key, card, from_turn) VALUES(?,?,?,?,?,?,NULL,?,?,?,?,?)",
            (room_id, kind, author, name, clean(text, max_chars), status, now, now, key, card, 1 if from_turn else None))
        self.db.commit()
        return self.message(cur.lastrowid), True

    def update(self, msg_id: int, body: object) -> dict | None:
        """角色主机改自己发的角色消息状态：speaking -> done / interrupted（带已说出字数）。
        用户改自己发的用户消息正文（{"text": ...}）：updated_at 晚于 created_at 即“已编辑”。系统消息不能改。
        改正文不再交给角色主机重答（主机按 id 只处理新消息，rh/host.py _handle_message）。"""
        if not isinstance(body, dict):
            raise BadRequest("body must be an object")
        msg = self.message(msg_id)
        if msg is None:
            return None
        if msg["author_kind"] == "user" and set(body) == {"text"}:
            self._writable(msg)
            text = body["text"]
            if not isinstance(text, str) or not clean(text):
                raise BadRequest("text must be a non-empty string")
            self.db.execute("UPDATE messages SET text=?, updated_at=? WHERE id=?", (clean(text), time.time(), msg_id))
            self.db.commit()
            return self.message(msg_id)
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

    def _writable(self, msg: dict) -> None:
        """归档的频道只读（多频道）：用户改、删自己的消息也不行（角色主机改状态照常，归档时要把在说的改成被打断）。"""
        room = self.room(msg["room_id"])
        if room is not None and room["archived_at"] is not None:
            raise Conflict("频道已归档，先恢复才能改、删消息")

    def delete(self, msg_id: int) -> dict | None:
        """用户删自己发的用户消息；角色、系统消息不能删。返回被删的那条，没有为 None。"""
        msg = self.message(msg_id)
        if msg is None:
            return None
        if msg["author_kind"] != "user":
            raise BadRequest("only user messages can be deleted")
        self._writable(msg)
        self.db.execute("DELETE FROM messages WHERE id=?", (msg_id,))
        self.db.commit()
        return msg

    def interrupt_speaking(self, room_id: int | None) -> list[dict]:
        """角色主机掉线：它没说完的话不能一直亮着，改成被打断（已说字数未知）。room_id=None：所有频道。"""
        where, args = ("", ()) if room_id is None else ("room_id=? AND ", (room_id,))
        ids = [r["id"] for r in self.db.execute(
            f"SELECT id FROM messages WHERE {where}status='speaking'", args)]
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

    def ready(self, ws: web.WebSocketResponse, since: int | None) -> str:
        """连上或切频道时发的 ready 帧。订了全部频道的主机拿所有频道的消息。"""
        info = self.subs[ws]
        scope = None if info.get("all") else info["room"]
        messages = self.history(scope, since)
        return json.dumps({
            "type": "ready", "room": self.room(info["room"]), "rooms": self.rooms(True), "members": self.members(),
            "messages": messages, "last_id": self.last_id(scope),
            "devices": self.device_roles(), "mic": self.mic_on(), "thinking": self.thinking.get(info["room"]),
            "bots": self.bot_list(), "bots_thinking": self.bot_thinking.get(info["room"], []),
            "volumes": self.volumes,
            # 网页多带已读位置、未读数、has_more（rh-history.js）；切频道的 join 也走这里，换过去就有 has_more
            **(self.web_ready(info["room"], messages) if info["kind"] == "web" else {}),
            # 断线重连（带 since）的网页：已经有的卡片换成最新样子（rh-client.js 只更新已加载的）
            **({"cards": self.cards_upto(info["room"], since)} if info["kind"] == "web" and since is not None else {})},
            ensure_ascii=False)

    async def rooms_changed(self) -> None:
        await self.broadcast({"type": "rooms", "rooms": self.rooms(True)})

    async def from_web(self, ws: web.WebSocketResponse, d: dict) -> None:
        if d.get("type") == "join":
            # 切频道：同一条连接换订阅（开了声音的设备不受影响），发新频道的 ready。
            room_id = d.get("room")
            if isinstance(room_id, int) and not isinstance(room_id, bool) and self.room(room_id) is not None:
                self.subs[ws]["room"] = room_id
                await self._send(ws, self.ready(ws, None))
            return
        if d.get("type") == "device_hello":
            roles = d.get("roles")
            if not (isinstance(roles, list) and all(isinstance(r, str) and 0 < len(r) <= MAX_NAME for r in roles)):
                return
            self.devices[ws] = set(roles)
            await self.notify_devices()
        elif d.get("type") == "ping":   # 手机锁屏回来时连接可能已死而浏览器不知道，网页发 ping 探一下
            await self._send(ws, json.dumps({"type": "pong"}))
        elif d.get("type") == "receipt":
            pid, result = d.get("play_id"), d.get("result")
            play = self.plays.get(pid) if isinstance(pid, str) else None
            if play is None or play["ws"] is not ws or result not in RECEIPTS:
                return   # 不是发给这个页面的（重复页面、旧播放），不认
            del self.plays[pid]
            await self.to_hosts({"type": "receipt", "play_id": pid, "role": play["role"], "result": result,
                                 "started": d.get("started") is True})

    async def set_thinking(self, room_id: int, role: str | None) -> None:
        if self.thinking.get(room_id) != role:
            if role is None:
                self.thinking.pop(room_id, None)
            else:
                self.thinking[room_id] = role
            await self.broadcast({"type": "thinking", "role": role, "room": room_id}, room_id)

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
            role, room_id = d.get("role"), d.get("room", self.first_room())   # 旧主机不带 room：默认频道
            if (role is None or (isinstance(role, str) and 0 < len(role) <= MAX_NAME)) and \
                    isinstance(room_id, int) and self.room(room_id) is not None:
                await self.set_thinking(room_id, role)
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
        for room_id in list(self.thinking):
            await self.set_thinking(room_id, None)
        await self.set_volumes({})   # 板子挂在主机上：主机不在就不知道音量
        plays, self.plays = self.plays, {}
        for pid, play in plays.items():
            self.out(play["ws"]).put(json.dumps({"type": "device", "event": "stop", "role": play["role"],
                                                 "play_id": pid}), pid, stop=True)

    async def notify_new(self, msg: dict) -> None:
        for f in self.listeners:
            await f(msg)

    # ---------- 手机通知（Web Push） ----------
    def push_subs(self) -> list[dict]:
        return [dict(r) for r in self.db.execute("SELECT * FROM push_subs ORDER BY created_at")]

    def add_push_sub(self, body: object, origin: str) -> None:
        """body 是网页 PushSubscription.toJSON()：{endpoint, keys: {p256dh, auth}}。"""
        keys = body.get("keys") if isinstance(body, dict) else None
        ep = body.get("endpoint") if isinstance(body, dict) else None
        if not (isinstance(ep, str) and len(ep) <= MAX_ENDPOINT and self.push_endpoint_ok(ep)
                and isinstance(keys, dict) and webpush.valid_keys(keys.get("p256dh"), keys.get("auth"))):
            raise BadRequest("body must be a PushSubscription {endpoint: 已知推送服务的 https 地址, keys: {p256dh, auth}}")
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO push_subs(endpoint, p256dh, auth, origin, created_at) VALUES(?,?,?,?,?)",
                            (ep, keys["p256dh"], keys["auth"], origin, time.time()))

    def push_endpoint_ok(self, ep: str) -> bool:
        """https、没有用户名密码、默认端口、域名在 PUSH_HOSTS 里或以 PUSH_HOST_SUFFIXES 结尾。
        push_insecure_ok（只有测试）：另外放行本机 http 的假推送服务。"""
        try:
            u = urlsplit(ep)
            host, port = u.hostname or "", u.port
        except ValueError:
            return False
        if self.push_insecure_ok and u.scheme == "http" and host == "127.0.0.1":
            return True
        return (u.scheme == "https" and u.username is None and u.password is None and port in (None, 443)
                and (host in PUSH_HOSTS or host.endswith(PUSH_HOST_SUFFIXES)))

    def mentions_me(self, text: str) -> bool:
        return any(self.me_re.search(seg) for seg in text.split(FENCE)[::2])   # 奇数段在代码块里

    def push_for(self, msg: dict, notify: bool = False) -> dict | None:
        """这条要不要推、推什么。notify：主机发的系统消息自己说要推（出错、等批准）。"""
        if msg["author_kind"] == "role" and self.mentions_me(msg["text"]):
            who = msg["name"]
        elif msg["author_kind"] == "system" and notify:
            who = "角色小家"
        else:
            return None
        room = self.room(msg["room_id"])
        body = self.me_re.sub(lambda m: m.group(0) if m.group(0).startswith("@") else "@用户", msg["text"])
        return {"title": f"{who}（#{room['name'] if room else msg['room_id']}）", "body": body[:PUSH_BODY],
                "room": msg["room_id"], "id": msg["id"], "tag": f"m{msg['id']}"}

    async def _push_listener(self, msg: dict) -> None:
        self.push_soon(msg)

    def push_soon(self, msg: dict, notify: bool = False) -> None:
        """后台发，不拖慢发消息的请求。"""
        payload = self.push_for(msg, notify)
        if payload is None:
            return
        subs = self.push_subs()
        if not subs:
            return
        t = asyncio.ensure_future(self._push(subs, json.dumps(payload, ensure_ascii=False).encode()))
        self.push_tasks.add(t)
        t.add_done_callback(self.push_tasks.discard)

    async def _push(self, subs: list[dict], data: bytes) -> None:
        import aiohttp
        if self.push_http is None:
            self.push_http = aiohttp.ClientSession()
        async def one(sub):
            host = urlsplit(sub["endpoint"]).netloc   # 日志只写推送服务的域名：endpoint 本身等于这台设备的收件地址
            try:
                st = await webpush.send(self.push_http, sub, data, self.vapid, sub["origin"])
            except Exception as e:
                print(f"[push] 没推出去（{host}）：{type(e).__name__}", file=sys.stderr, flush=True)
                return
            if st in (404, 410):   # RFC 8030 第 7.3 节：订阅没了
                self.db.execute("DELETE FROM push_subs WHERE endpoint=?", (sub["endpoint"],))
                self.db.commit()
            elif st >= 300:
                print(f"[push] 推送服务回 {st}（{host}）", file=sys.stderr, flush=True)
        await asyncio.gather(*(one(s) for s in subs))

    async def close_push(self) -> None:
        for t in list(self.push_tasks):
            t.cancel()
        if self.push_http is not None:
            await self.push_http.close()
            self.push_http = None

    # ---------- 推送 ----------
    async def broadcast(self, payload: dict, room_id: int | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        targets = [ws for ws, info in self.subs.items()
                   if room_id is None or info["room"] == room_id or info.get("all")]
        await asyncio.gather(*(self._send(ws, data) for ws in targets))

    async def _send(self, ws: web.WebSocketResponse, data: str) -> None:
        try:
            await ws.send_str(data)
        except Exception:  # 对方已断，等它的处理协程自己清理
            pass


# ---------- HTTP ----------
HUB_KEY = web.AppKey("hub", Hub)
HISTORY_ROUTE = re.compile(r"/api/rooms/[^/]+/messages")   # GET /api/rooms/{room}/messages，bot 的 token 也能读


def make_app(hub: Hub) -> web.Application:
    @web.middleware
    async def auth(request: web.Request, handler):
        if request.path.startswith("/api/"):
            h = request.headers.get("Authorization", "")
            tok = h[len("Bearer "):] if h.startswith("Bearer ") else None
            # bot 的 token 只能读频道历史（cc-connect 补发用，见文件头「历史与未读」），别的接口照旧只认网页的 token
            bot_read = request.method == "GET" and HISTORY_ROUTE.fullmatch(request.path) is not None
            if not (hub.token_ok(tok) or bot_read and hub.bot_token_ok(tok)):
                raise web.HTTPUnauthorized(text="unauthorized")
        try:
            return await handler(request)
        except BadRequest as e:
            raise web.HTTPBadRequest(text=str(e))
        except Conflict as e:
            raise web.HTTPConflict(text=str(e))

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

    async def md_js(request):
        return web.FileResponse(STATIC / "rh-md.js", headers={"Cache-Control": "no-store"})

    async def index(request):
        return web.FileResponse(STATIC / "hub.html", headers={"Cache-Control": "no-store"})

    async def to_https(request):   # 旧 http 地址把 token 带到 https（rh/static/to-https.html）
        return web.FileResponse(STATIC / "to-https.html", headers={"Cache-Control": "no-store"})

    async def history_js(request):
        return web.FileResponse(STATIC / "rh-history.js", headers={"Cache-Control": "no-store"})

    def int_param(request: web.Request, name: str, lo: int, hi: int | None, default: int | None) -> int | None:
        raw = request.query.get(name)
        if raw is None:
            return default
        try:
            v = int(raw)
        except ValueError:
            raise BadRequest(f"bad {name}")
        if v < lo or (hi is not None and v > hi):
            raise BadRequest(f"bad {name}")
        return v

    async def get_messages(request):
        room_id = room_or_404(request)
        before = int_param(request, "before", 1, SQLITE_MAX_INT, None)
        # 一页最多 HISTORY_LIMIT 条（同连上时给的最近历史）。
        limit = int_param(request, "limit", 1, HISTORY_LIMIT, HISTORY_LIMIT)
        q = request.query.get("q")
        if q is not None and not (0 < len(q.strip()) and len(q) <= MAX_TEXT_CHARS):   # 搜的字不会比一条消息长
            raise BadRequest("bad q")
        msgs, more = hub.page(room_id, before, limit, q.strip() if q is not None else None)
        return web.json_response({"messages": msgs, "has_more": more})

    async def post_read(request):
        room_id = room_or_404(request)
        v = hub.set_read(room_id, await body_json(request))
        await hub.broadcast({"type": "read", "room": room_id, "last_read": v}, room_id)
        return web.json_response({"room": room_id, "last_read": v})

    async def get_rooms(request):
        return web.json_response(hub.rooms(request.query.get("archived") == "1"))

    async def post_room(request):
        room = hub.create_room(await body_json(request))
        await hub.rooms_changed()
        return web.json_response(room)

    async def patch_room(request):
        room_id = room_or_404(request)
        room = hub.update_room(room_id, await body_json(request))
        if room["archived_at"] is not None:
            await on_archived(room_id)
        await hub.rooms_changed()
        return web.json_response(room)

    async def delete_room(request):
        room_id = room_or_404(request)
        room = hub.update_room(room_id, {"archived": True})
        await on_archived(room_id)
        await hub.rooms_changed()
        return web.json_response(room)

    async def on_archived(room_id: int) -> None:
        # 归档后没人会再改这个频道里“在说”的状态（主机停掉它的会话），改成被打断；思考中也清掉。
        for m in hub.interrupt_speaking(room_id):
            await hub.broadcast({"type": "message", "message": m}, room_id)
        await hub.set_thinking(room_id, None)
        for b in list(hub.bot_thinking.get(room_id, [])):
            await hub.set_bot_thinking(room_id, b, False)

    async def put_members(request):
        members = hub.set_members(await body_json(request, MAX_MEMBERS_BODY))
        await hub.broadcast({"type": "members", "members": members})
        return web.json_response(members)

    async def post_message(request):
        room_id = room_or_404(request)
        body = await body_json(request)
        msg, new = hub.create(room_id, body)
        if new:
            await hub.broadcast({"type": "message", "message": msg}, room_id)
            await hub.notify_new(msg)
            if isinstance(body, dict) and body.get("notify") is True and msg["author_kind"] == "system":
                hub.push_soon(msg, notify=True)   # 主机说这条要推（出错、等批准）
        return web.json_response(msg)

    async def get_push(request):
        return web.json_response({"key": hub.vapid.public_key})

    async def post_push(request):
        body = await body_json(request)
        # VAPID 的 sub 用网页自己的地址（浏览器 POST 都带 Origin），不把公网 IP 写进仓库。
        # 只认 https 的 Origin（苹果要求 sub 是 https 网址或 mailto）；别的退回 https://请求的 Host（代码审查第 2 条）
        o = request.headers.get("Origin", "")
        origin = o if o.startswith("https://") and len(o) <= MAX_ENDPOINT and urlsplit(o).netloc else f"https://{request.host}"
        hub.add_push_sub(body, origin)
        return web.json_response({"ok": True})

    async def push_js(request):
        return web.FileResponse(STATIC / "rh-push.js", headers={"Cache-Control": "no-store"})

    async def service_worker(request):
        # 放在根路径：service worker 只管得到它自己所在目录以下（scope "/"）
        return web.FileResponse(STATIC / "sw.js", headers={"Cache-Control": "no-cache"})

    async def manifest(request):
        return web.FileResponse(STATIC / "manifest.webmanifest",
                                headers={"Content-Type": "application/manifest+json", "Cache-Control": "no-cache"})

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

    async def delete_message(request):
        try:
            msg_id = int(request.match_info["id"])
        except ValueError:
            raise web.HTTPNotFound()
        msg = hub.delete(msg_id)
        if msg is None:
            raise web.HTTPNotFound()
        await hub.broadcast({"type": "deleted", "id": msg_id, "room_id": msg["room_id"]}, msg["room_id"])
        return web.json_response({"id": msg_id})

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
        all_rooms = hello.get("kind") == "host" and hello.get("rooms") == "all"   # 主机订全部频道
        if (not isinstance(room_id, int) or isinstance(room_id, bool) or not 0 < room_id <= SQLITE_MAX_INT
                or hub.room(room_id) is None
                or (since is not None and (not isinstance(since, int) or isinstance(since, bool)
                                           or not 0 <= since <= SQLITE_MAX_INT))):
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
            for m in hub.interrupt_speaking(None if all_rooms else room_id):
                await hub.broadcast({"type": "message", "message": m}, m["room_id"])
        # 先登记再取历史：两步之间没有 await，不会漏掉中间插进来的消息。
        hub.subs[ws] = {"room": room_id, "kind": kind, "all": all_rooms}
        try:
            await ws.send_str(hub.ready(ws, since))
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
            if kind == "host" and not any(i["kind"] == "host" and (i["room"] == room_id or i.get("all"))
                                          for i in hub.subs.values()):
                for m in hub.interrupt_speaking(None if all_rooms else room_id):
                    await hub.broadcast({"type": "message", "message": m}, m["room_id"])
        return ws

    # 总上限按最大的那种请求（成员表带头像）放；每个接口在 body_json 里再按自己的上限查。
    app = web.Application(middlewares=[auth], client_max_size=MAX_MEMBERS_BODY)
    app.add_routes([
        web.get("/", index),
        web.get("/ws", ws_handler),
        web.get("/ws/host", ws_host_handler),
        web.get("/queue-player.js", player_js),
        web.get("/rh-client.js", client_js),
        web.get("/rh-history.js", history_js),
        web.get("/to-https", to_https),
        web.put("/api/members", put_members),
        web.get("/api/rooms", get_rooms),
        web.post("/api/rooms", post_room),
        web.patch("/api/rooms/{room}", patch_room),
        web.delete("/api/rooms/{room}", delete_room),
        web.post("/api/rooms/{room}/messages", post_message),
        web.get("/api/rooms/{room}/messages", get_messages),
        web.post("/api/rooms/{room}/read", post_read),
        web.patch("/api/messages/{id}", patch_message),
        web.delete("/api/messages/{id}", delete_message),
        web.get("/rh-md.js", md_js),
        web.post("/api/mic", post_mic),
        web.post("/api/volume", post_volume),
        web.get("/api/push", get_push),
        web.post("/api/push", post_push),
        web.get("/rh-push.js", push_js),
        web.get("/sw.js", service_worker),
        web.get("/manifest.webmanifest", manifest),
        web.static("/icons", STATIC / "icons"),
    ])
    cloudweb.attach(app, hub)   # cc-connect 的 bot 从 /cloud-web/ws 接进来（rh/cloudweb.py）
    if AVATARS.is_dir():
        app.add_routes([web.static("/avatars", AVATARS)])

    async def close_all(app):  # 关服务时主动断开所有 WebSocket，否则 aiohttp 要等它们自己断
        for ws in list(hub.subs):
            await ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown")

    app.on_shutdown.append(close_all)

    async def close_push(app):
        await hub.close_push()

    app.on_cleanup.append(close_push)
    app[HUB_KEY] = hub
    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    # 默认端口 8790。来源：实现者定；vps-arm 上 `ss -ltnp` 未占用，外网实测可达（2026-10-18）。
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--db", default=str(Path(__file__).resolve().parent.parent / "data" / "hub.sqlite3"))
    a = ap.parse_args()
    # RH_USER_MENTION_ID：我的 Discord 用户 ID（可选）。bot 照 Discord 习惯写 <@它> 也算 @ 我，弹手机通知。
    hub = Hub(a.db, os.environ.get("RH_HUB_TOKEN", ""), os.environ.get("RH_BOT_TOKEN") or None,
              os.environ.get("RH_USER_MENTION_ID") or None)
    print(f"角色小家云端频道 http://{a.host}:{a.port}  数据库={a.db}", flush=True)
    web.run_app(make_app(hub), host=a.host, port=a.port, print=None)


if __name__ == "__main__":
    main()
