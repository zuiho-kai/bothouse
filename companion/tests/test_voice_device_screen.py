"""The round screen is served by the same entry as the API it calls.

大豆包 owns the page (#54); this only proves the route, the same-origin
bootstrap and that a page can never escape its directory or the computer.
"""
import httpx
import pytest
from urllib.parse import urljoin

from voice.device_app import create_device_app
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge

class Speech:
    def synthesize_stream(self, text, on_chunk, **options):
        raise AssertionError('the screen route must not synthesize')

    def transcribe(self, body):
        raise AssertionError('the screen route must not transcribe')

PAGE = ('<!doctype html><html><head><meta charset="utf-8"><title>圆屏</title>'
        '</head><body><script src="./app.js"></script></body></html>')

def setup(tmp_path, screen_dir=None):
    roles = (Role('gge', 'G哥', 'uncle_fu'),)
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-gge', 'G哥的设备', 'gge', settings.session_key)], roles)
    app = create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles,
                            screen_dir=screen_dir)
    return app

def client_for(app, host='127.0.0.1'):
    transport = httpx.ASGITransport(app=app, client=(host, 5000))
    return httpx.AsyncClient(transport=transport, base_url='http://127.0.0.1:8796')

async def test_screen_is_served_on_the_api_origin_with_a_device_bootstrap(tmp_path):
    page = tmp_path / 'screen'
    page.mkdir()
    (page / 'index.html').write_text(PAGE, encoding='utf-8')
    (page / 'app.js').write_text('// page', encoding='utf-8')
    (page / 'assets').mkdir()
    (page / 'assets' / 'idle.mp4').write_bytes(b'video')
    app = setup(tmp_path, screen_dir=page)
    async with client_for(app) as client:
        # The browser must end on /screen/; otherwise ./app.js resolves to
        # /device/desk-gge/app.js and the page loads without its script.
        entry = await client.get('/device/desk-gge/screen')
        assert entry.status_code == 307
        assert entry.headers['location'].endswith('/device/desk-gge/screen/')
        response = await client.get('/device/desk-gge/screen', follow_redirects=True)
        assert response.status_code == 200
        assert response.headers['content-type'].startswith('text/html')
        assert str(response.url).endswith('/device/desk-gge/screen/')
        body = response.text
        bootstrap_tag = '<script src="/device/desk-gge/screen/__coqin_device.js"></script>'
        assert bootstrap_tag in body
        # No inline script: the CSP is script-src 'self' and must stay that way.
        assert '<script>window.__COQIN_DEVICE__=' not in body
        csp = response.headers['content-security-policy']
        assert "script-src 'self'" in csp
        assert 'unsafe-inline' not in csp
        bootstrap = await client.get('/device/desk-gge/screen/__coqin_device.js')
        assert bootstrap.status_code == 200
        assert bootstrap.headers['content-type'].startswith('application/javascript')
        assert 'window.__COQIN_DEVICE__=' in bootstrap.text
        assert '"/device/desk-gge/api"' in bootstrap.text
        # Same URL resolution the browser uses for the page's relative script.
        script = await client.get(urljoin(str(response.url), './app.js'))
        assert script.status_code == 200, str(script.url)
        assert (await client.get('/device/desk-gge/screen/assets/idle.mp4')).status_code == 200
        assert (await client.get('/device/desk-gge/screen/missing.js')).status_code == 404

async def test_screen_never_escapes_its_directory(tmp_path):
    page = tmp_path / 'screen'
    page.mkdir()
    (page / 'index.html').write_text(PAGE, encoding='utf-8')
    (tmp_path / 'secret.txt').write_text('nope', encoding='utf-8')
    app = setup(tmp_path, screen_dir=page)
    async with client_for(app) as client:
        for attempt in ('../secret.txt', '..%2Fsecret.txt', '%2e%2e/secret.txt'):
            response = await client.get('/device/desk-gge/screen/' + attempt)
            assert response.status_code == 404, attempt
            assert 'nope' not in response.text

async def test_screen_stays_on_the_computer(tmp_path):
    page = tmp_path / 'screen'
    page.mkdir()
    (page / 'index.html').write_text(PAGE, encoding='utf-8')
    app = setup(tmp_path, screen_dir=page)
    async with client_for(app, host='192.168.1.50') as client:
        response = await client.get('/device/desk-gge/screen')
        assert response.status_code == 403
        assert '本机' in response.json()['detail']

async def test_missing_page_says_what_to_install(tmp_path):
    app = setup(tmp_path, screen_dir=tmp_path / 'not-installed')
    async with client_for(app) as client:
        response = await client.get('/device/desk-gge/screen', follow_redirects=True)
        assert response.status_code == 404
        assert '#54' in response.json()['detail']
        assert 'static/screen' in response.json()['detail']

async def test_unknown_device_has_no_screen(tmp_path):
    page = tmp_path / 'screen'
    page.mkdir()
    (page / 'index.html').write_text(PAGE, encoding='utf-8')
    app = setup(tmp_path, screen_dir=page)
    async with client_for(app) as client:
        assert (await client.get('/device/nope/screen')).status_code == 404
