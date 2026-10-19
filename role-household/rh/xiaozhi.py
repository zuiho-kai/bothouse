"""小智板子（ESP32 圆屏）当角色的设备：主机这一侧的小智协议服务（OTA 接口 + WebSocket）。

板子只是又一种“该角色的设备”，和网页虚拟头走同一套接口和交棒规则（rh/device.py）：
DeviceSpeaker 发来 start / audio / stop 三种事件，这里翻成小智协议推给板子，再按播放进度代发回执（done / stopped / lost /
no_device），DeviceSpeaker 收到回执才交棒；板子没连上就由它回落 Mac 喇叭。板子不会自己开口：这里只转发 DeviceSpeaker
给的内容，连上、重连、开机时不推任何问候或提示音。板子收音：绑定了角色的板子上传的麦克风 Opus 交给 on_mic
（主机接 rh/board_mic.py，进和 Mac 麦克风同一条收音链路）；没绑定的板子上传的丢掉；listen/abort 等消息只记日志。

协议出处（~/code/role-household-fw/RESEARCH.md 第 3 节）：78/xiaozhi-esp32 docs/websocket.md；
固件实现 main/protocols/websocket_protocol.cc、main/application.cc（tts/llm 消息处理）、main/ota.cc（OTA 回包解析）；
服务端参考 xinnan-tech/xiaozhi-esp32-server core/api/ota_handler.py、core/handle/sendAudioHandle.py。

    板子 --POST /xiaozhi/ota/（头 Device-Id=MAC）--> 主机：回 {"websocket":{"url","token"},"firmware":{当前版本，不升级},"server_time"}
                                                         不带 activation 段（带了板子屏上会显示激活码）
    板子 --WS /xiaozhi/v1/（头 Device-Id、Protocol-Version、Authorization）--> 主机
    板子 -> {"type":"hello",...,"audio_params":{opus,16000,1,60}}    主机 -> {"type":"hello","transport":"websocket","session_id",...}
    主机 -> {"type":"tts","state":"start"} {"type":"llm","emotion":...} {"type":"tts","state":"sentence_start","text":...}
         -> Opus 16k 单声道 60ms 一帧的二进制帧（按协议版本 1/2/3 加头）-> {"type":"tts","state":"stop"}

注意：原版固件 WebSocket 模式只在要说话时才建连（websocket_protocol.cc Start() 不连）。主机要随时推，固件得在联网后
主动 OpenAudioChannel、断了再连（固件侧改，见 README「小智板子」）。

板子和角色的对应写在 roles.toml 的 [[xiaozhi.boards]]（按 Device-Id 也就是 MAC 绑定）。没绑定的板子照样握手、保持连接
（免得它反复重连），但什么都不播，只记日志，方便用户照日志里的 MAC 去绑定。
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import struct
import subprocess
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Callable

from aiohttp import WSMsgType, web

# 下行音频采样率。来源：固件 hello 的 audio_params（main/protocols/websocket_protocol.cc 第 214 行）、任务「Opus 16k/60ms」。
SAMPLE_RATE = 16000
# 一帧毫秒数。来源：同上，websocket_protocol.cc 第 216 行 OPUS_FRAME_DURATION_MS、任务「60ms」。
FRAME_MS = 60
FRAME_SEC = FRAME_MS / 1000
# 板子缓冲里最多先放几帧，其余按一帧的节奏发；缓冲越少，「暂停」后板子上残留的声音越短。
# 来源：xinnan-tech/xiaozhi-esp32-server core/handle/sendAudioHandle.py 第 18 行 PRE_BUFFER_COUNT = 5。
PRE_BUFFER = 5
# 保活间隔秒数。来源：固件 main/protocols/protocol.cc 第 109 行 kTimeoutSeconds = 120（120 秒收不到服务端消息就当通道断了），取四分之一。
KEEPALIVE_SEC = 30.0
# WebSocket ping 间隔秒数：板子断电、掉 Wi-Fi 后的半开连接，ping 发出后半个间隔收不到 pong 就关掉（aiohttp heartbeat 的规则），
# 角色随即回落 Mac 喇叭。固件收到 ping 会回 pong（managed_components/78__esp-ml307/src/web_socket.cc 第 392-393 行）。
# 来源：和 rh/hub.py、rh/host.py 的 HEARTBEAT = 30 一致，也和上面 KEEPALIVE_SEC 同值。
HEARTBEAT_SEC = 30.0
# 说话时给板子的表情（llm 消息的 emotion）。来源：橘定的暂用值；固件按名字切表情（docs/websocket.md 的 llm 消息）。
SPEAK_EMOTION = "happy"

# 等板子回 MCP 的秒数。来源：实现者定（固件在主循环里执行工具后马上回包，mcp_server.cc DoToolCall；局域网内远小于这个数）。
MCP_TIMEOUT = 5.0
# 音量上下限。来源：固件 set_volume 工具的参数范围 0-100（main/mcp_server.cc 第 55 行）。
VOLUME_MIN, VOLUME_MAX = 0, 100
# 要升级固件但板子正在播时，隔多久再看一次它空下来没有（秒）。来源：实现者定（代码审查 2026-10-19 第 3 条：
# 只在该板空闲时发升级）；一帧 60 毫秒，一句话几秒，1 秒查一次足够及时，空转开销可忽略。
FW_IDLE_POLL_SEC = 1.0

OTA_PATH = "/xiaozhi/ota/"
FIRMWARE_PATH = "/xiaozhi/firmware/"
WS_PATH = "/xiaozhi/v1/"


def find_ffmpeg() -> str:
    """ffmpeg（编 Opus 用）：环境变量 FFMPEG > PATH > ~/.local/bin/ffmpeg（本机装在这里，launchd 起的进程 PATH 里没有它）。"""
    return os.environ.get("FFMPEG") or shutil.which("ffmpeg") or str(Path("~/.local/bin/ffmpeg").expanduser())


def ogg_packets(data: bytes) -> list[bytes]:
    """把 Ogg 容器拆成一个个包（跨页的包会拼起来）。页头格式见 RFC 3533 第 6 节。"""
    out, cur, i = [], b"", 0
    # Ogg 页头固定部分 27 字节，第 26 字节是段数（RFC 3533 第 6 节）
    while i + 27 <= len(data):
        if data[i:i + 4] != b"OggS":
            raise ValueError("不是 Ogg 数据")
        nseg = data[i + 26]
        table = data[i + 27:i + 27 + nseg]
        j = i + 27 + nseg
        for n in table:
            cur += data[j:j + n]
            j += n
            # 段长 255 表示包没完、接着下一段（RFC 3533 第 5 节）
            if n < 255:
                out.append(cur)
                cur = b""
        i = j
    return out


def encode_opus(wav: bytes, ffmpeg: str | None = None) -> list[bytes]:
    """一段 WAV（任意采样率）编成 Opus 16k 单声道 60 毫秒一帧的裸包列表（去掉 OpusHead / OpusTags 两个头包）。"""
    p = subprocess.run([ffmpeg or find_ffmpeg(), "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(SAMPLE_RATE),
                        "-c:a", "libopus", "-frame_duration", str(FRAME_MS), "-application", "voip", "-f", "ogg", "pipe:1"],
                       input=wav, capture_output=True, check=True)
    return [x for x in ogg_packets(p.stdout) if not x.startswith((b"OpusHead", b"OpusTags"))]


def frame(packet: bytes, version: int) -> bytes:
    """按协议版本给一帧 Opus 加头。来源：固件 main/protocols/protocol.h 的 BinaryProtocol2/3（大端），版本 1 是裸 Opus。"""
    # BinaryProtocol2：version、type=0(OPUS)、reserved、timestamp、payload_size（protocol.h 第 19-26 行）
    if version == 2:
        return struct.pack(">HHIII", 2, 0, 0, 0, len(packet)) + packet
    # BinaryProtocol3：type=0、reserved、payload_size（protocol.h 第 28-33 行）
    if version == 3:
        return struct.pack(">BBH", 0, 0, len(packet)) + packet
    return packet


def unframe(data: bytes, version: int) -> bytes:
    """板子上传的一帧去掉协议头，得到 Opus 包（frame() 的反过程；协议头格式同上，固件 main/protocols/protocol.h）。
    v2、v3 的帧类型不是音频（type != 0）或长度不对时返回空。"""
    if version == 2:
        if len(data) < 16:
            return b""
        _, typ, _, _, n = struct.unpack(">HHIII", data[:16])
        return data[16:16 + n] if typ == 0 and len(data) >= 16 + n else b""
    if version == 3:
        if len(data) < 4:
            return b""
        typ, _, n = struct.unpack(">BBH", data[:4])
        return data[4:4 + n] if typ == 0 and len(data) >= 4 + n else b""
    return data


def app_desc(image: bytes) -> tuple[str, str]:
    """ESP-IDF 应用镜像里的 esp_app_desc_t：(版本, app_elf_sha256 十六进制)。位置：镜像头 24 字节 + 段头 8 字节之后，
    magic 0xABCD5432；version 在描述符第 16 字节起 32 字节，app_elf_sha256 在第 144 字节起 32 字节
    （esp_app_format.h esp_app_desc_t；固件 main/boards/common/board.cc 报的 elf_sha256 就是它）。"""
    d = image[32:32 + 256]
    if len(d) < 176 or struct.unpack("<I", d[:4])[0] != 0xABCD5432:
        raise ValueError("不是 ESP-IDF 应用镜像")
    return d[16:48].split(b"\0")[0].decode(errors="replace"), d[144:176].hex()


def norm_device(dev: str) -> str:
    return dev.strip().lower().replace("-", ":")


class Board:
    """一块连着的板子和它当前这一次播放。"""

    def __init__(self, ws: web.WebSocketResponse, device: str, role: str | None, version: int):
        self.ws, self.device, self.role, self.version = ws, device, role, version
        self.session = uuid.uuid4().hex
        self.inbox: asyncio.Queue = asyncio.Queue()   # start / audio 事件按到达顺序处理（编码要时间，不能乱序）
        self.play: str | None = None                  # 正在播的 play_id
        self.packets: deque[bytes] = deque()
        self.encoded = 0                              # 这次播放编出来的 Opus 包数（一个都没有就回 failed）
        self.last = False                             # 已收到这次播放的最后一块
        self.wake = asyncio.Event()                   # 有新包、结束标记或被停：叫醒发包任务
        self.cancelled: set[str] = set()              # 已停的 play_id：还排在 inbox 里的同一播放作废
        self.volume: int | None = None                # 板子报上来的音量（0-100）；还没问到是 None
        self.mcp_id = 0
        self.mcp_wait: dict[int, asyncio.Future] = {}  # MCP 请求 id -> 等板子回包
        # 板子 hello 里报的屏幕（新固件才有，字段见 conest firmware/dial ScreenProfile::ToJson）；
        # 现在只记下来写日志，不据此改行为。老固件没有，是 None。
        self.display: dict | None = None


class XiaozhiServer:
    """主机里跑的小智协议服务。online / send / stop_all 可以在任何线程调用（DeviceSpeaker 在 meeting 线程里调）。

    on_receipt(play_id, result, started)：代板子发回执（接 DeviceSpeaker.on_receipt；started 只在 failed 时有意义）。on_change()：板子连上或断开（接 devices_changed）。
    on_volume()：哪块板子的音量变了（连上后问到、调过、断开），主机拿 volumes() 报给 hub 给网页显示。

    音量：用户 2026-10-19「声音太小了，预期可以我通过语音让它调大，或者说我在这个网页端可以调大」。
    走固件自带的 MCP 工具（docs/mcp-protocol.md）：连上后调 self.get_device_status 读当前音量，set_volume 调
    self.audio_speaker.set_volume。固件调完当场生效并写进 NVS（main/audio/audio_codec.cc SetOutputVolume），
    重启、重连都保留，所以主机不用每次连上再下发。
    """

    def __init__(self, boards: dict[str, str], token: str = "", port: int = 8791, host: str = "0.0.0.0",
                 on_receipt: Callable[..., None] = lambda pid, r, started=None: None, on_change: Callable[[], None] = lambda: None,
                 encoder: Callable[[bytes], list[bytes]] = encode_opus, log: Callable[[str], None] = lambda s: print(s, flush=True),
                 keepalive: float = KEEPALIVE_SEC, heartbeat: float = HEARTBEAT_SEC):
        self.bindings = {norm_device(k): v for k, v in boards.items()}
        self.token, self.port, self.bind = token, port, host
        self.on_receipt, self.on_change, self.encoder, self.log = on_receipt, on_change, encoder, log
        self.keepalive, self.heartbeat = keepalive, heartbeat
        self.by_role: dict[str, Board] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._runner: web.AppRunner | None = None
        self._tasks: set[asyncio.Task] = set()
        self.on_volume: Callable[[], None] = lambda: None
        # 表盘（rh/dial.py）：额外的 HTTP 路由（板子取头像图），和板子连上时的回调 on_board(role, 本机地址 http://ip:port)。
        self.routes: list[tuple[str, str, Callable]] = []
        self.on_board: Callable[[str, str], None] = lambda role, base: None
        # 板子主动发来的 MCP 通知（没有 id 的 JSON-RPC，比如表盘帧率 notifications/rh_dial_stats）：on_notify(角色, payload)。
        self.on_notify: Callable[[str | None, dict], None] = lambda role, payload: None
        # 板子收音（rh/board_mic.py）：on_mic(角色, Opus 包) 在事件循环里调，不能阻塞；on_mic_end(角色) 板子断开时调。
        self.on_mic: Callable[[str, bytes], None] | None = None
        self.on_mic_end: Callable[[str], None] = lambda role: None
        # 板子固件经 Wi-Fi 升级（main 里读环境变量 RH_XIAOZHI_FIRMWARE，指向编好的 xiaozhi.bin；None = 不管固件）。
        # 板子连上时用 MCP self.get_system_info 读它的 elf_sha256，和这个文件不一样就发 self.upgrade_firmware，
        # 板子自己下载、写另一个 OTA 分区、重启（不碰 nvs；新固件起不来 bootloader 会回滚）。同一块板子对同一个文件只发一次。
        self.firmware: Path | None = None
        # 已让升过的 (板子 MAC, 目标固件 elf_sha256)：记在这个文件里（一行一对，空格分隔），主机重启后也不再让同一块板子
        # 升同一个文件——坏固件回滚后不会每次重启都再升一遍（代码审查 2026-10-19 第 4 条）。None = 只记在内存。
        self.fw_asked_file: Path | None = None
        self._fw_asked: set[tuple[str, str]] | None = None   # 第一次用时从 fw_asked_file 读
        self._fw_busy: set[str] = set()                      # 正在等空闲 / 正在发升级的板子（同一块板子重连别并发两次）
        self._fw_cache: tuple[tuple, bytes, str, str] | None = None   # ((路径, mtime_ns, 大小), 内容, 版本, sha)

    # ---------- 起停 ----------
    def app(self) -> web.Application:
        a = web.Application()
        for p in (OTA_PATH, OTA_PATH.rstrip("/")):
            a.router.add_route("*", p, self._ota)
        for p in (WS_PATH, WS_PATH.rstrip("/")):
            a.router.add_get(p, self._ws)
        a.router.add_get(FIRMWARE_PATH + "{name}", self._firmware_file)
        for method, path, handler in self.routes:
            a.router.add_route(method, path, handler)
        return a

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._runner = web.AppRunner(self.app())
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.bind, self.port)
        await site.start()
        if not self.port:   # 测试传 0：用系统给的端口
            self.port = site._server.sockets[0].getsockname()[1]
        bound = "、".join(f"{d}={r}" for d, r in self.bindings.items()) or "无"
        self.log(f"[xiaozhi] 小智协议服务 http://{self.bind}:{self.port}{OTA_PATH}  已绑定的板子：{bound}")

    async def close(self) -> None:
        for b in list(self.by_role.values()):
            await b.ws.close()
        for t in list(self._tasks):
            t.cancel()
        if self._runner is not None:
            await self._runner.cleanup()

    def push(self, role: str, msg: dict) -> None:
        """任何线程可调：给 role 的板子发一条 JSON（表盘状态等）。板子不在线就丢掉。"""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        def go():
            b = self.by_role.get(role)
            if b is not None and not b.ws.closed:
                self._spawn(self._send_json(b, msg))
        loop.call_soon_threadsafe(go)

    # ---------- 给 DeviceSpeaker 用（经 Host 路由） ----------
    def online(self, role: str) -> bool:
        b = self.by_role.get(role)
        return b is not None and not b.ws.closed

    def send(self, frames: list[dict]) -> bool:
        loop = self._loop
        if loop is None or loop.is_closed():
            return False
        loop.call_soon_threadsafe(self._dispatch, frames)
        return True

    def stop_all(self) -> None:
        """安全词「暂停」：所有板子一起停。"""
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._stop_all)

    # ---------- 音量（MCP） ----------
    def volumes(self) -> dict[str, int]:
        """在线、已知音量的板子：{角色: 音量}。"""
        return {r: b.volume for r, b in self.by_role.items() if not b.ws.closed and b.volume is not None}

    def roles_online(self) -> list[str]:
        return [r for r, b in self.by_role.items() if not b.ws.closed]

    def set_volume(self, role: str, volume: int | None = None, step: int = 0):
        """任何线程可调：把 role 的板子音量设成 volume，或在当前音量上加 step（可为负）。夹在 0-100。
        返回 concurrent.futures.Future，结果是设好的音量；板子不在、没回包、报错时结果是 None。"""
        loop = self._loop
        if loop is None or loop.is_closed():
            return None
        return asyncio.run_coroutine_threadsafe(self.set_volume_async(role, volume, step), loop)

    async def set_volume_async(self, role: str, volume: int | None = None, step: int = 0) -> int | None:
        b = self.by_role.get(role)
        if b is None or b.ws.closed:
            self.log(f"[xiaozhi] {role} 没有板子在线，音量没调")
            return None
        if volume is None:
            await self._read_volume(b)   # 每次先读：板子上的音量键也会改音量，记着的可能过时
            if b.volume is None:
                self.log(f"[xiaozhi] {role} 的板子音量读不到，没调")
                return None
            volume = b.volume + step
        v = max(VOLUME_MIN, min(VOLUME_MAX, int(volume)))
        r = await self._mcp(b, "tools/call", {"name": "self.audio_speaker.set_volume", "arguments": {"volume": v}})
        if r is None or "error" in r:
            self.log(f"[xiaozhi] {role} 的板子没调成音量 {v}：{(r or {}).get('error', '没回包')}")
            return None
        old, b.volume = b.volume, v
        self.log(f"[xiaozhi] {role} 的板子音量 {old} → {v}（板子回 {r.get('result')}）")
        self.on_volume()
        return v

    async def _read_volume(self, b: Board) -> None:
        """self.get_device_status 回包 result.content[0].text 是 JSON，audio_speaker.volume 是音量
        （main/mcp_server.cc 的 self.get_device_status 工具、main/boards/common/wifi_board.cc 第 306 行）。"""
        r = await self._mcp(b, "tools/call", {"name": "self.get_device_status", "arguments": {}})
        try:
            status = json.loads(r["result"]["content"][0]["text"])
            b.volume = int(status["audio_speaker"]["volume"])
        except (TypeError, KeyError, IndexError, ValueError) as e:
            self.log(f"[xiaozhi] {b.role} 的板子状态读不出音量：{e!r} {str(r)[:200]}")
            return
        self.log(f"[xiaozhi] {b.role} 的板子当前音量 {b.volume}")
        self.on_volume()

    async def _mcp(self, b: Board, method: str, params: dict) -> dict | None:
        """发一条 MCP 请求（JSON-RPC 2.0，外面包 {"type":"mcp","payload":...}，docs/mcp-protocol.md），等回包。"""
        if b.ws.closed:
            return None
        b.mcp_id += 1
        i = b.mcp_id
        fut = asyncio.get_running_loop().create_future()
        b.mcp_wait[i] = fut
        try:
            await self._send_json(b, {"type": "mcp", "payload": {"jsonrpc": "2.0", "method": method, "params": params, "id": i}})
            return await asyncio.wait_for(fut, MCP_TIMEOUT)
        except (asyncio.TimeoutError, ConnectionError, RuntimeError):
            return None
        finally:
            b.mcp_wait.pop(i, None)

    def _mcp_reply(self, b: Board, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        if "id" not in payload and isinstance(payload.get("method"), str):
            self.on_notify(b.role, payload)
            return
        fut = b.mcp_wait.get(payload.get("id"))
        if fut is not None and not fut.done():
            fut.set_result(payload)

    def _stop_all(self) -> None:
        for b in list(self.by_role.values()):
            if b.play is not None:
                self._stop(b, b.play)
            # 还排在 inbox 里没开始的也作废
            while not b.inbox.empty():
                b.cancelled.add(b.inbox.get_nowait().get("play_id"))

    def _dispatch(self, frames: list[dict]) -> None:
        for f in frames:
            role, pid, ev = f.get("role"), f.get("play_id"), f.get("event")
            b = self.by_role.get(role)
            if b is None or b.ws.closed:
                if ev == "start":
                    self.on_receipt(pid, "no_device")
                continue
            if ev == "stop":
                self._stop(b, pid)   # 打断不排队，当场停
            else:
                b.inbox.put_nowait(f)

    # ---------- 播放 ----------
    async def _send_json(self, b: Board, d: dict) -> None:
        if not b.ws.closed:
            await b.ws.send_json({**d, "session_id": b.session})

    def _stop(self, b: Board, pid: str) -> None:
        b.cancelled.add(pid)
        if b.play != pid:
            return
        b.play, b.last = None, False
        b.packets.clear()
        b.wake.set()
        self._spawn(self._send_json(b, {"type": "tts", "state": "stop"}))
        self.log(f"[xiaozhi] {b.role} 停下 play={pid[:8]}")
        self.on_receipt(pid, "stopped")

    def _spawn(self, coro) -> None:
        t = asyncio.ensure_future(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def _worker(self, b: Board) -> None:
        """按顺序处理 start / audio：start 发 tts start + 表情 + 字幕；audio 编成 Opus 交给发包任务。"""
        while True:
            f = await b.inbox.get()
            pid = f.get("play_id")
            if pid in b.cancelled:
                continue
            if f["event"] == "start":
                if b.play is not None:   # 上一次还没播完就来了新的（正常不会发生）：先停掉上一次
                    self._stop(b, b.play)
                b.play, b.last, b.encoded = pid, False, 0
                b.packets.clear()
                msgs = [{"type": "tts", "state": "start"}, {"type": "llm", "text": "", "emotion": SPEAK_EMOTION}]
                if f.get("text"):
                    msgs.append({"type": "tts", "state": "sentence_start", "text": f["text"]})
                for m in msgs:
                    if b.play != pid:
                        break   # 发送途中被停了：不再补发表情、字幕（停下后屏上不该再冒字）
                    await self._send_json(b, m)
                if b.play == pid:
                    self.log(f"[xiaozhi] {b.role} 开始播 play={pid[:8]}（板子 {b.device}）")
            elif f["event"] == "audio" and pid == b.play:
                pk: list[bytes] = []
                if f.get("data"):
                    wav = base64.b64decode(f["data"])
                    try:
                        pk = await asyncio.get_running_loop().run_in_executor(None, self.encoder, wav)
                    except Exception as e:   # 编码失败：这一句跳过，不让发言锁卡住（最后一块照样结束这次播放）
                        self.log(f"[xiaozhi] {b.role} 编 Opus 失败，这句跳过：{e!r}")
                if pid != b.play:
                    continue   # 编码期间被停了
                b.packets.extend(pk)
                b.encoded += len(pk)
                if f.get("last") and not b.encoded:
                    # 一句都没编出来（如 ffmpeg 不可用）：板子不会出声，回 failed 且 started=False，DeviceSpeaker 改用 Mac 喇叭
                    b.play, b.last = None, False
                    await self._send_json(b, {"type": "tts", "state": "stop"})
                    self.log(f"[xiaozhi] {b.role} 一句都没编出 Opus，回 failed play={pid[:8]}")
                    self.on_receipt(pid, "failed", False)
                    continue
                if f.get("last"):
                    b.last = True
                b.wake.set()

    async def _pacer(self, b: Board) -> None:
        """按一帧 60 毫秒的节奏发包，板子缓冲里最多 PRE_BUFFER 帧；最后一帧播完发 tts stop 并代发回执 done。"""
        until = time.monotonic()   # 板子把已发的包播完的时刻
        while not b.ws.closed:
            if not b.packets:
                if b.last and b.play is not None:
                    pid = b.play
                    b.wake.clear()
                    try:   # 等板子播完；期间被停会叫醒
                        await asyncio.wait_for(b.wake.wait(), max(0.0, until - time.monotonic()))
                    except asyncio.TimeoutError:
                        pass
                    if b.play != pid or b.packets:
                        continue
                    b.play, b.last = None, False
                    await self._send_json(b, {"type": "tts", "state": "stop"})
                    self.log(f"[xiaozhi] {b.role} 播完 play={pid[:8]}")
                    self.on_receipt(pid, "done")
                    continue
                b.wake.clear()
                await b.wake.wait()
                continue
            now = time.monotonic()
            # 板子手里还剩不到 PRE_BUFFER - 1 帧没播时才补一帧，补完最多 PRE_BUFFER 帧
            ahead = until - now - (PRE_BUFFER - 1) * FRAME_SEC
            if ahead > 0:
                b.wake.clear()
                try:   # 等到该发下一帧；期间被停会叫醒
                    await asyncio.wait_for(b.wake.wait(), ahead)
                except asyncio.TimeoutError:
                    pass
                continue
            await b.ws.send_bytes(frame(b.packets.popleft(), b.version))
            until = max(until, now) + FRAME_SEC

    async def _ping(self, b: Board) -> None:
        """保活：固件 120 秒收不到服务端消息就断开音频通道。这个类型固件不认，只在板子日志里记一行，不出声、不改屏幕。"""
        while not b.ws.closed:
            await asyncio.sleep(self.keepalive)
            await self._send_json(b, {"type": "keepalive"})

    # ---------- HTTP / WebSocket ----------
    def _device_of(self, req: web.Request) -> str:
        return norm_device(req.headers.get("Device-Id", "") or req.query.get("device-id", ""))

    async def _firmware_image(self) -> tuple[bytes, str, str]:
        """固件文件内容、版本、elf_sha256。按 (路径, 修改时间, 大小) 缓存，读文件放线程里（几 MB，别卡事件循环）。"""
        path = self.firmware
        st = await asyncio.to_thread(path.stat)
        key = (str(path), st.st_mtime_ns, st.st_size)
        if self._fw_cache is None or self._fw_cache[0] != key:
            data = await asyncio.to_thread(path.read_bytes)
            version, sha = app_desc(data)
            self._fw_cache = (key, data, version, sha)
        return self._fw_cache[1:]

    def _asked(self) -> set[tuple[str, str]]:
        if self._fw_asked is None:
            self._fw_asked = set()
            if self.fw_asked_file is not None:
                try:
                    for line in self.fw_asked_file.read_text().splitlines():
                        parts = line.split()
                        if len(parts) == 2:
                            self._fw_asked.add((parts[0], parts[1]))
                except FileNotFoundError:
                    pass
                except OSError as e:
                    self.log(f"[xiaozhi] 升级记录 {self.fw_asked_file} 读不出：{e!r}，当没升过")
        return self._fw_asked

    def _remember_asked(self, device: str, sha: str) -> None:
        if (device, sha) in self._asked():
            return
        self._asked().add((device, sha))
        if self.fw_asked_file is None:
            return
        try:
            self.fw_asked_file.parent.mkdir(parents=True, exist_ok=True)
            with self.fw_asked_file.open("a") as f:
                f.write(f"{device} {sha}\n")
        except OSError as e:
            self.log(f"[xiaozhi] 升级记录 {self.fw_asked_file} 写不进：{e!r}（本次运行内仍不重试）")

    @staticmethod
    def _idle(b: Board) -> bool:
        """板子空闲：没在播、没有排队的播放、没有待发的包。"""
        return b.play is None and b.inbox.empty() and not b.packets

    async def _check_firmware(self, b: Board, base: str) -> None:
        try:
            _, version, want = await self._firmware_image()
        except (OSError, ValueError) as e:
            return self.log(f"[xiaozhi] 固件文件 {self.firmware} 读不出：{e!r}，不升级")
        r = await self._mcp(b, "tools/call", {"name": "self.get_system_info", "arguments": {}})
        try:
            info = json.loads(r["result"]["content"][0]["text"])
            have = str(info["application"]["elf_sha256"])
        except (TypeError, KeyError, IndexError, ValueError) as e:
            return self.log(f"[xiaozhi] {b.role} 的板子读不出固件版本：{e!r}，不升级")
        if have == want:
            return self.log(f"[xiaozhi] {b.role} 的板子固件已是 {want[:12]}")
        if (b.device, want) in self._asked():
            return self.log(f"[xiaozhi] {b.role} 的板子固件 {have[:12]} 还不是 {want[:12]}，已让它升过一次，不再重试")
        if b.device in self._fw_busy:
            return
        self._fw_busy.add(b.device)
        try:
            # 只在空闲时发：升级会关音频通道，正在播的句子会被切断（代码审查 2026-10-19 第 3 条）
            if not self._idle(b):
                self.log(f"[xiaozhi] {b.role} 的板子正在播，等它空下来再升级固件")
            while not self._idle(b):
                if b.ws.closed:
                    return
                await asyncio.sleep(FW_IDLE_POLL_SEC)
            if b.ws.closed:
                return
            # 地址带 device：板子来下载时就算「发成功」并记下（固件收到升级命令后先关音频通道再回包，
            # MCP 回包常常到不了主机，2026-10-19 实测橘的板子升级时就是「没回包」但已下载升级）
            url = f"{base}{FIRMWARE_PATH}{want[:16]}.bin?device={b.device}"
            self.log(f"[xiaozhi] {b.role} 的板子固件 {have[:12]} → {want[:12]}（{version}），让它从 {url} 升级")
            r = await self._mcp(b, "tools/call", {"name": "self.upgrade_firmware", "arguments": {"url": url}})
            if r is None or "error" in r:   # 没回包：不在这里记；板子真来下载了会在 _firmware_file 里记
                return self.log(f"[xiaozhi] {b.role} 的板子没回升级命令：{(r or {}).get('error', '没回包')}（来下载了才记为升过）")
            self._remember_asked(b.device, want)
        finally:
            self._fw_busy.discard(b.device)

    async def _firmware_file(self, req: web.Request) -> web.Response:
        if self.firmware is None:
            raise web.HTTPNotFound()
        try:
            data, _, sha = await self._firmware_image()
        except (OSError, ValueError):
            raise web.HTTPNotFound()
        if req.match_info["name"] != f"{sha[:16]}.bin":   # 文件换过了：旧地址不给
            raise web.HTTPNotFound()
        dev = norm_device(req.query.get("device", ""))
        if dev:   # 板子按升级命令来下载了：记为已让它升过
            self.log(f"[xiaozhi] 板子 {dev} 来下载固件 {sha[:12]}")
            self._remember_asked(dev, sha)
        return web.Response(body=data, content_type="application/octet-stream")

    def _local_ip(self, req: web.Request) -> str:
        """板子连进来用的那个本机地址（不用主机名：板子上 .local 解析不一定成功，这个地址板子一定连得通）。"""
        sock = req.transport.get_extra_info("sockname") if req.transport else None
        return sock[0] if sock else "127.0.0.1"

    async def _ota(self, req: web.Request) -> web.Response:
        dev = self._device_of(req)
        body = {}
        if req.method == "POST" and req.can_read_body:
            try:
                body = await req.json()
            except Exception:
                body = {}
        app = body.get("application") if isinstance(body, dict) else None
        current = str((app or {}).get("version") or "") if isinstance(app, dict) else ""
        url = f"ws://{self._local_ip(req)}:{self.port}{WS_PATH}"
        role = self.bindings.get(dev)
        self.log(f"[xiaozhi] OTA 请求 板子 {dev or '（没带 Device-Id）'} 版本 {current or '?'} "
                 f"{'绑定 ' + role if role else '未绑定（roles.toml [[xiaozhi.boards]] 里加它才会播）'}，回 {url}")
        lt = time.localtime()
        return web.json_response({
            # 毫秒时间戳、时区偏移分钟（xinnan ota_handler.py 回包同字段）
            "server_time": {"timestamp": int(time.time() * 1000), "timezone_offset": (lt.tm_gmtoff or 0) // 60},
            # 回板子自己的版本号：固件比较后认为已是最新，不升级（main/ota.cc 第 226-249 行）。不带 activation 段。
            "firmware": {"version": current, "url": ""},
            "websocket": {"url": url, "token": self.token},
        })

    async def _ws(self, req: web.Request) -> web.StreamResponse:
        dev = self._device_of(req)
        if self.token and req.headers.get("Authorization", "") != f"Bearer {self.token}":
            self.log(f"[xiaozhi] 板子 {dev} token 不对，拒绝")
            raise web.HTTPUnauthorized()
        try:
            version = int(req.headers.get("Protocol-Version", "1"))
        except ValueError:
            version = 1
        ws = web.WebSocketResponse(max_msg_size=0, heartbeat=self.heartbeat or None)
        await ws.prepare(req)
        role = self.bindings.get(dev)
        b = Board(ws, dev, role, version)
        tasks: list[asyncio.Task] = []
        try:
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    # 板子收音：只收绑了角色、而且是这个角色当前那块板子的；没接 on_mic 时丢掉
                    if self.on_mic is not None and role is not None and self.by_role.get(role) is b:
                        pk = unframe(msg.data, version)
                        if pk:
                            self.on_mic(role, pk)
                    continue
                if msg.type != WSMsgType.TEXT:
                    break
                try:
                    d = msg.json()
                except ValueError:
                    continue
                if d.get("type") == "mcp":
                    self._mcp_reply(b, d.get("payload"))
                    continue
                if d.get("type") != "hello":
                    self.log(f"[xiaozhi] 板子 {dev} 发来 {d.get('type')}"
                             f"{'/' + str(d.get('state')) if d.get('state') else ''}，不处理")
                    continue
                if tasks:
                    continue   # 重复的 hello
                if isinstance(d.get("display"), dict):
                    b.display = d["display"]
                    self.log(f"[xiaozhi] 板子 {dev} 的屏幕：{json.dumps(b.display, ensure_ascii=False)}")
                await ws.send_json({"type": "hello", "transport": "websocket", "session_id": b.session,
                                    "audio_params": {"format": "opus", "sample_rate": SAMPLE_RATE, "channels": 1,
                                                     "frame_duration": FRAME_MS}})
                tasks = [asyncio.ensure_future(self._ping(b))]
                if role is None:
                    self.log(f"[xiaozhi] 未绑定的板子 {dev} 连上了（协议 v{version}），不播任何东西；"
                             f"要用就在 roles.toml [[xiaozhi.boards]] 写 device = \"{dev}\" 和 role")
                    continue
                old = self.by_role.get(role)
                if old is not None and old.device != dev and not old.ws.closed:
                    # 同一角色绑了两块板子：只用先连上的那块，这块当没绑定（不踢掉对方，免得两块互相踢）
                    self.log(f"[xiaozhi] {role} 已有板子 {old.device} 连着，板子 {dev} 不播任何东西")
                    continue
                self.by_role[role] = b
                tasks += [asyncio.ensure_future(self._worker(b)), asyncio.ensure_future(self._pacer(b))]
                if old is not None:
                    self.log(f"[xiaozhi] {role} 的板子重新连上，旧连接关掉")
                    await old.ws.close()
                self.log(f"[xiaozhi] {role} 的板子 {dev} 连上了（协议 v{version}）")
                self.on_board(role, f"http://{self._local_ip(req)}:{self.port}")   # 表盘：告诉板子它是谁
                self.on_change()
                self._spawn(self._read_volume(b))   # 读当前音量给网页显示（固件自己记着音量，不用下发）
                if self.firmware is not None:
                    self._spawn(self._check_firmware(b, f"http://{self._local_ip(req)}:{self.port}"))
        finally:
            for t in tasks:
                t.cancel()
            if role is not None and self.by_role.get(role) is b:
                del self.by_role[role]
                self.on_mic_end(role)
                self.log(f"[xiaozhi] {role} 的板子 {dev} 断开")
                self.on_change()
                self.on_volume()
            if b.play is not None:
                pid, b.play = b.play, None
                self.on_receipt(pid, "lost")   # 播到一半断了：交棒，DeviceSpeaker 下一句起回落 Mac 喇叭
            await ws.close()
        return ws
