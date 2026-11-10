"""bash-guard 规则 9b：Codex 在团队聊天频道收到真人派的活，几步内没交工作区就拦（agentm 2026-11-10 实录）。
经 run.py --codex 入口喂 Codex rollout 形状的会话记录，不跑真命令。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

RUN = Path(__file__).with_name("run.py")
HUMAN = "[bothouse sender_id=1569535351499006082 sender_name=\"u\" platform=discord chat_id=111]\n看看哪些 PR 可以关"
TIMER = "[bothouse sender_id=timer sender_name=\"timer\" platform=discord chat_id=111]\n（定时任务，回这条）"


def msg(role, text):
    return {"type": "response_item", "payload": {"type": "message", "role": role,
            "content": [{"type": "input_text" if role == "user" else "output_text", "text": text}]}}


def call(cmd):
    return {"type": "response_item", "payload": {"type": "custom_tool_call", "call_id": cmd[:8], "name": "exec",
            "input": f"text(await tools.exec_command({{cmd:{json.dumps(cmd)}}}))"}}


class CodexChatHandoff(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="bg-9b-")
        Path(self.d, "team_workspaces.json").write_text(json.dumps(
            {"parents": {"discord:111": [{"id": "222", "name": "工作区1"}]}}))

    def run_hook(self, events, cmd, chan="111"):
        path = Path(self.d, "rollout.jsonl")
        path.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in events))
        env = dict(os.environ, BOTHOUSE_DATA_DIR=self.d, CC_SESSION_KEY=f"discord:{chan}:u")
        p = {"hook_event_name": "PreToolUse", "tool_name": "exec_command", "tool_input": {"cmd": cmd},
             "transcript_path": str(path)}
        r = subprocess.run([sys.executable, "-I", str(RUN), "--codex", "bash-guard"], input=json.dumps(p),
                           capture_output=True, text=True, timeout=20, env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout) if r.stdout.strip() else {}
        return (out.get("hookSpecificOutput") or {}).get("permissionDecision")

    def turn(self, n, user=HUMAN, extra=()):
        return [msg("user", "# AGENTS.md instructions for /w\n..."), msg("user", user)] + \
            [call(f"cat /x/README.md #{k}") for k in range(n)] + list(extra)

    def test_blocks_after_four_steps_in_chat(self):
        self.assertEqual(self.run_hook(self.turn(4), "sed -n '500,735p' ws-handoff"), "deny")

    def test_three_steps_pass(self):
        self.assertIsNone(self.run_hook(self.turn(3), "rg agent-infer notes"))

    def test_handoff_commands_pass(self):
        t = self.turn(6)
        self.assertIsNone(self.run_hook(t, "ws-handoff notes/a.md \"任务\" --short 核对"))
        self.assertIsNone(self.run_hook(t, "python3 - <<'PY'\nopen('/home/agent/work/notes/a.md','a')\nPY"))
        self.assertIsNone(self.run_hook(t, "board show 33"))

    def test_after_handoff_pass(self):
        t = self.turn(4, extra=[call("ws-handoff --resume 33 'x'")])
        self.assertIsNone(self.run_hook(t, "cat foo"))

    def test_workspace_and_timer_and_no_team_pass(self):
        self.assertIsNone(self.run_hook(self.turn(6), "cat foo", chan="222"))
        self.assertIsNone(self.run_hook(self.turn(6, user=TIMER), "cat foo"))
        os.remove(Path(self.d, "team_workspaces.json"))
        self.assertIsNone(self.run_hook(self.turn(6), "cat foo"))

    def test_hook_prompt_does_not_reset_turn(self):
        t = self.turn(2) + [msg("user", "<hook_prompt hook_run_id=\"stop:5\">先查</hook_prompt>")] + \
            [call("cat a"), call("cat b")]
        self.assertEqual(self.run_hook(t, "cat c"), "deny")


if __name__ == "__main__":
    unittest.main()
