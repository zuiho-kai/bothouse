"""Portable gate regressions; all subprocess data stays in a temporary home."""
import json
import http.client
import os
from pathlib import Path
import subprocess
import socket
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent


class GateCompatibility(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("GATE_", "BOARD_", "CC_", "BOTHOUSE_", "MEMVOTE_"))}
        self.env.update(HOME=str(self.home), USERPROFILE=str(self.home),
                        BOTHOUSE_DATA_DIR=str(self.home / "data"),
                        BOARD_DIR=str(self.home / "board"), MEMVOTE_DIR=str(self.home),
                        BOTHOUSE_TEST="1", PYTHONUTF8="1", CC_BIN="false")

    def start(self, code):
        proc = subprocess.Popen([sys.executable, "-I", "-X", "utf8", "-c",
                                 f"import sys; sys.path.insert(0, {str(HERE)!r}); " + code],
                                env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8")
        self.addCleanup(self.cleanup_process, proc)
        return proc

    def cleanup_process(self, proc):
        if proc.poll() is None:
            proc.kill()
        proc.communicate()

    def finish(self, proc):
        try:
            out, err = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            self.fail("isolated gate subprocess timed out")
        self.assertEqual(proc.returncode, 0, err)
        return out

    def test_imports_keep_board_enabled_without_unix_modules(self):
        self.finish(self.start("import datadir, board, memvote, ctxsvc; assert ctxsvc.board is not None"))

    def test_account_home_does_not_follow_sandbox_environment(self):
        self.finish(self.start("from pathlib import Path; import datadir; "
                               "assert datadir._account_home().resolve() != Path.home().resolve()"))

    def test_guard_still_rejects_live_data_with_overridden_home(self):
        live = self.home / "account/.bothouse"
        live.mkdir(parents=True)
        (live / "config.toml").write_text("# fixture", encoding="utf-8")
        code = ("import datadir; from pathlib import Path; "
                f"datadir._account_home = lambda: Path({str(live.parent)!r}); "
                f"datadir.guard(Path({str(live / 'roles')!r}))")
        proc = self.start(code)
        out, err = proc.communicate(timeout=15)
        self.assertNotEqual(proc.returncode, 0, out)
        self.assertIn("测试碰到了线上数据目录", err)

    def test_file_lock_waits_past_crt_retry_limit_and_releases_on_error(self):
        sys.path.insert(0, str(HERE))
        from filelock import exclusive
        lock, ready, acquired = (self.home / n for n in ("lock", "ready", "acquired"))
        with exclusive(lock):
            code = ("from pathlib import Path; from filelock import exclusive; "
                    f"Path({str(ready)!r}).touch()\n"
                    f"with exclusive({str(lock)!r}):\n Path({str(acquired)!r}).touch()")
            proc = self.start(code)
            deadline = time.monotonic() + 10
            while not ready.exists() and proc.poll() is None and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(ready.exists(), "competing process did not start")
            time.sleep(11)  # msvcrt.LK_LOCK alone gives up after ten attempts.
            self.assertIsNone(proc.poll(), "competing process stopped waiting")
            self.assertFalse(acquired.exists())
        self.finish(proc)
        self.assertTrue(acquired.exists())
        with self.assertRaises(RuntimeError):
            with exclusive(lock):
                raise RuntimeError("release on exception")
        self.finish(self.start(f"from filelock import exclusive\nwith exclusive({str(lock)!r}): pass"))

    def test_gate_real_entrypoint_serves_isolated_whoami(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.env["GATE_PORT"] = str(port)
        team = self.home / "team.json"
        team.write_text(json.dumps({"lead": {"name": "test"}, "subs": {}}), encoding="utf-8")
        self.env["GATE_TEAM"] = str(team)
        proc = self.start(f"import runpy; runpy.run_path({str(HERE / 'gate.py')!r}, run_name='__main__')")
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                self.finish(proc)
                self.fail("gate exited before serving HTTP")
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
            try:
                conn.request("GET", "/whoami")
                response = conn.getresponse()
                body = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(Path(body["data_dir"]).resolve(), (self.home / "data").resolve())
                return
            except OSError:
                time.sleep(0.1)
            finally:
                conn.close()
        self.fail("gate did not serve /whoami")

    def test_board_concurrent_writers_preserve_every_task(self):
        procs = [self.start(f"import board; board.add('task {i}', '-', 'doing', 'role', short_name='task')")
                 for i in range(8)]
        for proc in procs:
            self.finish(proc)
        rows = [json.loads(s) for s in (self.home / "board/board.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 8)
        self.assertEqual(len({r["id"] for r in rows}), 8)
        self.assertEqual({r["what"] for r in rows}, {f"task {i}" for i in range(8)})

    def test_memvote_concurrent_writers_preserve_scores(self):
        procs = [self.start(f"import memvote; memvote.record('role{i}', [('page#0123456789', 1)])")
                 for i in range(8)]
        for proc in procs:
            self.finish(proc)
        scores = json.loads((self.home / "scores.json").read_text(encoding="utf-8"))
        self.assertEqual(scores["page#0123456789"], 10)
        self.assertEqual(len((self.home / "votes.jsonl").read_text(encoding="utf-8").splitlines()), 8)


if __name__ == "__main__":
    unittest.main()
