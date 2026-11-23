"""Delivery checks through run.py; commands are inspected, never executed."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


class DeliveryCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.role = Path(self.tmp.name)
        self.file = self.role / "finished.png"
        self.file.write_bytes(b"artifact")
        self.log = self.role / "turn.jsonl"
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("CC_", "BOTHOUSE_", "CONEST_", "CLAUDE_", "DSH_", "GATE_"))}
        self.board = self.role / "team"  # 任务板目录放进临时目录：对照件那项读 <任务板目录>/deliver/*.json
        self.env.update(HOME=str(self.role), GATE_WIKI="off", BOARD_DIR=str(self.board))
        self.sheet("add", "cover", "use the required color")

    def sheet(self, *args):
        result = subprocess.run(
            [sys.executable, "-I", str(HERE / "accept.py"), "--role", str(self.role), *map(str, args)],
            capture_output=True, text=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)

    def call(self, cli="", command=None):
        command = command or f"bothouse send --image '{self.file}'"
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash",
                   "cwd": str(self.role), "transcript_path": str(self.log),
                   "tool_input": {"command": command}}
        flags = []
        if cli == "gemini":
            payload.update(hook_event_name="BeforeTool", tool_name="run_shell_command")
        elif cli == "grok":
            flags = ["--grok"]
            payload["tool_name"] = "run_terminal_command"
        elif cli == "dsh":
            payload["tool_name"] = "bash"
        elif cli == "codex":
            flags = ["--codex"]
        elif cli == "agy":
            flags = ["--agy", "PreToolUse"]
            payload = {"workspacePaths": [str(self.role)],
                       "toolCall": {"name": "run_command", "args": {"CommandLine": command}}}
        result = subprocess.run(
            [sys.executable, "-I", str(HERE / "run.py"), "--role", str(self.role), *flags, "bash-guard"],
            input=json.dumps(payload), capture_output=True, text=True, env=self.env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("passing\n", result.stderr, result.stderr)
        output = json.loads(result.stdout or "{}")
        self.reason = output.get("reason") or output.get("hookSpecificOutput", {}).get("permissionDecisionReason") or ""
        return output.get("decision") or output.get("hookSpecificOutput", {}).get("permissionDecision")

    def test_open_sheet_blocks_then_complete_check_allows(self):
        for cli in ("", "codex", "gemini", "grok", "dsh", "agy"):
            with self.subTest(cli=cli):
                self.assertEqual(self.call(cli), "deny")
        self.sheet("check", "cover", self.file, "the final image has the required color")
        for cli in ("", "codex", "gemini", "grok", "dsh", "agy"):
            with self.subTest(cli=cli):
                self.assertNotEqual(self.call(cli), "deny")

    def test_new_requirement_and_changed_file_invalidate_check(self):
        self.sheet("check", "cover", self.file, "color checked")
        self.sheet("add", "cover", "use the required title")
        self.assertEqual(self.call(), "deny")
        self.sheet("check", "cover", self.file, "color checked", "title checked")
        self.file.write_bytes(b"changed artifact")
        self.assertEqual(self.call(), "deny")

    def test_disabled_check_and_plain_text_pass(self):
        self.assertNotEqual(self.call(command="bothouse send 'status'"), "deny")
        switch = self.role / ".bothouse" / "conest-hooks.json"
        switch.parent.mkdir()
        switch.write_text(json.dumps({"off": ["deliver-check"]}))
        for cli in ("", "agy"):
            self.assertNotEqual(self.call(cli), "deny")

    def test_codex_original_image_read_survives_normalization(self):
        self.sheet("check", "cover", self.file, "color checked")
        events = [
            {"type": "response_item", "payload": {"type": "message", "role": "user",
                                                 "content": [{"type": "input_text", "text": "send image"}]}},
            {"type": "response_item", "timestamp": "2099-01-01T00:00:00Z",
             "payload": {"type": "function_call", "name": "view_image", "call_id": "read",
                         "arguments": json.dumps({"path": str(self.file)})}},
        ]
        self.log.write_text("\n".join(map(json.dumps, events)) + "\n")
        self.assertNotEqual(self.call("codex"), "deny")
        self.log.write_text(json.dumps(events[0]) + "\n")
        self.assertEqual(self.call("codex"), "deny")

    def test_codex_code_mode_nested_read_and_image_view_count(self):
        # 11-06 隔壁龙娘：functions.exec 里嵌套 cat 报告、看压缩包预览图，旧钩子认不出被拦
        self.sheet("check", "cover", self.file, "color checked")
        user = {"type": "response_item", "payload": {"type": "message", "role": "user",
                                                    "content": [{"type": "input_text", "text": "send it"}]}}
        cat = {"type": "event_msg", "timestamp": "2099-01-01T00:00:00Z",
               "payload": {"type": "item_completed", "item": {
                   "type": "CommandExecution", "id": "exec-1", "cwd": "file://" + str(self.file.parent),
                   "status": "completed", "exit_code": 0,
                   "parsed_cmd": [{"type": "read", "cmd": "cat " + self.file.name, "path": self.file.name}]}}}
        view = {"type": "event_msg", "timestamp": "2099-01-01T00:00:00Z",
                "payload": {"type": "item_completed", "item": {
                    "type": "ImageView", "id": "exec-2", "path": "file://" + str(self.file)}}}
        failed = json.loads(json.dumps(cat))
        failed["payload"]["item"]["exit_code"] = 1
        for ev in (cat, view):
            self.log.write_text("\n".join(map(json.dumps, [user, ev])) + "\n")
            self.assertNotEqual(self.call("codex"), "deny")
        self.log.write_text("\n".join(map(json.dumps, [user, failed])) + "\n")
        self.assertEqual(self.call("codex"), "deny")
        self.log.write_text("\n".join(map(json.dumps, [cat, user])) + "\n")
        self.assertEqual(self.call("codex"), "deny")

    def test_claude_requires_read_after_latest_file_change(self):
        self.sheet("check", "cover", self.file, "color checked")
        events = [
            {"type": "user", "message": {"content": "send image"}},
            {"type": "assistant", "timestamp": "2000-01-01T00:00:00Z",
             "message": {"content": [{"type": "tool_use", "name": "Read", "id": "read",
                                       "input": {"file_path": str(self.file)}}]}},
        ]
        self.log.write_text("\n".join(map(json.dumps, events)) + "\n")
        self.assertEqual(self.call(), "deny")
        events[1]["timestamp"] = "2099-01-01T00:00:00Z"
        self.log.write_text("\n".join(map(json.dumps, events)) + "\n")
        self.assertNotEqual(self.call(), "deny")

    # ---- 对照件（#1904）：登记过的成品，交给用户前要有干净模型写的三处差别，并且带在话里 ----
    DIFFS = ["标题原件两行、成品挤成一行", "主色原件是橘色、成品偏红", "右下角少了原件的角标"]

    def deliver_record(self, **kw):
        rec = {"id": "1904", "title": "封面", "chat": "discord:1", "stage": "样", "product": str(self.file),
               "refs": [], "approvals": [], "compares": []}
        rec.update(kw)
        (self.board / "deliver").mkdir(parents=True, exist_ok=True)
        (self.board / "deliver" / "1904.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")

    def board_compare(self):
        """真跑 board compare；模型用假的 claude 顶替（回固定的三处差别）。"""
        bindir = self.role / "bin"
        bindir.mkdir(exist_ok=True)
        fake = bindir / "claude"
        fake.write_text("#!%s\nimport json, sys\nsys.stdin.read()\nprint(json.dumps({'type': 'result', 'result': "
                        "json.dumps({'diffs': %r})}))\n" % (sys.executable, self.DIFFS), encoding="utf-8")
        fake.chmod(0o755)
        env = dict(self.env, PATH="%s:%s" % (bindir, self.env.get("PATH", "")), GATE_SETUP_DIR=str(self.role), CC_BIN="/usr/bin/false")
        r = subprocess.run([sys.executable, "-I", str(HERE.parent / "gate" / "board.py"), "compare", "1904", "--quote", "照原件做"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def send(self, message):
        return self.call(command="bothouse send --image '%s' -m '%s'" % (self.file, message))

    def test_compare_gate(self):
        self.sheet("done", "cover")  # 没有开着的验收单，只看对照件这项
        ref = self.role / "ref.png"
        ref.write_bytes(b"original")
        self.assertNotEqual(self.send("做好了"), "deny")  # 没登记的文件不管
        self.deliver_record(refs=[str(ref)])
        for cli in ("", "codex", "gemini", "grok", "dsh", "agy"):  # 有原件、没对照件：拒
            with self.subTest(cli=cli):
                self.assertEqual(self.call(cli, "bothouse send --image '%s' -m '做好了'" % self.file), "deny")
        self.assertIn("没有对照件", self.reason)
        self.assertIn("board compare 1904", self.reason)
        self.board_compare()
        self.assertEqual(self.send("做好了"), "deny")  # 有对照件，三处差别没带在话里：拒，理由里给出要带的那段
        self.assertIn("差别没带上", self.reason)
        for d in self.DIFFS:
            self.assertIn(d, self.reason)
        said = "做好了\n和原件比：\n" + "\n".join("%d. %s" % (k, d) for k, d in enumerate(self.DIFFS, 1))
        for cli in ("", "codex", "gemini", "grok", "dsh", "agy"):  # 补了对照件、差别带上：放行
            with self.subTest(cli=cli):
                self.assertNotEqual(self.call(cli, "bothouse send --image '%s' -m '%s'" % (self.file, said)), "deny")
        self.file.write_bytes(b"artifact v2")  # 成品换了（指纹变）：又被拒
        self.assertEqual(self.send(said), "deny")
        self.assertIn("没有对照件", self.reason)

    def test_no_ref_no_sample_needs_a_question(self):
        self.sheet("done", "cover")
        self.deliver_record()  # 登记过，没原件、用户也没认过样
        self.assertEqual(self.send("做好了，给你"), "deny")
        self.assertIn("问话", self.reason)
        self.assertNotEqual(self.send("先出了一小段，是这个感觉吗？"), "deny")
        other = self.role / "other.png"  # 同一条里没登记的文件不受影响
        other.write_bytes(b"other")
        self.assertNotEqual(self.call(command="bothouse send --image '%s' -m '顺手发一张'" % other), "deny")


if __name__ == "__main__":
    unittest.main()
