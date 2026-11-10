"""ask-only-guard 离线测试：用户这条是只在问（拦）还是叫做（放行）。"""
import importlib.util, os, sys, unittest

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


if __name__ == "__main__":
    unittest.main()
