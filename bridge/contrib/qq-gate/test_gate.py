"""Tests for contrib/qq-gate/gate.py. No real model is called: the judge's opener is faked."""
import io
import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import gate

GROUP = "qq:g:100"


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    """Records requests and returns a canned body, or raises."""

    def __init__(self, body=None, exc=None):
        self.body, self.exc, self.calls = body, exc, []

    def __call__(self, req, timeout=None):
        self.calls.append({"url": req.full_url, "headers": dict(req.header_items()),
                           "body": json.loads(req.data), "timeout": timeout})
        if self.exc:
            raise self.exc
        raw = self.body if isinstance(self.body, bytes) else json.dumps(self.body).encode()
        return FakeResp(raw)


def chat(content):
    return {"choices": [{"message": {"content": content}}]}


def make(judge_cfg, opener=None, env=None, **cfg):
    j = gate.Judge(judge_cfg, opener=opener, environ=env or {})
    return gate.Gate(dict(cfg, judge=judge_cfg), judge=j)


OPENAI_LOCAL = {"mode": "openai", "base_url": "http://127.0.0.1:8000/v1/", "model": "local-judge"}
OPENAI_REMOTE = {"mode": "openai", "base_url": "https://api.example.com/v1", "model": "m",
                 "api_key_env": "JUDGE_API_KEY"}
CUSTOM_URL = {"mode": "url", "url": "http://127.0.0.1:9000/judge"}


class TestOff(unittest.TestCase):
    def test_default_is_off(self):
        g = gate.Gate({})
        self.assertFalse(g.judge.enabled())
        self.assertEqual(g.decide({"session_key": GROUP, "content": "anyone here?"})["action"], "silent")

    def test_private_chat_replies(self):
        self.assertEqual(gate.Gate({}).decide({"session_key": "qq:42", "content": "hi"})["action"], "reply")

    def test_mention_and_name_reply_without_model(self):
        op = FakeOpener(chat('{"reply": false}'))
        g = make(OPENAI_LOCAL, op, names=["Bot"])
        self.assertEqual(g.decide({"session_key": GROUP, "content": "x", "mentioned": True})["action"], "reply")
        self.assertEqual(g.decide({"session_key": "qq:100:7", "content": "Bot, look"})["action"], "reply")
        self.assertEqual(op.calls, [])

    def test_addressed_other_is_silent(self):
        op = FakeOpener(chat('{"reply": true}'))
        g = make(OPENAI_LOCAL, op)
        self.assertEqual(g.decide({"session_key": GROUP, "content": "x", "addressed_other": True})["action"],
                         "silent")
        self.assertEqual(op.calls, [])


class TestMissingConfig(unittest.TestCase):
    def test_missing_file(self):
        self.assertEqual(gate.load_config("/nonexistent/qq-gate.json"), {})
        self.assertEqual(gate.load_config(None), {})

    def test_broken_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "gate.json"
            for raw in ("{not json", "[1, 2]"):
                p.write_text(raw, encoding="utf-8")
                self.assertEqual(gate.load_config(str(p)), {})

    def test_incomplete_judge_is_off(self):
        for cfg in ({"mode": "openai", "base_url": "http://x"}, {"mode": "openai", "model": "m"},
                    {"mode": "url"}, {"mode": "nonsense"}):
            op = FakeOpener(chat('{"reply": true}'))
            g = make(cfg, op)
            self.assertEqual(g.decide({"session_key": GROUP, "content": "q?"})["action"], "silent", cfg)
            self.assertEqual(op.calls, [])

    def test_remote_key_missing_does_not_send(self):
        op = FakeOpener(chat('{"reply": true}'))
        g = make(OPENAI_REMOTE, op, env={})
        self.assertEqual(g.decide({"session_key": GROUP, "content": "q?"})["action"], "silent")
        self.assertEqual(op.calls, [])


class TestSelfHosted(unittest.TestCase):
    def test_openai_compatible_without_key(self):
        op = FakeOpener(chat('{"reply": true}'))
        g = make(dict(OPENAI_LOCAL, extra_body={"chat_template_kwargs": {"enable_thinking": False}}), op)
        g.decide({"session_key": GROUP, "content": "earlier line"})
        r = g.decide({"session_key": GROUP, "content": "does anyone know?", "last_reply_age_s": 30})
        self.assertEqual(r["action"], "reply")
        call = op.calls[-1]
        self.assertEqual(call["url"], "http://127.0.0.1:8000/v1/chat/completions")
        self.assertNotIn("Authorization", call["headers"])
        self.assertEqual(call["timeout"], gate.DEFAULT_TIMEOUT_S)
        self.assertEqual(call["body"]["model"], "local-judge")
        self.assertEqual(call["body"]["chat_template_kwargs"], {"enable_thinking": False})
        user = call["body"]["messages"][1]["content"]
        self.assertIn("earlier line", user)
        self.assertIn("does anyone know?", user)
        self.assertIn("30 seconds", user)

    def test_custom_url(self):
        op = FakeOpener({"reply": True})
        g = make(dict(CUSTOM_URL, prompt="custom prompt"), op)
        self.assertEqual(g.decide({"session_key": GROUP, "content": "hello"})["action"], "reply")
        body = op.calls[0]["body"]
        self.assertEqual(op.calls[0]["url"], "http://127.0.0.1:9000/judge")
        self.assertEqual(body["prompt"], "custom prompt")
        self.assertEqual(body["group"], "100")
        self.assertEqual(body["text"], "hello")

    def test_custom_url_action_form(self):
        g = make(CUSTOM_URL, FakeOpener({"action": "silent"}))
        self.assertEqual(g.decide({"session_key": GROUP, "content": "hello"})["action"], "silent")
        g = make(CUSTOM_URL, FakeOpener({"action": "reply"}))
        self.assertEqual(g.decide({"session_key": GROUP, "content": "hello"})["action"], "reply")


class TestRemoteAPI(unittest.TestCase):
    def test_key_from_env(self):
        op = FakeOpener(chat('{"reply": false}'))
        g = make(OPENAI_REMOTE, op, env={"JUDGE_API_KEY": "sk-test"})
        self.assertEqual(g.decide({"session_key": GROUP, "content": "lol"})["action"], "silent")
        self.assertEqual(op.calls[0]["headers"].get("Authorization"), "Bearer sk-test")
        self.assertEqual(op.calls[0]["url"], "https://api.example.com/v1/chat/completions")

    def test_reason_never_contains_key(self):
        op = FakeOpener(exc=urllib.error.HTTPError("u", 401, "sk-test bad", {}, None))
        g = make(OPENAI_REMOTE, op, env={"JUDGE_API_KEY": "sk-test"})
        r = g.decide({"session_key": GROUP, "content": "q?"})
        self.assertEqual(r["action"], "silent")
        self.assertNotIn("sk-test", json.dumps(r))


class TestBadOutputAndFailures(unittest.TestCase):
    def check_silent(self, opener):
        g = make(OPENAI_LOCAL, opener)
        r = g.decide({"session_key": GROUP, "content": "q?"})
        self.assertEqual(r["action"], "silent")
        self.assertEqual(len(opener.calls), 1)

    def test_invalid_outputs(self):
        for body in (chat("maybe"), chat(""), {"choices": []}, {"foo": 1}, b"not json", b"[1,2]"):
            self.check_silent(FakeOpener(body))

    def test_malformed_or_contradictory_verdicts(self):
        bodies = (
            chat('{"reply": true, "reply": false}'),          # duplicate key: json.loads keeps the last
            chat('{"reply": true} {"reply": false}'),         # two objects
            chat('{"reply": true}\nBecause they asked.'),     # trailing narration
            chat('Sure: {"reply": true}'),                     # leading narration
            chat('```json\n{"reply": true}\n```'),            # fenced
            chat('{"reply": "true"}'),                         # string, not boolean
            chat('{"reply": 1}'),
            chat('{"reply": true, "action": "silent"}'),       # both keys
            chat('{"reply": true, "action": "reply"}'),
            chat('{"action": "Reply"}'),                       # not an exact action
            chat('{"action": "maybe"}'),
            chat('["reply", true]'),
            chat('{"reply": NaN}'),
            chat('{"reply": tru'),                             # truncated by max_tokens
            {"choices": [{"message": {"content": {"reply": True}}}]},  # content not a string
            b'{"reply": true, "reply": false}',
        )
        for body in bodies:
            self.check_silent(FakeOpener(body))

    def test_parse_verdict_strict(self):
        self.assertIs(gate.parse_verdict(chat('  {"reply": true}\n')), True)
        self.assertIs(gate.parse_verdict(chat('{"action": "silent"}')), False)
        self.assertIs(gate.parse_verdict({"reply": False, "reason": "chit-chat"}), False)
        for obj in ({"reply": True, "action": "silent"}, {"reply": None}, {"action": True}, {}, [True],
                    {"reply": True, "choices": []}):
            self.assertIsNone(gate.parse_verdict(obj), obj)

    def test_custom_url_duplicate_key_is_silent(self):
        op = FakeOpener(b'{"action": "reply", "action": "silent"}')
        g = make(CUSTOM_URL, op)
        self.assertEqual(g.decide({"session_key": GROUP, "content": "hello"})["action"], "silent")
        self.assertEqual(len(op.calls), 1)

    def test_timeout(self):
        self.check_silent(FakeOpener(exc=socket.timeout("timed out")))

    def test_connection_refused(self):
        self.check_silent(FakeOpener(exc=urllib.error.URLError(ConnectionRefusedError())))

    def test_http_500(self):
        self.check_silent(FakeOpener(exc=urllib.error.HTTPError("u", 500, "boom", {}, None)))

    def test_timeout_setting_used(self):
        op = FakeOpener(chat('{"reply": true}'))
        make(dict(OPENAI_LOCAL, timeout_s=1.2), op).decide({"session_key": GROUP, "content": "q"})
        self.assertEqual(op.calls[0]["timeout"], 1.2)

    def test_mention_still_replies_when_judge_broken(self):
        g = make(OPENAI_LOCAL, FakeOpener(exc=socket.timeout()))
        self.assertEqual(g.decide({"session_key": GROUP, "content": "q", "mentioned": True})["action"], "reply")


class TestCooldownAndContext(unittest.TestCase):
    def test_cooldown(self):
        t = [1000.0]
        j = gate.Judge(OPENAI_LOCAL, opener=FakeOpener(chat('{"reply": true}')), environ={})
        g = gate.Gate({"cooldown_s": 60}, judge=j, clock=lambda: t[0])
        self.assertEqual(g.decide({"session_key": GROUP, "content": "a"})["action"], "reply")
        t[0] += 30
        self.assertEqual(g.decide({"session_key": GROUP, "content": "b"})["action"], "silent")
        self.assertEqual(g.decide({"session_key": "qq:g:200", "content": "c"})["action"], "reply")
        t[0] += 31
        self.assertEqual(g.decide({"session_key": GROUP, "content": "d"})["action"], "reply")

    def test_context_bounded_per_group(self):
        op = FakeOpener(chat('{"reply": false}'))
        g = make(OPENAI_LOCAL, op, context_messages=2)
        for s in ("m1", "m2", "m3"):
            g.decide({"session_key": GROUP, "content": s})
        g.decide({"session_key": "qq:g:200", "content": "other"})
        g.decide({"session_key": GROUP, "content": "m4"})
        user = op.calls[-1]["body"]["messages"][1]["content"]
        self.assertIn("m2", user)
        self.assertIn("m3", user)
        self.assertNotIn("m1", user)
        self.assertNotIn("other", user)


class TestConfigValidation(unittest.TestCase):
    def test_bad_numbers_refused(self):
        bad = [{"context_messages": v} for v in (0, -1, 2.5, "8", True, float("inf"))]
        bad += [{"cooldown_s": v} for v in (-1, "60", float("nan"))]
        bad += [{"context_chars": v} for v in (-5, 1.5)]
        bad += [{"judge": dict(OPENAI_LOCAL, timeout_s=v)} for v in (0, -2, "2", float("inf"))]
        bad += [{"judge": dict(OPENAI_LOCAL, max_tokens=v)} for v in (0, -20, 1.5, False)]
        for cfg in bad:
            with self.assertRaises(ValueError, msg=cfg):
                gate.Gate(cfg)

    def test_good_numbers_kept(self):
        g = gate.Gate({"context_messages": 3, "cooldown_s": 0, "context_chars": 0,
                       "judge": dict(OPENAI_LOCAL, timeout_s=1, max_tokens=8.0)})
        self.assertEqual((g.context, g.cooldown, g.context_chars), (3, 0.0, 0))
        self.assertEqual((g.judge.timeout, g.judge.max_tokens), (1.0, 8))
        self.assertIsInstance(g.judge.max_tokens, int)

    def test_context_chars_caps_remembered_text(self):
        op = FakeOpener(chat('{"reply": false}'))
        g = make(OPENAI_LOCAL, op, context_chars=4)
        g.decide({"session_key": GROUP, "content": "abcdefgh"})
        g.decide({"session_key": GROUP, "content": "next"})
        user = op.calls[-1]["body"]["messages"][1]["content"]
        self.assertIn("abcd", user)
        self.assertNotIn("abcde", user)

    def test_main_exits_on_bad_config(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "gate.json"
            p.write_text(json.dumps({"cooldown_s": -1}), encoding="utf-8")
            old = os.environ.get("QQ_GATE_CONFIG")
            os.environ["QQ_GATE_CONFIG"] = str(p)
            try:
                with self.assertRaises(SystemExit) as cm:
                    gate.main()
                self.assertIn("cooldown_s", str(cm.exception))
            finally:
                if old is None:
                    os.environ.pop("QQ_GATE_CONFIG", None)
                else:
                    os.environ["QQ_GATE_CONFIG"] = old


class TestIsolation(unittest.TestCase):
    def test_other_bot_refused_and_not_remembered(self):
        op = FakeOpener(chat('{"reply": false}'))
        g = make(OPENAI_LOCAL, op, bot="fish", names=["Fish"])
        r = g.decide({"session_key": GROUP, "content": "secret from main", "mentioned": True}, bot="")
        self.assertEqual(r["action"], "silent")
        r = g.decide({"session_key": "qq:42", "content": "hi"}, bot="other")
        self.assertEqual(r["action"], "silent")
        g.decide({"session_key": GROUP, "content": "q?"}, bot="fish")
        self.assertNotIn("secret from main", op.calls[-1]["body"]["messages"][1]["content"])
        self.assertEqual(list(g.recent), [("fish", GROUP)])

    def test_sessions_do_not_share_context_or_cooldown(self):
        t = [1000.0]
        op = FakeOpener(chat('{"reply": true}'))
        j = gate.Judge(OPENAI_LOCAL, opener=op, environ={})
        g = gate.Gate({"cooldown_s": 60}, judge=j, clock=lambda: t[0])
        self.assertEqual(g.decide({"session_key": "qq:100:1", "content": "from user 1"})["action"], "reply")
        self.assertEqual(g.decide({"session_key": "qq:100:2", "content": "from user 2"})["action"], "reply")
        self.assertNotIn("from user 1", op.calls[-1]["body"]["messages"][1]["content"])
        self.assertEqual(g.decide({"session_key": "qq:100:1", "content": "again"})["action"], "silent")

    def test_http_passes_bot_query(self):
        g = gate.Gate({"bot": "fish"})
        srv = ThreadingHTTPServer(("127.0.0.1", 0), gate.make_handler(g))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base = "http://127.0.0.1:%d" % srv.server_address[1]
            op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            body = json.dumps({"session_key": GROUP, "content": "hi", "mentioned": True}).encode()
            for path, want in (("/decide?bot=fish", "reply"), ("/decide", "silent"), ("/decide?bot=x", "silent")):
                with op.open(urllib.request.Request(base + path, data=body), timeout=5) as r:
                    self.assertEqual(json.loads(r.read())["action"], want, path)
        finally:
            srv.shutdown()
            srv.server_close()


class TestSession(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(gate.parse_session("qq:42"), ("private", "42"))
        self.assertEqual(gate.parse_session("qq:g:100"), ("group", "100"))
        self.assertEqual(gate.parse_session("qq:100:42"), ("group", "100"))


class TestHTTP(unittest.TestCase):
    def test_decide_endpoint(self):
        g = gate.Gate({})
        srv = ThreadingHTTPServer(("127.0.0.1", 0), gate.make_handler(g))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base = "http://127.0.0.1:%d" % srv.server_address[1]
            op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            req = urllib.request.Request(base + "/decide", data=json.dumps(
                {"session_key": GROUP, "content": "hi", "mentioned": True}).encode())
            with op.open(req, timeout=5) as r:
                self.assertEqual(json.loads(r.read())["action"], "reply")
            with op.open(base + "/healthz", timeout=5) as r:
                self.assertEqual(json.loads(r.read())["judge"], "off")
        finally:
            srv.shutdown()
            srv.server_close()


class TestJudgeHTTPIntegration(unittest.TestCase):
    def test_selfhosted_api_and_custom_endpoint(self):
        calls = []

        class Endpoint(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, self.headers.get("Authorization"), body))
                response = {"reply": True} if self.path == "/judge" else chat('{"reply": true}')
                raw = json.dumps(response).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        srv = ThreadingHTTPServer(("127.0.0.1", 0), Endpoint)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base = "http://127.0.0.1:%d" % srv.server_address[1]
            for remote in (False, True):
                cfg = {"mode": "openai", "base_url": base + "/v1", "model": "test-model", "no_proxy": True}
                if remote:
                    cfg["api_key_env"] = "TEST_JUDGE_KEY"
                judge = gate.Judge(cfg, environ={"TEST_JUDGE_KEY": "fixture-only"})
                g = gate.Gate({}, judge=judge)
                self.assertEqual(g.decide({"session_key": GROUP, "content": "Question?"})["action"], "reply")
                path, auth, body = calls[-1]
                self.assertEqual(path, "/v1/chat/completions")
                self.assertEqual(auth, "Bearer fixture-only" if remote else None)
                self.assertEqual(body["model"], "test-model")
            judge = gate.Judge({"mode": "url", "url": base + "/judge", "no_proxy": True})
            self.assertIs(judge.ask("Question?", "100", [], 0), True)
            self.assertEqual(calls[-1][0], "/judge")
        finally:
            srv.shutdown()
            srv.server_close()


class TestExamples(unittest.TestCase):
    def test_examples_parse_and_hold_no_secrets(self):
        here = Path(__file__).resolve().parent
        files = sorted(here.glob("*.example.json"))
        self.assertTrue(files)
        for p in files:
            cfg = json.loads(p.read_text(encoding="utf-8"))
            judge = cfg.get("judge", {})
            self.assertNotIn("api_key", judge, p.name)
            self.assertIn(judge.get("mode", "off"), ("off", "openai", "url"), p.name)


if __name__ == "__main__":
    unittest.main()
