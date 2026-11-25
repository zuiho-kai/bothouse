"""ws-handoff no longer keeps a queue (removed 2026-11-24): an answered task is started directly.
board.py still reads ws-queue.json left by older versions and still calls `ws-handoff --drain` (now a no-op)."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


class Drain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = patch.dict(os.environ, {"GATE_SETUP_DIR": self.tmp, "BOARD_DIR": self.tmp,
                                          "CC_BIN": "/usr/bin/false", "CC_PROJECT": "lead"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.mod = runpy.run_path(str(Path(__file__).with_name("ws-handoff")))
        self.g = self.mod["resume_answered"].__globals__


    def test_board_resume_drains_existing_queue_without_reclaiming_old_workspace(self):
        board = self.g["board"]
        queue = Path(self.tmp) / "ws-queue.json"
        queue.parent.mkdir(parents=True, exist_ok=True)
        queue.write_text(json.dumps([{"nid": 70}]))
        item = {"id": 70, "paused": "11-02 08:46", "who": "工作区1", "ws_was": "room:old", "chat": "room:main"}
        with ExitStack() as stack:
            stack.enter_context(patch.object(board, "DIR", Path(self.tmp)))
            stack.enter_context(patch.object(board, "SETUP", queue.parent))
            stack.enter_context(patch.object(board, "auto_prune", return_value=[]))
            stack.enter_context(patch.object(board, "reoccupy", side_effect=AssertionError("must use queued position")))
            run = stack.enter_context(patch.object(board.subprocess, "run"))
            run.return_value.returncode = 0
            board._write([item])
            board.main(["resume", "70"])
            self.assertNotIn("paused", board.items()[0])
            self.assertTrue(any("--drain" in call.args[0] for call in run.call_args_list))

    def test_answered_item_is_started_directly_once(self):
        board = self.g["board"]
        queue = Path(self.tmp) / "ws-queue.json"
        queue.parent.mkdir(parents=True, exist_ok=True)
        notes = Path(self.tmp) / "handoff.prompt"
        notes.write_text("handoff")
        queue.write_text(json.dumps([  # 旧版本留下的排队表：不再读，也不再顺带派里面别的活
            {"nid": 69, "path": "earlier", "task": "earlier", "chat": "room:main"},
            {"nid": 70, "path": str(notes), "task": "paused", "chat": "room:main"},
        ]))
        items = [{"id":69}, {"id":70, "what":"paused", "where":str(notes), "chat":"room:main", "paused":"11-02 08:46"}]
        started = []
        def start(path, task, chat, nid, project, answer=None, reassigned=False):
            started.append((nid,answer))
        with ExitStack() as stack:
            stack.enter_context(patch.object(board,"items",return_value=items))
            stack.enter_context(patch.object(board,"resume",side_effect=lambda nid: items[1].pop("paused")))
            stack.enter_context(patch.object(board,"append_forward"))
            stack.enter_context(patch.object(self.g["_recall"],"append_to"))
            stack.enter_context(patch.dict(self.g,{"start":start}))
            self.mod["resume_answered"](70,"continue with evidence")
        # 续派时主角色写的那句标「只作参考」再给工作区（#1956，用户 11-24 批：主角色的话只作参考，用户原话才是准绳）
        self.assertEqual(started,[(70,"主角色的话（只作参考）：continue with evidence")])

    def test_queued_pause_is_not_pruned_while_waiting_for_resume(self):
        board = self.g["board"]
        queue = Path(self.tmp) / "ws-queue.json"
        queue.parent.mkdir(parents=True, exist_ok=True)
        queue.write_text(json.dumps([{"nid": 70}]))
        item = {"id": 70, "paused": "01-01 00:00", "at": "01-01 00:00"}
        with patch.object(board, "SETUP", queue.parent):
            self.assertIsNone(board.prune_why(item, [item], 1793577600, {}, idle_after=1))


if __name__ == "__main__":
    unittest.main()
