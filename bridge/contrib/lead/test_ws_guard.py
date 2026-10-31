"""兜底定时器：ws-handoff 交活挂上、交回/提问/暂停/改派撤掉、ws-forward 重挂。桥是假脚本，全在临时目录里跑。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class WsGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.setup = self.tmp / "setup"
        self.setup.mkdir()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        self.calls = self.tmp / "calls.jsonl"
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\nimport json,sys\n"
                        f"open({str(self.calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\n"
                        f"n=sum(1 for _ in open({str(self.calls)!r}))\nprint(f'Timer created: t{{n}}')\n")
        fake.chmod(0o755)
        self.notes = self.tmp / "notes.md"
        self.notes.write_text("# 用户原话\n- 做\n# 总目标\n# 进度\n# 相关改动\n冲突：无\n# 规矩\n# 参照实现\n无（新建）\n", encoding="utf-8")
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOARD_DIR": str(self.tmp / "board"), "BOTHOUSE_DATA_DIR": str(self.tmp / "data"),
                    "CC_BIN": str(fake), "CC_PROJECT": "lead-proj", "WS_CHANNEL": "900", "CC_SESSION_KEY": "test:100"}

    def run_tool(self, name, *args):
        cmd = ["/bin/sh", str(HERE / name)] if name == "board" else [sys.executable, "-I", str(HERE / name)]
        if name == "ws-handoff" and "--short" not in args:
            args = (*args, "--short", "测试")  # ws-handoff 要短名（10-30）
        return subprocess.run([*cmd, *args], capture_output=True, text=True, env=self.env)

    def calls_of(self, sub):
        out = [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []
        return [c for c in out if c[:2] == ["timer", sub]]

    def guards(self):
        return [c for c in self.calls_of("add") if "--desc" in c and c[c.index("--desc") + 1].startswith("兜底")]

    def item(self):
        rows = [json.loads(l) for l in (self.tmp / "board" / "board.jsonl").read_text().splitlines() if l.strip()]
        return rows[0] if rows else None

    def handoff(self, *extra):
        r = self.run_tool("ws-handoff", str(self.notes), "测一件活", *extra)
        self.assertEqual(r.returncode, 0, r.stderr)
        return self.item()

    def test_handoff_arms_guard_in_chat(self):
        it = self.handoff()
        g = self.guards()
        self.assertEqual(len(g), 1)
        self.assertEqual(g[0][g[0].index("-s") + 1], "test:100")  # 挂在交活的聊天频道，不在工作区
        self.assertEqual(g[0][g[0].index("--delay") + 1], "30m")
        self.assertEqual(it["guard"], "t2")  # 第 1 个 timer 是叫醒工作区

    def test_guard_duration_flag(self):
        self.handoff("--guard", "2h")
        g = self.guards()[0]
        self.assertEqual(g[g.index("--delay") + 1], "2h")
        self.assertNotEqual(self.run_tool("ws-handoff", str(self.notes), "x", "--guard", "abc").returncode, 0)

    def test_report_close_disarms(self):
        it = self.handoff()
        self.assertEqual(self.run_tool("board", "update", str(it["id"]), "已完成").returncode, 0)
        self.assertEqual([c[2] for c in self.calls_of("del")], ["t2"])

    def test_ask_and_pause_disarm(self):
        for cmd in (["ask"], ["pause"]):
            self.calls.unlink(missing_ok=True)
            (self.tmp / "board").exists() and [p.unlink() for p in (self.tmp / "board").iterdir() if p.is_file()]
            it = self.handoff()
            self.assertEqual(self.run_tool("board", *cmd, str(it["id"])).returncode, 0)
            self.assertIn(it["guard"], [c[2] for c in self.calls_of("del")], cmd)
            self.assertNotIn("guard", self.item())

    def test_reassign_disarms(self):
        it = self.handoff()
        self.run_tool("board", "update", str(it["id"]), "改派", "", "待接手")
        self.assertIn("t2", [c[2] for c in self.calls_of("del")])

    def test_forward_rearms(self):
        it = self.handoff()
        r = self.run_tool("ws-forward", "接着做")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("t2", [c[2] for c in self.calls_of("del")])  # 旧的撤掉
        self.assertEqual(len(self.guards()), 2)
        self.assertNotEqual(self.item()["guard"], it["guard"])

    def test_progress_does_not_disarm(self):
        it = self.handoff()
        self.run_tool("board", "update", str(it["id"]), "做到一半")
        self.assertEqual(self.calls_of("del"), [])


if __name__ == "__main__":
    unittest.main()
