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


def failure(message):
    return I.codex_retry.failure([dict(message=message)], "thread", "turn.failed", set())


class ProviderFailure(unittest.TestCase):
    def test_request_errors_are_not_provider_outages(self):
        for message in ("400 Bad Request", "404 Not Found", "422 Unprocessable Entity", "invalid_request_error"):
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
        for message in ("400 Bad Request", "404 Not Found", "422 Unprocessable Entity", "invalid_request_error"):
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
