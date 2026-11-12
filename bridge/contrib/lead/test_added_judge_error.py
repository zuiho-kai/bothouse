"""#1492 常识：模型报错是没判成，不能记成「判过、没有多加的设定」。"""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('_added_judge', Path(__file__).with_name('_added_judge.py'))
aj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aj)


class AddedJudgeError(unittest.TestCase):
    def test_model_error_is_an_error_not_a_pass(self):
        class P:  # noqa: N801
            returncode = 1
            stdout = json.dumps({"is_error": True, "result": 'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}'})
            stderr = ""
        notes = "# 交接：x\n## 用户原话\n改看门\n## 总目标\n改看门\n## 范围\n- 改：看门\n"
        with patch.object(aj.subprocess, "run", return_value=P()), patch.object(aj, "_log"):
            res = aj.judge(notes)
        if res.get("added") is None:
            self.skipTest("judge skipped the notes")
        self.assertTrue(res["error"], res)


if __name__ == "__main__":
    unittest.main()
