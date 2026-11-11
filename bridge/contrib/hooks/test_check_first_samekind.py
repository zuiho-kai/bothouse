"""check-first：提议新做、自带同类时附系统自带能力给判断器（#1436）。不调模型：python3 -I contrib/hooks/test_check_first_samekind.py"""
import importlib.util, os, sys, unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("check_first_guard", os.path.join(HERE, "check-first-guard.py"))
cf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cf)

CAPS = ["大家记得同一件事：所有角色读写同一份 Markdown Wiki；面板里的「记忆论坛」给每条记忆打分排序。"]


class T(unittest.TestCase):
    def test_proposing(self):
        self.assertTrue(cf.proposing("视频负责人手里定一张质检单，你骂过的也记在上面"))
        self.assertTrue(cf.proposing("我们另起一套经验库"))
        self.assertFalse(cf.proposing("已发出，等她交回"))
        self.assertFalse(cf.proposing("「另起一套」是你上次说的"))  # 引号里是引用

    def test_caps_attached_only_for_proposals(self):
        with patch.object(cf, "builtin_caps", return_value=CAPS):
            self.assertIn("记忆论坛", cf.caps_block("每块定一个负责人，手里备一张质检单"))
            self.assertEqual(cf.caps_block("已发出，等她交回"), "")

    def test_same_kind_reason(self):
        with patch.object(cf, "turn", return_value=("我们另起一套质检单", [], "下一代架构怎么搞")), \
             patch.object(cf, "ask_model", return_value={"verdict": "unchecked", "claim": "提议新做〈质检单〉，自带〈记忆论坛〉做同一件事，回复没点名它", "ms": 1, "cost": 0}), \
             patch.object(cf.intent_judge, "_log"):
            why = cf.check({"transcript_path": "x"})
        self.assertIn("自带的同类", why)


if __name__ == "__main__":
    unittest.main()
