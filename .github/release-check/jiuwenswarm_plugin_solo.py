"""The JiuwenSwarm plugin installed alone (ci.yml jiuwenswarm-plugin-solo): a pip-installed workswarm, a scratch
HOME with no bothouse in it, the one install command of jiuwenswarm/plugin-pkg/README.md, one chat against a
stub model that keeps every request body.

  0. files.txt (what the curl install downloads) lists every file of bridge/contrib/wiki/template
  1. the venv's target file is the one the patch was made for (sha256 in patches/jiuwenswarm/manifest.json)
  2. leg "installed": install.sh patches workswarm and makes the default role; the chat answers, and the persona
     and the memory wiki section are in the system message, not in the user's message
  3. leg "mismatch": the target file is not the recorded one (a comment line added); install.sh says it skipped
     the patch and leaves the file byte for byte as it was; the chat still answers, and the persona and the
     memory wiki section are in front of the user's message

Every check prints PASS; the first failure prints FAIL and exits 1. The venv's target file is put back as it was.
POSIX only (process groups, ps).

usage: jiuwenswarm_plugin_solo.py --venv <venv with workswarm in it> --out <scratch dir>
"""
import argparse
import hashlib
import http.server
import json
import os
import re
import signal
import socket
import subprocess
import threading
import time

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PKG = os.path.join(REPO, "jiuwenswarm", "plugin-pkg")
TEMPLATE = "bridge/contrib/wiki/template"
VERSION = "0.2.8"  # the workswarm version the patch is made for (patches/jiuwenswarm/manifest.json)
PERSONA, WIKI = "# 角色：橘", "## 记忆 wiki"  # install.py SEED_PERSONA / SEED_WIKI, their first lines
REPLY = "CI-STUB-REPLY-jw"  # what the stub model answers
PROMPT = "你好，报一下名字"
STUB_TOKENS = 1  # SPEC (OpenAI chat completions): usage token counts are integers; nothing here reads them
EMBED_DIM = 8  # 实测: the manual run's stub answered embeddings with 8 zeros (jwsw-plugin-dev HANDOFF-3); nothing reads them
# Timeouts (s). 实测: the manual run (jwsw-plugin-dev HANDOFF-3) gave init and chat 110 and stop 60.
# 沿用已有配置: T_INSTALL and T_UP = dsh_plugin_solo.py T_INSTALL and T_LINK; T_EXIT = install.py stop_worker wait.
T_INIT, T_INSTALL, T_UP, T_CHAT, T_STOP, T_EXIT = 110, 900, 300, 110, 60, 15
POLL = 1.0  # 沿用已有配置 dsh_plugin_solo.py POLL

ap = argparse.ArgumentParser()
ap.add_argument("--venv", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()
# realpath: JiuwenSwarm resolves its data directory (macOS /tmp -> /private/tmp), and paths are compared below
out = os.path.realpath(args.out)
venv_bin = os.path.join(os.path.abspath(args.venv), "bin")
os.makedirs(out, exist_ok=True)


def fail(msg):
    print("FAIL:", msg, flush=True)
    raise SystemExit(1)


def ok(msg):
    print("PASS", msg, flush=True)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, "rb") as f:
        return f.read()


def write(path, data):
    with open(path, "wb") as f:
        f.write(data)


# ---- 0. files.txt: a template file the bridge adds must also be downloaded by the curl install ----
with open(os.path.join(PKG, "files.txt"), encoding="utf-8") as f:
    listed = {line.strip() for line in f if line.strip()}
template = []
for top, _, names in os.walk(os.path.join(REPO, TEMPLATE)):
    template += [os.path.relpath(os.path.join(top, n), REPO).replace(os.sep, "/") for n in names]
# SOURCE says where the template came from; setup_wiki.py does not read it
template = [p for p in template if p != TEMPLATE + "/SOURCE"]
missing = sorted(p for p in template if p not in listed)
if missing or not template:
    fail(f"jiuwenswarm/plugin-pkg/files.txt does not list these files of {TEMPLATE}: {missing}")
ok(f"files.txt lists the {len(template)} files of {TEMPLATE}")

# ---- 1. the venv has the file the patch was made for ----
with open(os.path.join(REPO, "patches", "jiuwenswarm", "manifest.json"), encoding="utf-8") as f:
    entry = json.load(f)["workswarm"][VERSION][0]
found = subprocess.run([os.path.join(venv_bin, "python"), "-c",
                        "import importlib.metadata as m, jiuwenswarm, os;"
                        "print(m.version('workswarm'));"
                        "print(os.path.dirname(os.path.dirname(os.path.realpath(jiuwenswarm.__file__))))"],
                       capture_output=True, text=True, timeout=T_CHAT)
if found.returncode:
    fail(f"no workswarm in {args.venv}: {found.stderr.strip()}")
version, site = found.stdout.splitlines()
if version != VERSION:
    fail(f"{args.venv} has workswarm {version}, this check is for {VERSION}")
target = os.path.join(site, entry["file"])
original = read(target)
if sha256(original) != entry["sha256"]:
    fail(f"{target} is not the file workswarm {VERSION} ships: sha256 {sha256(original)}, manifest {entry['sha256']}")
ok(f"workswarm {VERSION}, target file sha256 = manifest sha256 ({entry['sha256']})")

# ---- stub model (OpenAI-compatible), keeping each request body ----
bodies = []


class Stub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self._json({"object": "list", "data": [{"id": "stub-model", "object": "model"}]})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            body = {}
        bodies.append({"path": self.path, "body": body})
        model = body.get("model", "stub-model")
        usage = {"prompt_tokens": STUB_TOKENS, "completion_tokens": STUB_TOKENS, "total_tokens": STUB_TOKENS + STUB_TOKENS}
        if "embeddings" in self.path:
            return self._json({"object": "list", "model": model, "usage": usage,
                               "data": [{"object": "embedding", "index": 0, "embedding": [0.0] * EMBED_DIM}]})
        if not body.get("stream"):
            return self._json({"id": "chatcmpl-stub", "object": "chat.completion", "created": 0, "model": model, "usage": usage,
                               "choices": [{"index": 0, "message": {"role": "assistant", "content": REPLY}, "finish_reason": "stop"}]})
        self.send_response(http.HTTPStatus.OK)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        for delta, finish in (({"role": "assistant", "content": ""}, None), ({"content": REPLY}, None), ({}, "stop")):
            chunk = {"id": "chatcmpl-stub", "object": "chat.completion.chunk", "created": 0, "model": model,
                     "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            if finish:
                chunk["usage"] = usage
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def _json(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(http.HTTPStatus.OK)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


stub = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=stub.serve_forever, daemon=True).start()


def free_ports():
    """JiuwenSwarm's port group, all free right now: frontend, web, gateway, browser MCP, agent, agent HTTP.
    The agent's HTTP port is its WebSocket port + 1 (common/client/agent_http_bridge.py)."""
    def bind(port):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            s.close()
            return None
        return s
    held = [bind(0) for _ in ("frontend", "web", "gateway", "browser")]
    while True:
        agent = bind(0)
        agent_http = bind(agent.getsockname()[1] + 1)
        if agent_http:
            break
        agent.close()
    held += [agent, agent_http]
    ports = [s.getsockname()[1] for s in held]
    for s in held:
        s.close()
    return ports


def set_env_file(path, pairs):
    """Set keys in JiuwenSwarm's config/.env (jiuwenswarm-init wrote it)."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for key, value in pairs.items():
        line = f"{key}={value}"
        if re.search(rf"^{key}=.*$", text, flags=re.M):
            text = re.sub(rf"^{key}=.*$", lambda m: line, text, flags=re.M)
        else:
            text += f"\n{line}\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def left_running(home):
    """pids of processes started with this leg's HOME (the service's children and the resident Worker)."""
    pids = []
    if os.path.isdir("/proc/self"):  # Linux: the environment and command line of each process
        for pid in filter(str.isdigit, os.listdir("/proc")):
            try:
                seen = read(f"/proc/{pid}/environ") + b"\0" + read(f"/proc/{pid}/cmdline")
            except OSError:
                continue
            if home.encode() in seen:
                pids.append(int(pid))
    else:  # macOS: BSD ps, e = the environment after the command
        listing = subprocess.run(["ps", "axeww", "-o", "pid=,command="], capture_output=True, text=True, errors="replace").stdout
        pids = [int(line.split()[0]) for line in listing.splitlines() if home in line]
    return [p for p in pids if p != os.getpid()]


def text_of(message):
    c = message.get("content")
    if isinstance(c, list):
        return "".join(p.get("text", "") for p in c if isinstance(p, dict))
    return c if isinstance(c, str) else ""


def typed(user):
    """What the user typed, as JiuwenSwarm hands it to the model: 0.2.8 wraps it in a one-line JSON object
    ({"source": .., "content": <the message>, ..}) after its own notes. No such line = the text as it is."""
    for line in user.splitlines():
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("content"), str):
            return obj["content"]
    return user


def leg(name, changed):
    """One scratch HOME: init, install, start, chat. changed = bytes the target file is given before the install
    (None = the file workswarm ships). Returns what the chat sent the model (system text, user text) and the
    text of the role's persona file."""
    top = os.path.join(out, name)
    home, work = os.path.join(top, "home"), os.path.join(top, "work")
    os.makedirs(home)
    os.makedirs(work)
    frontend, web, gateway, browser, agent, agent_http = free_ports()
    # What a user's shell has: a PATH with JiuwenSwarm on it, a HOME, a locale. Nothing from bothouse. The ports
    # go in under both names JiuwenSwarm reads (instance_manager/config.py: JIUWENSWARM_*_PORT and *_PORT).
    ports = {"FRONTEND_PORT": frontend, "WEB_PORT": web, "GATEWAY_PORT": gateway, "AGENT_SERVER_PORT": agent}
    env = {"PATH": venv_bin + os.pathsep + os.environ["PATH"], "HOME": home, "LANG": "en_US.UTF-8",
           "AGENT_PORT": str(agent), "JIUWENSWARM_AGENT_HTTP_PORT": str(agent_http), "BROWSER_RUNTIME_MCP_PORT": str(browser)}
    for key, port in ports.items():
        env[key] = env["JIUWENSWARM_" + key] = str(port)

    def run(cmd, log, timeout):
        with open(os.path.join(top, log), "w", encoding="utf-8") as f:
            try:
                return subprocess.run(cmd, env=env, cwd=work, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT, timeout=timeout).returncode
            except subprocess.TimeoutExpired:
                return f"no exit within {timeout}s"

    del bodies[:]
    service = None
    try:
        rc = run(["jiuwenswarm-init"], "init.log", T_INIT)
        if rc:
            fail(f"[{name}] jiuwenswarm-init: {rc}, see {top}/init.log")
        if changed is not None:
            write(target, changed)
        before = read(target)

        # the README's one command, from this checkout
        rc = run(["sh", os.path.join(PKG, "install.sh")], "install.log", T_INSTALL)
        with open(os.path.join(top, "install.log"), encoding="utf-8") as f:
            said = f.read()
        if rc:
            fail(f"[{name}] install.sh: {rc}: {said}")
        after = read(target)
        if changed is None:
            if "补丁已打：" not in said or sha256(after) != entry["patched_sha256"]:
                fail(f"[{name}] the patch is not in (target sha256 {sha256(after)}): {said}")
            ok(f"[{name}] install.sh patched workswarm {VERSION}: target sha256 = manifest patched_sha256 ({sha256(after)})")
        else:
            if "补丁跳过：" not in said or "JiuwenSwarm 的文件没有动" not in said or "补丁已打" in said:
                fail(f"[{name}] install.sh did not say it skipped the patch: {said}")
            if after != before:
                fail(f"[{name}] install.sh changed the target file it said it left alone (sha256 {sha256(before)} -> {sha256(after)})")
            skip = [line for line in said.splitlines() if "补丁跳过：" in line][0]
            ok(f"[{name}] install.sh skipped the patch and the target file is byte for byte as before (sha256 {sha256(after)}): {skip}")
        role = os.path.join(home, ".jiuwenswarm", "bothouse", "roles", "jiuwenswarm")
        if not os.path.isfile(os.path.join(role, "wiki", "config.json")):
            fail(f"[{name}] no default role with a memory wiki under {role}: {said}")
        role_text = read(os.path.join(role, "AGENTS.md")).decode("utf-8").strip()
        if not role_text.startswith(PERSONA) or WIKI not in role_text or os.path.join(role, "wiki") not in role_text:
            fail(f"[{name}] {role}/AGENTS.md is not the persona plus the wiki section: {role_text}")
        ok(f"[{name}] default role made: persona and memory wiki under ~/{os.path.relpath(role, home)}")

        set_env_file(os.path.join(home, ".jiuwenswarm", "config", ".env"), {
            "API_BASE": f'"http://127.0.0.1:{stub.server_address[1]}/v1"', "API_KEY": '"sk-ci-stub-not-a-key"',
            "MODEL_NAME": '"stub-model"', "MODEL_PROVIDER": "OpenAI", "BROWSER_RUNTIME_MCP_ENABLED": "0",
            "BROWSER_RUNTIME_MCP_PORT": browser, **ports})
        with open(os.path.join(top, "start.log"), "w", encoding="utf-8") as start_log:
            service = subprocess.Popen(["jiuwenswarm-start"], env=env, cwd=work, stdin=subprocess.DEVNULL, stdout=start_log,
                                       stderr=subprocess.STDOUT, start_new_session=True)
        end, tries, answer = time.time() + T_UP, 0, None
        while answer is None:
            tries += 1
            with open(os.path.join(top, "chat.err"), "w", encoding="utf-8") as err:
                try:
                    chat = subprocess.run(["jiuwenswarm", "chat", "--mode", "agent", "--json", PROMPT], env=env, cwd=work, stdin=subprocess.DEVNULL,
                                          stdout=subprocess.PIPE, stderr=err, text=True, encoding="utf-8", timeout=T_CHAT)
                except subprocess.TimeoutExpired:
                    fail(f"[{name}] jiuwenswarm chat: no exit within {T_CHAT}s, see {top}/start.log")
            if chat.returncode == 0:
                answer = chat.stdout.strip()
            elif service.poll() is not None:
                fail(f"[{name}] jiuwenswarm-start exited {service.returncode}, see {top}/start.log")
            elif time.time() > end:
                fail(f"[{name}] jiuwenswarm chat still exits {chat.returncode} after {T_UP}s, see {top}/chat.err and start.log")
            else:
                time.sleep(POLL)  # the gateway is not up yet (`jiuwenswarm chat` exits 3: Cannot connect)
        try:
            got = json.loads(answer.splitlines()[-1])
        except (ValueError, IndexError):
            got = {}
        if got.get("ok") is not True or got.get("content") != REPLY:
            fail(f"[{name}] jiuwenswarm chat did not print the stub's reply: {answer}")
        ok(f"[{name}] JiuwenSwarm started and answered {answer.splitlines()[-1]} (chat try {tries})")
        if read(target) != after:
            fail(f"[{name}] the target file changed while JiuwenSwarm ran")

        # the model request of this chat: the one whose user message has the prompt
        asked = [b["body"] for b in bodies
                 if any(m.get("role") == "user" and PROMPT in text_of(m) for m in b["body"].get("messages", []))]
        if not asked:
            fail(f"[{name}] no model request carries the prompt ({len(bodies)} requests)")
        system = "\n".join(text_of(m) for m in asked[-1]["messages"] if m.get("role") == "system")
        user = "\n".join(text_of(m) for m in asked[-1]["messages"] if m.get("role") == "user")
        return system, user, role_text
    finally:
        with open(os.path.join(top, "model-requests.json"), "w", encoding="utf-8") as f:
            json.dump(bodies, f, ensure_ascii=False, indent=1)
        if service is not None:
            run(["jiuwenswarm-start", "--stop", "default"], "stop.log", T_STOP)
            try:
                os.killpg(service.pid, signal.SIGTERM)
                service.wait(timeout=T_EXIT)
            except (OSError, subprocess.TimeoutExpired):
                pass  # already gone (macOS: EPERM for a group whose only member has exited and is not reaped yet)
        # The resident Worker outlives the service and ignores SIGTERM (install.py stop_worker); it and anything
        # else started with this HOME is killed.
        for pid in left_running(home):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        end = time.time() + T_EXIT
        while left_running(home) and time.time() < end:
            time.sleep(POLL)
        print(f"[{name}] processes left with this HOME: {left_running(home) or 'none'}", flush=True)


try:
    # ---- 2. installed: persona and memory in the system prompt ----
    system, user, role_text = leg("installed", None)
    if role_text not in system:
        fail(f"[installed] the system message does not carry the role's persona file (persona at {system.find(PERSONA)}, "
             f"wiki section at {system.find(WIKI)}, {len(system)} chars)")
    if PERSONA in user or WIKI in user:
        fail(f"[installed] the persona or the wiki section is in the user's message: {user}")
    ok(f"[installed] system message carries the persona (at {system.find(PERSONA)}) and the memory wiki section "
       f"(at {system.find(WIKI)}); the user's message has neither")

    # ---- 3. mismatch: nothing patched, persona and memory in front of the user's message ----
    system, user, role_text = leg("mismatch", original + b"\r\n# jiuwenswarm_plugin_solo.py: not the file the patch was made for\r\n")
    message = typed(user)
    if message != role_text + "\n\n" + PROMPT:
        fail(f"[mismatch] the user's message is not the role's persona file, a blank line, the prompt: {user}")
    if PERSONA in system or WIKI in system:
        fail(f"[mismatch] the persona or the wiki section is in the system message of an unpatched JiuwenSwarm "
             f"(persona at {system.find(PERSONA)}, wiki section at {system.find(WIKI)})")
    ok(f"[mismatch] user's message starts with the persona (at {message.find(PERSONA)}), then the memory wiki section "
       f"(at {message.find(WIKI)}), then the prompt (at {message.find(PROMPT)}); the system message has neither")
finally:
    write(target, original)
    print(f"target file put back: sha256 {sha256(read(target))}", flush=True)
