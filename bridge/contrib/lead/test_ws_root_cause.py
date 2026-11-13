"""Root-cause evidence is required only for repair titles/scopes; no model or bridge calls."""
import importlib.machinery
import importlib.util
import tempfile
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

    def test_develop_log_with_search_flag_is_introduction_evidence(self):
        body = GOOD.replace("git log -S 'mention'", "git log origin/develop -S 'mention'")
        self.assertEqual(ws.root_cause_errors('# fix\n' + body), [])

    def test_append_own_preserves_user_decisions_section(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'handoff.md'
            path.write_text('## 派活人自己定的\n- 用户明确的设定\n', encoding='utf-8')
            ws.append_own(path, '主角色按依据选择了方案')
            text = path.read_text(encoding='utf-8')
        self.assertIn('- 用户明确的设定', text)
        self.assertIn('## 主角色自己定的（程序附）', text)

    def test_busy_pool_always_tries_new_workspace(self):
        calls = []
        busy = [{'id': f'w{i}', 'open': 1, 'owner': 'room:main'} for i in range(1, 9)]

        def ws_cmd(chat, action):
            calls.append(action)
            if action == 'list':
                return {'parent': chat, 'pool': busy}
            return {'workspace': {'id': 'w9', 'name': '工作区9'}}

        class Result:
            returncode = 0

        with patch.dict(ws.__dict__, {'ws_cmd': ws_cmd, 'release_stale_returned': lambda _: None,
                                      'migrate_unbound': lambda *args: False}), \
             patch.object(ws.subprocess, 'run', return_value=Result()):
            picked = ws.pick_pool('room:main', '新任务', 1)
        self.assertEqual(picked, ('room:w9', '工作区9', 'room:main'))
        self.assertEqual(calls, ['list', 'new'])

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
