"""Issue #33 on the device entry: playback stays global, recording is per device.

The old #43 room was one lock for everything: while G哥 was playing (or even
just finishing a stopped turn), Cursor's page could not record, could not ask,
and got a 409 that arrived only after the whole sentence was uploaded. #33
separates the two:

* playback: exactly one turn owns the sound, handed over in admission order;
* recording and new questions: per device, gated only by that device's own
  unfinished turn (and by the one-at-a-time ASR/TTS pipeline capacity);
* the floor is per device too: each device is one partner and one conversation,
  so a question on one device never supersedes another device's answer. Both
  answers are heard, in admission order. Only a new turn on the *same* device
  drops that device's unplayed reply, and a reply already sounding is allowed
  to finish.
* the floor decision happens before the bridge call: a 409 means the partner
  never saw the message.

These tests use the real ``create_device_app`` routes with a fake bridge and
fake speech, so they exercise the same code path a page or a terminal uses.
"""
import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from voice.device_app import create_device_app
from voice.devices import Availability, DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge
from test_voice_device_app import Speech

def setup(tmp_path):
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name + '的设备',
                                            r.project, settings.session_key) for r in roles], roles)
    bridge, speech = Bridge(), Speech()
    app = create_device_app(settings, devices, speech=speech, bridge=bridge, roles=roles)
    token = app.state.service.token
    gge = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8796',
                            headers={'X-Voice-Token': token, 'X-Device-Client': str(uuid4())})
    cursor = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8796',
                               headers={'X-Voice-Token': token, 'X-Device-Client': str(uuid4())})
    return app, gge, cursor, bridge, speech

def path(project, identifier=None):
    root = '/device/desk-' + project + '/api'
    return root if identifier is None else root + '/turn/' + identifier

def payload(project='gge'):
    return {'id': str(uuid4()), 'project': project, 'text': '接着聊'}

async def finish(app):
    await asyncio.gather(*app.state.service.tasks)

async def play_all(client, project, data):
    root = path(project, data['id'])
    snapshot = (await client.get(root)).json()
    assert snapshot['playback_allowed'] is True
    assert (await client.get(snapshot['audio_url'])).status_code == 200
    assert (await client.post(root + '/playback', json={
        'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})).status_code == 200
    assert (await client.post(root + '/playback', json={
        'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2})).status_code == 200

def events(tmp_path, name):
    return [json.loads(line) for file in (tmp_path / 'memory').glob('*.jsonl')
            for line in file.read_text().splitlines() if json.loads(line)['event'] == name]

async def test_the_other_device_records_and_asks_while_gge_is_speaking(tmp_path):
    """G哥's answer is sounding; Cursor may still record, ask, and then play."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        assert (await gge.post(path('gge') + '/turn', json=first)).status_code == 202
        await finish(app)
        root = path('gge', first['id'])
        snapshot = (await gge.get(root)).json()
        await gge.get(snapshot['audio_url'])
        assert (await gge.post(root + '/playback', json={
            'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})).status_code == 200

        # Recording on Cursor is not blocked by G哥's playback any more.
        assert (await cursor.post(path('cursor') + '/transcribe', content=b'fixture')).status_code == 200
        second = payload('cursor')
        assert (await cursor.post(path('cursor') + '/turn', json=second)).status_code == 202
        await finish(app)

        # One voice at a time: Cursor's answer exists but does not own the sound.
        waiting = (await cursor.get(path('cursor', second['id']))).json()
        assert waiting['status'] == 'ready'
        assert waiting['playback_allowed'] is False
        assert 'audio_url' not in waiting
        assert waiting['playback_owner'] == 'desk-gge'
        assert app.state.room.active == first['id']
        assert (await cursor.get(snapshot['audio_url'])).status_code == 409  # not Cursor's audio

        # G哥 finishes; the slot moves to the turn that was waiting.
        assert (await gge.post(root + '/playback', json={
            'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2})).status_code == 200
        assert app.state.room.active == second['id']
        await play_all(cursor, 'cursor', second)
        assert app.state.room.active is None
    finally:
        await gge.aclose()
        await cursor.aclose()

async def test_another_device_question_does_not_drop_the_waiting_reply(tmp_path):
    """Per-device floors: B asking never supersedes A's answer; both are heard."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        assert (await gge.post(path('gge') + '/turn', json=first)).status_code == 202
        await finish(app)
        assert (await gge.get(path('gge', first['id']))).json()['playback_allowed'] is True

        second = payload('cursor')
        assert (await cursor.post(path('cursor') + '/turn', json=second)).status_code == 202
        await finish(app)

        # Another device is another partner and another conversation: the
        # unplayed answer stays current and keeps its right to play.
        kept = (await gge.get(path('gge', first['id']))).json()
        assert kept.get('superseded') is None
        assert kept['status'] != 'stopped'
        assert kept['playback_allowed'] is True
        assert kept['audio_url']

        # Playback is still global: admission order decides who sounds first.
        assert app.state.room.active == first['id']
        await play_all(gge, 'gge', first)
        # The review happens when the slot is released, i.e. after playback.
        reviewed = next(event for event in events(tmp_path, 'floor_review')
                        if event['id'] == first['id'])
        assert reviewed['archive'] is True and reviewed['mark'] is None and reviewed['play'] is True
        assert app.state.room.active == second['id']
        await play_all(cursor, 'cursor', second)
    finally:
        await gge.aclose()
        await cursor.aclose()

async def test_a_sounding_reply_is_not_cut_when_the_other_device_asks(tmp_path):
    """Already playing: the sentence finishes, and the new turn queues behind it."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        await gge.post(path('gge') + '/turn', json=first)
        await finish(app)
        root = path('gge', first['id'])
        snapshot = (await gge.get(root)).json()
        await gge.get(snapshot['audio_url'])
        await gge.post(root + '/playback', json={
            'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})

        second = payload('cursor')
        assert (await cursor.post(path('cursor') + '/turn', json=second)).status_code == 202
        await finish(app)

        # Still the owner and still allowed to play: no mid-word cut, and the
        # other device's question does not mark this answer superseded.
        still = (await gge.get(root)).json()
        assert still.get('superseded') is None
        assert still['playback_allowed'] is True
        assert app.state.room.active == first['id']
        assert (await gge.post(root + '/playback', json={
            'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2})).status_code == 200

        assert app.state.room.active == second['id']
        await play_all(cursor, 'cursor', second)
    finally:
        await gge.aclose()
        await cursor.aclose()

async def test_a_rejected_floor_decision_never_reaches_the_bridge(tmp_path):
    """409 must mean "本轮未发送": decide runs before _submit, so no input is sent."""
    from voice.floor import Availability as FloorAvailability, PartnerAvailability
    app, gge, cursor, bridge, speech = setup(tmp_path)
    room = app.state.room
    original = room.registry.availability

    def busy_roster(busy_devices=()):
        # Make the device's own partner unavailable so decide() returns None.
        return [PartnerAvailability(p.project,
                                    FloorAvailability.BUSY if p.project == 'gge' else p.state)
                for p in original(busy_devices)]

    room.registry.availability = busy_roster
    try:
        refused = await gge.post(path('gge') + '/turn', json=payload())
        assert refused.status_code == 409
        assert '没有回答者' in refused.json()['detail']
        # Nothing was delivered and nothing was admitted: no tombstone, no slot.
        assert bridge.requests == {}
        assert bridge.calls == []
        assert room.records == {}
        assert room.slots == {}
        assert room.active is None
        # The rejected generation was closed instead of left as the active turn.
        assert room._floor('desk-gge')._active is None
    finally:
        room.registry.availability = original
        await gge.aclose()
        await cursor.aclose()

async def test_a_stopped_reply_keeps_its_mark_when_the_same_device_asks_again(tmp_path):
    """Only a live, unplayed reply is superseded; a user stop stays ``stopped``."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        await gge.post(path('gge') + '/turn', json=first)
        await finish(app)
        root = path('gge', first['id'])
        snapshot = (await gge.get(root)).json()
        await gge.get(snapshot['audio_url'])
        await gge.post(root + '/playback', json={
            'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})
        assert (await gge.post(root + '/stop')).status_code == 200
        await finish(app)

        # The slot is released now, so the same device may ask again.
        second = payload()
        assert (await gge.post(path('gge') + '/turn', json=second)).status_code == 202
        await finish(app)

        record = app.state.room.records[first['id']]
        assert record.get('superseded') is None
        assert record.get('stop_reason') is None
        assert not [event for event in events(tmp_path, 'turn_superseded')
                    if event['id'] == first['id']]
        reviewed = next(event for event in events(tmp_path, 'floor_review')
                        if event['id'] == first['id'])
        assert reviewed['mark'] == 'stopped'
    finally:
        await gge.aclose()
        await cursor.aclose()

async def test_each_device_has_its_own_slot_and_its_own_availability(tmp_path):
    """A second question on the same device is still refused; the other one is not."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        await gge.post(path('gge') + '/turn', json=first)
        await finish(app)
        # Same device, unfinished turn: refused, no queueing.
        assert (await gge.post(path('gge') + '/turn', json=payload())).status_code == 409
        assert (await gge.post(path('gge') + '/transcribe', content=b'fixture')).status_code == 409
        assert app.state.room.slots == {'desk-gge': first['id']}

        # The other device is available and can record.
        config = (await cursor.get(path('cursor') + '/config')).json()
        assert config['active_turn'] is None
        assert config['roles'][0]['available'] is True
        assert config['playback_owner'] == 'desk-gge'
        assert (await cursor.post(path('cursor') + '/transcribe', content=b'fixture')).status_code == 200
        assert len(bridge.requests) == 1
    finally:
        await gge.aclose()
        await cursor.aclose()

async def test_registry_reports_busy_only_for_the_device_that_is_draining(tmp_path):
    app, gge, cursor, bridge, speech = setup(tmp_path)
    registry = app.state.room.registry
    states = {partner.project: partner.state for partner in registry.availability({'desk-gge'})}
    assert states == {'gge': Availability.BUSY, 'cursor': Availability.AVAILABLE}
    assert all(partner.state is Availability.AVAILABLE for partner in registry.availability())

async def test_duplicate_turn_id_stays_idempotent_and_does_not_take_the_floor_twice(tmp_path):
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        assert (await gge.post(path('gge') + '/turn', json=first)).status_code == 202
        await finish(app)
        # The same id is a retry, not a new human turn: it must not supersede itself.
        assert (await gge.post(path('gge') + '/turn', json=first)).status_code == 202
        snapshot = (await gge.get(path('gge', first['id']))).json()
        assert snapshot['playback_allowed'] is True
        assert snapshot.get('superseded') is None
        assert len(bridge.requests) == 1
    finally:
        await gge.aclose()
        await cursor.aclose()

async def test_the_pipeline_still_admits_one_transcription_at_a_time(tmp_path):
    """Capacity, not playback: two microphones cannot share one ASR worker."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    import threading
    entered, release = threading.Event(), threading.Event()
    original = speech.transcribe

    def gated(body):
        entered.set()
        assert release.wait(5)
        return original(body)

    speech.transcribe = gated
    try:
        first = asyncio.create_task(gge.post(path('gge') + '/transcribe', content=b'fixture'))
        assert await asyncio.to_thread(entered.wait, 2)
        refused = await cursor.post(path('cursor') + '/transcribe', content=b'fixture')
        assert refused.status_code == 409 and '识别' in refused.json()['detail']
        release.set()
        assert (await first).status_code == 200
        assert (await cursor.post(path('cursor') + '/transcribe', content=b'fixture')).status_code == 200
    finally:
        release.set()
        await gge.aclose()
        await cursor.aclose()

async def test_a_stopped_reply_is_archived_as_stopped_and_never_played(tmp_path):
    """Stop ends the generation: archived with mark=stopped, no audio afterwards."""
    app, gge, cursor, bridge, speech = setup(tmp_path)
    try:
        first = payload()
        await gge.post(path('gge') + '/turn', json=first)
        await finish(app)
        root = path('gge', first['id'])
        snapshot = (await gge.get(root)).json()
        assert (await gge.get(snapshot['audio_url'])).status_code == 200
        await gge.post(root + '/playback', json={
            'state': 'playing', 'position_seconds': 0, 'duration_seconds': .2})
        assert (await gge.post(root + '/stop')).status_code == 200
        assert (await gge.get(snapshot['audio_url'])).status_code == 409
        assert (await gge.post(root + '/playback', json={
            'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2})).status_code == 409

        reviewed = next(event for event in events(tmp_path, 'floor_review')
                        if event['id'] == first['id'])
        assert reviewed['mark'] == 'stopped' and reviewed['play'] is False
        assert reviewed['archive'] is True
        # Archived, not erased: the answer text is still in the shared record.
        archived = [event for event in events(tmp_path, 'finished') if event['id'] == first['id']]
        assert archived and archived[0]['text'] == 'gge的回答'
    finally:
        await gge.aclose()
        await cursor.aclose()
