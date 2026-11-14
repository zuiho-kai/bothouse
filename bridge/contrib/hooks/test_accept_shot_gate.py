"""Accept gate (#1617): ws-pass / board done need every screenshot of the held [report] opened first.

Runs run.py in an isolated data dir; commands are inspected, never executed.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class AcceptShotGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / "data"
        (self.data / "team-reports").mkdir(parents=True)
        (self.data / "team").mkdir()
        (self.data / "team" / "board.jsonl").write_text("")
        shots = self.root / "shots"
        shots.mkdir()
        self.a, self.b, self.c = shots / "a.png", shots / "b.png", shots / "c.png"
        self.a.write_bytes(b"page a")
        self.b.write_bytes(b"page b")
        self.c.write_bytes(b"page c")
        self.log = self.root / "turn.jsonl"
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("CC_", "BOTHOUSE_", "CONEST_", "CLAUDE_", "DSH_", "GATE_"))}
        self.env.update(HOME=str(self.root), GATE_WIKI="off", CC_DATA_DIR=str(self.data),
                        CC_PROJECT="maomao", CC_SESSION_KEY="discord:111")

    def hold(self, *reports):
        recs = {}
        for i, (board, chat, imgs) in enumerate(reports):
            body = "#%d 背景：测试\n做了页面\n要你做的：没有\n我加的：无\n细节：\n入口自验：\n%s\n" % (
                board, "\n".join(str(p) for p in imgs))
            recs["k%d" % i] = {"key": "k%d" % i, "kind": "report", "board": board, "chat": chat,
                               "held": True, "posted": False, "body": body}
        (self.data / "team-reports" / "maomao.json").write_text(json.dumps(recs, ensure_ascii=False))

    def opened(self, *paths):
        lines = [{"type": "user", "message": {"content": "验收"}, "timestamp": "2026-11-14T05:00:00Z"}]
        for i, p in enumerate(paths):
            lines.append({"type": "assistant", "timestamp": "2099-01-01T00:00:00Z", "message": {"content": [
                {"type": "tool_use", "id": "t%d" % i, "name": "Read", "input": {"file_path": str(p)}}]}})
            lines.append({"type": "user", "timestamp": "2099-01-01T00:00:00Z", "message": {"content": [
                {"type": "tool_result", "tool_use_id": "t%d" % i, "content": "img"}]}})
        self.log.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n")

    def call(self, command):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(self.root),
                   "transcript_path": str(self.log), "tool_input": {"command": command}}
        r = subprocess.run([sys.executable, "-I", str(HERE / "run.py"), "--role", str(self.root), "bash-guard"],
                           input=json.dumps(payload), capture_output=True, text=True, env=self.env, timeout=10)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout or "{}")
        hso = out.get("hookSpecificOutput", {})
        return (out.get("decision") or hso.get("permissionDecision"),
                out.get("reason") or hso.get("permissionDecisionReason") or "")

    def test_no_id_checks_every_held_report_in_channel(self):
        # 两份都挂着、不写编号：两份都要查，不再放过（用户 11-14 打回「等于留了后门」）
        self.hold((2001, "111", [self.a]), (2002, "111", [self.b]))
        self.opened(self.a)
        decision, reason = self.call("ws-pass --verdict 逐条")
        self.assertEqual(decision, "deny")
        self.assertIn("#2002", reason)
        self.assertIn(str(self.b), reason)
        self.assertNotIn("#2001", reason)
        self.assertIn("--id", reason)

    def test_no_id_passes_when_every_held_report_seen(self):
        self.hold((2001, "111", [self.a]), (2002, "111", [self.b]))
        self.opened(self.a, self.b)
        decision, _ = self.call("ws-pass --verdict 逐条")
        self.assertNotEqual(decision, "deny")

    def test_no_id_ignores_other_channels(self):
        self.hold((2001, "111", [self.a]), (2003, "999", [self.c]))
        self.opened(self.a)
        decision, _ = self.call("ws-pass --verdict 逐条")
        self.assertNotEqual(decision, "deny")

    def test_id_only_checks_that_report(self):
        self.hold((2001, "111", [self.a]), (2002, "111", [self.b]))
        self.opened(self.a)
        self.assertNotEqual(self.call("ws-pass --id 2001 --verdict 逐条")[0], "deny")
        self.assertEqual(self.call("board done 2002 已合")[0], "deny")


if __name__ == "__main__":
    unittest.main()
