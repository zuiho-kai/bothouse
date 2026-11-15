"""#779: resume completed tasks through the board CLI, keeping the original post."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent


class CompletedTaskResume(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="board-resume-779-"))
        self.state = self.root / "board"
        self.state.mkdir()
        self.setup = self.root / "setup"
        self.setup.mkdir()
        # A bridge request must fail locally rather than reach a running bridge.
        self.bridge = self.root / "no-bridge"
        self.bridge.write_text("#!/bin/sh\nprintf '%s\\n' 'workspace belongs to another chat channel' >&2\nexit 1\n")
        self.bridge.chmod(0o755)
        self.env = {**os.environ, "BOARD_DIR": str(self.state),
                    "GATE_SETUP_DIR": str(self.setup), "CC_BIN": str(self.bridge)}
        for name in ("CC_SESSION_KEY", "CC_SESSION", "CC_DATA_DIR", "BOARD_PR_REPO"):
            self.env.pop(name, None)
        self.active = self.state / "board.jsonl"
        self.archive = self.state / "board-done.jsonl"
        self.active.write_text("")
        self.post_map = self.state / "task_forum.json"
        self.post_map.write_text(json.dumps({"posts": {"779": {"thread": "original-post"}}}))
        self.original_map = self.post_map.read_bytes()
        self.record = {"id": 779, "what": "任务帖返工", "who": "G哥",
                       "status": "已完成", "done_at": "11-15 00:30",
                       "where": str(self.root / "handoff.md"),
                       "chat": "discord:1560508467733860372",
                       "post": "https://discord.com/channels/guild/original-post"}

    def cli(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args],
                              env=self.env, capture_output=True, text=True, timeout=10)

    def test_completed_and_accepted_restore_same_id_and_post(self):
        for accepted in (False, True):
            with self.subTest(accepted=accepted):
                self.active.write_text("")
                rec = dict(self.record)
                if accepted:
                    rec.update(review_accepted_at="2026-11-15T00:30:00Z",
                               returned_at="2026-11-15T00:20:00Z", reviewer="C酱")
                self.archive.write_text(json.dumps(rec) + "\n")
                p = self.cli("resume", "779")
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn("已恢复", p.stdout)
                row = json.loads(self.active.read_text())
                for key in ("id", "where", "chat", "post"):
                    self.assertEqual(row[key], rec[key])
                for key in ("done_at", "paused", "review_accepted_at", "returned_at", "reviewer"):
                    self.assertNotIn(key, row)
                self.assertNotEqual(row["status"], "已完成")
                self.assertEqual(self.archive.read_text(), "")
                self.assertEqual(self.post_map.read_bytes(), self.original_map)
                p = self.cli("resume", "779")
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertEqual(len(self.active.read_text().splitlines()), 1)

    def test_latest_completed_record_is_restored(self):
        old = {**self.record, "post": "older-post"}
        other = {**self.record, "id": 778}
        self.archive.write_text("".join(json.dumps(r) + "\n" for r in (old, other, self.record)))
        p = self.cli("resume", "779")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(json.loads(self.active.read_text())["post"], self.record["post"])
        self.assertEqual([json.loads(r) for r in self.archive.read_text().splitlines()], [old, other])

    def test_unknown_id_reports_reason_without_changing_records(self):
        self.archive.write_text(json.dumps(self.record) + "\n")
        before = (self.active.read_bytes(), self.archive.read_bytes())
        p = self.cli("resume", "99999")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("没有 #99999，先跑 board 看编号", p.stderr)
        self.assertEqual((self.active.read_bytes(), self.archive.read_bytes()), before)
        self.assertEqual(self.post_map.read_bytes(), self.original_map)

    def test_original_workspace_refusal_keeps_recovered_task_paused(self):
        rec = {**self.record, "who": "工作区3gge", "ws_was": "discord:old-workspace"}
        self.archive.write_text(json.dumps(rec) + "\n")
        p = self.cli("resume", "779")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("工作区暂停后被别的聊天频道领走了", p.stderr)
        self.assertIn("ws-handoff", p.stderr)
        row = json.loads(self.active.read_text())
        self.assertTrue(row["paused"])
        self.assertEqual(row["id"], 779)
        self.assertEqual(row["post"], rec["post"])
        self.assertEqual(self.post_map.read_bytes(), self.original_map)


if __name__ == "__main__":
    unittest.main()
