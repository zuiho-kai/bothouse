import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import intent_judge


class ConflictEvidenceTests(unittest.TestCase):
    def test_ambiguous_character_change_is_ask(self):
        result = {"verdict": "conflict", "question": "人物换法", "answer": "换新长相",
                  "basis": "用户 11-11：「场景、构图、动作、节奏照原片和样片不动」"}
        draft = "## 用户原话\n- 用户 11-11：「不错，你可以把人物换一下啊，台词换一下」\n"
        self.assertEqual(intent_judge._validate_conflict(result, draft, ())['verdict'], "ask")

    def test_inferred_or_stale_basis_becomes_ask(self):
        result = {"verdict": "conflict", "question": "人物换脸", "answer": "换长相",
                  "basis": "用户 11-10：「人物必须换成新长相」"}
        draft = "## 用户原话\n- 用户 11-11：「不错，你可以把人物换一下啊，台词换一下」\n"
        checked = intent_judge._validate_conflict(result, draft, ())
        self.assertEqual(checked["verdict"], "ask")
        self.assertEqual(checked["answer"], "")
        self.assertIn("逐字核对", checked["basis"])

    def test_verbatim_current_user_basis_keeps_conflict(self):
        result = {"verdict": "conflict", "question": "立即发布", "answer": "先征求确认",
                  "basis": "用户 11-11：「提交前把投稿页全页截图和封面图给用户看，用户确认后再点提交」"}
        draft = "## 用户原话\n- 用户 11-11：「提交前把投稿页全页截图和封面图给用户看，用户确认后再点提交」\n"
        self.assertEqual(intent_judge._validate_conflict(result, draft, ())['verdict'], "conflict")

    def test_1125_scope_conflict_keeps_user_quote(self):
        quote = "然后就是那个b站为什么他的推流，还有就是人为什么会爱看他那条不看我们那个呢"
        result = {"verdict": "conflict", "question": "是否分析推流原因", "answer": "纳入分析",
                  "basis": f"用户 11-10：「{quote}」"}
        draft = f"## 用户原话\n- 用户 11-10 23:25：「{quote}」\n"
        self.assertEqual(intent_judge._validate_conflict(result, draft, ())['verdict'], "conflict")

    def test_0112_accuracy_conflict_keeps_user_quote(self):
        quote = "但「5 个 AI 在群里商量着干完」是片子里的剧情，做这条片的时候另外四个没参与"
        result = {"verdict": "conflict", "question": "简介是否如实描述制作", "answer": "改为剧情设定",
                  "basis": f"用户 11-11：「{quote}」"}
        draft = f"## 用户原话\n- 用户 11-11 01:12：「{quote}」\n"
        self.assertEqual(intent_judge._validate_conflict(result, draft, ())['verdict'], "conflict")

    def test_no_conflict_verdict_is_unchanged(self):
        result = {"verdict": "ask", "question": "人物换法", "answer": "", "basis": "两种读法"}
        self.assertIs(intent_judge._validate_conflict(result, "", ()), result)


class AskKindTests(unittest.TestCase):
    """ask 只有方向和花钱两类要问用户（#1437）。"""

    def test_direction_and_money_need_user(self):
        for kind in ("direction", "money"):
            self.assertTrue(intent_judge.needs_user({"verdict": "ask", "kind": kind}))

    def test_other_ask_is_own_call(self):
        for kind in ("other", "", "技术细节"):
            self.assertFalse(intent_judge.needs_user({"verdict": "ask", "kind": kind}))
        self.assertFalse(intent_judge.needs_user({"verdict": "ask"}))

    def test_non_ask_never_needs_user(self):
        self.assertFalse(intent_judge.needs_user({"verdict": "pass", "kind": "direction"}))

    def test_downgraded_conflict_keeps_kind(self):
        result = {"verdict": "conflict", "kind": "direction", "question": "人物换法", "answer": "换新长相",
                  "basis": "用户 11-10：「人物必须换成新长相」"}
        checked = intent_judge._validate_conflict(result, "## 用户原话\n- 用户 11-11：「把人物换一下」\n", ())
        self.assertEqual((checked["verdict"], checked["kind"]), ("ask", "direction"))
        self.assertTrue(intent_judge.needs_user(checked))


class PromptSplitTests(unittest.TestCase):
    """新的 ask 规则只进交接出口；回复出口（choice-ask-guard）的提示词不带。"""

    def test_reply_prompt_keeps_old_ask_rule(self):
        self.assertIn(intent_judge.ASK_REPLY, intent_judge.SYSTEM_REPLY)
        self.assertNotIn("direction", intent_judge.SYSTEM_REPLY)
        self.assertNotIn('"kind"', intent_judge.SYSTEM_REPLY)

    def test_handoff_prompt_limits_ask(self):
        self.assertIn("只有 direction 和 money 才输出 ask", intent_judge.SYSTEM_HANDOFF)
        self.assertIn('"kind"', intent_judge.SYSTEM_HANDOFF)

    def test_no_placeholder_left(self):
        for text in (intent_judge.SYSTEM_REPLY, intent_judge.SYSTEM_HANDOFF):
            self.assertNotIn("@@", text)


if __name__ == "__main__":
    unittest.main()
