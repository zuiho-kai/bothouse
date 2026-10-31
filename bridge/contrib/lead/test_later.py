"""later：挂在任务板已有条目上记「下次看」，定时挂不上就改回原值。任务板用真的 ../gate/board.py（数据放临时目录），桥用假脚本。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

class LaterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.calls = self.tmp / "calls.jsonl"
        self.cc = self.tmp / "cc"
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.tmp / "setup"),
                    "BOARD_DIR": str(self.tmp / "board"), "CALLS": str(self.calls),
                    "CC_BIN": str(self.cc), "CC_PROJECT": "p", "CC_SESSION_KEY": "test:1"}
        r = subprocess.run(["sh", str(HERE / "board"), "add", "修登录页", "-", "在做", "码农", "--short", "修登录页"], capture_output=True,
                           text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)

    def rows(self):
        return [json.loads(l) for l in (self.tmp / "board" / "board.jsonl").read_text().splitlines()]

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
        r = self.later("#1", "10m", "看 CI")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("任务板 #1", r.stdout)
        argv = [c["cc"] for c in self.calls_() if c["cc"][:2] == ["timer", "add"]][0]
        self.assertEqual(argv[:7], ["timer", "add", "-p", "p", "-s", "test:1", "--delay"])
        self.assertEqual(argv[argv.index("--desc") + 1], "修登录页")  # 定时描述 = 条目的事情
        self.assertIn("看 CI", argv[argv.index("--prompt") + 1])
        rows = self.rows()
        self.assertEqual(len(rows), 1)  # 没新建回看条目
        self.assertRegex(rows[0]["next"], r"^\d\d:\d\d$")
        self.assertEqual((rows[0]["status"], rows[0]["who"]), ("在做", "码农"))  # 只改「下次看」

    def test_unknown_item_no_timer(self):
        self.fake_cc(0)
        r = self.later("9", "10m", "看")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("没有 #9", r.stderr)
        self.assertFalse([c for c in self.calls_() if c["cc"][:2] == ["timer", "add"]])

    def test_timer_fail_restores(self):
        self.fake_cc(0)
        self.assertEqual(self.later("1", "10m", "看 CI").returncode, 0)
        before = {k: self.rows()[0][k] for k in ("next", "next_ts")}
        self.fake_cc(1)
        r = self.later("1", "2h", "再看")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("改回原值", r.stderr)
        self.assertEqual({k: self.rows()[0].get(k) for k in ("next", "next_ts")}, before)

    def test_timer_fail_clears_when_none_before(self):
        self.fake_cc(1)
        self.assertNotEqual(self.later("1", "10m", "看").returncode, 0)
        self.assertNotIn("next", self.rows()[0])

if __name__ == "__main__":
    unittest.main()
