"""#619 token savings: dsh usage accounting, failure-driven halving, newest first. No model calls."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(tempfile.mkdtemp(prefix="ingest-cost-"))
os.environ["WIKI_DIR"] = str(ROOT)
os.environ["WIKI_BRIDGE_CONFIG"] = str(ROOT / "missing.toml")
os.environ["AGENT_SESSIONS_DIR"] = str(ROOT / "sessions")
import ingest as I

FAKE_DSH = r'''#!/usr/bin/env python3
import sys, json
task = sys.stdin.read()
open(sys.argv[0] + ".task", "w").write(task)
for i in range(3):
    print(json.dumps({"type": "status", "phase": "step_start", "turn": 1, "step": i + 1}))
    print(json.dumps({"type": "status", "phase": "step_end", "turn": 1, "step": i + 1,
                      "usage": {"inputTokens": 100, "outputTokens": 10, "cacheReadTokens": 1000, "totalTokens": 1110}}))
print(json.dumps({"type": "final", "text": "done"}))
'''

# stdout lines that parse as JSON but are not events: `18` (test_rolewiki's fake-dsh prints len(stdin)), "ok", [1, 2].
# The int one crashed `.get` in 2026-11-10's bridge-checks; all three must be skipped, not crash the run
NOISY_DSH = r'''#!/usr/bin/env python3
import sys, json
sys.stdin.read()
print(18)
print(json.dumps("ok"))
print(json.dumps([1, 2]))
print(json.dumps({"type": "status", "phase": "step_end", "turn": 1, "step": 1,
                  "usage": {"inputTokens": 100, "outputTokens": 10, "cacheReadTokens": 1000, "totalTokens": 1110}}))
print(json.dumps({"type": "final", "text": "done"}))
'''


def db_with_fails(fails):
    db = sqlite3.connect(":memory:")
    db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                     "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                     "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                     "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
    db.executemany("insert into fails values (?,?)", fails.items())
    return db


def session(name, text, mtime):
    p = ROOT / f"{name}.jsonl"
    p.write_text("".join(json.dumps({"type": "user", "message": {"content": t}}) + "\n" for t in text))
    os.utime(p, (mtime, mtime))
    return p


class DshUsage(unittest.TestCase):
    def test_usage_is_summed_from_step_events(self):
        fake = ROOT / "fake-dsh"
        fake.write_text(FAKE_DSH)
        fake.chmod(0o700)
        usage = ROOT / "usage.tsv"
        cfg = dict(I.CFG, dsh_cmd=[str(fake)], dsh_patch="")
        with patch.multiple(I, CFG=cfg, USAGE=usage, WIKI=ROOT), patch.object(I, "log"):
            ok, out, _ = I.dsh("do it", context="transcript")
        self.assertTrue(ok)
        self.assertEqual(out, "done")
        row = usage.read_text().strip().split("\t")
        self.assertEqual(row[3:8], ["3", "300", "3000", "0", "30"])  # steps, input, cache_read, cache_write, output
        task = (ROOT / "fake-dsh.task").read_text()
        self.assertTrue(task.startswith(I.CONTEXT.format(text="transcript")))

    def test_non_object_json_lines_are_skipped(self):
        fake = ROOT / "noisy-dsh"
        fake.write_text(NOISY_DSH)
        fake.chmod(0o700)
        usage = ROOT / "usage-noisy.tsv"
        cfg = dict(I.CFG, dsh_cmd=[str(fake)], dsh_patch="")
        with patch.multiple(I, CFG=cfg, USAGE=usage, WIKI=ROOT), patch.object(I, "log"):
            ok, out, _ = I.dsh("do it")
        self.assertTrue(ok)
        self.assertEqual(out, "done")
        row = usage.read_text().strip().split("\t")
        self.assertEqual(row[3:8], ["1", "100", "1000", "0", "10"])

    def test_missing_dsh_is_a_failed_call(self):
        cfg = dict(I.CFG, dsh_cmd=[str(ROOT / "no-such-dsh")], dsh_patch="")
        with patch.multiple(I, CFG=cfg, USAGE=ROOT / "usage2.tsv", WIKI=ROOT), patch.object(I, "log"):
            ok, out, _ = I.dsh("do it")
        self.assertFalse(ok)


class PendingShrink(unittest.TestCase):
    def run_round(self, paths, fails, env=None):
        db = db_with_fails(fails)
        seen = []

        def model_pass(_label, _prompt, **kw):
            seen.append(kw["context"])
            return True
        args = argparse.Namespace(lint=False, nightly=False, pending=True, session=None)
        with patch.multiple(I, MAX_CHARS=400, WIKI=ROOT, WORK=ROOT, QUEUE=ROOT / "queue", LAST_ENGINE="fake"), \
                patch.dict(os.environ, env or {}), patch.object(I, "state", return_value=db), \
                patch.object(I, "ready", return_value=paths), patch.object(I, "split_pass"), \
                patch.object(I, "candidates_note", return_value=""), patch.object(I, "model_pass", model_pass), \
                patch.object(I, "reject_streaks"), patch.object(I, "log"):
            I.run(args, engines=["fake"])
        return seen

    def test_failed_multi_session_batch_retries_half_its_sessions(self):
        now = time.time() - 7200
        paths = [session(f"s{i}", [f"m{i}-" + "x" * 40], now + i) for i in range(4)]
        whole = self.run_round(paths, {})
        self.assertEqual(sum(f"m{i}-" in whole[0] for i in range(4)), 4)
        half = self.run_round(paths, {p.stem: 1 for p in paths})
        self.assertEqual(sum(f"m{i}-" in half[0] for i in range(4)), 2)

    def test_failed_single_session_retries_a_smaller_slice(self):
        now = time.time() - 7200
        p = session("big", [f"rec{i}-" + "y" * 60 for i in range(6)], now)
        whole = self.run_round([p], {})
        half = self.run_round([p], {p.stem: 1})
        self.assertLess(len(half[0]), len(whole[0]))
        self.assertIn("rec0-", half[0])

    def test_newest_first_orders_the_round(self):
        now = time.time() - 7200
        old, new = session("old", ["old-" + "z" * 300], now), session("new", ["new-" + "z" * 300], now + 60)
        self.assertIn("old-", self.run_round([old, new], {})[0])
        self.assertIn("new-", self.run_round([old, new], {}, {"WIKI_NEWEST_FIRST": "1"})[0])


if __name__ == "__main__":
    unittest.main()
