"""Exercise the real CLI in an isolated HOME; never contact the live bridge."""
import json
import os
import pty
import select
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent


class BgrunTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix="bgrun-", dir=os.environ.get("BGRUN_TEST_ROOT")))
        self.calls = self.home / "calls"
        bridge = self.home / "bridge"
        bridge.write_text(f"#!{sys.executable}\nimport json,sys\n"
                          f"with open({str(self.calls)!r}, 'a') as f: print(json.dumps(sys.argv[1:]), file=f)\n")
        bridge.chmod(0o755)
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.home),
                    "CC_BIN": str(bridge), "CC_PROJECT": "isolated",
                    "CC_SESSION": "test:workspace"}
        self.groups = []

    def tearDown(self):
        # A detached supervisor is the subject of the test; explicitly reclaim it.
        for path in (self.home / ".bothouse/runs").glob("*/pid"):
            self.groups.append(int(path.read_text()))
        for pgid in self.groups:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def run_cli(self, *command):
        return subprocess.run([str(HERE / "bgrun"), "probe", "10", *command],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def run_dir(self):
        runs = list((self.home / ".bothouse/runs").iterdir())
        self.assertEqual(len(runs), 1)
        return runs[0]

    def wait_file(self, path):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if path.exists() and path.read_text():
                return path.read_text()
            time.sleep(0.02)
        self.fail(f"missing receipt: {path}")

    def test_survives_launching_process_group_shutdown(self):
        # The launcher shares its process group with the caller, like an agent tool.
        starter = subprocess.Popen(["/bin/sh", "-c",
                                    '"$@"; echo launcher-ready; read ignored',
                                    "launcher", str(HERE / "bgrun"), "probe", "10",
                                    "/bin/sh", "-c", "sleep 0.5; echo survived"],
                                   env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, start_new_session=True)
        self.groups.append(starter.pid)
        try:
            output = starter.stdout.readline()
            self.assertIn("运行号", output)
            self.assertEqual(starter.stdout.readline().strip(), "launcher-ready")
            os.killpg(starter.pid, signal.SIGTERM)
            starter.wait(timeout=3)
            run = self.run_dir()
            self.assertEqual(self.wait_file(run / "exit").strip(), "0")
            self.assertEqual((run / "log").read_text().strip(), "survived")
            self.wait_file(self.calls)
            argv = json.loads(self.calls.read_text().splitlines()[0])
            self.assertEqual(argv[:6], ["timer", "add", "-p", "isolated", "-s", "test:workspace"])
            self.assertIn("--inject-if-busy", argv)
            self.assertEqual((run / "session").read_text().strip(), "test:workspace")
        finally:
            if starter.poll() is None:
                os.killpg(starter.pid, signal.SIGKILL)
                starter.wait()
            for stream in (starter.stdin, starter.stdout, starter.stderr):
                stream.close()

    def test_immediate_failure_is_not_reported_as_started(self):
        result = self.run_cli("/bin/sh", "-c", "echo intentional-failure >&2; exit 7")
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("运行号", result.stdout)
        self.assertIn("intentional-failure", result.stderr)
        self.assertEqual(self.wait_file(self.run_dir() / "exit").strip(), "7")
        self.wait_file(self.calls)

    def test_missing_executable_has_synchronous_error(self):
        result = self.run_cli(str(self.home / "missing-command"))
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("运行号", result.stdout)
        self.assertIn("missing-command", result.stderr)
        self.wait_file(self.calls)

    def test_survives_controlling_terminal_close(self):
        pid, master = pty.fork()
        if pid == 0:
            os.execve("/bin/sh", ["sh", "-c", '"$@"; exec sleep 5', "launcher",
                                 str(HERE / "bgrun"), "pty", "10", "/bin/sh", "-c",
                                 "sleep 0.5; echo terminal-closed"], self.env)
        self.groups.append(pid)
        try:
            self.assertTrue(select.select([master], [], [], 5)[0], "no startup response")
            self.assertIn("运行号", os.read(master, 8192).decode())
        finally:
            os.close(master)
            os.waitpid(pid, 0)
        run = self.run_dir()
        self.assertEqual(self.wait_file(run / "exit").strip(), "0")
        self.assertEqual((run / "log").read_text().strip(), "terminal-closed")
        self.wait_file(self.calls)

    def test_uses_bridge_resolved_directory(self):
        self.env["CC_RUNS_DIR"] = str(self.home / "bridge-data/runs")
        result = self.run_cli("/bin/echo", "shared-directory")
        self.assertEqual(result.returncode, 0, result.stderr)
        run = next(Path(self.env["CC_RUNS_DIR"]).iterdir())
        self.assertEqual(self.wait_file(run / "exit").strip(), "0")
        self.wait_file(self.calls)
        self.assertFalse((self.home / ".bothouse/runs").exists())

    def test_timeout_writes_exit_and_wakes(self):
        result = subprocess.run([str(HERE / "bgrun"), "timeout", "1", "/bin/sh", "-c", "sleep 10"],
                                env=self.env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.wait_file(self.run_dir() / "exit").strip(), "142")
        self.wait_file(self.calls)

    def test_zero_timeout_retains_unlimited_contract(self):
        result = subprocess.run([str(HERE / "bgrun"), "no-timeout", "0", "/bin/sh", "-c", "sleep 0.2; echo done"],
                                env=self.env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.wait_file(self.run_dir() / "exit").strip(), "0")
        self.wait_file(self.calls)

    def wait_calls(self, n):
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            if self.calls.exists() and len(self.calls.read_text().splitlines()) >= n:
                return [json.loads(l) for l in self.calls.read_text().splitlines()]
            time.sleep(0.05)
        self.fail(f"expected {n} wake calls")

    def test_two_successes_in_one_session_wake_once(self):
        # #1972: the first success waits for the other run of the same session; the last one wakes for both.
        self.assertEqual(self.run_cli("/bin/sh", "-c", "sleep 0.3").returncode, 0)
        self.assertEqual(self.run_cli("/bin/sh", "-c", "sleep 1.5").returncode, 0)
        calls = self.wait_calls(1)
        time.sleep(1.0)
        calls = [json.loads(l) for l in self.calls.read_text().splitlines()]
        self.assertEqual(len(calls), 1)
        prompt = calls[0][calls[0].index("--prompt") + 1]
        self.assertIn("先结束的", prompt)
        self.assertFalse(list((self.home / ".bothouse/runs").glob("*/wake-held")))

    def test_failure_wakes_at_once(self):
        # A non-zero exit is not held even while another run of the session is still going.
        self.assertEqual(self.run_cli("/bin/sh", "-c", "sleep 2").returncode, 0)
        self.assertEqual(self.run_cli("/bin/sh", "-c", "sleep 0.3; exit 4").returncode, 0)
        calls = self.wait_calls(1)
        self.assertIn("退出码 4", calls[0][calls[0].index("--prompt") + 1])
        self.assertEqual(len(self.wait_calls(2)), 2)

    def test_wake_entry_for_other_launchers(self):
        # #1972：本机 zsh 版 bgrun 结束时调 bgrun --wake <运行目录> <退出码>，同样按会话攒着
        root = self.home / ".bothouse/runs"
        live, done = root / "a", root / "b"
        for d in (live, done):
            d.mkdir(parents=True)
            (d / "session").write_text("test:workspace\n")
            (d / "log").write_text("")
        (live / "pid").write_text(f"{os.getpid()}\n")
        (done / "exit").write_text("0\n")
        env = dict(self.env, CC_SESSION_KEY="test:workspace")
        subprocess.run([str(HERE / "bgrun"), "--wake", str(done), "0"], env=env, check=True, timeout=10)
        self.assertTrue((done / "wake-held").exists())
        self.assertFalse(self.calls.exists())
        (live / "exit").write_text("0\n")
        subprocess.run([str(HERE / "bgrun"), "--wake", str(live), "0"], env=env, check=True, timeout=10)
        calls = self.wait_calls(1)
        self.assertIn("先结束的：运行号 b", calls[0][calls[0].index("--prompt") + 1])

if __name__ == "__main__":
    unittest.main()
