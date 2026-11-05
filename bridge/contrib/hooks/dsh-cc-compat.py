#!/usr/bin/env python3
"""DSH payload adapter; standalone CLI: [--sessions <root>] <hook.py>. Not a registered hook."""
import glob
import json, re
import os
import subprocess
import sys
import tempfile
import time

# DSH 工具名 → Claude Code 工具名（DSH 工具名见 dsh-base/cordis.patch.yml:380-405）
NAMES = {
    "bash": "Bash",
    "read": "Read",
    "write": "Write",
    "edit": "Edit",
    "glob": "Glob",
    "grep": "Grep",
    "subagent": "Agent",
    "subagent_fork": "Agent",
    "workflow": "Agent",
}
HERE = os.path.dirname(os.path.abspath(__file__))
STOP_STATE = os.path.join(HERE, "state", "dsh-stop-hook.json")  # {session_id: 已拦过的 turn}


def export_mod():
    """Use the packaged DSH reader and transcript converter; no local installation dependency."""
    import importlib.util
    from types import SimpleNamespace
    spec = importlib.util.spec_from_file_location("hook_runner", os.path.join(HERE, "run.py"))
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    def session_file(directory):
        for suffix in ("", ".zstd"):
            p = os.path.join(directory, "session.v4.jsonl" + suffix)
            if os.path.isfile(p):
                return p
    return SimpleNamespace(
        dsh_session_file=session_file,
        dsh_lines=lambda path, head=False, timeout=20: runner.read_lines(path, head=head),
        dsh_records=lambda path, cwd, lines: runner.transcript(runner.records(lines), cwd))


def session_file(sessions, sid):
    ex = export_mod()
    if not sessions or not sid or not ex:
        return None
    for d in sorted(glob.glob(os.path.join(glob.escape(sessions), "*", glob.escape(sid)))):
        f = ex.dsh_session_file(d)
        if f:
            return str(f)
    return None


def header(path):
    try:
        # 3 秒：PreToolUse 的 hook 超时是 10 秒（作者记录），超时等于放行，解头帧要在那之前放弃；实测 0.1 秒
        d = json.loads((export_mod().dsh_lines(path, head=True, timeout=3) or [""])[0])
        return d if isinstance(d, dict) and d.get("type") == "session" else {}
    except Exception:
        return {}


def last_turn(lines):
    turn = 0
    for line in lines:
        if '"turn/start"' not in line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "turn/start":
            turn = (d.get("data") or {}).get("turn", turn)
    return turn


def busy(lines):
    """本会话还在跑的子 agent 和后台任务（每项一句说明）。
    子 agent：subagent/catalog 出现过 childId，且还没有 source.kind == "subagent-settled" 的完成通知
      （事件形状见 作者记录）。
    后台任务：job/registered 了还没 job/settled，且它的 tool/result 已经回来（工具已返回、命令还在跑 =
      run_in_background 或超时转后台；并行的前台命令还没有 tool/result，不算）。"""
    children, settled, jobs, done, results = {}, set(), {}, set(), set()
    for line in lines:
        head = line[:40]
        if not any(k in head for k in ("subagent/catalog", "agent/inbox/spliced", "job/", "tool/result")):
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t, d = ev.get("type"), ev.get("data") or {}
        if t == "subagent/catalog" and d.get("childId"):
            children[d["childId"]] = d.get("label") or ""
        elif t == "agent/inbox/spliced":
            for m in d.get("inserted") or []:
                src = (m or {}).get("source") or {}
                if src.get("kind") == "subagent-settled" and src.get("senderSessionId"):
                    settled.add(src["senderSessionId"])
        elif t == "job/registered" and d.get("jobId"):
            jobs[d["jobId"]] = d
        elif t == "job/settled" and d.get("jobId"):
            done.add(d["jobId"])
        elif t == "tool/result":
            cid = (d.get("message") or {}).get("toolCallId")
            if cid:
                results.add(cid)
    out = [f"子 agent {cid[:8]}（{label}）" for cid, label in children.items() if cid not in settled]
    for jid, d in jobs.items():
        if jid not in done and ((d.get("toolCall") or {}).get("callId") in results):
            out.append(f"后台任务 {jid}（{str(d.get('label') or '')[:60]}）")
    return out


OUTING_MARK = "【外出"  # 外出轮：bothouse 定时触发，消息最后一段以【外出·出门/接着/回家】开头（见 作者记录）
LATEST_MARK = "回这条）"  # 系统拼的块之后的「（最新，回这条）」「（定时任务，回这条）」，后面才是这一轮真正的消息


def is_outing(text):
    tail = text.rsplit(LATEST_MARK, 1)[-1] if LATEST_MARK in text else text
    return tail.strip().startswith(OUTING_MARK)


# 定时、看门、交接这类桥自己发的轮（bothouse 消息头 sender_id=timer|heartbeat|handoff|cron），不是真人派活
AUTO_SENDER = re.compile(r"\[bothouse sender_id=(?:timer|heartbeat|handoff|cron)\b")


def is_auto(text):
    return bool(AUTO_SENDER.search(text))


def slim(name, arguments):
    """工具调用只留 bash-guard 判断用得到的字段（write 的正文之类不往下传）。"""
    try:
        a = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
    except ValueError:
        a = {}
    a = a if isinstance(a, dict) else {}
    if name == "bash":
        return {"name": name, "command": str(a.get("command") or ""), "bg": a.get("run_in_background") is True}
    if name == "job_output":
        return {"name": name, "job_id": str(a.get("job_id") or ""), "wait": a.get("wait") is True}
    return {"name": name}


def turn_calls(lines):
    """当前轮（最后一个 turn/start 之后）的工具调用，按步分组：
    {"turn": 轮号, "outing": 是不是外出轮, "steps": [[{id, name, command|job_id…, denied}, …], …]}。
    一步 = 一条 assistant/message（里面的 tool-call 是这一步并行发出的调用）；
    denied = 这个调用之后紧跟着 PreToolUse 的 hook/result decision=deny（被拦、没执行）。
    事件形状见 作者记录）。"""
    start = 0
    for i in range(len(lines) - 1, -1, -1):
        if '"turn/start"' in lines[i][:40]:
            start = i
            break
    keys = ('"turn/start"', '"user/message"', '"assistant/message"', '"tool/call"', '"hook/result"')
    steps, ids, last, user, turn, started = [], {}, None, None, None, None
    for line in lines[start:]:
        if not any(k in line[:40] for k in keys):
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t, d = ev.get("type"), ev.get("data") or {}
        if t == "turn/start":
            turn = d.get("turn")
            started = ev.get("time")  # 毫秒；ws-cap-guard 算本轮时长用
        elif t == "user/message" and user is None:
            user = " ".join(x.get("text", "") for x in d.get("content") or [] if isinstance(x, dict))
        elif t == "assistant/message":
            calls = []
            for x in (d.get("message") or {}).get("content") or []:
                if isinstance(x, dict) and x.get("type") == "tool-call":
                    c = dict(slim(x.get("name"), x.get("arguments")), id=x.get("id"), denied=False)
                    calls.append(c)
                    ids[c["id"]] = c
            if calls:
                steps.append(calls)
        elif t == "tool/call":
            last = d.get("callId")
        elif t == "hook/result" and d.get("point") == "PreToolUse" and d.get("decision") == "deny" and last in ids:
            ids[last]["denied"] = True
    return {"turn": turn, "outing": is_outing(user or ""), "auto": is_auto(user or ""), "steps": steps,
            "started": started}


def has_call(info, cid):
    return any(c.get("id") == cid for step in info["steps"] for c in step)


def last_ctx_tokens(lines):
    """最新一条 assistant/message 的上下文大小 = inputTokens + cacheReadTokens + cacheWriteTokens
    （DSH usage 字段，例：0c2646b5 第 1101 行 149 + 141696 + 0，totalTokens 再加 outputTokens）。"""
    for line in reversed(lines):
        if '"assistant/message"' not in line[:40] or '"usage"' not in line:
            continue
        try:
            u = (json.loads(line).get("data") or {}).get("usage") or {}
        except ValueError:
            continue
        if u:
            return u.get("inputTokens", 0) + u.get("cacheReadTokens", 0) + u.get("cacheWriteTokens", 0)
    return None


def wants_busy(name, inp):
    if not isinstance(inp, dict):
        return False
    if name == "bash":
        return "sleep" in str(inp.get("command") or "")
    return name == "job_output" and inp.get("wait") is True


def add_fields(payload, name, sub, read, want_turn=False):
    """PreToolUse/PostToolUse 补字段 dsh_turn / dsh_busy / context_tokens（见文件说明第 3 条）。
    name 是 DSH 的原工具名（小写），read() 返回会话记录的行；run.py 的 DSH 路径也调这里。"""
    event = payload.get("hook_event_name")
    need_busy = event == "PreToolUse" and wants_busy(name, payload.get("tool_input"))
    # want_turn：ws-cap-guard 管所有工具，每个调用都要本轮计数（工作区一轮上限，#1112）
    need_turn = event == "PreToolUse" and (want_turn or name in ("bash", "job_output"))
    need_ctx = event == "PostToolUse" and sub
    if need_busy or need_turn or need_ctx:
        try:  # 读不到/解不开：不加字段，原 hook 按没有这些信息处理（不做本轮计数）
            # 3 秒：同 header()，PreToolUse/PostToolUse 的 hook 超时是 10 秒；最大的线上记录实测 0.14 秒
            lines = read()
            if need_turn:
                info = turn_calls(lines)
                cid = payload.get("tool_use_id")
                # DSH 攒 200ms 才落盘一批事件（dsh-session-persistence-jsonl/lib/index.js:190-193 enqueueLive），
                # 本次调用的 tool/call 可能还没写进去；最多再读两次、每次等 0.25 秒（比 200ms 批次多一点）
                for _ in range(2):
                    if not cid or has_call(info, cid):
                        break
                    time.sleep(0.25)
                    lines = read()
                    info = turn_calls(lines)
                info["sub"] = sub
                payload["dsh_turn"] = info
            if need_busy:
                payload["dsh_busy"] = busy(lines)
            if need_ctx:
                n = last_ctx_tokens(lines)
                if n is not None:
                    payload["context_tokens"] = n
        except BaseException:
            pass


def load_state():
    try:
        return json.load(open(STOP_STATE))
    except (OSError, ValueError):
        return {}


def run(target, payload):
    return subprocess.run([sys.executable, "-I", target], input=json.dumps(payload, ensure_ascii=False),
                          capture_output=True, text=True)


def main():
    args = sys.argv[1:]
    sessions = None
    if args[:1] == ["--sessions"]:
        sessions, args = args[1], args[2:]
    target = args[0]
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {}
    payload["dsh"] = True
    name = payload.get("tool_name")
    if isinstance(name, str):
        payload["tool_name"] = NAMES.get(name, name)
        inp = payload.get("tool_input")
        if name == "workflow" and isinstance(inp, dict) and "prompt" not in inp:
            inp["prompt"] = str(inp.get("script") or "")
    sid = payload.get("session_id") or ""
    try:  # 找记录出任何错都当没有记录：原 hook 必须照常跑（这里抛错 = hook 退出码 1 = DSH 放行）
        path = session_file(sessions, sid)
        head = header(path) if path else {}
    except BaseException:
        path, head = None, {}
    sub = bool(head.get("delegationDepth"))
    if sub and "agent_id" not in payload:
        payload["agent_id"] = sid
    if path:
        add_fields(payload, name, sub, lambda: export_mod().dsh_lines(path, timeout=3),
                   want_turn=os.path.basename(target) == "ws-cap-guard.py")

    tmp = None
    turn = None
    if payload.get("hook_event_name") == "Stop":
        if sub or not path:
            sys.exit(0)  # 子会话不跑 Stop；找不到记录就放行（读不到就无从判断，与原脚本读不到转录时一致）
        export = export_mod()
        try:
            lines = export.dsh_lines(path, timeout=20)  # Stop 的 hook 超时是 30 秒（hooks.json），留 10 秒给原 hook
        except Exception:
            sys.exit(0)  # 解不开同找不到记录：放行
        recs = export.dsh_records(path, head.get("cwd") or "", lines)
        fd, tmp = tempfile.mkstemp(prefix="dsh-stop-", suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        payload["transcript_path"] = tmp
        turn = last_turn(lines)
        payload["stop_hook_active"] = load_state().get(sid) == turn

    try:
        proc = run(target, payload)
    finally:
        if tmp:
            os.unlink(tmp)
    if turn is not None:
        try:
            blocked = json.loads(proc.stdout or "{}").get("decision") == "block"
        except ValueError:
            blocked = False
        if blocked or proc.returncode == 2:
            st = load_state()
            st[sid] = turn
            os.makedirs(os.path.dirname(STOP_STATE), exist_ok=True)
            with open(STOP_STATE, "w") as f:
                json.dump(st, f)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
