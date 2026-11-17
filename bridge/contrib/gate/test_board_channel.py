"""#836：聊天频道里 board list 只列本频道派的活，--all 看全表标来源；别的频道的活续办、放行、转交、改板一律拒绝。
现场：#834 从频道 1561556710097952888 派出，主频道 1560508467733860372 跑 board list 看到它、ws-handoff --resume 续办成功。"""
import io, json, os, subprocess, sys, tempfile, unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = tempfile.mkdtemp(prefix="board-channel-")
os.environ.update(BOARD_DIR=TMP, GATE_SETUP_DIR=TMP, CC_BIN="/usr/bin/false")  # 隔离：不读写真实数据目录、不调桥
sys.path.insert(0, str(HERE))
import board  # noqa: E402
import ctxsvc  # noqa: E402

MAIN, OTHER, WS = "discord:1560508467733860372", "discord:1561556710097952888", "discord:1566614057933480026"
NOTES = os.path.join(TMP, "h834.md")
ITEMS = [  # 字段照 11-17 现场 #834 / #836
    {"id": 834, "what": "简历梳理", "where": NOTES, "status": "暂停", "who": "工作区7C酱", "at": "11-17 00:58",
     "chat": OTHER, "sk": OTHER, "ch": OTHER.split(":")[1], "ws_was": WS, "paused": "11-17 00:58"},
    {"id": 836, "what": "任务板串活", "where": "-", "status": "进行中", "who": "工作区1C酱", "at": "11-17 01:55",
     "chat": MAIN, "sk": "discord:1563964848755314753", "ch": "1563964848755314753", "ws": "discord:1563964848755314753"},
]


def run(tool, *args, key=MAIN):
    path = HERE / "board.py" if tool == "board" else HERE.parent / "lead" / tool
    env = dict(os.environ, CC_SESSION_KEY=key, WS_HANDOFF_INLINE="1")
    return subprocess.run([sys.executable, "-I", str(path), *args], capture_output=True, text=True, env=env, timeout=60)


class Channel(unittest.TestCase):
    def setUp(self):
        Path(NOTES).write_text("# h\n", encoding="utf-8")
        Path(TMP, "ws-handoff-last.json").write_text(json.dumps({"tasks": {}}), encoding="utf-8")
        Path(TMP, "board.jsonl").write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in ITEMS), encoding="utf-8")

    def test_list_only_this_channel(self):
        out = run("board", "list").stdout
        self.assertIn("#836", out)
        self.assertNotIn("#834", out)
        self.assertIn("别的频道还有 1 件", out)
        self.assertIn("#834", run("board", "list", key=OTHER).stdout)
        self.assertIn("#834", run("board", "list", key=WS).stdout)  # 它绑过的工作区照常看得到

    def test_list_all_marks_source(self):
        out = run("board", "list", "--all").stdout
        self.assertIn("#834 简历梳理", out)
        self.assertIn("来自 <#1561556710097952888>", out)

    def test_no_session_key_unchanged(self):
        env = {k: v for k, v in os.environ.items() if k != "CC_SESSION_KEY"}
        out = subprocess.run([sys.executable, "-I", str(HERE / "board.py")], capture_output=True, text=True, env=env).stdout
        self.assertIn("#834", out)
        self.assertIn("#836", out)

    def test_ctxsvc_same_filter(self):
        body = ctxsvc.board_items(MAIN)[0]["desc"]
        self.assertIn("#836", body)
        self.assertNotIn("#834", body)

    def test_writes_refused_elsewhere(self):
        for tool, args in [("board", ["update", "834", "接着做"]), ("board", ["resume", "834"]),
                           ("board", ["pause", "834"]), ("board", ["backlog", "834"]), ("board", ["done", "834", "0"]),
                           ("ws-handoff", ["--resume", "834", "接着做"]), ("ws-pass", ["--id", "834", "--verdict", "x"]),
                           ("ws-forward", ["--id", "834", "接着做"])]:
            r = run(tool, *args)
            self.assertNotEqual(r.returncode, 0, (tool, args))
            self.assertIn("这件是 <#1561556710097952888> 派的，到那边处理", r.stderr, (tool, args, r.stderr))
        self.assertTrue(next(i for i in board.items() if i["id"] == 834).get("paused"))  # 板子没动

    def test_own_channel_and_own_workspace_pass(self):
        self.assertIsNone(board.foreign_why(board.item_by_id(834), OTHER))
        self.assertIsNone(board.foreign_why(board.item_by_id(834), WS))
        self.assertIsNone(board.foreign_why(board.item_by_id(836), "discord:1563964848755314753"))
        self.assertIsNone(board.foreign_why(board.item_by_id(834), ""))
        self.assertEqual(run("board", "update", "836", "做到一半").returncode, 0)


if __name__ == "__main__":
    unittest.main()
