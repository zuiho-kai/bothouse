"""ask-only-guard 离线测试：用户这条是只在问（拦）还是叫做（放行）。"""
import importlib.util, json, os, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("aog", os.path.join(HERE, "ask-only-guard.py"))
aog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aog)

# agentm 11-09 01:30 真实原话：明确请求开频道，被误判成只在问
AGENTM_1109 = ('你可以给我触发定时任务吗? 我想你开一个"vllm-rlt日常维护"channel, 你每天在里面给我干几件事, '
               '包括issue维护, pr维护, 每日最新技术现状洞察, 还有日常维护. 具体的要求我会在频道里跟你讲.')


class AskOnlyGuard(unittest.TestCase):
    def test_blocks_pure_questions(self):
        for m in ("修了么", "什么进度", "修好了没", "开了吗", "跑通了吗", "别改", "怎么做的？"):
            self.assertTrue(aog.only_asking(m), m)

    def test_passes_requests(self):
        for m in (AGENTM_1109, "做", "可以", "帮我改一下", "能不能帮我建个频道？", "我想你开一个频道",
                  "你可以给我配一个定时任务吗？", "开始创建频道"):
            self.assertFalse(aog.only_asking(m), m)

    def test_url_question_mark_is_not_a_question(self):
        links = "精选：https://subs.example.org/c/?token=326ad4c9 速度＞0.1m：https://subs.example.org/c/?token=5d25f2af"
        self.assertFalse(aog.only_asking(links))
        self.assertFalse(aog.only_asking("https://example.org/a?b=1"))
        self.assertTrue(aog.only_asking("https://example.org/a?b=1 这个修了么"))
        self.assertFalse(aog.only_asking("帮我记一下 https://example.org/a?b=1"))

    def test_mid_turn_message_is_the_latest(self):
        """Claude Code logs a message sent mid-turn as an attachment line (queued_command), after the user line."""
        def transcript(*entries):
            with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
                for e in entries:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
            self.addCleanup(os.unlink, f.name)
            return f.name
        user = lambda t: {"type": "user", "message": {"content": t}}
        mid = lambda t, mode="prompt": {"type": "attachment",
                                        "attachment": {"type": "queued_command", "prompt": t, "commandMode": mode}}
        result = {"type": "user", "message": {"content": [{"type": "tool_result", "content": "ok"}]}}
        p = transcript(user("（最新，回这条）\n修了么"), mid("（最新，回这条）\n帮我记录一下免费的机场"), result)
        self.assertEqual(aog.user_words(aog.last_prompt(p)), "帮我记录一下免费的机场")
        p = transcript(user("帮我改一下"), mid("修了么"), result)
        self.assertTrue(aog.only_asking(aog.user_words(aog.last_prompt(p))))
        # a later ordinary user line wins; a queued notification that is not a prompt is skipped
        p = transcript(mid("修了么"), user("做"), mid("<task-notification>done?</task-notification>", "task-notification"))
        self.assertEqual(aog.last_prompt(p), "做")


if __name__ == "__main__":
    unittest.main()
