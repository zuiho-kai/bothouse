"""End-to-end smoke of the paths a Windows user takes with bothouse + DSH (ci.yml windows-e2e,
release.yml verify-windows). Retro 2026-11-05: none of these ran anywhere, so a batch of Windows
breakages reached an outside user first.

  1. first run (no config) -> the setup wizard -> DSH route only (no bridge project):
     install the DSH plugin, configure two roles, open `dsh web`
  2. the panel through /dsh: the page renders (not blank), every script comes back as JavaScript
  3. @ a DSH member in a channel -> it answers (the model is a local stub: no key, no cost)
  4. re-run the wizard -> the member count does not change
  5. upgrade (--upgrade: a command that puts the new bothouse in place) -> start again ->
     the channel plugin loads, the member count does not change, panel and @ still work

DSH itself must be on PATH (npm i -g @deepseek-ai/dsh). Uses the real user profile, so run it on a
clean machine (a hosted runner) or with HOME/USERPROFILE pointed at a scratch folder.
Every check prints PASS; the first failure prints FAIL and exits 1.

usage: windows_e2e.py --exe <bothouse> [--upgrade "<command>"] [--out <dir>]
"""
import argparse
import http.cookiejar
import http.server
import json
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

REPLY = "CI-STUB-REPLY-7f3a"  # what the stub model always answers
# SPEC (Anthropic Messages API): usage token counts are required integers; DSH only displays them
STUB_TOKENS = 1
HTTP_OK, HTTP_NOT_FOUND = 200, 404  # SPEC: HTTP status codes
ROLES = [  # what the wizard sends for its two default rows (bridge/web/src/pages/Setup/DSHSetup.tsx save)
    {"name": "鲸鱼娘", "name_customized": False},
    {"name": "Codex", "name_customized": False, "cli": "codex"},
]
LINK_RE = re.compile(r"(http://localhost:(\d+)/login\?token=([0-9a-zA-Z]+)[^\s]*)")
# Timeouts (s). 沿用已有配置 windows_firstrun.py 60 s link; 实测 sanxin-hk 11-05 plugin install ~5 min, import ~1 min; x2 for hosted runner:
T_LINK, T_HTTP, T_INSTALL, T_OPEN, T_IMPORT, T_REPLY = 90, 60, 900, 300, 240, 180  # 沿用已有配置/实测，见上一行；T_OPEN 实测 sanxin-hk 冷启动 2 分 31 秒（4312375e）

ap = argparse.ArgumentParser()
ap.add_argument("--exe", required=True)
ap.add_argument("--upgrade", default="")
ap.add_argument("--old", action="store_true",
                help="--exe is the previous release: only set DSH up with it, run every check after --upgrade")
ap.add_argument("--out", default=".")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def fail(msg):
    print("FAIL:", msg, flush=True)
    raise SystemExit(1)


def ok(msg):
    print("PASS", msg, flush=True)


# ---- stub model: DSH's DeepSeek provider speaks the Anthropic Messages API at $DEEPSEEK_BASE_URL ----
stub_calls = []


class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _body(self):
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        stub_calls.append(("GET", self.path))
        if self.path.split("?")[0].rstrip("/").endswith("/models"):
            return self._json({"data": [{"id": "deepseek-chat", "type": "model", "display_name": "stub"}], "has_more": False})
        self._json({"error": "not found"}, HTTP_NOT_FOUND)

    def do_POST(self):
        body = self._body()
        stub_calls.append(("POST", self.path))
        path = self.path.split("?")[0]
        if path.endswith("/count_tokens"):
            return self._json({"input_tokens": STUB_TOKENS})
        if not path.endswith("/messages"):
            return self._json({"error": "not found"}, HTTP_NOT_FOUND)
        usage = {"input_tokens": STUB_TOKENS, "output_tokens": STUB_TOKENS}
        msg = {"id": "msg_stub", "type": "message", "role": "assistant", "model": body.get("model", "deepseek-chat"),
               "content": [], "stop_reason": None, "stop_sequence": None, "usage": usage}
        if not body.get("stream"):
            msg.update(content=[{"type": "text", "text": REPLY}], stop_reason="end_turn")
            return self._json(msg)
        self.send_response(HTTP_OK)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.end_headers()
        events = [
            {"type": "message_start", "message": msg},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": REPLY}},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": usage},
            {"type": "message_stop"},
        ]
        for ev in events:
            self.wfile.write(f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n".encode())
            self.wfile.flush()

    def _json(self, obj, code=HTTP_OK):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


stub = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=stub.serve_forever, daemon=True).start()
os.environ["DEEPSEEK_BASE_URL"] = f"http://127.0.0.1:{stub.server_address[1]}"
print("stub model at", os.environ["DEEPSEEK_BASE_URL"], flush=True)


# ---- bothouse process ----
class Bothouse:
    def __init__(self, n):
        self.lines = queue.Queue()
        self.log = open(os.path.join(args.out, f"bothouse-{n}.log"), "w", encoding="utf-8")
        kw = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
        self.proc = subprocess.Popen([args.exe], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                     encoding="utf-8", errors="replace", **kw)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in iter(self.proc.stdout.readline, ""):
            self.log.write(line)
            self.log.flush()
            self.lines.put(line)

    def wait_line(self, pattern, timeout):
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = self.lines.get(timeout=max(0.1, end - time.time()))
            except queue.Empty:
                if self.proc.poll() is not None:
                    break
                continue
            m = pattern.search(line)
            if m:
                return m
        return None

    def stop(self):
        if self.proc.poll() is None:
            self.proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
            try:
                self.proc.wait(timeout=T_HTTP)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.log.close()


class Panel:
    """The management server as the browser sees it: token login, then the /dsh cookie."""

    def __init__(self, port, token):
        self.base = f"http://localhost:{port}"
        self.token = token
        self.dsh_log = ""
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def req(self, method, path, body=None, auth=True, timeout=T_HTTP, raw=False):
        data = None if body is None else json.dumps(body).encode()
        r = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            r.add_header("content-type", "application/json")
        if auth:
            r.add_header("Authorization", "Bearer " + self.token)
        r.add_header("Origin", self.base)
        try:
            with self.op.open(r, timeout=timeout) as resp:
                b = resp.read()
                return resp.status, resp.headers, (b if raw else b.decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            b = e.read()
            return e.code, e.headers, (b if raw else b.decode("utf-8", "replace"))

    def api(self, method, path, body=None, timeout=T_HTTP):
        code, _, text = self.req(method, "/api/v1" + path, body, timeout=timeout)
        if code != HTTP_OK:
            fail(f"{method} /api/v1{path} -> HTTP {code}: {text[:400]}")
        res = json.loads(text) if text.strip() else {}
        return res.get("data", res) if isinstance(res, dict) else res  # management replies {"ok", "data"}

    def collab(self, method, path, body=None):
        code, _, text = self.req(method, "/dsh" + path, body, auth=False)
        return code, (json.loads(text) if text.strip().startswith(("{", "[")) else text)

    def login_dsh(self, label):
        code, _, _ = self.req("GET", "/dsh/?token=" + urllib.parse.quote(self.token), auth=False)
        if code != HTTP_OK:
            fail(f"{label}: GET /dsh/?token= -> HTTP {code}")


def diagnose(p, room, member, after):
    """What a failed @ left behind: the member's state, the channel after the prompt, the dsh web log."""
    s = state(p) or {}
    print("member:", json.dumps(next((m for m in s.get("members", []) if m.get("id") == member["id"]), {}), ensure_ascii=False)[:800])
    c, page = p.collab("GET", f"/collab/api/rooms/{room['id']}/messages?after={after - 1}")
    for m in (page.get("messages", []) if isinstance(page, dict) else []):
        print("  msg", m.get("author_kind"), m.get("name"), repr((m.get("text") or "")[:300]))
    print("stub model calls:", stub_calls[-10:])
    if p.dsh_log and os.path.exists(p.dsh_log):
        with open(p.dsh_log, encoding="utf-8", errors="replace") as f:
            tail = f.readlines()[-60:]
        print("dsh web log tail:", p.dsh_log)
        for line in tail:
            print("  |", line.rstrip())


def wait(what, fn, timeout, every=1.0, on_fail=None):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
            last = v
        except (urllib.error.URLError, OSError, ValueError) as e:
            last = e
        time.sleep(every)
    if on_fail:
        on_fail()
    fail(f"{what}: not within {timeout}s (last: {str(last)[:300]})")


def start(n):
    bh = Bothouse(n)
    m = bh.wait_line(LINK_RE, T_LINK)
    if not m:
        bh.stop()
        fail(f"start {n}: no panel/wizard link printed within {T_LINK}s (log {bh.log.name})")
    p = Panel(m.group(2), m.group(3))
    wait("panel answers", lambda: p.req("GET", "/api/v1/setup/state")[0] == HTTP_OK, T_HTTP)
    ok(f"start {n}: bothouse up at {p.base}")
    return bh, p


def install(p):
    code, _, text = p.req("POST", "/api/v1/setup/dsh/install", {"lang": "zh"}, timeout=T_INSTALL)
    events = [json.loads(l) for l in text.splitlines() if l.strip()]
    last = events[-1] if events else {}
    if code != HTTP_OK or not last.get("done"):
        fail(f"DSH plugin install: HTTP {code}: {json.dumps(last, ensure_ascii=False)[:1500]}")
    ok(f"wizard installed the DSH plugin ({len(events)} progress lines)")


def open_dsh(p, label):
    """POST /setup/dsh/open the way the wizard does (DSHSetup.tsx open): ask again every second while it
    answers starting:true (since v0.1.51 it does not wait for a cold dsh web)."""
    end = time.time() + T_OPEN
    web = p.api("POST", "/setup/dsh/open", {}, timeout=T_OPEN)
    while web.get("starting"):
        if time.time() > end:
            fail(f"{label}: dsh web still starting after {T_OPEN}s: {web.get('log_tail', '')[:300]}")
        time.sleep(1)  # the wizard's own interval (DSHSetup.tsx)
        web = p.api("POST", "/setup/dsh/open", {}, timeout=T_OPEN)
    p.dsh_log = web.get("log") or p.dsh_log
    return web


def configure_and_open(p, label):
    res = p.api("POST", "/setup/dsh/configure", {"deepseek_api_key": "sk-ci-stub-not-a-key", "members": ROLES})
    if res.get("members") != len(ROLES):
        fail(f"{label}: configure saved {res}")
    web = open_dsh(p, label)
    ok(f"{label}: wizard configured {len(ROLES)} roles and opened dsh web (pid {web.get('pid')})")
    p.login_dsh(label)


def state(p):
    code, s = p.collab("GET", "/collab/api/state")
    return s if code == HTTP_OK and isinstance(s, dict) and isinstance(s.get("members"), list) else None


def roster(p, label):
    want = {r["name"] for r in ROLES}

    def imported():
        s = state(p)
        return s if s and want <= {m.get("name") for m in s["members"]} else None
    s = wait(f"{label}: wizard roles in the DSH roster", imported, T_IMPORT, 2)
    names = sorted(m.get("name") for m in s["members"])
    dup = [n for n in names if re.search(r"-\d+$", n)]
    if dup:
        fail(f"{label}: numbered duplicates in the roster: {names}")
    ok(f"{label}: channel plugin answers, roster {names}")
    return names, s


def panel_page(p, label):
    code, _, html = p.req("GET", "/dsh/collab/panel/", auth=False)
    if code != HTTP_OK or "<html" not in html.lower():
        fail(f"{label}: /dsh/collab/panel/ -> HTTP {code}, starts {html[:200]!r}")
    srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
    if not srcs:
        fail(f"{label}: panel HTML has no script")
    for s in srcs:
        path = urllib.parse.urljoin("/dsh/collab/panel/", s)
        c, h, body = p.req("GET", path, auth=False, raw=True)
        ctype = (h.get("content-type") or "").lower()
        if c != HTTP_OK or "javascript" not in ctype or body.lstrip()[:1] == b"<":
            fail(f"{label}: panel script {path} -> HTTP {c}, content-type {ctype!r} (the blank-panel bug)")
    ok(f"{label}: panel HTML + {len(srcs)} script(s) served as JavaScript")
    render(p, label)


def render(p, label):
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("SKIP render check: playwright is not installed", flush=True)
        return
    shot = os.path.join(args.out, f"panel-{label}.png")
    with sync_playwright() as pw:
        try:
            b = pw.chromium.launch(channel="chrome")  # hosted Windows runners ship Chrome
        except Exception:
            b = pw.chromium.launch()
        pg = b.new_page(locale="zh-CN")
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(p.base + "/dsh/?token=" + urllib.parse.quote(p.token), wait_until="load")
        pg.goto(p.base + "/dsh/collab/panel/", wait_until="load")
        try:
            pg.wait_for_function("(document.getElementById('root')?.innerText || '').trim().length > 0",
                                 timeout=T_HTTP * 1000)
        except Exception:
            pass
        text = pg.evaluate("(document.getElementById('root')?.innerText || '').trim()")
        pg.screenshot(path=shot)
        b.close()
    if not text:
        fail(f"{label}: panel rendered blank (page errors {errs[:3]}) — screenshot {shot}")
    ok(f"{label}: panel renders ({len(text)} chars of text, screenshot {shot})")


def mention(p, s, label):
    rooms = s.get("rooms") or []
    if not rooms:
        fail(f"{label}: no channel in the collab state")
    room = rooms[0]
    fish = next(m for m in s["members"] if m.get("name") == ROLES[0]["name"])
    code, r = p.collab("POST", f"/collab/api/rooms/{room['id']}/messages",
                       {"text": f"@{fish['name']} 回一句话就行", "client_key": f"ci-{label}-{time.time()}"})
    if code != HTTP_OK:
        fail(f"{label}: posting in #{room.get('name')} -> HTTP {code}: {str(r)[:300]}")
    after = r["message"]["id"]

    def answered():
        c, page = p.collab("GET", f"/collab/api/rooms/{room['id']}/messages?after={after}")
        if c != HTTP_OK:
            return None
        for m in page.get("messages", []):
            text = m.get("text") or ""
            if REPLY in text:
                return m
            failed = m.get("author") == fish["id"] or m.get("author_kind") == "system"
            if failed and re.search(r"reading '|TypeError|Error:|出错了", text):
                diagnose(p, room, fish, after)
                fail(f"{label}: @{fish['name']} got an error instead of an answer: {text[:300]}")
        return None
    m = wait(f"{label}: @{fish['name']} answers", answered, T_REPLY, 2, on_fail=lambda: diagnose(p, room, fish, after))
    ok(f"{label}: @{fish['name']} answered in #{room.get('name')}: {m.get('text', '')[:60]!r}")


# ---- the run ----
def full_checks(p, label):
    """first wizard (or the one after an upgrade) -> panel -> @ -> re-run -> roster unchanged"""
    configure_and_open(p, label)
    names, s = roster(p, label)
    panel_page(p, label)
    mention(p, s, label)
    configure_and_open(p, f"{label}: wizard re-run")
    again, _ = roster(p, f"{label}: wizard re-run")
    if again != names:
        fail(f"{label}: wizard re-run changed the roster: {names} -> {again}")
    ok(f"{label}: wizard re-run kept the roster ({len(again)} members)")
    return names


bh, p = start(1)
try:
    install(p)
    if args.old:
        configure_and_open(p, "previous release")
        names1, _ = roster(p, "previous release")
    else:
        names1 = full_checks(p, "first-wizard")
finally:
    bh.stop()

if args.upgrade:
    print("upgrade:", args.upgrade, flush=True)
    cmd = (["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", args.upgrade] if os.name == "nt"
           else ["sh", "-c", args.upgrade])
    # Windows PowerShell 5 started from pwsh 7 inherits pwsh's PSModulePath and then cannot load
    # its own Microsoft.PowerShell.Utility (Get-FileHash missing). A user runs install.ps1 from a
    # clean shell, so drop it here to match.
    env = {k: v for k, v in os.environ.items() if k.upper() != "PSMODULEPATH"}
    if subprocess.call(cmd, env=env) != 0:
        fail("upgrade command failed")
    ok("upgrade command finished")

after = "after-upgrade" if args.upgrade else "after-restart"
bh, p = start(2)
try:
    web = open_dsh(p, after)
    ok(f"{after}: dsh web (pid {web.get('pid')})")
    p.login_dsh(after)
    names2, s = roster(p, after)
    if names2 != names1:
        fail(f"{after}: the roster changed: {names1} -> {names2}")
    ok(f"{after}: channel plugin loads, roster kept ({len(names2)} members)")
    if args.old:
        full_checks(p, after)
    else:
        panel_page(p, after)
        mention(p, s, after)
finally:
    bh.stop()
    if p.dsh_log and os.path.exists(p.dsh_log):
        import shutil
        shutil.copy(p.dsh_log, os.path.join(args.out, "dsh-web.log"))
    print("stub model calls:", len(stub_calls), sorted({path for _, path in stub_calls}), flush=True)
print("ALL PASS", flush=True)
