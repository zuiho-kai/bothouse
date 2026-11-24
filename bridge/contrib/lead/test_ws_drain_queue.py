"""ws-handoff 从工作区里交活时按交活的聊天频道认领（11-08 工作区队列卡 5 天）。排队表 11-24 拿掉，排队的用例跟着删了。"""
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch


class DrainQueue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = patch.dict(os.environ, {"GATE_SETUP_DIR": self.tmp, "BOARD_DIR": self.tmp,
                                          "CC_BIN": "/usr/bin/false", "CC_PROJECT": "lead"})
        self.env.start()
        self.addCleanup(self.env.stop)
        # 别的测试先 import 过 board / _team 时，它们的目录（board.DIR、_team.SETUP → QUEUE）是那时的环境定的：
        # 丢掉缓存，按本测试的临时目录重新加载（lead 跟着 _team 重新 configure）
        for name in ("board", "datadir", "_team", "lead"):
            sys.modules.pop(name, None)
        self.mod = runpy.run_path(str(Path(__file__).with_name("ws-handoff")))
        self.g = self.mod["pick_pool"].__globals__
        self.state = Path(self.tmp) / "team_workspaces.json"
        # 替身按真 _ws_state 的语义来：team_workspaces.json 读不到就 {}
        self.g["_ws_state"] = lambda: json.loads(self.state.read_text()) if self.state.exists() else {}

    def test_lead_chat_maps_workspace_to_its_chat(self):
        self.state.write_text(json.dumps({
            "parents": {"room:main": [{"id": "w1", "name": "工作区1"}]},
            "handoffs": {"room:w2": [{"chat": "room:other"}, {"chat": "room:main"}], "room:w1": []},
        }))
        lead_chat = self.mod["lead_chat"]
        self.assertEqual(lead_chat("room:w1"), "room:main")    # 占着的工作区 → owner
        self.assertEqual(lead_chat("room:w2"), "room:main")    # 空着的工作区 → 最近一件交接的频道
        self.assertEqual(lead_chat("room:main"), "room:main")  # 聊天频道原样

    def test_notes_chat_wins_over_running_chat(self):
        # #1346：交接「原话出处」写的聊天频道和跑命令的不同 → 按交接的记；没写、相同、在工作区里跑 → 原样
        self.state.write_text(json.dumps({"parents": {"room:main": [{"id": "w1", "name": "工作区1"}]}, "handoffs": {}}))
        nc = self.mod["notes_chat"]
        src = "## 原话出处（程序附）\n- 聊天频道：room:mv\n- 时间窗：x\n"
        self.assertEqual(nc("# t\n" + src, "room:main"), "room:mv")
        self.assertEqual(nc("# t\n", "room:main"), "room:main")
        self.assertEqual(nc("# t\n" + src.replace("room:mv", "room:main"), "room:main"), "room:main")
        self.assertEqual(nc("# t\n" + src, "room:w1"), "room:w1")       # 工作区里跑：交给 lead_chat
        self.assertEqual(nc("# t\n" + src.replace("room:mv", "room:w1"), "room:main"), "room:main")  # 写的是工作区
        self.assertEqual(nc("# t\n" + src.replace("room:mv", "feishu:x"), "room:main"), "room:main")  # 跨平台
        self.assertEqual(nc("- 聊天频道：room:mv\n", "room:main"), "room:main")  # 不在原话出处节里不算


    def test_pick_pool_claims_as_chat_channel(self):
        self.state.write_text(json.dumps({"parents": {}, "handoffs": {"room:w2": [{"chat": "room:main"}]}}))
        seen = {}

        def ws_cmd(chat, *args):
            seen.setdefault("list", chat)
            return {"parent": chat, "pool": [{"id": "w3", "name": "工作区3"}]}

        class R:
            returncode = 0
        with patch.dict(self.g, {"ws_cmd": ws_cmd}), \
                patch.object(self.g["subprocess"], "run", side_effect=lambda cmd, **k: seen.setdefault("claim", cmd) and R()):
            got = self.mod["pick_pool"]("room:w2", "任务", 7)
        self.assertEqual(seen["list"], "room:main")
        self.assertIn("room:main", seen["claim"])
        self.assertEqual(got, ("room:w3", "工作区3", "room:main"))


if __name__ == "__main__":
    unittest.main()
