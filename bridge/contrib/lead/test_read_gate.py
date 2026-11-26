"""#1943 读材料闸：拿 #1929 真实交接和交回原文重放；ws-up --report 整条在临时目录跑，桥是假脚本。"""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures" / "read_gate"
sys.path.insert(0, str(HERE))
import _read_gate  # noqa: E402

ITEMS = """材料逐条：
- 知乎（AI 被关在虚拟机里）：自己定闹钟、派四十多个分身打编程比赛挣到第一笔钱；和我们的关系是长期记忆记下了自己的经历
- 公众号（长时间写代码）：会话拉久模型变笨，每 30 分钟强行重开、进度存在代码文件里；我们没有定时重开
- B站 BV1zZyjzCEjf 记忆双核：对不上就一个字不推，越意外越记得住；和我们推送劣化直接相关
- B站 BV1SMxq6XE5N agent-soul：压缩后只给门牌告诉原文在哪，让模型自己取；就是用户说的给标题自己搜
- B站 BV1Nn4p6GEuy 老周：记忆分四层，新会话只带小目录，记得多没用要记对；和记忆论坛分层一致
"""


class ReadGateTest(unittest.TestCase):
    def test_1929_original_blocked(self):
        msg = _read_gate.report_block(FIX / "handoff-1929.md", FIX / "report-1929.md")
        self.assertIn("5 个链接/BV 号", msg)
        self.assertIn("只写了 0 条", msg)

    def test_1929_with_items_passes(self):
        d = Path(tempfile.mkdtemp())
        txt = (FIX / "report-1929.md").read_text(encoding="utf-8").replace("入口自验：", ITEMS + "入口自验：", 1)
        (d / "r.md").write_text(txt, encoding="utf-8")
        self.assertEqual(_read_gate.report_block(FIX / "handoff-1929.md", d / "r.md"), "")

    def test_too_few_or_empty_items_blocked(self):
        d = Path(tempfile.mkdtemp())
        short = "材料逐条：\n" + "".join(f"- 来源{i}：看了\n" for i in range(5))
        (d / "r.md").write_text(short, encoding="utf-8")
        self.assertIn("只写了 0 条", _read_gate.report_block(FIX / "handoff-1929.md", d / "r.md"))
        four = "\n".join(ITEMS.splitlines()[:5]) + "\n"
        (d / "r.md").write_text(four, encoding="utf-8")
        self.assertIn("只写了 4 条", _read_gate.report_block(FIX / "handoff-1929.md", d / "r.md"))

    def test_code_task_unaffected(self):
        self.assertEqual(_read_gate.report_block(FIX / "handoff-code-1943.md", FIX / "report-1929.md"), "")


class WsUpEntryTest(unittest.TestCase):
    """ws-up --report 整条：被拦时不调 workspace exit；补上逐条后调到 workspace exit。"""

    def run_ws_up(self, report_text):
        tmp = Path(tempfile.mkdtemp())
        setup, bindir = tmp / "setup", tmp / "bin"
        setup.mkdir(); bindir.mkdir()
        notes = tmp / "handoff.md"
        shutil.copy(FIX / "handoff-1929.md", notes)
        calls = tmp / "calls.jsonl"
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\nimport json,sys\nopen({str(calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\nprint('ok')\n")
        fake.chmod(0o755)
        (setup / "ws-handoff-last.json").write_text(json.dumps(
            {"tasks": {str(notes): {"channel": "ws1", "chat": "discord:1:2", "task": "t", "file": str(notes), "board": [1929]}}}), encoding="utf-8")
        (setup / "team").mkdir()  # 归属只按任务号查任务板（board.owner_chat）
        (setup / "team" / "board.jsonl").write_text(json.dumps(
            {"id": 1929, "what": "t", "where": str(notes), "ws": "discord:ws1", "chat": "discord:1:2"}) + "\n", encoding="utf-8")
        env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(tmp), "GATE_SETUP_DIR": str(setup),
               "BOTHOUSE_DATA_DIR": str(tmp / "data"), "CC_BIN": str(fake), "CC_PROJECT": "p", "CC_SESSION_KEY": "discord:ws1"}
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-up"), "--notes", str(notes), "--report", "-"],
                           input=report_text, capture_output=True, text=True, env=env)
        cmds = [json.loads(l)[:2] for l in calls.read_text().splitlines()] if calls.exists() else []
        return r, cmds

    def test_entry(self):
        orig = (FIX / "report-1929.md").read_text(encoding="utf-8")
        r, cmds = self.run_ws_up(orig)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("材料逐条", r.stderr)
        self.assertNotIn(["workspace", "exit"], cmds)
        r, cmds = self.run_ws_up(orig.replace("入口自验：", ITEMS + "入口自验：", 1))
        self.assertIn(["workspace", "exit"], cmds, r.stderr)


if __name__ == "__main__":
    unittest.main()
