"""数据目录一处解析（datadir.py）+ 任务板默认目录和 gate 读的是同一处：python3 -I test_datadir.py"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
KEYS = ("BOTHOUSE_DATA_DIR", "GATE_SETUP_DIR", "CC_DATA_DIR", "BOARD_DIR", "GATE_LEAD_FILE", "GATE_TEAM", "GATE_DIR",
        "CC_SESSION_KEY", "CC_SESSION", "DISCORD_BOT_TOKEN", "BOARD_PR_REPO")


def spawn(home, code, **env):
    e = {k: v for k, v in os.environ.items() if k not in KEYS}
    e.update(HOME=str(home), CC_BIN="false", **env)
    return subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(HERE)!r}); {code}"],
                          capture_output=True, text=True, env=e)


def run(home, code, **env):
    p = spawn(home, code, **env)
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

    def test_cc_data_dir_fallback(self):
        d = str(self.home / "ccdata")
        self.assertEqual(self.paths(CC_DATA_DIR=d), [d, d, d + "/lead.json", d + "/team"])

    def test_board_follows_config_team_status_dir(self):
        d = self.home / "data"
        tdir = self.home / "shared-team"
        d.mkdir()
        (d / "config.toml").write_text(f'team_status_dir = "{tdir}"\n', encoding="utf-8")
        self.assertEqual(self.paths(GATE_SETUP_DIR=str(d))[3], str(tdir))

    def test_both_set(self):
        # lead.json 跟 BOTHOUSE_DATA_DIR，团队文件/任务板等跟 GATE_SETUP_DIR（datadir.py 文档写死的规则）
        p, s = str(self.home / "product"), str(self.home / "setup")
        self.assertEqual(self.paths(BOTHOUSE_DATA_DIR=p, GATE_SETUP_DIR=s), [p, s, p + "/lead.json", s + "/team"])

    def test_board_cli_writes_where_gate_reads(self):
        # 第1轮盘点的错位：board 不设变量时写 ~/.cc-connect/team，gate（GATE_SETUP_DIR=数据目录）读 ~/.bothouse/team
        d = self.home / "data"
        e = {k: v for k, v in os.environ.items() if k not in KEYS}
        e.update(HOME=str(self.home), CC_BIN="false", BOTHOUSE_DATA_DIR=str(d))
        out = subprocess.run([str(HERE.parent / "lead" / "board"), "add", "task", "-", "doing", "role", "--short", "task"],
                             capture_output=True, text=True, env=e)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertTrue((d / "team" / "board.jsonl").exists())
        self.assertFalse((self.home / ".cc-connect").exists())
        self.assertFalse((self.home / ".bothouse").exists())
        # gate 进程由 bothouse 拉起时两个变量都是数据目录（core/gate_proc.go）
        got = run(self.home, "import ctxsvc; print(len(ctxsvc.board_items()))",
                  BOTHOUSE_DATA_DIR=str(d), GATE_SETUP_DIR=str(d))
        self.assertEqual(got, "1")

    def live_dir(self, name="cc-connect-maomao"):
        # 非默认名的「线上」目录：放着 config.toml。它在临时 HOME 下，守卫的 _TEMP 收窄成空才会被判成线上
        live = self.home / name
        (live / "team").mkdir(parents=True)
        (live / "config.toml").write_text('name = "fake"\n')
        return live

    def test_guard_refuses_live_dir_whatever_its_name(self):
        # #2077：守卫按「自己或上级放着真实 config.toml」判线上，不写死 ~/.bothouse、~/.cc-connect 名单
        live = self.live_dir()
        p = spawn(self.home, f"import datadir; datadir._TEMP = (); datadir.guard({str(live / 'team')!r})",
                  BOTHOUSE_TEST="1")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("config.toml", p.stderr)

    def test_guard_allows_config_toml_under_temp(self):
        # 同一规则反例：临时目录里的 config.toml 是测试自己建的，放行（_TEMP 原样，收窄才会拦）
        live = self.live_dir()
        got = run(self.home, f"import datadir; print(datadir.guard({str(live / 'team')!r}))")
        self.assertEqual(got, str(live / "team"))

    def test_board_dir_env_goes_through_guard(self):
        # #2077：BOARD_DIR 指向线上目录时 import board 就中止——改前 board.DIR 不设防，夹具直接写进线上任务板
        live = self.live_dir()
        p = spawn(self.home, "import datadir; datadir._TEMP = (); import board",
                  BOTHOUSE_TEST="1", BOARD_DIR=str(live / "team"))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("config.toml", p.stderr)

    def test_ws_tests_in_one_process_never_touch_live_board(self):
        # #2077 隔离复现：环境带线上 BOARD_DIR/CC_DATA_DIR 时同进程跑两个 ws 测试——
        # 改前 root_cause（11-24 已删，换 cooling_sprawl）加载就把 board 缓存到线上目录，drain_queue 的夹具整份覆盖线上任务板
        live = self.live_dir()
        team = live / "team"
        board = team / "board.jsonl"
        board.write_text('{"id": 1, "what": "sentinel"}\n')
        mtime = board.stat().st_mtime_ns
        lead = HERE.parent / "lead"
        p = spawn(self.home,
                  f"import datadir, unittest; datadir._TEMP = (); sys.path.insert(0, {str(lead)!r});"
                  " s = unittest.TestLoader().loadTestsFromNames(['test_ws_cooling_sprawl', 'test_ws_drain_queue']);"
                  " sys.exit(0 if unittest.TextTestRunner(verbosity=1).run(s).wasSuccessful() else 1)",
                  BOARD_DIR=str(team), CC_DATA_DIR=str(live))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(board.read_text(), '{"id": 1, "what": "sentinel"}\n')
        self.assertEqual(board.stat().st_mtime_ns, mtime)
        self.assertEqual(sorted(x.name for x in live.rglob("*") if x.is_file()),
                         ["board.jsonl", "config.toml"])


if __name__ == "__main__":
    unittest.main()
