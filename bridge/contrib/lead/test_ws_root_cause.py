"""Root-cause evidence is required only for repair titles/scopes; no model or bridge calls."""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
loader = importlib.machinery.SourceFileLoader('ws_root_cause', str(HERE / 'ws-handoff'))
ws = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(ws)

GOOD = '''## 根因
工作留在频道→派活只发 @→规则曾改成频道派活
```text
$ git log origin/develop --oneline -- path
abc1234 related change
```
```text
$ git log -S 'mention' --oneline -- path
123abcd introducing change
```
'''


class RootCauseTest(unittest.TestCase):
    def test_title_scope_and_task_trigger(self):
        for text, task in [('# 修派活\n', ''), ('# Fix routing\n', ''), ('# BUG routing\n', ''),
                           ('# issue 1745\n', ''), ('# #1745\n', ''),
                           ('## 范围\n- 改：修派活\n', ''), ('# 新任务\n', 'fix routing')]:
            with self.subTest(text=text, task=task):
                self.assertEqual(len(ws.root_cause_errors(text, task)), 4)
                self.assertEqual(ws.root_cause_errors(text + GOOD, task), [])

    def test_unrelated_mentions_do_not_trigger(self):
        self.assertEqual(ws.root_cause_errors('# 新功能\n## 范围\n- 改：卡片\n## 原话\n修 #1745 bug\n'), [])

    def test_each_missing_item_reported(self):
        self.assertEqual(len(ws.root_cause_errors('# fix\n## 根因\n')), 3)
        self.assertIn('三段', ws.root_cause_errors('# fix\n' + GOOD.replace('规则曾改成频道派活', ''))[0])
        for command in ('git log origin/develop', 'git log -S'):
            errors = ws.root_cause_errors('# fix\n' + GOOD.replace(command, 'echo'))
            self.assertEqual(len(errors), 1)
        self.assertEqual(len(ws.root_cause_errors('# fix\n' + GOOD.replace('abc1234 related change\n', ''))), 1)

    def test_blame_and_explicit_empty_log(self):
        body = GOOD.replace("git log -S 'mention'", 'git blame').replace('abc1234 related change', '（无输出）')
        self.assertEqual(ws.root_cause_errors('# fix\n' + body), [])

    def test_errors_join_existing_checks(self):
        rules = {'flags': {}}
        with patch.object(ws._handoff_rules, 'load', return_value=rules), \
             patch.object(ws._handoff_rules, 'ds_lead', return_value=False), \
             patch.object(ws._handoff_rules, 'check_tiered', return_value=['existing missing section']), \
             patch.object(ws, 'object_gate', return_value=None):
            result = ws.check_notes('# fix')
        self.assertIn('5 处', result)
        self.assertIn('existing missing section', result)
        self.assertIn('git blame', result)


if __name__ == '__main__':
    unittest.main()
