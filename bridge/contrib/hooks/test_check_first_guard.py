"""check-first（#1527）：团队聊天频道整道不查；同类检查已删，只问一次判断器。不调模型：python3 -I contrib/hooks/test_check_first_guard.py"""
import importlib.util, os, sys, unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("check_first_guard", os.path.join(HERE, "check-first-guard.py"))
cf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cf)

PASS = {"verdict": "pass", "claim": "", "ms": 1, "cost": 0}
BLOCK = {"verdict": "unchecked", "claim": "我们的桥已经有这条检查", "ms": 1, "cost": 0}


class T(unittest.TestCase):
    def test_team_chat_never_judged(self):
        with patch.object(cf, "turn", return_value=("我们的桥已经有这条检查", [], "有吗")), \
             patch.object(cf, "_team_chat", return_value=True), \
             patch.object(cf, "ask_model", return_value=BLOCK) as m:
            self.assertIsNone(cf.check({"transcript_path": "x"}))
        self.assertEqual(m.call_count, 0)

    def test_workspace_still_blocks_unchecked_claim(self):
        with patch.object(cf, "turn", return_value=("我们的桥已经有这条检查", [], "有吗")), \
             patch.object(cf, "_team_chat", return_value=False), \
             patch.object(cf, "ask_model", return_value=BLOCK) as m, patch.object(cf.intent_judge, "_log"):
            self.assertIn("先查", cf.check({"transcript_path": "x"}))
        self.assertEqual(m.call_count, 1)

    def test_no_same_kind_second_call(self):
        self.assertFalse(hasattr(cf, "SYSTEM_SAME"))
        with patch.object(cf, "turn", return_value=("我们另起一套质检单", [], "下一代架构怎么搞")), \
             patch.object(cf, "_team_chat", return_value=False), \
             patch.object(cf, "ask_model", return_value=PASS) as m, patch.object(cf.intent_judge, "_log"):
            self.assertIsNone(cf.check({"transcript_path": "x"}))
        self.assertEqual(m.call_count, 1)

    # #1563：agentm 11-13 claude 没搜就说不认识 muse
    MUSE = "你说的第一步我已经设好了。像 muse 这种我还不确定是哪家产品的名字，查不清会如实写出来。"

    def test_unknown_name_without_search_blocks_even_in_team_chat(self):
        with patch.object(cf, "turn", return_value=(self.MUSE, [{"type": "tool_use", "name": "Bash", "input": {"command": "cat > a.md <<'EOF'\n用 websearch.py search 搜\nEOF\nbothouse cron add"}}], "看 muse")), \
             patch.object(cf, "_team_chat", return_value=True), \
             patch.object(cf, "ask_model", return_value=PASS) as m, patch.object(cf.intent_judge, "_log"):
            why = cf.check({"transcript_path": "x"})
        self.assertIn("先搜", why)
        self.assertEqual(m.call_count, 0)

    def test_unknown_name_after_search_passes(self):
        for tool in ({"name": "WebSearch", "input": {"query": "muse agent"}},
                     {"name": "Bash", "input": {"command": "uv run -q --script ~/.bothouse/tools/websearch.py search muse"}},
                     {"name": "Agent", "input": {"prompt": "搜一下 muse 是哪家的"}}):
            with patch.object(cf, "turn", return_value=(self.MUSE, [dict(tool, type="tool_use")], "看 muse")), \
                 patch.object(cf, "_team_chat", return_value=True), patch.object(cf.intent_judge, "_log"):
                self.assertIsNone(cf.check({"transcript_path": "x"}), tool["name"])

    def test_unknown_name_not_triggered_by_intent_or_quote(self):
        for s in ("我不确定你说的是哪个方案，A 还是 B？", "用户说「不知道是哪家的你不会去搜一下」，下次先搜。", "今天天气不错。", "说明里改成了：遇到不认识的名字先搜清楚是哪家的什么产品，真搜不到才标。"):
            self.assertEqual(cf.unknown_name(s), "", s)
        self.assertTrue(cf.unknown_name("这个 ZCode 我没听说过是什么产品"))


if __name__ == "__main__":
    unittest.main()
