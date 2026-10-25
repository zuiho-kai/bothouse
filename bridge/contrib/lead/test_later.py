"""later：挂在任务板已有条目上记「下次看」（board next），定时挂不上就改回原值。任务板和桥都用临时目录里的假脚本。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

BOARD = '''import json, os, sys
open(os.environ["CALLS"], "a").write(json.dumps({"board": sys.argv[1:], "later": os.environ.get("BOARD_LATER")}) + "\\n")
if sys.argv[1:2] == ["next"] and sys.argv[2] == "9":
    sys.exit("没有 #9")
print(json.dumps({"next": "10:00", "next_ts": 1}))
print("修登录页")
'''


class LaterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        gate = self.tmp / "gate"
        gate.mkdir()
        (gate / "board.py").write_text(BOARD, encoding="utf-8")
        self.calls = self.tmp / "calls.jsonl"
        self.cc = self.tmp / "cc"
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "GATE_DIR": str(gate), "CALLS": str(self.calls),
                    "CC_BIN": str(self.cc), "CC_PROJECT": "p", "CC_SESSION_KEY": "test:1"}

    def fake_cc(self, code):
        self.cc.write_text(f"#!{sys.executable}\nimport json,os,sys\n"
                           f"open(os.environ['CALLS'],'a').write(json.dumps({{'cc': sys.argv[1:]}})+'\\n')\nsys.exit({code})\n")
        self.cc.chmod(0o755)

    def later(self, *args):
        return subprocess.run(["sh", str(HERE / "later"), *args], capture_output=True, text=True, env=self.env)

    def calls_(self):
        return [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def test_needs_board_id(self):
        self.fake_cc(0)
        for args in (("10m", "事情", "到点做"), ("x", "10m", "做"), ("3", "10m")):
            r = self.later(*args)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("任务板编号", r.stderr)
        self.assertEqual(self.calls_(), [])

    def test_marks_existing_item(self):
        self.fake_cc(0)
        r = self.later("#3", "10m", "看 CI")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("任务板 #3", r.stdout)
        c = self.calls_()
        self.assertEqual(c[0]["board"][:2], ["next", "3"])
        self.assertEqual(c[0]["later"], "1")
        argv = c[1]["cc"]
        self.assertEqual(argv[:7], ["timer", "add", "-p", "p", "-s", "test:1", "--delay"])
        self.assertEqual(argv[argv.index("--desc") + 1], "修登录页")  # 定时描述 = 条目的事情
        self.assertIn("看 CI", argv[argv.index("--prompt") + 1])
        self.assertEqual(len(c), 2)  # 没新建条目

    def test_unknown_item_no_timer(self):
        self.fake_cc(0)
        self.assertNotEqual(self.later("9", "10m", "看").returncode, 0)
        self.assertFalse(any("cc" in x for x in self.calls_()))

    def test_timer_fail_restores(self):
        self.fake_cc(1)
        r = self.later("3", "10m", "看 CI")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("改回原值", r.stderr)
        last = self.calls_()[-1]["board"]
        self.assertEqual(last[:3], ["next", "3", "--restore"])
        self.assertEqual(json.loads(last[3]), {"next": "10:00", "next_ts": 1})


if __name__ == "__main__":
    unittest.main()
