"""开工那一轮按活本身匹配（kickoff_query / kickoff_boiler / in_prompt）：python3 -I contrib/gate/test_ctxsvc_kickoff.py"""
import sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxsvc

HANDOFF = "# 石头短片返工\n\n## 用户原话\n- 「第一帧要能当封面，换时代别跳位」\n\n## 总目标\n铜版画质感短片返工。\n\n## 范围\n- 改：别的东西\n"


class T(unittest.TestCase):
    def test_kickoff_uses_task_and_handoff_sections(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "h.md"
            f.write_text(HANDOFF, encoding="utf-8")
            text = f"你是工作区频道里的主角色，从主频道接手一整块大活：石头短片返工。先读交接 {f}。工作区规矩：做完照交回骨架交 [report]，任务板 board update。"
            q = ctxsvc.kickoff_query(text)
            self.assertIn("石头短片返工", q)
            self.assertIn("第一帧要能当封面", q)
            self.assertIn("铜版画质感", q)
            self.assertNotIn("board update", q)  # 开工套话不进查询
            self.assertNotIn("别的东西", q)       # 只取用户原话、总目标两节
            boiler = set(ctxsvc.search.toks(ctxsvc.kickoff_boiler(text)))
            self.assertTrue(ctxsvc.in_prompt("- 做完照交回骨架交 report，任务板 board update", boiler))
            self.assertFalse(ctxsvc.in_prompt("- 做短片换时代时石头人物不跳位", boiler))

    def test_not_kickoff(self):
        self.assertIsNone(ctxsvc.kickoff_query("今天按钮颜色怎么定"))
        self.assertIsNone(ctxsvc.kickoff_query("先读交接 /nonexistent/x.md"))  # 交接文件不存在不算开工


if __name__ == "__main__":
    unittest.main()
