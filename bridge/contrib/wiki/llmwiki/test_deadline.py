"""Deadline regressions on isolated state and model processes; no live wiki."""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(tempfile.mkdtemp(prefix="wiki-deadline-"))
os.environ["WIKI_DIR"] = str(ROOT)
os.environ["WIKI_BRIDGE_CONFIG"] = str(ROOT / "missing.toml")
os.environ["AGENT_SESSIONS_DIR"] = str(ROOT / "sessions")
import ingest as I


class Deadline(unittest.TestCase):
    def test_expired_budget_does_not_start_model(self):
        with patch.dict(os.environ, WIKI_STOP_AT=str(time.time() - 1)), \
                patch.object(I.subprocess, "run") as run, patch.object(I.subprocess, "Popen") as popen:
            result = I.engine_run(["fake-model"], timeout=3600, capture_output=True, text=True)
        self.assertEqual(result.returncode, 124)
        run.assert_not_called()
        popen.assert_not_called()

    def test_remaining_budget_caps_a_model_call(self):
        started = time.monotonic()
        with patch.dict(os.environ, WIKI_STOP_AT=str(time.time() + 0.2)):
            result = I.engine_run([sys.executable, "-c", "import time; time.sleep(2)"],
                                  timeout=3, capture_output=True, text=True)
        self.assertEqual(result.returncode, 124)
        self.assertLess(time.monotonic() - started, 1.5)

    def test_expired_batch_retains_checkpoint_and_does_not_count_failure(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        db.execute("INSERT INTO pending_parts VALUES ('resume', 100, 'accepted-prefix pending-tail', 1)")
        item = dict(id="resume", end=100, _chunk="accepted-prefix pending-tail", _part=1,
                    path=ROOT / "resume.jsonl", title="t", cwd="/test", date="2026-11-10", text="pending-tail")
        with patch.dict(os.environ, WIKI_STOP_AT=str(time.time() - 1)), \
                patch.object(I, "model_pass", return_value=False) as model, \
                patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "reject_streaks"), patch.object(I, "log"):
            I.ingest_batches(db, [item], ["fake"], pending=True)
        model.assert_not_called()
        self.assertEqual(db.execute("SELECT part FROM pending_parts").fetchone(), (1,))
        self.assertFalse(db.execute("SELECT * FROM ingested").fetchall())
        self.assertFalse(db.execute("SELECT * FROM fails").fetchall())
        db.close()


if __name__ == "__main__":
    unittest.main()
