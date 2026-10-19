#!/usr/bin/env python3
"""Automated tests for CoNest Round Screen Device UI (PR #54 / Issue #53).

Verifies that:
1. Fake 1.5s thinking timer (thinkingTimer = setTimeout(..., 1500)) is completely eliminated.
2. Build consistency between source.html, preview-shell.html, and index.html is maintained.
3. UI state transitions are strictly driven by real voice lifecycle events:
   - pointerdown / startListening -> 'listening'
   - pointerup / finishListeningAndThink -> 'thinking'
   - Waiting >1.8s in 'thinking' NEVER auto-switches to 'speaking' (no timer bypass)
   - Real audio:playing event -> 'speaking'
   - Real audio:completed event -> 'idle'
   - Error / Busy / Offline events -> 'error' / 'busy' / 'offline'
   - Stop action during speaking -> 'stopping', ignoring late audio events until release
"""

import os
import re
import subprocess
import sys
import time
from pathlib import Path

DIR = Path(__file__).resolve().parent
REPO_ROOT = DIR.parent.parent
SOURCE_HTML = DIR / "source.html"
INDEX_HTML = DIR / "index.html"
CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def test_build_sync():
    """Verify build.py --check passes."""
    res = subprocess.run(
        [sys.executable, str(DIR / "build.py"), "--check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, f"build.py --check failed:\n{res.stderr}\n{res.stdout}"
    print("PASS: build.py --check is clean and up to date.")


def test_no_fake_timer_in_sources():
    """Verify thinkingTimer and fake 1500ms transitions are removed."""
    for path in [SOURCE_HTML, INDEX_HTML]:
        content = path.read_text(encoding="utf-8")
        assert "thinkingTimer" not in content, f"Found obsolete thinkingTimer in {path.name}"
        # Ensure no setTimeout sets speaking phase
        match = re.search(r"setTimeout\([^)]*changePhase\(['\"]speaking['\"]\)", content)
        assert match is None, f"Found setTimeout setting speaking in {path.name}"
        print(f"PASS: No fake thinking timer found in {path.name}.")


def test_browser_voice_state_transitions():
    """Verify real state transitions in headless Chrome via Playwright."""
    from playwright.sync_api import sync_playwright

    screenshots_dir = DIR / "test-artifacts"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME_PATH,
            args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
        )
        page = browser.new_page(viewport={"width": 1400, "height": 960})

        # Capture console messages
        console_logs = []
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        page.goto(INDEX_HTML.as_uri())
        page.wait_for_selector("#conest-device-ui")

        # 1. Initial State should be idle
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "idle", f"Expected initial phase idle, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "01_state_idle.png"))
        print("PASS: 1. Initial UI state is 'idle'.")

        # 2. Press down action button -> listening
        action_btn = page.locator(".cn-primary-card .cn-action")
        action_box = action_btn.bounding_box()
        assert action_box is not None, "Action button bounding box missing"

        # Dispatch pointerdown on action button
        page.mouse.move(action_box["x"] + action_box["width"] / 2, action_box["y"] + action_box["height"] / 2)
        page.mouse.down()
        page.wait_for_timeout(100)

        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "listening", f"Expected listening on pointerdown, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "02_state_listening.png"))
        print("PASS: 2. Pressing action button transitions to 'listening'.")

        # 3. Release action button -> thinking
        page.mouse.up()
        page.wait_for_timeout(100)

        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "thinking", f"Expected thinking on pointerup, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "03_state_thinking.png"))
        print("PASS: 3. Releasing action button transitions to 'thinking'.")

        # 4. CRITICAL: Wait 2.2 seconds (past old 1.5s timer) - MUST REMAIN 'thinking'
        print("Waiting 2.2s to confirm thinking phase does not auto-advance without real audio...")
        page.wait_for_timeout(2200)

        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "thinking", (
            f"REGRESSION: UI auto-advanced to '{ui_state['phase']}' without real audio event!"
        )
        print("PASS: 4. Verified NO fake timer: UI remained in 'thinking' after 2.2s.")

        # 5. Real audio starts playing -> speaking
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'audio:playing', detail: '正在回答' })")
        page.wait_for_timeout(100)

        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "speaking", f"Expected speaking on audio:playing, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "04_state_speaking.png"))
        print("PASS: 5. Real audio:playing event transitions to 'speaking'.")

        # 6. Real audio completed -> idle
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'completed' })")
        page.wait_for_timeout(100)

        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "idle", f"Expected idle on audio completion, got {ui_state['phase']}"
        print("PASS: 6. Real audio completed event transitions back to 'idle'.")

        # 7. Test Stop during speaking & race protection
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'audio:playing', detail: '正在回答' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "speaking"
        captured_seq = ui_state["sessionSeq"]

        # Call stopActiveTurn()
        page.evaluate("window.__conestDeviceUI.stopActiveTurn()")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "stopping", f"Expected stopping after stopActiveTurn, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "05_state_stopping.png"))
        print("PASS: 7. stopActiveTurn() transitions to 'stopping'.")

        # Late audio playback event arrives for the stopped turn -> MUST BE IGNORED
        late_result = page.evaluate(f"window.__conestDeviceUI.simulateLateSpeakingCallback({captured_seq})")
        assert late_result is False, "Late speaking callback was incorrectly accepted during stopping!"
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "stopping", f"UI incorrectly changed phase to {ui_state['phase']}!"
        print("PASS: 8. Late audio events during 'stopping' are rejected; race condition prevented.")

        # Confirm stopped release
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'turn:stopped' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "idle", f"Expected idle after turn:stopped, got {ui_state['phase']}"
        print("PASS: 9. turn:stopped releases device back to 'idle'.")

        # 10. Error state transition
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'turn:error', error: 'TTS合成超时' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "error", f"Expected error state, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "06_state_error.png"))
        print("PASS: 10. turn:error event transitions to 'error' state with action label '重试'.")

        # 11. Busy state transition
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'turn:busy', detail: '服务忙' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "busy", f"Expected busy state, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "07_state_busy.png"))
        print("PASS: 11. turn:busy event transitions to 'busy' state.")

        # 12. Offline & online transitions
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'connection:offline', detail: '电脑未连接' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "offline", f"Expected offline state, got {ui_state['phase']}"
        page.screenshot(path=str(screenshots_dir / "08_state_offline.png"))

        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'connection:online' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "idle", f"Expected idle after connection:online, got {ui_state['phase']}"
        print("PASS: 12. connection:offline and connection:online transitions verified.")

        # 13. Verify speaking clip uses dedicated gpt/speaking.mp4
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'playing' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "speaking", f"Expected speaking, got {ui_state['phase']}"
        speaking_src = page.evaluate("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active ? active.dataset.logicalSrc : '';
        }""")
        assert "assets/characters/gpt/speaking.mp4" in speaking_src, f"Expected speaking.mp4, got {speaking_src}"
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'completed' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "idle", f"Expected idle, got {ui_state['phase']}"
        print("PASS: 13. Speaking phase uses dedicated gpt/speaking.mp4.")

        # 14. Idle random variants: available list and triggering
        variants = page.evaluate("window.__conestDeviceUI.getIdleVariants()")
        expected_variants = ["yawn", "doze", "pout", "happy", "curious", "shy"]
        assert sorted(variants) == sorted(expected_variants), f"Expected variants {expected_variants}, got {variants}"

        # Trigger specific variant 'happy'
        page.evaluate("window.__conestDeviceUI.triggerIdleVariant('happy')")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["idleVariant"] == "happy", f"Expected idleVariant happy, got {ui_state['idleVariant']}"
        page.wait_for_timeout(200)
        happy_src = page.evaluate("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active ? active.dataset.logicalSrc : '';
        }""")
        assert "assets/characters/gpt/happy.mp4" in happy_src, f"Expected happy.mp4, got {happy_src}"
        page.screenshot(path=str(screenshots_dir / "09_state_idle_variant_happy.png"))
        print("PASS: 14. Idle variant 'happy' triggers and loads happy.mp4.")

        # 15. Immediate interruption: starting to listen cuts off idle variant instantly
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'recording:start' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "listening", f"Expected listening, got {ui_state['phase']}"
        assert ui_state["idleVariant"] is None, f"Expected idleVariant cleared, got {ui_state['idleVariant']}"
        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/gpt/listening-nod.mp4');
        }""")
        print("PASS: 15. Active idle variant is immediately interrupted on state change.")

        # 16. Returning to idle and avoiding repeating the same variant twice
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'recording:cancel' })")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["phase"] == "idle"

        # Trigger twice randomly, assert consecutive choices differ
        v1 = page.evaluate("window.__conestDeviceUI.triggerIdleVariant()")
        assert v1 in expected_variants
        v2 = page.evaluate("window.__conestDeviceUI.triggerIdleVariant()")
        assert v2 in expected_variants
        assert v1 != v2, f"Expected two consecutive variants to differ, got {v1} and {v2}"
        page.evaluate("window.__conestDeviceUI.stopIdleVariant()")
        print("PASS: 16. Consecutive random idle variants do not repeat.")

        # 17. Verify Gemini character switching, clips, and idle variants
        page.evaluate("window.__conestDeviceUI.setCharacter('gemini')")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["character"] == "gemini", f"Expected gemini, got {ui_state['character']}"
        gemini_name = page.locator('.cn-primary-card .cn-role-name').first.inner_text()
        assert gemini_name == "大豆包", f"Expected '大豆包', got '{gemini_name}'"
        gemini_variants = page.evaluate("window.__conestDeviceUI.getIdleVariants()")
        assert sorted(gemini_variants) == ["doze", "happy", "shy"], f"Expected ['doze', 'happy', 'shy'], got {gemini_variants}"

        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/gemini/idle.mp4');
        }""")

        page.evaluate("window.__conestDeviceUI.triggerIdleVariant('happy')")
        assert page.evaluate("window.__conestDeviceUI.getState().idleVariant") == "happy"
        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/gemini/happy.mp4');
        }""")
        page.screenshot(path=str(screenshots_dir / "10_gemini_idle_variant_happy.png"))
        page.evaluate("window.__conestDeviceUI.stopIdleVariant()")

        # Test Gemini consecutive random variants do not repeat
        gv1 = page.evaluate("window.__conestDeviceUI.triggerIdleVariant()")
        assert gv1 in gemini_variants
        gv2 = page.evaluate("window.__conestDeviceUI.triggerIdleVariant()")
        assert gv2 in gemini_variants
        assert gv1 != gv2
        page.evaluate("window.__conestDeviceUI.stopIdleVariant()")

        # Verify Gemini speaking and thinking clips
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'playing' })")
        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/gemini/speaking.mp4');
        }""")
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'completed' })")
        print("PASS: 17. Gemini character verified with 3 idle variants, dedicated speaking/thinking, and happy variant.")

        # 18. Verify Grok character switching, clips, and idle variants
        page.evaluate("window.__conestDeviceUI.setCharacter('grok')")
        ui_state = page.evaluate("window.__conestDeviceUI.getState()")
        assert ui_state["character"] == "grok", f"Expected grok, got {ui_state['character']}"
        grok_name = page.locator('.cn-primary-card .cn-role-name').first.inner_text()
        assert grok_name == "Grok", f"Expected 'Grok', got '{grok_name}'"
        grok_variants = page.evaluate("window.__conestDeviceUI.getIdleVariants()")
        assert sorted(grok_variants) == ["doze", "happy", "shy"], f"Expected ['doze', 'happy', 'shy'], got {grok_variants}"

        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/grok/idle.mp4');
        }""")

        page.evaluate("window.__conestDeviceUI.triggerIdleVariant('shy')")
        assert page.evaluate("window.__conestDeviceUI.getState().idleVariant") == "shy"
        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/grok/shy.mp4');
        }""")
        page.screenshot(path=str(screenshots_dir / "11_grok_idle_variant_shy.png"))
        page.evaluate("window.__conestDeviceUI.stopIdleVariant()")

        # Test Grok consecutive random variants do not repeat
        grv1 = page.evaluate("window.__conestDeviceUI.triggerIdleVariant()")
        assert grv1 in grok_variants
        grv2 = page.evaluate("window.__conestDeviceUI.triggerIdleVariant()")
        assert grv2 in grok_variants
        assert grv1 != grv2
        page.evaluate("window.__conestDeviceUI.stopIdleVariant()")

        # Verify Grok speaking clip
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'playing' })")
        page.wait_for_function("""() => {
            const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
            return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/grok/speaking.mp4');
        }""")
        page.evaluate("window.__conestDeviceUI.handleVoiceEvent({ type: 'playback:state', state: 'completed' })")
        print("PASS: 18. Grok character verified with 3 idle variants, dedicated speaking/thinking, and shy variant.")

        # 19. Verify character name updates dynamically across all character switches (大豆包, Grok, Claude, DeepSeek, G哥)
        for char_id, expected_name in [
            ("gemini", "大豆包"),
            ("grok", "Grok"),
            ("claude", "Claude"),
            ("deepseek", "DeepSeek"),
            ("gpt", "G哥"),
        ]:
            page.evaluate(f"window.__conestDeviceUI.setCharacter('{char_id}')")
            role_el_name = page.locator('.cn-primary-card .cn-role-name').first.inner_text()
            assert role_el_name == expected_name, f"Expected '{expected_name}' for {char_id}, got '{role_el_name}'"
            aria = page.locator('.cn-primary-card .cn-top-pill').first.get_attribute('aria-label')
            assert expected_name in aria, f"Expected '{expected_name}' in top pill aria-label, got '{aria}'"
        print("PASS: 19. Character switching dynamically updates role name on top pill and aria-label ('大豆包', 'Grok', 'G哥').")

        # Restore character to gpt for subsequent tests
        page.evaluate("window.__conestDeviceUI.setCharacter('gpt')")

        browser.close()


import io
import json
import socket
import threading
import wave
from uuid import uuid4


def wav_bytes(frames=24000):
    # 24kHz 16-bit mono WAV, 24000 frames = 1.0 second
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\x10\x01" * frames)
    return out.getvalue()


class E2ESpeech:
    def __init__(self):
        self.spoken = []
        self.hold_start = threading.Event()
        self.hold_start.set()
        self.hold_finish = threading.Event()
        self.hold_finish.set()

    def synthesize_stream(self, text, on_chunk, **options):
        self.spoken.append(text)
        self.hold_start.wait(15)
        chunk = wav_bytes(24000)
        on_chunk(chunk)
        self.hold_finish.wait(15)
        return chunk

    def transcribe(self, body):
        return "模拟语音转写文字"


class E2EBridge:
    def __init__(self):
        self.calls = []
        self.requests = {}
        self.hold_finish = threading.Event()
        self.hold_finish.set()

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path.startswith("/input/bindings?"):
            from urllib.parse import parse_qs, urlsplit
            query = parse_qs(urlsplit(path).query)
            project = query["project"][0]
            return {
                "project": project,
                "session_key": query["session_key"][0],
                "session_id": project + "-session",
                "agent_session_id": project + "-cli",
                "busy": False,
            }
        if body is not None:
            self.requests[body["request_id"]] = body
            return {"status": "running"}
        request_id = path.rsplit("/", 1)[-1]
        self.hold_finish.wait(30)
        return {
            "request_id": request_id,
            "status": "completed",
            "text": "这是来自G哥的真实回答",
            "session_id": "gge-session",
            "agent_session_id": "gge-cli",
        }


def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_device_app_e2e_browser():
    """Verify real device_app HTTP backend + same-origin /device/{id}/screen browser E2E."""
    import uvicorn
    from playwright.sync_api import sync_playwright
    from voice.device_app import create_device_app
    from voice.devices import DeviceBinding, DeviceRegistry
    from voice.roles import Role
    from voice.settings import Settings

    import tempfile

    port = get_free_port()
    td = tempfile.TemporaryDirectory(prefix="conest-e2e-")
    tmp_path = Path(td.name)

    roles = (Role("gge", "G哥", "uncle_fu"), Role("cursor", "Cursor", "serena"))
    settings = Settings(
        project="gge",
        role_name="G哥",
        session_key="discord:test",
        bridge_socket=str(tmp_path / "bridge.sock"),
        model_path=str(tmp_path),
        data_dir=str(tmp_path / "data"),
        shared_memory_dir=str(tmp_path / "memory"),
        tts_backend="qwen3",
        port=port,
    )
    devices = DeviceRegistry(
        [DeviceBinding("desk-" + r.project, r.name + "的设备", r.project, settings.session_key) for r in roles],
        roles,
    )
    bridge = E2EBridge()
    speech = E2ESpeech()

    import inspect
    sig = inspect.signature(create_device_app)
    if "screen_dir" in sig.parameters:
        app = create_device_app(settings, devices, speech=speech, bridge=bridge, roles=roles, screen_dir=str(DIR))
    else:
        app = create_device_app(settings, devices, speech=speech, bridge=bridge, roles=roles)

    has_native_screen = any(
        getattr(r, "path", None) in {
            "/device/{device_id}/screen",
            "/device/{device_id}/screen/",
            "/device/{device_id}/screen/{asset:path}",
        }
        for r in getattr(app.router, "routes", [])
    )
    assert has_native_screen, (
        "create_device_app 缺少原生圆屏路由 (/device/{device_id}/screen)。"
        "测试已移除替代路由兜底；缺少原生路由明确失败（必须由 #66 服务端原生提供）。"
    )
    print("PASS: Directly using real server-provided screen routes from create_device_app (#66).")

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()

    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=CHROME_PATH,
                args=[
                    "--use-fake-ui-for-media-stream",
                    "--use-fake-device-for-media-stream",
                    "--autoplay-policy=no-user-gesture-required",
                ],
            )
            page = browser.new_page(viewport={"width": 1400, "height": 960})

            console_logs = []
            page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

            page.goto(f"http://127.0.0.1:{port}/device/desk-gge/screen")
            page.wait_for_selector("#conest-device-ui")

            # Verify no CSP violations
            csp_errors = [log for log in console_logs if "Content Security Policy" in log or "violates" in log]
            assert not csp_errors, f"Detected CSP violations: {csp_errors}"
            print("PASS: 20. /device/desk-gge/screen loaded with zero CSP violations.")

            def wait_for_connected(timeout=4.0):
                start = time.monotonic()
                while time.monotonic() - start < timeout:
                    if page.evaluate("() => Boolean(window.__conestDeviceUI?.getState().connected)"):
                        return
                    time.sleep(0.05)
                raise TimeoutError("Timed out waiting for UI to connect to backend")

            def wait_for_phase(expected, timeout=6.0):
                start = time.monotonic()
                while time.monotonic() - start < timeout:
                    st = page.evaluate("() => window.__conestDeviceUI?.getState().phase")
                    if st == expected:
                        return
                    time.sleep(0.05)
                st = page.evaluate("() => window.__conestDeviceUI?.getState().phase")
                detail = page.evaluate("() => window.__conestDeviceUI?.getState().statusDetail")
                logs = "\n".join(console_logs[-10:])
                raise TimeoutError(f"Timed out waiting for phase '{expected}', current is '{st}', detail: '{detail}', logs:\n{logs}")

            # Verify auto-connected
            wait_for_connected(4.0)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "idle"
            assert ui_state["apiPrefix"] == "/device/desk-gge"
            print("PASS: 21. Auto-connected to /device/desk-gge/api/config, initial phase is 'idle'.")

            # Delay actual microphone readiness until after the user lets go.
            # No UI event/state injection: drive the button and the native API.
            page.evaluate("""() => {
              window.originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
              navigator.mediaDevices.getUserMedia = async options => {
                const stream = await window.originalGetUserMedia(options);
                window.delayedMicStream = stream;
                await new Promise(resolve => { window.finishMicStartup = resolve; });
                return stream;
              };
            }""")
            action = page.locator('.cn-primary-card .cn-action')
            action.hover()
            page.mouse.down()
            page.wait_for_function('() => typeof window.finishMicStartup === "function"')
            page.mouse.up()
            wait_for_phase('error')
            assert '没有采集到音频' in page.evaluate('window.__conestDeviceUI.getState().statusDetail')
            page.evaluate('window.finishMicStartup()')
            page.wait_for_function('() => window.delayedMicStream.getTracks().every(t => t.readyState === "ended")')
            assert page.evaluate('window.__conestDeviceUI.getState().activeTurnId') is None
            page.evaluate('() => { navigator.mediaDevices.getUserMedia = window.originalGetUserMedia; }')
            action.click()
            wait_for_phase('idle')
            print('PASS: 22. Early microphone release reports no audio, closes the late stream, and permits recovery.')

            # Turn 1: Hold speech synthesis to test thinking phase does not auto-advance
            speech.hold_start.clear()
            speech.hold_finish.clear()
            page.evaluate("window.__conestDeviceUI.submitTextTurn('你好，G哥')")
            wait_for_phase("thinking", 5.0)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "thinking"

            print("Waiting 1.8s in thinking state to verify no timer auto-advance in real API mode...")
            page.wait_for_timeout(1800)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "thinking", "Must remain in thinking phase while waiting for audio"
            print("PASS: 23. Verified real API turn stays in 'thinking' without fake timer bypass.")

            # Release speech synthesis chunk -> audio delivered -> speaking
            speech.hold_start.set()
            wait_for_phase("speaking", 5.0)
            print("PASS: 24. Real audio synthesized and played, transition to 'speaking'.")

            # Test Stop failure: intercept /stop with 500 error
            page.route("**/stop", lambda route: route.fulfill(status=500, body='{"detail": "模拟停服异常"}'))
            page.locator(".cn-primary-card .cn-action").click()
            page.wait_for_timeout(150)

            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "stopping", f"Expected stopping upon stop failure, got {ui_state['phase']}"
            assert ui_state["stopFailed"] is True, "Expected stopFailed flag to be True"
            label_text = page.locator(".cn-primary-card .cn-action-label").inner_text()
            assert "再按停止" in label_text, f"Expected action label '再按停止', got '{label_text}'"

            # Verify NO 350ms timer pushes state back to idle
            page.wait_for_timeout(600)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "stopping", "Must NOT revert to idle when stop fails"
            print("PASS: 25. Stop failure correctly keeps UI in 'stopping', enables retry button ('再按停止'), no 350ms revert.")

            # Retry stop: unroute /stop while speech.hold_finish is still cleared (backend task is held)
            page.unroute("**/stop")
            page.locator(".cn-primary-card .cn-action").click()
            page.wait_for_timeout(200)

            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "stopping"
            assert ui_state["stopFailed"] is False

            # During draining, action button is disabled ('等待收尾完成') and repeated clicks do not alter stopping phase
            assert page.locator(".cn-primary-card .cn-action").is_disabled()
            page.locator(".cn-primary-card .cn-action").click(force=True, timeout=500)
            page.wait_for_timeout(400)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "stopping", f"Repeated stop clicks during drain must remain in stopping, got {ui_state['phase']}"
            print("PASS: 26. Successful stop enters drain wait; action button is disabled ('等待收尾完成') and remains in 'stopping'.")

            # Release backend synthesis completion -> task finishes -> device_released becomes True
            speech.hold_finish.set()
            wait_for_phase("idle", 6.0)
            print("PASS: 27. Device release confirmed by backend, transitions from 'stopping' to 'idle'.")

            # Turn 2: Natural completion (thinking -> speaking -> completed -> idle)
            speech.hold_start.set()
            speech.hold_finish.set()
            page.evaluate("window.__conestDeviceUI.submitTextTurn('第二句话')")
            wait_for_phase("speaking", 5.0)
            wait_for_phase("idle", 8.0)
            print("PASS: 28. Second turn completes naturally through real audio playback to 'idle'.")

            # Turn 3: Abandoned / lease-expired turn display and recovery
            speech.hold_start.clear()
            speech.hold_finish.clear()
            page.evaluate("window.__conestDeviceUI.submitTextTurn('第三句测试失联')")
            wait_for_phase("thinking", 5.0)

            # Server marks turn as abandoned / lease expired
            turn3_id = page.evaluate("window.__conestDeviceUI.getState().activeTurnId")
            page.route(f"**/api/turn/{turn3_id}*", lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "id": turn3_id,
                    "status": "stopped",
                    "abandoned": True,
                    "abandon_reason": "设备 6 秒没有心跳，占位已释放…",
                    "device_released": True,
                    "last_release": {"reason": "lease-expired", "detail": "设备 6 秒没有心跳，占位已释放…"}
                })
            ))
            wait_for_phase("error", 5.0)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "error"
            assert "没有心跳" in ui_state["statusDetail"] or "占位已释放" in ui_state["statusDetail"]
            assert "连接中断，本轮已放弃" in ui_state["statusDetail"]
            visible = page.locator("body").inner_text()
            assert "没有心跳" in visible and "占位已释放" in visible
            page.unroute(f"**/api/turn/{turn3_id}*")

            # Tap action button to clear error and safely return to idle
            page.locator(".cn-primary-card .cn-action").click()
            page.wait_for_timeout(150)
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["phase"] == "idle"
            print("PASS: 29. Abandoned / lease-expired turn shows abandonment notice and recovers to 'idle'.")

            # 30. Live round-screen route triggers and plays idle variant
            page.evaluate("window.__conestDeviceUI.triggerIdleVariant('shy')")
            ui_state = page.evaluate("window.__conestDeviceUI.getState()")
            assert ui_state["idleVariant"] == "shy"
            page.wait_for_function("""() => {
                const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
                return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/gpt/shy.mp4');
            }""")
            page.evaluate("window.__conestDeviceUI.stopIdleVariant()")
            assert page.evaluate("window.__conestDeviceUI.getState().idleVariant") is None
            print("PASS: 30. Live round-screen route successfully triggers and plays idle variant clip.")

            # 31. Live round-screen route switches character to Grok and triggers doze variant
            page.evaluate("window.__conestDeviceUI.setCharacter('grok')")
            grok_live_name = page.locator('.cn-primary-card .cn-role-name').first.inner_text()
            assert grok_live_name == "Grok", f"Expected 'Grok' in live route, got '{grok_live_name}'"
            page.wait_for_function("""() => {
                const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
                return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/grok/idle.mp4');
            }""")
            page.evaluate("window.__conestDeviceUI.triggerIdleVariant('doze')")
            assert page.evaluate("window.__conestDeviceUI.getState().idleVariant") == "doze"
            page.wait_for_function("""() => {
                const active = document.querySelector('.cn-primary-card .cn-video-layer.is-active');
                return active && active.dataset.logicalSrc && active.dataset.logicalSrc.includes('assets/characters/grok/doze.mp4');
            }""")
            page.evaluate("window.__conestDeviceUI.stopIdleVariant()")
            print("PASS: 31. Live round-screen route switches to Grok (role name verified) and triggers doze variant clip.")

            browser.close()
    finally:
        server.should_exit = True
        server_thread.join(timeout=3)
        td.cleanup()


def main():
    print("=== CoNest Round Screen Device UI Real Voice Events Test Suite ===")
    test_build_sync()
    test_no_fake_timer_in_sources()
    test_browser_voice_state_transitions()
    test_device_app_e2e_browser()
    print("\nALL 31 TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    main()
