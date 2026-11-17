"""Exercise the real CLI in an isolated HOME; never contact the live bridge."""
import json
import os
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
        starter = subprocess.Popen(["/bin/zsh", "-c",
                                    '"$@"; print -r -- launcher-ready; read ignored',
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

    def test_missing_executable_has_synchronous_error(self):
        result = self.run_cli(str(self.home / "missing-command"))
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("运行号", result.stdout)
        self.assertIn("missing-command", result.stderr)


if __name__ == "__main__":
    unittest.main()
