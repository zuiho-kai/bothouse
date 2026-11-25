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

    # lead_chat / notes_chat（工作区 → 它眼下的主人、交接「原话出处」的频道）11-25 #2010 删了：归属建活时定一次，
    # 不再按跑命令的地方或交接文字猜；它们的用例跟着删。pick_pool 收到的就是归属频道。

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
            got = self.mod["pick_pool"]("room:main", "任务", 7)  # 调用方给的是归属频道（#2010），pick_pool 不再改写
        self.assertEqual(seen["list"], "room:main")
        self.assertIn("room:main", seen["claim"])
        self.assertEqual(got, ("room:w3", "工作区3", "room:main"))


if __name__ == "__main__":
    unittest.main()
