#!/usr/bin/env python3
"""bash-guard 规则 14：gh pr merge 先问 merge-gate guard。团队工具装在 collaboration/runtime/lead 时也要找得到
（同 core/role_env.go；之前只找 collaboration/lead，这种安装下合并从没查过）。"""
import json, os, subprocess, sys, tempfile
GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bash-guard.py")


def run(cmd, data):
    p = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": cmd}, "session_id": "t", "cwd": "/tmp"}
    env = {k: v for k, v in os.environ.items() if k not in ("HOOK_MERGE_GATE", "GATE_SETUP_DIR")}
    env["BOTHOUSE_DATA_DIR"] = data
    out = subprocess.run([sys.executable, "-I", GUARD], input=json.dumps(p), capture_output=True, text=True, env=env).stdout
    return json.loads(out)["hookSpecificOutput"] if out.strip() else {}


for sub in (("runtime", "lead"), ("lead",)):
    data = tempfile.mkdtemp(prefix="mg-hook.")
    d = os.path.join(data, "collaboration", *sub)
    os.makedirs(d)
    gate = os.path.join(d, "merge-gate")
    with open(gate, "w") as f:
        f.write("#!/bin/sh\necho '会把已合的提交退回去'\nexit 1\n")
    os.chmod(gate, 0o755)
    o = run("gh pr merge 2206 -R o/r --squash", data)
    assert o.get("permissionDecision") == "deny" and "退回" in o["permissionDecisionReason"], (sub, o)
    assert run("gh pr view 2206 -R o/r", data) == {}, sub
print("ok")
