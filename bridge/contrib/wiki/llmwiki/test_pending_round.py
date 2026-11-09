"""Isolated pending-round regressions; no live sessions or model calls."""
import argparse
import json
import os
import re
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
    def test_main_releases_lock_and_leaves_new_hooks_for_next_round(self):
        root = Path(tempfile.mkdtemp(prefix="pending-entry-", dir=ROOT))
        queue, lock = root / "queue", root / "ingest.lock"
        paths = [root / f"{n:08d}-entry.jsonl" for n in range(3)]
        for p in paths:
            p.write_text(json.dumps({"type": "user", "message": {"content": p.stem + "x" * 120}}) + "\n")
        queue.write_text("\n".join(p.stem for p in paths) + "\n")
        offered = []

        def accept(_label, _prompt, **kw):
            offered.extend(kw["sids"])
            with queue.open("a") as f:
                f.write("arrived-during-model-call\n")
            return True

        with patch.multiple(I, MAX_CHARS=300, WIKI=root, WORK=root, STATE=root / "state.sqlite",
                            LOCK=lock, QUEUE=queue, MIRROR_TO=None, LAST_ENGINE="fake"), \
                patch.object(sys, "argv", ["ingest.py", "--pending"]), \
                patch.object(I, "transcripts", return_value={p.stem: p for p in paths}), \
                patch.object(I, "pull"), patch.object(I, "prepare"), patch.object(I, "push"), \
                patch.object(I, "split_pass"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "model_pass", accept), patch.object(I, "reject_streaks"), patch.object(I, "log"):
            for n in range(3):
                I.main()
                self.assertEqual(len(offered), n + 1)
                with lock.open("a") as f:
                    I.filelock.lock(f, False)
            I.main()
            self.assertEqual(len(offered), 3)
            self.assertEqual(len(set(offered)), 3)
            self.assertIn("arrived-during-model-call", queue.read_text())

    def test_pending_yields_and_resumes_without_repeating_accepted_sessions(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        paths = [ROOT / f"sess{n:04d}-tail.jsonl" for n in range(3)]
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

    def test_long_session_resumes_on_whole_record_boundaries(self):
        path = ROOT / "long-records.jsonl"
        lines = [json.dumps({"type": "user", "message": {"content": f"marker-{n} " + "x" * 50}}) + "\n"
                 for n in range(9)]
        path.write_text("".join(lines))
        offset, seen = 0, []
        with patch.object(I, "MAX_CHARS", 200):
            while offset < path.stat().st_size:
                it = I.pending_extract(path, offset)
                self.assertGreater(it["end"], offset)
                self.assertLessEqual(len(it["text"]), I.MAX_CHARS)
                self.assertTrue(path.read_bytes()[:it["end"]].endswith(b"\n"))
                seen.extend(re.findall(r"marker-\d+", it["text"]))
                offset = it["end"]
        self.assertEqual(seen, [f"marker-{n}" for n in range(9)])

    def test_pending_preserves_queued_closed_session_hints(self):
        queue = ROOT / "queue-hints"
        queue.write_text("still-active-but-closed\n")
        db = sqlite3.connect(":memory:")
        args = argparse.Namespace(lint=False, nightly=False, pending=True, session=None)
        with patch.multiple(I, WIKI=ROOT, WORK=ROOT, QUEUE=queue), \
                patch.object(I, "state", return_value=db), patch.object(I, "ready", return_value=[]):
            I.run(args)
        self.assertEqual(queue.read_text(), "still-active-but-closed\n")

    def test_one_oversized_record_checkpoints_each_accepted_piece(self):
        path = ROOT / "huge0001.jsonl"
        path.write_text(json.dumps({"type": "user", "message": {"content": "abcdefghij" * 90}}) + "\n")
        end = path.stat().st_size
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        args = argparse.Namespace(lint=False, nightly=False, pending=True, session=None)
        pieces = []

        def ready(db, *_):
            row = db.execute("SELECT offset FROM ingested WHERE id=?", (path.stem,)).fetchone()
            return [] if row and row[0] >= path.stat().st_size else [path]

        def accept(_label, _prompt, **kw):
            pieces.append(kw["context"])
            return True

        with patch.multiple(I, MAX_CHARS=200, WIKI=ROOT, WORK=ROOT, QUEUE=ROOT / "queue-huge", LAST_ENGINE="fake"), \
                patch.object(I, "state", return_value=db), patch.object(I, "ready", ready), \
                patch.object(I, "split_pass"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "model_pass", accept), patch.object(I, "reject_streaks"), patch.object(I, "log"):
            I.run(args, engines=["fake"])
            self.assertEqual(len(pieces), 1)
            self.assertIsNone(db.execute("SELECT offset FROM ingested").fetchone(), "tail is not accepted yet")
            self.assertEqual(db.execute("SELECT part FROM pending_parts").fetchone(), (1,))
            # A failed next call must retain the first accepted piece and byte offset.
            with patch.object(I, "model_pass", return_value=False):
                I.run(args, engines=["fake"])
            self.assertEqual(db.execute("SELECT part FROM pending_parts").fetchone(), (1,))
            # Later transcript growth must not alter the saved chunk or repeat its prefix.
            with path.open("a") as f:
                f.write(json.dumps({"type": "user", "message": {"content": "new-tail"}}) + "\n")
            while not db.execute("SELECT offset FROM ingested").fetchone():
                I.run(args, engines=["fake"])
            self.assertEqual(db.execute("SELECT offset FROM ingested").fetchone(), (end,))
            self.assertEqual("".join(pieces).count("abcdefghij"), 90)
            self.assertFalse(db.execute("SELECT * FROM pending_parts").fetchall())
            I.run(args, engines=["fake"])
            self.assertIn("new-tail", pieces[-1])
            self.assertEqual(db.execute("SELECT offset FROM ingested").fetchone(), (path.stat().st_size,))


if __name__ == "__main__":
    unittest.main()
