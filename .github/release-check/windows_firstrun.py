"""Windows acceptance for the installed bothouse (run by release.yml verify-windows).

No config yet → `bothouse` prints the wizard link → the link and the wizard API answer over
HTTP → POST /api/v1/restart (what the wizard's "restart to apply" button does) → the wizard is
back and the process is still alive → Ctrl+Break → exits with code 0. Every check prints a
PASS line; any failure exits non-zero. Uses the real user profile of the clean runner.
"""
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

LINK_RE = re.compile(r"(http://localhost:(\d+)/login\?token=([0-9a-zA-Z]+)&next=/setup)")
lines: "queue.Queue[str]" = queue.Queue()


def fail(msg: str) -> None:
    print("FAIL:", msg, flush=True)
    sys.exit(1)


def pump(stream) -> None:
    for line in iter(stream.readline, ""):
        print("  [bothouse]", line.rstrip(), flush=True)
        lines.put(line)


def wait_line(pattern: re.Pattern, timeout: float):
    end = time.time() + timeout
    while time.time() < end:
        try:
            line = lines.get(timeout=max(0.1, end - time.time()))
        except queue.Empty:
            break
        m = pattern.search(line)
        if m:
            return m
    return None


def get(url: str, token: str = "", method: str = "GET"):
    req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.read().decode("utf-8", "replace")


def wait_http(url: str, timeout: float):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            return get(url)
        except (urllib.error.URLError, ConnectionError, OSError) as e:
            last = e
            time.sleep(0.5)
    fail(f"{url} did not answer within {timeout}s: {last}")


exe = shutil.which("bothouse")
if not exe:
    fail("bothouse is not on PATH")
print("binary:", exe, flush=True)
cfg = os.path.join(os.path.expanduser("~"), ".bothouse", "config.toml")
if os.path.exists(cfg):
    fail(f"{cfg} already exists; this check needs a first run")

proc = subprocess.Popen(
    [exe],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    encoding="utf-8",
    errors="replace",
    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
)
threading.Thread(target=pump, args=(proc.stdout,), daemon=True).start()

try:
    m = wait_line(LINK_RE, 60)
    if not m:
        fail("no wizard link printed within 60s")
    link, port, token = m.group(1), m.group(2), m.group(3)
    print("PASS first run printed the wizard link:", link, flush=True)
    link_file = os.path.join(os.path.dirname(cfg), "setup-link.txt")
    if not os.path.exists(link_file) or link not in open(link_file, encoding="utf-8").read():
        fail(f"{link_file} missing or without the link")
    print("PASS link also saved in", link_file, flush=True)

    status, body = wait_http(link, 30)
    if status != 200 or "<html" not in body.lower():
        fail(f"wizard page: HTTP {status}, body starts {body[:200]!r}")
    print(f"PASS GET wizard link -> HTTP {status}, {len(body)} bytes of HTML", flush=True)

    api = f"http://localhost:{port}/api/v1"
    status, body = get(api + "/setup/state", token)
    state = json.loads(body)
    print(f"PASS GET /api/v1/setup/state -> HTTP {status}: {body[:300]}", flush=True)

    status, body = get(api + "/restart", token, method="POST")
    print(f"PASS POST /api/v1/restart -> HTTP {status}: {body[:200]}", flush=True)
    time.sleep(2)
    if proc.poll() is not None:
        fail(f"bothouse exited with {proc.returncode} after restart (should keep running)")
    status, body = wait_http(link, 30)
    if status != 200:
        fail(f"wizard after restart: HTTP {status}")
    status, _ = get(api + "/setup/state", token)
    print(f"PASS after restart the wizard answers again (HTTP {status}) and the process is still running", flush=True)

    proc.send_signal(signal.CTRL_BREAK_EVENT)
    try:
        code = proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        fail("bothouse did not exit within 30s of Ctrl+Break")
    if code != 0:
        fail(f"exit code {code} after Ctrl+Break")
    print("PASS Ctrl+Break -> bothouse exited with code 0", flush=True)
finally:
    if proc.poll() is None:
        proc.kill()
