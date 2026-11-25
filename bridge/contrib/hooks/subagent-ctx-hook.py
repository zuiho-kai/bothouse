#!/usr/bin/env python3
"""subagent-ctx-hook: when a subagent's context reaches THRESHOLD tokens, tell it to write a short handoff and stop.
The main session is never denied. Only a team-workspace main session (its transcript carries the
"[工作区规矩" rules block) gets a reminder: at MAIN_START tokens and every MAIN_STEP after, PreToolUse adds a note
(additionalContext) asking it to write a handoff, report back and continue in a new session; tools still run.
Workspace sessions are exempt from the bridge's own context-size refresh (PR #670), so nothing else stops them.

PostToolUse: adds a note (additionalContext) asking the subagent to stop and hand off.
PreToolUse:  denies further tool calls from that subagent; the deny reason carries the same handoff request, so
             PreToolUse alone is enough (setup hooks on installs only this event).

Which calls come from a subagent: the payload's `agent_id`. Claude Code's hook input schema (2.1.307):
  agent_id ... "Present only when the hook fires from within a subagent ... Absent for the main thread,
  even in --agent sessions."
Where the subagent transcript is: `agent_transcript_path` when given; otherwise, from the main transcript
<project dir>/<session_id>.jsonl, the file <project dir>/<session_id>/subagents[/<dir>]/agent-<agent_id>.jsonl.
Context size = the latest assistant message's usage: input_tokens + cache_read_input_tokens
+ cache_creation_input_tokens.
Codex subthreads: transcript_path is the subthread's own rollout-*.jsonl; context = the last token_count's
last_token_usage.input_tokens (OpenAI's input_tokens already include cached_input_tokens).
A payload that already carries an integer `context_tokens` uses it as is.
Time limit (PreToolUse, Claude Code subagents and Codex subthreads): 30 minutes since this activation started,
60 for a long-task subagent; then tool calls are denied with the same handoff request. Writing the handoff or
progress note (an .md under notes/, or named handoff/交接/进度) stays allowed past either limit.
Any error passes (exit 0): a broken hook must not block the subagent.

Why 150k (author's measurement over 72 hours, 459 subagents): the most expensive 10% took about 63% of the cost,
averaging 178 tool calls with contexts above 300k; past ~150k every further step re-reads the whole context and
cache rewrites dominate, so a fresh subagent with a short handoff is cheaper.

This line is the backstop, not the normal path (#1960): a subagent whose definition sets autoCompactWindow
(e.g. 153000, which compacts at about 120k: window - 20000 for output - 13000 buffer, Claude Code 2.1.331)
compacts its own conversation first and carries on, so it does not hand off to a new subagent that re-reads
everything. The context counted here is the latest message's, so it drops after a compaction. A subagent
reaches this line only when it has no such window, compaction is off, or it is still too large afterwards.
"""
import glob
import json
import os
import sys
import time
from datetime import datetime

THRESHOLD = 150000  # 来源：作者本机实测（72h 内 459 个子 agent，最贵 10% 占约 63% 花费、上下文 30 万以上），见上方 docstring
# 这条线是兜底（#1960）：定义里设了 autoCompactWindow 的子 agent 正常先在约 12 万自动压缩、接着干；改这条线要同时看 agent 定义里的窗口，压缩点必须低于它。

TIP = ("【上下文到线】你这个子 agent 的上下文已约 {n} token（≥15 万）。正常应先在约 12 万自动压缩，到这里说明没压缩或压完仍超线。继续干每一步都要重读整段上下文，很贵。"
       "现在停下：写一份简短交接，固定三节：做到哪（停点、产出文件在哪）、下一步要动的「文件:行」、「## 地图要补的条目（地图完整路径）」每条「- 符号 文件:行」（#1639：下一棒照这三节直接定位，不重摸代码），作为最终回复立即交付收工，"
       "之后的工具调用会被一律拒绝。剩下的活由主会话开新的子 agent 接着做。")
DENY = ("【上下文到线】你这个子 agent 的上下文已约 {n} token（≥15 万）。正常应先在约 12 万自动压缩，到这里说明没压缩或压完仍超线，之后的工具调用一律拒绝。"
        "现在停手，不再调工具：写一份简短交接，固定三节：做到哪（停点、产出文件在哪）、下一步要动的「文件:行」、「## 地图要补的条目（地图完整路径）」每条「- 符号 文件:行」（#1639：下一棒照这三节直接定位，不重摸代码），作为最终回复立即交付收工。"
        "剩下的活由主会话开新的子 agent 接着做。")


# 时限：用户 2026-10-22「快一点，10分钟没做完就砍掉，重新再搞」、2026-10-23「以后全部人的子任务都这样子」；
# 2026-10-26 同意从 10 分钟放宽到 30（改代码的活 10 分钟刚摸清就被截，交接重读更贵）。long-task（缓存 1h）用 60 分钟。
LIMIT_S = 30 * 60
LIMIT_LONG_S = 60 * 60
DENY_TIME = "到 {m} 分钟了，停手：只写交接，固定三节：做到哪（停点、产出文件在哪）、下一步要动的「文件:行」、「## 地图要补的条目（地图完整路径）」每条「- 符号 文件:行」（#1639：下一棒照这三节直接定位，不重摸代码），不再调工具。剩下的活由主会话开新的子 agent 接着做。"


# 工作区主线：11-22 工作区会话 fe7c0e70 一路涨到 31 万、过 30 万的调用 11 次没有任何提示（反思 11-21/22 a 类，#1878）；
# 25 万取自该反思的改法「上下文到 250k 就写交接状态并开新会话续做」，每涨 5 万再提醒一次取主角色 11-23 定案。
MAIN_START = 250000
MAIN_STEP = 50000
WS_MARK = b"[\xe5\xb7\xa5\xe4\xbd\x9c\xe5\x8c\xba\xe8\xa7\x84\xe7\x9f\xa9"  # "[工作区规矩", core/team_mode.go workspaceRulesText
MAIN_TIP = ("【上下文到线】这个工作区会话的上下文已约 {n} token（≥25 万），之后每一步都要重读整段上下文。"
            "做完手上这一步就收口：把做到哪（产出文件在哪）、下一步要动的「文件:行」写进交接页，照交接的交回方式交回，"
            "剩下的开新会话接着做。只是提醒，工具不拦。")


def _ts(rec):
    ts = rec.get("timestamp")
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() if ts else None


def _is_stop(rec):
    """一次交付或停止的标志：assistant 记录的 message.stop_reason 不是 tool_use（也不是空）。
    依据：2026-10-23 抽查 ~/.claude/projects 下最近 300 个子 agent 转录（CC 2.1.307）——assistant 的 stop_reason
    只有 tool_use（11596 条，接着调工具）、end_turn（509 条，正常交付）、stop_sequence 且 isApiErrorMessage=true
    （20 条，<synthetic> 报错停住，如额度用完：agent-a6d54c448ea84d853.jsonl:38）。停止后到续用之间没有别的记录，
    续用时写进来的是一条 type=user 的新消息（origin.kind=coordinator 即 SendMessage/续跑，或 task-notification）。"""
    if rec.get("type") != "assistant":
        return False
    r = (rec.get("message") or {}).get("stop_reason")
    return r is not None and r != "tool_use"


# 被停后续用：上一次运行被桥重启或进程退出打断时，转录里没有停止标志，续用的 coordinator 消息
# （SendMessage）前面隔着一大段空白。空白够长就从续用那条起算（#1894：11-23 Fable 13:12 随桥重启被停，
# 13:54 续用后按 13:09 首派起算，跑 155 秒就被拦）。来源：前台命令最长 10 分钟，运行中的子 agent
# 两条记录之间不会空这么久，取 15 分钟留余量。
RESUME_GAP_S = 15 * 60


def start_ts(path, now):
    """本次激活的起点（epoch 秒）：最近一次交付或停止之后的第一条 type=user 记录的 timestamp。
    取 user 而不是“下一条记录”：同一条 assistant 消息会拆成几条记录（thinking/text 各一条，stop_reason 相同），
    停止标志后面紧跟的可能是同一消息的另一块（抽查 206 次）。
    没有停止标志、但 coordinator 消息和它前一条记录隔了 RESUME_GAP_S 以上 → 上一次运行被停了，从这条续用起算。
    转录里没有停止标志 → 还是第一次激活，用第一行 timestamp。
    有停止标志但后面还没有 user 记录 → 当作刚开始的新激活，返回 now（放行）。读不到返回 None。"""
    size = os.path.getsize(path)
    # 来源：实现细节，非参数——尾部读取块大小（1 MiB），只影响速度不影响结果
    chunk = 1 << 20
    with open(path, "rb") as f:
        while True:
            start = max(0, size - chunk)
            f.seek(start)
            lines = f.read(size - start).split(b"\n")
            if start > 0:
                lines = lines[1:]  # 第一行可能被截断
            cand = None  # 往回扫时最早看到的 user 记录时间 = 停止标志之后的第一条 user
            coord = None  # 往回扫时刚看到的 coordinator 消息时间，等它前一条记录来比间隔
            for line in reversed(lines):
                if b'"stop_reason"' not in line and b'"user"' not in line and b'"timestamp"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                t = _ts(rec)
                if coord is not None and t is not None:
                    if coord - t >= RESUME_GAP_S:
                        return coord
                    coord = None
                if _is_stop(rec):
                    return cand if cand is not None else now
                if rec.get("type") == "user" and t is not None:
                    cand = t
                    if (rec.get("origin") or {}).get("kind") == "coordinator":
                        coord = t
            if start == 0:
                break
            chunk *= 4
        f.seek(0)
        first = f.readline()
    try:
        return _ts(json.loads(first) or {})
    except ValueError:
        return None


def is_codex_rollout(path):
    return bool(path) and os.path.basename(path).startswith("rollout-")


def codex_ctx(path):
    n = None
    with open(path, "rb") as f:
        for line in f:
            if b'"token_count"' not in line:
                continue
            try:
                pl = json.loads(line).get("payload") or {}
            except ValueError:
                continue
            if pl.get("type") == "token_count":
                u = (pl.get("info") or {}).get("last_token_usage") or {}
                if u.get("input_tokens") is not None:
                    n = u["input_tokens"]
    return n


def find_transcript(d):
    aid = d.get("agent_id")
    if aid and is_codex_rollout(d.get("transcript_path")):
        return d["transcript_path"]
    if d.get("agent_transcript_path"):
        return d["agent_transcript_path"]
    tp = d.get("transcript_path") or ""
    if not (aid and tp):
        return None
    base = os.path.join(os.path.dirname(tp), os.path.splitext(os.path.basename(tp))[0], "subagents")
    hits = glob.glob(os.path.join(base, "**", f"agent-{aid}.jsonl"), recursive=True)
    return hits[0] if hits else None


def last_ctx(path):
    """Latest assistant usage, reading from the end of the file; the window grows until the file start."""
    size = os.path.getsize(path)
    chunk = 1 << 20  # 来源：实现细节，非参数——尾部读取块大小（1 MiB），只影响速度不影响结果
    with open(path, "rb") as f:
        while True:
            start = max(0, size - chunk)
            f.seek(start)
            lines = f.read(size - start).split(b"\n")
            if start > 0:
                lines = lines[1:]  # the first line may be cut
            for line in reversed(lines):
                if b'"usage"' not in line:
                    continue
                try:
                    m = json.loads(line).get("message") or {}
                except ValueError:
                    continue
                u = m.get("usage") if m.get("role") == "assistant" else None
                if u:
                    return (u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0)
                            + u.get("cache_creation_input_tokens", 0))
            if start == 0:
                return None
            chunk *= 4


def workspace_ctx(path):
    """(latest, previous) context of a workspace main transcript, or None if it is not a workspace session.
    previous = the usage of the assistant message before the latest one (a different message id).
    A message with several tool calls: once one of its calls has a tool_result, previous = latest (already hinted)."""
    with open(path, "rb") as f:
        if WS_MARK not in f.read(1 << 20):  # 来源：实现细节——规矩块在首条桥消息里，读前 1 MiB 足够
            return None
        f.seek(0)
        seen = []
        answered = False
        for line in f:
            if b'"tool_result"' in line:
                answered = True
                continue
            if b'"usage"' not in line:
                continue
            try:
                m = json.loads(line).get("message") or {}
            except ValueError:
                continue
            u = m.get("usage") if m.get("role") == "assistant" else None
            if not u:
                continue
            n = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
            if seen and seen[-1][0] == m.get("id"):
                seen[-1] = (m.get("id"), n)
            else:
                seen.append((m.get("id"), n))
                seen = seen[-2:]
                answered = False
    if not seen:
        return None
    if answered:
        return seen[-1][1], seen[-1][1]
    return seen[-1][1], (seen[-2][1] if len(seen) > 1 else 0)


def main_check(d):
    """Workspace main session: a reminder each time the context crosses MAIN_START, MAIN_START+MAIN_STEP, ..."""
    tp = d.get("transcript_path") or ""
    if d.get("hook_event_name") != "PreToolUse" or not tp or is_codex_rollout(tp) or not os.path.exists(tp):
        return None
    r = workspace_ctx(tp)
    if not r:
        return None
    n, prev = r
    step = lambda x: (x - MAIN_START) // MAIN_STEP if x >= MAIN_START else -1
    if step(n) < 0 or step(n) == step(prev):
        return None
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": MAIN_TIP.format(n=n)}}


def context_tokens(d):
    if isinstance(d.get("context_tokens"), int):
        return d["context_tokens"]
    path = find_transcript(d)
    if not path or not os.path.exists(path):
        return None
    return codex_ctx(path) if is_codex_rollout(path) else last_ctx(path)


def codex_started(path):
    """Codex rollout: the timestamp of the last event_msg/task_started (this activation's start), else the first line's."""
    t0 = None
    with open(path, "rb") as f:
        first = f.readline()
        f.seek(0)
        for line in f:
            if b'"task_started"' not in line:
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if (rec.get("payload") or {}).get("type") == "task_started":
                t0 = _ts(rec)
    if t0 is None:
        try:
            t0 = _ts(json.loads(first) or {})
        except ValueError:
            pass
    return t0


def over_time(d, now):
    """Minutes of the limit this subagent has passed, or 0."""
    limit = LIMIT_LONG_S if d.get("agent_type") == "long-task" else LIMIT_S
    path = find_transcript(d)
    t0 = None
    if path and os.path.exists(path):
        t0 = codex_started(path) if is_codex_rollout(path) else start_ts(path, now)
    elif isinstance(d.get("dsh_started_at"), (int, float)):
        t0 = d["dsh_started_at"]  # DSH subsession: its creation time, filled by the compat layer
    return limit // 60 if t0 is not None and now - t0 >= limit else 0


def progress_write(d):
    """Write/Edit 到 notes/ 、~/.claude/reviews/ 或文件名含 handoff/交接/进度 的 .md：算写进度。"""
    if d.get("tool_name") not in ("Write", "Edit", "MultiEdit", "write", "edit"):
        return False
    p = str((d.get("tool_input") or {}).get("file_path") or "")
    return p.endswith(".md") and ("/notes/" in p or "/.claude/reviews/" in p
                                  or any(k in os.path.basename(p) for k in ("handoff", "交接", "进度")))


def check(d, now=None):
    """The dict to print, or None (pass)."""
    if not d.get("agent_id"):
        return main_check(d)  # main session: only a workspace reminder, never a deny
    if d.get("hook_event_name") == "PreToolUse":
        m = over_time(d, now or time.time())
        if m and not progress_write(d):
            return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                           "permissionDecision": "deny",
                                           "permissionDecisionReason": DENY_TIME.format(m=m)}}
    n = context_tokens(d)
    if n is None or n < THRESHOLD:
        return None
    if d.get("hook_event_name") == "PreToolUse":
        if progress_write(d):
            return None  # the handoff note itself may still be written
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                       "permissionDecision": "deny",
                                       "permissionDecisionReason": DENY.format(n=n)}}
    return {"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                   "additionalContext": TIP.format(n=n)}}


def main():
    out = check(json.load(sys.stdin))
    if out:
        print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
