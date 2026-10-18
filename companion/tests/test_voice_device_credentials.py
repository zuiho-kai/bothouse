"""LAN device access: per-device credentials and an explicit listener address.

#42 needs the board to reach the computer over Wi-Fi. The desktop page model
trusted a process-wide page token handed out by an unauthenticated GET, which
would let any host on the LAN act as a partner's device. These tests pin the
replacement contract: every device authenticates with its own secret, the page
token never leaves the computer, and the HTML surfaces stay local.
"""
import pytest

import httpx

from voice.device_app import create_device_app
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge
from test_voice_stream import wav

SECRET_GE = 'g' * 32 + '-secret-0001'
SECRET_CURSOR = 'c' * 32 + '-secret-0002'
LAN = '192.168.1.50'
LOCAL = 'http://127.0.0.1:8796'
REMOTE = f'http://{LAN}:8796'

class Speech:
    def synthesize_stream(self, text, on_chunk, **options):
        on_chunk(wav())
        on_chunk(wav())
        return wav(4800)

    def transcribe(self, body):
        return '今天测试设备接口'

def registry(tmp_path, *, with_secrets=True):
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    secrets = {'gge': SECRET_GE, 'cursor': SECRET_CURSOR} if with_secrets else {}
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name + '的设备', r.project,
                                            settings.session_key, secret=secrets.get(r.project, ''))
                              for r in roles], roles)
    return settings, roles, devices

def app_for(tmp_path, *, host=LAN, with_secrets=True, registry_override=None):
    settings, roles, devices = registry(tmp_path, with_secrets=with_secrets)
    app = create_device_app(settings, devices if registry_override is None else registry_override,
                            speech=Speech(), bridge=Bridge(), roles=roles, host=host)
    return app

def client_for(app, base, *, secret=None, token=None):
    headers = {}
    if secret:
        headers['X-Device-Secret'] = secret
    if token:
        headers['X-Voice-Token'] = token
    headers['X-Device-Client'] = '11111111-1111-4111-8111-111111111111'
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(LAN, 5000)),
                             base_url=base, headers=headers)

async def test_lan_device_uses_its_own_secret_and_never_sees_the_page_token(tmp_path):
    app = app_for(tmp_path)
    async with client_for(app, REMOTE, secret=SECRET_GE) as client:
        config = (await client.get('/device/desk-gge/api/config')).json()
        assert config['token'] == ''
        assert config['auth'] == 'device-secret'
        assert config['default_role'] == 'gge'

        assert (await client.post('/device/desk-gge/api/transcribe',
                                  content=wav(1600), headers={'Content-Type': 'audio/wav'})).status_code == 200
        turn = '22222222-2222-4222-8222-222222222222'
        accepted = await client.post('/device/desk-gge/api/turn',
                                     json={'id': turn, 'project': 'gge', 'text': '接着聊'})
        assert accepted.status_code == 202

async def test_missing_wrong_or_borrowed_secret_is_refused(tmp_path):
    app = app_for(tmp_path)
    for secret in (None, 'x' * 32, SECRET_CURSOR):
        async with client_for(app, REMOTE, secret=secret) as client:
            assert (await client.get('/device/desk-gge/api/config')).status_code == 403
            assert (await client.post('/device/desk-gge/api/transcribe', content=wav(1600),
                                      headers={'Content-Type': 'audio/wav'})).status_code == 403

async def test_lan_clients_cannot_open_pages_or_the_device_list(tmp_path):
    app = app_for(tmp_path)
    async with client_for(app, REMOTE, secret=SECRET_GE) as client:
        for path in ('/', '/api/devices', '/device/desk-gge', '/static/app.js'):
            assert (await client.get(path)).status_code == 403, path

async def test_local_browser_keeps_the_page_token_flow(tmp_path):
    app = app_for(tmp_path)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=LOCAL,
                                 headers={'X-Device-Client': '44444444-4444-4444-8444-444444444444'}) as client:
        config = (await client.get('/device/desk-gge/api/config')).json()
        assert config['auth'] == 'page-token'
        assert config['token']
        assert (await client.get('/')).status_code == 200
        assert (await client.get('/api/devices')).status_code == 200
        accepted = await client.post('/device/desk-gge/api/turn',
                                     json={'id': '33333333-3333-4333-8333-333333333333',
                                           'project': 'gge', 'text': '接着聊'},
                                     headers={'X-Voice-Token': config['token']})
        assert accepted.status_code == 202

async def test_remote_host_requires_a_secret_for_every_device(tmp_path):
    settings, roles, devices = registry(tmp_path, with_secrets=False)
    with pytest.raises(ValueError) as refused:
        create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles, host=LAN)
    assert '独立凭据' in str(refused.value)

    # The same configuration is still valid on the computer itself.
    create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles)

def test_secrets_must_be_distinct_and_long_enough(tmp_path):
    settings, roles, _ = registry(tmp_path)
    with pytest.raises(ValueError) as short:
        DeviceBinding('desk-x', 'X', 'gge', settings.session_key, secret='too-short')
    assert '32' in str(short.value)

    with pytest.raises(ValueError) as same:
        DeviceRegistry([
            DeviceBinding('desk-gge', 'G哥的设备', 'gge', settings.session_key, secret=SECRET_GE),
            DeviceBinding('desk-cursor', 'Cursor 的设备', 'cursor', settings.session_key, secret=SECRET_GE),
        ], roles)
    assert '不得重复' in str(same.value)

async def test_wildcard_listener_still_requires_a_device_secret(tmp_path):
    app = app_for(tmp_path, host='0.0.0.0')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(LAN, 5000)),
                                 base_url=REMOTE) as anonymous:
        assert (await anonymous.get('/device/desk-gge/api/config')).status_code == 403
    async with client_for(app, REMOTE, secret=SECRET_GE) as client:
        assert (await client.get('/device/desk-gge/api/config')).status_code == 200

async def test_device_status_never_exposes_the_secret(tmp_path):
    app = app_for(tmp_path)
    async with client_for(app, REMOTE, secret=SECRET_GE) as client:
        body = (await client.get('/device/desk-gge/api/config')).text
        assert SECRET_GE not in body
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=LOCAL) as local:
        assert SECRET_GE not in (await local.get('/api/devices')).text

async def test_non_ascii_secret_is_rejected_as_403_not_a_crash(tmp_path):
    """A malformed header must be a refusal, never a 500."""
    app = app_for(tmp_path)
    for bad in ('密钥' * 20, 'x' * 32 + '密码', 'é' * 40):
        async with client_for(app, REMOTE, secret=bad.encode('utf-8')) as client:
            response = await client.get('/device/desk-gge/api/config')
            assert response.status_code == 403, (bad, response.status_code)
            assert '凭据' in response.json()['detail']

async def test_secret_format_is_checked_before_comparison(tmp_path):
    settings, roles, devices = registry(tmp_path)
    assert devices.authenticate('desk-gge', SECRET_GE) is True
    for bad in ('密钥' * 20, SECRET_GE + '\n', SECRET_GE + ' ', 'g' * 31, 'g' * 129):
        assert devices.authenticate('desk-gge', bad) is False, bad
