"""One text stream and one PCM stream per turn, on a reusable Volc connection.

Only successful SessionFinished permits reuse. Cancellation or any partial
failure closes that connection, so late audio cannot enter the next turn.
The caller owns public-text validation and whole-turn Opus encoding.
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable, Callable
import json
from pathlib import Path
import struct
from uuid import uuid4

from websockets.asyncio.client import connect
from websockets.protocol import State

from .speech import _validate_tts_text
from .volc_tts import CHUNK_SECONDS, RATE, is_volc_voice, resource_for, wav_bytes

ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/tts/bidirection'
MAX_PCM_BYTES = RATE * 2 * 300


def _frame(event: int, payload: dict, session: str | None = None) -> bytes:
    data = json.dumps(payload, ensure_ascii=False).encode()
    result = b'\x11\x14\x10\x00' + struct.pack('>i', event)
    if session is not None:
        ident = session.encode()
        result += struct.pack('>I', len(ident)) + ident
    return result + struct.pack('>I', len(data)) + data


def _decode(raw: bytes) -> tuple[int, int, str, bytes]:
    if (not isinstance(raw, bytes) or len(raw) < 12 or raw[0] != 0x11
            or raw[1] not in (0x94, 0xB4) or raw[3] != 0
            or raw[2] != (0 if raw[1] == 0xB4 else 0x10)):
        raise RuntimeError('火山双向语音返回了不支持的二进制帧。')
    event = struct.unpack_from('>i', raw, 4)[0]
    offset = 8

    def field():
        nonlocal offset
        if offset + 4 > len(raw):
            raise RuntimeError('火山双向语音帧不完整。')
        size = struct.unpack_from('>I', raw, offset)[0]
        offset += 4
        if offset + size > len(raw):
            raise RuntimeError('火山双向语音帧不完整。')
        result = raw[offset:offset + size]
        offset += size
        return result

    # ConnectionFailed carries no connection id. No provider error payload is
    # included in exceptions, since it may contain request text or credentials.
    ident = field().decode() if event != 51 else ''
    payload = field()
    if offset != len(raw):
        raise RuntimeError('火山双向语音帧含额外数据。')
    if event in (51, 153):
        raise RuntimeError('火山双向语音拒绝了连接或会话。')
    return event, raw[1] >> 4, ident, payload


class VolcBidirectionalTTS:
    def __init__(self, credentials: str, *, timeout: float = 30):
        data = json.loads(Path(credentials).expanduser().read_text(encoding='utf-8'))
        key = data.get('access_token', '') if isinstance(data, dict) else ''
        if not isinstance(key, str) or not key.strip():
            raise ValueError('火山语音凭据缺少 access_token。')
        if not 0 < timeout <= 180:
            raise ValueError('双向语音期限必须在 0—180 秒之间。')
        self._key = key.strip()
        self.timeout = timeout
        self._lock = asyncio.Lock()
        self._connection = None
        self._resource = None
        self._closed = False

    async def _open(self, voice):
        if self._closed:
            raise RuntimeError('双向语音服务已关闭。')
        if not is_volc_voice(voice):
            raise ValueError('不是火山语音的音色 ID。')
        resource = resource_for(voice)
        if self._connection is not None:
            if self._connection.state == State.OPEN and self._resource == resource:
                return self._connection
            await self._drop()
        ws = await connect(ENDPOINT, additional_headers={
            'X-Api-Key': self._key, 'X-Api-Resource-Id': resource,
            'X-Api-Connect-Id': str(uuid4()),
        }, proxy=None, open_timeout=self.timeout, close_timeout=1,
            max_size=4 * 1024 * 1024)
        try:
            await ws.send(_frame(1, {}))
            event, _, _, _ = _decode(await ws.recv())
            if event != 50:
                raise RuntimeError('火山双向语音未确认连接。')
        except BaseException:
            await ws.close()
            raise
        self._connection, self._resource = ws, resource
        return ws

    async def _drop(self):
        ws, self._connection = self._connection, None
        self._resource = None
        if ws is not None:
            await ws.close()

    async def preconnect(self, voice: str):
        """Establish the connection before public text becomes available."""
        async with asyncio.timeout(self.timeout), self._lock:
            await self._open(voice)

    async def close(self):
        """Call after cancelling and draining the service's active turns."""
        async with self._lock:
            self._closed = True
            await self._drop()

    async def synthesize(self, parts: AsyncIterable[str], on_chunk: Callable[[bytes], None], *, voice: str) -> bytes:
        """Send text as it arrives; return a complete WAV only after success.

        WAV callbacks retain the HTTP backend's 0.6-second chunk size. They
        execute on this event loop and must return promptly. No retry occurs
        after a failure, including one after audio has already been delivered.
        """
        async with asyncio.timeout(self.timeout), self._lock:
            ws = await self._open(voice)
            sid = str(uuid4())
            tasks = []

            def payload(event, text=''):
                return {'user': {'uid': 'conest'}, 'event': event,
                        'namespace': 'BidirectionalTTS', 'req_params': {
                            'text': text, 'speaker': voice,
                            'audio_params': {'format': 'pcm', 'sample_rate': RATE}}}

            finished_input = asyncio.Event()

            async def send():
                whole = ''
                async for part in parts:
                    if not part:
                        continue
                    whole += part
                    _validate_tts_text(whole)
                    await ws.send(_frame(200, payload(200, part), sid))
                if not whole:
                    raise ValueError('待合成文本不能为空。')
                finished_input.set()
                await ws.send(_frame(102, {}, sid))

            async def receive():
                whole, pending = bytearray(), bytearray()
                step = int(RATE * CHUNK_SECONDS) * 2
                while True:
                    event, kind, ident, body = _decode(await ws.recv())
                    if ident != sid:
                        raise RuntimeError('双向语音会话身份不符，已停止本轮。')
                    if event == 352:
                        if kind != 11 or not body or len(body) % 2:
                            raise RuntimeError('双向语音音频格式不正确。')
                        if len(whole) + len(body) > MAX_PCM_BYTES:
                            raise RuntimeError('双向语音音频超过大小上限。')
                        whole.extend(body)
                        pending.extend(body)
                        while len(pending) >= step:
                            on_chunk(wav_bytes(bytes(pending[:step])))
                            del pending[:step]
                    elif event == 152:
                        status = json.loads(body).get('status_code', 20000000)
                        if not finished_input.is_set() or not whole or status != 20000000:
                            raise RuntimeError('双向语音未完整合成，本轮不会自动重试。')
                        if pending:
                            on_chunk(wav_bytes(bytes(pending)))
                        return wav_bytes(bytes(whole))
                    elif event not in (350, 351):
                        raise RuntimeError('双向语音会话意外结束。')

            try:
                await ws.send(_frame(100, payload(100), sid))
                event, _, ident, _ = _decode(await ws.recv())
                if event != 150 or ident != sid:
                    raise RuntimeError('火山双向语音未确认本轮会话。')
                tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
                _, audio = await asyncio.gather(*tasks)
                return audio
            except BaseException:
                # A failed session is never reused. Closing this socket also
                # isolates any late audio queued after the cancellation request.
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                try:
                    async with asyncio.timeout(1):
                        await ws.send(_frame(101, {}, sid))
                except Exception:
                    # The connection may already be broken; _drop owns cleanup.
                    pass
                finally:
                    await self._drop()
                raise
