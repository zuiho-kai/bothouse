"""#1786：11-18 项目额度冷却，ws-handoff 每次认领全失败就新建一个工作区，涨到 37 个。
冷却 → 直接退出不新建；空闲工作区认领失败 → 不新建；同一件活 30 分钟内只新建一次。"""
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

COOL = "Error: team workspace claim: discord:a → w1: project model is cooling down after quota exhaustion (resets in 51h0m0s)"


class CoolingSprawl(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = patch.dict(os.environ, {"GATE_SETUP_DIR": self.tmp, "BOARD_DIR": self.tmp, "CC_DATA_DIR": self.tmp,
                                          "CC_BIN": "/usr/bin/false", "CC_PROJECT": "lead"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.mod = runpy.run_path(str(Path(__file__).with_name("ws-handoff")))
        self.g = self.mod["pick_pool"].__globals__
        self.calls = []
        self.g["lead_chat"] = lambda c: c
        self.g["release_stale_returned"] = lambda c: None
        self.g["migrate_unbound"] = lambda *a: False

        def ws_cmd(chat, *args):
            self.calls.append(args[0])
            if args[0] == "list":
                return {"parent": chat, "pool": [{"id": "w1", "name": "工作区1"}, {"id": "w2", "name": "工作区2"}]}
            return {"workspace": {"id": "w9", "name": "工作区9"}}
        self.g["ws_cmd"] = ws_cmd

    def run_claims(self, err, ok_new=True):
        def fake(cmd, **kw):
            wid = cmd[-1]
            if wid == "w9" and ok_new:
                return subprocess.CompletedProcess(cmd, 0, "", "")
            return subprocess.CompletedProcess(cmd, 1, "", err)
        return patch.object(self.g["subprocess"], "run", side_effect=fake)

    def test_cooling_exits_without_new(self):
        with self.run_claims(COOL), self.assertRaises(SystemExit) as cm:
            self.mod["pick_pool"]("discord:a", "t", 1778)
        self.assertIn("额度冷却", str(cm.exception))
        self.assertIn("resets in", str(cm.exception))
        self.assertNotIn("new", self.calls)

    def test_idle_claim_failure_does_not_create(self):
        with self.run_claims("Error: something odd"), self.assertRaises(SystemExit) as cm:
            self.mod["pick_pool"]("discord:a", "t", 5)
        self.assertIn("不新建", str(cm.exception))
        self.assertNotIn("new", self.calls)

    def test_busy_pool_creates_once_per_task(self):
        busy = "Error: team workspace claim: a → w: workspace belongs to another chat channel (a turn of task #3 is still running there)"
        with self.run_claims(busy):
            got = self.mod["pick_pool"]("discord:a", "t", 7)
        self.assertEqual(got[1], "工作区9")
        self.calls.clear()
        with self.run_claims(busy), self.assertRaises(SystemExit) as cm:
            self.mod["pick_pool"]("discord:a", "t", 7)
        self.assertIn("刚为它新建过", str(cm.exception))
        self.assertNotIn("new", self.calls)


if __name__ == "__main__":
    unittest.main()
