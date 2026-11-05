"""gate 在 Windows 上起得来、任务板并发写不坏（PR #1011 补漏，CI 的 Windows 专项跑这一份；Mac/Linux 也能跑）。

- 各模块在没有 pwd / fcntl 的 Windows 上能 import；
- filelock 是真正的跨进程锁：另一进程持锁时 lock(wait=False) 拒绝，对方放手后拿得到；
- 多个进程同时 board add（照 board.cmd 的启动参数），每条都落盘、编号不重、board.jsonl 每行都是完整的 UTF-8 JSON。
隔离：数据目录、BOARD_DIR、HOME、USERPROFILE 全指到临时目录。
"""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _env(tmp):
    env = {k: v for k, v in os.environ.items() if k not in ("BOTHOUSE_DATA_DIR", "CC_DATA_DIR", "GATE_SETUP_DIR", "BOARD_DIR")}
    env.update(HOME=str(tmp), USERPROFILE=str(tmp), BOTHOUSE_DATA_DIR=str(tmp / ".bothouse"),
               BOARD_DIR=str(tmp / "team"), BOTHOUSE_TEST="1", PYTHONUTF8="1")
    return env


class WindowsCompat(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_modules_import(self):
        code = "import sys; sys.path.insert(0, sys.argv[1]); import datadir, filelock, board, memvote, lead; print('ok')"
        r = subprocess.run([sys.executable, "-I", "-c", code, str(HERE)], env=_env(self.tmp),
                           capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "ok")

    def test_filelock_across_processes(self):
        lockfile = self.tmp / "x.lock"
        ready, release = self.tmp / "ready", self.tmp / "release"
        holder = textwrap.dedent(f"""
            import sys, time, pathlib; sys.path.insert(0, {str(HERE)!r}); import filelock
            with open({str(lockfile)!r}, "w") as f:
                filelock.lock(f)
                pathlib.Path({str(ready)!r}).write_text("1")
                while not pathlib.Path({str(release)!r}).exists():
                    time.sleep(0.05)
        """)
        p = subprocess.Popen([sys.executable, "-I", "-c", holder], env=_env(self.tmp))
        try:
            for _ in range(200):
                if ready.exists():
                    break
                time.sleep(0.05)
            self.assertTrue(ready.exists(), "holder never took the lock")
            sys.path.insert(0, str(HERE))
            import filelock
            with open(lockfile, "w") as f:
                with self.assertRaises(BlockingIOError):
                    filelock.lock(f, wait=False)
            release.write_text("1")
            p.wait(timeout=30)
            with open(lockfile, "w") as f:
                filelock.lock(f, wait=False)
        finally:
            release.write_text("1")
            p.wait(timeout=30)

    def test_board_concurrent_add(self):
        n = 8
        env = _env(self.tmp)
        # 同 Windows 上的 board.cmd（core/lead_shims.go）：-I 会丢掉 PYTHONUTF8，所以带 -X utf8；不带时中文 Windows 写成 cp936
        procs = [subprocess.Popen([sys.executable, "-X", "utf8", "-I", str(HERE / "board.py"), "add", f"并发条目 {i}", f"path/{i}", "在做", "测试",
                                   "--short", f"c{i}"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                 for i in range(n)]
        for p in procs:
            out, err = p.communicate(timeout=120)
            self.assertEqual(p.returncode, 0, err.decode("utf-8", "replace"))
        lines = (self.tmp / "team" / "board.jsonl").read_text(encoding="utf-8").splitlines()
        rows = [json.loads(ln) for ln in lines if ln.strip()]  # 坏行在这里就会抛错
        ids = [r.get("id") for r in rows]
        self.assertEqual(len(rows), n, lines)
        self.assertEqual(len(set(ids)), n, ids)


if __name__ == "__main__":
    unittest.main(verbosity=2)
