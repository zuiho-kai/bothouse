"""Real Chromium clients, native HTTP routes and media playback.

Bridge/TTS are local fakes; no injected UI events, replacement routes,
manual playback receipts or manual refresh on the queued client's behalf.
Run with Playwright and Chrome installed; absence is explicitly a skip.
"""
from pathlib import Path
import socket
import threading
import time

import pytest
import uvicorn

from voice.device_app import create_device_app
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge
from test_voice_stream import wav

pw = pytest.importorskip('playwright.sync_api')
ROOT = Path(__file__).resolve().parents[2]


class Speech:
    def synthesize_stream(self, text, on_chunk, **options):
        # Long enough to observe B ready while A is actually playing.
        audio = wav(24000 * (8 if text.startswith('gge') else 1))
        on_chunk(audio)
        return audio


@pytest.fixture
def server(tmp_path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'),
             Role('claude', 'Claude', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:test',
                        bridge_socket=str(tmp_path / 'absent.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=port)
    registry = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name, r.project,
                                            settings.session_key) for r in roles], roles)
    bridge = Bridge()
    app = create_device_app(settings, registry, speech=Speech(), bridge=bridge, roles=roles,
                            screen_dir=ROOT / 'prototypes/device-ui')
    receipts = []

    @app.middleware('http')
    async def observe(request, call_next):
        body = await request.json() if request.url.path.endswith('/playback') else None
        response = await call_next(request)
        if body is not None:
            receipts.append((request.url.path.split('/')[2], body['state'], response.status_code))
        return response

    service = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port,
                                           log_level='error', access_log=False))
    thread = threading.Thread(target=service.run, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if service.started:
                break
            time.sleep(.05)
        assert service.started
        yield f'http://127.0.0.1:{port}', receipts, bridge
    finally:
        service.should_exit = True
        thread.join(timeout=5)
        assert not thread.is_alive()


@pytest.mark.parametrize('screen, stop_queued', [
    (False, False), (False, True), (True, False), (True, True), ('mixed', False),
], ids=['device-handoff', 'device-stop', 'screen-handoff', 'screen-stop', 'three-mixed-pages'])
def test_queued_answer_automatically_plays_after_owner_finishes(server, screen, stop_queued):
    base, receipts, bridge = server
    mixed = screen == 'mixed'
    screen = screen is True
    with pw.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel='chrome', headless=True,
                         args=['--autoplay-policy=no-user-gesture-required'])
        except Exception:
            try:
                browser = playwright.chromium.launch(headless=True,
                             args=['--autoplay-policy=no-user-gesture-required'])
            except Exception as exc:
                pytest.skip(f'没有可用的 Chromium: {exc}')
        try:
            # Separate contexts keep both documents visible; hiding a device
            # page intentionally stops its turn in the product.
            a = browser.new_context(viewport={'width': 1400, 'height': 1000}).new_page()
            b = browser.new_context(viewport={'width': 1400, 'height': 1000}).new_page()
            errors, responses, snapshots = [], [], []
            for page in (a, b):
                page.on('pageerror', lambda exc: errors.append(str(exc)))
                page.on('response', lambda r: responses.append((r.url, r.status)))
                page.goto(base + '/device/desk-' + ('gge' if page == a else 'cursor')
                          + ('/screen/' if screen else ''))
                if screen:
                    page.wait_for_function('window.__conestDeviceUI.getState().connected')
                else:
                    page.wait_for_function("document.querySelector('#connection-state').textContent.includes('已连接')")

            if mixed:
                c = browser.new_context(viewport={'width': 1400, 'height': 1000}).new_page()
                c.on('pageerror', lambda exc: errors.append(str(exc)))
                c.on('response', lambda r: responses.append((r.url, r.status)))
                c.goto(base + '/device/desk-claude/screen/')
                c.wait_for_function('window.__conestDeviceUI.getState().connected')

            def observe_snapshot(response):
                if '/api/turn/' in response.url and response.request.method == 'GET' and '/audio' not in response.url:
                    snapshots.append(response.json())
            b.on('response', observe_snapshot)

            def send(page, text):
                page.locator('#cn-voice-text' if screen else '#draft').fill(text)
                page.locator('#cn-voice-send' if screen else '#send').click()

            audio = '#cn-voice-audio' if screen else '#audio'
            send(a, 'A先回答')
            a.wait_for_function("s => {const a=document.querySelector(s);return a.currentSrc.includes('/api/turn/') && !a.paused && a.currentTime > .05}", arg=audio, timeout=10000)
            send(b, 'B排队回答')
            deadline = time.monotonic() + 5
            while not any(s.get('status') == 'ready' and s.get('playback_allowed') is False for s in snapshots):
                assert time.monotonic() < deadline, snapshots
                b.wait_for_timeout(50)
            b.wait_for_timeout(300)
            assert b.locator(audio).evaluate("(a) => a.paused || a.readyState < 2 || !a.currentSrc.includes('/api/turn/')")
            assert not any(device == 'desk-cursor' for device, _, _ in receipts)
            assert '排队等待播放' in b.locator('body').inner_text()
            assert not any('/desk-cursor/api/turn/' in url and '/audio' in url for url, _ in responses)
            evidence = ROOT / 'output/playwright'
            evidence.mkdir(parents=True, exist_ok=True)
            b.screenshot(path=str(evidence / f'queue-{screen}-waiting.png'))
            if mixed:
                # Submit C once, only after B has finished generating. The
                # shared synthesis pipeline is separate from the playback queue.
                c.locator('#cn-voice-text').fill('C等前两位说完')
                c.locator('#cn-voice-send').click()
                c.wait_for_function("() => document.body.innerText.includes('排队等待播放')")
                assert c.locator('#cn-voice-audio').evaluate('(a) => a.paused || a.readyState < 2')
                assert not any('/desk-claude/api/turn/' in url and '/audio' in url for url, _ in responses)
                c.screenshot(path=str(evidence / 'queue-mixed-screen-waiting.png'))
            if stop_queued:
                b.locator('#cn-voice-stop' if screen else '#stop').click()
                deadline = time.monotonic() + 15
                while ('desk-gge', 'completed', 200) not in receipts:
                    assert time.monotonic() < deadline, receipts
                    b.wait_for_timeout(50)
                b.wait_for_timeout(500)
                assert not any(device == 'desk-cursor' and state == 'playing' for device, state, _ in receipts)
                assert not any('/desk-cursor/api/turn/' in url and '/audio' in url for url, _ in responses)
                assert not errors, errors
                return
            # Only the client's own polling can obtain the grant and start audio.
            b.wait_for_function("s => {const a=document.querySelector(s);return a.currentSrc.includes('/api/turn/') && !a.paused && a.currentTime > .05}",
                                arg=audio, timeout=15000)
            assert a.locator(audio).evaluate('(a) => a.paused')
            b.screenshot(path=str(evidence / f'queue-{screen}-playing.png'))
            deadline = time.monotonic() + 5
            while ('desk-cursor', 'completed', 200) not in receipts:
                assert time.monotonic() < deadline, receipts
                b.wait_for_timeout(50)
            assert receipts.index(('desk-gge', 'completed', 200)) < receipts.index(('desk-cursor', 'playing', 200))
            if mixed:
                c.wait_for_function("() => {const a=document.querySelector('#cn-voice-audio'); return a.currentSrc.includes('/api/turn/') && !a.paused && a.currentTime > .05}")
                assert a.locator(audio).evaluate('(a) => a.paused')
                assert b.locator(audio).evaluate('(a) => a.paused')
                c.screenshot(path=str(evidence / 'queue-mixed-screen-playing.png'))
                deadline = time.monotonic() + 5
                while ('desk-claude', 'completed', 200) not in receipts:
                    assert time.monotonic() < deadline, receipts
                    c.wait_for_timeout(50)
                assert receipts.index(('desk-cursor', 'completed', 200)) < receipts.index(('desk-claude', 'playing', 200))
            assert [body['project'] for path, body in bridge.calls if path == '/input'] == (['gge', 'cursor', 'claude'] if mixed else ['gge', 'cursor'])
            assert not errors, errors
            assert not [(url, status) for url, status in responses if '/api/' in url and status >= 400]
        finally:
            browser.close()
