#!/usr/bin/env python3
"""Convert each sub bot's own sessions and diary into Claude Code style transcripts that llm-wiki
(llm-wiki, one clone per bot: bots.json "wiki", default <workdir>/wiki) can ingest unchanged.

  export.py [bot ...]     export (default: every bot); prints sessions per bot
  export.py --no-wait ... a bot whose wiki an ingest run holds is skipped, not waited for (day runs: the lead's
                          `ingest.py --pending` never waits for the lock either; the night run can hold it for hours)
  export.py --count       only count the sessions that would be exported
  export.py --list        print <bot> <cc-connect project> <wiki dir> per bots.json entry (sub-wiki.sh reads it)

Output: <this dir>/transcripts/ (or $WIKI_TRANSCRIPTS)/<bot>/{codex,agy,diary}/<stem>.jsonl, one record per line:
  {"type": "user"|"assistant", "timestamp": ..., "cwd": ..., "message": {"content": ...}}   (what llm-wiki reads)
"timestamp" is when the source record was said, ISO UTC like Claude Code's ("2026-10-19T03:04:05.678Z"): llm-wiki's
dream labels each USER line [MM-DD] from it (dialog(): ts[:19] read as UTC, shown in local time) and rejects a dream
whose dates don't match; without it every line is [?]. A record whose source has no time carries no timestamp.
A file is rewritten only when its content changed, and its mtime is set to the source's mtime, so llm-wiki's
"idle >= 30 min" check and session date follow the real session. Records are emitted one per source record in
source order, so a growing session only grows its transcript at the end (llm-wiki keeps a byte offset per file).
When a rewrite changes earlier lines only by their timestamps (files exported before timestamps existed) or by
command-result records inserted between them (DSH files exported before tool/result was kept), the byte offsets the
bot's wiki keeps for that file (.ingest.sqlite: ingested/reviewed/dreamed) are moved to the same line in the new
file, under the wiki's ingest lock, so nothing is ingested twice or skipped.

Which sessions belong to a bot (data, 2026-10-17):
  * codex bots: session_meta.cwd == the bot's cc-connect work_dir and originator is cc-connect's
    ("cc-connect-codex-agent"; turns from before 2026-10-12 carry "codex_cli_rs" and Discord content).
    Both codex homes are scanned: longniang's cc-connect codex_home is ~/.codex now but its 10-11..10-13
    sessions sit in ~/.codex-relay; jingyu's 10-11 sessions sit in ~/.codex. Excluded: codex_exec runs
    (probes, "只回复 OK" tests) and every llm-wiki ingest pass (cwd .../wiki/.ingest-work).
  * gemini (agy): trajectory_metadata_blob field 1.1 (workspace URI) == file://<work_dir>.
  * dsh bots (jingyu after the Codex -> DSH switch, 2026-10-21):
    <dsh_home>/sessions/<cwd slug>/<id>/session.v4.jsonl (stored uncompressed: the profile sets
    session-persistence-jsonl compression: none) whose first record (type "session") has cwd == work_dir and
    delegationDepth 0 (subagents run inside a turn; their results are already in it). Her Codex sessions from
    before the switch are still exported, so a rollback loses nothing.
"""
import fcntl, json, os, re, shutil, sqlite3, sys, tempfile, time
from pathlib import Path

HOME = Path.home()
OUT = Path(os.environ.get("WIKI_TRANSCRIPTS") or Path(__file__).resolve().parent / "transcripts").expanduser()
CODEX_HOMES = [HOME / ".codex", HOME / ".codex-relay"]
AGY_DIR = HOME / ".gemini" / "antigravity-cli" / "conversations"
CC_ORIGINATORS = ("cc-connect-codex-agent", "codex_cli_rs")
# Which bots to export: $WIKI_BOTS (default <this dir>/bots.json, see bots.example.json). Per bot:
#   kind codex|agy, workdir = its cc-connect work_dir, optional dsh_home (DSH_HOME of a DSH wrapper),
#   optional wiki (default <workdir>/wiki), project (cc-connect project name, for sub-wiki.sh hook), name, persona.
_bots_file = Path(os.environ.get("WIKI_BOTS") or Path(__file__).resolve().parent / "bots.json").expanduser()
BOTS = {}
for _k, _v in (json.loads(_bots_file.read_text(encoding="utf-8")) if _bots_file.exists() else {}).items():
    _v = dict(_v, workdir=str(Path(_v["workdir"]).expanduser()))
    if _v.get("dsh_home"):
        _v["dsh_home"] = Path(_v["dsh_home"]).expanduser()
    BOTS[_k] = _v

# ---- what cc-connect / the CLIs inject into a user turn (not channel messages) ----
DROP_ITEM = ("# AGENTS.md instructions", "<environment_context", "<user_instructions", "<permissions")
HINT_HEAD = "（可能相关的 wiki 页"      # cc-connect: header line, then "- path — desc" lines
HANDOFF_HEAD, HANDOFF_END = "（新会话。上一个会话", "（交接结束）"  # old session's text, already in that session
SUMMARY_HEAD = "（本频道进展总结"        # retired 2026-10-14; written by 橘, not channel messages
CHANNEL_HEADS = ("（频道里你上次看到之后的消息", "（之前没回复的消息", "（最新")


def clean_user(text):
    """Channel text of one user content item with the injected blocks removed ('' if nothing is left)."""
    t = text.strip()
    if t.startswith(DROP_ITEM):
        return ""
    if t.startswith(HANDOFF_HEAD):
        i = t.find(HANDOFF_END)
        t = t[i + len(HANDOFF_END):].strip() if i >= 0 else ""
    if t.startswith(SUMMARY_HEAD):
        cut = [i for i in (t.find(h) for h in CHANNEL_HEADS) if i > 0]
        t = t[min(cut):].strip() if cut else ""
    out, skipping = [], False
    for line in t.splitlines():
        if line.startswith(HINT_HEAD):
            skipping = True
            continue
        if skipping and (line.startswith("- ") or not line.strip()):
            continue
        skipping = False
        out.append(line)
    t = "\n".join(out).strip()
    if t.startswith("<"):  # llm-wiki's extract() drops user text starting with "<" (CLI tags); "<@id>" is a mention
        t = "(频道) " + t
    return t


def stamped(rec, ts):
    if ts:
        rec["timestamp"] = ts
    return rec


def user_rec(text, cwd, ts=None):
    return stamped({"type": "user", "cwd": cwd, "message": {"role": "user", "content": text}}, ts)


def text_rec(text, cwd, ts=None):
    return stamped({"type": "assistant", "cwd": cwd,
                    "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}, ts)


def tool_rec(name, arg, cwd, ts=None):
    return stamped({"type": "assistant", "cwd": cwd,
                    "message": {"role": "assistant", "content": [{"type": "tool_use", "name": name, "input": {"command": arg}}]}},
                   ts)


def cut(text, n):
    """First and last n/2 chars of text, joined by an ellipsis when cut (a failure's Traceback or exit code is
    usually at the end of the output)."""
    text = text.strip()
    return text if len(text) <= n else text[: n // 2] + " … " + text[-(n // 2):]


def iso_utc(seconds, nanos=0):
    """Unix time as Claude Code's transcript timestamp (UTC, milliseconds, Z)."""
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{nanos // 1_000_000:03d}Z"


# ---- codex rollouts ----
CMD = re.compile(r'\bcmd:\s*"((?:[^"\\]|\\.)*)"')


def tool_arg(p):
    """The shell command (or the start of the input) of a codex tool call."""
    if p.get("type") == "function_call":
        try:
            a = json.loads(p.get("arguments") or "{}")
        except ValueError:
            return str(p.get("arguments"))[:300]
        c = a.get("cmd") or a.get("command") or ""
        return " ".join(c) if isinstance(c, list) else str(c or json.dumps(a, ensure_ascii=False))
    raw = str(p.get("input") or "")
    m = CMD.search(raw)
    if m:
        try:
            return json.loads('"' + m.group(1) + '"')
        except ValueError:
            return m.group(1)
    return raw


def codex_meta(path):
    with open(path) as f:
        first = f.readline()
    try:
        d = json.loads(first)
    except ValueError:
        return {}
    return d.get("payload", {}) if d.get("type") == "session_meta" else {}


def codex_sessions(workdir):
    """{session id: rollout path} of the bot's cc-connect sessions in every codex home."""
    found = {}
    for home in CODEX_HOMES:
        for p in sorted((home / "sessions").glob("**/rollout-*.jsonl")):
            m = codex_meta(p)
            if m.get("cwd") == workdir and m.get("originator") in CC_ORIGINATORS and m.get("id"):
                found[m["id"]] = p
    return found


def codex_records(path, cwd):
    recs = []
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue  # a line still being written
            if d.get("type") != "response_item":
                continue
            p = d.get("payload", {})
            ts = d.get("timestamp")  # rollout lines carry ISO UTC already ("2026-10-18T15:34:32.150Z")
            if p.get("type") == "message" and p.get("role") == "user":
                parts = [clean_user(c.get("text", "")) for c in p.get("content", []) if isinstance(c, dict)]
                parts = [x for i, x in enumerate(parts) if x and x not in parts[:i]]  # cc-connect repeats a block
                if parts:
                    recs.append(user_rec("\n\n".join(parts), cwd, ts))
            elif p.get("type") == "message" and p.get("role") == "assistant":
                t = "".join(c.get("text", "") for c in p.get("content", []) if isinstance(c, dict)).strip()
                if t:
                    recs.append(text_rec(t, cwd, ts))
            elif p.get("type") in ("function_call", "custom_tool_call"):
                arg = tool_arg(p)
                if arg:
                    recs.append(tool_rec(p.get("name") or "tool", arg[:300], cwd, ts))
    return recs


# ---- DSH sessions (event log; formats read from real sessions 2026-10-21) ----
# {"type": "session", "id", "cwd", "delegationDepth", ...} first; then one event per line with "time" (ms):
#   user/message      data.content [{type text|image}], data.source.kind: "user" = what cc-connect sent (also a
#                     message steered into a running turn); other kinds are harness context (agent-instructions,
#                     runtime-context, skill-catalog, time-context): not channel messages
#   assistant/message data.message.content [{type reasoning|text|tool-call}]: the text blocks are the reply
#   tool/call         data.name, data.arguments (a JSON string)
#   tool/result       data.message.content [{type text|image}], data.message.isError: what the command printed
DSH_SESSION_FILE = "session.v4.jsonl"
# cc-connect's ACP adapter puts its model-control skill before every prompt (core.PrependModelSwitchInstructions)
MODEL_HEAD, MODEL_END = "[cc-connect model-control instructions]", "[/cc-connect model-control instructions]"


def dsh_user_text(text):
    t = text.strip()
    if t.startswith(MODEL_HEAD):
        i = t.find(MODEL_END)
        t = t[i + len(MODEL_END):] if i >= 0 else ""
    return clean_user(t)


def dsh_meta(path):
    """The session record, {} if the file is gone, unreadable or not a session (one bad file must not stop the
    bot's whole export: sources() runs outside the per-file try)."""
    try:
        with open(path) as f:
            d = json.loads(f.readline())
    except (OSError, ValueError):
        return {}
    return d if d.get("type") == "session" else {}


def dsh_sessions(dsh_home, workdir):
    """{session id: session file} of the top-level DSH sessions run in workdir."""
    found = {}
    for p in sorted((Path(dsh_home) / "sessions").glob(f"*/*/{DSH_SESSION_FILE}")):
        m = dsh_meta(p)
        if m.get("cwd") == workdir and not m.get("delegationDepth") and m.get("id"):
            found[m["id"]] = p
    return found


def dsh_time(d):
    ms = d.get("time")
    return iso_utc(ms // 1000, (ms % 1000) * 1_000_000) if isinstance(ms, int) else None


def dsh_tool_arg(data):
    try:
        a = json.loads(data.get("arguments") or "{}")
    except ValueError:
        return str(data.get("arguments"))[:300]
    if not isinstance(a, dict):
        return json.dumps(a, ensure_ascii=False)
    c = a.get("command") or a.get("file_path") or a.get("path") or a.get("url") or ""
    return str(c) if c else json.dumps(a, ensure_ascii=False)


def dsh_records(path, cwd):
    recs = []
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue  # a line still being written
            t, data, ts = d.get("type"), d.get("data") or {}, dsh_time(d)
            if t == "user/message" and (data.get("source") or {}).get("kind") == "user":
                parts = [dsh_user_text(c.get("text", "")) for c in data.get("content", [])
                         if isinstance(c, dict) and c.get("type") == "text"]
                parts = [x for i, x in enumerate(parts) if x and x not in parts[:i]]
                if parts:
                    recs.append(user_rec("\n\n".join(parts), cwd, ts))
            elif t == "assistant/message":
                content = (data.get("message") or {}).get("content", [])
                txt = "".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text").strip()
                if txt:
                    recs.append(text_rec(txt, cwd, ts))
            elif t == "tool/call":
                arg = dsh_tool_arg(data)
                if arg:
                    recs.append(tool_rec(data.get("name") or "tool", arg[:300], cwd, ts))
            elif t == "tool/result":
                # Kept so failures reach the ingest (方案 4:
                # 「导出补上命令报错」); 300 chars like the command above (this file's existing tool_rec length), but
                # head and tail, as the author's reflect.py does.
                msg = data.get("message") or {}
                out = "".join(c.get("text", "") for c in msg.get("content", [])
                              if isinstance(c, dict) and c.get("type") == "text").strip()
                if out:
                    recs.append(tool_rec("result error" if msg.get("isError") else "result", cut(out, 300), cwd, ts))
    return recs


# ---- agy conversations (protobuf in SQLite; field numbers from ~/code/cc-connect/agent/antigravity/handoff.go,
# which took them from the descriptors embedded in the agy 1.3.5 binary) ----
STEP_USER, STEP_PLANNER = 14, 15            # CortexStepType USER_INPUT, PLANNER_RESPONSE
F_USER_INPUT, F_PLANNER = 19, 20            # gemini_coder.Step.user_input / planner_response
U_QUERY, U_RESPONSE, U_ITEMS, ITEM_TEXT = 1, 2, 3, 1
P_RESPONSE, P_MODIFIED = 1, 8
META_WORKSPACE, WS_URI = 1, 1               # trajectory_metadata_blob: field 1 (workspace) . field 1 (URI), data
F_STEP_META, META_CREATED = 5, 1            # Step.metadata . CortexStepMetadata.created_at (handoff.go:34,40)
TS_SECONDS, TS_NANOS = 1, 2                 # google.protobuf.Timestamp (handoff.go:64-65)


def pb_fields(b):
    """[(field, wire type, value)] of a protobuf message; [] if it doesn't parse."""
    out, i = [], 0

    def varint():
        nonlocal i
        x = s = 0
        while True:
            c = b[i]
            i += 1
            x |= (c & 0x7F) << s
            s += 7
            if c < 0x80:
                return x
    try:
        while i < len(b):
            tag = varint()
            n, w = tag >> 3, tag & 7
            if w == 0:
                v = varint()
            elif w == 1:
                v, i = b[i:i + 8], i + 8
            elif w == 5:
                v, i = b[i:i + 4], i + 4
            elif w == 2:
                ln = varint()
                v, i = b[i:i + ln], i + ln
            else:
                return []
            if i > len(b):
                return []
            out.append((n, w, v))
    except IndexError:
        return []
    return out


def pb_all(b, num):
    return [v for n, w, v in pb_fields(b or b"") if n == num and w == 2]


def pb_str(b, num):
    vals = pb_all(b, num)
    return vals[-1].decode("utf-8", "replace") if vals else ""


def pb_int(b, num):
    vals = [v for n, w, v in pb_fields(b or b"") if n == num and w == 0]
    return vals[-1] if vals else 0


def agy_time(payload):
    """ISO UTC of a step's created_at (when the user's message came in / the reply started), None if absent."""
    created = (pb_all((pb_all(payload, F_STEP_META) or [b""])[-1], META_CREATED) or [b""])[-1]
    sec = pb_int(created, TS_SECONDS)
    return iso_utc(sec, pb_int(created, TS_NANOS)) if sec else None


def agy_user_text(ui):
    t = pb_str(ui, U_RESPONSE).strip()
    if t:
        return t
    parts = [pb_str(item, ITEM_TEXT).strip() for item in pb_all(ui, U_ITEMS)]
    return "".join(p for p in parts if p) or pb_str(ui, U_QUERY).strip()


def agy_query(path, sql, args=()):
    """Rows of a read-only query on an agy conversation. A WAL database that a read-only connection can't open
    (it would need recovery) is copied with its -wal to a temp dir and read there; the original is never written."""
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=1)
        try:
            return db.execute(sql, args).fetchall()
        finally:
            db.close()
    except sqlite3.Error:
        pass
    with tempfile.TemporaryDirectory(prefix="agy-copy-") as tmp:
        for suffix in ("", "-wal"):
            src = Path(str(path) + suffix)
            if src.exists():
                shutil.copy2(src, Path(tmp) / (path.name + suffix))
        db = sqlite3.connect(Path(tmp) / path.name)
        try:
            return db.execute(sql, args).fetchall()
        finally:
            db.close()


def agy_workspace(path):
    try:
        rows = agy_query(path, "select data from trajectory_metadata_blob")
    except sqlite3.Error as e:
        print(f"{path.name}: {e}", file=sys.stderr)
        return None
    return pb_str((pb_all(rows[0][0], META_WORKSPACE) or [b""])[0], WS_URI) if rows else None


def agy_sessions(workdir):
    want = "file://" + workdir
    return {p.stem: p for p in sorted(AGY_DIR.glob("*.db")) if agy_workspace(p) == want}


def agy_records(path, cwd):
    recs = []
    rows = agy_query(path, "select step_type, step_payload from steps where step_type in (?, ?) order by idx",
                     (STEP_USER, STEP_PLANNER))
    for typ, payload in rows:
        ts = agy_time(payload)
        if typ == STEP_USER:
            t = clean_user(agy_user_text((pb_all(payload, F_USER_INPUT) or [b""])[-1]))
            if t:
                recs.append(user_rec(t, cwd, ts))
        else:
            pr = (pb_all(payload, F_PLANNER) or [b""])[-1]
            t = (pb_str(pr, P_MODIFIED) or pb_str(pr, P_RESPONSE)).strip()
            if t:
                recs.append(text_rec(t, cwd, ts))
    return recs


# ---- diary ----
ENTRY = re.compile(r"^\d{4}-\d\d-\d\d \d\d:\d\d")  # each entry starts with `date` output (persona rule)
ENTRY_TIME = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)(?: ([A-Z]{2,5})\b)?")


def diary_time(head):
    """ISO UTC of an entry's leading `date` output ("2026-10-15 12:08:06 JST" or "2026-10-15 02:27"): the machine's
    local time, which is how `date` printed it. A zone other than the local one is not guessed: None."""
    m = ENTRY_TIME.match(head)
    if not m or (m.group(2) and m.group(2) not in time.tzname):
        return None
    fmt = "%Y-%m-%d %H:%M:%S" if m.group(1).count(":") == 2 else "%Y-%m-%d %H:%M"
    try:
        return iso_utc(int(time.mktime(time.strptime(m.group(1), fmt))))
    except (ValueError, OverflowError):
        return None
DIARY_MARK = "（日记条目：下面这条是你自己写的日记，不是别人说的话）"


def diary_records(path, cwd):
    """One (marker, entry) pair per entry: a USER marker keeps every new entry visible to llm-wiki (it skips a
    delta without user lines); the entry itself is the bot's own words, so it is an assistant record."""
    entries, cur = [], []
    for line in Path(path).read_text().splitlines():
        if ENTRY.match(line) and cur:
            entries.append(cur)
            cur = []
        if ENTRY.match(line) or cur:
            cur.append(line)
    if cur:
        entries.append(cur)
    recs = []
    for e in entries:
        text = "\n".join(e).strip()
        if text:
            ts = diary_time(e[0])
            recs += [user_rec(DIARY_MARK, cwd, ts), text_rec(text, cwd, ts)]
    return recs


# ---- writing ----
STATE_TABLES = ("ingested", "reviewed", "dreamed")  # llm-wiki's per-file byte offsets (ingest.py state())


def wiki_of(bot):
    return Path(BOTS[bot].get("wiki") or Path(BOTS[bot]["workdir"]) / "wiki").expanduser()


def unstamped(line):
    try:
        d = json.loads(line)
    except ValueError:
        return None
    d.pop("timestamp", None)
    return d


RESULT_NAMES = ("result", "result error")  # tool_rec names dsh_records gives a tool/result


def is_result(rec):
    """True for a command-result record (an unstamped line's dict)."""
    c = ((rec or {}).get("message") or {}).get("content")
    return (rec or {}).get("type") == "assistant" and isinstance(c, list) and len(c) == 1 and isinstance(c[0], dict) \
        and c[0].get("type") == "tool_use" and c[0].get("name") in RESULT_NAMES


def line_map(old, new):
    """{byte offset in old: byte offset in new} at every line end up to the first line that differs other than by
    its timestamp. Offsets llm-wiki stores are line ends (extract/dialog: offset + last newline).
    Result records in new that old doesn't have (DSH files exported before tool/result was kept) are stepped over:
    an old line end maps past the results that follow it in new (the output of the command on that line), so a
    file ingested to its end stays ingested to its end."""
    olds, news = old.splitlines(keepends=True), new.splitlines(keepends=True)
    full = lambda line: line.endswith(b"\n")
    nu = [unstamped(b) if full(b) else None for b in news]
    moved, o, n, j = {0: 0}, 0, 0, 0
    for i, a in enumerate(olds):
        ua = unstamped(a) if full(a) else None
        if ua is None:
            break
        while j < len(news) and is_result(nu[j]) and nu[j] != ua:  # inserted result: not in old
            n, j = n + len(news[j]), j + 1
        if j >= len(news) or nu[j] != ua:
            break
        o, n, j = o + len(a), n + len(news[j]), j + 1
        nxt = unstamped(olds[i + 1]) if i + 1 < len(olds) and full(olds[i + 1]) else None
        m, k = n, j
        while k < len(news) and is_result(nu[k]) and nu[k] != nxt:  # this line's own inserted results
            m, k = m + len(news[k]), k + 1
        moved[o] = m
    return moved


def planned_moves(db, sid, moved):
    """[(table, offset now, offset after)] that point the wiki's offsets for `sid` at the same line of the rewritten
    file. An offset not on a mapped line (the content before it changed) is left as it was, as before this existed."""
    tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
    return [(t, off, moved[off]) for t in STATE_TABLES if t in tables
            for (off,) in db.execute(f"select offset from {t} where id=?", (sid,)).fetchall()
            if off in moved and moved[off] != off]


# File replace and offset move succeed or fail together. The offset move commits first, together with a row here
# naming the file; the file is then replaced from <stem>.tmp (written before the commit) and the row deleted. A run
# that dies in between leaves the row, and the next export finishes the replace before anything else touches that
# file (settle). Without the row a later export would find the content unchanged, never move the offsets, and leave
# them mid-line. The table lives in the wiki's state db because only a row committed with the offsets can say whether
# they moved; llm-wiki never reads it.
PENDING = "export_pending"


def pending(db):
    """{stem: path} of rewrites whose offset move committed but whose file replace may not have landed."""
    if PENDING not in {r[0] for r in db.execute("select name from sqlite_master where type='table'")}:
        return {}
    return dict(db.execute(f"select id, path from {PENDING}").fetchall())


def settle(db, dest):
    """Finish `dest`'s rewrite if a run died between its offset move and its file replace."""
    if dest.stem not in pending(db):
        return
    tmp = dest.with_suffix(".tmp")
    if tmp.exists():  # written in full before the commit: the content the moved offsets refer to
        os.replace(tmp, dest)
    db.execute(f"delete from {PENDING} where id=?", (dest.stem,))


def open_state(state):
    if state is None or not state.exists():
        return None
    return sqlite3.connect(state, timeout=60, isolation_level=None)  # autocommit; transactions are explicit in write()


def write(dest, recs, mtime, state=None):
    """Write only on change; mtime follows the source; offsets in the wiki `state` db follow moved lines, and land
    together with the new file (see PENDING). Returns True if written. On error the file and its offsets are left
    as they were (or as a later export will settle them) and the error is raised."""
    data = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs).encode()
    dest.parent.mkdir(parents=True, exist_ok=True)
    db = open_state(state)
    try:
        if db:
            settle(db, dest)
        old = dest.read_bytes() if dest.exists() else None
        changed = old != data
        if changed:
            tmp = dest.with_suffix(".tmp")
            tmp.write_bytes(data)
            moves = []
            if db and old:
                db.execute("begin immediate")
                try:
                    moves = planned_moves(db, dest.stem, line_map(old, data))
                    if moves:
                        for t, a, b in moves:
                            db.execute(f"update {t} set offset=? where id=? and offset=?", (b, dest.stem, a))
                        db.execute(f"create table if not exists {PENDING}(id text primary key, path text)")
                        db.execute(f"insert or replace into {PENDING} values (?, ?)", (dest.stem, str(dest)))
                    db.execute("commit")
                except BaseException:
                    if db.in_transaction:
                        db.execute("rollback")
                    tmp.unlink(missing_ok=True)
                    raise
            try:
                os.replace(tmp, dest)
            except BaseException:
                if moves:  # put the offsets back on the old file; if this fails too, the next export settles it
                    db.execute("begin immediate")
                    for t, a, b in moves:
                        db.execute(f"update {t} set offset=? where id=? and offset=?", (a, dest.stem, b))
                    db.execute(f"delete from {PENDING} where id=?", (dest.stem,))
                    db.execute("commit")
                tmp.unlink(missing_ok=True)
                raise
            if moves:
                db.execute(f"delete from {PENDING} where id=?", (dest.stem,))
        os.utime(dest, (mtime, mtime))
    finally:
        if db:
            db.close()
    return changed


def stem(sid):
    """llm-wiki names a session by its first 8 chars (sid8). Codex ids are UUIDv7: the head is a timestamp and
    collides across sessions started together, so the random tail leads."""
    return f"{sid.replace('-', '')[-8:]}-{sid}"


def sources(bot):
    """[(subdir, stem, source path, reader)] for one bot."""
    cfg = BOTS[bot]
    wd = cfg["workdir"]
    if cfg["kind"] == "codex":
        items = [("codex", stem(s), p, codex_records) for s, p in codex_sessions(wd).items()]
    else:
        items = [("agy", stem(s), p, agy_records) for s, p in agy_sessions(wd).items()]
    if cfg.get("dsh_home"):
        items += [("dsh", stem(s), p, dsh_records) for s, p in dsh_sessions(cfg["dsh_home"], wd).items()]
    diary = Path(wd) / "diary.md"
    if diary.exists():
        items.append(("diary", f"diary000-{bot}", diary, diary_records))
    return items


def export(bot, out=OUT, wiki=None, wait=True):
    """`wiki`: the llm-wiki clone reading out/<bot> (default: the bot's own, only when writing to OUT). Its ingest
    lock is held for the whole export so no ingest run reads a file between its rewrite and its offset move."""
    if wiki is None and out == OUT:
        wiki = wiki_of(bot)
    state = wiki / ".ingest.sqlite" if wiki else None
    wd = BOTS[bot]["workdir"]
    n = {"codex": 0, "agy": 0, "dsh": 0, "diary": 0, "written": 0, "empty": 0, "failed": 0}
    lock = open(wiki / ".ingest.lock", "w") if wiki and wiki.is_dir() else None
    try:
        if lock:
            try:  # same lock as ingest.py main(); released when closed
                fcntl.flock(lock, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
            except BlockingIOError:  # --no-wait: an ingest run holds it; the next day run exports this bot
                n["busy"] = 1
                return n
        db = open_state(state)
        if db:  # rewrites a killed run left half done, settled before any of those files is read again
            try:
                for path in pending(db).values():
                    try:
                        settle(db, Path(path))
                    except Exception as e:  # write() retries it for that file alone
                        print(f"export {bot} settle {path}: {type(e).__name__}: {e}", file=sys.stderr)
            finally:
                db.close()
        for sub, name, src, reader in sources(bot):
            try:
                recs = reader(src, wd)
                if not any(r["type"] == "user" for r in recs):
                    n["empty"] += 1
                    continue
                n[sub] += 1
                n["written"] += write(out / bot / sub / f"{name}.jsonl", recs, src.stat().st_mtime, state)
            except Exception as e:  # one bad file skips only itself; write() left it and its offsets consistent
                n["failed"] += 1
                print(f"export {bot} {sub}/{name}: {type(e).__name__}: {e}", file=sys.stderr)
    finally:
        if lock:
            lock.close()
    return n


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--list" in sys.argv:  # sub-wiki.sh: <bot> <cc-connect project> <wiki dir> per line
        for bot, cfg in BOTS.items():
            print(bot, cfg.get("project") or bot, wiki_of(bot))
        return
    bad = [b for b in args if b not in BOTS]
    if bad:
        sys.exit(f"unknown bot {bad[0]!r}: {', '.join(BOTS)}")
    failed = False
    for bot in args or BOTS:
        try:  # one bot's failure doesn't keep the others from exporting
            if "--count" in sys.argv:
                print(bot, {k: sum(1 for s in sources(bot) if s[0] == k) for k in ("codex", "agy", "dsh", "diary")})
            else:
                n = export(bot, wait=False) if "--no-wait" in sys.argv else export(bot)
                print(bot, n)
                failed |= n["failed"] > 0
        except Exception as e:
            failed = True
            print(f"export {bot}: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
