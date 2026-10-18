import asyncio
import logging.config
from dataclasses import asdict
import json
from uuid import uuid4

import httpx
import pytest

from voice.app import TurnInput
from voice.device_app import create_device_app
from voice.device_server import read_settings
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge
from test_voice_stream import GatedSpeech, wav


class Speech:
    def __init__(self):
        self.spoken = []

    def synthesize_stream(self, text, on_chunk, **options):
        self.spoken.append(text)
        on_chunk(wav())
        on_chunk(wav())
        return wav(4800)

    def transcribe(self, body):
        return '只做转写，不发送'


def setup(tmp_path, speech=None):
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name + '的设备',
                                            r.project, settings.session_key) for r in roles], roles)
    bridge, speech = Bridge(), speech or Speech()
    app = create_device_app(settings, devices, speech=speech, bridge=bridge, roles=roles)
    headers = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8796', headers=headers)
    return app, client, bridge, speech


def path(project='gge', identifier=None):
    root = '/device/desk-' + project + '/api'
    return root if identifier is None else root + '/turn/' + identifier


def payload(project='gge'):
    return {'id': str(uuid4()), 'project': project, 'text': '接着聊'}


async def finish(app):
    await asyncio.gather(*app.state.service.tasks)


async def play(client, data):
    root = path(data['project'], data['id'])
    result = (await client.get(root)).json()
    assert (await client.get(result['audio_url'])).status_code == 200
    assert (await client.post(root + '/playback', json={
        'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})).status_code == 200
    assert (await client.post(root + '/playback', json={
        'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2})).status_code == 200


async def test_fixed_identity_audio_and_shared_memory_a_b_a(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    async with client:
        for project in ('gge', 'cursor', 'gge'):
            cfg = (await client.get(path(project) + '/config')).json()
            assert [r['id'] for r in cfg['roles']] == [project]
            data = payload(project)
            assert (await client.post(path(project) + '/turn', json=data)).status_code == 202
            await finish(app)
            result = (await client.get(path(project, data['id']))).json()
            assert result['device_id'] == result['audio_target'] == 'desk-' + project
            assert result['agent_session_id'] == project + '-cli'
            assert (await client.get(path('cursor' if project == 'gge' else 'gge', data['id']))).status_code == 404
            await play(client, data)
            assert (await client.get(result['audio_url'])).status_code == 409
    assert [r['project'] for r in bridge.requests.values()] == ['gge', 'cursor', 'gge']
    assert len(speech.spoken) == 3
    events = [json.loads(line) for file in (tmp_path / 'memory').glob('*.jsonl') for line in file.read_text().splitlines()]
    finished = [event for event in events if event['event'] == 'finished']
    assert [event['device_id'] for event in finished] == ['desk-gge', 'desk-cursor', 'desk-gge']
    assert all(event['audio_target'] == event['device_id'] for event in finished)
    assert all('/send' not in endpoint for endpoint, _ in bridge.calls)


async def test_lease_covers_ready_until_real_playback_and_cannot_be_forged(tmp_path):
    """Ready-but-unplayed audio keeps the playback slot; a forged receipt cannot end it."""
    app, client, bridge, _ = setup(tmp_path)
    async with client:
        first = payload()
        await client.post(path() + '/turn', json=first)
        await finish(app)
        assert app.state.service.active is None  # synthesis alone used to release occupancy
        assert app.state.room.active == first['id']
        endpoint = path('gge', first['id']) + '/playback'
        for duration in (0, .1, .2):
            assert (await client.post(endpoint, json={'state': 'completed', 'position_seconds': duration,
                                                      'duration_seconds': duration})).status_code == 409
        snapshot = (await client.get(path('gge', first['id']))).json()
        await client.get(snapshot['audio_url'])
        await client.post(endpoint, json={'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})
        for duration in (0, .1):
            assert (await client.post(endpoint, json={'state': 'completed', 'position_seconds': duration,
                                                      'duration_seconds': duration})).status_code == 409
        await play(client, first)
        # Playback is free again; the other device may ask and own the slot.
        second = payload('cursor')
        assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 202
        await finish(app)
        # An old delayed event cannot release or overwrite the new turn.
        assert (await client.post(endpoint, json={'state': 'playing', 'position_seconds': 0,
                                                 'duration_seconds': .2})).status_code == 409
        assert app.state.room.active == second['id']


async def test_duplicate_page_cannot_fetch_stop_or_replay_owner(tmp_path):
    app, client, bridge, _ = setup(tmp_path)
    async with client:
        data = payload()
        await client.post(path() + '/turn', json=data)
        await finish(app)
        root = path('gge', data['id'])
        result = (await client.get(root)).json()
        other = {'X-Device-Client': str(uuid4())}
        assert (await client.get(result['audio_url'], headers=other)).status_code == 409
        assert (await client.post(root + '/stop', headers=other)).status_code == 409
        assert (await client.post(path() + '/turn', json=data, headers=other)).status_code == 409
        duplicate = (await client.get(root, headers=other)).json()
        assert duplicate['playback_allowed'] is False and 'audio_url' not in duplicate
        assert (await client.get(path() + '/config', headers=other)).json()['active_turn'] is None
        assert (await client.post(path() + '/turn', json=data)).status_code == 202
        assert len(bridge.requests) == 1


async def test_cancel_during_binding_admission_delivers_nothing(tmp_path):
    app, client, bridge, _ = setup(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()
    original = app.state.service.binding

    async def gated(project):
        entered.set()
        await release.wait()
        return await original(project)

    app.state.service.binding = gated
    async with client:
        data = payload()
        submit = asyncio.create_task(client.post(path() + '/turn', json=data))
        await entered.wait()
        assert (await client.post(path('gge', data['id']) + '/stop')).status_code == 200
        release.set()
        assert (await submit).status_code == 409
        assert not bridge.requests and app.state.room.active is None


async def test_cancel_during_post_drains_then_ignores_late_answer(tmp_path):
    app, client, bridge, speech = setup(tmp_path)
    import threading
    entered, release = threading.Event(), threading.Event()
    original = bridge.call

    def gated(endpoint, body=None):
        if endpoint == '/input':
            entered.set()
            assert release.wait(5)
        return original(endpoint, body)

    bridge.call = gated
    try:
        async with client:
            data = payload()
            await client.post(path() + '/turn', json=data)
            assert await asyncio.to_thread(entered.wait, 2)
            assert (await client.post(path('gge', data['id']) + '/stop')).status_code == 200
            assert (await client.post(path('cursor') + '/turn', json=payload('cursor'))).status_code == 409
            release.set()
            await finish(app)
            result = (await client.get(path('gge', data['id']))).json()
            assert result['status'] == 'stopped' and not result['playback_allowed']
            assert not speech.spoken and len(bridge.requests) == 1
            assert app.state.room.active is None
    finally:
        release.set()
        await finish(app)


async def test_stop_during_stream_hides_late_chunks_and_retains_slot(tmp_path):
    speech = GatedSpeech()
    app, client, bridge, _ = setup(tmp_path, speech=speech)
    try:
        async with client:
            data = payload()
            await client.post(path() + '/turn', json=data)
            assert await asyncio.to_thread(speech.first.wait, 2)
            root = path('gge', data['id'])
            snapshot = (await client.get(root)).json()
            url = snapshot['audio_chunks'][0]['audio_url']
            assert (await client.get(url)).status_code == 200
            await client.post(root + '/stop')
            assert (await client.get(url)).status_code == 409
            assert (await client.post(path('cursor') + '/turn', json=payload('cursor'))).status_code == 409
            speech.release.set()
            await finish(app)
            assert len(app.state.service.audio_chunks[data['id']]) == 1
            assert (await client.get(root)).json()['status'] == 'stopped'
    finally:
        speech.release.set()
        await finish(app)


async def test_concurrent_devices_and_rebinding_fail_closed(tmp_path):
    app, client, bridge, _ = setup(tmp_path)
    async with client:
        a, b = payload(), payload('cursor')
        result = await asyncio.gather(client.post(path() + '/turn', json=a),
                                      client.post(path('cursor') + '/turn', json=b))
        assert sorted(r.status_code for r in result) == [202, 409]
        await finish(app)
        winner = a if result[0].status_code == 202 else b
        await client.post(path(winner['project'], winner['id']) + '/stop')
        original = bridge.call

        def changed(endpoint, body=None):
            result = original(endpoint, body)
            if endpoint.startswith('/input/bindings?'):
                result['agent_session_id'] = 'new-cli'
            return result

        bridge.call = changed
        assert (await client.post(path(winner['project']) + '/turn', json=payload(winner['project']))).status_code == 409
        assert len(bridge.requests) == 1


async def test_no_generic_api_bypass_and_transcription_does_not_dispatch(tmp_path):
    app, client, bridge, _ = setup(tmp_path)
    async with client:
        assert (await client.post('/api/turn', json=payload())).status_code == 404
        assert (await client.post(path() + '/turn', json=payload('cursor'))).status_code == 400
        assert (await client.get('/device/unknown')).status_code == 404
        assert (await client.post(path() + '/turn', json=payload(), headers={'Origin': 'https://example.invalid'})).status_code == 403
        assert (await client.post(path() + '/transcribe', content=b'fixture')).json()['text'] == '只做转写，不发送'
        assert not bridge.requests


@pytest.mark.parametrize('key,value', [('project', None), ('session_key', ''), ('bridge_socket', 12), ('port', True)])
def test_entry_requires_explicit_bindings(tmp_path, key, value):
    config = tmp_path / 'config.json'
    values = asdict(Settings(project='gge', role_name='G哥', session_key='discord:example',
                            bridge_socket=str(tmp_path / 'bridge.sock'), model_path=str(tmp_path),
                            data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory')))
    values[key] = value
    config.write_text(json.dumps(values))
    with pytest.raises(ValueError):
        read_settings(config)


async def test_cancelled_http_admission_does_not_leak_slot(tmp_path):
    app, client, bridge, _ = setup(tmp_path)
    entered = asyncio.Event()

    async def suspended(project):
        entered.set()
        await asyncio.Event().wait()

    app.state.service.binding = suspended
    pending = asyncio.create_task(app.state.room.submit('desk-gge', str(uuid4()), TurnInput(**payload())))
    await entered.wait()
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert app.state.room.active is None and not bridge.requests
    await client.aclose()


async def test_evicted_audio_does_not_make_old_retry_look_pending_or_resend(tmp_path):
    app, client, bridge, _ = setup(tmp_path)
    first = None
    async with client:
        for _ in range(21):
            data = payload()
            first = first or data
            assert (await client.post(path() + '/turn', json=data)).status_code == 202
            await finish(app)
            await play(client, data)
        assert first['id'] not in app.state.service.turns
        assert (await client.get(path('gge', first['id']))).status_code == 410
        assert (await client.post(path() + '/turn', json=first)).status_code == 410
        assert len(bridge.requests) == 21


async def test_stop_while_agent_runs_reports_drain_until_release_then_same_device_recovers(tmp_path):
    # Stop during thinking: the delivered CLI task keeps running. The stop
    # acknowledgement must not read as "device free", or the page lets the
    # user record a whole sentence only to receive a 409 from /transcribe.
    app, client, bridge, speech = setup(tmp_path)
    import threading
    running = threading.Event()
    original = bridge.call

    def held(endpoint, body=None):
        if endpoint.startswith('/input/') and not endpoint.startswith('/input/bindings') and not running.is_set():
            return {'status': 'running'}
        return original(endpoint, body)

    bridge.call = held
    try:
        async with client:
            first = payload()
            await client.post(path() + '/turn', json=first)
            root = path('gge', first['id'])
            stopped = (await client.post(root + '/stop')).json()
            assert stopped['status'] == 'stopped' and stopped['device_released'] is False
            assert (await client.get(root)).json()['device_released'] is False
            fresh_page = {'X-Device-Client': str(uuid4())}
            role = (await client.get(path() + '/config', headers=fresh_page)).json()['roles'][0]
            assert role['available'] is False
            assert (await client.post(path() + '/transcribe', content=b'fixture')).status_code == 409
            assert (await client.post(path() + '/turn', json=payload())).status_code == 409

            running.set()
            await finish(app)
            drained = (await client.get(root)).json()
            assert drained['status'] == 'stopped' and drained['device_released'] is True
            assert not drained['playback_allowed'] and 'audio_url' not in drained
            assert (await client.get(path() + '/config')).json()['roles'][0]['available'] is True
            assert (await client.post(path() + '/transcribe', content=b'fixture')).status_code == 200
            second = payload()
            assert (await client.post(path() + '/turn', json=second)).status_code == 202
            await finish(app)
            assert (await client.get(path('gge', second['id']))).json()['status'] == 'ready'
            await play(client, second)
            assert list(bridge.requests) == [f'voice-{first["id"]}', f'voice-{second["id"]}']
            assert speech.spoken == ['gge的回答']
    finally:
        running.set()
        await finish(app)


def test_device_server_access_log_is_timestamped():
    import logging
    from voice.device_server import timestamped_log_config
    config = timestamped_log_config()
    assert all(f['fmt'].startswith('%(asctime)s ') for f in config['formatters'].values())
    logging.config.dictConfig(config)
