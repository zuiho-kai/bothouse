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


if __name__ == "__main__":
    unittest.main()
