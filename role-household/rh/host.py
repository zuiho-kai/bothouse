"""本地角色主机：meeting / brain / lock 留在本机，作为 bot 客户端连云端频道（rh.hub）。

AI 是 `claude -p`，用用户自己的订阅，不能放云端；云端只做频道和网页。

- 收到用户消息就开讨论；角色发言（含“在说”状态和说完/被打断）发回云端，网页的虚拟头照旧亮。
- 断线自动重连；重连后补上断线期间的新话题（记住已读到的云端消息 id，存在 data/host-state-<云端地址>.json）。
- 断线就停讲：本机正在进行的讨论停掉，还没发上去的发言丢掉（云端那边已把“在说”改成被打断）。
  网页是云端的投影，云端看不到的讨论不该在本机继续，否则重连后旧发言排在新话题后面。

    uv run python -m rh.host [--hub http://...] [--config roles.toml] [--no-voice] [--feed-audio FILE]

语音默认开：麦克风（系统默认输入设备）常开收音，按停顿切句、转文字后作为用户消息发到云端频道；
角色发言用 roles.toml 里的 voice 合成：该角色有设备在线（网页点了“开声音”）就经 hub 推给设备播放，设备回执才交棒；
没有设备在线就用本机 Mac 喇叭播放，播完才交棒（rh/device.py）。--no-voice 关掉收音和播放（纯文字）。
--feed-audio 先把一段音频文件当麦克风输入喂一次（端到端自测用），再照常收麦克风。

云端地址和 token 从环境变量 RH_HUB_URL / RH_HUB_TOKEN 读，没有就读仓库根目录的 .env（不进 git）。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import signal
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp

from . import config as cfgmod
from .brain import ClaudeBrain
from .meeting import Meeting, Message
from .hub import WS_REPLACED
from . import voice as voicemod
from .device import DeviceSpeaker

ROOT = Path(__file__).resolve().parent.parent

RECONNECT_MIN = 1.0  # 重连/重试首次等待秒数，之后每次翻倍。来源：实现者定。
RECONNECT_MAX = 30.0  # 重连/重试最长等待秒数。来源：实现者定。
HEARTBEAT = 30.0  # WebSocket 心跳秒数，发现断掉的连接。来源：实现者定，和 rh/hub.py 的 HEARTBEAT 一致。
HTTP_TIMEOUT = 15.0  # 单次 HTTP 请求超时秒数。来源：实现者定。


def build(cfg: cfgmod.Config, log_path: Path, tts=None) -> Meeting:
    brains = {}
    for r in cfg.roles:
        others = [o.name for o in cfg.roles if o.id != r.id]
        brains[r.id] = ClaudeBrain(r, others, cfg.model, cfg.timeout_sec, ROOT / "data" / "sessions" / r.id)
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
                 config_dir: Path = ROOT, speaker: DeviceSpeaker | None = None):
        self.meeting = meeting
        self.speaker = speaker   # 推给设备、收回执；None = 不推设备
        if speaker is not None:
            speaker.link = self
        self.device_roles: set[str] = set()   # hub 说有设备在线的角色
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
        self._hub_ids: dict[int, int] = {}   # 本地 meeting 消息序号 -> 云端消息 id
        # 本进程的 id：和 meeting 消息序号拼成 client_key，重试同一条时云端去重（序号每次启动从 0 开始，所以要带进程 id）。
        self._boot = uuid.uuid4().hex
        self._stop = asyncio.Event()
        self.ready_timeout = HTTP_TIMEOUT   # 等 ready 帧的秒数，同单次 HTTP 请求超时
        self._idle = asyncio.Event()   # 没有请求在路上时为 set；退出前等它，让路上的请求回来补发“被打断”
        self._idle.set()
        self._gen = 0   # 连接代数：每次断线加 1，上一代没发出去的发言作废
        self._http: aiohttp.ClientSession | None = None
        self._said = 0   # 语音转出的用户消息序号，拼进 client_key

    # ---------- 语音输入 -> 云端 ----------
    def say_as_user(self, text: str) -> None:
        """收音线程里调用：把转出的文字作为用户消息发到云端频道（作者是用户）。
        和网页发的一样，云端推回来后由 _handle_message 交给 meeting，按发言锁规则打断在说的角色。"""
        loop = self._loop
        if loop is None or self._stop.is_set():
            return
        self._said += 1
        key = f"{self._boot}:voice:{self._said}"
        asyncio.run_coroutine_threadsafe(self._post_user(text, key), loop)

    async def _post_user(self, text: str, key: str) -> None:
        body = {"author_kind": "user", "text": text, "client_key": key}
        await self._retry(lambda: self._req(self._http, "POST", f"/api/rooms/{self.room}/messages", body))

    # ---------- 设备（DeviceSpeaker 在 meeting 线程里调用） ----------
    def device_online(self, role: str) -> bool:
        return self.connected.is_set() and role in self.device_roles

    def send_device(self, frames: list[dict]) -> bool:
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
            print(f"[device] 发给 hub 失败：{e!r}", flush=True)
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
    def _on_event(self, event: str, msg: Message) -> None:
        """meeting 线程里调用（持有 meeting 的锁），只丢进队列，不阻塞。"""
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (self._gen, event, msg))

    async def _sender(self, http: aiohttp.ClientSession) -> None:
        """按顺序把发言发到云端；网络失败就等重连后重试同一条，保证先后顺序不乱。"""
        members = [{"id": r.id, "name": r.name, "avatar": cfgmod.avatar_data_url(r, self.config_dir)}
                   for r in self.meeting.roles]
        await self._retry(lambda: self._req(http, "PUT", "/api/members", members))
        while True:
            gen, event, msg = await self._queue.get()
            await self._retry(lambda: self._push(http, event, msg, gen), gen)

    async def _push(self, http: aiohttp.ClientSession, event: str, msg: Message, gen: int | None = None) -> None:
        if event == "start":
            body = {"author_kind": "role", "author": msg.author, "name": msg.name,
                    "text": msg.text, "status": "speaking", "client_key": self._key(msg)}
            got = await self._req(http, "POST", f"/api/rooms/{self.room}/messages", body)
            if gen is not None and gen != self._gen:
                # 发出去时还是这一代，回来时已断线过（或被新主机踢了）：讨论已停，它的“说完”事件已作废，
                # 云端可能在清过“在说”之后才收到这条。马上改成被打断，否则它会一直亮着。
                try:
                    await self._req(http, "PATCH", f"/api/messages/{got['id']}", {"status": "interrupted"})
                except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as e:
                    print(f"[host] 补发“被打断”失败（云端下次主机连上时会清掉）：{e!r}", flush=True)
                return
            self._hub_ids[msg.id] = got["id"]
        elif event == "end":
            hub_id = self._hub_ids.pop(msg.id, None)
            if hub_id is not None:
                await self._req(http, "PATCH", f"/api/messages/{hub_id}",
                                {"status": msg.status, "spoken": msg.spoken})
        elif event == "system":
            await self._req(http, "POST", f"/api/rooms/{self.room}/messages",
                            {"author_kind": "system", "text": msg.text, "client_key": self._key(msg)})

    def _key(self, msg: Message) -> str:
        return f"{self._boot}:{msg.id}"

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
                print(f"[host] 发到云端失败，{delay:.0f} 秒后重试：{e!r}", flush=True)
            finally:
                self._idle.set()
            await asyncio.sleep(delay)   # 只有网络失败会走到这里
            delay = min(delay * 2, self.reconnect_max)

    # ---------- 云端 -> meeting ----------
    async def _handle_ready(self, ready: dict) -> None:
        self.room = ready["room"]["id"]
        self.device_roles = set(ready.get("devices", []))
        msgs = ready["messages"]
        last = ready.get("last_id", 0)
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
        missed = [m["text"] for m in msgs if m["id"] > self.cursor and m["author_kind"] == "user"]
        if missed:
            print(f"[host] 补上断线期间的 {len(missed)} 条用户消息", flush=True)
            await self._loop.run_in_executor(self._exec, self.meeting.user_say_many, missed)
        # 交给 meeting 之后才落盘：中间被杀的话，下次启动还会补这几条，不会丢。
        self.cursor = max(self.cursor, top)
        self._save_cursor()

    async def _handle_message(self, m: dict) -> None:
        if self.cursor is not None and m["id"] <= self.cursor:
            return   # 状态更新（多半是自己发的）或已处理过
        if m["author_kind"] == "user":
            await self._loop.run_in_executor(self._exec, self.meeting.user_say, m["text"])
        self.cursor = m["id"]   # 交给 meeting 之后才落盘，同上
        self._save_cursor()

    async def _session(self, http: aiohttp.ClientSession) -> None:
        ws_url = "ws" + self.hub[len("http"):] + "/ws/host"   # 主机专用入口（大帧上限，握手带 token 头）
        async with http.ws_connect(ws_url, heartbeat=HEARTBEAT) as ws:
            await ws.send_json({"type": "hello", "token": self.token, "kind": "host", "since": self.cursor})
            first = await ws.receive(timeout=self.ready_timeout)   # 云端不回 ready 就算连接失败，重连
            if first.type != aiohttp.WSMsgType.TEXT:
                raise ConnectionError(f"云端拒绝连接：{first.type} {ws.close_code}")
            await self._handle_ready(json.loads(first.data))
            self._ws = ws
            self.connected.set()
            print(f"[host] 已连上云端 {self.hub}，频道 {self.room}，已读到 {self.cursor}，"
                  f"有设备的角色 {sorted(self.device_roles) or '无'}", flush=True)
            async for frame in ws:
                if frame.type != aiohttp.WSMsgType.TEXT:
                    break
                data = json.loads(frame.data)
                if data.get("type") == "message":
                    await self._handle_message(data["message"])
                elif data.get("type") == "devices":
                    self.device_roles = set(data.get("roles", []))
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
                        print(f"[host] 连接云端失败：{e!r}", flush=True)
                    self.connected.clear()
                    self._ws = None
                    self.device_roles = set()
                    # 断线就停讲。先停 meeting 再加代数：停的时候发出的“被打断”事件也算上一代，一起丢掉。
                    self.meeting.stop()
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
    tts = None if a.no_voice else DeviceSpeaker(voicemod.SaySynth(), voicemod.SayTTS())
    meeting = build(cfg, Path(a.log), tts=tts)
    state = Path(a.state) if a.state else state_path_for(a.hub)
    host = Host(meeting, a.hub, token, state, config_dir=Path(a.config).resolve().parent, speaker=tts)
    listener = None
    asr = None if a.no_voice else voicemod.gateway_asr(a.asr_url, print)
    if asr is not None:
        def sources(stop):
            if a.feed_audio:
                yield voicemod.file_frames(a.feed_audio, os.environ.get("FFMPEG", "ffmpeg"))
            yield voicemod.mic_frames(stop)
        listener = voicemod.Listener(asr, host.say_as_user, sources)
    voices = "关" if a.no_voice else "、".join(f"{r.name}={r.voice or '无'}" for r in cfg.roles)
    print(f"角色主机 云端={a.hub}  模型={cfg.model}  播放={voices}  收音={'开' if listener else '关'}"
          f"  发言日志={a.log}", flush=True)

    async def runner():
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, host.stop)
        task = asyncio.create_task(host.run())   # stop() 后 run 自己收尾退出（会等路上的请求回来）
        await asyncio.sleep(0)   # 让 run 先记下事件循环，收音线程才能往里投消息
        if listener:
            listener.start()
        try:
            await task
        finally:
            if listener:
                listener.stop()

    try:
        asyncio.run(runner())
    finally:
        # 退出时杀掉还在跑的 claude，别留孤儿进程继续耗额度。
        for b in meeting.brains.values():
            b.cancel()
        if tts is not None:   # 还在念的 say 也杀掉，不留孤儿把话念完
            tts.close()


if __name__ == "__main__":
    main()
