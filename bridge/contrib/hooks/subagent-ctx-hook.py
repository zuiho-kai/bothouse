#!/usr/bin/env python3
"""subagent-ctx-hook: when a subagent's context reaches THRESHOLD tokens, tell it to write a short handoff and stop.
The main session is never touched.

PostToolUse: adds a note (additionalContext) asking the subagent to stop and hand off.
PreToolUse:  denies further tool calls from that subagent, so the note cannot be ignored.

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
Any error passes (exit 0): a broken hook must not block the subagent.

Why 150k (author's measurement over 72 hours, 459 subagents): the most expensive 10% took about 63% of the cost,
averaging 178 tool calls with contexts above 300k; past ~150k every further step re-reads the whole context and
cache rewrites dominate, so a fresh subagent with a short handoff is cheaper.
"""
import glob
import json
import os
import sys

THRESHOLD = 150000  # 来源：作者本机实测（72h 内 459 个子 agent，最贵 10% 占约 63% 花费、上下文 30 万以上），见上方 docstring

TIP = ("【上下文到线】你这个子 agent 的上下文已约 {n} token（≥15 万）。继续干每一步都要重读整段上下文，很贵。"
       "现在停下：写一份简短交接（做到哪、产出文件在哪、下一步是什么），作为最终回复立即交付收工，"
       "之后的工具调用会被一律拒绝。剩下的活由主会话开新的子 agent 接着做。")
DENY = "上下文已约 {n} token（≥15 万），停手：只写交接（做到哪、文件在哪、下一步），不再调工具"


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


def context_tokens(d):
    if isinstance(d.get("context_tokens"), int):
        return d["context_tokens"]
    path = find_transcript(d)
    if not path or not os.path.exists(path):
        return None
    return codex_ctx(path) if is_codex_rollout(path) else last_ctx(path)


def check(d):
    """The dict to print, or None (pass)."""
    if not d.get("agent_id"):
        return None  # main session
    n = context_tokens(d)
    if n is None or n < THRESHOLD:
        return None
    if d.get("hook_event_name") == "PreToolUse":
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
