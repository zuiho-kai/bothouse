"""check-first（#1527）：团队聊天频道整道不查；同类检查已删，只问一次判断器。#1565：本轮没搜时另问「没搜就答」判断器（聊天频道也问）。不调模型：python3 -I contrib/hooks/test_check_first_guard.py"""
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

    UNS = {"verdict": "unchecked", "claim": "像 muse 这种我还不确定是哪家产品的名字", "ms": 1, "cost": 0}

    def _run(self, reply, tools, verdict, team=True):
        with patch.object(cf, "turn", return_value=(reply, tools, "看 muse")), \
             patch.object(cf, "_team_chat", return_value=team), \
             patch.object(cf, "ask_model", return_value=verdict) as m, patch.object(cf.intent_judge, "_log"):
            return cf.check({"transcript_path": "x"}), m

    def test_unknown_name_without_search_asks_judge_even_in_team_chat(self):
        tools = [{"type": "tool_use", "name": "Bash", "input": {"command": "cat > a.md <<'EOF'\n用 websearch.py search 搜\nEOF\nbothouse cron add"}}]
        why, m = self._run(self.MUSE, tools, self.UNS)
        self.assertIn("先搜", why)
        self.assertEqual(m.call_count, 1)
        self.assertIs(m.call_args.kwargs["system"], cf.SYSTEM_UNSEARCHED)
        why, _ = self._run(self.MUSE, tools, PASS)
        self.assertIsNone(why)  # 判断器说不算就放行，不再靠正则硬拦

    # #1565 回放：没在回复里认不知道，而是把「查清 muse 是谁家的」写进交接推给工作区
    def test_deferred_lookup_in_handoff_reaches_judge(self):
        cmd = ("cat > /tmp/h.md <<'EOF'\n## 范围\n- 改：名字不认识的先查清是谁家的（muse、workbuddy）\nEOF\n"
               "ws-handoff /tmp/h.md \"agent技术洞察\"")
        reply = "这件活已经交给工作区2了，频道建好后你会先看到第一份清单。"
        why, m = self._run(reply, [{"type": "tool_use", "name": "Bash", "input": {"command": cmd}}], self.UNS)
        self.assertIn("先搜", why)
        self.assertIn("查清是谁家的", m.call_args.kwargs["extra"])

    def test_version_without_search_reaches_judge(self):
        why, m = self._run("Claude Code 现在最新是 2.3.1。", [], PASS)
        self.assertIsNone(why)
        self.assertEqual(m.call_count, 1)

    def test_plain_chat_does_not_call_judge(self):
        why, m = self._run("今天天气不错，晚点聊。", [], self.UNS)
        self.assertIsNone(why)
        self.assertEqual(m.call_count, 0)

    def test_task_texts_only_this_turn_and_task_like(self):
        tools = [{"name": "Write", "input": {"file_path": "/x/notes/h.md", "content": "先查清 X"}},
                 {"name": "Write", "input": {"file_path": "/x/a.go", "content": "func main"}},
                 {"name": "Bash", "input": {"command": "bothouse timer add --delay 1m --prompt '核实 Y 的版本'"}},
                 {"name": "Bash", "input": {"command": "ls -la"}},
                 {"name": "Write", "input": {"file_path": "/x/notes/old.md", "content": "旧的"}, "_earlier": True}]
        t = cf.task_texts(tools)
        self.assertIn("先查清 X", t)
        self.assertIn("核实 Y 的版本", t)
        self.assertNotIn("func main", t)
        self.assertNotIn("ls -la", t)
        self.assertNotIn("旧的", t)

    def test_unknown_name_after_search_passes(self):
        for tool in ({"name": "WebSearch", "input": {"query": "muse agent"}},
                     {"name": "Bash", "input": {"command": "uv run -q --script ~/.bothouse/tools/websearch.py search muse"}},
                     {"name": "Agent", "input": {"prompt": "搜一下 muse 是哪家的"}}):
            why, m = self._run(self.MUSE, [dict(tool, type="tool_use")], self.UNS)
            self.assertIsNone(why, tool["name"])
            self.assertEqual(m.call_count, 0)

    def test_unknown_name_not_triggered_by_intent_or_quote(self):
        for s in ("我不确定你说的是哪个方案，A 还是 B？", "用户说「不知道是哪家的你不会去搜一下」，下次先搜。", "今天天气不错。", "说明里改成了：遇到不认识的名字先搜清楚是哪家的什么产品，真搜不到才标。"):
            self.assertEqual(cf.unknown_name(s), "", s)
        self.assertTrue(cf.unknown_name("这个 ZCode 我没听说过是什么产品"))
        self.assertTrue(cf.unknown_name(self.MUSE).startswith("像 muse 这种我还不确定是哪家产品的名字"))

    def test_unknown_name_search_in_earlier_turn_does_not_count(self):
        old = {"type": "tool_use", "name": "WebSearch", "input": {"query": "agent news"}, "_earlier": True}
        why, _ = self._run(self.MUSE, [old], self.UNS)
        self.assertIn("先搜", why)


if __name__ == "__main__":
    unittest.main()
