"""#1402：带附件放行时，同一件活挂在桥上的文字 [report] 一并放行，不再 10 分钟后贴成「主角色未验收」。
两种顺序都要成立：先挂着文字、再放附件；先 --verdict 放行文字、再放附件（不重复贴）。
全在临时目录里跑真脚本；桥是假脚本：report pass 按 held.json 判有没有挂着的，记下每次调用，不发真实消息。"""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERDICT = "逐条：用户原话那条做到，证据是截图和测试输出"
FAKE = r'''
import json, sys
from pathlib import Path
calls, held = Path(sys.argv[0]).parent / "calls.jsonl", Path(sys.argv[0]).parent / "held.json"
open(calls, "a").write(json.dumps(sys.argv[1:]) + "\n")
if sys.argv[1:3] == ["report", "pass"]:
    st = json.loads(held.read_text()) if held.exists() else {}
    nid = sys.argv[sys.argv.index("--id") + 1]
    if st.get(nid) == "doubt":
        sys.stderr.write("report pass: 对题检查有疑点，verdict 要引用户原话\n"); sys.exit(1)
    if st.get(nid) != "held":
        sys.stderr.write(f"report pass: #{nid} 没有等主角色验收的文字汇报\n"); sys.exit(3)
    st[nid] = "posted"; held.write_text(json.dumps(st))
    print(f"#{nid} 的汇报已放行，贴到聊天频道")
'''


class PassClosesTextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ws-pass-text-"))
        self.setup = self.tmp / "setup"
        (self.setup / "team").mkdir(parents=True)
        bindir = self.tmp / "bin"
        bindir.mkdir()
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\n" + FAKE)
        fake.chmod(0o755)
        self.calls, self.held = bindir / "calls.jsonl", bindir / "held.json"
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOTHOUSE_DATA_DIR": str(self.tmp / "data"), "CC_BIN": str(fake), "CC_PROJECT": "lead-proj",
                    "CC_SESSION_KEY": "test:100"}
        self.notes = self.tmp / "handoff.md"
        self.notes.write_text("# 交接\n## 用户原话\n- 修\n## 总目标\n修好\n", encoding="utf-8")
        (self.setup / "ws-handoff-last.json").write_text(json.dumps({"tasks": {
            str(self.notes): {"channel": "901", "chat": "test:100", "task": "修汇报", "board": [1398]}}}), encoding="utf-8")
        (self.setup / "team" / "board.jsonl").write_text(json.dumps(
            {"id": 1398, "what": "修汇报", "where": str(self.notes), "status": "已交回待验收", "who": "工作区1橘",
             "at": "11-10 21:16", "chat": "test:100"}, ensure_ascii=False) + "\n", encoding="utf-8")
        self.shot = self.tmp / "shot.png"
        self.shot.write_bytes(b"\x89PNG\r\n\x1a\n")

    def state(self, v):
        self.held.write_text(json.dumps({"1398": v}))

    def run_pass(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "ws-pass"), *args], capture_output=True, text=True, env=self.env)

    def sent(self):
        return [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def kinds(self):
        return [c[0] if c[0] == "send" else " ".join(c[:2]) for c in self.sent()]

    def test_attachments_close_held_text(self):
        self.state("held")
        r = self.run_pass("--notes", str(self.notes), "--verdict", VERDICT, str(self.shot), "样片给你看")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.kinds(), ["report pass", "send"])  # 文字先放行，再发附件
        self.assertEqual(self.sent()[0][2:], ["--id", "1398", "--verdict", VERDICT])  # 同一句 verdict 记给文字汇报
        self.assertEqual(json.loads(self.held.read_text())["1398"], "posted")  # 挂起了结，桥不会再超时贴出
        self.assertIn("一并放行", r.stderr)

    def test_text_first_then_attachments(self):
        self.state("held")
        r = self.run_pass("--id", "1398", "--verdict", VERDICT)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.run_pass("--id", "1398", "--verdict", VERDICT, str(self.shot), "样片给你看")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.kinds(), ["report pass", "report pass", "send"])
        self.assertEqual(sum(1 for c in self.sent() if c[0] == "send"), 1)
        self.assertNotIn("失败", r.stderr)  # 第二次桥答「没有挂着的」，不算错、不重复贴

    def test_nothing_held_just_sends(self):
        r = self.run_pass("--notes", str(self.notes), "--verdict", VERDICT, str(self.shot), "样片给你看")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.kinds(), ["report pass", "send"])

    def test_text_refused_sends_nothing(self):
        self.state("doubt")  # 疑点要引用户原话才能放行（那条规矩不改）
        r = self.run_pass("--notes", str(self.notes), "--verdict", VERDICT, str(self.shot), "样片给你看")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("附件也没发", r.stderr)
        self.assertNotIn("send", self.kinds())


if __name__ == "__main__":
    unittest.main()
