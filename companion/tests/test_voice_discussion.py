import asyncio
import json
import threading
from uuid import uuid4

import pytest

from test_voice_multi import Bridge, setup, turn


def discussion(**kwargs):
    return {'id': str(uuid4()), 'topic': '怎样把电脑语音讨论做得更容易使用？',
            'projects': ['gge', 'deep'], 'rounds': 2, **kwargs}


async def settle(app):
    while app.state.service.tasks:
        await asyncio.gather(*list(app.state.service.tasks))


async def acknowledge(client, headers, data, outcome='completed'):
    current = data['turns'][-1]
    if outcome == 'completed':
        r = await client.post('/api/turn/' + current['id'] + '/playback', headers=headers,
                              json={'state': 'completed', 'position_seconds': 2, 'duration_seconds': 2})
        assert r.status_code == 200
    return await client.post('/api/discussion/' + data['id'] + '/advance', headers=headers,
                             json={'turn_id': current['id'], 'outcome': outcome})


async def test_real_service_two_rounds_summary_and_attributed_memory(tmp_path):
    app, client, headers, bridge, speech = setup(tmp_path)
    payload = discussion()
    path = '/api/discussion/' + payload['id']
    async with client:
        assert (await client.post('/api/discussion', headers=headers, json=payload)).status_code == 202
        for index in range(5):
            await settle(app)
            state = (await client.get(path)).json()
            assert state['status'] == 'awaiting_playback'
            assert len(bridge.requests) == index + 1
            assert len(state['turns']) == index + 1
            assert all('_binding' not in t and '_task' not in t for t in state['turns'])
            if index == 0:
                assert (await client.post('/api/turn', headers=headers, json=turn())).status_code == 409
                assert (await client.post('/api/transcribe', headers=headers, content=b'abc')).status_code == 409
                assert (await client.get('/api/config')).json()['active_discussion'] == payload['id']
            assert (await acknowledge(client, headers, state)).status_code == 200
        final = (await client.get(path)).json()
        assert final['status'] == 'completed'
        assert (await client.get('/api/config')).json()['active_discussion'] is None
        assert (await client.get('/api/config')).json()['last_discussion'] == payload['id']
    posted = list(bridge.requests.values())
    assert [r['project'] for r in posted] == ['gge', 'deep', 'gge', 'deep', 'gge']
    assert 'gge的回答' in posted[1]['text']
    assert 'deep的回答' in posted[2]['text']
    assert '不得伪造一致' in posted[-1]['text']
    assert all('不能修改文件' in r['text'] and '派生子Agent' in r['text'] for r in posted)
    assert all(r['expected_agent_session_id'] == r['project'] + '-cli' for r in posted)
    entries = [json.loads(line) for f in (tmp_path / 'memory').glob('*.jsonl') for line in f.read_text().splitlines()]
    finished = [e for e in entries if e['event'] == 'finished']
    assert len(finished) == 5
    assert [e['phase'] for e in finished] == ['opening', 'opening', 'response', 'response', 'summary']
    assert all(e['discussion_id'] == payload['id'] for e in finished)
    assert len(speech.spoken) == 5


async def test_start_and_advance_idempotency_no_autoplay_assumptions(tmp_path):
    app, client, headers, bridge, _ = setup(tmp_path)
    payload = discussion()
    path = '/api/discussion/' + payload['id']
    async with client:
        responses = await asyncio.gather(*(client.post('/api/discussion', headers=headers, json=payload) for _ in range(2)))
        assert [r.status_code for r in responses] == [202, 202]
        await settle(app)
        state = (await client.get(path)).json()
        current = state['current_turn_id']
        assert len(bridge.requests) == 1
        bad = await client.post(path + '/advance', headers=headers, json={'turn_id': current, 'outcome': 'completed'})
        assert bad.status_code == 409
        assert (await client.post(path + '/advance', headers=headers, json={'turn_id': 'old', 'outcome': 'skipped'})).status_code == 409
        assert (await client.post('/api/discussion', headers=headers, json={**payload, 'topic': 'different'})).status_code == 409
        assert (await client.post('/api/discussion', headers=headers, json=discussion())).status_code == 409
        assert (await acknowledge(client, headers, state, 'skipped')).status_code == 200
        await settle(app)
        assert (await acknowledge(client, headers, state, 'skipped')).status_code == 200
        assert len(bridge.requests) == 2
        assert (await client.post(path + '/advance', headers=headers, json={'turn_id': current, 'outcome': 'completed'})).status_code == 409
        assert (await client.post(path + '/stop', headers=headers, json={})).json()['status'] == 'stopped'


async def test_stop_waits_for_sent_task_and_never_dispatches_later_speaker(tmp_path):
    gate, entered = threading.Event(), threading.Event()
    class WaitingBridge(Bridge):
        def call(self, path, body=None):
            if path.startswith('/input/voice-'):
                entered.set()
                assert gate.wait(5)
            return super().call(path, body)
    app, client, headers, bridge, _ = setup(tmp_path, WaitingBridge())
    payload = discussion()
    path = '/api/discussion/' + payload['id']
    try:
        async with client:
            await client.post('/api/discussion', headers=headers, json=payload)
            assert await asyncio.to_thread(entered.wait, 2)
            assert (await client.post(path + '/stop', headers=headers, json={})).json()['status'] == 'stopping'
            assert (await client.post('/api/turn', headers=headers, json=turn())).status_code == 409
            assert len(bridge.requests) == 1
            gate.set()
            await settle(app)
            final = (await client.get(path)).json()
            assert final['status'] == 'stopped' and final['stop_requested']
            assert len(bridge.requests) == 1
            assert (await acknowledge(client, headers, final, 'skipped')).status_code == 409
            assert (await client.post(path + '/stop', headers=headers, json={})).json()['status'] == 'stopped'
    finally:
        gate.set()
        await settle(app)


@pytest.mark.parametrize('failure', ['binding', 'bridge', 'tts', 'memory'])
async def test_failure_stops_without_retry_or_summary(tmp_path, failure):
    app, client, headers, bridge, speech = setup(tmp_path)
    payload = discussion()
    path = '/api/discussion/' + payload['id']
    async with client:
        await client.post('/api/discussion', headers=headers, json=payload)
        await settle(app)
        state = (await client.get(path)).json()
        if failure == 'binding':
            original = app.state.service.binding
            async def changed(project):
                return {**await original(project), 'agent_session_id': 'new-binding'}
            app.state.service.binding = changed
        elif failure == 'bridge':
            bridge.result_override = {'status': 'failed', 'text': 'partial'}
        elif failure == 'tts':
            def broken(*args, **kwargs):
                raise RuntimeError('synthesis failed')
            speech.synthesize = broken
        else:
            original = app.state.service.record
            def broken(event, value):
                if event == 'finished':
                    raise OSError('disk full')
                return original(event, value)
            app.state.service.record = broken
        assert (await acknowledge(client, headers, state, 'skipped')).status_code == 200
        await settle(app)
        final = (await client.get(path)).json()
        assert final['status'] == 'error' and final['error']
        assert len(bridge.requests) == (1 if failure == 'binding' else 2)
        assert app.state.service.discussions.active is None
        assert (await client.post('/api/discussion', headers=headers, json=payload)).json()['status'] == 'error'


async def test_all_roles_preflight_before_first_send_and_input_validation(tmp_path):
    app, client, headers, bridge, _ = setup(tmp_path)
    bridge.unavailable.add('deep')
    async with client:
        assert (await client.post('/api/discussion', headers=headers, json=discussion())).status_code == 422
        bridge.unavailable.clear()
        bridge.busy.add('deep')
        assert (await client.post('/api/discussion', headers=headers, json=discussion())).status_code == 409
        for projects in [['gge'], ['gge', 'gge'], ['gge', 'other']]:
            assert (await client.post('/api/discussion', headers=headers, json=discussion(projects=projects))).status_code in {400, 422}
        assert (await client.post('/api/discussion', headers=headers, json=discussion(rounds=200))).status_code == 422
    assert not bridge.requests and not app.state.service.discussions.items


async def test_stop_before_dispatch_and_service_shutdown(tmp_path):
    app, client, headers, bridge, _ = setup(tmp_path)
    from voice.discussion import DiscussionInput
    manager = app.state.service.discussions
    # No I/O between start and stop: stop wins before scheduled dispatch.
    result = await manager.start(DiscussionInput(**discussion()))
    assert (await manager.stop(result['id']))['status'] == 'stopping'
    await settle(app)
    assert manager.get(result['id'])['status'] == 'stopped'
    assert not bridge.requests
    await client.aclose()


async def test_stop_during_dispatch_binding_io_prevents_the_unsent_turn(tmp_path):
    app, client, headers, bridge, _ = setup(tmp_path)
    service = app.state.service
    entered, release = asyncio.Event(), asyncio.Event()
    original = service.binding
    count = 0
    async def slow(project):
        nonlocal count
        count += 1
        if count == 3:  # Two start checks, then first dispatch check.
            entered.set()
            await release.wait()
        return await original(project)
    service.binding = slow
    payload = discussion()
    from voice.discussion import DiscussionInput
    try:
        await service.discussions.start(DiscussionInput(**payload))
        await asyncio.wait_for(entered.wait(), 2)
        stop = asyncio.create_task(service.discussions.stop(payload['id']))
        await asyncio.sleep(0)  # Let stop register before releasing the blocked I/O.
        release.set()
        await stop
        await settle(app)
        assert not bridge.requests
        assert service.discussions.get(payload['id'])['status'] == 'stopped'
    finally:
        release.set()
        await settle(app)
        await client.aclose()


async def test_transcription_uses_discussion_admission_lock(tmp_path):
    app, client, headers, bridge, speech = setup(tmp_path)
    service = app.state.service
    requested, release = asyncio.Event(), asyncio.Event()
    # Observe acquisition, not timing: entering transcription must attempt the
    # same admission lock before reserving ASR. Old code reaches speech directly.
    class AdmissionLock:
        async def __aenter__(self):
            requested.set()
            await release.wait()
        async def __aexit__(self, *args):
            pass
    service.submit_lock = AdmissionLock()
    speech.transcribe = lambda _: '不应进入识别'
    task = asyncio.create_task(client.post('/api/transcribe', headers=headers, content=b'test'))
    wait = asyncio.create_task(requested.wait())
    try:
        await asyncio.wait({task, wait}, return_when=asyncio.FIRST_COMPLETED)
        assert requested.is_set(), 'ASR bypassed the shared admission lock'
        # A discussion accepted while ASR waited owns admission.
        service.discussions.active = 'accepted-discussion'
        release.set()
        assert (await task).status_code == 409
        assert not service.transcribing and not bridge.requests
    finally:
        release.set()
        wait.cancel()
        await asyncio.gather(task, wait, return_exceptions=True)
        await client.aclose()
