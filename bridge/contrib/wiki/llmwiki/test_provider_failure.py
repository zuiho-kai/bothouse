"""A bad request must reach the failure cap, while a provider outage stops uncounted."""
from contextlib import ExitStack
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(tempfile.mkdtemp(prefix="provider-failure-"))
os.environ.update(WIKI_DIR=str(ROOT), WIKI_BRIDGE_CONFIG=str(ROOT / "absent.toml"),
                  AGENT_SESSIONS_DIR=str(ROOT / "sessions"))
sys.path.insert(0, os.environ.get("WIKI_PROPOSAL_SOURCE", str(Path(__file__).resolve().parent)))
import ingest as I


REQUEST_ERRORS = ("400 Bad Request", "404 Not Found", "422 Unprocessable Entity", "invalid_request_error",
                  "400 Invalid value at input[512]", "invalid_request_error: string too long, max length 500",
                  "400: maximum 429 items", "400: invalid quota field; rate limit must be 500",
                  "404: resource 503 not found", "422: invalid authentication_error field")


def failure(message):
    return I.codex_retry.failure([message if isinstance(message, dict) else dict(message=message)],
                                "thread", "turn.failed", set())


class ProviderFailure(unittest.TestCase):
    def test_request_errors_are_not_provider_outages(self):
        for message in REQUEST_ERRORS:
            with self.subTest(message=message):
                out = failure(message)
                self.assertEqual(out.reason, "request_rejected")
                self.assertFalse(out.provider_down)

    def test_auth_quota_rate_and_transport_failures_are_provider_outages(self):
        for message in ("401 Unauthorized", "403 Forbidden", "429 Too Many Requests", "usage limit",
                        "quota exceeded", "rate limit", "authentication_error", "permission_denied",
                        "503 Service Unavailable", "failed to connect to responses websocket"):
            with self.subTest(message=message):
                self.assertTrue(failure(message).provider_down)

    def test_structured_status_controls_classification_over_body_and_stderr(self):
        for field in ("status", "http_status", "status_code", "http_status_code"):
            for status in (400, 404, 422, 0, 401, 403, 429, 500, 503):
                with self.subTest(field=field, status=status):
                    error = {field: str(status), "type": "invalid_request_error",
                             "message": "400: quota field has maximum 503 items"}
                    out = I.codex_retry.failure([error], "thread", "turn.failed", set(),
                                                stderr="HTTP status 503; quota exceeded")
                    self.assertEqual(out.provider_down, status in (0, 401, 403, 429, 500, 503))
        out = failure({"error": {"status": 400, "message": "HTTP 503; quota field invalid"}})
        self.assertEqual(out.reason, "request_rejected")
        self.assertFalse(out.provider_down)

    def test_body_numbers_and_stderr_do_not_override_request_failure(self):
        for message in ("400 Invalid value at input[512]", "400 invalid_request_error: max length 500"):
            with self.subTest(message=message):
                out = I.codex_retry.failure([{"message": message}], "thread", "turn.failed", set(),
                                            stderr="HTTP status 503; quota field invalid")
                self.assertEqual(out.reason, "request_rejected")
                self.assertFalse(out.provider_down)
        for message in ("invalid value at input[512]", "string too long, max length 500", "maximum 429 items"):
            with self.subTest(message=message):
                out = failure(message)
                self.assertFalse(out.provider_down)
                self.assertEqual(out.reason, "failure")

    def test_401_status_overrides_invalid_request_error_and_stops_uncounted(self):
        for message in (
                {"status": 401, "type": "invalid_request_error"},
                'unexpected status 401 Unauthorized: {"error":{"type":"invalid_request_error"}}'):
            with self.subTest(message=message):
                db, logs, invoke, down = self.run_queue(message, paid_fallback=True)
                self.assertTrue(down)
                self.assertEqual({call.args[2] for call in invoke.call_args_list}, {"ingest aaaaaaaa facts"})
                self.assertEqual(db.execute("SELECT id,n FROM fails").fetchall(),
                                 [("aaaaaaaa", I.MAX_FAILS - 1)])
                self.assertEqual(db.execute("SELECT * FROM ingested").fetchall(), [])

    def test_429_status_overrides_invalid_request_error_and_stops_uncounted(self):
        for message in (
                {"error": {"status": 429, "type": "invalid_request_error"}},
                'HTTP/1.1 429 Too Many Requests: {"error":{"type":"invalid_request_error"}}'):
            with self.subTest(message=message):
                db, logs, invoke, down = self.run_queue(message, paid_fallback=True)
                self.assertTrue(down)
                self.assertEqual({call.args[2] for call in invoke.call_args_list}, {"ingest aaaaaaaa facts"})
                self.assertEqual(db.execute("SELECT id,n FROM fails").fetchall(),
                                 [("aaaaaaaa", I.MAX_FAILS - 1)])
                self.assertEqual(db.execute("SELECT * FROM ingested").fetchall(), [])

    def test_quota_field_text_without_status_is_not_an_outage(self):
        message = "Quota exceeded for field x (400)"
        self.assertEqual(I.codex_retry.response_statuses([{"message": message}], ""), [])
        db, logs, invoke, down = self.run_queue(message)
        self.assertFalse(down)
        self.assertEqual({call.args[2] for call in invoke.call_args_list},
                         {"ingest aaaaaaaa facts", "ingest bbbbbbbb facts"})
        self.assertEqual(db.execute("SELECT id,n FROM fails ORDER BY id").fetchall(),
                         [("aaaaaaaa", I.MAX_FAILS), ("bbbbbbbb", 1)])

    def test_number_at_start_of_later_body_line_is_not_a_status(self):
        message = "bad schema:\n500 items max"
        self.assertEqual(I.codex_retry.response_statuses([{"message": message}], ""), [])
        db, logs, invoke, down = self.run_queue(message)
        self.assertFalse(down)
        self.assertEqual({call.args[2] for call in invoke.call_args_list},
                         {"ingest aaaaaaaa facts", "ingest bbbbbbbb facts"})
        self.assertEqual(db.execute("SELECT id,n FROM fails ORDER BY id").fetchall(),
                         [("aaaaaaaa", I.MAX_FAILS), ("bbbbbbbb", 1)])

    def test_http_status_diagnostics_still_identify_provider_failure(self):
        for message in ("HTTP/1.1 503 Service Unavailable", "unexpected HTTP status: 503",
                        "exceeded retry limit, last status: 429 Too Many Requests", "status code=401"):
            with self.subTest(message=message):
                self.assertTrue(failure(message).provider_down)

    def run_queue(self, message, paid_fallback=False):
        role = hasattr(I, "ROUTE_DOWN")
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        db.execute("CREATE TABLE fails(id TEXT PRIMARY KEY, n INT" + ("" if role else ", offset INT") + ")")
        db.execute("INSERT INTO fails VALUES (" + ("?,?" if role else "?,?,?") + ")",
                   ("aaaaaaaa", I.MAX_FAILS - 1) if role else ("aaaaaaaa", I.MAX_FAILS - 1, 0))
        items = [dict(id=sid, start=0, end=10, path=ROOT / (sid + ".jsonl"), title="配置", cwd="/test",
                      date="2026-11-20", text="USER: 配置有变化") for sid in ("aaaaaaaa", "bbbbbbbb")]
        def prepare(root, text, rules, call, label, **kw):
            self.assertIsNone(call("facts", I.propose.FACTS_SCHEMA, label + " facts"))
            return None
        with ExitStack() as stack:
            stack.enter_context(patch.multiple(I, WIKI=ROOT, WORK=ROOT, REPO=ROOT, PREFETCH=None))
            for name in ("sync_work", "discard", "candidates_note", "reject_streaks", "alert", "lint_errors"):
                if hasattr(I, name):
                    stack.enter_context(patch.object(I, name, return_value=""))
            if role:
                stack.enter_context(patch.object(I, "role_rules", return_value=([], None)))
            else:
                stack.enter_context(patch.object(I, "round_ready", return_value=True))
                stack.enter_context(patch.object(I, "pending_transactions", return_value=[]))
                stack.enter_context(patch.object(I, "pending_ingest", return_value=False))
                stack.enter_context(patch.object(I, "git", return_value="base"))
                stack.enter_context(patch.object(I.block_contract, "freeze", return_value={}))
            logs = stack.enter_context(patch.object(I, "log"))
            fallback = stack.enter_context(patch.object(I, "model_pass", return_value=False))
            invoke = stack.enter_context(patch.object(I, "codex_json", return_value=(False, failure(message), 0, "thread")))
            stack.enter_context(patch.object(I.propose, "prepare", side_effect=prepare))
            engines = ["codex", "sonnet"] if paid_fallback else ["codex"]
            if role:
                I._ingest_batches(db, [[(it, it["text"])] for it in items], engines, False)
                down = I.ROUTE_DOWN
            else:
                I._ingest_proposal_batches(db, items, engines, {})
                down = I.provider_down
            fallback.assert_not_called()
        return db, logs, invoke, down

    def test_bad_batch_counts_reaches_cap_and_does_not_block_next_batch(self):
        for message in REQUEST_ERRORS:
            with self.subTest(message=message):
                db, logs, invoke, down = self.run_queue(message)
                self.assertFalse(down)
                self.assertEqual({call.args[2] for call in invoke.call_args_list},
                                 {"ingest aaaaaaaa facts", "ingest bbbbbbbb facts"})
                self.assertEqual(db.execute("SELECT id,n FROM fails ORDER BY id").fetchall(),
                                 [("aaaaaaaa", I.MAX_FAILS), ("bbbbbbbb", 1)])
                self.assertEqual(db.execute("SELECT * FROM ingested").fetchall(), [])
                self.assertTrue(any("after" in str(call) and "failed runs" in str(call) for call in logs.call_args_list))

    def test_global_refusal_stops_before_fallback_without_counting(self):
        for message in ("401 Unauthorized", "429 Too Many Requests", "usage limit"):
            with self.subTest(message=message):
                db, logs, invoke, down = self.run_queue(message, paid_fallback=True)
                self.assertTrue(down)
                self.assertEqual({call.args[2] for call in invoke.call_args_list}, {"ingest aaaaaaaa facts"})
                self.assertEqual(db.execute("SELECT id,n FROM fails").fetchall(), [("aaaaaaaa", I.MAX_FAILS - 1)])
                self.assertEqual(db.execute("SELECT * FROM ingested").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
