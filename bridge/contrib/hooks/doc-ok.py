#!/usr/bin/env python3
"""Register files as documents: dispatch-review-guard then lets this session's main agent edit them.
Usage (from the agent's own shell tool): python3 doc-ok.py <file>...
Prompts, SPECs and agent/skill definitions are not documents.
The session is CLAUDE_CODE_SESSION_ID (Claude Code's Bash), DSH_SESSION_ID (DSH's bash, dsh-shell-env),
or CODEX_SESSION_ID (Codex's shell). Codex hook payloads call this value session_id; CODEX_THREAD_ID is a
different identifier and is deliberately not accepted."""
import os
import sys

sid = (os.environ.get("CLAUDE_CODE_SESSION_ID")
       or os.environ.get("DSH_SESSION_ID")
       or os.environ.get("CODEX_SESSION_ID"))
if not sid:
    sys.exit("no CLAUDE_CODE_SESSION_ID / DSH_SESSION_ID / CODEX_SESSION_ID: "
             "run this from the agent's own shell tool")
reviews = os.path.expanduser(os.environ.get("HOOK_REVIEWS_DIR") or "~/.claude/reviews")
os.makedirs(reviews, exist_ok=True)
with open(os.path.join(reviews, ".docs"), "a", encoding="utf-8") as f:
    for a in sys.argv[1:]:
        p = os.path.realpath(os.path.expanduser(a))
        f.write(f"{sid}\t{p}\n")
        print(f"【免审:文档】{p}")
