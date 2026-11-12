#!/usr/bin/env python3
"""bash-guard 规则 6（前台干等）测试：Claude 形状直喂 bash-guard，DSH 形状经 dsh-cc-compat 再喂。"""
import json, os, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__))
GUARD, COMPAT = os.path.join(H, "bash-guard.py"), os.path.join(H, "dsh-cc-compat.py")


def denied(cmd, bg=False, dsh=False):
    inp = {"command": cmd}
    if bg:
        inp["run_in_background"] = True
    p = {"hook_event_name": "PreToolUse", "tool_name": "bash" if dsh else "Bash", "tool_input": inp,
         "session_id": "test", "cwd": "/tmp"}
    argv = [sys.executable, "-I", COMPAT, GUARD] if dsh else [sys.executable, "-I", GUARD]
    out = subprocess.run(argv, input=json.dumps(p), capture_output=True, text=True, check=True, timeout=20).stdout
    return '"deny"' in out and "干等" in out


CASES = [  # (命令, 后台?, 应拦?)
    ("gh run watch 123", False, True),
    ("gh pr checks 5 --watch", False, True),
    ("gh run watch --exit-status 9 && echo ok", False, True),
    ("sleep 60", False, True),
    ("sleep 5m", False, True),
    ("cd x; sleep 120; ls", False, True),
    ("until gh run view 1 | grep -q completed; do sleep 20; done", False, True),
    ("while true; do\n  curl -s localhost:8000\n  sleep 10\ndone", False, True),
    ("perl -e 'alarm shift; exec @ARGV' 600 gh run watch 123 > /tmp/w.log 2>&1", True, False),
    ("for i in $(seq 1 28); do gh pr checks 1 | grep -q pending || break; python3 -c 'import time;time.sleep(20)'; done", False, True),
    ("perl -e 'alarm 270; exec @ARGV' gh pr checks 1599 --watch", False, True),
    ("perl -e 'alarm 270; exec @ARGV' gh pr checks 1599 --watch > /tmp/w.log 2>&1", True, False),
    ("for f in a b; do python3 -c 'import time;time.sleep(1)'; done", False, False),
    ("sleep 5", False, "DSH"),  # DSH 前台 sleep 一律拦（2026-10-22），CC 照旧 <60 秒放
    ("sleep 30 && ls", False, "DSH"),
    ("npm run watch", False, False),
    ("tsc --watch", False, False),
    ("gh run view 123 --log-failed", False, False),
    ("gh pr checks 5", False, False),
    ("while read l; do echo $l; done < f", False, False),
    ("cat > t.sh <<'EOF'\nuntil x; do sleep 99; done\nEOF\nchmod +x t.sh", False, False),
    ("git status", False, False),
]

bad = 0
for dsh in (False, True):
    for cmd, bg, want in CASES:
        got = denied(cmd, bg, dsh)
        want = dsh if want == "DSH" else want
        bad += got != want
        print("ok  " if got == want else "FAIL", "DSH" if dsh else "CC ", "拦" if got else "放", repr(cmd)[:70])
print("全部通过" if not bad else f"{bad} 个失败")
sys.exit(1 if bad else 0)
