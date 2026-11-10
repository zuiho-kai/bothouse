"""Deadline regressions on isolated state and model processes; no live wiki."""
import os
from pathlib import Path
import sqlite3
import socket
import shutil
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
    def test_real_sub_wiki_entry_yields_then_resumes_other_roles(self):
        root = Path(tempfile.mkdtemp(prefix="entry-", dir=ROOT))
        (root / "llmwiki").mkdir()
        source = Path(__file__).resolve().parent
        shutil.copy2(source.parent / "sub-wiki.py", root / "sub-wiki.py")
        shutil.copy2(source / "budget.py", root / "llmwiki" / "budget.py")
        roles = [root / "first", root / "second"]
        for role in roles:
            (role / "bin").mkdir(parents=True)
            (role / "bin" / "ingest.py").write_text(r'''import os, sys, time
from pathlib import Path
root = Path(os.environ['WIKI_DIR'])
if not (root / 'checkpoint').exists():
    with (root / 'calls').open('a') as f:
        f.write(os.environ.get('CC_JOB_DEADLINE', '') + '\n')
    (root / 'checkpoint').write_text('accepted')
    if os.environ.get('CC_JOB_DEADLINE'):
        sys.path.insert(0, str(root.parent / 'llmwiki'))
        import budget
        time.sleep(max(0, budget.remaining()) + 0.01)
''')
        rows = "\n".join(f"{r.name} {r.name} {r}" for r in roles)
        (root / "export.py").write_text("import sys\nif '--list' in sys.argv: print(" + repr(rows) + ")\n")
        env = dict(os.environ, WIKI_STOP_AT="", CC_JOB_DEADLINE=str(time.time() + 3))
        command = [sys.executable, "-I", str(root / "sub-wiki.py"), "pending"]
        first = subprocess.run(command, env=env, capture_output=True, text=True, timeout=5)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual((roles[0] / "checkpoint").read_text(), "accepted")
        self.assertFalse((roles[1] / "checkpoint").exists(), "next role started after budget expired")
        self.assertEqual((roles[0] / "calls").read_text().strip(), env["CC_JOB_DEADLINE"])
        second = subprocess.run(command, env=dict(env, CC_JOB_DEADLINE=""),
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual((roles[1] / "checkpoint").read_text(), "accepted")
        self.assertEqual(len((roles[0] / "calls").read_text().splitlines()), 1)

    def test_soft_stop_does_not_interrupt_a_running_batch_call(self):
        with patch.dict(os.environ, WIKI_STOP_AT=str(time.time() - 1), CC_JOB_DEADLINE=""):
            result = I.engine_run([sys.executable, "-c", "print('accepted')"],
                                  timeout=3, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "accepted")

    def test_timeout_reclaims_descendants_even_after_model_parent_exits(self):
        helper = ROOT / "model-tree.py"
        helper.write_text('''import json, os, signal, socket, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import filelock
root = Path(sys.argv[2])
if sys.argv[3] != 'child':
    p = subprocess.Popen([sys.executable, __file__, sys.argv[1], sys.argv[2], 'child'])
    if sys.argv[3] == 'orphan':
        until = time.monotonic() + 3
        while not (root / 'ready.json').exists() and time.monotonic() < until:
            time.sleep(0.01)
        sys.exit(0)
    p.wait()
else:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    with (root / 'model.lock').open('a') as lock:
        filelock.lock(lock, False)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            s.listen()
            (root / 'ready.json').write_text(json.dumps({'port': s.getsockname()[1], 'pid': os.getpid()}))
            until = time.monotonic() + 3
            while time.monotonic() < until:
                with (root / 'writes').open('a') as f:
                    f.write('x')
                time.sleep(0.01)
''')
        import json
        for mode in ("parent", "orphan"):
            with self.subTest(mode=mode):
                root = Path(tempfile.mkdtemp(prefix=mode + "-", dir=ROOT))
                unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3)"])
                try:
                    with patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() + 2.5)):
                        result = I.engine_run([sys.executable, str(helper), str(Path(I.__file__).parent),
                                               str(root), mode], timeout=4, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 124)
                    ready = json.loads((root / "ready.json").read_text())
                    before = (root / "writes").read_bytes()
                    time.sleep(0.05)
                    self.assertEqual((root / "writes").read_bytes(), before, "timed-out child kept writing")
                    with socket.socket() as s:
                        self.assertNotEqual(s.connect_ex(("127.0.0.1", ready["port"])), 0)
                    with (root / "model.lock").open("a") as lock:
                        I.filelock.lock(lock, False)
                    self.assertIsNone(unrelated.poll(), "pre-existing process was killed")
                finally:
                    if unrelated.poll() is None:
                        unrelated.kill()
                    unrelated.wait(timeout=3)

    def test_expired_budget_does_not_start_model(self):
        with patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() - 1)), \
                patch.object(I.subprocess, "run") as run, patch.object(I.subprocess, "Popen") as popen:
            result = I.engine_run(["fake-model"], timeout=3600, capture_output=True, text=True)
        self.assertEqual(result.returncode, 124)
        run.assert_not_called()
        popen.assert_not_called()

    def test_remaining_budget_caps_a_model_call(self):
        started = time.monotonic()
        with patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() + 2.2)):
            result = I.engine_run([sys.executable, "-c", "import time; time.sleep(2)"],
                                  timeout=3, capture_output=True, text=True)
        self.assertEqual(result.returncode, 124)
        self.assertLess(time.monotonic() - started, 1.5)

    def test_failed_tree_lookup_still_reaps_model_parent(self):
        started = time.monotonic()
        with patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() + 2.2)), \
                patch.object(I.budget, "processes", side_effect=[[], subprocess.TimeoutExpired("ps", 2)]):
            result = I.engine_run([sys.executable, "-c", "import time; time.sleep(3)"],
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

    def test_budget_expires_during_batch_without_advancing_or_counting_failure(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        db.execute("INSERT INTO pending_parts VALUES ('resume', 100, 'accepted-prefix pending-tail', 1)")
        db.execute("INSERT INTO fails VALUES ('resume', 1)")
        item = dict(id="resume", end=100, _chunk="accepted-prefix pending-tail", _part=1,
                    path=ROOT / "resume.jsonl", title="t", cwd="/test", date="2026-11-10", text="pending-tail")
        def timeout(*args, **kwargs):
            os.environ["CC_JOB_DEADLINE"] = str(time.time() - 1)
            return False
        with patch.dict(os.environ, WIKI_STOP_AT="", CC_JOB_DEADLINE=""), \
                patch.object(I, "model_pass", side_effect=timeout) as model, \
                patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "reject_streaks"), patch.object(I, "log"):
            I.ingest_batches(db, [item], ["fake"], pending=True)
        model.assert_called_once()
        self.assertEqual(db.execute("SELECT part FROM pending_parts").fetchone(), (1,))
        self.assertEqual(db.execute("SELECT n FROM fails").fetchone(), (1,))
        self.assertFalse(db.execute("SELECT * FROM ingested").fetchall())
        db.close()


if __name__ == "__main__":
    print(f"Isolated artifacts: {ROOT}", flush=True)
    unittest.main()
