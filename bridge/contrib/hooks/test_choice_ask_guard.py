import json, os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def run(msg, active=False):
    p = {"hook_event_name": "Stop", "last_assistant_message": msg, "stop_hook_active": active}
    out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "choice-ask-guard.py")],
                         input=json.dumps(p), capture_output=True, text=True).stdout
    return json.loads(out)["decision"] if out.strip() else ""


class ChoiceAskGuard(unittest.TestCase):
    def test_blocks_choice_without_answer(self):
        # 2026-10-31 replay: a common-sense question handed to the user
        for m in ("侧面按键在口袋里按不到，要不要改口袋或缺口？改了外观会变，请你定。",
                  "方案一走 VPS，方案二走本地，你选哪个？",
                  "要我顺手把 README 也改了吗？",
                  "用 A 还是 B？"):
            self.assertEqual(run(m), "block", m)

    def test_passes(self):
        for m in ("我的答案：A。依据：10-20 说过只用本地。为何不能自己定：方向，没选过。要不要走 B？",
                  "修好了，已经验过。", "你问的「要不要」是指什么？",
                  "> 要不要改口袋？\n我决定改口袋，因为按键要按得到。",
                  "为什么慢？因为代理挂了。", "今天吃什么？"):
            self.assertEqual(run(m), "", m)

    def test_only_once(self):
        self.assertEqual(run("要不要改？", active=True), "")


if __name__ == "__main__":
    unittest.main()
