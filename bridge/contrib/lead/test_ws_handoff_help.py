"""ws-handoff 的帮助参数回归：-h/--help 只能在前台打印用法，不能被当成一句话任务派给工作区。
来源：2026-11-26 vent「运行 ws-handoff --help 不打印帮助，反而把 --help 当成任务直接建单交给了工作区」。
桥是假脚本，数据目录、任务板和回执目录全在临时目录里。"""
import json, subprocess, sys, tempfile, unittest
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent


class HelpTest(unittest.TestCase):
    def run_help(self, *args):
        root = Path(tempfile.mkdtemp())
        for d in ("setup", "board", "data/sessions", "bin"):
            (root / d).mkdir(parents=True, exist_ok=True)
        calls = root / "calls.jsonl"
        fake = root / "bin" / "cc-connect"
        fake.write_text(f"#!{sys.executable}\nimport json,sys\n"
                        f"open({str(calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\n"
                        "print('Timer created: t1')\n")
        fake.chmod(0o755)
        now = datetime.now().astimezone().isoformat()
        sess = {"user_sessions": {"test:100": ["s1"]},
                "sessions": {"s1": {"agent_session_id": "a1", "history": [
                    {"timestamp": now, "role": "user", "content": "（最新，回这条）\n帮我把帮助参数修好"}]}}}
        (root / "data/sessions/lead-proj_x.json").write_text(json.dumps(sess), encoding="utf-8")
        env = {"PATH": f"{root / 'bin'}:/usr/bin:/bin", "HOME": str(root), "GATE_SETUP_DIR": str(root / "setup"),
               "BOARD_DIR": str(root / "board"), "BOTHOUSE_DATA_DIR": str(root / "data"), "CC_DATA_DIR": str(root / "data"),
               "CC_BIN": str(fake), "CC_PROJECT": "lead-proj", "WS_CHANNEL": "900", "CC_SESSION_KEY": "test:100"}
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), *args],
                           capture_output=True, text=True, env=env, cwd=root, timeout=30)
        runs = root / "setup" / "handoff-runs"
        return r, root, calls, list(runs.glob("*")) if runs.exists() else []

    def check_help_only(self, *args):
        r, root, calls, runs = self.run_help(*args)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stderr, "")
        self.assertIn("用法：ws-handoff", r.stdout)
        self.assertNotIn("已交给", r.stdout)
        self.assertFalse(calls.exists(), f"帮助不应调桥：{calls.read_text() if calls.exists() else ''}")
        self.assertFalse((root / "board/board.jsonl").exists(), "帮助不应建任务单")
        self.assertFalse((root / "notes").exists(), "帮助不应写交接文件")
        self.assertFalse(runs, f"帮助不应起后台交活进程：{runs}")

    def test_help_flags_print_usage_without_handing_off(self):
        for args in (("--help",), ("-h",), ("notes.md", "--help", "测一件活")):
            with self.subTest(args=args):
                self.check_help_only(*args)


if __name__ == "__main__":
    unittest.main()
