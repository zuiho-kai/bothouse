#!/usr/bin/env python3
"""UserPromptSubmit: put the wiki pages (and hit lines) related to this message in front of it, in a terminal
session — what cc-connect's gate already does for every bot turn (docs/ccm-and-wiki.md step 4).
Source: the author 2026-10-20 「感觉他每次都是从0开始找」 — a terminal session had no per-turn wiki push.
- Same lookup as the gate: ctxsvc.match_wiki (bridge/contrib/gate/ctxsvc.py, installed next to this file), same
  wiki directory: GATE_WIKI, default ~/wiki; "off"/empty or a missing directory = nothing is added, no error.
  Same block format as cc-connect's turnContext; a page is pushed once per session_id.
- A bot (an agent started by cc-connect: CC_PROJECT is set) is skipped: the gate pushes its pages already.
Any error exits 0 silently: this hook must never stop a message."""
import importlib.util, json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "state" / "wiki-context"


def load_ctxsvc():
    sys.path.insert(0, str(HERE))  # ctxsvc imports wiki_search from its own directory (-I drops it from sys.path)
    spec = importlib.util.spec_from_file_location("ctxsvc", HERE / "ctxsvc.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    if os.environ.get("CC_PROJECT"):
        return
    d = json.load(sys.stdin)
    prompt = (d.get("prompt") or "").strip()
    sid = d.get("session_id") or ""
    if not prompt or not sid or prompt.startswith("/"):
        return
    ctx = load_ctxsvc()
    hits = ctx.match_wiki(prompt)
    if not hits:
        return
    STATE.mkdir(parents=True, exist_ok=True)
    f = STATE / (sid.replace("/", "_").replace("\\", "_") + ".json")
    sent = json.loads(f.read_text()) if f.exists() else []
    lines = []
    for w in hits:
        if w["path"] not in sent:
            sent.append(w["path"])
            lines.append("\n- " + w["path"] + " — " + w["desc"])
    f.write_text(json.dumps(sent))
    if lines:
        out = ("（可能相关的 wiki 页，需要时去读；desc 里的「数字: 原文」是命中行号，按行号 sed -n 读命中段，不整页 cat）"
               + "".join(lines))
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": out}},
                         ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
