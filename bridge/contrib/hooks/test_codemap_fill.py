import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = next(p for p in (HERE / "codemap-fill.py", HERE / "codemap-fill") if p.exists())


def load():
    from importlib.machinery import SourceFileLoader
    loader = SourceFileLoader("codemap_fill", str(SCRIPT))
    spec = importlib.util.spec_from_loader("codemap_fill", loader)
    m = importlib.util.module_from_spec(spec)
    loader.exec_module(m)
    return m


cf = load()

REPORT = """结论：做完了。

## 地图要补的条目（{path}）
- 入口 foo core/a.go:10
- 已有条目 core/b.go:2
  续行说明
- 入口 foo   core/a.go:10

## 别的节
- 不该收 x.go:1
"""


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = os.path.realpath(self.tmp.name)
        os.environ["CODEMAP_DIR"] = self.dir
        self.map = os.path.join(self.dir, "m.md")
        Path(self.map).write_text("# m\n\n## 旧节\n- 已有条目 core/b.go:2 续行说明\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop("CODEMAP_DIR", None)

    def test_extract(self):
        got = cf.extract(REPORT.format(path="`~/work/codemaps/m.md`"))
        self.assertEqual(got, [("~/work/codemaps/m.md", ["入口 foo core/a.go:10", "已有条目 core/b.go:2 续行说明", "入口 foo   core/a.go:10"])])
        self.assertEqual(cf.extract("## 地图要补的条目(x.md)\n正文\n- 不收\n"), [])
        self.assertEqual(cf.extract("没有这节\n- a\n"), [])

    def test_dedupe_and_append(self):
        with redirect_stderr(io.StringIO()):
            done = cf.fill(REPORT.format(path=self.map), "子 agent t", today="2026-10-30")
        self.assertEqual(done, [(self.map, 1)])
        body = Path(self.map).read_text(encoding="utf-8")
        self.assertTrue(body.endswith("\n## 自动补（2026-10-30，子 agent t）\n- 入口 foo core/a.go:10\n"), body)
        # 再来一次：全重复，不加节
        with redirect_stderr(io.StringIO()):
            self.assertEqual(cf.fill(REPORT.format(path=self.map), "again"), [])
        self.assertEqual(Path(self.map).read_text(encoding="utf-8"), body)

    def test_relative_name(self):
        with redirect_stderr(io.StringIO()):
            self.assertEqual(cf.fill(REPORT.format(path="m.md"), "s"), [(self.map, 1)])

    def test_skip_outside(self):
        other = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False)
        other.write("# o\n")
        other.close()
        err = io.StringIO()
        try:
            for p in (other.name, os.path.join(self.dir, "missing.md"), os.path.join(self.dir, "..", "m.md"),
                      os.path.join(self.dir, "x.txt")):
                with redirect_stderr(err):
                    self.assertEqual(cf.fill(REPORT.format(path=p), "s"), [])
            self.assertEqual(Path(other.name).read_text(), "# o\n")
            self.assertIn("跳过", err.getvalue())
        finally:
            os.unlink(other.name)

    def test_skip_none_entries(self):
        rep = "## 地图要补的条目（m.md）\n- 无（本任务是 PCB 硬件，不涉及桥代码）\n- （无，本次审稿）\n- 本次只读交接,没有新增条目。\n"
        with redirect_stderr(io.StringIO()):
            self.assertEqual(cf.fill(rep, "s"), [])

    def test_hook_input(self):
        tr = os.path.join(self.dir, "t.jsonl")
        msg = {"type": "assistant", "message": {"content": [{"type": "text", "text": REPORT.format(path=self.map)}]}}
        Path(tr).write_text(json.dumps({"type": "user"}) + "\n" + json.dumps(msg) + "\n", encoding="utf-8")
        text, src = cf.hook_text({"agent_transcript_path": tr, "agent_type": "general-purpose", "agent_id": "abcdef123456"})
        self.assertIn("入口 foo", text)
        self.assertEqual(src, "子 agent general-purpose abcdef12")
        self.assertEqual(cf.hook_text({"last_assistant_message": "x"})[0], "x")

    def test_hook_main_no_args(self):
        # run.py calls the hook without arguments: a SubagentStop payload on stdin
        payload = json.dumps({"hook_event_name": "SubagentStop", "agent_type": "general-purpose", "agent_id": "a1",
                              "last_assistant_message": REPORT.format(path=self.map)})
        sys.stdin = io.StringIO(payload)
        try:
            with redirect_stderr(io.StringIO()):
                cf.main([])
        finally:
            sys.stdin = sys.__stdin__
        self.assertIn("- 入口 foo core/a.go:10", Path(self.map).read_text(encoding="utf-8"))
        sys.stdin = io.StringIO(json.dumps({"hook_event_name": "Stop", "last_assistant_message": "## 地图要补的条目（m.md）\n- 别的 z.go:1\n"}))
        try:
            with redirect_stderr(io.StringIO()):
                cf.main([])
        finally:
            sys.stdin = sys.__stdin__
        self.assertNotIn("z.go", Path(self.map).read_text(encoding="utf-8"))

    def test_default_dir_is_data_dir_codemaps(self):
        os.environ.pop("CODEMAP_DIR", None)
        self.assertEqual(cf.map_dir(), os.path.realpath(os.path.join(os.path.dirname(cf.HERE), "codemaps")))


if __name__ == "__main__":
    unittest.main()
