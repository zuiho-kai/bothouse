"""The lost-connection lease: a silent device gives the slot back, out loud.

Silence is not proof that a turn ended. The lease releases the shared *slot*
so another device can talk, and records why the turn stopped being playable;
it never reports the answer as heard or the turn as completed.
"""
import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from voice.device_app import create_device_app
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge
from test_voice_stream import wav

class Clock:
    """A monotonic clock the test moves by hand; the lease must not guess."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds

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

def setup(tmp_path, lease_seconds=30.0):
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name + '的设备',
                                            r.project, settings.session_key) for r in roles], roles)
    bridge, speech, clock = Bridge(), Speech(), Clock()
    app = create_device_app(settings, devices, speech=speech, bridge=bridge, roles=roles,
                            lease_seconds=lease_seconds, clock=clock)
    headers = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                               base_url='http://127.0.0.1:8796', headers=headers)
    return app, client, bridge, speech, clock

def path(project='gge', identifier=None):
    root = '/device/desk-' + project + '/api'
    return root if identifier is None else root + '/turn/' + identifier

def payload(project='gge'):
    return {'id': str(uuid4()), 'project': project, 'text': '接着聊'}

async def finish(app):
    await asyncio.gather(*app.state.service.tasks)

async def test_a_silent_device_returns_the_slot_with_an_explicit_reason(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first, second = payload(), payload('cursor')
        assert (await client.post(path() + '/turn', json=first)).status_code == 202
        await finish(app)
        # Ready but never played: the slot is still held, as before.
        assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 409

        clock.advance(31)
        assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 202

        snapshot = (await client.get(path('gge', first['id']))).json()
        assert snapshot['abandoned'] is True
        assert '心跳' in snapshot['abandon_reason']
        assert snapshot['device_released'] is True
        assert snapshot['playback_allowed'] is False
        assert snapshot['status'] == 'stopped'
        assert 'audio_chunks' not in snapshot
        # Not a completion: the turn is recorded as stopped, never as heard.
        assert snapshot['playback']['state'] == 'stopped'
        assert 'completed' not in snapshot or not snapshot['completed']

        config = (await client.get(path() + '/config')).json()
        assert config['last_release']['reason'] == 'lease-expired'
        assert config['last_release']['turn_id'] == first['id']
        assert '心跳' in config['last_release']['detail']

async def test_first_request_after_sixty_one_seconds_releases_the_old_slot(tmp_path):
    """Pruning the lease table must not erase the evidence that it expired."""
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first, second = payload(), payload('cursor')
        assert (await client.post(path() + '/turn', json=first)).status_code == 202
        await finish(app)
        clock.advance(61)
        response = await client.post(path('cursor') + '/turn', json=second)
        assert response.status_code == 202, response.text
        assert app.state.room.records[first['id']]['abandoned'] is True

async def test_repeated_long_silences_do_not_revive_the_old_lease(tmp_path):
    """Each interval is over two lease periods; the abandoned slot stays free."""
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first, second = payload(), payload('cursor')
        assert (await client.post(path() + '/turn', json=first)).status_code == 202
        await finish(app)
        for _ in range(3):
            clock.advance(61)
            config = (await client.get(path() + '/config')).json()
            assert config['active_turn'] is None
            assert config['roles'][0]['available'] is True
            assert app.state.room.active is None
        assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 202

async def test_heartbeat_keeps_the_slot_and_reports_the_remaining_time(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first, second = payload(), payload('cursor')
        await client.post(path() + '/turn', json=first)
        await finish(app)
        for _ in range(3):
            clock.advance(20)
            beat = (await client.post(path() + '/heartbeat')).json()
            assert beat['ok'] is True
            assert beat['active_turn'] == first['id']
            assert beat['lease']['expires_in_seconds'] == pytest.approx(30, abs=.01)
            assert beat['lease']['last_heartbeat_seconds'] == 0
        # 60 s of wall clock, but never 30 s of silence.
        assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 409
        assert app.state.room.active == first['id']

async def test_receipts_count_as_liveness_during_a_long_playback(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first, second = payload(), payload('cursor')
        await client.post(path() + '/turn', json=first)
        await finish(app)
        snapshot = (await client.get(path('gge', first['id']))).json()
        assert (await client.get(snapshot['audio_url'])).status_code == 200
        root = path('gge', first['id'])
        for position in (0, .1):
            clock.advance(20)
            response = await client.post(root + '/playback', json={
                'state': 'playing', 'position_seconds': position, 'duration_seconds': .2})
            assert response.status_code == 200
            assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 409
        clock.advance(20)
        assert (await client.post(root + '/playback', json={
            'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2})).status_code == 200
        assert (await client.post(path('cursor') + '/turn', json=second)).status_code == 202

async def test_the_device_itself_can_ask_again_after_its_lease_expired(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first = payload()
        await client.post(path() + '/turn', json=first)
        await finish(app)
        clock.advance(31)
        # The returning device is told, and is free to start a new turn.
        config = (await client.get(path() + '/config')).json()
        assert config['active_turn'] is None
        assert config['roles'][0]['available'] is True
        assert config['last_release']['reason'] == 'lease-expired'
        second = payload()
        assert (await client.post(path() + '/turn', json=second)).status_code == 202
        assert app.state.room.active == second['id']

async def test_a_live_turn_is_not_released_while_the_task_still_runs(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first = payload()
        await client.post(path() + '/turn', json=first)
        # No heartbeats, but the client is still polling the turn.
        for _ in range(4):
            clock.advance(20)
            snapshot = (await client.get(path('gge', first['id']))).json()
            assert snapshot.get('abandoned') is None
        assert app.state.room.active == first['id']
        await finish(app)

def test_lease_must_be_a_positive_number(tmp_path):
    roles = (Role('gge', 'G哥', 'uncle_fu'),)
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-gge', 'G哥的设备', 'gge', settings.session_key)], roles)
    for bad in (0, -1, 'soon', None):
        with pytest.raises(ValueError):
            create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles,
                              lease_seconds=bad)

async def test_abandoned_turn_is_written_to_the_shared_record_as_stopped(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first = payload()
        await client.post(path() + '/turn', json=first)
        await finish(app)
        clock.advance(31)
        await client.get(path() + '/config')  # any request reaps
        events = [json.loads(line) for file in (tmp_path / 'memory').glob('*.jsonl')
                  for line in file.read_text().splitlines()]
        finished = [event for event in events if event['event'] == 'finished']
        assert finished, events
        assert finished[-1]['id'] == first['id']
        # The text is archived; the playback state says stopped, not completed.
        assert finished[-1].get('playback', {}).get('state') in {None, 'stopped'}
        # The release itself is an event, with its reason, not a silent drop.
        expired = [event for event in events if event['event'] == 'lease_expired']
        assert expired and expired[-1]['turn_id'] == first['id']
        assert expired[-1]['reason'] == 'lease-expired'

async def test_stale_clients_do_not_grow_the_lease_map(tmp_path):
    app, client, bridge, speech, clock = setup(tmp_path)
    async with client:
        first = payload()
        await client.post(path() + '/turn', json=first)
        await finish(app)
        room = app.state.room
        for index in range(20):
            room.touch('desk-cursor', f'gone-{index}')
        assert len(room.leases) == 21
        clock.advance(31)
        await client.get(path() + '/config')
        assert room.active is None, 'the silent turn gave the slot back'
        clock.advance(31)
        await client.get(path() + '/config')
        # Two lease periods later the dead clients are forgotten; the live one stays.
        assert len(room.leases) == 1
        assert next(iter(room.leases))[0] == 'desk-gge'
