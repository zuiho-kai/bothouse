import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import intent_judge


class ConflictEvidenceTests(unittest.TestCase):
    def test_ambiguous_character_change_is_ask(self):
        result = {"verdict": "conflict", "question": "人物换法", "answer": "换新长相",
                  "basis": "用户 11-11：「重做整段人物动作」"}
        draft = "## 用户原话\n- 用户 11-11：「人物换一下」\n"
        records = [("2026-11-11T00:45:00Z", "用户:zuiho", "人物换一下", "discord:1", "longniang/1")]
        self.assertEqual(intent_judge._validate_conflict(result, draft, (), records)['verdict'], "ask")

    def test_inferred_or_stale_basis_becomes_ask(self):
        result = {"verdict": "conflict", "question": "人物换脸", "answer": "换长相",
                  "basis": "用户 11-10：「人物必须换成新长相」"}
        draft = "## 用户原话\n- 用户 11-10：「人物必须换成新长相」\n"
        records = [("2026-11-10T00:45:00Z", "用户:zuiho", "别换角色", "discord:1", "longniang/1")]
        checked = intent_judge._validate_conflict(result, draft, (), records)
        self.assertEqual(checked["verdict"], "ask")
        self.assertEqual(checked["answer"], "")
        self.assertIn("逐字核对", checked["basis"])

    def test_verbatim_current_user_basis_keeps_conflict(self):
        quote = "发布前先把预览给我看"
        result = {"verdict": "conflict", "question": "立即发布", "answer": "先征求确认",
                  "basis": f"用户 2026-11-11：「{quote}」"}
        draft = f"## 用户原话\n- 用户 2026-11-11：「{quote}」\n"
        records = [("2026-11-11T00:45:00Z", "用户:zuiho", quote, "discord:1", "longniang/1")]
        self.assertEqual(intent_judge._validate_conflict(result, draft, (), records)['verdict'], "conflict")

    def test_quote_copied_into_handoff_is_not_history_evidence(self):
        quote = "用户原话写在交接里"
        result = {"verdict": "conflict", "question": "做法", "answer": "按旧规则",
                  "basis": f"用户 11-10：「{quote}」"}
        draft = f"## 用户原话\n- 用户 11-10：「{quote}」\n"
        self.assertEqual(intent_judge._validate_conflict(result, draft, (), [])['verdict'], "ask")

    def test_quote_must_match_user_and_date(self):
        quote = "投稿前确认内容"
        result = {"verdict": "conflict", "question": "发布", "answer": "先确认",
                  "basis": f"用户 11-11：「{quote}」"}
        team_record = ("2026-11-11T01:12:00Z", "橘", quote, "discord:1", "maomao/1")
        wrong_day = ("2026-11-10T01:12:00Z", "用户:zuiho", quote, "discord:1", "longniang/1")
        self.assertEqual(intent_judge._validate_conflict(result.copy(), "", (), [team_record])['verdict'], "ask")
        self.assertEqual(intent_judge._validate_conflict(result.copy(), "", (), [wrong_day])['verdict'], "ask")

    def test_dated_historical_user_quote_keeps_conflict(self):
        quote = "先提交改写版供我审阅"
        result = {"verdict": "conflict", "question": "交回稿件", "answer": "先给预览",
                  "basis": f"用户 11-09：「{quote}」"}
        record = ("2026-11-09T10:54:00Z", "用户:zuiho", quote, "discord:1", "maomao/1")
        self.assertEqual(intent_judge._validate_conflict(result, "", (), [record])['verdict'], "conflict")

    def test_no_conflict_verdict_is_unchanged(self):
        result = {"verdict": "ask", "question": "人物换法", "answer": "", "basis": "两种读法"}
        self.assertIs(intent_judge._validate_conflict(result, "", ()), result)


if __name__ == "__main__":
    unittest.main()
