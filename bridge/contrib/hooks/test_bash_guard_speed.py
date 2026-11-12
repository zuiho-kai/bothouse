#!/usr/bin/env python3
"""bash-guard 规则 8（仅 DSH 提速）测试：造一份 DSH 会话记录，经 dsh-cc-compat --sessions 喂 bash-guard。
每条规则一组「拦」和「不拦」；另测 Claude Code 形状（不经 compat）一条都不拦。"""
import json, os, subprocess, sys, tempfile
H = os.path.dirname(os.path.abspath(__file__))
GUARD, COMPAT = os.path.join(H, "bash-guard.py"), os.path.join(H, "dsh-cc-compat.py")
ROOT = tempfile.mkdtemp(prefix="bg-speed-")
SID = "sess-test"


def bash(cmd, bg=False):
    a = {"command": cmd}
    if bg:
        a["run_in_background"] = True
    return ("bash", a)


def session(steps, user="帮我看看", depth=0):
    """steps：[[(工具名, 参数), …], …]，一步一条 assistant/message；参数里 _denied=True 表示被 hook 拦过。"""
    d = os.path.join(ROOT, "slug", SID)
    os.makedirs(d, exist_ok=True)
    ev = [{"type": "session", "version": 4, "id": SID, "cwd": "/tmp", "delegationDepth": depth},
          {"type": "turn/start", "data": {"turn": 1}},
          {"type": "user/message", "data": {"content": [{"type": "text", "text": user}]}}]
    n = 0
    for k, step in enumerate(steps):
        calls = []
        for name, args in step:
            n += 1
            calls.append((f"c{n}", name, {x: y for x, y in args.items() if x != "_denied"}, args.get("_denied")))
        ev.append({"type": "assistant/message", "data": {"turn": 1, "step": k + 1, "message": {"content": [
            {"type": "tool-call", "id": cid, "name": nm, "arguments": json.dumps(a)} for cid, nm, a, _ in calls]}}})
        for cid, nm, a, den in calls:
            ev.append({"type": "tool/call", "data": {"turn": 1, "step": k + 1, "callId": cid, "name": nm}})
            ev.append({"type": "hook/result", "data": {"point": "PreToolUse", "decision": "deny" if den else "pass"}})
    with open(os.path.join(d, "session.v4.jsonl"), "w") as f:
        for e in ev:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return f"c{n}"  # 最后一个调用 = 当前要判的那个


def verdict(steps, user="帮我看看", depth=0, dsh=True):
    cid = session(steps, user, depth)
    name, args = steps[-1][-1]
    args = {x: y for x, y in args.items() if x != "_denied"}
    p = {"hook_event_name": "PreToolUse", "tool_name": name if dsh else "Bash", "tool_input": args,
         "tool_use_id": cid, "session_id": SID, "cwd": "/tmp"}
    argv = [sys.executable, "-I", COMPAT, "--sessions", ROOT, GUARD] if dsh else [sys.executable, "-I", GUARD]
    out = subprocess.run(argv, input=json.dumps(p), capture_output=True, text=True, check=True, timeout=20).stdout
    return "deny" if '"deny"' in out else "hint" if "只读查询" in out else "pass", out


RO3 = [[bash("ls ~/x")], [bash("cat a.md | head -20")], [bash("git log -3 --oneline")]]
OUTING = "频道…\n\n（定时任务，回这条）\n【外出·接着】定时触发，不是用户消息。"
CASES = [  # (说明, steps, 期望, 额外参数)
    # 8a sleep
    ("前台 sleep 5", [[bash("sleep 5")]], "deny", {}),
    ("后台 sleep（带超时）", [[bash("perl -e 'alarm shift; exec @ARGV' 30 sleep 5 > /tmp/s.log 2>&1", True)]], "pass", {}),
    ("Claude Code 形状 sleep 5 不拦", [[bash("sleep 5")]], "pass", {"dsh": False}),
    # 8a 轮询
    ("第二次 gh run view 同一 run", [[bash("gh run view 123")], [bash("echo hi > /tmp/x")], [bash("gh run view 123 --json status")]], "deny", {}),
    ("gh run view 不同 run", [[bash("gh run view 123")], [bash("gh run view 456")]], "pass", {}),
    ("gh run view 再看 --log-failed", [[bash("gh run view 123")], [bash("gh run view 123 --log-failed")]], "pass", {}),
    ("第二次 gh run list", [[bash("gh run list -L 3")], [bash("python3 x.py")], [bash("gh run list --limit 5")]], "deny", {}),
    ("第一次 gh run list", [[bash("python3 x.py")], [bash("gh run list -L 3")]], "pass", {}),
    ("第二次 job_output wait 同一 job", [[("job_output", {"job_id": "j1", "wait": True})], [("job_output", {"job_id": "j1", "wait": True})]], "deny", {}),
    ("job_output wait 不同 job", [[("job_output", {"job_id": "j1", "wait": True})], [("job_output", {"job_id": "j2", "wait": True})]], "pass", {}),
    ("上次 job_output 被拦过", [[("job_output", {"job_id": "j1", "wait": True, "_denied": True})], [("job_output", {"job_id": "j1", "wait": True})]], "pass", {}),
    ("子 agent 也拦轮询", [[bash("gh run view 9")], [bash("gh run view 9")]], "deny", {"depth": 1}),
    # 8b 串行只读
    ("第 4 步单步只读", RO3 + [[bash("gh pr view 5")]], "hint", {}),
    ("第 4 步 cat 加 echo 也只提醒（#1514 原样）", RO3 + [[bash('cat ~/n/h.md; echo "=== END ==="')]], "hint", {}),
    ("echo 不算单条只读查询", [[bash("echo start")], [bash("ls")], [bash("cat a.md")], [bash("git status")]], "pass", {}),
    ("第 3 步单步只读", RO3[:2] + [[bash("gh pr view 5")]], "pass", {}),
    ("第 4 步合并成 echo === 分段", RO3 + [[bash("gh pr view 5; echo ===; git status")]], "pass", {}),
    ("第 4 步并行两个调用", RO3 + [[bash("gh pr view 5"), bash("git status")]], "pass", {}),
    ("中间有写操作打断", RO3[:2] + [[bash("python3 build.py")], [bash("git status")]], "pass", {}),
    ("中间合并过的步不计数", RO3[:2] + [[bash("ls; echo ===; cat b")], [bash("git status")]], "pass", {}),
    ("合并过的步不打断计数", RO3[:2] + [[bash("ls; echo ===; cat b")], [bash("git status")], [bash("gh api repos/a/b")]], "hint", {}),
    ("被拦的步不打断计数", RO3 + [[("bash", {"command": "gh pr view 5", "_denied": True})], [bash("grep -n x f")]], "hint", {}),
    ("DSH read 工具也算单步查询", [[("read", {"file_path": "a"})], [("read", {"file_path": "b"})], [bash("ls")], [bash("git diff")]], "hint", {}),
    ("第 4 步是写文件的命令", RO3 + [[bash("sed -i '' s/a/b/ f")]], "pass", {}),
    ("第 4 步写重定向", RO3 + [[bash("cat a > b")]], "pass", {}),
    ("子 agent 会话豁免", RO3 + [[bash("gh pr view 5")]], "pass", {"depth": 1}),
    ("外出轮豁免", RO3 + [[bash("gh pr view 5")]], "pass", {"user": OUTING}),
    ("引用里出现【外出 不算外出轮", RO3 + [[bash("gh pr view 5")]], "hint", {"user": "【外出·接着】旧消息\n（最新，回这条）\n帮我查"}),
    # 8b 重复命令
    ("重复同一条只读命令", [[bash("git status")], [bash("ls")], [bash("git   status")]], "deny", {}),
    ("重复 echo 不属于只读查询", [[bash("echo hello")], [bash("echo hello")]], "pass", {}),
    ("中间改过东西再跑", [[bash("git status")], [bash("python3 x.py")], [bash("git status")]], "pass", {}),
    ("重复非只读命令（跑测试）", [[bash("pytest -q")], [bash("pytest -q")]], "pass", {}),
    ("外出轮重复不拦", [[bash("git status")], [bash("git status")]], "pass", {"user": OUTING}),
    # 8c 联网长命令
    ("前台 git clone", [[bash("cd /tmp && git clone https://github.com/a/b.git")]], "deny", {}),
    ("前台 git clone 重定向日志仍拦", [[bash("git clone https://github.com/a/b.git > /tmp/clone.log 2>&1")]], "deny", {}),
    ("前台 git -C x fetch", [[bash("git -C ~/r fetch -q upstream --tags")]], "deny", {}),
    ("前台 npm install", [[bash("npm install")]], "deny", {}),
    ("后台 git clone", [[bash("perl -e 'alarm shift; exec @ARGV' 600 git clone https://github.com/a/b.git /tmp/b > /tmp/c.log 2>&1", True)]], "pass", {}),
    ("git log 不算联网", [[bash("git log -1")]], "pass", {}),
    ("Claude Code 形状 git clone 不拦", [[bash("git clone https://github.com/a/b.git")]], "pass", {"dsh": False}),
]

bad = 0
for desc, steps, want, kw in CASES:
    got, out = verdict(steps, **kw)
    bad += got != want
    print("ok  " if got == want else "FAIL", {"deny": "拦", "hint": "提醒"}.get(got, "放"), desc)
    if got != want:
        print("     ", out[:300])
print("全部通过" if not bad else f"{bad} 个失败")

# Incomplete session snapshots must not turn an unlocated current call into a
# repeat poll/query. These model the compatibility layer's fail-open path.
def raw_guard(payload):
    out = subprocess.run([sys.executable, "-I", GUARD], input=json.dumps(payload), capture_output=True, text=True, check=True, timeout=20).stdout
    return "deny" if '"deny"' in out else "pass"

incomplete = [
    {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_use_id": "missing",
     "tool_input": {"command": "git status"}, "dsh": True,
     "dsh_turn": {"steps": [[{"id": "old", "name": "bash", "command": "git status"}]]}},
    {"hook_event_name": "PreToolUse", "tool_name": "job_output", "tool_use_id": "missing",
     "tool_input": {"job_id": "j1", "wait": True}, "dsh": True,
     "dsh_turn": {"steps": [[{"id": "old", "name": "job_output", "job_id": "j1", "wait": True}]]}},
]
for p in incomplete:
    got = raw_guard(p)
    bad += got != "pass"
    print("ok  " if got == "pass" else "FAIL", "记录缺少当前调用时放行", got)

# A session lookup failure gives the legacy hook no turn metadata, so history-
# dependent query checks must pass while session-independent DSH sleep still applies.
payload = {"hook_event_name": "PreToolUse", "tool_name": "bash", "tool_use_id": "c1",
           "tool_input": {"command": "git status"}, "session_id": "missing", "cwd": "/tmp"}
out = subprocess.run([sys.executable, "-I", COMPAT, "--sessions", os.path.join(ROOT, "absent"), GUARD],
                     input=json.dumps(payload), capture_output=True, text=True, check=True, timeout=20).stdout
got = "deny" if '"deny"' in out else "pass"
bad += got != "pass"
print("ok  " if got == "pass" else "FAIL", "读取不到会话记录时历史规则放行", got)
sys.exit(1 if bad else 0)
