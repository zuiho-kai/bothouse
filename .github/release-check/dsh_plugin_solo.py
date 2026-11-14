"""The DSH plugin installed alone (ci.yml dsh-plugin-solo): no bothouse bridge, no BOTHOUSE_DATA_DIR, no gate.
Retro 2026-11-15 (#1644): every check started dsh web through the bridge, which fills in the data dir and the
gate for the plugin, so a plugin-only install shipped members with an empty memory index, a silent missing gate
and no persona in the system prompt (#1643), and nothing went red.

  1. `dsh plugin add <the npm pack tarball>` into a scratch HOME, with an env built from nothing
     (no BOTHOUSE_*, GATE_*, CC_* variables, no ~/.bothouse/config.toml)
  2. `dsh web`, open it with its login token, @ 鲸鱼娘 in the first channel (the model is a local stub)
  3. what the member sent the model: its memory index block, a system prompt with its persona
  4. the channel says the gate is missing

Every check prints PASS; the first failure prints FAIL and exits 1.

usage: dsh_plugin_solo.py --tgz <bothouse-dsh-*.tgz> --out <scratch dir>
"""
import argparse
import http.cookiejar
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

MEMBER = "鲸鱼娘"  # the member the plugin seeds into #general on first start (plugin-pkg/README.md)
MEMORY_HEAD = "（你的记忆 wiki 目录页"  # dsh/collab/memory-index.mjs MEMORY_INDEX_HEAD
PERSONA_MARK = "你的人设："  # dsh/collab/dsh-member.mjs memberSystemPrompt
GATE_NOTICE = "没连上 gate"  # dsh/collab/dsh-member.mjs turnContext, the room notice without a gate
REPLY = "CI-STUB-REPLY-solo"  # what the stub model always answers
LINK_RE = re.compile(r"dsh web: (http://127\.0\.0\.1:\d+)/\?token=(\S+)")
# SPEC (Anthropic Messages API): usage token counts are required integers; DSH only displays them
STUB_TOKENS = 1
HTTP_OK, HTTP_NOT_FOUND = 200, 404  # SPEC: HTTP status codes
# Timeouts (s), 沿用已有配置 windows_e2e.py T_INSTALL/T_IMPORT/T_REPLY/T_HTTP; T_LINK 沿用其 T_OPEN
T_INSTALL, T_LINK, T_STATE, T_REPLY, T_HTTP = 900, 300, 240, 180, 60
POLL = 1.0  # 沿用已有配置 windows_e2e.py wait(every=1.0)

ap = argparse.ArgumentParser()
ap.add_argument("--tgz", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()
out = os.path.abspath(args.out)
home, work = os.path.join(out, "home"), os.path.join(out, "work")
os.makedirs(home, exist_ok=True)
os.makedirs(work, exist_ok=True)


def fail(msg):
    print("FAIL:", msg, flush=True)
    raise SystemExit(1)


def ok(msg):
    print("PASS", msg, flush=True)


# ---- stub model (windows_e2e.py's, keeping each request body) ----
bodies = []


class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.split("?")[0].rstrip("/").endswith("/models"):
            return self._json({"data": [{"id": "deepseek-chat", "type": "model", "display_name": "stub"}], "has_more": False})
        self._json({"error": "not found"}, HTTP_NOT_FOUND)

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            body = {}
        path = self.path.split("?")[0]
        if path.endswith("/count_tokens"):
            return self._json({"input_tokens": STUB_TOKENS})
        if not path.endswith("/messages"):
            return self._json({"error": "not found"}, HTTP_NOT_FOUND)
        bodies.append(body)
        usage = {"input_tokens": STUB_TOKENS, "output_tokens": STUB_TOKENS}
        msg = {"id": "msg_stub", "type": "message", "role": "assistant", "model": body.get("model", "deepseek-chat"),
               "content": [], "stop_reason": None, "stop_sequence": None, "usage": usage}
        if not body.get("stream"):
            msg.update(content=[{"type": "text", "text": REPLY}], stop_reason="end_turn")
            return self._json(msg)
        self.send_response(HTTP_OK)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        for ev in [
            {"type": "message_start", "message": msg},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": REPLY}},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": usage},
            {"type": "message_stop"},
        ]:
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

# What an outside user's shell has: a PATH, a HOME, a locale, a DeepSeek key. Nothing from bothouse.
env = {"PATH": os.environ["PATH"], "HOME": home, "LANG": "en_US.UTF-8",
       "DEEPSEEK_API_KEY": "sk-ci-stub-not-a-key", "DEEPSEEK_BASE_URL": f"http://127.0.0.1:{stub.server_address[1]}"}

# ---- 1. install the packed plugin, as the README's command line does ----
with open(os.path.join(out, "install.log"), "w", encoding="utf-8") as log:
    r = subprocess.run(["dsh", "plugin", "--profile", "web", "add", os.path.abspath(args.tgz)], env=env, cwd=work,
                       stdout=log, stderr=subprocess.STDOUT, timeout=T_INSTALL)
if r.returncode:
    fail(f"dsh plugin add exited {r.returncode}, see {out}/install.log")
if os.path.exists(os.path.join(home, ".bothouse", "config.toml")):
    fail("the scratch HOME has a bothouse config.toml")
ok("plugin installed from the tarball into a scratch HOME, no bridge variables")

# ---- 2. dsh web, logged in with its token ----
web_log = open(os.path.join(out, "dsh-web.log"), "w", encoding="utf-8")
proc = subprocess.Popen(["dsh", "--profile", "web", "--no-open", "--port", "0"], env=env, cwd=work,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                        errors="replace", start_new_session=True)
link = []


def pump():
    for line in iter(proc.stdout.readline, ""):
        web_log.write(line)
        web_log.flush()
        m = LINK_RE.search(line)
        if m and not link:
            link.append(m)


threading.Thread(target=pump, daemon=True).start()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def call(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(link[0].group(1) + path, data=data, method="GET" if data is None else "POST")
    req.add_header("Origin", link[0].group(1))
    if data is not None:
        req.add_header("content-type", "application/json")
    try:
        with opener.open(req, timeout=T_HTTP) as resp:
            text = resp.read().decode("utf-8", "replace")
            return resp.status, (json.loads(text) if text.strip().startswith(("{", "[")) else text)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, ConnectionError):
        return 0, ""


def wait(what, fn, timeout):
    end = time.time() + timeout
    while time.time() < end:
        if proc.poll() is not None:
            fail(f"{what}: dsh web exited {proc.returncode}, see {out}/dsh-web.log")
        v = fn()
        if v:
            return v
        time.sleep(POLL)
    fail(f"{what}: not within {timeout}s, see {out}/dsh-web.log")


try:
    wait("dsh web prints its login link", lambda: bool(link), T_LINK)
    code, _ = call("/?token=" + link[0].group(2))
    if code != HTTP_OK:
        fail(f"GET /?token= -> HTTP {code}")

    def state():
        code, s = call("/collab/api/state")
        return s if code == HTTP_OK and isinstance(s, dict) and s.get("rooms") and \
            any(m.get("name") == MEMBER for m in s.get("members", [])) else None
    s = wait(f"channel plugin answers with {MEMBER} seeded", state, T_STATE)
    room = s["rooms"][0]
    ok(f"dsh web up, #{room.get('name')} has {MEMBER}")

    code, r = call(f"/collab/api/rooms/{room['id']}/messages",
                   {"text": f"@{MEMBER} 回一句话就行", "client_key": f"ci-solo-{time.time()}"})
    if code != HTTP_OK:
        fail(f"posting in #{room.get('name')} -> HTTP {code}: {str(r)[:300]}")
    after = r["message"]["id"]
    texts = []

    def answered():
        code, page = call(f"/collab/api/rooms/{room['id']}/messages?after={after}")
        if code != HTTP_OK:
            return None
        texts[:] = [m.get("text") or "" for m in page.get("messages", [])]
        return any(REPLY in t for t in texts)
    wait(f"@{MEMBER} answers", answered, T_REPLY)
    ok(f"@{MEMBER} answered in #{room.get('name')}")

    # ---- 3. what the member gave the model ----
    system = "\n".join(json.dumps(b.get("system", ""), ensure_ascii=False) for b in bodies)
    convo = "\n".join(json.dumps(b.get("messages", []), ensure_ascii=False) for b in bodies)
    if MEMORY_HEAD not in convo:
        fail(f"no memory index block ({MEMORY_HEAD}…) in what {MEMBER} sent the model: {convo[:600]}")
    ok(f"{MEMBER}'s turn carries its memory index block")
    if PERSONA_MARK not in system or MEMBER not in system:
        fail(f"the system prompt has no {MEMBER} persona ({PERSONA_MARK}): {system[:600]}")
    ok(f"the system prompt carries {MEMBER}'s persona")

    # ---- 4. the channel says the gate is missing ----
    if not any(GATE_NOTICE in t for t in texts):
        fail(f"no missing-gate notice ({GATE_NOTICE}) in #{room.get('name')}: {texts}")
    ok(f"#{room.get('name')} says the gate is missing")
finally:
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=T_HTTP)
        except subprocess.TimeoutExpired:
            proc.kill()
    web_log.close()
    with open(os.path.join(out, "model-requests.json"), "w", encoding="utf-8") as f:
        json.dump(bodies, f, ensure_ascii=False, indent=1)
