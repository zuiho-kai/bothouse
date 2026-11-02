#!/usr/bin/env python3
"""UserPromptSubmit: put the wiki pages (and hit lines) related to this message in front of it, in a terminal
session — what bothouse's gate already does for every bot turn (docs/ccm-and-wiki.md step 4).
Source: the author 2026-10-20 「感觉他每次都是从0开始找」 — a terminal session had no per-turn wiki push.
- Same lookup as the gate: ctxsvc.match_wiki (bridge/contrib/gate/ctxsvc.py, installed next to this file), same
  wiki directory: GATE_WIKI, default ~/wiki; "off"/empty or a missing directory = nothing is added, no error.
  Same block format as bothouse's turnContext; an entry [#id] is pushed once per session_id and compaction
  (ctxsvc.only_new_file keeps what was pushed; the hook only names the session).
- A bot (an agent started by bothouse: CC_PROJECT is set) is skipped: the gate pushes its pages already.
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
    STATE.mkdir(parents=True, exist_ok=True)
    f = STATE / (sid.replace("/", "_").replace("\\", "_") + ".json")
    first = not f.exists()
    sent = json.loads(f.read_text()) if not first else []
    if hasattr(ctx, "only_new_file"):  # what was pushed is kept by ctxsvc, by entry id, per session and epoch
        ep = ctx.transcript_epoch(sid, d.get("transcript_path"))
        hits = ctx.only_new_file(hits, "term:" + sid, ep, STATE / "pushed")
    else:  # an older ctxsvc next to this file: by page, as before
        hits = [w for w in hits if w["path"] not in sent and not sent.append(w["path"])]
    lines = ["\n- " + w["path"] + " — " + w["desc"] for w in hits]
    f.write_text(json.dumps(sent))
    out = ""
    if lines:
        out = ("（可能相关的 wiki 页，需要时去读；desc 里的「数字: 原文」是命中行号，按行号 sed -n 读命中段，不整页 cat）"
               + "".join(lines))
    if not os.environ.get("WIKI_INGEST"):
        spec = importlib.util.spec_from_file_location("hook_lessons", HERE / "lessons.py")
        lessons = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lessons)
        lessons.WIKI, lessons.search, lessons.query = ctx.WIKI, ctx.search, ctx.query
        extra = lessons.lessons_context(prompt, first)
        out = "\n\n".join(x for x in (out, extra) if x)
    if out:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": out}},
                         ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
