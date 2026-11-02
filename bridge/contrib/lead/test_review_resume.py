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
        with patch.object(self.g["board"], "pause_stale"), patch.dict(self.g, {
            "ws_cmd": lambda *args: {"parent": "room:chat", "pool": pool},
            "migrate_unbound": lambda *args: False,
        }), patch.object(self.g["subprocess"], "run", claim):
            got = self.mod["pick_pool"]("room:chat", "redo", preferred)
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

    def test_rejected_task_passes_preference_through_start(self):
        board = self.g["board"]
        seen = []
        def pick(*args):
            seen.append(args)
            return None
        with patch.object(board, "items", return_value=[{"id": 46, "ws_was": "room:3", "review_rejected": "test"}]), patch.dict(self.g, {"pick_pool": pick}):
            self.assertFalse(self.mod["start"]("notes", "redo", "room:chat", 46, "reviewer"))
        self.assertEqual(seen, [("room:chat", "redo", "room:3")])


if __name__ == "__main__":
    unittest.main()
