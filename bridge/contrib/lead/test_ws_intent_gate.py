"""ws-handoff 的 intent_gate：两种读法（ask）只有方向和花钱退回让问用户，别的放行并记一行进交接（#1437）。
判断器换成假的，不调模型。"""
import importlib.machinery, importlib.util, os, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "hooks"))
import intent_judge  # noqa: E402


def load():
    # 脚本一加载就读团队和任务板目录：全指到临时目录，不碰线上（同 test_ws_guard 的 env）
    tmp = tempfile.mkdtemp()
    for k in ("CC_DATA_DIR", "CC_SESSION_KEY", "CC_SESSION", "CC_PROJECT"):
        os.environ.pop(k, None)
    os.environ.update(HOME=tmp, GATE_SETUP_DIR=f"{tmp}/setup", BOARD_DIR=f"{tmp}/board", BOTHOUSE_DATA_DIR=f"{tmp}/data")
    ld = importlib.machinery.SourceFileLoader("ws_handoff_under_test", str(HERE / "ws-handoff"))
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader(ld.name, ld))
    ld.exec_module(mod)
    return mod


class IntentGateAskTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ws = load()

    def setUp(self):
        self.real = intent_judge.judge
        self.addCleanup(lambda: setattr(intent_judge, "judge", self.real))

    def gate(self, **r):
        base = {"verdict": "pass", "kind": "", "question": "", "answer": "", "basis": ""}
        intent_judge.judge = lambda *a, **k: {**base, **r}
        return self.ws.intent_gate("# 交接")

    def test_other_ask_passes_with_a_line(self):
        err, own = self.gate(verdict="ask", kind="other", question="便宜模型干不动就退回贵模型", basis="(1) 合理兜底；(2) 和分工冲突。")
        self.assertIsNone(err)
        self.assertTrue(own.startswith("这处主角色自己定了：便宜模型干不动就退回贵模型"))
        self.assertIn("(1) 合理兜底", own)

    def test_ask_without_kind_passes(self):
        err, own = self.gate(verdict="ask", question="先出方案给主角色看", basis="内部步骤还是向用户加确认")
        self.assertIsNone(err)
        self.assertIn("先出方案给主角色看", own)

    def test_direction_ask_blocks(self):
        err, own = self.gate(verdict="ask", kind="direction", question="把本机模型换成云端", basis="用户点名本机")
        self.assertIn("换方向", err)
        self.assertIn("先问用户确认", err)
        self.assertIsNone(own)

    def test_money_ask_blocks(self):
        err, own = self.gate(verdict="ask", kind="money", question="充值 200 美元", basis="没批过这笔钱")
        self.assertIn("花钱", err)
        self.assertIsNone(own)

    def test_pass_has_no_line(self):
        self.assertEqual(self.gate(verdict="pass"), (None, None))

    def test_self_and_conflict_still_block(self):
        self.assertIn("自己定", self.gate(verdict="self", question="q", answer="a", basis="b")[0])
        self.assertIn("冲突", self.gate(verdict="conflict", kind="other", question="q", answer="a", basis="b")[0])

    def test_append_own_replaces_old_section(self):
        p = Path(tempfile.mkdtemp()) / "notes.md"
        p.write_text("# 标题\n\n## 范围\n- 改：x\n", encoding="utf-8")
        self.ws.append_own(str(p), "这处主角色自己定了：一")
        self.ws.append_own(str(p), "这处主角色自己定了：二")
        text = p.read_text(encoding="utf-8")
        self.assertEqual(text.count(f"## {self.ws.OWN}"), 1)
        self.assertNotIn("：一", text)
        self.assertTrue(text.endswith("- 这处主角色自己定了：二\n"))
        self.assertIn("## 范围\n- 改：x\n", text)


if __name__ == "__main__":
    unittest.main()
