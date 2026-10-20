"""tools/smoke_phone.py 的「同时 @橘和龙娘」场景的判定（不连线上，用造好的消息）。
起因：用户 2026-10-20 在 room 2 发「@橘 @龙娘 帮我算 17×23，龙娘算，橘核对」，橘 3 秒就拿 80 分钟前的「391」说核对过了
（conest issue #182）。用户原话「这种能不能让ai搞测试，我不想自己看护」。"""
from __future__ import annotations

import unittest

from tools.smoke_phone import judge_co_mention

FOOT_J = "\n\n*claude-opus-5-5 · out 68 · in 2 cw 16.5k cr 1.2k · ctx 17%\n~/im-bridge/claude*"
FOOT_L = "\n\n*gpt-6.1-sol · effort:high · out 22 · in 43.6k cw 0 cr 43.5k · ctx 17% · 额度剩余 0%\n~/im-bridge/longniang*"


def m(i, author, text, card=None):
    return {"id": i, "author": author, "author_kind": "user" if author == "user" else "role", "text": text, "card": card}


class JudgeCoMention(unittest.TestCase):
    def passed(self, msgs, a=17, b=23):
        return [ok for _, _, ok, _ in judge_co_mention(msgs, a, b)]

    def test_incident_fails(self):
        # 2026-10-20 20:39 的实际顺序：橘先回、拿的是旧数，龙娘后回
        msgs = [m(295, "maomao", "龙娘回的 391，我核对过是对的（17×20=340，17×3=51，合起来 391）。" + FOOT_J),
                m(296, "longniang", "391" + FOOT_L)]
        got = self.passed(msgs)
        self.assertFalse(got[0])   # 龙娘不在橘之前，也没 @橘
        self.assertFalse(got[2])   # 橘之前有别的回复…… 这里就是橘的核对本身在龙娘之前

    def test_good_flow_passes(self):
        msgs = [m(301, "longniang", "↪ 已插入"),
                m(302, "longniang", "@橘 391" + FOOT_L),
                m(303, "maomao", "", card='{"title":"t"}'),
                m(304, "maomao", "龙娘这一轮回的 391，17×23=391，对。" + FOOT_J)]
        self.assertEqual(self.passed(msgs), [True, True, True])

    def test_lead_quotes_other_number(self):
        msgs = [m(302, "longniang", "@橘 391" + FOOT_L),
                m(304, "maomao", "龙娘回的 551，对。" + FOOT_J)]
        self.assertEqual(self.passed(msgs), [True, False, True])

    def test_lead_quotes_number_without_verdict(self):
        # 只出现龙娘的数、没表态（conest #184 代码审查第 5 条）
        for text in ["龙娘回的 391。", "龙娘回的 391，不对，应该是 392。", "龙娘回的 391，和我算的对不上。",
                     # 复审实测会误判的说法（否定、疑问、词里的「对」、表态落在别的数上）
                     "我还没核对过龙娘的 391。", "391 不太对。", "391 绝对错了。", "391对吗？我再算", "针对龙娘的 391 我先不说。",
                     "相对来说 391 还行。", "对了，391 我还没看。", "龙娘 391。上一轮的 551 对。",
                     # 第二轮审查实测（动词「对」、「核对过程」、疑问和含糊）
                     "我先对一下 391。", "391 我待会再对一遍。", "我先比对一下 391。", "391 待校对。", "391 反对。",
                     "391，对方算的。", "391 对龙娘来说算快了", "391 的核对过程见下。", "391 对吧", "391 对么",
                     "391 是否对，等我算完", "391 也许对，等我算完", "391 可能对", "391 有误，核对过了。"]:
            msgs = [m(302, "longniang", "@橘 391" + FOOT_L), m(304, "maomao", text + FOOT_J)]
            self.assertEqual(self.passed(msgs), [True, False, True], text)

    def test_lead_says_checked(self):
        for text in ["龙娘这一轮给的 391，我核对过了。", "391 对。", "391 是对的。", "17×23=391，对。", "龙娘算对了，391。"]:
            msgs = [m(302, "longniang", "@橘 391" + FOOT_L), m(304, "maomao", text + FOOT_J)]
            self.assertEqual(self.passed(msgs), [True, True, True], text)

    def test_real_room2_checks_pass(self):
        """线上 room 2 的真实句子：核对过程里的「再加 / 再减」不是含糊词（2026-10-20 #309 被误判「没表态」）。"""
        cases = [(13, 82, [m(307, "longniang", "第 0 步 · 9秒", card='{"title":"t"}'), m(308, "longniang", "@橘 1066" + FOOT_L),
                           m(309, "maomao", "龙娘回的 1066，我核对过是对的：13×80=1040，再加 26 得 1066。" + FOOT_J)]),
                 (19, 29, [m(299, "longniang", "@橘 551" + FOOT_L),
                           m(300, "maomao", "龙娘回的 551，我核对过是对的：19×30=570，再减 19 得 551。" + FOOT_J)])]
        for a, b, msgs in cases:
            self.assertEqual(self.passed(msgs, a, b), [True, True, True], msgs[-1]["text"])

    def test_sub_answer_is_the_product(self):
        # 龙娘写了过程，最后一个数不是答案：认 A×B
        msgs = [m(302, "longniang", "@橘 17×23=391，340+51" + FOOT_L), m(304, "maomao", "龙娘回的 391，对。" + FOOT_J)]
        self.assertEqual(self.passed(msgs), [True, True, True])

    def test_lead_spoke_before_sub(self):
        msgs = [m(301, "maomao", "等龙娘算完我来核对。" + FOOT_J),
                m(302, "longniang", "@橘 391" + FOOT_L),
                m(304, "maomao", "龙娘回的 391，对。" + FOOT_J)]
        got = self.passed(msgs)
        self.assertFalse(got[0])
        self.assertFalse(got[2])

    def test_race_without_handoff_fails(self):
        # 2026-10-20 20:56 修之前实测：两个 bot 同时开轮，龙娘先发完但没 @橘，橘自己算完说「等她的数回来再对」
        msgs = [m(302, "longniang", "715" + FOOT_L),
                m(303, "maomao", "用户已经直接 @ 了龙娘，我就不再 @ 她了。我自己算的是 715（11×65=650+65），等她的数回来再对。" + FOOT_J)]
        self.assertFalse(self.passed(msgs, 11, 65)[0])

    def test_missing_replies_fail(self):
        self.assertEqual(self.passed([]), [False, False, False])
        self.assertEqual(self.passed([m(302, "longniang", "@橘 391" + FOOT_L)]), [False, False, False])


if __name__ == "__main__":
    unittest.main()
