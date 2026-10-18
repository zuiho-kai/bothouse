"""The #42 wire contract, exercised by a simulated device against the real entry.

Every request below goes through ``create_device_app`` with a fake bridge and a
fake ASR/TTS, so these tests prove the transport contract (recording format,
identity, chunk order, playback receipts, reconnect) without a board, a model or
a socket. Board-specific facts stay unverified until the hardware arrives.
"""
import asyncio
import json

import pytest

import httpx

from voice.device_app import create_device_app
from voice.device_terminal import DeviceError, DeviceTerminal, tone_wav
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from voice.speech import _pcm_samples
from test_voice_multi import Bridge
from test_voice_stream import wav

BASE = 'http://127.0.0.1:8796'

class Speech:
    """Two 0.1s chunks that add up to the 0.2s full answer, as in real streaming."""

    def __init__(self):
        self.spoken = []
        self.recordings = []

    def synthesize_stream(self, text, on_chunk, **options):
        self.spoken.append(text)
        on_chunk(wav())
        on_chunk(wav())
        return wav(4800)

    def transcribe(self, body):
        # The server contract, not a permissive stub: 16kHz mono 16bit WAV only.
        _pcm_samples(body, rate=16000, max_bytes=1_000_000, max_seconds=30)
        self.recordings.append(len(body))
        return '今天测试设备接口'

def build(tmp_path, bridge=None, speech=None, **options):
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name + '的设备',
                                            r.project, settings.session_key) for r in roles], roles)
    bridge, speech = bridge or Bridge(), speech or Speech()
    app = create_device_app(settings, devices, speech=speech, bridge=bridge, roles=roles, **options)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE)
    return app, client, bridge, speech

def setup(tmp_path):
    return build(tmp_path)

def terminal(client, device_id, **kwargs):
    return DeviceTerminal(client, BASE, device_id, **kwargs)

def inputs(bridge):
    return [call for call in bridge.calls if call[0] == '/input']

async def settle(app):
    """Let the entry's background bridge work finish before counting calls.

    A turn is accepted before the bridge is called, so asserting straight after
    ``ask()``/``retry()`` races the task that records the call. Only for the
    plain bridge; the gated one blocks until released.
    """
    await asyncio.gather(*list(app.state.service.tasks), return_exceptions=True)

async def ready_terminal(app, client, speech):
    device = terminal(client, 'desk-gge')
    await device.connect()
    await device.transcribe(tone_wav(0.5))
    await device.ask('今天测试设备接口')
    snapshot = await device.wait_ready()
    assert snapshot['status'] == 'ready'
    return device, snapshot

async def test_record_answer_playback_and_completion(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device = terminal(client, 'desk-gge')
        config = await device.connect()
        assert config['default_role'] == 'gge'
        assert config['max_record_seconds'] == 30

        result = await device.transcribe(tone_wav(0.5))
        assert result['text'] == '今天测试设备接口'
        assert speech.recordings and speech.recordings[0] <= 1_000_000

        accepted = await device.ask(result['text'])
        assert accepted['status'] == 'thinking'
        snapshot = await device.wait_ready()
        assert snapshot['audio_complete'] is True
        assert [chunk['index'] for chunk in snapshot['audio_chunks']] == [0, 1]

        played = []
        outcome = await device.play(snapshot, on_chunk=lambda index, audio: played.append((index, audio)))
        assert [index for index, _ in played] == [0, 1]
        assert outcome['played_seconds'] == pytest.approx(0.2)
        # Every chunk is a standalone 24 kHz WAV a device decoder can open alone.
        for _, audio in played:
            assert audio[:4] == b'RIFF' and audio[8:12] == b'WAVE'

        final = await device.status()
        assert final['playback']['state'] == 'completed'
        assert final['playback_allowed'] is False
        assert len(inputs(bridge)) == 1

async def test_reconnect_resumes_without_resubmitting(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        turn_id = device.turn_id

        # Power loss after the first chunk: no completion receipt is sent, but
        # the per-chunk progress receipt is already on the server.
        first = []
        await device.play(snapshot, limit=1, on_chunk=lambda index, audio: first.append(index))
        assert first == [0]
        assert device.played_chunks == 1

        # A rebooted terminal keeps only its flash-persisted ids, not its RAM.
        resumed = terminal(client, 'desk-gge', client_id=device.client_id, turn_id=turn_id)
        state = await resumed.resume()
        assert state['id'] == turn_id
        assert state['playback_allowed'] is True
        assert state['playback']['state'] == 'playing'
        assert resumed.played_chunks == 1

        # The actual chunk order is asserted: replaying 0 is the bug, not a pass.
        played = []
        outcome = await resumed.play(state, on_chunk=lambda index, audio: played.append(index))
        assert played == [1], f'重连实际取块顺序 {played}'
        assert outcome['completed'] is True
        assert outcome['played_seconds'] == pytest.approx(0.2)
        assert len(inputs(bridge)) == 1

        # Resending the same turn id is idempotent: same turn, no second /input.
        again = await resumed.retry('今天测试设备接口')
        assert again['id'] == turn_id
        assert len(inputs(bridge)) == 1

async def test_new_question_gets_a_new_turn_after_the_previous_one_finished(tmp_path):
    """A second question must not inherit the finished turn's id (409)."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        old_id = device.turn_id
        await device.play(snapshot)
        assert device.played_chunks == 2

        result = await device.ask('第二个不同的问题')
        assert result['id'] != old_id
        assert result['status'] == 'thinking'
        assert device.played_chunks == 0

        second = await device.wait_ready()
        assert second['status'] == 'ready'
        await device.play(second)
        assert len(inputs(bridge)) == 2

async def test_same_turn_id_with_different_text_is_still_refused(tmp_path):
    """Reusing an id is only for resending the same question."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, _ = await ready_terminal(app, client, speech)
        with pytest.raises(DeviceError) as local:
            await device.ask('换一个问题', turn_id=device.turn_id)
        assert local.value.status == 0, 'the terminal refuses before reaching the server'
        # The server-side rule still holds for any client that skips the guard.
        response = await client.post(f'{BASE}/device/desk-gge/api/turn', headers=device._headers(),
                                     json={'id': device.turn_id, 'project': 'gge', 'text': '换一个问题'})
        assert response.status_code == 409
        assert '同一请求编号' in response.json()['detail']
        assert len(inputs(bridge)) == 1

async def test_a_finished_turn_is_never_replayed_after_a_reboot(tmp_path):
    """A completed turn is not resumable, even if the device kept its turn id."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        await device.play(snapshot)

        resumed = terminal(client, 'desk-gge', client_id=device.client_id, turn_id=device.turn_id)
        resumed.played_chunks = 7  # stale cursor from the previous session
        state = await resumed.resume()
        assert state['id'] == device.turn_id
        assert resumed.finished is True
        assert resumed.played_chunks == 0
        with pytest.raises(DeviceError) as refused:
            await resumed.play(state)
        assert '不重播' in refused.value.detail

async def test_stale_cursor_on_a_running_turn_falls_back_to_the_recorded_position(tmp_path):
    """A cursor that does not match this turn is replaced by the server's."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        await device.play(snapshot, limit=1)

        resumed = terminal(client, 'desk-gge', client_id=device.client_id, turn_id=device.turn_id)
        resumed.played_chunks = 7
        await resumed.resume()
        assert resumed.played_chunks == 1
        played = []
        await resumed.play(await resumed.status(), on_chunk=lambda index, audio: played.append(index))
        assert played == [1]

async def test_another_device_cannot_take_the_turn(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, _ = await ready_terminal(app, client, speech)
        intruder = terminal(client, 'desk-cursor')
        await intruder.connect()
        with pytest.raises(DeviceError) as refused:
            await intruder.status(device.turn_id)
        assert refused.value.status == 404

async def test_recording_must_be_16khz_mono_pcm(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device = terminal(client, 'desk-gge')
        await device.connect()
        with pytest.raises(DeviceError) as refused:
            await device.transcribe(tone_wav(0.5, rate=24000))
        assert refused.value.status == 422
        assert '16000Hz' in refused.value.detail

async def test_completion_requires_the_whole_answer(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, _ = await ready_terminal(app, client, speech)
        with pytest.raises(DeviceError) as refused:
            await device.receipt(device.turn_id, 'completed', 0.05, 0.2)
        assert refused.value.status == 409
        # A rejected completion must not be recorded as a finished playback.
        snapshot = await device.status()
        assert snapshot['status'] == 'ready'
        assert snapshot.get('playback', {}).get('state') in {None, 'not_started'}

async def test_stop_refuses_late_audio(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        stopped = await device.stop()
        assert stopped['playback_allowed'] is False
        with pytest.raises(DeviceError) as refused:
            await device.play(snapshot)
        assert refused.value.status == 409

def test_protocol_samples_match_schema():
    """The doc's samples must stay valid against the shipped schema."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / 'examples' / 'device-protocol' / 'validate.py'
    spec = importlib.util.spec_from_file_location('device_protocol_validate', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.main() == 0

class GatedBridge(Bridge):
    """Keeps the agent 'running' until released, like a slow real session."""

    def __init__(self):
        super().__init__()
        import threading
        self.release = threading.Event()

    def call(self, path, body=None):
        if body is None and path.startswith('/input/') and not path.startswith('/input/bindings'):
            if not self.release.is_set():
                self.calls.append((path, body))
                return {'status': 'running'}
        return super().call(path, body)

async def test_stop_drain_blocks_recording_until_release(tmp_path):
    """Stopping playback does not free the device slot; recording must wait."""
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    async with client:
        device = terminal(client, 'desk-gge')
        await device.connect()
        await device.transcribe(tone_wav(0.5))
        await device.ask('今天测试设备接口')
        stopped = await device.stop()
        assert stopped['playback_allowed'] is False
        # The per-turn release flag, not the stop acknowledgement, says free.
        assert stopped['device_released'] is False

        # The agent is still finishing: the device must not report itself ready.
        with pytest.raises(DeviceError) as draining:
            await device.wait_for_release(timeout=0.3)
        assert '收尾' in draining.value.detail
        with pytest.raises(DeviceError) as refused:
            await device.transcribe(tone_wav(0.5))
        assert refused.value.status == 409

        bridge.release.set()
        await asyncio.gather(*app.state.service.tasks)
        assert (await device.status())['device_released'] is True
        await device.wait_for_release(timeout=5)

        # After the release the same device records and completes normally.
        assert (await device.transcribe(tone_wav(0.5)))['text']
        device.turn_id = None
        await device.ask('今天测试设备接口')
        snapshot = await device.wait_ready()
        assert snapshot['status'] == 'ready'
        assert (await device.play(snapshot))['completed'] is True
        assert len(inputs(bridge)) == 2

async def test_release_is_per_turn_and_recording_is_per_device(tmp_path):
    """#33: one voice plays at a time, but each device keeps its own microphone.

    G哥 finishing its answer must not be a precondition for Cursor to record or
    ask. What stays global is the sound: a second answer waits for the slot.
    """
    bridge = GatedBridge()
    bridge.release.set()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    async with client:
        gge = terminal(client, 'desk-gge')
        await gge.connect()
        await gge.transcribe(tone_wav(0.5))
        await gge.ask('今天测试设备接口')
        snapshot = await gge.wait_ready()
        await gge.play(snapshot)
        assert (await gge.status())['device_released'] is True

        # Cursor records and asks while its own slot is free; nothing blocks it.
        cursor = terminal(client, 'desk-cursor')
        await cursor.connect()
        await cursor.transcribe(tone_wav(0.5))
        await cursor.ask('今天测试设备接口')
        await asyncio.gather(*app.state.service.tasks)

        # G哥 is free again even though Cursor's answer has not played yet.
        await gge.wait_for_release(timeout=5)
        assert (await cursor.status())['device_released'] is False

        # The sound, however, is still Cursor's: G哥's next answer must wait.
        cursor_snapshot = await cursor.wait_ready()
        assert app.state.room.active == cursor_snapshot['id']
        await cursor.play(cursor_snapshot, limit=1)  # first chunk is sounding now
        assert (await gge.transcribe(tone_wav(0.5)))['text']
        gge.turn_id = None
        await gge.ask('我也说一句')
        await asyncio.gather(*app.state.service.tasks)
        # status() can inspect a generated answer while it is queued;
        # wait_ready() must not return until the answer may actually play.
        waiting = await gge.status()
        assert waiting['status'] == 'ready'
        assert waiting['playback_allowed'] is False and 'audio_url' not in waiting
        assert app.state.room.active == cursor_snapshot['id']

        # Once Cursor's answer is over, the queued answer gets the sound.
        await cursor.play(cursor_snapshot)
        assert app.state.room.active == waiting['id']
        await gge.play(await gge.wait_ready())
        await gge.wait_for_release(timeout=5)


async def test_reboot_restores_turn_and_cursor_from_flash(tmp_path):
    """The device's NVS alone is enough: no ids passed in by the test."""
    app, client, bridge, speech = setup(tmp_path)
    state = tmp_path / 'nvs' / 'terminal.json'
    async with client:
        device = terminal(client, 'desk-gge', state_path=str(state))
        await device.connect()
        await device.transcribe(tone_wav(0.5))
        await device.ask('今天测试设备接口')
        snapshot = await device.wait_ready()
        first = []
        await device.play(snapshot, limit=1, on_chunk=lambda index, audio: first.append(index))
        assert first == [0]
        assert state.is_file()
        assert oct(state.stat().st_mode & 0o777) == '0o600'

        # Reboot: a fresh object that only knows the device id and its flash.
        rebooted = terminal(client, 'desk-gge', state_path=str(state))
        assert rebooted.client_id == device.client_id
        assert rebooted.turn_id == device.turn_id
        state_snapshot = await rebooted.resume()
        assert rebooted.played_chunks == 1
        played = []
        outcome = await rebooted.play(state_snapshot, on_chunk=lambda index, audio: played.append(index))
        assert played == [1], f'重启后实际取块顺序 {played}'
        assert outcome['completed'] is True
        assert len(inputs(bridge)) == 1
        # The finished turn is recorded as finished, not resumable.
        assert json.loads(state.read_text())['finished'] is True


async def test_state_from_another_device_is_never_adopted(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    state = tmp_path / 'terminal.json'
    state.write_text(json.dumps({'device_id': 'desk-cursor', 'client_id': 'x',
                                 'turn_id': 'y', 'played_chunks': 5}))
    async with client:
        device = terminal(client, 'desk-gge', state_path=str(state))
        assert device.turn_id is None
        assert device.played_chunks == 0
        assert device.client_id != 'x'


async def test_cursor_never_skips_ahead_of_the_server(tmp_path):
    """A flash cursor ahead of the server's receipts must not skip audio."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        await device.play(snapshot, limit=1)
        # Flash says 2 chunks played, the server only ever got chunk 0.
        device.played_chunks = 2
        resumed = await device.resume()
        assert resumed['id'] == device.turn_id
        assert device.played_chunks == 1, '以服务端回执为准，不能跳过第 1 块'
        played = []
        await device.play(resumed, on_chunk=lambda index, audio: played.append(index))
        assert played == [1]

class DropNextTurnPost:
    """A client whose first turn submission never reaches the server."""

    def __init__(self, inner):
        self.inner, self.drop = inner, True

    async def get(self, url, **kwargs):
        return await self.inner.get(url, **kwargs)

    async def post(self, url, **kwargs):
        if url.endswith('/api/turn') and self.drop:
            self.drop = False
            raise RuntimeError('网络中断')
        return await self.inner.post(url, **kwargs)


async def test_stop_keeps_turn_id_until_release_then_new_question_gets_new_id(tmp_path):
    """The id must survive draining: it is how the release state is queried."""
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    async with client:
        device = terminal(client, 'desk-gge')
        await device.connect()
        await device.transcribe(tone_wav(0.5))
        await device.ask('今天测试设备接口')
        turn_id = device.turn_id
        await device.stop()

        # Draining: still holding the id, still not allowed to record.
        with pytest.raises(DeviceError):
            await device.wait_for_release(timeout=0.3)
        assert device.turn_id == turn_id

        bridge.release.set()
        await asyncio.gather(*app.state.service.tasks)
        await device.wait_for_release(timeout=5)
        assert device.turn_id is None, '释放后必须清掉编号'

        result = await device.ask('新问题')
        assert result['id'] != turn_id
        assert (await device.wait_ready())['status'] == 'ready'


async def test_uncertain_delivery_keeps_the_turn_id_for_retry(tmp_path):
    """An unknown outcome must not silently turn into a new question."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device = DeviceTerminal(DropNextTurnPost(client), BASE, 'desk-gge')
        await device.connect()
        await device.transcribe(tone_wav(0.5))
        with pytest.raises(RuntimeError):
            await device.ask('今天测试设备接口')
        kept = device.turn_id
        assert kept is not None

        result = await device.retry('今天测试设备接口')
        assert result['id'] == kept
        await settle(app)
        assert len(inputs(bridge)) == 1, '重发原轮不能变成第二次投递'


async def test_completion_receipt_counts_the_chunk_played_before_reconnect(tmp_path):
    """Resuming plays only [1], but the position still includes chunk 0."""
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        device, snapshot = await ready_terminal(app, client, speech)
        await device.play(snapshot, limit=1)

        resumed = terminal(client, 'desk-gge', client_id=device.client_id, turn_id=device.turn_id)
        await resumed.resume()
        assert resumed.played_chunks == 1

        receipts = []
        original = resumed.receipt

        async def record(turn_id, state, position, duration):
            receipts.append((state, position, duration))
            await original(turn_id, state, position, duration)

        resumed.receipt = record
        played = []
        await resumed.play(await resumed.status(), on_chunk=lambda index, audio: played.append(index))

        assert played == [1]
        assert [r for r in receipts if r[0] == 'playing'] == [('playing', 0.2, 0.2)]
        assert [r for r in receipts if r[0] == 'completed'] == [('completed', 0.2, 0.2)], \
            '完成回执必须累计第 0 块的 0.1 秒，不能只报本次续播'


async def test_ask_during_draining_is_refused_locally_and_keeps_the_turn_id(tmp_path):
    """Asking a new question while draining must not burn the old turn id.

    C酱 复现：`ask()` 在发请求前就换掉了 `turn_id`，服务端正确返回 409，但旧编号
    已经丢了，之后 `wait_for_release()` 查不到那一轮。现在在本地就拒绝。
    """
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    async with client:
        device = terminal(client, 'desk-gge')
        await device.connect()
        await device.ask('第一个问题')
        first = device.turn_id
        await device.stop()
        assert device.state == 'draining'
        sent = len(inputs(bridge))

        with pytest.raises(DeviceError) as refused:
            await device.ask('收尾期间就问第二个问题')
        assert refused.value.status == 0, '本地拒绝，不该是服务端 409'
        assert 'wait_for_release' in refused.value.detail
        assert device.turn_id == first, '旧编号必须保留，否则查不到释放状态'
        assert len(inputs(bridge)) == sent, '本地拒绝不能发请求，更不能多投递'

        # 释放后旧编号清掉，新问题才拿到新编号。
        bridge.release.set()
        await asyncio.gather(*app.state.service.tasks)
        await device.wait_for_release(timeout=5)
        assert device.turn_id is None
        second = await device.ask('第二个问题')
        assert second['id'] != first


class LoseNextTurnResponse(DropNextTurnPost):
    """The first turn submission reaches the server, but its response is lost."""

    async def post(self, url, **kwargs):
        response = await self.inner.post(url, **kwargs)
        if url.endswith('/api/turn') and self.drop:
            self.drop = False
            raise RuntimeError('响应超时')
        return response


async def test_new_question_while_draining_is_refused_and_keeps_the_old_id(tmp_path):
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    state = tmp_path / 'device-state.json'
    try:
        async with client:
            device = terminal(client, 'desk-gge', state_path=str(state))
            await device.connect()
            await device.ask('第一个问题')
            first = device.turn_id
            await device.stop()
            with pytest.raises(DeviceError) as refused:
                await device.ask('收尾期间就问第二个问题')
            assert refused.value.status == 0
            assert device.turn_id == first and device.state == 'draining'
            assert json.loads(state.read_text())['turn_id'] == first, 'flash 里也不能被覆盖'

            bridge.release.set()
            await asyncio.gather(*app.state.service.tasks)
            await device.wait_for_release(timeout=5)
            second = await device.ask('收尾后再问')
            assert second['id'] != first
            await asyncio.gather(*app.state.service.tasks)
            # Whether the stopped first turn reached /input depends on timing; the
            # refused question must never be delivered under any id.
            sent = [body['request_id'] for _, body in inputs(bridge)]
            assert sent.count('voice-' + second['id']) == 1
            assert set(sent) <= {'voice-' + first, 'voice-' + second['id']} and len(sent) == len(set(sent))
    finally:
        bridge.release.set()


async def test_lost_response_blocks_new_turns_until_retry_even_after_reboot(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    state = tmp_path / 'device-state.json'
    async with client:
        device = DeviceTerminal(LoseNextTurnResponse(client), BASE, 'desk-gge', state_path=str(state))
        await device.connect()
        with pytest.raises(RuntimeError):
            await device.ask('今天测试设备接口')
        pending = device.turn_id
        assert device.unconfirmed
        with pytest.raises(DeviceError):
            await device.ask('换个问题')

        rebooted = DeviceTerminal(client, BASE, 'desk-gge', state_path=str(state))
        assert rebooted.turn_id == pending and rebooted.unconfirmed
        await rebooted.connect()
        assert rebooted.unconfirmed, 'connect() alone must not forget an unconfirmed submission'
        with pytest.raises(DeviceError):
            await rebooted.ask('重启后另开新轮')
        result = await rebooted.retry('今天测试设备接口')
        assert result['id'] == pending and not rebooted.unconfirmed
        await settle(app)
        assert len(inputs(bridge)) == 1, '重发原轮不能变成第二次投递'


async def test_definite_refusal_does_not_block_the_next_question(tmp_path):
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    try:
        async with client:
            gge, cursor = terminal(client, 'desk-gge'), terminal(client, 'desk-cursor')
            await gge.connect()
            await cursor.connect()
            await cursor.ask('Cursor 先占着房间')
            with pytest.raises(DeviceError) as busy:
                await gge.ask('G哥 这边被拒')
            assert busy.value.status == 409 and not gge.unconfirmed

            bridge.release.set()
            await asyncio.gather(*app.state.service.tasks)
            await cursor.stop()
            await cursor.wait_for_release(timeout=5)
            accepted = await gge.ask('房间空了再问')
            assert accepted['status'] in {'thinking', 'ready', 'synthesizing'}
    finally:
        bridge.release.set()


@pytest.mark.parametrize('stopped', [False, True])
async def test_reboot_before_release_cannot_start_a_new_turn(tmp_path, stopped):
    """resume() restores waiting/draining from the server, not listening."""
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    state = tmp_path / 'device-state.json'
    try:
        async with client:
            original = terminal(client, 'desk-gge', state_path=str(state))
            await original.connect()
            await original.ask('第一个问题')
            old = original.turn_id
            if stopped:
                await original.stop()
            rebooted = terminal(client, 'desk-gge', state_path=str(state))
            snapshot = await rebooted.resume()
            assert snapshot['device_released'] is False
            assert rebooted.state == ('draining' if stopped else 'waiting')
            with pytest.raises(DeviceError) as refused:
                await rebooted.ask('释放前就问第二个问题')
            assert refused.value.status == 0
            assert rebooted.turn_id == old
            assert json.loads(state.read_text())['turn_id'] == old
    finally:
        bridge.release.set()
        await asyncio.gather(*app.state.service.tasks, return_exceptions=True)


async def test_reboot_after_release_listens_and_takes_a_new_question(tmp_path):
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    state = tmp_path / 'device-state.json'
    try:
        async with client:
            original = terminal(client, 'desk-gge', state_path=str(state))
            await original.connect()
            await original.ask('第一个问题')
            old = original.turn_id
            await original.stop()
            bridge.release.set()
            await asyncio.gather(*app.state.service.tasks)

            rebooted = terminal(client, 'desk-gge', state_path=str(state))
            snapshot = await rebooted.resume()
            assert snapshot['device_released'] is True and rebooted.state == 'listening'
            accepted = await rebooted.ask('重启后的新问题')
            assert accepted['id'] != old
    finally:
        bridge.release.set()
        await asyncio.gather(*app.state.service.tasks, return_exceptions=True)


@pytest.mark.parametrize('stopped', [False, True])
async def test_reboot_with_connect_only_still_cannot_replace_an_unreleased_turn(tmp_path, stopped):
    """connect() alone leaves stale local state; ask() asks the server first."""
    bridge = GatedBridge()
    app, client, bridge, speech = build(tmp_path, bridge=bridge)
    state = tmp_path / 'device-state.json'
    try:
        async with client:
            original = terminal(client, 'desk-gge', state_path=str(state))
            await original.connect()
            await original.ask('第一个问题')
            old = original.turn_id
            if stopped:
                await original.stop()
            rebooted = terminal(client, 'desk-gge', state_path=str(state))
            await rebooted.connect()
            with pytest.raises(DeviceError) as refused:
                await rebooted.ask('释放前就问第二个问题')
            assert refused.value.status == 0
            assert rebooted.state == ('draining' if stopped else 'waiting')
            assert (rebooted.turn_id, json.loads(state.read_text())['turn_id']) == (old, old)
            sent = [body['request_id'] for _, body in inputs(bridge)]
            assert all(rid == 'voice-' + old for rid in sent)
    finally:
        bridge.release.set()
        await asyncio.gather(*app.state.service.tasks, return_exceptions=True)


class LeaseClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


async def test_heartbeat_and_abandoned_lease_are_visible_to_the_device(tmp_path):
    """A vanished device loses the slot; the reason is not hidden from it."""
    clock = LeaseClock()
    app, client, bridge, speech = setup(tmp_path)
    app.state.room.clock = clock
    app.state.room.lease_seconds = 30.0
    async with client:
        device = terminal(client, 'desk-gge')
        await device.connect()
        await device.transcribe(tone_wav(0.5))
        await device.ask('第一个问题')
        first = device.turn_id
        await device.wait_ready()

        beat = await device.heartbeat()
        assert beat['ok'] is True and beat['active_turn'] == first
        assert beat['lease']['seconds'] == 30.0

        # The device goes silent past the lease: the slot is released, and the
        # old turn is reported as abandoned rather than finished.
        clock.now += 31
        snapshot = await device.status(first)
        assert snapshot['abandoned'] is True
        assert '心跳' in snapshot['abandon_reason']
        assert snapshot['device_released'] is True

        # A returning device reconnects before it talks again.
        await device.resume()
        assert device.state == 'listening'
        second = await device.ask('第二个问题')
        assert second['id'] != first
        assert (await device.wait_ready())['status'] == 'ready'
