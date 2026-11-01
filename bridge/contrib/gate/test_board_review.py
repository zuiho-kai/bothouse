"""Task #797: use the real board CLI with isolated state and no bridge calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class HandbackReview(unittest.TestCase):
    def test_report_reject_rebind_and_accept(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, "BOARD_DIR": tmp, "CC_BIN": "false", "CC_PROJECT": "dispatcher"}
            env.pop("BOARD_PR_REPO", None)
            def cli(*args):
                p = subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args],
                                   env=env, text=True, capture_output=True, timeout=10)
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
            def item():
                return json.loads((Path(tmp) / "board.jsonl").read_text().strip())
            cli("add", "交回验收", "notes.md", "执行中", "worker", "--short", "交回验收")
            self.assertEqual(item()["dispatcher"], "dispatcher")
            data = item() | {"ws": "room:work", "chat": "room:chat", "sk": "room:work"}
            (Path(tmp) / "board.jsonl").write_text(json.dumps(data) + "\n")
            env["CC_PROJECT"] = "worker"
            cli("returned", "1", "worker")
            first = item()
            self.assertEqual(first["reviewer"], "dispatcher")
            self.assertNotIn("ws", first)
            self.assertEqual(first["ws_was"], "room:work")
            self.assertEqual(first["sk"], "room:chat")
            cli("returned", "1", "other")
            self.assertEqual(first["returned_at"], item()["returned_at"])
            cli("update", "1", "已交回待验收")
            self.assertEqual(item()["returned_at"], first["returned_at"])
            cli("reject", "1", "缺真实入口验证")
            self.assertNotIn("returned_at", item())
            self.assertIn("缺真实入口验证", item()["pause_why"])
            cli("returned", "1", "worker")
            self.assertNotEqual(first["returned_at"], item()["returned_at"])
            self.assertNotIn("paused", item())
            cli("done", "1", "1", "补入口验证")
            self.assertEqual((Path(tmp) / "board.jsonl").read_text().strip(), "")
            self.assertEqual(json.loads((Path(tmp) / "board-done.jsonl").read_text())["rework"], 1)


if __name__ == "__main__":
    unittest.main()
