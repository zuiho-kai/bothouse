#!/usr/bin/env python3
"""bash-guard 规则 11：测试命令接管道时自动加 pipefail / 接 grep 时提示（反思 11-02 a 类）。"""
import json, os, subprocess, sys
GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bash-guard.py")

def run(cmd, **extra):
    p = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": dict(command=cmd, **extra), "session_id": "t", "cwd": "/tmp"}
    out = subprocess.run([sys.executable, "-I", GUARD], input=json.dumps(p), capture_output=True, text=True).stdout
    return json.loads(out)["hookSpecificOutput"] if out.strip() else {}

o = run("cd b && go test ./core -run X -count=1 2>&1 | tail")
assert o["updatedInput"]["command"].startswith("set -o pipefail; cd b && go test"), o
o = run("python3 -m pytest -q | tail -5")
assert o["updatedInput"]["command"].startswith("set -o pipefail;"), o
o = run("go test ./... 2>&1 | grep -E '^(FAIL|ok)'")
assert "updatedInput" not in o and "退出码" in o["additionalContext"], o
assert run("set -o pipefail; go test ./x | tail") == {}
assert run("~/im-bridge/bin/testrun /tmp/l go test ./x") == {}
assert run("ls | tail") == {}
assert run("go test ./x") == {}
# 子 agent：timeout 压到 290 秒与 pipefail 同时生效
o = run("go test ./x | tail", timeout=600000) if False else None
p = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "agent_id": "a1", "agent_type": "general-purpose",
     "tool_input": {"command": "go test ./x | tail", "timeout": 600000}, "session_id": "t", "cwd": "/tmp"}
o = json.loads(subprocess.run([sys.executable, "-I", GUARD], input=json.dumps(p), capture_output=True, text=True).stdout)["hookSpecificOutput"]
assert o["updatedInput"]["timeout"] == 290000 and o["updatedInput"]["command"].startswith("set -o pipefail;"), o
print("ok")

# 反思 11-03：绕过前台干等的三种写法
def decision(cmd):
    return run(cmd).get("permissionDecision")
assert decision("perl -e 'alarm shift; exec @ARGV' 1500 caffeinate -w 92644; cat /tmp/x") == "deny"
assert decision("sleep 20; perl -e 'alarm shift; exec @ARGV' 1500 gh pr checks 898 --watch > /tmp/l 2>&1") == "deny"
assert decision("for i in $(seq 1 38); do kill -0 $(cat r.pid) 2>/dev/null || break; sleep 8; done") == "deny"
assert decision("for f in a b; do curl -x http://127.0.0.1:7890 u/$f; sleep 1; done") is None
assert decision("perl -e 'alarm shift; exec @ARGV' 300 make build") is None
print("ok wait")
