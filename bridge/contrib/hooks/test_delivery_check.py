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
        self.env.update(HOME=str(self.role), GATE_WIKI="off")
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


if __name__ == "__main__":
    unittest.main()
