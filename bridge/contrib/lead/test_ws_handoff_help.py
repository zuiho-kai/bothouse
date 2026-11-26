"""ws-handoff -h/--help：任何参数位置都优先识别为帮助，前台打印用法、退出码 0；
不建任务单、不占工作区、不写运行目录、不启动后台交活进程。
来源：issue #2257（修前 ws-handoff -h 会先拉起后台 worker、用法打到 stderr、退出码 1）。全在临时目录里跑。"""
import subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class HandoffHelpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.setup = self.tmp / "setup"
        self.setup.mkdir()
        self.env = {"HOME": str(self.tmp), "USERPROFILE": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOARD_DIR": str(self.tmp / "board"), "BOTHOUSE_DATA_DIR": str(self.tmp / "data"),
                    "CC_BIN": str(self.tmp / "cc-connect"), "CC_PROJECT": "lead-proj",
                    "WS_CHANNEL": "900", "CC_SESSION_KEY": "test:100"}

    def handoff(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), *args],
                              capture_output=True, text=True, env=self.env)

    def assert_only_help(self, r):
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("用法：ws-handoff", r.stdout)
        self.assertFalse((self.setup / "handoff-runs").exists(), "帮助不该启动后台交活进程（写运行目录）")
        self.assertFalse((self.tmp / "board" / "board.jsonl").exists(), "帮助不该建任务单")

    def test_bare_help(self):
        for flag in ("-h", "--help"):
            with self.subTest(flag=flag):
                self.assert_only_help(self.handoff(flag))

    def test_help_anywhere_beats_task(self):
        # 交接文件 + 任务句 + --help 混在一起：也只打用法，不进派活流程（修前这句会真的交活）
        notes = self.tmp / "notes.md"
        notes.write_text("# 用户原话\n- 做\n# 总目标\n# 范围\n改：测试\n不改：无\n# 已查过什么\n无（没查过）\n# 进度\n# 相关改动\n冲突：无\n# 规矩\n# 参照实现\n无（新建）\n", encoding="utf-8")
        self.assert_only_help(self.handoff(str(notes), "测一件活", "--short", "测试", "--help"))
        self.assert_only_help(self.handoff("-h", str(notes), "测一件活", "--short", "测试"))


if __name__ == "__main__":
    unittest.main()
