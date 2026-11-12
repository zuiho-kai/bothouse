"""#797: rejection keeps ownership-safe workspace preference, using fake bridge boundaries."""
import os
from pathlib import Path
import runpy
import tempfile
import types
import unittest
from unittest.mock import patch


class ReviewResume(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = patch.dict(os.environ, {"GATE_SETUP_DIR": self.tmp, "BOARD_DIR": self.tmp,
                                          "CC_BIN": "/usr/bin/false", "CC_PROJECT": "reviewer"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.mod = runpy.run_path(str(Path(__file__).with_name("ws-handoff")))
        self.g = self.mod["pick_pool"].__globals__

    def choose(self, pool, preferred):
        calls = []
        def claim(args, **kwargs):
            calls.append(args)
            return types.SimpleNamespace(returncode=0, stderr="")
        with patch.dict(self.g, {
            "ws_cmd": lambda *args: {"parent": "room:chat", "pool": pool},
            "migrate_unbound": lambda *args: False,
        }), patch.object(self.g["subprocess"], "run", claim):
            got = self.mod["pick_pool"]("room:chat", "redo", 46, preferred)
        return got, calls

    def test_original_workspace_first_only_when_free_and_owned(self):
        pool = [{"id": "1", "name": "工作区1", "open": 0},
                {"id": "3", "name": "工作区3", "open": 0}]
        got, calls = self.choose(pool, "room:3")
        self.assertEqual(got[0], "room:3")
        self.assertEqual(len(calls), 1)
        pool[1]["open"] = 1
        self.assertEqual(self.choose(pool, "room:3")[0][0], "room:1")
        pool[1].update(open=0, owner="room:other")
        self.assertEqual(self.choose(pool, "room:3")[0][0], "room:1")

    def test_full_pool_queues_without_claiming_busy_workspace(self):
        pool = [{"id": str(i), "name": f"工作区{i}", "open": 1}
                for i in range(self.mod["MAX_WS"])]
        got, calls = self.choose(pool, "room:3")
        self.assertIsNone(got)
        self.assertEqual(calls, [])

    def wake_fails(self, items, call):
        """#1492 L3 共用：真任务板写在临时目录，工作区挑中工作区3，叫醒（timer add）失败。"""
        import json
        board = self.g["board"]
        tmp = Path(self.tmp)
        (tmp / "board.jsonl").write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items))
        parked = []
        with patch.object(board, "DIR", tmp), patch.dict(self.g, {
                "pick_pool": lambda *a: ("room:3", "工作区3", "room:chat"),
                "QUEUE": tmp / "ws-queue.json", "cc_bin": lambda: "bothouse",
                "append_skeleton": lambda *a: None}), \
             patch.object(board, "_park_once", lambda *a, **k: parked.append(a) or True), \
             patch.object(board, "_del_timer", lambda *a: None), \
             patch.object(self.g["_recall"], "append_to", lambda *a: None), \
             patch.object(self.g["subprocess"], "run",
                          lambda *a, **k: types.SimpleNamespace(returncode=1, stdout="", stderr="timer 坏了")):
            with self.assertRaises(SystemExit) as cm:
                call()
            after = board.items()
        return str(cm.exception.code), after, parked

    def test_wake_fail_restores_board(self):
        # #1492 L3：叫醒失败原先只放回工作区，任务板停在「已交接」、绑着工作区3
        item = {"id": 46, "what": "redo", "where": "/n.md", "status": "排队", "chat": "room:chat", "at": "11-12 10:00"}
        msg, after, parked = self.wake_fails([item], lambda: self.mod["start"]("/n.md", "redo", "room:chat", 46, "reviewer"))
        self.assertEqual(after, [item])
        self.assertTrue(parked)
        self.assertIn("任务板已退回改前", msg)
        self.assertIn("工作区已放回", msg)

    def test_resume_wake_fail_restores_paused_item(self):
        notes = Path(self.tmp) / "n.md"
        notes.write_text("# 交接\n")
        item = {"id": 47, "what": "redo", "where": str(notes), "status": "验收退回：截图不对", "chat": "room:chat",
                "paused": "11-12 10:00", "pause_why": "验收退回：截图不对", "review_rejected": "截图不对", "at": "11-12 10:00"}
        msg, after, _ = self.wake_fails([item], lambda: self.mod["resume_answered"](47, "截图重截"))
        self.assertEqual(after, [item])
        self.assertIn("已退回接回前", msg)
        self.assertIn("没送到", notes.read_text())

    def test_rejected_task_passes_preference_through_start(self):
        board = self.g["board"]
        seen = []
        def pick(*args):
            seen.append(args)
            return None
        with patch.object(board, "items", return_value=[{"id": 46, "ws_was": "room:3", "review_rejected": "test"}]), patch.dict(self.g, {"pick_pool": pick}):
            self.assertFalse(self.mod["start"]("notes", "redo", "room:chat", 46, "reviewer"))
        self.assertEqual(seen, [("room:chat", "redo", 46, "room:3")])


if __name__ == "__main__":
    unittest.main()
