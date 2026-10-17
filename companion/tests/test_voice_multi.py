import asyncio
import json
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest

from voice.app import create_app
from voice.bridge import BridgeError
from voice.roles import Role, read_roles, validate_roles
from voice.settings import Settings


class Speech:
    def __init__(self):
        self.spoken = []

    def synthesize(self, text, *, voice=None):
        self.spoken.append((text, voice))
        return b'RIFF-test-' + text.encode()


class Bridge:
    def __init__(self):
        self.calls = []
        self.requests = {}
        self.unavailable = set()
        self.busy = set()
        self.result_override = {}

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path.startswith('/input/bindings?'):
            query = parse_qs(urlsplit(path).query)
            project = query['project'][0]
            if project in self.unavailable:
                raise BridgeError('原会话不能严格续接。', 422)
            return {'project': project, 'session_key': query['session_key'][0],
                    'session_id': project + '-session', 'agent_session_id': project + '-cli',
                    'busy': project in self.busy}
        if body is not None:
            self.requests[body['request_id']] = body
            return {'status': 'running'}
        request_id = path.rsplit('/', 1)[-1]
        project = self.requests[request_id]['project']
        return {'request_id': request_id, 'status': 'completed', 'text': project + '的回答',
                'session_id': project + '-session', 'agent_session_id': project + '-cli',
                **self.result_override}


def setup(tmp_path, bridge=None):
    speech, bridge = Speech(), bridge or Bridge()
    settings = Settings(project='gge', role_name='伙伴甲',
                        session_key='discord:test-channel', session_label='测试频道',
                        bridge_socket=str(tmp_path / 'api.sock'),
                        model_path=str(tmp_path / 'model'),
                        data_dir=str(tmp_path / 'voice'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3')
    app = create_app(settings, speech, bridge,
                     roles=(Role('gge', '伙伴甲', 'uncle_fu'), Role('deep', '伙伴乙', 'serena')))
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8787')
    return app, client, {'X-Voice-Token': app.state.service.token}, bridge, speech


def turn(project='gge', **extra):
    return {'id': str(uuid4()), 'project': project, 'text': '接着聊', **extra}


async def finish(app):
    await asyncio.gather(*app.state.service.tasks)


async def test_a_b_a_keeps_routing_voices_and_feedback_separate(tmp_path):
    app, client, headers, bridge, speech = setup(tmp_path)
    ids = []
    async with client:
        cfg = (await client.get('/api/config')).json()
        assert [r['id'] for r in cfg['roles']] == ['gge', 'deep']
        assert all(r['available'] for r in cfg['roles'])
        for project in ['gge', 'deep', 'gge']:
            data = turn(project)
            ids.append(data['id'])
            assert (await client.post('/api/turn', headers=headers, json=data)).status_code == 202
            await finish(app)
            result = (await client.get('/api/turn/' + data['id'])).json()
            assert result['status'] == 'ready'
            assert result['project'] == project
            assert result['agent_session_id'] == project + '-cli'
            assert '_binding' not in result and 'prompt' not in result
            response = await client.post('/api/turn/' + data['id'] + '/playback', headers=headers,
                                         json={'state': 'stopped', 'position_seconds': 2 if project == 'gge' else 7,
                                               'duration_seconds': 10})
            assert response.status_code == 200
    posted = list(bridge.requests.values())
    assert [r['project'] for r in posted] == ['gge', 'deep', 'gge']
    assert all(r['session_key'] == 'discord:test-channel' for r in posted)
    assert all(r.get('expected_session_id') == r['project'] + '-session' for r in posted)
    assert all(r.get('expected_agent_session_id') == r['project'] + '-cli' for r in posted)
    assert '播放反馈' not in posted[0]['text'] and '播放反馈' not in posted[1]['text']
    assert '2.0/10.0秒' in posted[2]['text'] and '7.0/10.0秒' not in posted[2]['text']
    assert [voice for _, voice in speech.spoken] == ['uncle_fu', 'serena', 'uncle_fu']
    entries = [json.loads(line) for f in (tmp_path / 'memory').glob('*.jsonl') for line in f.read_text().splitlines()]
    finished = [e for e in entries if e['event'] == 'finished']
    assert [e['project'] for e in finished] == ['gge', 'deep', 'gge']
    for entry in entries:
        assert entry['project'] == ('deep' if entry['id'] == ids[1] else 'gge')


async def test_unavailable_unknown_or_busy_role_is_never_sent(tmp_path):
    app, client, headers, bridge, speech = setup(tmp_path)
    bridge.unavailable.add('deep')
    async with client:
        config = (await client.get('/api/config')).json()
        assert config['roles'][1]['available'] is False
        assert 'agent_session_id' not in config['roles'][0]
        assert (await client.post('/api/turn', headers=headers, json=turn('deep'))).status_code == 422
        assert (await client.post('/api/turn', headers=headers, json=turn('other'))).status_code == 400
        bridge.busy.add('gge')
        assert (await client.post('/api/turn', headers=headers, json=turn())).status_code == 409
    assert not bridge.requests and not speech.spoken and not app.state.service.turns


@pytest.mark.parametrize('override', [
    {'request_id': 'other-request'}, {'session_id': 'other-session'},
    {'agent_session_id': 'other-cli'}, {'status': 'failed', 'text': 'partial'},
])
async def test_mismatched_or_failed_receipt_cannot_be_spoken(tmp_path, override):
    app, client, headers, bridge, speech = setup(tmp_path)
    bridge.result_override = override
    async with client:
        data = turn()
        assert (await client.post('/api/turn', headers=headers, json=data)).status_code == 202
        await finish(app)
        result = (await client.get('/api/turn/' + data['id'])).json()
        assert result['status'] == 'error'
        assert result['text'] == '' and 'audio_url' not in result
    assert not speech.spoken and len(bridge.requests) == 1


async def test_concurrent_role_admission_is_serialized_across_binding_io(tmp_path):
    app, client, headers, bridge, _ = setup(tmp_path)
    entered, release, running = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_binding = app.state.service.binding

    async def binding(project):
        entered.set()
        await release.wait()
        return await original_binding(project)

    async def run(_):
        await running.wait()

    app.state.service.binding, app.state.service.run = binding, run
    first, second = turn(), turn('deep')
    try:
        async with client:
            a = asyncio.create_task(client.post('/api/turn', headers=headers, json=first))
            await entered.wait()
            b = asyncio.create_task(client.post('/api/turn', headers=headers, json=second))
            release.set()
            assert sorted(r.status_code for r in await asyncio.gather(a, b)) == [202, 409]
            assert (await client.post('/api/turn', headers=headers, json=first)).status_code == 202
            assert (await client.post('/api/turn', headers=headers, json={**first, 'project': 'deep'})).status_code == 409
    finally:
        running.set()
        await finish(app)
    assert len(app.state.service.turns) == 1


@pytest.mark.parametrize('roles', [[], [Role('other', '乙')], [Role('gge', '甲'), Role('gge', '乙')]])
def test_roster_requires_unique_ids_and_existing_default(roles):
    with pytest.raises(ValueError):
        validate_roles(roles, Settings(project='gge'))


def test_roster_only_reads_explicit_file_and_checks_voice_backend(tmp_path):
    path = tmp_path / 'roles.json'
    with pytest.raises(FileNotFoundError):
        read_roles(path)
    assert not path.exists()
    path.write_text(json.dumps({'roles': [{'project': 'gge', 'name': '甲', 'tts_voice': 'serena'}]}))
    roles = read_roles(path)
    with pytest.raises(ValueError):
        validate_roles(roles, Settings(project='gge', tts_backend='say'))
    assert validate_roles(roles, Settings(project='gge', tts_backend='qwen3')) == roles
    with pytest.raises(ValueError):
        Role('gge', '甲', 'unknown-voice')
