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

    def test_dsh_shares_the_remaining_budget_and_reaps_its_tree(self):
        """#1562 shape ①: the dsh stream used to run on its own 3600s timer, so the 90-minute window never reached it.
        Its model child and that child's own child must both stop when the deadline cuts the call."""
        root = Path(tempfile.mkdtemp(prefix="dsh-", dir=ROOT))
        beat = root / "beat"
        child = f"""import subprocess, sys, time
# the grandchild keeps no pipe of its own (a shared stdout would hide the EOF) and stops by itself at 15s, so a
# run that fails to reap it cannot hang the suite
p = subprocess.Popen([sys.executable, "-c", {repr("import time\nend = time.monotonic() + 15\nwhile time.monotonic() < end: open(" + repr(str(root / "grandchild")) + ", 'a').write('x'); time.sleep(0.05)")}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
end = time.monotonic() + 15
while time.monotonic() < end:
    open({repr(str(beat))}, 'a').write('x')
    time.sleep(0.05)
"""
        started = time.monotonic()
        with patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() + 2.2), WIKI_STOP_AT=""):
            r = I._dsh_stream([sys.executable, "-c", child], "task", timeout=3600)
        self.assertEqual(r["rc"], 124)
        self.assertLess(time.monotonic() - started, 4, "dsh ran past the job's deadline")
        sizes = [(beat.stat().st_size, (root / "grandchild").stat().st_size)]
        time.sleep(0.4)
        self.assertEqual(sizes[0], (beat.stat().st_size, (root / "grandchild").stat().st_size),
                         "dsh's model child or its grandchild outlived the deadline")

    def test_expired_budget_does_not_start_dsh(self):
        with patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() - 1), WIKI_STOP_AT=""), \
                patch.object(I.subprocess, "Popen") as popen:
            r = I._dsh_stream(["fake-dsh"], "task", timeout=3600)
        self.assertEqual(r["rc"], 124)
        popen.assert_not_called()

    @unittest.skipIf(os.name == "nt", "the dsh stream uses a POSIX process group")
    def test_dsh_finishes_tree_cleanup_before_return_and_rollback(self):
        """#648: EOF/parent exit must not let rollback race the timeout thread's SIGKILL."""
        import json
        import signal
        import threading

        root = Path(tempfile.mkdtemp(prefix="dsh-rollback-", dir=ROOT))
        helper = root / "model.py"
        helper.write_text('''import os, signal, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import filelock
root = Path(sys.argv[2])
signal.alarm(15)  # bounded fake model even if the test fails
if sys.argv[3:4] != ['child']:
    sys.stdin.read()
    (root / 'parent.pid').write_text(str(os.getpid()))
    subprocess.Popen([sys.executable, __file__, sys.argv[1], sys.argv[2], 'child'],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while not (root / 'ready').exists():
        time.sleep(0.01)
    while True:
        time.sleep(0.01)
else:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    with (root / 'model.lock').open('a') as lock:
        filelock.lock(lock, False)
        (root / 'ready').write_text(str(os.getpid()))
        while True:
            with (root / 'writes').open('a') as f:
                f.write('x')
            time.sleep(0.01)
''')
        real_stream, real_killpg, real_timer = I._dsh_stream, os.killpg, threading.Timer
        release_cleanup = threading.Event()
        timers, snapshots, thread_errors = [], {}, []

        def timer(*args, **kw):
            t = real_timer(*args, **kw)
            timers.append(t)
            return t

        def killpg(pid, sig):
            real_killpg(pid, sig)
            if sig == signal.SIGTERM:
                # Pin the reviewer's scheduling window: the parent exits while the timeout thread is paused.
                release_cleanup.wait(0.2)

        def snapshot(where):
            with (root / "model.lock").open("a") as lock:
                try:
                    I.filelock.lock(lock, False)
                    free = True
                except BlockingIOError:
                    free = False
            snapshots[where] = dict(lock_free=free, cleanup_done=not timers[0].is_alive(),
                                    writes=(root / "writes").stat().st_size)

        def stream(*args, **kw):
            result = real_stream(*args, **kw)
            snapshots["rc"] = result["rc"]
            snapshot("stream_return")  # no wait after return before checking the lock
            return result

        def rollback():
            snapshot("rollback_start")  # actual _one_pass failure/rollback boundary

        def run(args):
            self.assertFalse(I._model_pass("timeout-reap", "task", engine="dsh"))

        try:
            with patch.multiple(I, WIKI=root, WORK=root, REPO=root, HOME=root, LOG=root / "ingest.log",
                                USAGE=root / "usage.tsv", LOCK=root / ".ingest.lock", QUEUE=root / "queue",
                                MIRROR_TO=None, pull=lambda: None, prepare=lambda: None, push=lambda: None,
                                sync_work=lambda: None, discard=rollback, run=run, _dsh_stream=stream), \
                    patch.dict(I.CFG, dsh_cmd=[sys.executable, str(helper), str(Path(I.__file__).parent), str(root)],
                               dsh_patch=""), \
                    patch.object(I, "dsh_env", return_value={"PATH": os.defpath}), \
                    patch.object(threading, "Timer", side_effect=timer), patch.object(os, "killpg", side_effect=killpg), \
                    patch.object(threading, "excepthook", side_effect=lambda args: thread_errors.append(str(args.exc_value))), \
                    patch.object(sys, "argv", [str(Path(I.__file__)), "--pending"]), \
                    patch.dict(os.environ, CC_JOB_DEADLINE=str(time.time() + 3), WIKI_STOP_AT="", WIKI_INGEST=""):
                I.main()  # real ingest entry, dsh runner, stream and failed-pass path; no live data/model
                snapshot("ingest_return")
                with (root / ".ingest.lock").open("a") as lock:
                    I.filelock.lock(lock, False)
                snapshots["ingest_lock_free"] = True
            print("DSH return/rollback boundary: " + json.dumps(snapshots, sort_keys=True), flush=True)
            self.assertEqual(thread_errors, [], "timeout callback crashed instead of completing cleanup")
            self.assertEqual(snapshots["rc"], 124)
            for where in ("stream_return", "rollback_start", "ingest_return"):
                self.assertTrue(snapshots[where]["cleanup_done"], where + ": timeout callback still running")
                self.assertTrue(snapshots[where]["lock_free"], where + ": TERM-ignoring grandchild still holds lock")
            self.assertEqual(snapshots["stream_return"]["writes"], snapshots["ingest_return"]["writes"])
        finally:
            release_cleanup.set()
            for t in timers:
                t.join()

    def test_dsh_without_deadline_keeps_its_own_call_timeout(self):
        with patch.dict(os.environ, CC_JOB_DEADLINE="", WIKI_STOP_AT=""):
            r = I._dsh_stream([sys.executable, "-c", "import sys; print('{\"type\": \"final\", \"text\": \"ok\"}')"],
                              "task", timeout=30)
        self.assertEqual(r["rc"], 0)
        self.assertEqual(r["final"], "ok")

    def test_no_deadline_falls_back_to_the_job_window_and_reaches_the_child(self):
        """#1562 shape ②: the installed bridge passes no CC_JOB_DEADLINE, and two role-wiki runs then had no ceiling."""
        root = Path(tempfile.mkdtemp(prefix="fallback-", dir=ROOT))
        (root / "llmwiki").mkdir()
        source = Path(__file__).resolve().parent
        shutil.copy2(source.parent / "sub-wiki.py", root / "sub-wiki.py")
        shutil.copy2(source / "budget.py", root / "llmwiki" / "budget.py")
        role = root / "first"
        (role / "bin").mkdir(parents=True)
        (role / "bin" / "ingest.py").write_text(
            "import os\nopen(os.environ['WIKI_DIR'] + '/deadline', 'w').write(os.environ.get('CC_JOB_DEADLINE', 'missing'))\n")
        rows = f"{role.name} {role.name} {role}"
        (root / "export.py").write_text("import sys\nif '--list' in sys.argv: print(" + repr(rows) + ")\n")
        env = {k: v for k, v in os.environ.items() if k not in ("CC_JOB_DEADLINE", "WIKI_STOP_AT")}
        env["WIKI_BOTS"] = ""
        run = subprocess.run([sys.executable, "-I", str(root / "sub-wiki.py"), "pending"], env=env,
                             capture_output=True, text=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stderr)
        got = (root / "first" / "deadline").read_text()
        self.assertNotEqual(got, "missing", "no CC_JOB_DEADLINE reached the role ingest")
        self.assertNotEqual(got, "")
        left = float(got) - time.time()
        self.assertGreater(left, I.budget.FALLBACK_WINDOW - 60)
        self.assertLessEqual(left, I.budget.FALLBACK_WINDOW + 1)

    def test_fallback_keeps_a_real_deadline_and_an_explicit_unlimited_run(self):
        for deadline in (str(time.time() + 60), ""):
            with patch.dict(os.environ, CC_JOB_DEADLINE=deadline):
                I.budget._fallback_end = None
                self.assertIsNone(I.budget.window(5))
                self.assertEqual(os.environ["CC_JOB_DEADLINE"], deadline)
        I.budget._fallback_end = None

    def test_run_that_ends_at_the_deadline_releases_the_lock(self):
        """A run stopped by the job's window must leave .ingest.lock free for the next hourly job."""
        root = Path(tempfile.mkdtemp(prefix="lock-", dir=ROOT))
        lock = root / "lock"
        real_lock = I.filelock.lock

        def expire(a, engines=None):
            os.environ["CC_JOB_DEADLINE"] = str(time.time() - 1)

        with patch.multiple(I, LOCK=lock, QUEUE=root / "queue", MIRROR_TO=None, pull=lambda: None,
                            prepare=lambda: None, push=lambda: None, run=expire), \
                patch.object(sys, "argv", ["ingest.py", "--pending"]), \
                patch.dict(os.environ, WIKI_STOP_AT="", CC_JOB_DEADLINE=str(time.time() + 5)):
            I.main()
            with open(lock, "w") as f:  # the same call the next job makes: would raise BlockingIOError
                real_lock(f, False)

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
