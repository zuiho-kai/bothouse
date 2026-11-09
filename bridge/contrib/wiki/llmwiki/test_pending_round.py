"""Isolated pending-round regressions; no live sessions or model calls."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Keep artifacts for inspection; never read the operator's wiki or session store.
ROOT = Path(tempfile.mkdtemp(prefix="pending-round-"))
os.environ["WIKI_DIR"] = str(ROOT)
os.environ["WIKI_BRIDGE_CONFIG"] = str(ROOT / "missing.toml")
os.environ["AGENT_SESSIONS_DIR"] = str(ROOT / "sessions")
import ingest as I


class PendingRound(unittest.TestCase):
    def test_pending_yields_and_resumes_without_repeating_accepted_sessions(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);")
        paths = [ROOT / f"session-{n}.jsonl" for n in range(3)]
        for p in paths:
            p.write_text("x")
        offered = []
        args = argparse.Namespace(lint=False, nightly=False, pending=True, session=None)

        def ready(db, *_):
            done = dict(db.execute("SELECT id, offset FROM ingested"))
            return [p for p in paths if done.get(p.stem, 0) < p.stat().st_size]

        def accept(_label, _prompt, **kw):
            offered.extend(kw["sids"])
            return True

        with patch.multiple(I, MAX_CHARS=200, WIKI=ROOT, WORK=ROOT, QUEUE=ROOT / "queue",
                            LAST_ENGINE="fake"), \
                patch.object(I, "state", return_value=db), patch.object(I, "ready", ready), \
                patch.object(I, "extract", side_effect=lambda p, start: {
                    "text": p.stem + "x" * 120, "end": 1, "prompts": 1, "cwd": "/test", "title": "t"}), \
                patch.object(I, "split_pass"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "model_pass", accept), patch.object(I, "reject_streaks"), \
                patch.object(I, "log"):
            for n in range(3):
                I.run(args, engines=["fake"])
                self.assertEqual(len(offered), n + 1, "pending must yield after one accepted batch")
            self.assertEqual(len(set(offered)), 3)
            I.run(args, engines=["fake"])
            self.assertEqual(len(offered), 3)


if __name__ == "__main__":
    unittest.main()
