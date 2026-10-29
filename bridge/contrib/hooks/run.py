#!/usr/bin/env python3
"""Hook entry for Claude Code and DSH: run.py <hook name>  (e.g. run.py bash-guard).
Switch: run.py --role <dir> off|on [hook ...] / run.py --role <dir> status  — turn hooks off or on for this role
(no names = all). The agent runs it when its user asks in chat (the persona block says so, with the role's
--role); a person can edit the file instead. The state is the role's .bothouse/conest-hooks.json:
{"off": ["bash-guard", ...]} or {"off": ["all"]}, read on every hook call, so a change applies at once.
Without --role the role directory is the nearest directory upwards from CLAUDE_PROJECT_DIR / the payload's cwd /
the current directory that has .claude/settings.json.

Options (before or after the hook name; bothouse writes them into each hook command):
  --conest-hook      marks a command written by bothouse (so "setup hooks off" never touches the user's own hooks)
  --role <dir>       the role's work_dir: where the switch file is
  --dsh-home <dir>   DSH's home (DSH starts tools without the DSH_* variables, so $DSH_HOME is not seen here)
  --dsh-global       the command comes from the one DSH-wide hook file: it runs only inside a role listed in
                     <hooks dir>/dsh-roles.json (written by "bothouse setup hooks on|off --cli dsh") and only
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
Gemini CLI runs the same hooks through its own protocol (https://geminicli.com/docs/hooks/ and
/docs/hooks/reference). run.py spots its payload (hook_event_name is a Gemini event name) and:
1. Tool names become Claude Code's: run_shell_command -> Bash ("is_background" becomes "run_in_background"),
   write_file -> Write, replace -> Edit, read_file -> Read, invoke_agent -> Agent (gemini-cli 0.63.0 bundle:
   AGENT_TOOL_NAME = "invoke_agent"; "subagent" there is a role/kind, not a tool). Its other tools keep their
   names (no hook matches them).
2. Events become Claude Code's: BeforeTool -> PreToolUse, AfterTool -> PostToolUse, BeforeAgent ->
   UserPromptSubmit, AfterAgent -> Stop (the same "turn ends" moment; fix-claim-guard/promise-guard need it to be
   able to send the agent back to fix its claim, which SessionEnd cannot). session_id/cwd pass through.
3. Gemini's transcript is its own JSON, not a Claude Code JSONL: for Stop a two-entry transcript is built from
   the payload's prompt / prompt_response, so the Stop hooks see the turn they check (they only read the last
   user message and the assistant's final text).
4. Its output is turned back: a Claude Code deny (hookSpecificOutput.permissionDecision, or decision "block")
   becomes Gemini's {"decision": "deny", "reason": ...}; an additionalContext becomes
   hookSpecificOutput.additionalContext on BeforeAgent (added to the prompt) and AfterTool (appended to the tool
   result as <hook_context>; hooks/reference, and gemini-cli 0.63.0 getAdditionalContext() on the AfterTool
   output). BeforeTool has no such field, so its hints are dropped. Exit 2 means "block" in both protocols and is passed through; stdout is
   otherwise kept JSON-only, as Gemini requires.

Antigravity (agy) runs the hooks from the role's .agents/hooks.json, each command with --agy <event> (agy's
payload has no event name). Its payload (conversationId, workspacePaths, transcriptPath, toolCall{name, args})
becomes session_id / cwd / hook_event_name and, for run_command, tool_name Bash with tool_input.command =
args.CommandLine. For Stop its transcript (<brain>/.system_generated/logs/transcript_full.jsonl, one step per
line) is converted to a Claude Code transcript in a temporary file, and a user turn already blocked once gets
stop_hook_active true. The hook's answer is turned back into agy's: a PreToolUse deny (exit 2 or
permissionDecision deny) = {"decision": "deny", "reason": ...}; a Stop block = {"decision": "continue", "reason": ...}.
Every passing exit under --agy (hook switched off, script missing, WIKI_INGEST, a crash) prints
{"decision": "allow"}: agy's "decision" is Required.

Qoder CLI (https://docs.qoder.com/cli/hooks) needs no translation at all: its events (PreToolUse, PostToolUse,
UserPromptSubmit, SessionStart, Stop, Notification), its stdin JSON (session_id/transcript_path/cwd/
hook_event_name/tool_name/tool_input), its exit codes and hookSpecificOutput.permissionDecision are Claude
Code's, so its payload and output pass straight through.

iFlow CLI (hooks doc "Hook Types" / "3. Return Value Processing") is translated minimally, see iflow_payload /
iflow_output: event and tool name come from IFLOW_HOOK_EVENT_NAME / IFLOW_TOOL_NAME (or the same fields in its
stdin JSON), tool names are Gemini-like, and it blocks only on a non-zero exit code, so a Claude Code deny
becomes exit 2 + stderr. Stop is registered too but iFlow does not act on a hook's exit code there ("Other
Hooks: Return code doesn't affect main flow"), so fix-claim-guard / promise-guard can only warn under iFlow.

stdout / stderr / exit code of the hook are passed through.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


_DSHLOG = []


def dshlog():
    """dshlog.py, installed next to this file (python3 -I leaves the script's directory off sys.path). Loaded on
    first use: only DSH payloads read a session log, so the Claude Code hooks never depend on it."""
    if not _DSHLOG:
        import importlib.util
        spec = importlib.util.spec_from_file_location("dshlog", os.path.join(HERE, "dshlog.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _DSHLOG.append(mod)
    return _DSHLOG[0]

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
# Gemini CLI payloads: its event names and built-in tool names (hooks/reference "Tool hooks")
GEMINI_EVENTS = {"BeforeTool", "AfterTool", "BeforeAgent", "AfterAgent", "BeforeModel", "AfterModel",
                 "BeforeToolSelection", "SessionStart", "SessionEnd", "Notification", "PreCompress"}
GEMINI_NAMES = {"run_shell_command": "Bash", "write_file": "Write", "replace": "Edit", "read_file": "Read",
                "glob": "Glob", "grep_search": "Grep", "list_directory": "LS", "invoke_agent": "Agent"}
GEMINI_TO_CLAUDE_EVENT = {"BeforeTool": "PreToolUse", "AfterTool": "PostToolUse", "BeforeAgent": "UserPromptSubmit",
                          "AfterAgent": "Stop"}
STATE = os.path.join(HERE, "state", "dsh-stop.json")
DSH_ROLES = os.path.join(HERE, "dsh-roles.json")  # {role work_dir: {"hooks": [...], "dsh_home": ...}}
OPTS = {"role": None, "dsh_home": None, "dsh_global": False, "agy": None, "kimi": False,
        "cursor": False, "codex": False}  # {session_id: turn already blocked once}
# 来源：实测，验收时日志在钩子开始后约 0.15 秒内写到；留足余量又不拖住回复（Stop 超时设的是 30 秒）
STOP_WAIT = 3.0
MODEL_HEAD, MODEL_END = "[bothouse model-control instructions]", "[/bothouse model-control instructions]"

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
    return dshlog().session_file(dsh_home(), sid)


def read_lines(path, head=False):
    return dshlog().read_lines(path, head=head)


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


def gemini_tool_input(name, args):
    """A Gemini BeforeTool tool_input as the Claude Code tool's input."""
    if not isinstance(args, dict):
        args = {}
    if name == "run_shell_command":
        return "Bash", {"command": args.get("command") or "", "run_in_background": bool(args.get("is_background"))}
    if name == "write_file":
        return "Write", {"file_path": args.get("file_path") or args.get("path") or "",
                         "content": args.get("content") or ""}
    if name == "replace":
        return "Edit", {"file_path": args.get("file_path") or args.get("path") or "",
                        "old_string": args.get("old_string") or "", "new_string": args.get("new_string") or ""}
    return GEMINI_NAMES.get(name, name), args


def gemini_payload(payload):
    """A Gemini CLI hook payload as Claude Code's shape (session_id/cwd pass through)."""
    ev = payload.get("hook_event_name")
    out = {"session_id": payload.get("session_id") or "", "cwd": payload.get("cwd") or os.getcwd(),
           "hook_event_name": GEMINI_TO_CLAUDE_EVENT.get(ev, ev), "transcript_path": ""}
    if out["hook_event_name"] in ("PreToolUse", "PostToolUse"):
        name, inp = gemini_tool_input(payload.get("tool_name") or "", payload.get("tool_input"))
        out["tool_name"], out["tool_input"] = name, inp
    elif out["hook_event_name"] == "UserPromptSubmit":
        out["prompt"] = payload.get("prompt") or ""
    elif out["hook_event_name"] == "Stop":
        out["stop_hook_active"] = bool(payload.get("stop_hook_active"))
        out["gemini_prompt"], out["gemini_response"] = payload.get("prompt") or "", payload.get("prompt_response") or ""
    return out


def gemini_transcript(payload, cwd):
    """Turn the Stop payload's prompt/prompt_response into a Claude Code transcript (JSONL temp file)."""
    fd, path = tempfile.mkstemp(prefix="gemini-stop-", suffix=".jsonl")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for rec in ({"type": "user", "cwd": cwd, "message": {"role": "user", "content": payload.pop("gemini_prompt", "")}},
                    {"type": "assistant", "cwd": cwd,
                     "message": {"role": "assistant", "content": [
                         {"type": "text", "text": payload.pop("gemini_response", "")}]}}):
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return path


def gemini_output(out, event):
    """A Claude Code hook's stdout as Gemini CLI's: deny -> decision "deny", context -> additionalContext.
    Anything else prints nothing (Gemini treats non-JSON or unknown text on stdout as a systemMessage)."""
    try:
        d = json.loads(out or "{}")
    except ValueError:
        return ""
    if not isinstance(d, dict):
        return ""
    hso = d.get("hookSpecificOutput") or {}
    if hso.get("permissionDecision") == "deny" or d.get("decision") == "block":
        reason = hso.get("permissionDecisionReason") or d.get("reason") or "blocked by a bothouse hook"
        return json.dumps({"decision": "deny", "reason": reason}, ensure_ascii=False)
    ctx = hso.get("additionalContext")
    if ctx and event in ("BeforeAgent", "AfterTool"):
        return json.dumps({"hookSpecificOutput": {"additionalContext": ctx}}, ensure_ascii=False)
    return ""


# iFlow CLI (hooks doc: "Hook Types", "3. Return Value Processing"). Its hooks get the event and tool names in
# environment variables (IFLOW_HOOK_EVENT_NAME, IFLOW_TOOL_NAME, IFLOW_TOOL_ARGS, IFLOW_USER_PROMPT) and the same
# JSON on stdin (the doc's examples read data["tool_input"]["file_path"] and data["prompt"]); its tool names are
# Gemini-like (run_shell_command / replace / write_file / ... with Claude Code's names as aliases). It blocks a
# tool only on a non-zero exit code ("PreToolUse Hook: Non-zero return code blocks tool execution, displays
# error message"), and prints stdout to the user instead of parsing Claude Code's JSON, so a deny is turned into
# exit 2 + stderr and any other output is dropped (it would only be noise in the user's terminal).
IFLOW_EVENTS = {"PreToolUse", "PostToolUse", "SetUpEnvironment", "Stop", "SubagentStop", "SessionStart",
                "SessionEnd", "UserPromptSubmit", "Notification"}
IFLOW_NAMES = {"run_shell_command": "Bash", "shell": "Bash", "bash": "Bash", "Bash": "Bash",
               "replace": "Edit", "edit": "Edit", "Edit": "Edit", "multi_edit": "MultiEdit", "MultiEdit": "MultiEdit",
               "write_file": "Write", "write": "Write", "Write": "Write", "read_file": "Read", "read": "Read",
               "search_file_content": "Grep", "list_directory": "LS"}


def iflow_payload(payload):
    """An iFlow CLI hook payload as Claude Code's shape, filling what it only passes in the environment."""
    ev = payload.get("hook_event_name") or os.environ.get("IFLOW_HOOK_EVENT_NAME") or ""
    out = {"session_id": payload.get("session_id") or os.environ.get("IFLOW_SESSION_ID") or "",
           "cwd": payload.get("cwd") or os.environ.get("IFLOW_CWD") or os.getcwd(),
           "hook_event_name": ev, "transcript_path": payload.get("transcript_path") or os.environ.get("IFLOW_TRANSCRIPT_PATH") or ""}
    name = payload.get("tool_name") or os.environ.get("IFLOW_TOOL_NAME") or ""
    if out["hook_event_name"] in ("PreToolUse", "PostToolUse") and name:
        args = payload.get("tool_input")
        if args is None:
            try:
                args = json.loads(os.environ.get("IFLOW_TOOL_ARGS") or "{}")
            except ValueError:
                args = {}
        out["tool_name"] = IFLOW_NAMES.get(name, name)
        out["tool_input"] = args if isinstance(args, dict) else {}
    elif out["hook_event_name"] == "UserPromptSubmit":
        out["prompt"] = payload.get("prompt") or os.environ.get("IFLOW_USER_PROMPT") or ""
    elif out["hook_event_name"] == "Notification":
        out["message"] = payload.get("message") or os.environ.get("IFLOW_NOTIFICATION_MESSAGE") or ""
    return out


def iflow_output(out):
    """(stdout, stderr, exit code) for iFlow: a Claude Code deny becomes exit 2 + the reason on stderr."""
    try:
        d = json.loads(out or "{}")
    except ValueError:
        return "", "", 0
    if not isinstance(d, dict):
        return "", "", 0
    hso = d.get("hookSpecificOutput") or {}
    if hso.get("permissionDecision") == "deny" or d.get("decision") in ("block", "deny"):
        return "", (hso.get("permissionDecisionReason") or d.get("reason") or "blocked by a bothouse hook"), 2
    return "", "", 0


# ── The user's latest words for PreToolUse (ask-only-guard) ──
# Claude Code / Qoder put a Claude Code transcript in every PreToolUse payload. For Codex, agy and DSH run.py
# reads the words from where that CLI keeps them and passes them as payload["user_prompt"], which the guard reads
# before transcript_path.
PROMPT_HOOKS = {"ask-only-guard"}  # hooks that read the user's latest words in PreToolUse
CODEX_INJECTED = ("# AGENTS.md instructions", "<environment_context>", "<user_instructions>", "<permissions instructions>")
TAIL_BYTES = 4 << 20  # a rollout can be large; the latest user message is near its end


def parts_text(parts):
    """Text of a content-part list ({type: text, text} / Codex's input_text) or a string."""
    if isinstance(parts, str):
        return parts
    if isinstance(parts, dict):
        parts = [parts]
    if not isinstance(parts, list):
        return ""
    out = []
    for p in parts:
        if isinstance(p, str):
            out.append(p)
        elif isinstance(p, dict) and isinstance(p.get("text"), str) and p.get("type") in (None, "text", "input_text"):
            out.append(p["text"])
    return "\n".join(t for t in out if t)


def tail_lines(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - TAIL_BYTES))
            data = f.read()
    except (OSError, TypeError, ValueError):
        return []
    lines = data.decode("utf-8", "replace").splitlines()
    return lines[1:] if size > TAIL_BYTES else lines


def transcript_user_words(path):
    """The latest user message in a transcript file, whichever CLI wrote it:
    Claude Code / Qoder JSONL ({type: user, message: {content}}), Codex rollout (response_item message role user,
    without the AGENTS.md / environment_context messages Codex injects), agy transcript_full.jsonl (USER_INPUT steps)."""
    for line in reversed(tail_lines(path)):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        t = e.get("type")
        if t == "user" and not e.get("isMeta"):
            msg = e.get("message")
            text = parts_text(msg.get("content") if isinstance(msg, dict) else None)
            if text.strip():
                return text
        elif t == "response_item":
            item = e.get("payload") or {}
            if item.get("type") == "message" and item.get("role") == "user":
                text = parts_text(item.get("content"))
                if text.strip() and not text.lstrip().startswith(CODEX_INJECTED):
                    return text
        elif t == "USER_INPUT":
            text = agy_user_text(e.get("content"))
            if text:
                return text
    return ""


def dsh_user_words(recs):
    """The latest user message in a DSH session log."""
    for d in reversed(recs):
        data = d.get("data") or {}
        if d.get("type") == "user/message" and (data.get("source") or {}).get("kind") == "user":
            parts = [user_text(c.get("text", "")) for c in data.get("content", [])
                     if isinstance(c, dict) and c.get("type") == "text"]
            text = "\n\n".join(p for p in parts if p)
            if text:
                return text
    return ""


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


SWITCH = os.path.join(".bothouse", "conest-hooks.json")
LEGACY_SWITCH = os.path.join(".claude", "conest-hooks.json")


def hook_names():
    return sorted(f[:-3] for f in os.listdir(HERE)
                  if f.endswith(".py") and f not in ("run.py", "doc-ok.py", "dshlog.py", "dsh-cc-compat.py", "codex-compat.py", "lessons.py", "ctxsvc.py", "wiki_search.py")
                  and not f.startswith("test_"))


def role_dir(start=None):
    if OPTS["role"]:
        return os.path.abspath(OPTS["role"])
    d = os.path.abspath(start or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    probe = d
    while True:
        if any(os.path.isfile(os.path.join(probe, p)) for p in (
                SWITCH, LEGACY_SWITCH, ".claude/settings.json", ".gemini/settings.json", ".agents/hooks.json",
                ".cursor/hooks.json", ".qoder/settings.json", ".iflow/settings.json",
                ".bothouse/kimi-home/config.toml")):
            return probe
        up = os.path.dirname(probe)
        if up == probe:
            return d
        probe = up


def load_off(d):
    try:
        path = os.path.join(d, SWITCH)
        if not os.path.exists(path):
            path = os.path.join(d, LEGACY_SWITCH)
        with open(path, encoding="utf-8") as f:
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
        if a in ("--role", "--dsh-home", "--agy") and i + 1 < len(argv):
            OPTS[a[2:].replace("-", "_")] = argv[i + 1] or None
            i += 2
            continue
        if a == "--dsh-global":
            OPTS["dsh_global"] = True
        elif a == "--kimi":
            OPTS["kimi"] = True
        elif a == "--cursor":
            OPTS["cursor"] = True
        elif a == "--codex":
            OPTS["codex"] = True
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


def pass_exit():
    """Pass the call. agy requires a decision on stdout (its hook docs: "decision" is Required), so under --agy
    every passing exit prints {"decision": "allow"} (allow is also agy's pass for Stop, see agy_answer)."""
    if OPTS["agy"] and not OPTS.get("agy_answered"):
        OPTS["agy_answered"] = True
        sys.stdout.write(json.dumps({"decision": "allow"}))
    sys.exit(0)


def main():
    args = parse_args(sys.argv[1:])
    if not args:
        sys.exit("usage: run.py <hook name> | run.py [--role <dir>] off|on [hook ...] | run.py [--role <dir>] status")
    if args[0] in ("off", "on", "status"):
        return switch(args[0], args[1:])
    if os.environ.get("WIKI_INGEST") == "1":
        # the wiki's own ingest run (llmwiki ingest.py dsh_env sets it): its scratch dir .ingest-work sits inside a
        # role, whose hooks (dispatch-review-guard) would refuse every write and void each pass
        pass_exit()
    name = os.path.basename(args[0])
    name = name[:-3] if name.endswith(".py") else name
    target = os.path.join(HERE, name + ".py")
    if not os.path.isfile(target):
        sys.stderr.write(f"bothouse hook {name}: {target} is missing, passing (reinstall: bothouse setup hooks on)\n")
        pass_exit()
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    if OPTS["dsh_global"]:
        # the DSH-wide hook file applies to every directory DSH runs in: only bothouse's DSH roles count
        wd, entry = dsh_role(payload.get("cwd") or os.getcwd())
        if not wd or name not in (entry.get("hooks") or []):
            sys.exit(0)
        OPTS["role"] = wd
        OPTS["dsh_home"] = OPTS["dsh_home"] or entry.get("dsh_home")
    off = load_off(role_dir(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or None))
    if "all" in off or name in off:
        pass_exit()  # switched off for this role (run.py off): pass without running the hook
    if OPTS["agy"]:
        return run_agy(target, payload, OPTS["agy"])
    codex_tmp = None
    if OPTS["codex"]:
        import importlib.util
        spec = importlib.util.spec_from_file_location("codex_compat", os.path.join(HERE, "codex-compat.py"))
        compat = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compat)
        payload, codex_tmp = compat.adapt(payload)
    cursor = OPTS["cursor"] or payload.get("hook_event_name") == "beforeShellExecution"
    if cursor:
        OPTS["cursor"] = True
        payload["session_id"] = payload.get("conversation_id") or payload.get("session_id") or ""
        payload["cwd"] = payload.get("cwd") or os.getcwd()
        payload["hook_event_name"] = "PreToolUse"
        payload["tool_name"] = "Bash"
        payload["tool_input"] = {"command": payload.get("command") or payload.get("tool_input", {}).get("command") or ""}
        payload["transcript_path"] = payload.get("transcript_path") or "none"
    gemini = not cursor and payload.get("hook_event_name") in GEMINI_EVENTS
    # iFlow CLI: its event name comes in the environment (the hooks doc lists IFLOW_HOOK_EVENT_NAME for all hooks;
    # its stdin JSON carries no hook_event_name, and every Claude Code / Qoder payload does, so the variable is
    # what tells the two apart)
    iflow = not cursor and not gemini and os.environ.get("IFLOW_HOOK_EVENT_NAME") in IFLOW_EVENTS
    tmp, turn, sid = None, None, payload.get("session_id") or ""
    if iflow:
        payload = iflow_payload(payload)
    if gemini:
        payload = gemini_payload(payload)
        if payload["hook_event_name"] == "Stop":
            tmp = gemini_transcript(payload, payload["cwd"])
            payload["transcript_path"] = tmp
    if OPTS["kimi"] and payload.get("tool_name") == "bash":
        payload["tool_name"] = "Bash"
    tool = payload.get("tool_name")
    dsh = not cursor and not gemini and isinstance(tool, str) and (tool in NAMES or tool in ("str_replace_editor", "job_output"))
    if dsh:
        payload["tool_name"], payload["tool_input"] = tool_input(tool, payload.get("tool_input"))
    stop = payload.get("hook_event_name") == "Stop"
    # Claude Code always gives a transcript; an empty one is the DSH bridge (dsh-hooks-claude-code base())
    bridge = not cursor and not gemini and not OPTS["kimi"] and not OPTS["codex"] and (
        dsh or OPTS["dsh_global"] or not payload.get("transcript_path"))
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

    if dsh or OPTS["dsh_global"]:
        payload["dsh"] = True
        if path and payload.get("hook_event_name") == "PreToolUse":
            import importlib.util
            spec = importlib.util.spec_from_file_location("dsh_compat", os.path.join(HERE, "dsh-cc-compat.py"))
            compat = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(compat)
            # same gate and retry as the standalone adapter: the log is read only for bash / job_output
            # (dsh_turn) and dsh_busy only for a sleep / wait=true; unreadable log = no fields, hook still runs
            compat.add_fields(payload, tool, sub, lambda: read_lines(path))

    if name in PROMPT_HOOKS and payload.get("hook_event_name") == "PreToolUse" and not payload.get("user_prompt"):
        if path:  # DSH: the bridge's transcript_path is empty; the words are in the session log
            payload["user_prompt"] = dsh_user_words(records(read_lines(path)))
        elif OPTS["codex"]:  # Codex: the rollout
            payload["user_prompt"] = transcript_user_words(payload.get("transcript_path"))

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
        if codex_tmp:
            os.unlink(codex_tmp)
    if turn is not None:
        try:
            blocked = json.loads(proc.stdout or "{}").get("decision") == "block"
        except (ValueError, AttributeError):
            blocked = False
        if blocked or proc.returncode == 2:
            st = load_state()
            st[sid] = turn
            write_json(STATE, st)
    if OPTS["kimi"]:
        try:
            decision = json.loads(proc.stdout or "{}")
            hook = decision.get("hookSpecificOutput") or {}
            if hook.get("permissionDecision") == "deny" or decision.get("decision") == "block":
                sys.stderr.write(hook.get("permissionDecisionReason") or decision.get("reason") or "Blocked by bothouse hook")
                sys.exit(2)
        except (ValueError, AttributeError):
            pass
    if cursor:
        try:
            d = json.loads(proc.stdout or "{}")
        except ValueError:
            d = {}
        hso = d.get("hookSpecificOutput") or {}
        if hso.get("permissionDecision") == "deny" or d.get("decision") == "block" or proc.returncode == 2:
            reason = hso.get("permissionDecisionReason") or d.get("reason") or (proc.stderr or "").strip() or "blocked by bothouse hook"
            sys.stdout.write(json.dumps({"permission": "deny", "agent_message": reason}, ensure_ascii=False) + "\n")
            sys.stderr.write(reason + "\n")
            sys.exit(2)
        sys.stdout.write(json.dumps({"permission": "allow"}, ensure_ascii=False) + "\n")
        sys.exit(0)
    if iflow:
        out, err, code = iflow_output(proc.stdout)
        sys.stdout.write(out)
        sys.stderr.write(err + ("\n" if err else ""))
        sys.exit(code or (2 if proc.returncode == 2 else 0))
    if gemini:
        sys.stdout.write(gemini_output(proc.stdout, payload.get("hook_event_name")))
    else:
        sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    sys.exit(proc.returncode)


# ── Antigravity ──
AGY_NAMES = {"run_command": "Bash"}  # agy tool -> Claude Code tool (run_command: agy 1.4.5 PreToolUse payload)
# agy's file tools -> Claude Code's (tool and argument names are the strings in the agy 1.4.x binary:
# write_to_file / replace_file_content / multi_replace_file_content with TargetFile, CodeContent,
# ReplacementChunks; delete_file). Only ask-only-guard is matched on them (agyMatchers).
AGY_EDITS = {"write_to_file": "Write", "replace_file_content": "Edit", "multi_replace_file_content": "Edit",
             "delete_file": "Write"}
AGY_STATE = os.path.join(HERE, "state", "agy-stop.json")  # {conversationId: user step already blocked once}


def agy_user_text(t):
    t = t or ""
    a, b = t.find("<USER_REQUEST>"), t.find("</USER_REQUEST>")
    if a >= 0 and b > a:
        t = t[a + len("<USER_REQUEST>"):b]
    return t.strip()


def agy_transcript(lines, cwd):
    """agy steps as Claude Code transcript entries, and the step index of the last user input."""
    out, last_user = [], None
    for d in records(lines):
        base = {"cwd": cwd}
        if d.get("created_at"):
            base["timestamp"] = d["created_at"]
        t = d.get("type")
        if t == "USER_INPUT":
            last_user = d.get("step_index")
            text = agy_user_text(d.get("content"))
            if text:
                out.append(dict(base, type="user", message={"role": "user", "content": text}))
        elif t == "PLANNER_RESPONSE":
            blocks = []
            if d.get("content"):
                blocks.append({"type": "text", "text": d["content"]})
            for c in d.get("tool_calls") or []:
                if isinstance(c, dict):
                    name, inp = agy_tool(c.get("name") or "", c.get("args"))
                    blocks.append({"type": "tool_use", "name": name, "input": inp})
            if blocks:
                out.append(dict(base, type="assistant", message={"role": "assistant", "content": blocks}))
    return out, last_user


def agy_tool(name, args):
    args = args if isinstance(args, dict) else {}
    if name == "run_command":
        return "Bash", dict(args, command=str(args.get("CommandLine") or ""))
    if name in AGY_EDITS:
        path = args.get("TargetFile") or args.get("AbsolutePath") or args.get("FilePath") or ""
        return AGY_EDITS[name], dict(args, file_path=str(path))
    return AGY_NAMES.get(name, name), args


def agy_payload(p, event):
    """An Antigravity hook payload in Claude Code's shape."""
    ws = p.get("workspacePaths") or []
    out = {"hook_event_name": event, "session_id": p.get("conversationId") or "",
           "transcript_path": p.get("transcriptPath") or "", "cwd": (ws[0] if ws else "") or os.getcwd(),
           "agy": True}
    call = p.get("toolCall")
    if isinstance(call, dict):
        out["tool_name"], out["tool_input"] = agy_tool(call.get("name") or "", call.get("args"))
    return out


def agy_answer(event, rc, stdout, stderr):
    """The hook's Claude Code answer as Antigravity's, and whether it blocks."""
    try:
        d = json.loads(stdout or "{}")
    except ValueError:
        d = {}
    if not isinstance(d, dict):
        d = {}
    hs = d.get("hookSpecificOutput") if isinstance(d.get("hookSpecificOutput"), dict) else {}
    if event == "Stop":
        if rc == 2 or d.get("decision") == "block":
            return {"decision": "continue", "reason": d.get("reason") or stderr.strip()}, True
        return {"decision": "allow"}, False
    if rc == 2:
        return {"decision": "deny", "reason": stderr.strip()}, True
    pd = hs.get("permissionDecision")
    if pd == "deny" or d.get("decision") == "block":
        return {"decision": "deny", "reason": hs.get("permissionDecisionReason") or d.get("reason") or ""}, True
    if pd == "ask":
        return {"decision": "ask", "reason": hs.get("permissionDecisionReason") or ""}, False
    return {"decision": "allow"}, False


def run_agy(target, raw, event):
    payload = agy_payload(raw, event)
    tmp, step, sid = None, None, payload["session_id"]
    if event == "PreToolUse" and os.path.basename(target)[:-3] in PROMPT_HOOKS:
        payload["user_prompt"] = transcript_user_words(payload["transcript_path"])
    if event == "Stop":
        lines = []
        try:
            with open(payload["transcript_path"], encoding="utf-8") as f:
                lines = f.read().splitlines()
        except OSError:
            pass
        entries, step = agy_transcript(lines, payload["cwd"])
        fd, tmp = tempfile.mkstemp(prefix="agy-stop-", suffix=".jsonl")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in entries:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        payload["transcript_path"] = tmp
        try:
            with open(AGY_STATE) as f:
                st = json.load(f)
        except (OSError, ValueError):
            st = {}
        payload["stop_hook_active"] = step is not None and st.get(sid) == step
    try:
        proc = subprocess.run([sys.executable, "-I", target], input=json.dumps(payload, ensure_ascii=False),
                              capture_output=True, text=True)
    finally:
        if tmp:
            os.unlink(tmp)
    ans, blocked = agy_answer(event, proc.returncode, proc.stdout, proc.stderr)
    if blocked and event == "Stop" and step is not None:
        try:
            with open(AGY_STATE) as f:
                st = json.load(f)
        except (OSError, ValueError):
            st = {}
        st[sid] = step
        write_json(AGY_STATE, st)
    OPTS["agy_answered"] = True
    sys.stdout.write(json.dumps(ans, ensure_ascii=False))
    sys.stderr.write(proc.stderr)
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # a broken log or adapter must not turn into a non-zero hook exit: pass
        sys.stderr.write(f"bothouse hook run.py: {type(e).__name__}: {e}, passing\n")
        pass_exit()
