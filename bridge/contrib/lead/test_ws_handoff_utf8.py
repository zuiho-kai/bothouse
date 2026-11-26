"""任务板 JSONL 的 UTF-8 契约（#2261）：写侧（-X utf8 的 board.cmd）和读侧（只带 -I 的 ws-handoff 后台 worker）
跨模式往返中文不乱码、不炸；后台 worker 在含中文的完成历史下照常交活出回执。
来源：issue #2261（Windows CP1252/CP936 下 board.add 读 board-done.jsonl UnicodeDecodeError）。桥是假脚本，全在临时目录里跑。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATE = HERE.parent / "gate"

_PYSNIP = (
    "import json,sys;sys.path.insert(0, r'%(gate)s');sys.path.insert(0, r'%(lead)s');import board\n"
    "%(code)s"
)


class BoardUtf8Test(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.env = dict(os.environ,
                        HOME=str(self.tmp), USERPROFILE=str(self.tmp), GATE_SETUP_DIR=str(self.tmp / "setup"),
                        BOARD_DIR=str(self.tmp / "board"), BOTHOUSE_DATA_DIR=str(self.tmp / "data"),
                        CC_BIN=str(self.tmp / ("cc-connect.bat" if os.name == "nt" else "cc-connect")),
                        CC_PROJECT="lead-proj", PYTHONIOENCODING="utf-8",
                        WS_CHANNEL="900", CC_SESSION_KEY="test:100")
        (self.tmp / "setup").mkdir()
        (self.tmp / "board").mkdir()

    def run_py(self, utf8, code):
        args = [sys.executable, "-I"] + (["-X", "utf8"] if utf8 else []) + ["-c",
                _PYSNIP % {"gate": GATE, "lead": HERE, "code": code}]
        return subprocess.run(args, capture_output=True, text=True, env=self.env,
                              encoding="utf-8", errors="replace")

    def test_board_jsonl_cross_mode_roundtrip(self):
        """写侧 utf8 模式、读侧默认编码：中文与 emoji 原样回来（修前读侧在 Windows 代码页上炸 UnicodeDecodeError）。"""
        w = self.run_py(True, "board._write([{'id': 1, 'what': '修中文条目 ✅'}], 'board-done.jsonl')")
        self.assertEqual(w.returncode, 0, w.stderr)
        r = self.run_py(False, "sys.stdout.buffer.write(json.dumps(board._read('board-done.jsonl'), ensure_ascii=False).encode('utf-8'))")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("修中文条目 ✅", r.stdout)

    @unittest.skipIf(os.name == "nt", "整链要跑无后缀假桥脚本，套件其余用例同为 Linux 口径；board 层跨模式用例已覆盖同一根因")
    def test_worker_hands_off_with_utf8_done_history(self):
        """完成历史含中文时后台 worker 照常交活：回执打「任务板 #N」、退出码 0（修前 board.add 读历史就崩）。"""
        seed = self.tmp / "board" / "board-done.jsonl"
        seed.write_text(json.dumps({"id": 5, "what": "上一件中文活 ✅", "status": "已交付"}, ensure_ascii=False) + "\n",
                        encoding="utf-8")
        bindir = self.tmp / "bin"
        bindir.mkdir()
        calls = self.tmp / "calls.jsonl"
        real = bindir / "cc-connect.py"
        real.write_text("import json,sys\n"
                        f"open({str(calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\n"
                        "print('Timer created: t1')\n", encoding="utf-8")
        if os.name == "nt":  # Windows 起不了无后缀脚本，用 .bat 包一层
            fake = bindir / "cc-connect.bat"
            fake.write_text(f'@echo off\r\n"{sys.executable}" -I "{real}" %*\r\n', encoding="utf-8")
        else:
            fake = bindir / "cc-connect"
            fake.write_text(f"#!{sys.executable}\nimport json,sys\nexec(open({str(real)!r}).read())\n")
            fake.chmod(0o755)
        notes = self.tmp / "notes.md"
        notes.write_text("# 用户原话\n- 做\n# 总目标\n# 范围\n改：测试\n不改：无\n# 已查过什么\n无（没查过）\n# 进度\n# 相关改动\n冲突：无\n# 规矩\n# 参照实现\n无（新建）\n", encoding="utf-8")
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), str(notes), "测一件中文活 ✅", "--short", "中文活名"],
                           capture_output=True, env={**self.env, "PATH": str(bindir) + os.pathsep + os.environ.get("PATH", "")},
                           text=True, encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("任务板 #6", r.stderr, "应接着完成历史编号 5 分配 #6，说明历史读对了")
        rows = [json.loads(l) for l in calls.read_text(encoding="utf-8").splitlines()] if calls.exists() else []
        self.assertTrue(any(c[:1] == ["timer"] or c[:2] == ["timer", "add"] for c in rows), "叫醒工作区的 timer add 应发生")


if __name__ == "__main__":
    unittest.main()
