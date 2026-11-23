"""#1904 对照件闸在工作区出口：ws-pass 放行（带附件、只放行文字）前调 gate/deliver.py 的 exit_check，和主会话发附件是同一个判断。
用户 11-23 认可的做法：「交之前，由一个只拿到你原话和原件的新人，把成品和原件并排比一遍，写出最大的三处差别，跟成品一起交给你。」
全在临时目录里跑真脚本；桥是假脚本，只记下每次调用，不发真实消息。"""
import hashlib, json, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERDICT = "逐条：用户原话那条做到，证据是成品"
DIFFS = ["开头原件一句点题、成品绕了三句", "原件白字、成品黄字", "结尾少了原件最后一段"]
FAKE = r'''
import json, sys
from pathlib import Path
open(Path(sys.argv[0]).parent / "calls.jsonl", "a").write(json.dumps(sys.argv[1:]) + "\n")
'''


class PassCompareTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ws-pass-compare-"))
        self.setup = self.tmp / "setup"
        (self.setup / "team" / "deliver").mkdir(parents=True)
        bindir = self.tmp / "bin"
        bindir.mkdir()
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\n" + FAKE)
        fake.chmod(0o755)
        self.calls = bindir / "calls.jsonl"
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOTHOUSE_DATA_DIR": str(self.tmp / "data"), "CC_BIN": str(fake), "CC_PROJECT": "lead-proj",
                    "CC_SESSION_KEY": "test:100"}
        self.notes = self.tmp / "handoff.md"
        self.notes.write_text("# 交接\n## 用户原话\n- 照原件做\n## 总目标\n做好\n", encoding="utf-8")
        (self.setup / "ws-handoff-last.json").write_text(json.dumps({"tasks": {
            str(self.notes): {"channel": "901", "chat": "test:100", "task": "做稿子", "board": [1904]}}}), encoding="utf-8")
        (self.setup / "team" / "board.jsonl").write_text(json.dumps(
            {"id": 1904, "what": "做稿子", "where": str(self.notes), "status": "已交回待验收", "who": "工作区1橘",
             "at": "11-23 21:16", "chat": "test:100"}, ensure_ascii=False) + "\n", encoding="utf-8")
        self.made = self.tmp / "made.md"
        self.made.write_text("成品", encoding="utf-8")
        self.orig = self.tmp / "orig.md"
        self.orig.write_text("原件", encoding="utf-8")

    def record(self, compared=None, **kw):
        rec = {"id": "1904", "title": "做稿子", "chat": "test:100", "stage": "样", "product": str(self.made),
               "refs": [], "approvals": [], "compares": []}
        rec.update(kw)
        if compared is not None:  # 一份对着 compared 这个内容比出来的对照件
            rec["compares"] = [{"product": str(self.made), "sha256": hashlib.sha256(compared).hexdigest(),
                                "against": str(self.orig), "diffs": DIFFS, "at": "2026-11-23T21:00:00+09:00"}]
        (self.setup / "team" / "deliver" / "1904.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")

    def hold(self, body):
        d = self.tmp / "data" / "team-reports"
        d.mkdir(parents=True, exist_ok=True)
        (d / "lead-proj.json").write_text(json.dumps({"k": {"key": "k", "kind": "report", "board": 1904, "held": True,
                                                            "chat": "100", "body": body}}, ensure_ascii=False), encoding="utf-8")

    def run_pass(self, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / "ws-pass"), *args], capture_output=True, text=True, env=self.env)

    def sent(self):
        return [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def message(self):
        a = next(c for c in self.sent() if c[0] == "send")
        return a[a.index("--message") + 1]

    def test_unregistered_job_sends_as_before(self):
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "稿子给你")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.message(), "稿子给你")

    def test_attachment_needs_fresh_compare(self):
        self.record(refs=[str(self.orig)])
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "稿子给你")  # 有原件、没对照件
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("没有对照件", r.stderr)
        self.assertIn("board compare 1904", r.stderr)
        self.assertEqual(self.sent(), [])  # 文字汇报也没放、附件也没发
        self.record(refs=[str(self.orig)], compared=b"\xe6\x88\x90\xe5\x93\x81")  # 「成品」现在这份的对照件
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "稿子给你")
        self.assertEqual(r.returncode, 0, r.stderr)
        msg = self.message()
        self.assertTrue(msg.startswith("稿子给你"))
        for d in DIFFS:
            self.assertIn(d, msg)  # 三处差别跟成品同一条消息
        self.made.write_text("成品改过一版", encoding="utf-8")  # 成品换了：旧对照件作废
        self.calls.unlink()
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "稿子给你")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("没有对照件", r.stderr)
        self.assertEqual(self.sent(), [])

    def test_no_ref_no_sample_needs_a_question(self):
        self.record()
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "稿子给你")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("问话", r.stderr)
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "先写了第一段，是这个口气吗？")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.message(), "先写了第一段，是这个口气吗？")

    def test_text_release_checked_too(self):
        self.record(refs=[str(self.orig)])
        self.hold("做完了，成品在 made.md")
        r = self.run_pass("--id", "1904", "--verdict", VERDICT)  # 只放行文字：登记的成品没对照件，照样不放
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("没有对照件", r.stderr)
        self.assertEqual(self.sent(), [])
        self.record(refs=[str(self.orig)], compared=b"\xe6\x88\x90\xe5\x93\x81")
        r = self.run_pass("--id", "1904", "--verdict", VERDICT)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([" ".join(c[:2]) if c[0] == "report" else c[0] for c in self.sent()], ["report pass", "send"])
        for d in DIFFS:
            self.assertIn(d, self.message())  # 桥照原文贴汇报，三处差别紧跟着另发一条

    def test_broken_record_does_not_block(self):
        (self.setup / "team" / "deliver" / "1904.json").write_text("{坏的", encoding="utf-8")
        r = self.run_pass("--id", "1904", "--verdict", VERDICT, str(self.made), "稿子给你")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.message(), "稿子给你")


if __name__ == "__main__":
    unittest.main()
