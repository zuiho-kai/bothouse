"""Regression checks at the shared hook entry; these are not live model acceptance."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

RUN = Path(__file__).with_name("run.py")


class WorkflowCLIs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.map = self.root / "routing.md"
        self.map.write_text("keywords: routing, hooks\n")
        self.env = dict(os.environ, CODEMAP_DIR=str(self.root), HOME=str(self.root),
                        DSH_HOME=str(self.root / "dsh"), GATE_WIKI="off")
        for key in ("CC_PROJECT", "CC_SESSION_KEY", "BOTHOUSE_DATA_DIR", "HOOK_PROXY"):
            self.env.pop(key, None)

    def call(self, name, payload, cli=""):
        args = [sys.executable, "-I", str(RUN)]
        if cli:
            args.append("--" + cli)
        result = subprocess.run(args + [name], input=json.dumps(payload), text=True,
                                capture_output=True, env=self.env, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout or "{}")

    def test_codex_message_rewrite_keeps_arguments(self):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "spawn_agent",
                   "tool_input": {"message": "fix routing hooks", "agent_type": "worker"}}
        out = self.call("codemap-inject", payload, "codex")
        args = out["hookSpecificOutput"]["updatedInput"]
        self.assertIn(str(self.map), args["message"])
        self.assertEqual(args["agent_type"], "worker")
        self.assertNotIn("prompt", args)
        payload["tool_input"] = args
        self.assertEqual(self.call("codemap-inject", payload, "codex"), {})

    def test_gemini_native_input_rewrite(self):
        payload = {"hook_event_name": "BeforeTool", "tool_name": "invoke_agent",
                   "tool_input": {"prompt": "fix routing hooks", "agent_name": "researcher"}}
        out = self.call("codemap-inject", payload)
        args = out["hookSpecificOutput"]["tool_input"]
        self.assertIn(str(self.map), args["prompt"])
        self.assertEqual(args["agent_name"], "researcher")
        self.assertNotIn("updatedInput", out["hookSpecificOutput"])

    def test_dsh_denies_with_retry_instead_of_ignored_rewrite(self):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "subagent",
                   "tool_input": {"prompt": "fix routing hooks"}}
        out = self.call("codemap-inject", payload)["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn(str(self.map), out["permissionDecisionReason"])
        self.assertNotIn("updatedInput", out)
        payload["tool_input"]["prompt"] += " " + str(self.map)
        self.assertEqual(self.call("codemap-inject", payload), {})

    def test_dsh_timeout_uses_native_units_on_retry(self):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "bash", "agent_id": "child",
                   "tool_input": {"command": "echo check", "timeoutMs": 600000}}
        out = self.call("bash-guard", payload)["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn('"timeoutMs": 290000', out["permissionDecisionReason"])

    def test_grok_native_wait_cap(self):
        out = self.call("bash-guard", {"hook_event_name": "PreToolUse", "tool_name": "run_terminal_command",
            "subagentType": "execute", "session_id": "child", "tool_input": {"command": "echo check", "block_until_ms": 600000}}, "grok")
        args = out["hookSpecificOutput"]["updatedInput"]
        self.assertEqual(args, {"command": "echo check", "block_until_ms": 290000})

    def test_grok_native_dispatch(self):
        out = self.call("codemap-inject", {"hook_event_name": "PreToolUse", "tool_name": "spawn_subagent",
            "tool_input": {"prompt": "fix routing hooks", "description": "repair"}}, "grok")
        self.assertIn(str(self.map), out["hookSpecificOutput"]["updatedInput"]["prompt"])

    def test_polling_denied_for_all_cli_names(self):
        for cli, event, tool in [
            ("", "PreToolUse", "Bash"), ("codex", "PreToolUse", "Bash"),
            ("grok", "PreToolUse", "run_terminal_command"),
            ("", "BeforeTool", "run_shell_command"), ("", "PreToolUse", "bash"),
        ]:
            with self.subTest(cli=cli, tool=tool):
                out = self.call("bash-guard", {"hook_event_name": event, "tool_name": tool,
                    "tool_input": {"command": "until test -f result; do sleep 5; done"}}, cli)
                decision = out.get("decision") or out["hookSpecificOutput"]["permissionDecision"]
                self.assertEqual(decision, "deny")

    def test_gemini_after_tool_fills_map(self):
        report = f"## 地图要补的条目（{self.map}）\n- router core/router.go:12\n"
        self.call("codemap-fill", {"hook_event_name": "AfterTool", "tool_name": "invoke_agent",
                                  "tool_input": {}, "tool_response": report})
        self.assertIn("- router core/router.go:12", self.map.read_text())


if __name__ == "__main__":
    unittest.main()
