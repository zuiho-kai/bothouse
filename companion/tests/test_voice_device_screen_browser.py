"""Real-browser proof that the screen bootstrap runs under the shipped CSP.

The HTTP tests can only compare strings. This one lets Chromium resolve
`./app.js` from the page URL, execute the same-origin bootstrap and fail on a
CSP violation. CI has no browser, so the module skips there; the local run is
recorded in the PR.
"""
import socket
import threading
import time

import pytest
import uvicorn

from test_voice_device_screen import PAGE, setup

playwright_sync = pytest.importorskip('playwright.sync_api')


def _free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def _launch(playwright):
    try:
        return playwright.chromium.launch(headless=True, channel='chrome')
    except Exception:
        try:
            return playwright.chromium.launch(headless=True)
        except Exception as exc:  # No browser installed: report a skip, not a pass.
            pytest.skip(f'没有可用的 Chromium：{exc}')


@pytest.fixture
def screen_server(tmp_path):
    page = tmp_path / 'screen'
    page.mkdir()
    (page / 'index.html').write_text(PAGE, encoding='utf-8')
    (page / 'app.js').write_text('window.screenLoaded = true;', encoding='utf-8')
    app = setup(tmp_path, screen_dir=page)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(
        app, host='127.0.0.1', port=port, log_level='error', access_log=False))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(.05)
        else:
            pytest.fail('测试服务没有启动')
        yield f'http://127.0.0.1:{port}'
    finally:
        server.should_exit = True
        thread.join(timeout=5)


def test_screen_bootstrap_and_relative_script_execute_under_csp(screen_server):
    console_errors, script_responses = [], []
    with playwright_sync.sync_playwright() as playwright:
        browser = _launch(playwright)
        page = browser.new_page()
        page.on('console', lambda message: console_errors.append(message.text)
                if message.type == 'error' else None)
        page.on('response', lambda response: script_responses.append(response)
                if response.url.endswith(('__coqin_device.js', '/app.js')) else None)
        try:
            page.goto(screen_server + '/device/desk-gge/screen', wait_until='load')
            page.wait_for_function(
                "window.__COQIN_DEVICE__ && "
                "window.__COQIN_DEVICE__.api === '/device/desk-gge/api'")
            page.wait_for_function('window.screenLoaded === true')
        finally:
            browser.close()

    assert page.url.endswith('/device/desk-gge/screen/'), page.url
    assert {response.url.rsplit('/', 1)[-1]: response.status
            for response in script_responses}['__coqin_device.js'] == 200
    assert {response.url.rsplit('/', 1)[-1]: response.status
            for response in script_responses}['app.js'] == 200
    blocked = [text for text in console_errors
               if 'Content Security Policy' in text or 'Refused to execute' in text]
    assert not blocked, blocked
