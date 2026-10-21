import asyncio
from dataclasses import replace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from voice.app import TurnInput
from voice.bridge import BridgeError
from voice.roles import Role
from test_voice_app import setup, payload, finish


class RelayBridge:
    def __init__(self, mode='ok'):
        self.calls = []
        self.mode = mode
        self.post = None

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path.startswith('/relay/voice/binding?'):
            if self.mode == 'unbound':
                raise BridgeError('not bound', 422)
            result = {k: v[0] for k, v in parse_qs(urlparse(path).query).items()}
            result.update(relay_key='a' * 64, busy=False)
            if self.mode == 'wrong-binding':
                result['to'] = 'other'
            return result
        if path == '/relay/send':
            self.post = body
            if self.mode == 'rejected':
                raise BridgeError('语音转发暂时无法接纳，本轮未发送。', 503, not_sent=True)
            if self.mode == 'lost-ack':
                raise BridgeError('lost acknowledgement', 503)
            return {'status': 'running'}
        if path.endswith('/cancel'):
            return {'status': 'failed'}
        if self.mode == 'unknown':
            raise BridgeError('unknown', 404)
        result = dict(request_id=self.post['request_id'], relay_key='a' * 64,
                      agent_session_id='native', status='completed', text='完整公开答复。')
        if self.mode == 'wrong-receipt':
            result['relay_key'] = 'b' * 64
        if self.mode == 'failed':
            result.update(status='failed', text='partial must not speak')
        if self.mode == 'empty':
            result['text'] = ''
        if self.mode == 'waiting':
            result['status'] = 'running'
        return result


class Speech:
    def __init__(self):
        self.texts = []
    def synthesize(self, text):
        self.texts.append(text)
        return b'RIFF-test'


def relay_service(tmp_path, mode='ok'):
    speech, bridge = Speech(), RelayBridge(mode)
    app, client, headers, _ = setup(tmp_path, bridge, speech)
    service = app.state.service
    service.roles['gge'] = Role('gge', 'G哥', relay_project='grok')
    service.settings = replace(service.settings, sentence_stream=True)
    return app, client, headers, service, speech, bridge


@pytest.mark.parametrize('mode', ['ok', 'lost-ack'])
async def test_relay_uses_private_single_submission_existing_tts(tmp_path, mode):
    app, client, _, service, speech, bridge = relay_service(tmp_path, mode)
    data = TurnInput(**payload())
    await service.submit(data)
    await asyncio.wait_for(finish(app), 2)
    await service.submit(data)
    assert service.turns[data.id]['status'] == 'ready'
    assert speech.texts == ['完整公开答复。']
    assert len([1 for path, _ in bridge.calls if path == '/relay/send']) == 1
    assert not any(path.startswith('/input') for path, _ in bridge.calls)
    assert bridge.post['from'] == 'gge' and bridge.post['to'] == 'grok'
    assert bridge.post['mode'] == 'voice' and bridge.post['scope'] == 'desktop'
    assert 'stream' not in bridge.post
    await client.aclose()


@pytest.mark.parametrize('mode', ['wrong-receipt', 'failed', 'empty', 'unknown'])
async def test_bad_relay_receipt_never_tts_or_reposts(tmp_path, mode):
    app, client, _, service, speech, bridge = relay_service(tmp_path, mode)
    data = TurnInput(**payload())
    await service.submit(data)
    await asyncio.wait_for(finish(app), 2)
    assert service.turns[data.id]['status'] == 'error'
    assert not speech.texts
    assert len([1 for path, _ in bridge.calls if path == '/relay/send']) == 1
    assert not any(path.startswith('/input') for path, _ in bridge.calls)
    await client.aclose()


@pytest.mark.parametrize('mode', ['unbound', 'wrong-binding'])
async def test_invalid_relay_binding_never_submits(tmp_path, mode):
    _, client, _, service, speech, bridge = relay_service(tmp_path, mode)
    with pytest.raises(HTTPException):
        await service.submit(TurnInput(**payload()))
    assert not speech.texts and bridge.post is None
    await client.aclose()


async def test_relay_device_scope_and_cancel_late_response(tmp_path):
    app, client, _, service, speech, bridge = relay_service(tmp_path, 'waiting')
    data = TurnInput(**payload())
    device = dict(device_id='desk-grok', stop_requested=False)
    await service._submit(data, device=device)
    while bridge.post is None:
        await asyncio.sleep(0.001)
    device['stop_requested'] = True
    await asyncio.wait_for(finish(app), 2)
    assert bridge.post['scope'] == 'desk-grok'
    assert not speech.texts
    assert any(path.endswith('/cancel') for path, _ in bridge.calls)
    await client.aclose()


def test_relay_role_default_and_validation():
    assert Role('gge', 'G哥').relay_project == ''
    with pytest.raises(ValueError):
        Role('gge', 'G哥', relay_project='../other')


def test_required_isolation_rejects_missing_or_other_role_target():
    from voice.roles import validate_roles
    from voice.settings import Settings
    from pathlib import Path
    settings = Settings(project='gge', role_name='G哥', session_key='discord:voice',
                        bridge_socket=Path('/tmp/mock.sock'), require_isolated_voice=True)
    for target in ('', 'deep'):
        with pytest.raises(ValueError, match='独立语音'):
            validate_roles((Role('gge', 'G哥', relay_project=target),), settings)
    assert validate_roles((Role('gge', 'G哥', relay_project='gge'),), settings)


async def test_known_admission_rejection_does_not_poll_or_claim_unknown(tmp_path):
    app, client, _, service, speech, bridge = relay_service(tmp_path, 'rejected')
    data = TurnInput(**payload())
    await service.submit(data)
    await asyncio.wait_for(finish(app), 2)
    assert service.turns[data.id]['status'] == 'error'
    assert '本轮未发送' in service.turns[data.id]['error']
    assert not speech.texts
    assert [path for path, _ in bridge.calls if not path.startswith('/relay/voice/binding?')] == ['/relay/send']
    await client.aclose()


@pytest.mark.parametrize('raw,path,body,proven', [
    (b'{"submission":"not_sent"}', '/relay/send', {'mode': 'voice'}, True),
    (b'{"error":"unavailable"}', '/relay/send', {'mode': 'voice'}, False),
    (b'bad json', '/relay/send', {'mode': 'voice'}, False),
    (b'{"submission":"not_sent"}', '/input', {}, False),
    (b'{"submission":"not_sent"}', '/relay/send', {}, False),
])
def test_bridge_requires_explicit_voice_admission_proof(monkeypatch, raw, path, body, proven):
    from voice import bridge as module
    class Response:
        status = 503
        def read(self, limit): return raw
    class Connection:
        def __init__(self, path): pass
        def request(self, *args): pass
        def getresponse(self): return Response()
        def close(self): pass
    monkeypatch.setattr(module, 'UnixConnection', Connection)
    with pytest.raises(BridgeError) as error:
        module.Bridge('unused').call(path, body)
    assert error.value.not_sent is proven
    assert error.value.status == 503


async def test_single_role_isolation_never_calls_work_input(tmp_path):
    from voice.app import create_app
    from voice.settings import Settings
    settings = Settings(project='gge', role_name='G哥', session_key='discord:voice',
                        bridge_socket=str(tmp_path / 'api.sock'), model_path=str(tmp_path / 'model'),
                        data_dir=str(tmp_path), shared_memory_dir=str(tmp_path / 'memory'),
                        require_isolated_voice=True)
    bridge, speech = RelayBridge(), Speech()
    app = create_app(settings, speech, bridge)
    await app.state.service.submit(TurnInput(**payload()))
    await asyncio.wait_for(finish(app), 2)
    assert bridge.post['from'] == bridge.post['to'] == 'gge'
    assert bridge.post['session_key'] == 'discord:voice'
    assert speech.texts == ['完整公开答复。']
    assert not any(path.startswith('/input') for path, _ in bridge.calls)
