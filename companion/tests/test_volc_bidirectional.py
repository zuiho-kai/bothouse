"""Local binary WebSocket server; no provider credentials or audio playback."""
import asyncio
import io
import json
import struct
import wave

import pytest
from websockets.asyncio.server import serve

from voice import volc_bidirectional as module
from voice.volc_bidirectional import VolcBidirectionalTTS

VOICE = 'zh_female_sajiaoxuemei_uranus_bigtts'
PCM = b'\x01\x00' * 14400


def server_frame(event, payload=b'{}', session='connection', *, audio=False):
    ident = session.encode()
    return (bytes((0x11, 0xB4 if audio else 0x94, 0 if audio else 0x10, 0))
            + struct.pack('>iI', event, len(ident)) + ident
            + struct.pack('>I', len(payload)) + payload)


def client_frame(raw):
    assert raw[:4] == b'\x11\x14\x10\x00'
    event = struct.unpack_from('>i', raw, 4)[0]
    offset, session = 8, None
    if event >= 100:
        size = struct.unpack_from('>I', raw, offset)[0]
        offset += 4
        session, offset = raw[offset:offset + size].decode(), offset + size
    size = struct.unpack_from('>I', raw, offset)[0]
    payload = json.loads(raw[offset + 4:])
    assert len(raw) == offset + 4 + size
    return event, session, payload


def pcm(audio):
    with wave.open(io.BytesIO(audio), 'rb') as reader:
        assert (reader.getframerate(), reader.getnchannels(), reader.getsampwidth()) == (24000, 1, 2)
        return reader.readframes(reader.getnframes())


class Provider:
    def __init__(self, mode='ok'):
        self.mode = mode
        self.connections = 0
        self.events = []
        self.sessions = []
        self.audio_sent = asyncio.Event()

    async def __call__(self, ws):
        self.connections += 1
        async for raw in ws:
            event, sid, payload = client_frame(raw)
            self.events.append((event, sid, payload))
            if event == 1:
                assert ws.request.headers['X-Api-Key'] == 'fixture-key'
                assert ws.request.headers['X-Api-Resource-Id'] == 'seed-tts-2.0'
                await ws.send(server_frame(50))
            elif event == 100:
                self.sessions.append(sid)
                assert payload['req_params']['speaker'] == VOICE
                await ws.send(server_frame(150, session=sid))
            elif event == 200:
                assert payload['req_params']['text']
                if self.mode in ('hang', 'no-audio'):
                    continue
                if self.mode == 'malformed':
                    await ws.send(b'\x11\xb4')
                    continue
                target = 'foreign-session' if self.mode == 'foreign' else sid
                chunk = b'x' if self.mode == 'odd-pcm' else PCM
                await ws.send(server_frame(352, chunk, target, audio=True))
                self.audio_sent.set()
            elif event == 102:
                if self.mode == 'hang':
                    continue
                if self.mode == 'failure':
                    await ws.send(server_frame(153, session=sid))
                else:
                    await ws.send(server_frame(152, session=sid))
            elif event == 101:
                # Old audio after cancellation must never escape to a later turn.
                await ws.send(server_frame(352, PCM, sid, audio=True))
                await ws.send(server_frame(151, session=sid))


async def backend(tmp_path, monkeypatch, provider, *, timeout=1):
    server = await serve(provider, '127.0.0.1', 0)
    monkeypatch.setattr(module, 'ENDPOINT', f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}')
    path = tmp_path / 'tts-credentials.json'
    path.write_text(json.dumps({'access_token': 'fixture-key'}))
    return server, VolcBidirectionalTTS(str(path), timeout=timeout)


async def parts(*values):
    for value in values:
        yield value


async def test_text_and_audio_overlap_before_input_is_complete(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)
    first = asyncio.Event()
    chunks = []

    async def text():
        yield '你'
        await asyncio.wait_for(first.wait(), .5)
        yield '好。'

    def receive(audio):
        chunks.append(audio)
        first.set()

    try:
        await tts.preconnect(VOICE)
        result = await tts.synthesize(text(), receive, voice=VOICE)
        assert pcm(result) == PCM * 2 == b''.join(map(pcm, chunks))
        assert [p['req_params']['text'] for e, _, p in provider.events if e == 200] == ['你', '好。']
        assert provider.connections == 1
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


async def test_successful_sessions_reuse_connection_and_keep_unique_ids(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)
    try:
        for _ in range(2):
            assert pcm(await tts.synthesize(parts('你好。'), lambda _: None, voice=VOICE)) == PCM
        assert provider.connections == 1
        assert len(set(provider.sessions)) == 2
        events = [event for event, _, _ in provider.events]
        assert events == [1, 100, 200, 102, 100, 200, 102]
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


@pytest.mark.parametrize('mode', ['foreign', 'odd-pcm', 'failure', 'hang', 'no-audio', 'malformed'])
async def test_bad_or_incomplete_session_never_returns_success(tmp_path, monkeypatch, mode):
    provider = Provider(mode)
    server, tts = await backend(tmp_path, monkeypatch, provider, timeout=.15)
    chunks = []
    try:
        with pytest.raises((RuntimeError, TimeoutError)):
            await tts.synthesize(parts('你好。'), chunks.append, voice=VOICE)
        if mode != 'failure':
            assert chunks == []
        provider.mode = 'ok'
        assert pcm(await tts.synthesize(parts('新一轮。'), lambda _: None, voice=VOICE)) == PCM
        assert provider.connections == 2
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


async def test_concurrent_turns_serialize_sessions_on_one_connection(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)
    try:
        audio = await asyncio.gather(*[
            tts.synthesize(parts(text), lambda _: None, voice=VOICE)
            for text in ('第一轮。', '第二轮。')])
        assert [pcm(value) for value in audio] == [PCM, PCM]
        assert provider.connections == 1
        assert [event for event, _, _ in provider.events] == [1, 100, 200, 102, 100, 200, 102]
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


async def test_audio_limit_applies_before_callback(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)
    monkeypatch.setattr(module, 'MAX_PCM_BYTES', 2)
    chunks = []
    try:
        with pytest.raises(RuntimeError, match='上限'):
            await tts.synthesize(parts('你好。'), chunks.append, voice=VOICE)
        assert not chunks
        assert len(provider.sessions) == 1
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


async def test_text_source_failure_after_audio_stops_without_regeneration(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)
    first = asyncio.Event()

    async def text():
        yield '你好。'
        await first.wait()
        raise ValueError('public source failed')

    try:
        with pytest.raises(ValueError, match='public source failed'):
            await tts.synthesize(text(), lambda _: first.set(), voice=VOICE)
        assert len(provider.sessions) == 1
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


async def test_cancellation_discards_old_audio_and_does_not_wait_for_text(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)
    first = asyncio.Event()
    chunks = []

    async def text():
        yield '第一轮。'
        await asyncio.Event().wait()

    def receive(audio):
        chunks.append(audio)
        first.set()

    try:
        task = asyncio.create_task(tts.synthesize(text(), receive, voice=VOICE))
        await asyncio.wait_for(first.wait(), .5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, .5)
        delivered = len(chunks)
        assert pcm(await tts.synthesize(parts('第二轮。'), lambda _: None, voice=VOICE)) == PCM
        assert len(chunks) == delivered
        assert provider.connections == 2
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()


async def test_callback_failure_cancels_session_without_regeneration(tmp_path, monkeypatch):
    provider = Provider()
    server, tts = await backend(tmp_path, monkeypatch, provider)

    def receive(_):
        raise ValueError('consumer stopped')

    try:
        with pytest.raises(ValueError, match='consumer stopped'):
            await tts.synthesize(parts('你好。'), receive, voice=VOICE)
        assert len(provider.sessions) == 1
        assert pcm(await tts.synthesize(parts('下一轮。'), lambda _: None, voice=VOICE)) == PCM
        assert provider.connections == 2
    finally:
        await tts.close()
        server.close()
        await server.wait_closed()
