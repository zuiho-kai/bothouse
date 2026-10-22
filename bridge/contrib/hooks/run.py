#!/usr/bin/env python3
"""Hook entry for Claude Code and DSH: run.py <hook name>  (e.g. run.py bash-guard).
Switch: run.py --role <dir> off|on [hook ...] / run.py --role <dir> status  — turn hooks off or on for this role
(no names = all). The agent runs it when its user asks in chat (the persona block says so, with the role's
--role); a person can edit the file instead. The state is the role's .claude/conest-hooks.json:
{"off": ["bash-guard", ...]} or {"off": ["all"]}, read on every hook call, so a change applies at once.
Without --role the role directory is the nearest directory upwards from CLAUDE_PROJECT_DIR / the payload's cwd /
the current directory that has .claude/settings.json.

Options (before or after the hook name; cc-connect writes them into each hook command):
  --conest-hook      marks a command written by cc-connect (so "setup hooks off" never touches the user's own hooks)
  --role <dir>       the role's work_dir: where the switch file is
  --dsh-home <dir>   DSH's home (DSH starts tools without the DSH_* variables, so $DSH_HOME is not seen here)
  --dsh-global       the command comes from the one DSH-wide hook file: it runs only inside a role listed in
                     <hooks dir>/dsh-roles.json (written by "cc-connect setup hooks on|off --cli dsh") and only
                     the hooks switched on for that role; anywhere else it passes.
A missing hook script passes (exit 0, warning on stderr): exit 2 would block every tool call.

The hooks in this directory are written against Claude Code's hook protocol. Claude Code calls them through
this file unchanged. DSH runs the same .claude/settings.json through its official bridge
@deepseek-ai/dsh-hooks-claude-code, whose payload differs; this file turns it into Claude Code's shape first:

1. Tool names are lower case in DSH (bash/write/edit/subagent/...). They become Bash/Write/Edit/Agent, so
   param-source-guard reads a write as a Write (not as an Edit without old_string, i.e. unchecked).
   workflow's argument is a script, not a prompt: the script is given as the prompt, so the review marks
   written in it count. str_replace_editor becomes Write (create) or Edit (str_replace/insert).
2. The bridge always sends transcript_path "" and stop_hook_active false. The DSH session log
   <DSH_HOME>/sessions/<cwd slug>/<id>/session.v4.jsonl[.zstd] is found by session_id (DSH_HOME defaults to
   ~/.dsh, as in dsh-home-paths) and:
   - a child session (first record delegationDepth > 0) gets agent_id, as a Claude Code subagent's payload has;
     its Stop passes (Claude Code's Stop is for the main session; subagents have SubagentStop);
   - for Stop, the log is converted to a Claude Code transcript in a temporary file given as transcript_path,
     and a turn (turn/start number) already blocked once gets stop_hook_active true, so a hook blocks once per
     turn as in Claude Code (DSH's steer continues the same turn and fires turn-stopping again).
   The log lags behind the agent: when Stop fires, the turn's last assistant message may not be on disk yet
   (acceptance run: the first Stop hook saw the log up to the request, the second saw the reply). Stop waits
   until the log holds the hook/invoked record of this Stop hook (written before the hook runs) with no
   hook/result after it, re-reading for at most STOP_WAIT seconds.
   Plain and zstd-compressed logs (the DSH default) are found and read by dshlog.py (next to this file).
stdout / stderr / exit code of the hook are passed through.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name):
    """A module installed next to this file (python3 -I leaves the script's directory off sys.path)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


dshlog = _load("dshlog")

# DSH tool name -> Claude Code tool name (DSH tool names: dsh-base/cordis.patch.yml, dsh-tool-fs, dsh-tool-subagent)
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
STATE = os.path.join(HERE, "state", "dsh-stop.json")
DSH_ROLES = os.path.join(HERE, "dsh-roles.json")  # {role work_dir: {"hooks": [...], "dsh_home": ...}}
OPTS = {"role": None, "dsh_home": None, "dsh_global": False}  # {session_id: turn already blocked once}
# 来源：实测，验收时日志在钩子开始后约 0.15 秒内写到；留足余量又不拖住回复（Stop 超时设的是 30 秒）
STOP_WAIT = 3.0
MODEL_HEAD, MODEL_END = "[cc-connect model-control instructions]", "[/cc-connect model-control instructions]"

def dsh_home():
    return OPTS["dsh_home"] or os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")


def write_json(path, obj):
    """Write via a temporary file + os.replace, so a concurrent reader never sees half a file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def session_file(sid):
    return dshlog.session_file(dsh_home(), sid)


read_lines = dshlog.read_lines


def records(lines):
    out = []
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue  # a line still being written
        if isinstance(d, dict):
            out.append(d)
    return out


def iso(ms):
    if not isinstance(ms, int):
        return None
    import time
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms // 1000)) + ".%03dZ" % (ms % 1000)


def tool_input(name, args):
    """DSH tool arguments as the Claude Code tool's input."""
    if not isinstance(args, dict):
        try:
            args = json.loads(args or "{}")
        except (TypeError, ValueError):
            args = {"raw": str(args)}
    if not isinstance(args, dict):
        args = {"raw": args}
    if name == "workflow" and "prompt" not in args:
        args = dict(args, prompt=str(args.get("script") or ""))
    if name == "str_replace_editor":
        cmd = args.get("command")
        if cmd == "create":
            return "Write", {"file_path": args.get("path", ""), "content": args.get("file_text") or ""}
        if cmd in ("str_replace", "insert"):
            return "Edit", {"file_path": args.get("path", ""), "old_string": args.get("old_str") or "",
                            "new_string": args.get("new_str") or ""}
    return NAMES.get(name, name), args


def user_text(text):
    t = text.strip()
    if t.startswith(MODEL_HEAD):
        i = t.find(MODEL_END)
        t = t[i + len(MODEL_END):].strip() if i >= 0 else ""
    return t


def transcript(recs, cwd):
    """A DSH session log as Claude Code transcript entries (what fix-claim-guard / promise-guard read)."""
    out = []
    for d in recs:
        t, data, ts = d.get("type"), d.get("data") or {}, iso(d.get("time"))
        base = {"cwd": cwd}
        if ts:
            base["timestamp"] = ts
        if t == "user/message" and (data.get("source") or {}).get("kind") == "user":
            parts = [user_text(c.get("text", "")) for c in data.get("content", [])
                     if isinstance(c, dict) and c.get("type") == "text"]
            text = "\n\n".join(p for p in parts if p)
            if text:
                out.append(dict(base, type="user", message={"role": "user", "content": text}))
        elif t == "assistant/message":
            blocks = []
            for c in (data.get("message") or {}).get("content", []):
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "text" and c.get("text"):
                    blocks.append({"type": "text", "text": c["text"]})
                elif c.get("type") == "tool-call":
                    name, inp = tool_input(c.get("name") or "", c.get("arguments"))
                    blocks.append({"type": "tool_use", "id": c.get("id"), "name": name, "input": inp})
            if blocks:
                out.append(dict(base, type="assistant", message={"role": "assistant", "content": blocks}))
        elif t == "tool/result":
            msg = data.get("message") or {}
            text = "".join(c.get("text", "") for c in msg.get("content", []) if isinstance(c, dict) and c.get("type") == "text")
            out.append(dict(base, type="user", message={"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": msg.get("toolCallId"), "is_error": bool(msg.get("isError")),
                 "content": text}]}))
    return out


def stop_pending(recs):
    """True when the log has caught up: a Stop hook/invoked of the last turn with no hook/result after it."""
    turn = last_turn(recs)
    open_ids = set()
    for d in recs:
        data = d.get("data") or {}
        if d.get("type") == "hook/invoked" and data.get("point") == "Stop" and data.get("turn") == turn:
            open_ids.add(data.get("handlerId"))
        elif d.get("type") == "hook/result":
            open_ids.discard(data.get("handlerId"))
    return bool(open_ids)


def wait_for_log(path, recs):
    import time
    deadline = time.monotonic() + STOP_WAIT
    while not stop_pending(recs) and time.monotonic() < deadline:
        time.sleep(0.1)
        recs = records(read_lines(path)) or recs
    return recs


def last_turn(recs):
    turn = 0
    for d in recs:
        if d.get("type") == "turn/start":
            turn = (d.get("data") or {}).get("turn", turn)
    return turn


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


SWITCH = os.path.join(".claude", "conest-hooks.json")


def hook_names():
    return sorted(f[:-3] for f in os.listdir(HERE)
                  if f.endswith(".py") and f not in ("run.py", "doc-ok.py", "dshlog.py", "ctxsvc.py", "wiki_search.py")
                  and not f.startswith("test_"))


def role_dir(start=None):
    if OPTS["role"]:
        return os.path.abspath(OPTS["role"])
    d = os.path.abspath(start or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    probe = d
    while True:
        if os.path.isfile(os.path.join(probe, ".claude", "settings.json")):
            return probe
        up = os.path.dirname(probe)
        if up == probe:
            return d
        probe = up


def load_off(d):
    try:
        with open(os.path.join(d, SWITCH), encoding="utf-8") as f:
            off = json.load(f).get("off") or []
        return {str(x) for x in off} if isinstance(off, list) else set()
    except (OSError, ValueError, AttributeError):
        return set()


def switch(action, names):
    d = role_dir()
    known = hook_names()
    bad = [n for n in names if n not in known]
    if bad:
        sys.exit(f"unknown hook {', '.join(bad)}; hooks: {', '.join(known)}")
    off = load_off(d)
    if action == "off":
        off = {"all"} if not names else (off | set(names))
    elif action == "on":
        if not names:
            off = set()
        else:
            if "all" in off:
                off = set(known)
            off -= set(names)
    if action in ("on", "off"):
        write_json(os.path.join(d, SWITCH), {"off": sorted(off)})
    disabled = set(known) if "all" in off else off & set(known)
    print(json.dumps({"role_dir": d, "switch_file": os.path.join(d, SWITCH),
                      "on": [n for n in known if n not in disabled], "off": [n for n in known if n in disabled]},
                     ensure_ascii=False))


def parse_args(argv):
    rest, i = [], 0
    while i < len(argv):
        a = argv[i]
        if a in ("--role", "--dsh-home") and i + 1 < len(argv):
            OPTS[a[2:].replace("-", "_")] = argv[i + 1] or None
            i += 2
            continue
        if a == "--dsh-global":
            OPTS["dsh_global"] = True
        elif a != "--conest-hook":
            rest.append(a)
        i += 1
    return rest


def dsh_role(start):
    """The DSH role (listed in dsh-roles.json) at or above start: (work_dir, entry), or (None, None)."""
    try:
        with open(DSH_ROLES, encoding="utf-8") as f:
            roles = json.load(f)
    except (OSError, ValueError):
        return None, None
    if not isinstance(roles, dict):
        return None, None
    probe = os.path.realpath(start)
    known = {os.path.realpath(k): (k, v) for k, v in roles.items() if isinstance(v, dict)}
    while True:
        if probe in known:
            return known[probe]
        up = os.path.dirname(probe)
        if up == probe:
            return None, None
        probe = up


def main():
    args = parse_args(sys.argv[1:])
    if not args:
        sys.exit("usage: run.py <hook name> | run.py [--role <dir>] off|on [hook ...] | run.py [--role <dir>] status")
    if args[0] in ("off", "on", "status"):
        return switch(args[0], args[1:])
    name = os.path.basename(args[0])
    name = name[:-3] if name.endswith(".py") else name
    target = os.path.join(HERE, name + ".py")
    if not os.path.isfile(target):
        sys.stderr.write(f"cc-connect hook {name}: {target} is missing, passing (reinstall: cc-connect setup hooks on)\n")
        sys.exit(0)
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    if OPTS["dsh_global"]:
        # the DSH-wide hook file applies to every directory DSH runs in: only cc-connect's DSH roles count
        wd, entry = dsh_role(payload.get("cwd") or os.getcwd())
        if not wd or name not in (entry.get("hooks") or []):
            sys.exit(0)
        OPTS["role"] = wd
        OPTS["dsh_home"] = OPTS["dsh_home"] or entry.get("dsh_home")
    off = load_off(role_dir(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or None))
    if "all" in off or name in off:
        sys.exit(0)  # switched off for this role (run.py off): pass without running the hook
    tool = payload.get("tool_name")
    dsh = isinstance(tool, str) and (tool in NAMES or tool == "str_replace_editor")
    if dsh:
        payload["tool_name"], payload["tool_input"] = tool_input(tool, payload.get("tool_input"))
    stop = payload.get("hook_event_name") == "Stop"
    # Claude Code always gives a transcript; an empty one is the DSH bridge (dsh-hooks-claude-code base())
    bridge = dsh or OPTS["dsh_global"] or not payload.get("transcript_path")
    path = session_file(payload.get("session_id") or "") if bridge else None
    # only the first record (session header) is needed here; the whole log is read for Stop alone
    first = records(read_lines(path, head=True)) if path else []
    head = first[0] if first and first[0].get("type") == "session" else {}
    sub = bool(head.get("delegationDepth"))
    if sub and "agent_id" not in payload:
        payload["agent_id"] = payload.get("session_id")
    if (dsh or OPTS["dsh_global"]) and not path and name == "dispatch-review-guard" and "agent_id" not in payload:
        # no session log (wrong DSH home, not written yet): cannot tell main session from subagent, so do not
        # deny an edit as the main session's; the dispatch checks (review marks) still apply
        sys.stderr.write(f"dispatch-review-guard: DSH session log not found under {dsh_home()}/sessions, "
                         "main-session edit check skipped\n")
        payload["agent_id"] = payload.get("session_id") or "unknown"

    tmp, turn, sid = None, None, payload.get("session_id") or ""
    if stop and path:
        if sub:
            sys.exit(0)
        recs = wait_for_log(path, records(read_lines(path)))
        fd, tmp = tempfile.mkstemp(prefix="dsh-stop-", suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in transcript(recs, head.get("cwd") or payload.get("cwd") or ""):
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        payload["transcript_path"] = tmp
        turn = last_turn(recs)
        payload["stop_hook_active"] = bool(payload.get("stop_hook_active")) or load_state().get(sid) == turn

    try:
        proc = subprocess.run([sys.executable, "-I", target], input=json.dumps(payload, ensure_ascii=False),
                              capture_output=True, text=True)
    finally:
        if tmp:
            os.unlink(tmp)
    if turn is not None:
        try:
            blocked = json.loads(proc.stdout or "{}").get("decision") == "block"
        except (ValueError, AttributeError):
            blocked = False
        if blocked or proc.returncode == 2:
            st = load_state()
            st[sid] = turn
            write_json(STATE, st)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
