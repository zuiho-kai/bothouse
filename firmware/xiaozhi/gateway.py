"""小智板子 ↔ 8796 设备接口的转接服务。

板子刷的是小智固件（78/xiaozhi-esp32 v2.5.2 + role-household 的 rh 补丁 + conest 补丁），
它只会说小智协议：先 POST /xiaozhi/ota/ 拿 WebSocket 地址，再在 WebSocket 上收发 Opus。
8796 只懂自己的设备接口（/device/<id>/api/transcribe、/turn、/audio/chunks/<n>、/playback）。
这里在两者之间翻译，8796 本身一行不改：

    板子按住 BOOT -> {"type":"listen","state":"start","mode":"manual"} + Opus 帧
    松开         -> {"type":"listen","state":"stop"}
    唤醒词       -> {"type":"listen","state":"detect"} + {"type":"listen","state":"start","mode":"realtime"/"auto"}
                    板子不会自己发 stop：网关做端点检测（VAD），静音超过 vad.silence_ms 就当一句话说完；
                    一直没人说话超过 vad.no_speech_sec 就回 {"type":"listen","state":"stop"} 让板子回待机
                    （固件 conest 0007 的 CONEST_WAKE_SESSION）。
    网关：Opus -> WAV -> POST /transcribe -> POST /turn -> 轮询 -> 取分段 WAV -> Opus -> 板子
    播放回执（playing / completed / stopped）照 8796 的规则代板子发。

协议出处：小智固件 main/protocols/websocket_protocol.cc、main/application.cc；
主机侧写法参考 role-household/rh/xiaozhi.py（zuiho，#89）。

配置是一个私密 JSON（不入库），见 README：upstream、device_id、secret、project、port、ffmpeg，
可选 vad（见 VadConfig）。
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import random
import struct
import subprocess
import time
import uuid
import wave
from urllib.parse import urlencode
import math
import zlib
from dataclasses import dataclass, fields
from pathlib import Path

import httpx
from aiohttp import WSMsgType, web

log = logging.getLogger('xiaozhi-gateway')

UPLINK_RATE = 16000      # 固件 hello 的 audio_params：Opus 16k 单声道 60ms
DOWNLINK_RATE = 24000    # 本板 AUDIO_OUTPUT_SAMPLE_RATE；hello 回包告诉板子用这个解码
FRAME_MS = 60
FRAME_SEC = FRAME_MS / 1000
# 板子缓冲里最多提前放几帧。固件解码队列是 1200ms / 60ms = 20 帧（main/audio/audio_service.h
# MAX_DECODE_PACKETS_IN_QUEUE）。原来只提前 5 帧（0.3s），一段约 0.6s 的语音送完后取下一段、
# 编码的空档就会让板子断音；提前 15 帧（0.9s）挡住空档，同时给队列留 5 帧余量。
PRE_BUFFER = 15
BOARD_DECODE_QUEUE_FRAMES = 1200 // 60
POLL_SEC = 0.3
HEARTBEAT_SEC = 10.0
KEEPALIVE_SEC = 30.0
WORK_STATUS_SEC = 5.0
MIN_RECORD_SEC = 0.4
FRAME_SAMPLES = UPLINK_RATE * FRAME_MS // 1000   # 960
OTA_PATH = '/xiaozhi/ota/'
WS_PATH = '/xiaozhi/v1/'


# ---------- Ogg / Opus ----------

def _crc_table() -> list[int]:
    table = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) if r & 0x80000000 else (r << 1)
        table.append(r & 0xFFFFFFFF)
    return table


_CRC = _crc_table()


def ogg_crc(data: bytes) -> int:
    crc = 0
    for b in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ _CRC[((crc >> 24) & 0xFF) ^ b]
    return crc


def _ogg_page(packet: bytes, serial: int, seq: int, granule: int, flags: int) -> bytes:
    segs, n = [], len(packet)
    while n >= 255:
        segs.append(255)
        n -= 255
    segs.append(n)
    header = struct.pack('<4sBBqIIIB', b'OggS', 0, flags, granule, serial, seq, 0, len(segs)) + bytes(segs)
    page = bytearray(header + packet)
    struct.pack_into('<I', page, 22, ogg_crc(bytes(page)))
    return bytes(page)


def opus_to_ogg(packets: list[bytes], rate: int = UPLINK_RATE, frame_ms: int = FRAME_MS) -> bytes:
    """把裸 Opus 包（每包一帧）装进 Ogg，ffmpeg 才能解。RFC 7845。granule 按 48k 计。"""
    serial = 0x636F6E65
    head = b'OpusHead' + struct.pack('<BBHIhB', 1, 1, 312, rate, 0, 0)
    tags = b'OpusTags' + struct.pack('<I', 6) + b'conest' + struct.pack('<I', 0)
    out = [_ogg_page(head, serial, 0, 0, 0x02), _ogg_page(tags, serial, 1, 0, 0)]
    step = 48 * frame_ms
    for i, p in enumerate(packets):
        last = i == len(packets) - 1
        out.append(_ogg_page(p, serial, i + 2, step * (i + 1), 0x04 if last else 0))
    return b''.join(out)


def ogg_packets(data: bytes) -> list[bytes]:
    """Ogg 拆包（跨页拼接）。同 rh/xiaozhi.py。"""
    out, cur, i = [], b'', 0
    while i + 27 <= len(data):
        if data[i:i + 4] != b'OggS':
            raise ValueError('不是 Ogg 数据')
        nseg = data[i + 26]
        table = data[i + 27:i + 27 + nseg]
        j = i + 27 + nseg
        for n in table:
            cur += data[j:j + n]
            j += n
            if n < 255:
                out.append(cur)
                cur = b''
        i = j
    return out


def strip_header(frame: bytes, version: int) -> bytes:
    """板子上行帧按协议版本去头（protocol.h BinaryProtocol2/3，大端）。版本 1 是裸 Opus。"""
    if version == 2 and len(frame) >= 16:
        size = struct.unpack('>I', frame[12:16])[0]
        return frame[16:16 + size]
    if version == 3 and len(frame) >= 4:
        size = struct.unpack('>H', frame[2:4])[0]
        return frame[4:4 + size]
    return frame


def add_header(packet: bytes, version: int) -> bytes:
    if version == 2:
        return struct.pack('>HHIII', 2, 0, 0, 0, len(packet)) + packet
    if version == 3:
        return struct.pack('>BBH', 0, 0, len(packet)) + packet
    return packet


class Codec:
    def __init__(self, ffmpeg: str):
        self.ffmpeg = ffmpeg

    def decode_pcm(self, packets: list[bytes]) -> bytes:
        """上行 Opus 包 -> 16k 单声道 s16le 裸 PCM。"""
        p = subprocess.run([self.ffmpeg, '-loglevel', 'error', '-f', 'ogg', '-i', 'pipe:0',
                            '-ac', '1', '-ar', str(UPLINK_RATE), '-f', 's16le', 'pipe:1'],
                           input=opus_to_ogg(packets), capture_output=True, check=True)
        return p.stdout

    def decode(self, packets: list[bytes]) -> bytes:
        """上行 Opus 包 -> 16k 单声道 WAV。"""
        # 输出裸 PCM 再自己包 WAV：ffmpeg 往管道写 WAV 时长度字段是 0xFFFFFFFF。
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(UPLINK_RATE)
            w.writeframes(self.decode_pcm(packets))
        return buf.getvalue()

    def encode(self, wav: bytes) -> list[bytes]:
        """任意 WAV -> 下行 Opus 24k 单声道 60ms 一帧的裸包。"""
        p = subprocess.run([self.ffmpeg, '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1',
                            '-ar', str(DOWNLINK_RATE), '-c:a', 'libopus', '-frame_duration', str(FRAME_MS),
                            '-application', 'voip', '-f', 'ogg', 'pipe:1'],
                           input=wav, capture_output=True, check=True)
        return [x for x in ogg_packets(p.stdout) if not x.startswith((b'OpusHead', b'OpusTags'))]


def wav_seconds(data: bytes) -> float:
    with wave.open(io.BytesIO(data), 'rb') as w:
        return w.getnframes() / w.getframerate()


# ---------- 待机小动作（联网轮换） ----------

class IdleClipPool:
    """单设备网关的随机动作池；next 是下载入口，包内仍保留真实动作名。"""

    def __init__(self, clips: dict[str, bytes]):
        self.clips = clips
        self.last: str | None = None

    def next(self) -> tuple[str, bytes]:
        names = [name for name in self.clips if name != self.last]
        if not names:
            names = list(self.clips)
        if not names:
            raise LookupError('没有待机小动作')
        name = random.choice(names)
        self.last = name
        return name, self.clips[name]

def split_cnas(blob: bytes, skip: set[str]) -> dict[str, bytes]:
    """把一个 CNAS v1 包拆成「每个片段一个单段 CNAS」，板子按需下载到内存播一遍。"""
    if blob[:4] != b'CNAS' or struct.unpack_from('<H', blob, 4)[0] != 1:
        raise ValueError('不是 CNAS v1 包')
    count = struct.unpack_from('<H', blob, 6)[0]
    out = {}
    for i in range(count):
        name_raw, fps, frames, index = struct.unpack_from('<16sBHI', blob, 8 + 23 * i)
        name = name_raw.split(b'\0')[0].decode()
        if name in skip:
            continue
        entries = [struct.unpack_from('<II', blob, index + 8 * f) for f in range(frames)]
        header = struct.pack('<4sHH', b'CNAS', 1, 1)
        table_end = 8 + 23
        data = table_end + 8 * frames
        seg = header + struct.pack('<16sBHI', name_raw, fps, frames, table_end)
        idx, payload, cursor = b'', b'', data
        for off, length in entries:
            idx += struct.pack('<II', cursor, length)
            payload += blob[off:off + length]
            cursor += length
        out[name] = seg + idx + payload
    return out


# ---------- 端点检测（唤醒词会话用） ----------

@dataclass
class VadConfig:
    """服务端 VAD 参数，配置 JSON 里 "vad": {...} 可逐项覆盖。按 60ms 一帧的能量（dBFS）判断。"""
    enabled: bool = True          # false：auto/realtime 会话也不做端点检测（只剩按住说话可用）
    silence_ms: int = 800         # 说过话之后连续静音这么久 -> 一句话结束
    min_speech_ms: int = 180      # 连续这么久是“有声”才算开始说话（滤掉咔哒声）
    threshold_db: float = -45.0   # 绝对门限：低于它一律算静音
    margin_db: float = 10.0       # 相对门限：比估计的底噪高这么多才算有声
    no_speech_sec: float = 8.0    # 唤醒/回到聆听后这么久没人说话 -> 让板子回待机；0 = 不限
    max_utterance_sec: float = 20.0  # 一句话最长这么久，到了强制结束
    window_frames: int = 3        # 攒几帧解一次码算能量（3 帧 = 180ms）

    @classmethod
    def from_dict(cls, d: dict | None) -> 'VadConfig':
        names = {f.name for f in fields(cls)}
        unknown = set(d or {}) - names
        if unknown:
            raise ValueError(f'vad 配置有未知字段：{sorted(unknown)}')
        return cls(**(d or {}))


def frame_levels(pcm: bytes, samples: int = FRAME_SAMPLES) -> list[float]:
    """s16le PCM 按帧算 RMS 电平（dBFS，满幅正弦约 -3）。不足一帧的尾巴丢掉。"""
    out = []
    n = len(pcm) // 2
    vals = struct.unpack(f'<{n}h', pcm[:n * 2])
    for i in range(0, n - samples + 1, samples):
        chunk = vals[i:i + samples]
        rms = math.sqrt(sum(v * v for v in chunk) / samples)
        out.append(20 * math.log10(max(rms, 1.0) / 32768))
    return out


class EndOfSpeech:
    """逐帧喂电平，判断一句话的开始和结束。纯计算，不碰网络，方便测试。

    feed() 返回 None 或事件：'speech'（开始说话）、'end'（静音够久，一句话说完）、
    'max'（说太久强制结束）、'no_speech'（一直没人说话）。'end'/'max'/'no_speech' 之后要 reset()。
    底噪按最小值跟踪：电平比底噪低就马上跟下去，高就每帧最多涨 NOISE_RISE_DB。
    说话里总有字间停顿把它拉回去；一直不变的风扇声几秒内就会被学成底噪。
    reset() 不清底噪（同一连接里一直沿用）。
    """
    NOISE_DEFAULT_DB = -60.0
    NOISE_RISE_DB = 0.3

    def __init__(self, cfg: VadConfig):
        self.cfg = cfg
        self.noise = self.NOISE_DEFAULT_DB
        self.reset()

    def reset(self) -> None:
        self.frames = 0
        self.voiced_run = 0
        self.silent_run = 0
        self.speaking = False
        self.speech_frames = 0

    def is_voiced(self, db: float) -> bool:
        return db > self.cfg.threshold_db and db > self.noise + self.cfg.margin_db

    def feed(self, db: float) -> str | None:
        c = self.cfg
        self.frames += 1
        voiced = self.is_voiced(db)
        self.noise = db if db < self.noise else min(db, self.noise + self.NOISE_RISE_DB)
        if not self.speaking:
            self.voiced_run = self.voiced_run + 1 if voiced else 0
            if self.voiced_run * FRAME_MS >= c.min_speech_ms:
                self.speaking, self.silent_run = True, 0
                self.speech_frames = self.voiced_run
                return 'speech'
            if c.no_speech_sec > 0 and self.frames * FRAME_SEC >= c.no_speech_sec:
                return 'no_speech'
            return None
        self.speech_frames += 1
        self.silent_run = 0 if voiced else self.silent_run + 1
        if self.silent_run * FRAME_MS >= c.silence_ms:
            return 'end'
        if c.max_utterance_sec > 0 and self.speech_frames * FRAME_SEC >= c.max_utterance_sec:
            return 'max'
        return None


# ---------- 8796 ----------

class Upstream:
    """8796 设备接口：按局域网设备走 X-Device-Secret，固定一个 client UUID。"""

    def __init__(self, base: str, device_id: str, secret: str, project: str):
        self.root = f"{base.rstrip('/')}/device/{device_id}/api"
        self.project = project
        self.client = str(uuid.uuid4())
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=120.0), trust_env=False,
                                      headers={'X-Device-Secret': secret, 'X-Device-Client': self.client})

    async def heartbeat(self) -> None:
        await self.http.post(self.root + '/heartbeat')

    async def transcribe(self, wav: bytes) -> str:
        r = await self.http.post(self.root + '/transcribe', content=wav, headers={'Content-Type': 'audio/wav'})
        if r.status_code != 200:
            raise RuntimeError(f'识别失败 HTTP {r.status_code}: {r.text[:200]}')
        return r.json().get('text', '').strip()

    async def submit(self, text: str) -> str:
        turn = str(uuid.uuid4())
        r = await self.http.post(self.root + '/turn', json={'id': turn, 'project': self.project, 'text': text})
        if r.status_code != 202:
            raise RuntimeError(f'提交失败 HTTP {r.status_code}: {r.text[:200]}')
        return turn

    async def status(self, turn: str) -> dict:
        r = await self.http.get(f'{self.root}/turn/{turn}')
        r.raise_for_status()
        return r.json()

    async def chunk(self, turn: str, index: int) -> bytes:
        r = await self.http.get(f'{self.root}/turn/{turn}/audio/chunks/{index}')
        r.raise_for_status()
        return r.content

    async def receipt(self, turn: str, state: str, position: float, duration: float) -> None:
        r = await self.http.post(f'{self.root}/turn/{turn}/playback',
                                 json={'state': state, 'position_seconds': round(position, 3),
                                       'duration_seconds': round(duration, 3)})
        if r.status_code >= 400:
            log.warning('回执 %s 被拒 HTTP %s: %s', state, r.status_code, r.text[:200])

    async def stop(self, turn: str) -> None:
        response = await self.http.post(f'{self.root}/turn/{turn}/stop')
        response.raise_for_status()


class BusySource:
    """Read only the explicitly bound conversations; failure is unknown, never idle.

    A role may work in several channels (session_keys); it counts as busy when any of
    them is busy. If none is busy but one cannot be read, the state is unknown.
    """

    def __init__(self, config: dict, project: str):
        self.project = project
        keys = config.get('session_keys') or [config['session_key']]
        if not isinstance(keys, list) or not keys or not all(isinstance(k, str) and k for k in keys):
            raise ValueError('work_status.session_keys 必须是非空字符串列表')
        self.session_keys = list(dict.fromkeys(keys))
        self.bindings: dict[str, tuple[str, str]] = {}
        self.http = httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(uds=str(Path(config['bridge_socket']).expanduser())),
            base_url='http://localhost', timeout=5.0, trust_env=False)

    async def read_one(self, session_key: str) -> bool:
        query = urlencode({'project': self.project, 'session_key': session_key})
        r = await self.http.get('/input/bindings?' + query)
        r.raise_for_status()
        d = r.json()
        if (not isinstance(d, dict) or d.get('project') != self.project or d.get('session_key') != session_key
                or not isinstance(d.get('busy'), bool)
                or not isinstance(d.get('session_id'), str) or not d['session_id']
                or not isinstance(d.get('agent_session_id'), str) or not d['agent_session_id']):
            raise ValueError(f'工作状态的会话绑定不匹配：{session_key}')
        binding = (d['session_id'], d['agent_session_id'])
        if self.bindings.get(session_key, binding) != binding:
            raise ValueError(f'工作状态的会话已经更换，需重新核对配置：{session_key}')
        self.bindings[session_key] = binding
        return d['busy']

    async def read(self) -> bool:
        error: Exception | None = None
        for key in self.session_keys:
            try:
                if await self.read_one(key):
                    return True
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
                error = e
        if error is not None:
            raise error
        return False


# ---------- 板子会话 ----------

# 固件 0012 的 CONFIG_CONEST_CHARACTER_WAKE_TABLE 里没有的角色，唤醒词由网关在 rh_dial 里带过去
# （conest_wake_words 优先于固件表，不用改补丁、不用重刷）。键是 name 或 role（不分大小写）。
GROK_WAKE_WORDS = (
    {'command': 'ni hao ge luo ke', 'text': '你好Grok'},
    {'command': 'ge luo ke ge luo ke', 'text': 'GrokGrok'},
)
CHARACTER_WAKE_PRESETS = {
    'grok': GROK_WAKE_WORDS,
    'grokball': GROK_WAKE_WORDS,
}


def load_character(raw) -> dict:
    """配置里的 character：字符串（角色名）或 {name, role, wake_words:[{command,text}]}。"""
    if not raw:
        return {}
    if isinstance(raw, str):
        raw = {'name': raw}
    if not isinstance(raw, dict):
        raise ValueError('character 必须是字符串或对象')
    unknown = set(raw) - {'name', 'role', 'wake_words'}
    if unknown:
        raise ValueError(f'character 里有未知字段：{sorted(unknown)}')
    out = {k: str(raw[k]) for k in ('name', 'role') if raw.get(k)}
    words = []
    for w in raw.get('wake_words') or []:
        if isinstance(w, str):
            w = {'command': w}
        cmd = str(w.get('command', '')).strip()
        if not cmd:
            raise ValueError('wake_words 每项都要有 command（拼音，空格分隔）')
        if not all(part.isascii() and part.isalpha() and part.islower() for part in cmd.split()):
            raise ValueError(f'唤醒词只能是小写拼音：{cmd!r}')
        words.append({'command': cmd, 'text': str(w.get('text') or cmd)})
    if not words:
        for key in (out.get('role', ''), out.get('name', '')):
            preset = CHARACTER_WAKE_PRESETS.get(key.lower())
            if preset:
                words = [dict(w) for w in preset]
                break
    if words:
        out['wake_words'] = words
    return out


def character_dial(character: dict) -> dict:
    """角色 -> rh_dial 字段（name/role 是 rh 协议原有的，conest_wake_words 可选）。"""
    dial = {k: character[k] for k in ('name', 'role') if character.get(k)}
    if character.get('wake_words'):
        dial['conest_wake_words'] = character['wake_words']
    return dial


class Session:
    def __init__(self, ws: web.WebSocketResponse, version: int, up: Upstream, codec: Codec,
                 vad: VadConfig | None = None, clips: dict | None = None,
                 character: dict | None = None):
        self.ws, self.version, self.up, self.codec = ws, version, up, codec
        self.clips = clips or {}
        self.character = character or {}
        self.id = str(uuid.uuid4())
        self.listening = False
        self.recorded: list[bytes] = []
        self.task: asyncio.Task | None = None
        self.turn: str | None = None
        # 唤醒词会话（mode auto/realtime）：板子不发 stop，网关自己判断说完没有
        self.vad_cfg = vad or VadConfig()
        self.vad = EndOfSpeech(self.vad_cfg)
        self.auto = False            # 当前会话是不是由网关做端点检测
        self.pending: list[bytes] = []   # 还没算能量的帧
        self.preroll: bytes | None = None
        self.vad_task: asyncio.Task | None = None

    async def send(self, msg: dict) -> None:
        if not self.ws.closed:
            await self.ws.send_json({**msg, 'session_id': self.id})

    async def on_text(self, d: dict) -> None:
        kind = d.get('type')
        if kind == 'hello':
            log.info('握手：%s', json.dumps(d.get('audio_params', {}), ensure_ascii=False))
            await self.ws.send_json({'type': 'hello', 'transport': 'websocket', 'session_id': self.id,
                                     'audio_params': {'format': 'opus', 'sample_rate': DOWNLINK_RATE,
                                                      'channels': 1, 'frame_duration': FRAME_MS}})
            dial = character_dial(self.character)
            if self.clips.get('names') or self.clips.get('name'):
                # 固件 CONFIG_RH_DIAL 把 rh_dial 消息交给显示层；C酱 的显示层读 conest_clips。
                dial['conest_clips'] = self.clips
            if dial:
                # 每次连上都带角色：固件 CONFIG_CONEST_CHARACTER_WAKE 据此切换唤醒词。
                await self.send({'type': 'rh_dial', **dial})
        elif kind == 'listen' and d.get('state') == 'start':
            if await self.abort('新一轮录音') is False:
                return
            mode = d.get('mode') or 'manual'
            self.auto = mode in ('auto', 'realtime') and self.vad_cfg.enabled
            self.arm()
            log.info('开始录音（%s，%s）', mode, '网关判断说完' if self.auto else '等板子松手')
        elif kind == 'listen' and d.get('state') == 'stop':
            self.auto = False
            if self.listening:
                self.listening = False
                packets, self.recorded = self.recorded, []
                self.task = asyncio.ensure_future(self.run_turn(packets))
        elif kind == 'listen' and d.get('state') == 'detect':
            log.info('唤醒词：%s', d.get('text', ''))
        elif kind == 'mcp':
            self.last_mcp = d.get('payload')
            log.info('板子 MCP 回包 %s', json.dumps(d.get('payload'), ensure_ascii=False)[:300])
        elif kind == 'abort':
            await self.abort('板子打断')
        else:
            log.info('板子消息 %s', json.dumps(d, ensure_ascii=False)[:200])

    async def mcp_call(self, name: str, arguments: dict) -> None:
        self._mcp_id = getattr(self, '_mcp_id', 0) + 1
        await self.send({'type': 'mcp', 'payload': {'jsonrpc': '2.0', 'id': self._mcp_id, 'method': 'tools/call',
                                                    'params': {'name': name, 'arguments': arguments}}})

    def arm(self) -> None:
        """开始收一句话：清空录音和 VAD 状态。"""
        self.listening, self.recorded = True, []
        self.pending, self.preroll = [], None
        self.vad.reset()

    def on_audio(self, frame: bytes) -> None:
        if not self.listening:
            return
        packet = strip_header(frame, self.version)
        self.recorded.append(packet)
        if self.auto:
            self.pending.append(packet)
            if len(self.pending) >= self.vad_cfg.window_frames and (self.vad_task is None or self.vad_task.done()):
                window, self.pending = self.pending, []
                self.vad_task = asyncio.ensure_future(self.check_window(window))

    async def check_window(self, window: list[bytes]) -> None:
        """解一小段码，逐帧喂 VAD。前面垫一帧上一段的包让解码器热身，算能量时丢掉。"""
        packets = ([self.preroll] if self.preroll else []) + window
        self.preroll = window[-1]
        try:
            pcm = await asyncio.get_running_loop().run_in_executor(None, self.codec.decode_pcm, packets)
        except Exception as exc:  # 解码失败只丢这一段的判断
            log.warning('VAD 解码失败：%r', exc)
            return
        want = len(window) * FRAME_SAMPLES * 2
        pcm = pcm[-want:] if len(pcm) >= want else b'\0' * (want - len(pcm)) + pcm
        for db in frame_levels(pcm):
            if not (self.listening and self.auto):
                return
            event = self.vad.feed(db)
            if event == 'speech':
                log.info('VAD：开始说话')
            elif event in ('end', 'max'):
                log.info('VAD：%s，%.1fs', '说完了' if event == 'end' else '说太久，强制结束',
                         len(self.recorded) * FRAME_SEC)
                self.listening = False
                packets, self.recorded = self.recorded, []
                self.task = asyncio.ensure_future(self.run_turn(packets, rearm=True))
                return
            elif event == 'no_speech':
                log.info('VAD：%.0fs 没人说话，让板子回待机', self.vad_cfg.no_speech_sec)
                self.listening = self.auto = False
                self.recorded = []
                await self.send({'type': 'listen', 'state': 'stop'})
                return

    async def _stop_upstream(self, turn: str) -> bool:
        try:
            await asyncio.wait_for(self.up.stop(turn), timeout=3.0)
            return True
        except Exception as exc:
            # Retain the turn handle so the next explicit abort/listen can retry
            # an idempotent stop; never resubmit the utterance automatically.
            log.warning('上游停止未确认：%s', type(exc).__name__)
            return False

    async def abort(self, why: str) -> bool:
        if self.task and not self.task.done():
            self.task.cancel()
            log.info('中止本轮：%s', why)
        turn = self.turn
        stopped = not turn or await self._stop_upstream(turn)
        if stopped and self.turn == turn:
            self.turn = None
        await self.send({'type': 'tts', 'state': 'stop'})
        return stopped

    async def run_turn(self, packets: list[bytes], rearm: bool = False) -> None:
        try:
            await self._run_turn(packets)
        except asyncio.CancelledError:
            raise  # 被打断：不重开，等板子下一条 listen
        # 唤醒词会话：板子播完回到聆听状态时不一定再发 listen start（realtime 模式不会），
        # 网关自己重新开始收下一句。
        if rearm and self.auto and not self.ws.closed and self.turn is None:
            self.arm()
            log.info('继续聆听（网关判断说完）')

    async def _run_turn(self, packets: list[bytes]) -> None:
        t0 = time.monotonic()
        turn = None
        cleanup_pending = False
        loop = asyncio.get_running_loop()
        if len(packets) * FRAME_SEC < MIN_RECORD_SEC:
            log.info('录音太短（%.2fs），丢弃', len(packets) * FRAME_SEC)
            await self.send({'type': 'tts', 'state': 'stop'})
            return
        try:
            # Receipt of a complete utterance precedes decoding/ASR. The board
            # must not claim it is still listening during a cold recognition.
            await self.send({'type': 'llm', 'text': '', 'emotion': 'thinking'})
            t_decode = time.monotonic()
            wav = await loop.run_in_executor(None, self.codec.decode, packets)
            t_decoded = time.monotonic()
            text = await self.up.transcribe(wav)
            t_asr = time.monotonic()
            log.info('语音计时 %s', json.dumps({
                'stage': 'recognition_complete',
                'decode_ms': round((t_decoded - t_decode) * 1000),
                'asr_request_ms': round((t_asr - t_decoded) * 1000),
                'since_turn_start_ms': round((t_asr - t0) * 1000),
                'text_chars': len(text),
            }))
            if not text:
                await self.send({'type': 'llm', 'text': '', 'emotion': 'neutral'})
                await self.send({'type': 'tts', 'state': 'stop'})
                return
            await self.send({'type': 'stt', 'text': text})
            t_submit = time.monotonic()
            self.turn = turn = await self.up.submit(text)
            await self.play(turn, t_submit, turn_started_at=t0)
        except asyncio.CancelledError:
            # abort owns upstream stop. Its request may fail while this task
            # unwinds; retain the handle until abort confirms release.
            cleanup_pending = bool(turn)
            raise
        except Exception as exc:  # 一轮失败不拖垮连接：板子回到待机
            log.warning('本轮失败：%r', exc)
            if turn:
                # Cancellation can interrupt this exception handler itself.
                # Mark ownership before awaiting, not after stop returns.
                cleanup_pending = True
                cleanup_pending = not await self._stop_upstream(turn)
            await self.send({'type': 'alert', 'status': '错误', 'message': str(exc)[:60], 'emotion': 'sad'})
            await self.send({'type': 'tts', 'state': 'stop'})
        finally:
            if self.turn == turn and not cleanup_pending:
                self.turn = None

    async def play(self, turn: str, t_submit: float, *, turn_started_at: float | None = None) -> None:
        sent, total, started = 0, 0.0, False
        first_packet_sent = False
        until = time.monotonic()
        while True:
            s = await self.up.status(turn)
            if s.get('status') in {'stopped', 'error'} or s.get('abandoned'):
                log.info('本轮结束：%s %s', s.get('status'), s.get('error', ''))
                if not started and s.get('status') == 'error':
                    await self.send({'type': 'alert', 'status': '错误',
                                     'message': str(s.get('error') or '这一轮没有回答')[:60], 'emotion': 'sad'})
                    started = True  # 表情已换成 sad
                break
            chunks = (s.get('audio_chunks') or []) if s.get('playback_allowed') else []
            for c in chunks[sent:]:
                t_fetch = time.monotonic()
                wav = await self.up.chunk(turn, c['index'])
                t_encode = time.monotonic()
                packets = await asyncio.get_running_loop().run_in_executor(None, self.codec.encode, wav)
                t_encoded = time.monotonic()
                if not packets:
                    raise ValueError('音频没有可发送的 Opus 帧')
                duration = float(c.get('duration_seconds') or wav_seconds(wav))
                if not started:
                    started = True
                    log.info('首段语音 %.2fs（提交后）', time.monotonic() - t_submit)
                    await self.send({'type': 'tts', 'state': 'start'})
                if c.get('text'):
                    await self.send({'type': 'tts', 'state': 'sentence_start', 'text': c['text']})
                for p in packets:
                    ahead = until - time.monotonic() - (PRE_BUFFER - 1) * FRAME_SEC
                    if ahead > 0:
                        await asyncio.sleep(ahead)
                    await self.ws.send_bytes(add_header(p, self.version))
                    if not first_packet_sent:
                        first_packet_sent = True
                        now = time.monotonic()
                        # A successful socket write is observable locally. It is
                        # not a hardware playback acknowledgement. The existing
                        # receipt below includes pacing the rest of the chunk.
                        timing = {
                            'stage': 'first_audio_packet',
                            'since_submit_ms': round((now - t_submit) * 1000),
                            'fetch_ms': round((t_encode - t_fetch) * 1000),
                            'encode_ms': round((t_encoded - t_encode) * 1000),
                        }
                        if turn_started_at is not None:
                            timing['since_turn_start_ms'] = round((now - turn_started_at) * 1000)
                        log.info('语音计时 %s', json.dumps(timing))
                    until = max(until, time.monotonic()) + FRAME_SEC
                await self.up.receipt(turn, 'playing', total, total + duration)
                total += duration
                sent += 1
            if s.get('status') == 'ready' and s.get('audio_complete') and sent >= len(s.get('audio_chunks') or []):
                await asyncio.sleep(max(0.0, until - time.monotonic()))
                await self.up.receipt(turn, 'completed', total, total)
                log.info('播完，共 %d 段 %.1fs', sent, total)
                break
            await asyncio.sleep(POLL_SEC)
        if not started:
            # 一句都没播（被停、被放弃、空回答）：换掉「思考」表情，不然板子一直停在思考动画上
            await self.send({'type': 'llm', 'text': '', 'emotion': 'neutral'})
        await self.send({'type': 'tts', 'state': 'stop'})


# ---------- HTTP ----------

def build_app(config: dict) -> web.Application:
    codec = Codec(config['ffmpeg'])
    vad = VadConfig.from_dict(config.get('vad'))
    character = load_character(config.get('character'))
    up = Upstream(config['upstream'], config['device_id'], config['secret'], config['project'])
    port = int(config.get('port', 8797))
    token = config.get('token', '')
    sessions: set[Session] = set()

    def local_ip(req: web.Request) -> str:
        sock = req.transport.get_extra_info('sockname') if req.transport else None
        return sock[0] if sock else '127.0.0.1'

    async def ota(req: web.Request) -> web.Response:
        body = {}
        if req.method == 'POST' and req.can_read_body:
            try:
                body = await req.json()
            except ValueError:
                body = {}
        current = str(((body or {}).get('application') or {}).get('version') or '')
        lt = time.localtime()
        log.info('OTA 请求 %s 版本 %s', req.headers.get('Device-Id', '?'), current or '?')
        return web.json_response({
            'server_time': {'timestamp': int(time.time() * 1000), 'timezone_offset': (lt.tm_gmtoff or 0) // 60},
            'firmware': {'version': current, 'url': ''},
            'websocket': {'url': f'ws://{local_ip(req)}:{port}{WS_PATH}', 'token': token},
        })

    async def ws_handler(req: web.Request) -> web.StreamResponse:
        if token and req.headers.get('Authorization', '') != f'Bearer {token}':
            raise web.HTTPUnauthorized()
        try:
            version = int(req.headers.get('Protocol-Version', '1'))
        except ValueError:
            version = 1
        ws = web.WebSocketResponse(max_msg_size=0, heartbeat=30.0)
        await ws.prepare(req)
        clips = {'name': config.get('role_name', ''), 'base': f'http://{local_ip(req)}:{port}/xiaozhi/clip/',
                 'names': ['next'] if clip_files else [], 'min_s': int(config.get('idle_min_s', 20)), 'max_s': int(config.get('idle_max_s', 45)),
                 'working': list(working_files)}
        s = Session(ws, version, up, codec, vad, clips, character=character)
        sessions.add(s)

        async def keepalive():
            # 固件 120 秒收不到服务端消息就断开音频通道（protocol.cc kTimeoutSeconds）；同 rh/xiaozhi.py。
            while not ws.closed:
                await asyncio.sleep(KEEPALIVE_SEC)
                await s.send({'type': 'keepalive'})
        ka = asyncio.ensure_future(keepalive())
        log.info('板子 %s 连上（协议 v%d）', req.headers.get('Device-Id', '?'), version)
        try:
            async for msg in ws:
                if msg.type == WSMsgType.BINARY:
                    s.on_audio(msg.data)
                elif msg.type == WSMsgType.TEXT:
                    try:
                        await s.on_text(msg.json())
                    except ValueError:
                        continue
                else:
                    break
        finally:
            ka.cancel()
            sessions.discard(s)
            if s.task and not s.task.done():
                s.task.cancel()
            log.info('板子断开')
        return ws

    busy_source = BusySource(config['work_status'], config['project']) if config.get('work_status') else None
    work_state = {'busy': None, 'name': config.get('role_name', ''), 'source': 'unknown'}
    preview = {'until': 0.0, 'busy': False}

    async def publish_work_status():
        if not busy_source:
            return
        if time.monotonic() < preview['until']:
            work_state.update(busy=preview['busy'], source='preview')
        else:
            try:
                work_state.update(busy=await busy_source.read(), source='conversation')
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                work_state.update(busy=None, source='unknown')
        for session in list(sessions):
            if not session.ws.closed:
                await session.send({'type': 'rh_dial', 'conest_status': {'busy': work_state['busy']}})

    async def work_status_loop(app: web.Application):
        async def loop():
            while True:
                if sessions:
                    try:
                        await publish_work_status()
                    except (ConnectionError, RuntimeError):
                        pass  # connection may close during a poll
                await asyncio.sleep(WORK_STATUS_SEC)
        task = asyncio.create_task(loop())
        yield
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        if busy_source:
            await busy_source.http.aclose()

    async def heartbeat(app: web.Application):
        async def loop():
            while True:
                if sessions:
                    try:
                        await up.heartbeat()
                    except httpx.HTTPError as exc:
                        log.warning('8796 心跳失败：%r', exc)
                await asyncio.sleep(HEARTBEAT_SEC)
        task = asyncio.ensure_future(loop())
        yield
        task.cancel()
        await up.http.aclose()

    clip_files: dict[str, bytes] = {}
    if config.get('clips_pack'):
        pack = Path(config['clips_pack']).expanduser().read_bytes()
        clip_files = split_cnas(pack, {'idle', 'listening', 'thinking', 'speaking', 'offline', 'error'})
        for name, data in clip_files.items():
            if len(data) >= 4 * 1024 * 1024:
                raise ValueError(f'待机小动作 {name} 超过板端单次下载限制（必须小于 4 MiB）')
        log.info('待机小动作 %d 段：%s', len(clip_files), ' '.join(clip_files))
    working_files: dict[str, bytes] = {}
    if config.get('working_pack'):
        working_files = split_cnas(Path(config['working_pack']).expanduser().read_bytes(), set())
        if not working_files or any(not name.startswith('working-') for name in working_files):
            raise ValueError('工作动画包只能包含 working-* 片段')
        if any(len(data) >= 4 * 1024 * 1024 for data in working_files.values()):
            raise ValueError('工作动画单段必须小于 4 MiB')
        log.info('工作动画 %d 段：%s', len(working_files), ' '.join(working_files))
    clip_pool = IdleClipPool(clip_files)

    async def clip(req: web.Request) -> web.Response:
        name = req.match_info['name']
        if name == 'next':
            try:
                name, data = clip_pool.next()
            except LookupError:
                raise web.HTTPNotFound()
            log.info('下发待机小动作 %s（%d 字节）', name, len(data))
        else:
            data = working_files.get(name, clip_files.get(name))
        if data is None:
            raise web.HTTPNotFound()
        return web.Response(body=data, content_type='application/octet-stream',
                            headers={'Cache-Control': 'no-store', 'X-Conest-Clip': name})

    shots = Path(config.get('snapshot_dir', '/tmp')).expanduser()
    shot_ready = asyncio.Event()

    def local_only(req: web.Request) -> None:
        if req.remote not in {'127.0.0.1', '::1', local_ip(req)}:
            raise web.HTTPForbidden()

    async def snapshot_upload(req: web.Request) -> web.Response:
        # 板子 self.screen.snapshot 工具按 multipart/form-data 上传 JPEG
        reader = await req.multipart()
        part = await reader.next()
        data = await part.read(decode=False) if part else b''
        shots.mkdir(parents=True, exist_ok=True)
        (shots / 'latest.jpg').write_bytes(data)
        log.info('收到截图 %d 字节', len(data))
        shot_ready.set()
        return web.json_response({'success': True})

    async def snapshot_trigger(req: web.Request) -> web.Response:
        # 本机调用：让板子截一张图传回来
        local_only(req)
        if not sessions:
            raise web.HTTPServiceUnavailable(text='板子没连上')
        shot_ready.clear()
        url = f'http://{local_ip(req)}:{port}/xiaozhi/snapshot'
        for s in list(sessions):
            await s.mcp_call('self.screen.snapshot', {'url': url, 'quality': 85})
        try:
            await asyncio.wait_for(shot_ready.wait(), 15)
        except asyncio.TimeoutError:
            raise web.HTTPGatewayTimeout(text='板子 15 秒内没传回截图')
        return web.json_response({'path': str(shots / 'latest.jpg')})

    async def mcp_trigger(req: web.Request) -> web.Response:
        # 本机调用：调板子的一个 MCP 工具（如 self.get_device_status），返回板子回包
        local_only(req)
        if not sessions:
            raise web.HTTPServiceUnavailable(text='板子没连上')
        s = next(iter(sessions))
        s.last_mcp = None
        await s.mcp_call(req.query.get('name', 'self.get_device_status'), {})
        for _ in range(50):
            if getattr(s, 'last_mcp', None) is not None:
                return web.json_response(s.last_mcp)
            await asyncio.sleep(0.1)
        raise web.HTTPGatewayTimeout(text='板子 5 秒内没回')

    async def animation_preview(req: web.Request) -> web.Response:
        # Local, time-limited visual acceptance; never changes or submits a conversation.
        local_only(req)
        d = await req.json()
        if not isinstance(d, dict) or not isinstance(d.get('busy'), bool):
            raise web.HTTPBadRequest(text='busy must be boolean')
        seconds = d.get('seconds', 20)
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 <= seconds <= 30:
            raise web.HTTPBadRequest(text='seconds must be 0..30')
        preview.update(busy=d['busy'], until=time.monotonic() + seconds)
        await publish_work_status()
        return web.json_response(work_state)

    async def animation_status(req: web.Request) -> web.Response:
        local_only(req)
        return web.json_response({**work_state, 'connected': len(sessions),
                                  'idle_clips': list(clip_files), 'working_clips': list(working_files)})

    app = web.Application(client_max_size=4 * 1024 * 1024)
    app.router.add_get('/admin/mcp', mcp_trigger)
    app.router.add_get('/admin/animation', animation_status)
    app.router.add_post('/admin/animation/preview', animation_preview)
    app.router.add_route('*', OTA_PATH, ota)
    app.router.add_post('/xiaozhi/snapshot', snapshot_upload)
    app.router.add_get('/xiaozhi/clip/{name}', clip)
    app.router.add_get('/admin/snapshot', snapshot_trigger)
    app.router.add_get(WS_PATH, ws_handler)
    app.cleanup_ctx.append(heartbeat)
    app.cleanup_ctx.append(work_status_loop)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--config', type=Path, required=True, help='私密 JSON，不入库')
    parser.add_argument('--host', default='0.0.0.0')
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8'))
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    web.run_app(build_app(config), host=args.host, port=int(config.get('port', 8797)), print=None)


if __name__ == '__main__':
    main()
