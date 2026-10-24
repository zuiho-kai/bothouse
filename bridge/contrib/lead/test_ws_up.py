"""ws-up / ws-handoff 记来源 / ws-forward --notes：全在临时目录里跑，cc-connect 用假脚本记参数，不发真实消息。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class WsUpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.setup = self.tmp / "setup"
        self.setup.mkdir()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        self.calls = self.tmp / "calls.jsonl"
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\nimport json,sys\n"
                        f"open({str(self.calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\nprint('timer-1')\n")
        fake.chmod(0o755)
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOTHOUSE_DATA_DIR": str(self.tmp / "data"), "CC_BIN": str(fake), "CC_PROJECT": "lead-proj",
                    "WS_CHANNEL": "900"}
        self.last = self.setup / "ws-handoff-last.json"

    def run_tool(self, name, *args, key, var="CC_SESSION_KEY"):
        return subprocess.run([sys.executable, "-I", str(HERE / name), *args], capture_output=True, text=True,
                              env={**self.env, var: key})

    def handoff(self, *args, key):
        """ws-handoff 原样跑，只把 Discord API（查/建工作区频道）换成桩，不走网络。"""
        drv = ("import sys; from importlib.machinery import SourceFileLoader as L; "
               "m = L('ws_handoff', sys.argv[1]).load_module(); m.api = lambda *a, **k: {}; m.main(sys.argv[2:])")
        return subprocess.run([sys.executable, "-I", "-c", drv, str(HERE / "ws-handoff"), *args], capture_output=True,
                              text=True, env={**self.env, "CC_SESSION_KEY": key})

    def timers(self):
        return [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def write_last(self, tasks, **top):
        self.last.write_text(json.dumps({**top, "tasks": tasks}, ensure_ascii=False), encoding="utf-8")

    def test_reports_to_source_chat_with_lead_identity(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        r = self.run_tool("ws-up", "进度一半", key="test:900")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "timer-1")
        argv = self.timers()[0]
        self.assertEqual(argv[argv.index("-s") + 1], "test:100")
        self.assertEqual(argv[argv.index("-p") + 1], "lead-proj")
        prompt = argv[argv.index("--prompt") + 1]
        self.assertIn("【工作区上报】进度一半", prompt)
        self.assertIn("ws-forward --notes /n/a.md", prompt)

    def test_falls_back_to_cc_session_under_dsh(self):
        """DSH 删掉 CC_SESSION_KEY，只剩 CC_SESSION 时也要认出当前工作区。"""
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        r = self.run_tool("ws-up", "进度", key="test:900", var="CC_SESSION")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[0]
        self.assertEqual(argv[argv.index("-s") + 1], "test:100")

    def test_ask_mode(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        r = self.run_tool("ws-up", "选哪个？", "--ask", key="test:900")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[0]
        self.assertIn("【工作区要问用户】选哪个？", argv[argv.index("--prompt") + 1])
        self.assertEqual(argv[argv.index("--desc") + 1], "工作区提问")

    def test_multiple_chats_needs_notes(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"},
                         "/n/b.md": {"channel": "900", "chat": "test:200", "task": "B"}})
        r = self.run_tool("ws-up", "x", key="test:900")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--notes /n/a.md", r.stderr)
        self.assertEqual(self.timers(), [])
        r = self.run_tool("ws-up", "--notes", "/n/b.md", "x", key="test:900")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[0]
        self.assertEqual(argv[argv.index("-s") + 1], "test:200")

    def test_rejects_unknown_notes_and_non_workspace(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        self.assertNotEqual(self.run_tool("ws-up", "--notes", "/n/z.md", "x", key="test:900").returncode, 0)
        r = self.run_tool("ws-up", "x", key="test:555")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("不是交过活的工作区", r.stderr)
        self.assertEqual(self.timers(), [])

    def test_usage_errors_do_not_send(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        for args in (["--help"], [], ["--notes"], ["-x"], ["a", "b"]):
            self.run_tool("ws-up", *args, key="test:900")
        self.assertEqual(self.timers(), [])

    def test_handoff_records_chat_and_forward_by_notes(self):
        notes = []
        for n in ("a", "b"):
            p = self.tmp / f"{n}.md"
            p.write_text("# 用户原话\n# 进度\n# 规矩\n", encoding="utf-8")
            notes.append(str(p))
        self.assertEqual(self.handoff(notes[0], "A", key="test:100").returncode, 0)
        self.env["WS_CHANNEL"] = "901"
        self.assertEqual(self.handoff(notes[1], "B", key="test:200").returncode, 0)
        last = json.loads(self.last.read_text(encoding="utf-8"))
        self.assertEqual(last["file"], notes[1])
        self.assertEqual(last["tasks"][notes[0]], {"channel": "900", "chat": "test:100", "task": "A"})
        # 工作区 900 报回交 a 进来的聊天频道
        self.assertEqual(self.run_tool("ws-up", "done", key="test:900").returncode, 0)
        argv = self.timers()[-1]
        self.assertEqual(argv[argv.index("-s") + 1], "test:100")
        # 答复按 --notes 转回 a 所在工作区，而不是最近一次交接
        r = self.run_tool("ws-forward", "--notes", notes[0], "用户说选 A", key="test:100")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[-1]
        self.assertEqual(argv[argv.index("-s") + 1], "discord:900")
        self.assertIn("用户说选 A", Path(notes[0]).read_text(encoding="utf-8"))
        self.assertNotIn("用户说选 A", Path(notes[1]).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
