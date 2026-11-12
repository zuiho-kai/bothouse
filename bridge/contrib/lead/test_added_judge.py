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


if __name__ == '__main__':
    unittest.main()
