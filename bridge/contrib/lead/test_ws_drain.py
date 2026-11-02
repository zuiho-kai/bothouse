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

    def test_paused_item_is_dropped_and_the_next_one_starts(self):
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
        self.assertEqual(json.loads(queue.read_text()), [])


if __name__ == "__main__":
    unittest.main()
