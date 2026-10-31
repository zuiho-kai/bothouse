#!/usr/bin/env python3
"""QQ group gate with an optional judging model.

cc-connect gate protocol (core/gate.go): the engine POSTs every user message to /decide
({session_key, content, mentioned, last_reply_age_s, addressed_other, ...}) and expects
{"action": "reply"|"silent", "reason": "...", "tier": "chat"}. "silent" messages are buffered
and handed over with the next reply, so staying quiet does not mean not seeing them.

Rules, in order:
  - request for another bot (gate_url ?bot=)  -> silent (one gate serves one role)
  - private chat (qq:{uid})                 -> reply
  - @-mentioned, or one of `names` in text  -> reply (no model needed)
  - another bot was addressed               -> silent
  - judge off / not configured              -> silent
  - judge says reply (and cooldown passed)  -> reply
  - judge says no, invalid output, timeout,
    or any error                            -> silent (conservative)

Context and cooldown are kept per (bot, session_key), never shared between bots or sessions.
Invalid numeric settings stop the gate at startup (ValueError) instead of being guessed.

Judge modes (config "judge.mode"):
  off     default; only addressed messages get a reply
  openai  any OpenAI-compatible /chat/completions: a self-hosted server (no key) or a remote
          API (key read from the env var named in api_key_env, never from the config file)
  url     a self-hosted custom endpoint: POST {prompt, text, group, recent} -> {"reply": bool}
          or {"action": "reply"|"silent"}

Verdicts are parsed strictly: the body (or a chat completion's whole content) must be one JSON object
with no duplicate keys and exactly one of a boolean "reply" or "action" in {"reply", "silent"}.
Anything else (prose around the JSON, both keys, a repeated key) is unclear -> silent.

Standard library only. Usage: QQ_GATE_CONFIG=gate.json python3 gate.py
then set gate_url = "http://127.0.0.1:13013/decide" for the QQ project.
"""
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# source: follows contrib/gate/scorer_remote.py TIMEOUT_S; must beat the engine's gate_timeout_ms default 3000.
DEFAULT_TIMEOUT_S = 2.5
# source: follows the earlier QQ gate prototype (last 8 messages as context, 20 tokens for {"reply": ...}).
DEFAULT_CONTEXT = 8
DEFAULT_MAX_TOKENS = 20
# source: follows the earlier QQ gate prototype's port.
DEFAULT_PORT = 13013

DEFAULT_PROMPT = (
    "You decide whether a chat bot should join a group conversation. "
    "Answer reply=true only when the new message asks the bot something, continues a topic "
    "the bot was part of, or clearly invites anyone to answer. Small talk between other "
    "people, messages addressed to someone else and reactions need no reply. "
    'Answer with JSON only: {"reply": true} or {"reply": false}.'
)



def _no_dup_keys(pairs):
    obj = {}
    for k, v in pairs:
        if k in obj:  # {"reply": true, "reply": false}: json.loads would silently keep the last one
            raise ValueError("duplicate key %r" % k)
        obj[k] = v
    return obj


def strict_json(raw):
    """json.loads that rejects duplicate keys and non-standard NaN/Infinity."""
    def bad_const(name):
        raise ValueError("non-standard constant %s" % name)
    return json.loads(raw, object_pairs_hook=_no_dup_keys, parse_constant=bad_const)


def _number(cfg, key, default, kind, minimum, allow_zero=False):
    """Config entry check: a positive number (or >= 0 with allow_zero). Booleans and strings are refused."""
    v = cfg.get(key)
    if v is None:
        return default
    ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if ok and kind is int:
        ok = float(v).is_integer()
    if not ok or v < minimum or (v == 0 and not allow_zero):
        raise ValueError("config %s must be %s, got %r" % (
            key, ("an integer" if kind is int else "a number") + (" >= 0" if allow_zero else " > 0"), v))
    return kind(v)


def load_config(path):
    """Missing or broken config means judge off; the gate itself still answers."""
    if not path:
        return {}
    try:
        cfg = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def parse_session(key):
    """qq:{uid} private; qq:g:{gid} shared group; qq:{gid}:{uid} per-user group."""
    parts = str(key or "").split(":")
    if len(parts) == 2 and parts[0] == "qq" and parts[1] != "g":
        return "private", parts[1]
    if len(parts) >= 3 and parts[1] == "g":
        return "group", parts[2]
    if len(parts) >= 3:
        return "group", parts[1]
    return "group", "0"


def _verdict_of(obj):
    """{"reply": bool} or {"action": "reply"|"silent"}; both keys, or a wrong type/value -> None."""
    if not isinstance(obj, dict) or ("reply" in obj) == ("action" in obj):
        return None
    if "reply" in obj:
        return obj["reply"] if isinstance(obj["reply"], bool) else None
    return {"reply": True, "silent": False}.get(obj["action"]) if isinstance(obj["action"], str) else None


def parse_verdict(obj):
    """A custom endpoint's verdict object, or a chat completion whose whole content is one."""
    if not isinstance(obj, dict):
        return None
    if "choices" not in obj:
        return _verdict_of(obj)
    try:
        content = obj["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None
    if not isinstance(content, str):
        return None
    try:
        return _verdict_of(strict_json(content.strip()))
    except ValueError:  # prose, two objects, duplicate keys, truncated output
        return None


class Judge:
    """Optional model. ask() returns True / False, or None when it can't tell."""

    def __init__(self, cfg, opener=None, environ=None):
        self.cfg = cfg if isinstance(cfg, dict) else {}
        self.mode = str(self.cfg.get("mode") or "off").lower()
        self.prompt = str(self.cfg.get("prompt") or DEFAULT_PROMPT)
        self.timeout = _number(self.cfg, "timeout_s", DEFAULT_TIMEOUT_S, float, 0)
        self.max_tokens = _number(self.cfg, "max_tokens", DEFAULT_MAX_TOKENS, int, 1)
        self.env = os.environ if environ is None else environ
        # Local servers must not go through HTTP(S)_PROXY; remote APIs follow the environment.
        self.open = opener or (urllib.request.build_opener(urllib.request.ProxyHandler({})).open
                               if self.cfg.get("no_proxy") else urllib.request.urlopen)

    def enabled(self):
        if self.mode == "openai":
            return bool(self.cfg.get("base_url") and self.cfg.get("model"))
        if self.mode == "url":
            return bool(self.cfg.get("url"))
        return False

    def _post(self, url, body, headers):
        h = {"Content-Type": "application/json"}
        h.update(headers)
        req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode(), headers=h)
        with self.open(req, timeout=self.timeout) as r:
            return strict_json(r.read().decode("utf-8", "replace"))

    def ask(self, text, group, recent, last_age):
        if not self.enabled():
            return None
        try:
            if self.mode == "openai":
                return self._ask_openai(text, recent, last_age)
            return parse_verdict(self._post(str(self.cfg["url"]),
                                            {"prompt": self.prompt, "text": text, "group": group,
                                             "recent": recent, "last_reply_age_s": last_age}, {}))
        except Exception:  # timeout, refused, HTTP error, bad JSON: let the caller stay quiet
            return None

    def _ask_openai(self, text, recent, last_age):
        headers = {}
        env_name = self.cfg.get("api_key_env")
        if env_name:
            key = self.env.get(str(env_name), "")
            if not key:
                return None  # remote API configured but key missing: don't send unauthenticated
            headers["Authorization"] = "Bearer " + key
        spoke = ("The bot last spoke %d seconds ago." % last_age
                 if isinstance(last_age, (int, float)) and last_age > 0 else "The bot has not spoken recently.")
        user = "Recent messages:\n%s\n\n%s\nNew message: %s\n\nShould the bot reply?" % (
            "\n".join(recent) or "(none)", spoke, text)
        body = {"model": self.cfg["model"],
                "max_tokens": self.max_tokens,
                "messages": [{"role": "system", "content": self.prompt},
                             {"role": "user", "content": user}]}
        extra = self.cfg.get("extra_body")
        if isinstance(extra, dict):  # e.g. {"chat_template_kwargs": {"enable_thinking": false}}
            body.update(extra)
        url = str(self.cfg["base_url"]).rstrip("/") + "/chat/completions"
        return parse_verdict(self._post(url, body, headers))


class Gate:
    def __init__(self, cfg, judge=None, clock=time.time):
        self.cfg = cfg if isinstance(cfg, dict) else {}
        # The ?bot= value of this role's gate_url ("" = the main bot). names, prompt and cooldown belong
        # to one role, so a request carrying another bot is refused rather than judged with them.
        self.bot = str(self.cfg.get("bot") or "")
        self.judge = judge or Judge(self.cfg.get("judge") or {})
        self.names = [str(n) for n in self.cfg.get("names") or [] if str(n)]
        self.context = _number(self.cfg, "context_messages", DEFAULT_CONTEXT, int, 1)
        # source: no measured length exists, so no cut by default (0); a deployer may cap each remembered
        # message. Memory stays bounded by context_messages per session either way.
        self.context_chars = _number(self.cfg, "context_chars", 0, int, 0, allow_zero=True)
        # source: off unless the deployer sets it (0 = no cooldown between judge-approved replies).
        self.cooldown = _number(self.cfg, "cooldown_s", 0, float, 0, allow_zero=True)
        self.clock = clock
        self.lock = threading.Lock()
        self.recent = {}        # (bot, session_key) -> last messages (memory only)
        self.last_join = {}     # (bot, session_key) -> time of last judge-approved reply

    def _remember(self, key, text):
        buf = self.recent.setdefault(key, [])
        before = list(buf)
        buf.append(text[:self.context_chars] if self.context_chars else text)
        del buf[:-self.context]
        return before[-self.context:]

    def decide(self, req, bot=""):
        req = req if isinstance(req, dict) else {}
        bot = str(bot or "")
        if bot != self.bot:
            return out("silent", "this gate serves bot %r, not %r; give each role its own gate" % (self.bot, bot))
        text = str(req.get("content") or "")
        session = str(req.get("session_key") or "")
        kind, group = parse_session(session)
        if kind == "private":
            return out("reply", "private chat")
        key = (bot, session)
        with self.lock:
            recent = self._remember(key, text)
        if req.get("mentioned"):
            return out("reply", "mentioned")
        if any(n in text for n in self.names):
            return out("reply", "called by name")
        if req.get("addressed_other"):
            return out("silent", "addressed to someone else")
        if not self.judge.enabled():
            return out("silent", "not addressed; judge off")
        verdict = self.judge.ask(text, group, recent, req.get("last_reply_age_s"))
        if verdict is None:
            return out("silent", "judge unavailable or unclear; staying quiet")
        if not verdict:
            return out("silent", "judge: no reply needed")
        now = self.clock()
        with self.lock:
            last = self.last_join.get(key)
            if self.cooldown and last is not None and now - last < self.cooldown:
                return out("silent", "judge: reply, but in cooldown")
            self.last_join[key] = now
        return out("reply", "judge: reply")


def out(action, reason):
    return {"action": action, "reason": reason, "tier": "chat"}


def make_handler(gate):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, obj):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/healthz"):
                return self._send({"ok": True, "judge": gate.judge.mode if gate.judge.enabled() else "off"})
            self.send_error(404)

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                payload = {}
            url = urllib.parse.urlsplit(self.path)
            if url.path.startswith("/decide"):
                bot = urllib.parse.parse_qs(url.query).get("bot", [""])[0]
                return self._send(gate.decide(payload, bot=bot))
            if url.path.startswith("/context"):
                return self._send({"wiki": []})
            self.send_error(404)

    return Handler


def main():
    cfg = load_config(os.environ.get("QQ_GATE_CONFIG"))
    try:
        gate = Gate(cfg)
    except ValueError as e:
        raise SystemExit("qq-gate: bad config: %s" % e)
    host = str(cfg.get("host") or "127.0.0.1")
    port = int(os.environ.get("QQ_GATE_PORT") or cfg.get("port") or DEFAULT_PORT)
    print("qq-gate on %s:%d, bot %r, judge %s" % (host, port, gate.bot,
                                                  gate.judge.mode if gate.judge.enabled() else "off"),
          flush=True)
    ThreadingHTTPServer((host, port), make_handler(gate)).serve_forever()


if __name__ == "__main__":
    main()
