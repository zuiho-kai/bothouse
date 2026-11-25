"""board pause 记 halted（#2005）：python3 -I test_board_pause_halted.py
有人用 board pause 叫停的条目记 halted，桥（core/team_lead_autowake.go stopWakesLead）见到它不叫醒主角色续派；
等外部（board wait）不记，恢复后撤掉。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHAT = "discord:1"


class PauseHalted(unittest.TestCase):
    def setUp(self):
        root = Path(tempfile.mkdtemp(prefix="board-halted-2005-"))
        self.state = root / "board"
        self.state.mkdir()
        (root / "setup").mkdir()
        bridge = root / "fake-bridge"  # 不碰线上桥：状态转换回「桥没记过」，别的桥命令（定时、放回）本地失败
        bridge.write_text('#!/bin/sh\n[ "$2" = transition ] && { echo \'{"known": false}\'; exit 0; }\nexit 1\n')
        bridge.chmod(0o755)
        self.env = {**os.environ, "BOARD_DIR": str(self.state), "GATE_SETUP_DIR": str(root / "setup"),
                    "CC_BIN": str(bridge), "CC_SESSION_KEY": CHAT, "CC_PROJECT": "maomao"}
        for k in ("CC_SESSION", "CC_DATA_DIR", "BOARD_PR_REPO"):
            self.env.pop(k, None)
        rows = [{"id": n, "what": f"活{n}", "short": f"活{n}", "who": "工作区1橘", "status": "在做", "at": "11-25 14:00",
                 "where": str(root / "x.md"), "chat": CHAT, "sk": CHAT, "dispatcher": "maomao"} for n in (7, 8)]
        (self.state / "board.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))

    def cli(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "board.py"), *args],
                              env=self.env, capture_output=True, text=True, timeout=20)

    def row(self, nid):
        for l in (self.state / "board.jsonl").read_text().splitlines():
            if json.loads(l)["id"] == nid:
                return json.loads(l)

    def test_board_pause_marks_halted(self):
        p = self.cli("pause", "7", "等负责人看：先别做，等他看一下")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(self.row(7).get("halted"))
        p = self.cli("wait", "8", "下载依赖", "120")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertTrue(self.row(8).get("paused"))
        self.assertNotIn("halted", self.row(8))
        p = self.cli("resume", "7")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("halted", self.row(7))


if __name__ == "__main__":
    unittest.main()
