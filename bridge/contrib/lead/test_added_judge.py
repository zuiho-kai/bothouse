import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('_added_judge', Path(__file__).with_name('_added_judge.py'))
aj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aj)

NOTES = '# 修 X\n## 用户原话\n照搬大肥鱼\n## 总目标\n照搬大肥鱼，换成英文圈\n'


class AddedJudgeTest(unittest.TestCase):
    def run_judge(self, rc, out):
        with patch.object(aj.subprocess, 'run', return_value=NS(returncode=rc, stdout=out)), \
             patch.object(aj, '_log') as log:
            r = aj.judge(NOTES)
        return r, log.call_args[0][0]

    def test_guard_repair_exception_reaches_model(self):
        notes = '# 修检查\n## 用户原话\n把误拦一起处理\n## 范围\n改：放宽误拦本次交接的检查\n'
        with patch.object(aj.subprocess, 'run', return_value=NS(
                returncode=0, stdout=json.dumps({'result': '{"added": []}'}))) as run, \
             patch.object(aj, '_log'):
            result = aj.judge(notes)
        args = run.call_args.args[0]
        system = args[args.index('--system-prompt') + 1]
        self.assertIn('修检查/守卫本身', system)
        self.assertIn('不算扩范围，是做完这件活的必要步骤', system)
        self.assertIn('放宽误拦本次交接的检查', run.call_args.kwargs['input'])
        self.assertEqual((result['added'], result['error']), ([], ''))

    def test_model_error_is_logged_error_not_pass(self):
        # #1492 P4：不查返回码和 is_error，模型报错时 result 里碰巧有 {} 就记成 pass
        for rc, out in ((1, json.dumps({'result': '{}'})),
                        (0, json.dumps({'is_error': True, 'result': 'API Error {"type":"overloaded"}'})),
                        (0, json.dumps({'result': '{"note": "没有 added"}'}))):
            r, verdict = self.run_judge(rc, out)
            self.assertEqual(r['added'], [])
            self.assertTrue(r['error'], out)
            self.assertEqual(verdict, 'error', out)

    def test_ok_pass_and_added(self):
        r, verdict = self.run_judge(0, json.dumps({'result': '{"added": []}'}))
        self.assertEqual((r['error'], verdict), ('', 'pass'))
        r, verdict = self.run_judge(0, json.dumps({'result': '{"added": [{"line": "英文圈", "what": "换受众"}]}'}))
        self.assertEqual((len(r['added']), verdict), (1, 'added'))

    def test_rule_mandated_line_is_not_added(self):
        # #1893 11-23：规则逼着写的行（当时是界面活的走查行，#2042 起改到交回查；现在用浏览器活的标签页行），判官以前判成「自己加的」
        notes = ('# 修下单\n## 用户原话\n「用浏览器下单最后一步报错」\n## 范围\n'
                 '- 标签页 id：1234\n')
        with patch.object(aj.subprocess, 'run') as run, patch.object(aj, '_log'):
            r = aj.judge(notes)
        self.assertFalse(run.called, '全是规则表强制要写的行，不该再调模型')
        self.assertEqual((r['added'], r['error']), ([], ''))

    def test_mandated_lines_are_told_to_the_model(self):
        notes = ('# 修下单\n## 用户原话\n「用浏览器下单最后一步报错」\n## 总目标\n修下单报错，换成英文圈爆款\n## 范围\n'
                 '- 改：下单页\n- 标签页 id：1234\n')
        with patch.object(aj.subprocess, 'run', return_value=NS(
                returncode=0, stdout=json.dumps({'result': '{"added": []}'}))) as run, patch.object(aj, '_log'):
            aj.judge(notes)
        prompt = run.call_args.kwargs['input']
        self.assertNotIn('标签页 id：', prompt.split('## 规则表强制写进交接')[0])
        self.assertIn('标签页 id：', prompt.split('## 规则表强制写进交接')[1])
        self.assertIn('换成英文圈爆款', prompt)  # 别的行照旧要判

    def test_local_rule_table_lines_are_mandated_too(self):
        # 本机 [[check]] 登记的行（别的机器没有这张表，所以登记是本机的事）
        old = aj.HOUSE_RULES
        try:
            aj.HOUSE_RULES = Path(__file__).with_name('test-house-rules.toml')
            with patch.object(aj, '_log'), patch.object(aj.subprocess, 'run') as run:
                r = aj.judge('# x\n## 用户原话\n「x」\n## 范围\n- 本机规矩：照本机守则\n')
        finally:
            aj.HOUSE_RULES = old
        self.assertFalse(run.called)
        self.assertEqual(r['added'], [])


if __name__ == '__main__':
    unittest.main()
