"""#1893：规则表强制写进交接的行，判官不能判成「自己加的」。

11-23 #1891 派活：界面活的「用户视角走查」行是交接规则强制要写的，判官却判成多加的设定，来回退三次。
现在判官读总表（house-rules.toml [[check]].requires）和交接规则的 need_re，先把这些行拿掉再判。
单测用临时总表，不依赖本机的 ~/wiki。
"""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('_added_judge', Path(__file__).with_name('_added_judge.py'))
aj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aj)

RULES = """
[[check]]
id = "handoff-static"
artifact = "交接"
runner = "handoff-static"
requires = [
  { name = "用户视角走查", re = "^\\\\s*[-*]?\\\\s*用户视角走查\\\\s*[:：]\\\\s*\\\\S" },
]
"""

# 11-23 那次：界面活，范围里写了用户视角走查行；规则表强制要写的就是这一行。
NOTES = """# 交接：agentm 页面换成新版

## 用户原话
- [11-23] 用户：「我看他记忆论坛和记忆可视化还是旧版」

## 总目标
在 agentm 上换成新版。

## 范围
- 改：agentm 上的两个页面
- 用户视角走查：按第一次打开的用户逐页打开这两页截图（含空状态、长内容、窄窗口）
"""


class MandatedLines(unittest.TestCase):
    def setUp(self):
        fh = tempfile.NamedTemporaryFile('w', suffix='.toml', delete=False, encoding='utf-8')
        fh.write(RULES)
        fh.close()
        self.rules = Path(fh.name)
        self.old = aj.HOUSE_RULES
        aj.HOUSE_RULES = self.rules

    def tearDown(self):
        aj.HOUSE_RULES = self.old
        self.rules.unlink()

    def test_rule_table_lists_what_checks_force(self):
        self.assertIn("用户视角走查", {n for n, _ in aj._rule_table()})

    def test_walkthrough_line_is_not_judged(self):
        got = aj.parts(NOTES)
        self.assertIsNotNone(got)
        left, dropped = aj.mandated(got[1])
        self.assertTrue(any("用户视角走查" in l for l in dropped), dropped)
        self.assertNotIn("用户视角走查", left)
        self.assertIn("## 范围", left)  # 标题留着，正文行拿掉

    def test_only_mandated_lines_means_no_model_call(self):
        # 要判的只剩规则表强制的那几行：不调模型，直接放行（判官误拦这次的复现）
        notes = "# 交接：页面\n## 用户原话\n用户：「页面还是旧版」\n## 范围\n- 用户视角走查：按第一次打开的用户逐页截图\n"
        with patch.object(aj.subprocess, 'run') as run, patch.object(aj, '_log'):
            res = aj.judge(notes)
        run.assert_not_called()
        self.assertEqual((res['added'], res['error']), ([], ''))

    def test_invented_setting_still_goes_to_the_model(self):
        notes = "# 交接：表格\n## 用户原话\n用户：「把表格改好」\n## 范围\n- 改：表格\n- 顺便把字体换成手写体\n"
        left, dropped = aj.mandated(aj.parts(notes)[1])
        self.assertIn("顺便把字体换成手写体", left)
        self.assertEqual(dropped, [])


if __name__ == '__main__':
    unittest.main()
