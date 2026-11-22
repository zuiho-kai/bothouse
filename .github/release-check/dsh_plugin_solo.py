"""The DSH plugin installed alone (ci.yml dsh-plugin-solo): no bothouse config, no BOTHOUSE_DATA_DIR, no gate.
Retro 2026-11-15 (#1644): every check started dsh web through the bridge, so a plugin-only install could break
and nothing went red. Since #1662 the plugin is an adapter: its members run as bothouse roles, which it sets up
(`bothouse setup apply`) and starts itself; with no bothouse it runs the official installer. Here the bothouse
built from this commit is put where that installer puts it (~/.local/bin), so the check runs this commit's bridge.

  1. `dsh plugin add <the npm pack tarball>` into a scratch HOME, with an env built from nothing
     (no BOTHOUSE_*, GATE_*, CC_* variables, no ~/.bothouse/config.toml)
  2. `dsh web`, open it with its login token: the DSH member is seeded and comes online as a bothouse role
  3. @DSH in the first channel: the role answers (the model is a local stub) and the model got the role's memory
     block (the bridge writes the memory wiki section into every role; #1798: the seeded member has no persona)
  4. #1823: the stub first runs the memory vote command each turn asks for (memvote.py, from the member's sandboxed
     shell) and passes any failure on into its reply, as a real model did; the vote lands in the gate's
     votes.jsonl and the reply has no vote/sandbox words

Every check prints PASS; the first failure prints FAIL and exits 1.

usage: dsh_plugin_solo.py --tgz <bothouse-dsh-*.tgz> --bothouse <bothouse binary> --out <scratch dir>
"""
import argparse
import glob
import hashlib
import http.cookiejar
import http.server
import json
import os
import shutil
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

MEMBER = "DSH"  # the member the plugin seeds into #general on first start (plugin-pkg/README.md, roster.mjs seedDefaults)
# The memory wiki section the bridge writes into a role (bridge/core/rolewiki.go wikiSection / leadWikiSection), any language.
MEMORY_HEADINGS = ("## 记忆 wiki", "## 記憶 wiki", "## Memory wiki")
REPLY = "CI-STUB-REPLY-solo"  # what the stub model answers
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
ap.add_argument("--bothouse", required=True)
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


# #1823: one memory line in the wiki, voted on by the stub; id = memvote.py _sha (sha1 of the line, 10 hex)
VOTE_LINE = "CI 隔离测试：仓库门牌 7319 号。"
VOTE_ID = hashlib.sha1(VOTE_LINE.encode()).hexdigest()[:10]
VOTE_CMD = f"python3 ~/.bothouse/gate/memvote.py +{VOTE_ID}"
LEAK_WORDS = ("沙盒", "投票", "sandbox", "memvote")  # what the reply must not carry (screenshot 1798/shots6/35)
REPLY_TO = "回一句话就行"  # the @ message below; the stub votes only on that turn

# ---- stub model (windows_e2e.py's, keeping each request body) ----
bodies = []


def tool_results(body):
    """the text of every tool_result in the request (Anthropic Messages API content blocks)"""
    out = []
    for m in body.get("messages") or []:
        for c in m.get("content") if isinstance(m.get("content"), list) else []:
            if isinstance(c, dict) and c.get("type") == "tool_result":
                v = c.get("content")
                out.append(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))
    return out


def shell_tool(body):
    names = [t.get("name") for t in body.get("tools") or [] if isinstance(t, dict)]
    return next((n for n in names if n in ("bash", "shell", "Bash")), None)


def stub_reply(body):
    """a tool call (name, input) on a role turn that has not run the vote yet, else the reply text"""
    results = tool_results(body)
    if not results and shell_tool(body) and REPLY_TO in json.dumps(body.get("messages"), ensure_ascii=False):
        return (shell_tool(body), {"description": "记忆投票", "command": VOTE_CMD})
    # like the real model of 1798/shots6/35: whatever the vote printed goes into the reply
    return REPLY + "".join("\n" + r for r in results)
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
        reply = stub_reply(body)
        usage = {"input_tokens": STUB_TOKENS, "output_tokens": STUB_TOKENS}
        msg = {"id": "msg_stub", "type": "message", "role": "assistant", "model": body.get("model", "deepseek-chat"),
               "content": [], "stop_reason": None, "stop_sequence": None, "usage": usage}
        if isinstance(reply, tuple):  # SPEC (Messages API): tool_use block, input streamed as input_json_delta
            name, inp = reply
            block, stop = {"type": "tool_use", "id": f"toolu_ci_{len(bodies)}", "name": name, "input": inp}, "tool_use"
            start, delta = dict(block, input={}), {"type": "input_json_delta", "partial_json": json.dumps(inp, ensure_ascii=False)}
        else:
            block, stop = {"type": "text", "text": reply}, "end_turn"
            start, delta = {"type": "text", "text": ""}, {"type": "text_delta", "text": reply}
        if not body.get("stream"):
            msg.update(content=[block], stop_reason=stop)
            return self._json(msg)
        self.send_response(HTTP_OK)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        for ev in [
            {"type": "message_start", "message": msg},
            {"type": "content_block_start", "index": 0, "content_block": start},
            {"type": "content_block_delta", "index": 0, "delta": delta},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": usage},
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
# where install.sh puts bothouse (INSTALL_DIR default ~/.local/bin), so the plugin finds this commit's build
os.makedirs(os.path.join(home, ".local", "bin"), exist_ok=True)
shutil.copy(args.bothouse, os.path.join(home, ".local", "bin", "bothouse"))

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
    def online():
        code, s = call("/collab/api/state")
        return code == HTTP_OK and any(m.get("name") == MEMBER and m.get("online") for m in s.get("members", []))
    wait(f"{MEMBER} comes online as a bothouse role (the plugin set it up and started bothouse)", online, T_INSTALL)
    ok(f"{MEMBER} is online: the plugin set up and started bothouse")
    # #1823: the line the stub votes on, in the role's own memory wiki (memvote.py looks ids up in <data>/roles/*/wiki;
    # a ~/wiki made before the install would turn the setup into the has-a-wiki one, with another memory block)
    roles = [d for d in glob.glob(os.path.join(home, ".bothouse", "roles", "*")) if os.path.isdir(d)]
    if not roles:
        fail(f"no role directory under {home}/.bothouse/roles")
    for d in roles:
        os.makedirs(os.path.join(d, "wiki"), exist_ok=True)
        with open(os.path.join(d, "wiki", "ci-solo.md"), "w", encoding="utf-8") as f:
            f.write("# CI\n\n" + VOTE_LINE + "\n")

    code, r = call(f"/collab/api/rooms/{room['id']}/messages",
                   {"text": f"@{MEMBER} {REPLY_TO}", "client_key": f"ci-solo-{time.time()}"})
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

    # ---- 3. what the role gave the model: its memory block (the bridge writes it into the role) ----
    sent = "\n".join(json.dumps([b.get("system", ""), b.get("messages", [])], ensure_ascii=False) for b in bodies)
    if not any(h in sent for h in MEMORY_HEADINGS):
        fail(f"no memory wiki block in what the role sent the model: {sent[:600]}")
    ok(f"the role's model request carries {MEMBER}'s memory wiki block")

    # ---- 4. #1823: the vote run from the member's shell landed, and nothing of it reached the reply ----
    if not any(tool_results(b) for b in bodies):
        fail(f"the stub's vote command never came back as a tool result (tools offered: "
             f"{sorted({t.get('name') for b in bodies for t in b.get('tools') or []})})")
    said = next(t for t in texts if REPLY in t)
    leaked = [w for w in LEAK_WORDS if w in said]
    if leaked:
        fail(f"{MEMBER}'s reply carries {leaked}: {said[:600]}")
    ok(f"{MEMBER}'s reply has no vote or sandbox words")
    votes = [ln for f in glob.glob(os.path.join(home, ".bothouse", "**", "votes.jsonl"), recursive=True)
             for ln in open(f, encoding="utf-8") if VOTE_ID in ln]
    if not votes:
        fail(f"no vote for #{VOTE_ID} in any votes.jsonl under {home}/.bothouse")
    ok(f"the vote for #{VOTE_ID} landed: {votes[-1].strip()[:200]}")
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
