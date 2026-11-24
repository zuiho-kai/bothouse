"""#1893 冲突检查：一道检查要求写的行，交给同产物的其它检查，互相否定就算冲突。

用临时总表，不依赖本机的 ~/wiki；样例不调模型（判官只看规则表放行表）。
"""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE_TOML = """
[[check]]
id = "handoff-static"
artifact = "交接"
runner = "handoff-static"
requires = [
  { name = "用户视角走查", rule = "user_view_walk", re = "^\\\\s*[-*]?\\\\s*用户视角走查\\\\s*[:：]\\\\s*\\\\S", sample = \"\"\"- 改：页面
- 用户视角走查：按第一次打开的用户逐页截图（含空状态、长内容、窄窗口）\"\"\" },
]
[[check]]
id = "added-judge"
artifact = "交接"
runner = "added-judge"
"""


def load_conflict_check():
    from importlib.machinery import SourceFileLoader
    loader = SourceFileLoader("conflict_check", str(HERE / "conflict-check"))
    spec = importlib.util.spec_from_loader("conflict_check", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class ConflictCheck(unittest.TestCase):
    def setUp(self):
        fh = tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False, encoding="utf-8")
        fh.write(FIXTURE_TOML)
        fh.close()
        self.rules = Path(fh.name)
        self.old_env = os.environ.get("HOUSE_RULES")
        os.environ["HOUSE_RULES"] = str(self.rules)
        self.cc = load_conflict_check()

    def tearDown(self):
        os.environ.pop("HOUSE_RULES", None)
        if self.old_env is not None:
            os.environ["HOUSE_RULES"] = self.old_env
        self.rules.unlink()

    def test_mandated_line_is_not_a_conflict(self):
        # 11-23 那次：走查行是规则表强制要写的，判官也放行 → 不算冲突
        entries = self.cc.registry()
        (rows, bad), _group = self.cc.artifact_rows(entries, "交接")
        self.assertEqual(bad, 0, rows)
        self.assertTrue(any("用户视角走查" in r["needs"] for r in rows), rows)

    def test_invented_setting_is_a_conflict(self):
        # 一道检查把原话里没有的设定当必写项：判官不放行 → 必须报冲突
        entries = [
            {"id": "handoff-static", "artifact": "交接", "runner": "handoff-static",
             "requires": [{"name": "顺便换字体", "handoff_rule": "", "re": "手写体",
                           "sample": "- 改：表格\n- 顺便把字体换成手写体"}]},
            {"id": "added-judge", "artifact": "交接", "runner": "added-judge"},
        ]
        (rows, bad), _group = self.cc.artifact_rows(entries, "交接")
        self.assertEqual(bad, 1, rows)
        self.assertIn("判官", rows[0]["why"])


if __name__ == "__main__":
    unittest.main()
