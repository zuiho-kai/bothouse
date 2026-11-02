"""ws-handoff --drain: a paused queued item is not picked up (2026-11-02 #70: paused by the user,
still in ws-queue.json, removed by hand so a freed workspace would not start it)."""
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
        self.g = self.mod["drain"].__globals__

    def test_paused_item_keeps_position_and_resumes_before_later_work(self):
        queue = Path(self.g["QUEUE"])
        queue.parent.mkdir(parents=True, exist_ok=True)
        queue.write_text(json.dumps([
            {"nid": 70, "path": "a", "task": "大群模式", "chat": "room:chat"},
            {"nid": 71, "path": "b", "task": "白名单", "chat": "room:chat"},
        ]))
        started = []
        items = [{"id": 70, "paused": "11-02 08:46", "pause_why": "用户：回头再弄"}, {"id": 71, "paused": ""}]
        with patch.object(self.g["board"], "items", return_value=items), \
                patch.dict(self.g, {"start": lambda path, task, chat, nid, *a: started.append(nid) or True}):
            self.mod["drain"]()
        self.assertEqual(started, [71])
        self.assertEqual([x["nid"] for x in json.loads(queue.read_text())], [70])
        waiting = json.loads(queue.read_text())
        waiting.append({"nid": 72, "path": "c", "task": "later", "chat": "room:chat"})
        queue.write_text(json.dumps(waiting))
        items[0]["paused"] = ""
        items.append({"id": 72})
        with patch.object(self.g["board"], "items", return_value=items),                 patch.dict(self.g, {"start": lambda path, task, chat, nid, *a: started.append(nid) or True}):
            self.mod["drain"]()
        self.assertEqual(started, [71, 70, 72])
        self.assertEqual(json.loads(queue.read_text()), [])


    def test_board_resume_drains_existing_queue_without_reclaiming_old_workspace(self):
        board = self.g["board"]
        queue = Path(self.g["QUEUE"])
        queue.parent.mkdir(parents=True, exist_ok=True)
        queue.write_text(json.dumps([{"nid": 70}]))
        item = {"id": 70, "paused": "11-02 08:46", "who": "工作区1", "ws_was": "room:old", "chat": "room:main"}
        with patch.object(board, "DIR", Path(self.tmp)), patch.object(board, "SETUP", queue.parent), patch.object(board, "auto_prune", return_value=[]), patch.object(board, "reoccupy", side_effect=AssertionError("must use queued position")), patch.object(board.subprocess, "run") as run:
            run.return_value.returncode = 0
            board._write([item])
            board.main(["resume", "70"])
            self.assertNotIn("paused", board.items()[0])
            self.assertTrue(any("--drain" in call.args[0] for call in run.call_args_list))

    def test_queued_pause_is_not_pruned_while_waiting_for_resume(self):
        board = self.g["board"]
        queue = Path(self.g["QUEUE"])
        queue.parent.mkdir(parents=True, exist_ok=True)
        queue.write_text(json.dumps([{"nid": 70}]))
        item = {"id": 70, "paused": "01-01 00:00", "at": "01-01 00:00"}
        with patch.object(board, "SETUP", queue.parent):
            self.assertIsNone(board.prune_why(item, [item], 1793577600, {}, idle_after=1))


if __name__ == "__main__":
    unittest.main()
