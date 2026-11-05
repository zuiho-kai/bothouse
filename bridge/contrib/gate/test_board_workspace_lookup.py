"""Issue #1111: a failed workspace lookup must not mutate or park a bound task."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


class WorkspaceLookup(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="board-lookup-"))
        self.board_dir = self.root / "team"
        self.board_dir.mkdir()
        self.path = self.board_dir / "board.jsonl"
        self.log = self.root / "bridge.log"
        self.fake = self.root / "bridge"
        self.fake.write_text(
            f"#!{sys.executable}\n"
            "import json, os, sys\n"
            "from pathlib import Path\n"
            "with Path(os.environ['LOOKUP_LOG']).open('a') as f: f.write(' '.join(sys.argv[1:]) + '\\n')\n"
            "mode = os.environ.get('LOOKUP_MODE', 'ok')\n"
            "if sys.argv[2] == 'list':\n"
            " if mode == 'exit': print('bridge unavailable', file=sys.stderr); sys.exit(1)\n"
            " if mode == 'bad-json': print('{'); sys.exit()\n"
            " if mode == 'bad-root': print('[]'); sys.exit()\n"
            " if mode == 'missing-pool': print('{}'); sys.exit()\n"
            " if mode == 'bad-pool': print('{\"pool\":{}}'); sys.exit()\n"
            " pool = [] if mode == 'missing-name' else [{'id':'201','name':'工作区1'}, {'id':'202','name':'工作区2'}]\n"
            " print(json.dumps({'pool':pool})); sys.exit()\n"
            "print(json.dumps({'freed': True}))\n", encoding="utf-8")
        self.fake.chmod(0o755)
        self.env = {**os.environ, "HOME": str(self.root), "USERPROFILE": str(self.root),
                    "BOARD_DIR": str(self.board_dir), "GATE_SETUP_DIR": str(self.root),
                    "BOTHOUSE_DATA_DIR": str(self.root), "CC_BIN": str(self.fake),
                    "LOOKUP_LOG": str(self.log), "BOARD_PR_REPO": ""}
        self.item = {"id": 1, "what": "修工作区绑定", "short": "绑定",
                     "status": "在做", "who": "肥鱼 201", "ws": "discord:201",
                     "chat": "discord:100", "sk": "discord:201", "ch": "201",
                     "where": "notes/task.md", "guard": "keep-timer",
                     "bound": "2026-11-05T09:00:00+00:00"}
        self.path.write_text(json.dumps(self.item, ensure_ascii=False) + "\n")

    def cli(self, who, mode="ok"):
        return subprocess.run([sys.executable, "-I", str(HERE / "board.py"),
                               "update", "1", "新状态", "new.md", who],
                              env={**self.env, "LOOKUP_MODE": mode},
                              capture_output=True, text=True, timeout=10)

    def test_failed_lookup_preserves_binding(self):
        before = self.path.read_bytes()
        for mode in ("exit", "bad-json", "bad-root", "missing-pool", "bad-pool", "missing-name"):
            with self.subTest(mode=mode):
                self.path.write_bytes(before)
                p = self.cli("工作区1肥鱼", mode)
                self.assertNotEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn("查询", p.stderr)
                self.assertEqual(self.path.read_bytes(), before)
                self.assertFalse((self.board_dir / "board-events.jsonl").exists())
        calls = self.log.read_text()
        self.assertNotIn("claim", calls)
        self.assertNotIn("park", calls)
        self.assertNotIn("timer", calls)

    def test_timeout_and_oserror_preserve_binding(self):
        with patch.dict(os.environ, self.env):
            import board
            before = self.path.read_bytes()
            for error in (subprocess.TimeoutExpired("workspace list", 1), OSError("bridge unavailable")):
                with self.subTest(error=type(error).__name__), patch.object(board, "DIR", self.board_dir), \
                        patch.object(board.subprocess, "run", side_effect=error) as run:
                    self.path.write_bytes(before)
                    with self.assertRaises(SystemExit) as caught:
                        board.main(["update", "1", "新状态", "new.md", "工作区1肥鱼"])
                    self.assertIn("查询", str(caught.exception))
                    self.assertEqual(self.path.read_bytes(), before)
                    self.assertEqual(run.call_count, 1)

    def test_same_workspace_keeps_binding_without_claim_or_park(self):
        p = self.cli("工作区1肥鱼")
        self.assertEqual(p.returncode, 0, p.stderr)
        item = json.loads(self.path.read_text())
        self.assertEqual(item["ws"], self.item["ws"])
        self.assertEqual(item["guard"], self.item["guard"])
        self.assertEqual(item["status"], "新状态")
        self.assertNotIn("claim", self.log.read_text())
        self.assertNotIn("park", self.log.read_text())

    def test_other_workspace_claims_then_parks_old_workspace(self):
        p = self.cli("工作区2肥鱼")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(self.path.read_text())["ws"], "discord:202")
        calls = self.log.read_text()
        self.assertLess(calls.index("workspace claim 202"), calls.index("workspace park"))
        self.assertIn("--session-key discord:201", calls)

    def test_waiting_owner_still_parks(self):
        p = self.cli("待接手")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("ws", json.loads(self.path.read_text()))
        calls = self.log.read_text()
        self.assertIn("workspace park", calls)
        self.assertNotIn("workspace list", calls)


if __name__ == "__main__":
    unittest.main()
