#!/usr/bin/env python3
"""Hook entry for Claude Code and DSH: run.py <hook name>  (e.g. run.py bash-guard).

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
   Compressed logs (the DSH default) are read with Python's compression.zstd (3.14+), the zstandard module, or
   the node that runs DSH, frame by frame (zlib.zstdDecompressSync only decodes the first frame of a buffer).
stdout / stderr / exit code of the hook are passed through.
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
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
STATE = os.path.join(HERE, "state", "dsh-stop.json")  # {session_id: turn already blocked once}
# 来源：实测，验收时日志在钩子开始后约 0.15 秒内写到；留足余量又不拖住回复（Stop 超时设的是 30 秒）
STOP_WAIT = 3.0
MODEL_HEAD, MODEL_END = "[cc-connect model-control instructions]", "[/cc-connect model-control instructions]"

# Splits a buffer of concatenated zstd frames (RFC 8878 section 3.1) and decodes each with node's zlib.
NODE_ZSTD = r"""
const z = require('zlib'), b = require('fs').readFileSync(process.argv[1]); const out = []; let p = 0;
while (p + 4 <= b.length) {
  const m = b.readUInt32LE(p);
  if (((m & 0xFFFFFFF0) >>> 0) === 0x184D2A50) { if (p + 8 > b.length) break; p += 8 + b.readUInt32LE(p + 4); continue; }
  if (m !== 0xFD2FB528) break;
  let q = p + 4; const fhd = b[q++]; const single = (fhd >> 5) & 1, fcs = fhd >> 6;
  if (!single) q++;
  q += [0, 1, 2, 4][fhd & 3];
  q += fcs === 0 ? single : [0, 2, 4, 8][fcs];
  let ok = true;
  for (;;) {
    if (q + 3 > b.length) { ok = false; break; }
    const h = b[q] | (b[q + 1] << 8) | (b[q + 2] << 16); q += 3;
    q += ((h >> 1) & 3) === 1 ? 1 : (h >>> 3);
    if (h & 1) break;
  }
  if (!ok) break;
  if ((fhd >> 2) & 1) q += 4;
  if (q > b.length) break;
  try { out.push(z.zstdDecompressSync(b.subarray(p, q))); } catch (e) { break; }
  p = q;
}
process.stdout.write(Buffer.concat(out));
"""


def dsh_home():
    return os.environ.get("DSH_HOME") or os.path.join(os.path.expanduser("~"), ".dsh")


def session_file(sid):
    if not sid:
        return None
    base = os.path.join(glob.escape(os.path.join(dsh_home(), "sessions")), "*", glob.escape(sid))
    for name in ("session.v4.jsonl", "session.v4.jsonl.zstd"):
        hits = glob.glob(os.path.join(base, name))
        if hits:
            return hits[0]
    return None


def read_lines(path):
    """Lines of a DSH session log, plain or zstd; [] when it cannot be read."""
    if not path.endswith(".zstd"):
        try:
            with open(path, encoding="utf-8") as f:
                return f.read().splitlines()
        except OSError:
            return []
    data = None
    try:
        from compression import zstd  # Python 3.14+
        with open(path, "rb") as f:
            data = zstd.decompress(f.read())
    except Exception:
        pass
    if data is None:
        try:
            import zstandard
            with open(path, "rb") as f:  # read_across_frames: the default stops after the first frame
                data = zstandard.ZstdDecompressor().stream_reader(f, read_across_frames=True).read()
        except Exception:
            pass
    if data is None:
        try:
            data = subprocess.run(["node", "-e", NODE_ZSTD, path], capture_output=True, timeout=20).stdout
        except (OSError, subprocess.SubprocessError):
            return []
    return data.decode("utf-8", "replace").splitlines()


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


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: run.py <hook name>")
    name = os.path.basename(sys.argv[1])
    target = os.path.join(HERE, name if name.endswith(".py") else name + ".py")
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    tool = payload.get("tool_name")
    dsh = isinstance(tool, str) and (tool in NAMES or tool == "str_replace_editor")
    if dsh:
        payload["tool_name"], payload["tool_input"] = tool_input(tool, payload.get("tool_input"))
    stop = payload.get("hook_event_name") == "Stop"
    # Claude Code always gives a transcript; an empty one is the DSH bridge (dsh-hooks-claude-code base())
    path = session_file(payload.get("session_id") or "") if (dsh or not payload.get("transcript_path")) else None
    recs = records(read_lines(path)) if path else []
    head = recs[0] if recs and recs[0].get("type") == "session" else {}
    sub = bool(head.get("delegationDepth"))
    if sub and "agent_id" not in payload:
        payload["agent_id"] = payload.get("session_id")

    tmp, turn, sid = None, None, payload.get("session_id") or ""
    if stop and path:
        if sub:
            sys.exit(0)
        recs = wait_for_log(path, recs)
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
            os.makedirs(os.path.dirname(STATE), exist_ok=True)
            with open(STATE, "w") as f:
                json.dump(st, f)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
