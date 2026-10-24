"""subagent-ctx-hook.py: python3 -I bridge/contrib/hooks/test_subagent_ctx_hook.py
Calls the hook functions directly and runs the script once through run.py with a temporary HOME."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("h", os.path.join(HERE, "subagent-ctx-hook.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def mk(ctx=1000, event="PreToolUse"):
    root = tempfile.mkdtemp()
    sub = os.path.join(root, "sess", "subagents")
    os.makedirs(sub)
    with open(os.path.join(sub, "agent-a1.jsonl"), "w") as f:
        f.write(json.dumps({"type": "user", "message": {"role": "user", "content": "go"}}) + "\n")
        f.write(json.dumps({"type": "assistant", "message": {"role": "assistant", "usage": {
            "input_tokens": 10, "cache_read_input_tokens": ctx - 10, "cache_creation_input_tokens": 0}}}) + "\n")
    return {"hook_event_name": event, "agent_id": "a1", "transcript_path": os.path.join(root, "sess.jsonl"),
            "tool_name": "Read", "tool_input": {}}


def mk_codex(ctx):
    root = tempfile.mkdtemp()
    p = os.path.join(root, "rollout-2026-10-23T00-00-00-x.jsonl")
    with open(p, "w") as f:
        f.write(json.dumps({"type": "event_msg", "payload": {"type": "task_started"}}) + "\n")
        f.write(json.dumps({"type": "event_msg", "payload": {"type": "token_count",
                                                              "info": {"last_token_usage": {"input_tokens": ctx}}}}) + "\n")
    return {"hook_event_name": "PreToolUse", "agent_id": "c1", "transcript_path": p, "tool_name": "Bash",
            "tool_input": {"command": "x"}}


class T(unittest.TestCase):
    def test_under_passes(self):
        self.assertIsNone(h.check(mk(ctx=149999)))
        self.assertIsNone(h.check(mk(ctx=149999, event="PostToolUse")))

    def test_over_pre_denies(self):
        o = h.check(mk(ctx=150000))["hookSpecificOutput"]
        self.assertEqual(o["permissionDecision"], "deny")
        self.assertIn("150000", o["permissionDecisionReason"])
        # only PreToolUse is installed by default, so the deny reason itself must ask for the handoff and the stop
        for w in ("交接", "做到哪", "文件在哪", "下一步", "收工"):
            self.assertIn(w, o["permissionDecisionReason"])

    def test_over_post_tip(self):
        o = h.check(mk(ctx=200000, event="PostToolUse"))["hookSpecificOutput"]
        self.assertEqual(o["hookEventName"], "PostToolUse")
        self.assertIn("交接", o["additionalContext"])

    def test_main_session_ignored(self):
        d = mk(ctx=500000)
        d.pop("agent_id")
        self.assertIsNone(h.check(d))

    def test_agent_transcript_path(self):
        d = mk(ctx=200000)
        d["agent_transcript_path"] = os.path.join(os.path.dirname(d["transcript_path"]), "sess", "subagents",
                                                  "agent-a1.jsonl")
        d["transcript_path"] = "/nonexistent.jsonl"
        self.assertEqual(h.check(d)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_context_tokens_field(self):
        d = {"hook_event_name": "PreToolUse", "agent_id": "x", "context_tokens": 160000}
        self.assertEqual(h.check(d)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_missing_transcript_passes(self):
        d = {"hook_event_name": "PreToolUse", "agent_id": "x", "transcript_path": "/nonexistent/s.jsonl"}
        self.assertIsNone(h.check(d))

    def test_codex(self):
        self.assertIsNone(h.check(mk_codex(1000)))
        self.assertIn("上下文", h.check(mk_codex(150000))["hookSpecificOutput"]["permissionDecisionReason"])

    def test_via_run_py(self):
        home = tempfile.mkdtemp()
        env = dict(os.environ, HOME=home, GATE_WIKI="off")
        env.pop("CLAUDE_PROJECT_DIR", None)
        for ctx, want in ((1000, ""), (200000, "deny")):
            r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "run.py"), "subagent-ctx-hook"],
                               input=json.dumps(mk(ctx=ctx)), capture_output=True, text=True, cwd=home, env=env,
                               timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn(want, r.stdout)
            if not want:
                self.assertEqual(r.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main(verbosity=1)
