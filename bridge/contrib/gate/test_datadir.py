"""数据目录一处解析（datadir.py）+ 任务板默认目录和 gate 读的是同一处：python3 -I test_datadir.py"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
KEYS = ("BOTHOUSE_DATA_DIR", "GATE_SETUP_DIR", "BOARD_DIR", "GATE_LEAD_FILE", "GATE_TEAM", "GATE_DIR",
        "CC_SESSION_KEY", "CC_SESSION", "DISCORD_BOT_TOKEN", "BOARD_PR_REPO")


def run(home, code, **env):
    e = {k: v for k, v in os.environ.items() if k not in KEYS}
    e.update(HOME=str(home), CC_BIN="false", **env)
    p = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(HERE)!r}); {code}"],
                       capture_output=True, text=True, env=e)
    if p.returncode:
        raise AssertionError(p.stderr)
    return p.stdout.strip()


PATHS = "import datadir, lead, board; print(datadir.data_dir(), datadir.setup_dir(), lead.LEAD_FILE, board.DIR, sep='|')"


class DataDir(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())

    def paths(self, **env):
        return run(self.home, PATHS, **env).split("|")

    def test_fresh_home_uses_bothouse(self):
        d = str(self.home / ".bothouse")
        self.assertEqual(self.paths(), [d, d, d + "/lead.json", d + "/team"])

    def test_legacy_only_keeps_cc_connect(self):
        (self.home / ".cc-connect").mkdir()
        d = str(self.home / ".cc-connect")
        self.assertEqual(self.paths(), [d, d, d + "/lead.json", d + "/team"])
        (self.home / ".bothouse").mkdir()
        self.assertEqual(self.paths()[0], str(self.home / ".bothouse"))

    def test_bothouse_data_dir_alone(self):
        (self.home / ".cc-connect").mkdir()
        d = str(self.home / "data")
        self.assertEqual(self.paths(BOTHOUSE_DATA_DIR=d), [d, d, d + "/lead.json", d + "/team"])

    def test_gate_setup_dir_alone(self):
        d = str(self.home / "setup")
        self.assertEqual(self.paths(GATE_SETUP_DIR=d), [d, d, d + "/lead.json", d + "/team"])

    def test_both_set(self):
        # lead.json 跟 BOTHOUSE_DATA_DIR，团队文件/任务板等跟 GATE_SETUP_DIR（datadir.py 文档写死的规则）
        p, s = str(self.home / "product"), str(self.home / "setup")
        self.assertEqual(self.paths(BOTHOUSE_DATA_DIR=p, GATE_SETUP_DIR=s), [p, s, p + "/lead.json", s + "/team"])

    def test_board_cli_writes_where_gate_reads(self):
        # 第1轮盘点的错位：board 不设变量时写 ~/.cc-connect/team，gate（GATE_SETUP_DIR=数据目录）读 ~/.bothouse/team
        d = self.home / "data"
        e = {k: v for k, v in os.environ.items() if k not in KEYS}
        e.update(HOME=str(self.home), CC_BIN="false", BOTHOUSE_DATA_DIR=str(d))
        out = subprocess.run([str(HERE.parent / "lead" / "board"), "add", "task", "-", "doing", "role"],
                             capture_output=True, text=True, env=e)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue((d / "team" / "board.jsonl").exists())
        self.assertFalse((self.home / ".cc-connect").exists())
        self.assertFalse((self.home / ".bothouse").exists())
        # gate 进程由 bothouse 拉起时两个变量都是数据目录（core/gate_proc.go）
        got = run(self.home, "import ctxsvc; print(len(ctxsvc.board_items()))",
                  BOTHOUSE_DATA_DIR=str(d), GATE_SETUP_DIR=str(d))
        self.assertEqual(got, "1")


if __name__ == "__main__":
    unittest.main()
