import asyncio
import json
import threading
from uuid import uuid4

import httpx
import pytest

from voice.app import create_app, spoken_answer
from voice.bridge import BridgeError
from voice.settings import Settings


class SpeechStub:
    def transcribe(self, audio):
        if audio == b'bad':
            raise ValueError('录音格式不正确')
        return '这是识别结果'

    def synthesize(self, text):
        return b'RIFF-test-audio'


class BridgeStub:
    def __init__(self, result=None, gate=None):
        self.calls = []
        self.gate = gate
        self.result = result or {'status': 'completed', 'text': '收到，继续原来的任务。',
                                 'session_id': 'original', 'agent_session_id': 'original-cli'}

    def call(self, path, body=None):
        self.calls.append((path, body))
        if body is not None:
            return {'status': 'running'}
        if self.gate:
            self.gate.wait(3)
        return self.result


def setup(tmp_path, bridge=None, speech=None, **settings_kwargs):
    bridge = bridge or BridgeStub()
    settings = Settings(
        project='gge',
        role_name='G哥',
        session_key='discord:test-channel',
        bridge_socket=str(tmp_path / 'api.sock'),
        model_path=str(tmp_path / 'model'),
        data_dir=str(tmp_path),
        shared_memory_dir=str(tmp_path / 'memory'),
        **settings_kwargs,
    )
    app = create_app(settings, speech or SpeechStub(), bridge)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8787')
    headers = {'X-Voice-Token': app.state.service.token}
    return app, client, headers, bridge


async def finish(app):
    await asyncio.gather(*app.state.service.tasks)


def payload(text='刚才那件事进展如何？', **kwargs):
    return {'id': str(uuid4()), 'project': 'gge', 'text': text, **kwargs}


async def test_real_turn_contract_and_correlated_output(tmp_path):
    app, client, headers, bridge = setup(tmp_path)
    data = payload()
    async with client:
        response = await client.post('/api/turn', headers=headers, json=data)
        assert response.status_code == 202
        await finish(app)
        result = (await client.get('/api/turn/' + data['id'])).json()
        assert result['status'] == 'ready'
        assert result['session_id'] == 'original'
        assert result['text'] == '收到，继续原来的任务。'
        assert 'prompt' not in result
        assert (await client.get(result['audio_url'])).content == b'RIFF-test-audio'
    posted = [body for path, body in bridge.calls if path == '/input']
    assert len(posted) == 1
    assert posted[0]['session_key'] == 'discord:test-channel'
    assert posted[0]['request_id'] == 'voice-' + data['id']
    assert 'mode' not in posted[0]
    assert (tmp_path / 'events.jsonl').stat().st_mode & 0o777 == 0o600
    assert len([json.loads(line) for line in (tmp_path / 'events.jsonl').read_text().splitlines()]) == 2
    shared = list((tmp_path / 'memory').glob('*.jsonl'))
    assert len(shared) == 1
    entries = [json.loads(line) for line in shared[0].read_text().splitlines()]
    assert entries[0]['input_text'] == data['text']
    assert entries[-1]['text'] == result['text']
    assert all(entry['source'] == 'desktop_voice' for entry in entries)


async def test_each_answered_turn_writes_voice_outbox(tmp_path):
    app, client, headers, _ = setup(tmp_path, modes_enabled=True)
    data = payload(mode='work')
    async with client:
        await client.post('/api/turn', headers=headers, json=data)
        await finish(app)
        assert (await client.get('/api/turn/' + data['id'])).json()['status'] == 'ready'
    rows = [json.loads(line) for line in (tmp_path / 'voice-outbox.jsonl').read_text().splitlines()]
    assert len(rows) == 1
    assert rows[0]['route'] == 'big' and rows[0]['mode'] == 'work'
    assert rows[0]['transcript'] == data['text']
    assert rows[0]['canonical'] is False and rows[0]['reviewed'] is False


async def test_idempotency_and_concurrent_turn_rejection(tmp_path):
    gate = threading.Event()
    app, client, headers, bridge = setup(tmp_path, BridgeStub(gate=gate))
    data = payload()
    try:
        async with client:
            assert (await client.post('/api/turn', headers=headers, json=data)).status_code == 202
            assert (await client.post('/api/turn', headers=headers, json=data)).status_code == 202
            assert (await client.post('/api/turn', headers=headers, json=payload())).status_code == 409
            assert (await client.post('/api/turn', headers=headers, json={**data, 'text': 'different'})).status_code == 409
    finally:
        gate.set()
        await finish(app)
    assert len([body for _, body in bridge.calls if body]) == 1


@pytest.mark.parametrize('terminal', ['failed', 'silent'])
async def test_partial_or_silent_response_never_spoken(tmp_path, terminal):
    class MustNotSpeak(SpeechStub):
        def synthesize(self, text):
            raise AssertionError('must not synthesize partial response')
    app, client, headers, _ = setup(tmp_path, BridgeStub({'status': terminal, 'text': 'partial'}), MustNotSpeak())
    data = payload()
    async with client:
        await client.post('/api/turn', headers=headers, json=data)
        await finish(app)
        result = (await client.get('/api/turn/' + data['id'])).json()
        assert result['status'] == 'error'
        assert 'audio_url' not in result
        assert result['text'] == ''


async def test_ambiguous_submit_queries_same_id_without_retry(tmp_path):
    class Ambiguous(BridgeStub):
        def call(self, path, body=None):
            if body:
                self.calls.append((path, body))
                raise BridgeError('lost response')
            return super().call(path, body)
    app, client, headers, bridge = setup(tmp_path, Ambiguous())
    data = payload()
    async with client:
        await client.post('/api/turn', headers=headers, json=data)
        await finish(app)
        assert (await client.get('/api/turn/' + data['id'])).json()['status'] == 'ready'
    assert len([body for _, body in bridge.calls if body]) == 1


async def test_tts_failure_keeps_text_and_does_not_repeat_agent(tmp_path):
    class BrokenTTS(SpeechStub):
        def synthesize(self, text):
            raise RuntimeError('private path must not leak')
    app, client, headers, bridge = setup(tmp_path, speech=BrokenTTS())
    data = payload()
    async with client:
        await client.post('/api/turn', headers=headers, json=data)
        await finish(app)
        result = (await client.get('/api/turn/' + data['id'])).json()
        assert result['status'] == 'error'
        assert result['text']
        assert 'private' not in result['error']
    assert len([body for _, body in bridge.calls if body]) == 1


async def test_playback_feedback_goes_to_next_turn_without_claiming_heard_words(tmp_path):
    app, client, headers, bridge = setup(tmp_path)
    first = payload()
    async with client:
        await client.post('/api/turn', headers=headers, json=first)
        await finish(app)
        response = await client.post('/api/turn/' + first['id'] + '/playback', headers=headers,
                                     json={'state': 'stopped', 'position_seconds': 2.5, 'duration_seconds': 10})
        assert response.status_code == 200
        await client.post('/api/turn', headers=headers, json=payload('说短一点'))
        await finish(app)
    prompt = [body['text'] for _, body in bridge.calls if body][-1]
    assert '2.5/10.0秒' in prompt
    assert '不能精确推断听到哪些词' in prompt
    assert '不代表取消后台任务' in prompt
    assert '说短一点' in prompt


async def test_local_origin_token_body_bounds_and_scope(tmp_path):
    app, client, headers, bridge = setup(tmp_path)
    async with client:
        assert (await client.post('/api/turn', json=payload())).status_code == 403
        assert (await client.post('/api/turn', headers={**headers, 'origin': 'https://evil.example'}, json=payload())).status_code == 403
        assert (await client.post('/api/transcribe', headers=headers, content=b'x' * 1_000_001)).status_code == 413
        assert (await client.post('/api/turn', headers=headers, json=payload(project='cjiang'))).status_code == 400
        assert (await client.post('/api/turn', headers=headers, json=payload('/new'))).status_code == 400
        assert (await client.post('/api/turn', headers=headers, json=payload(id='../other'))).status_code == 400
        response = await client.post('/api/transcribe', headers=headers, content=b'bad')
        assert response.status_code == 422
        assert response.json()['detail'] == '录音格式不正确'
        good = await client.post('/api/transcribe', headers=headers, content=b'valid-fixture')
        assert good.json()['text'] == '这是识别结果'
    assert bridge.calls == []


def test_spoken_view_avoids_code_and_bounds_audio():
    fence = chr(96) * 3
    assert 'dangerous code' not in spoken_answer(f'说明\n{fence}\ndangerous code\n{fence}')
    assert spoken_answer('[文档](https://example.com)') == '文档'
    assert len(spoken_answer('好' * 1000)) < 650
