#!/usr/bin/env python3 -I
"""sessionlog: one record of every agent conversation, whichever runtime ran it and whether a bridge carried it.

Why (user 2026-10-20): 「主要我们核心是依赖 claude code，本身他也是可以查会话记录，但是万一别人不用了claude code，他这个
就有个能力缺口」; 「核心我们不做底层，我们是转发层 … 记忆就是我们的llmwiki，也是依附于平台层，当然也能独立」.
So the record depends neither on Claude Code (any runtime is written in) nor on cc-connect (a runtime's own log is
read in without a bridge). Searching old sessions (resume-session's sessions.py) and distilling them into the wiki
(ingest.py) read only this record.

  sessionlog.py where                          print the store directory
  sessionlog.py sync [READER ...]              read the runtimes' own logs into the store (sources.json; incremental)
  sessionlog.py ls [--role R] [--hosts]        the session files consumers read, one per line
  sessionlog.py append --role R --runtime RT --dir in|out [--channel C] [--session S] [--speaker N] [--ts ISO]
                       [--kind message|tool] [--tool NAME] [--text T]     one record (text from stdin without --text)
  sessionlog.py hook                           cc-connect command hook (message.received / message.sent): reads the
                                               CC_HOOK_* environment, appends one record

Store: $AGENT_SESSIONS_DIR, default ~/.local/share/agent-sessions (XDG data dir: owned by no runtime and no bridge).
  <runtime>/native/<session id>.jsonl          a runtime's own log, converted by its reader (the reader path)
  <runtime>/native/.progress.json              per session: native file, bytes read, live or archived copy, role
  <runtime>/bridge/<sha8>-<channel>.jsonl      what a bridge carried, one file per (role, channel) (the bridge path)
  hosts/<host>/<runtime>/native/...            another machine's mirrored logs (ingest.py MIRROR_TO), same layout
  sources.json                                 {"readers": [...], "bridge": {...}}: which native logs to read and
                                               whose they are (DEFAULT_SOURCES without it), bridge project → role

Record: one JSON object per line, append-only.
  v        format version (1)
  ts       when it was said, ISO UTC "2026-10-20T04:02:36.310Z" (null if the source has no time)
  role     whose conversation: the persona (橘, 龙娘, …)
  channel  where it came from: the bridge's session key ("discord:1559…"); null for a terminal or unknown
  runtime  which agent runtime: claudecode, codex, antigravity, openclaw, harness, dsh, …
  session  the runtime's session id (null when the bridge does not know it)
  dir      "in" (to the agent: user, channel, system) or "out" (from the agent); null on meta records
  kind     "message"; "tool" (a call the agent made: `tool` = name, `text` = its command / path / query); "meta"
  text     the words as said (only instructions the runtime itself injects are dropped)
  via      "bridge" or "reader"
  optional: speaker / speaker_id / project (bridge), src (reader: end byte offset, in the native log, of the line
  this record came from), queued (Claude Code: typed while a turn ran), cwd / title / custom_title (meta).

Which files a consumer reads (sessions()): when a reader covers a (role, runtime), that runtime's own log holds
everything the bridge carried plus tool calls, so the bridge files of that (role, runtime) are not listed. A (role,
runtime) no reader covers (OpenClaw, harness, DSH today) is read from its bridge files.

Readers (READERS): claudecode, codex. To add one (OpenClaw, harness, DSH, …): a class like CodexReader with
`runtime`, `find(src) -> {session id: (native path, primary)}` (primary False: only an archived copy is left) and
`convert(path, offset, state) -> iterator of ([record fields …], end offset)` for every complete line from `offset`
(state: a dict kept per session between runs), registered in READERS, plus a sources.json entry naming its role.
Until then those runtimes are recorded on the bridge path (cc-connect hook) or by their own hook calling `append`.
"""
import argparse, fcntl, hashlib, json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path

VERSION = 1
KINDS = ("message", "tool", "meta")
DIRS = ("in", "out")
DEFAULT_STORE = "~/.local/share/agent-sessions"
TOOL_CHARS = 300  # 沿用 ingest.py extract() 与 contrib/wiki/export.py tool_rec 对工具调用的截断（str(arg)[:300]）


def store():
    return Path(os.path.expanduser(os.environ.get("AGENT_SESSIONS_DIR") or DEFAULT_STORE))


def iso_utc(seconds):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds)) + f".{int(round(seconds * 1000)) % 1000:03d}Z"


def record(*, role, runtime, dir, text, kind="message", channel=None, session=None, ts=None, via="bridge", **extra):
    """A complete record (ValueError on a missing or unknown value)."""
    if not role or not runtime:
        raise ValueError("role and runtime are required")
    if kind not in KINDS or (kind != "meta" and dir not in DIRS):
        raise ValueError(f"kind {kind!r} / dir {dir!r}")
    rec = {"v": VERSION, "ts": ts or None, "role": role, "channel": channel or None, "runtime": runtime,
           "session": session or None, "dir": dir if kind != "meta" else None, "kind": kind, "text": text or "",
           "via": via}
    rec.update({k: v for k, v in extra.items() if v is not None})
    return rec


def dumps(rec):
    return json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"


def slug(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", s or "none").strip("-") or "none"


def bridge_path(role, runtime, channel, root=None):
    key = hashlib.sha1(f"{role}\0{channel or ''}".encode()).hexdigest()[:8]  # hex first: the wiki cites sessions by sid8
    return (root or store()) / slug(runtime) / "bridge" / f"{key}-{slug(channel)}.jsonl"


# Private: the record holds everything anyone said to an agent, so only the owner may read it, whatever the umask
# (review 2026-10-20 #5): directories 0700, files 0600.
DIR_MODE, FILE_MODE = 0o700, 0o600


def private_dirs(path):
    """mkdir -p `path`, every directory it creates 0700."""
    path = Path(path)
    missing = []
    while not path.exists():
        missing.append(path)
        path = path.parent
    for d in reversed(missing):
        try:
            d.mkdir(mode=DIR_MODE)
        except FileExistsError:
            continue
        d.chmod(DIR_MODE)


def private_open(path, mode="a"):
    """open() for writing ("a" or "w"); a file it creates is 0600."""
    flags = os.O_WRONLY | os.O_CREAT | (os.O_APPEND if mode == "a" else os.O_TRUNC)
    return os.fdopen(os.open(path, flags, FILE_MODE), mode)


def secure(root):
    """The store directory itself 0700 and its config 0600 (a store made before this, too)."""
    private_dirs(root)
    root.chmod(DIR_MODE)
    if (root / "sources.json").exists():
        (root / "sources.json").chmod(FILE_MODE)


def append(rec, path=None):
    """Append one record (to its bridge file unless `path`); concurrent writers are serialized by flock."""
    if not rec.get("ts"):
        rec = {**rec, "ts": iso_utc(time.time())}
    if not path:
        secure(store())
    path = Path(path) if path else bridge_path(rec["role"], rec["runtime"], rec["channel"])
    private_dirs(path.parent)
    with private_open(path, "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(dumps(rec))
    return path


# ---------------------------------------------------------------------------------------------------- reading

def in_time_order(path, records):
    """Bridge files in time order: the hook runs asynchronously, so a reply can be appended before the message it
    answers (review 2026-10-20 #7). Sorted on read, stably, within what one read returns; the file stays append-only
    (consumers keep byte offsets into it). Reader files are already in their runtime's order."""
    if Path(path).parent.name != "bridge":
        return records
    return sorted(records, key=lambda r: (r.get("ts") or "") if isinstance(r, dict) else "")


def read(path, offset=0, stop=None):
    """(records, end offset) of a store file from byte `offset` (up to `stop`); a half-written last line waits."""
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read(stop - offset if stop else -1)
    end = data.rfind(b"\n") + 1
    out = []
    for line in data[:end].splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return in_time_order(path, out), offset + end


def meta(path):
    """role / runtime / channel / session / cwd (first seen) and title / custom_title (last seen) of a store file."""
    m = {}
    for d in read(path)[0]:
        for k in ("role", "runtime", "channel", "session"):
            if m.get(k) is None and d.get(k) is not None:
                m[k] = d[k]
        if d.get("kind") == "meta":
            if d.get("cwd") and not m.get("cwd"):
                m["cwd"] = d["cwd"]
            for k in ("title", "custom_title"):
                if d.get(k):
                    m[k] = d[k]
    return m


class Session:
    """One file a consumer reads. `id` is the file stem: the runtime's session id, or <sha8>-<channel> (bridge)."""

    def __init__(self, path, runtime, via, host=None, progress=None):
        self.path, self.runtime, self.via, self.host = path, runtime, via, host
        self.id = path.stem
        p = progress or {}
        self.native = p.get("path")
        self.primary = p.get("primary", True)  # False: the runtime deleted its log; only an archived copy is left
        self._role = p.get("role")

    @property
    def role(self):
        if self._role is None:
            with open(self.path, "rb") as f:
                try:
                    self._role = json.loads(f.readline()).get("role") or ""
                except ValueError:
                    self._role = ""
        return self._role

    def __repr__(self):
        return f"Session({self.path})"


def load_progress(d):
    try:
        return json.loads((d / ".progress.json").read_text())
    except (OSError, ValueError):
        return {}


def sessions(role=None, hosts=False, root=None):
    """Store files to read: this machine's, then (hosts=True) other machines'. Bridge files of a (role, runtime) that
    a reader covers are left out (module docstring)."""
    root = root or store()
    covered = {(s.get("role"), READERS[s["reader"]].runtime) for s in sources(root) if s.get("reader") in READERS}
    bases = [(root, None)] + ([(h, h.name) for h in sorted((root / "hosts").glob("*"))] if hosts else [])
    out = []
    for base, host in bases:
        for rt in sorted(p for p in base.iterdir() if p.is_dir() and p.name != "hosts") if base.is_dir() else []:
            prog = load_progress(rt / "native")
            out += [Session(p, rt.name, "reader", host, prog.get(p.stem)) for p in sorted((rt / "native").glob("*.jsonl"))]
            if host is None:
                for p in sorted((rt / "bridge").glob("*.jsonl")):
                    s = Session(p, rt.name, "bridge")
                    if (s.role, rt.name) not in covered:
                        out.append(s)
    return [s for s in out if role is None or s.role == role]


# ---------------------------------------------------------------------------------------------------- readers

def jsonl_lines(path, offset):
    """(parsed object or None, end offset) per complete line from byte `offset`."""
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read()
    pos = offset
    for line in data[:data.rfind(b"\n") + 1].splitlines(keepends=True):
        pos += len(line)
        try:
            yield json.loads(line), pos
        except ValueError:
            yield None, pos


class ClaudeCodeReader:
    """~/.claude/projects/<project>/<session id>.jsonl. Subagent (isSidechain) and meta lines are left out, as both
    readers of these logs did (sessions.py user_texts / assistant_texts, ingest.py extract)."""
    runtime = "claudecode"

    def find(self, src):
        found = {}
        for i, root in enumerate(src["roots"]):  # the first root is the live one; later ones are archives
            for p in Path(root).glob("*/*.jsonl"):
                found.setdefault(p.stem, (p, i == 0))
        return found

    def convert(self, path, offset, state):
        for d, end in jsonl_lines(path, offset):
            yield (self.fields(d, state) if isinstance(d, dict) else []), end

    @staticmethod
    def fields(d, state):
        out, ts, t = [], d.get("timestamp"), d.get("type")
        if d.get("cwd") and d["cwd"] != state.get("cwd"):  # from any line; again when it changes (cd)
            state["cwd"] = d["cwd"]
            out.append({"kind": "meta", "dir": None, "text": "", "cwd": d["cwd"], "ts": ts})
        if d.get("isSidechain") or d.get("isMeta"):
            return out
        if t == "ai-title" and d.get("aiTitle"):
            out.append({"kind": "meta", "dir": None, "text": "", "title": d["aiTitle"], "ts": ts})
        elif t == "custom-title" and (d.get("customTitle") or d.get("title")):
            out.append({"kind": "meta", "dir": None, "text": "", "custom_title": d.get("customTitle") or d.get("title"),
                        "ts": ts})
        elif t == "attachment":  # a message the user typed while a turn was running
            a = d.get("attachment") or {}
            if a.get("type") == "queued_command" and (a.get("origin") or {}).get("kind") == "human":
                c = a.get("prompt")
                for b in [{"type": "text", "text": c}] if isinstance(c, str) else c or []:  # text, or text + image blocks
                    if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str) \
                            and b["text"].strip():
                        out.append({"kind": "message", "dir": "in", "text": b["text"], "queued": True, "ts": ts})
        elif t in ("user", "assistant"):
            c = (d.get("message") or {}).get("content")
            for b in [{"type": "text", "text": c}] if isinstance(c, str) else c or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text" and isinstance(b.get("text"), str) and b["text"].strip():
                    out.append({"kind": "message", "dir": "in" if t == "user" else "out", "text": b["text"], "ts": ts})
                elif b.get("type") == "tool_use" and t == "assistant":
                    inp = b.get("input") or {}
                    arg = inp.get("command") or inp.get("file_path") or inp.get("query") or ""
                    if arg:
                        out.append({"kind": "tool", "dir": "out", "tool": b.get("name"), "text": str(arg)[:TOOL_CHARS],
                                    "ts": ts})
        return out


# Codex rollouts: <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl. Format checked 2026-10-20 on longniang's
# rollout 01a15779… (session_meta first; response_item message / function_call / custom_tool_call), the same records
# contrib/wiki/export.py reads (codex_records, tool_arg: copied here so this file stands alone).
CODEX_DROP = ("# AGENTS.md instructions", "<environment_context", "<user_instructions", "<permissions")  # Codex's own
CODEX_CMD = re.compile(r'\bcmd:\s*"((?:[^"\\]|\\.)*)"')


def codex_tool_arg(p):
    if p.get("type") == "function_call":
        try:
            a = json.loads(p.get("arguments") or "{}")
        except ValueError:
            return str(p.get("arguments"))
        c = a.get("cmd") or a.get("command") or ""
        return " ".join(c) if isinstance(c, list) else str(c or json.dumps(a, ensure_ascii=False))
    raw = str(p.get("input") or "")
    m = CODEX_CMD.search(raw)
    if m:
        try:
            return json.loads('"' + m.group(1) + '"')
        except ValueError:
            return m.group(1)
    return raw


class CodexReader:
    """sources.json entry: {"reader": "codex", "role": …, "homes": [CODEX_HOME …], "cwd": the agent's work dir,
    "originators": [session_meta.originator …]} (cwd and originators optional filters)."""
    runtime = "codex"

    def find(self, src):
        found = {}
        for home in src.get("homes") or ["~/.codex"]:
            home = Path(os.path.expanduser(home))
            for sub in ("sessions", "archived_sessions"):
                for p in sorted((home / sub).glob("**/rollout-*.jsonl")):
                    try:
                        with open(p) as f:
                            d = json.loads(f.readline())
                    except (OSError, ValueError):
                        continue
                    m = (d.get("payload") or {}) if d.get("type") == "session_meta" else {}
                    if not m.get("id") or (src.get("cwd") and m.get("cwd") != src["cwd"]):
                        continue
                    if src.get("originators") and m.get("originator") not in src["originators"]:
                        continue
                    found.setdefault(m["id"], (p, True))
        return found

    def convert(self, path, offset, state):
        for d, end in jsonl_lines(path, offset):
            yield (self.fields(d, state) if isinstance(d, dict) else []), end

    @staticmethod
    def fields(d, state):
        out, ts, p = [], d.get("timestamp"), d.get("payload") or {}
        if d.get("type") == "session_meta" and p.get("cwd") and not state.get("cwd"):
            state["cwd"] = p["cwd"]
            out.append({"kind": "meta", "dir": None, "text": "", "cwd": p["cwd"], "ts": ts})
        if d.get("type") != "response_item":
            return out
        if p.get("type") == "message" and p.get("role") in ("user", "assistant"):
            parts = [c.get("text") or "" for c in p.get("content") or [] if isinstance(c, dict)]
            parts = [x for i, x in enumerate(parts)  # cc-connect repeats a block in one turn (export.py codex_records)
                     if x.strip() and not x.lstrip().startswith(CODEX_DROP) and x not in parts[:i]]
            if parts:
                out.append({"kind": "message", "dir": "in" if p["role"] == "user" else "out",
                            "text": ("\n\n" if p["role"] == "user" else "").join(parts), "ts": ts})
        elif p.get("type") in ("function_call", "custom_tool_call"):
            arg = codex_tool_arg(p)
            if arg:
                out.append({"kind": "tool", "dir": "out", "tool": p.get("name") or "tool", "text": arg[:TOOL_CHARS],
                            "ts": ts})
        return out


READERS = {"claudecode": ClaudeCodeReader(), "codex": CodexReader()}
# Not yet: openclaw, harness, dsh (named by the user 2026-10-20). They are recorded on the bridge path until a reader
# of their own log format is added here (interface: module docstring).

# Without sources.json: this machine's Claude Code logs belong to $AGENT_ROLE (default "assistant", the same as
# ingest.py DEFAULTS["assistant"]); add archive roots / other machines' mirrors in sources.json.
DEFAULT_SOURCES = [{"reader": "claudecode", "role": os.environ.get("AGENT_ROLE", "assistant"), "roots": ["~/.claude/projects"],
                    "hosts": ""}]


def config(root=None):
    try:
        return json.loads(((root or store()) / "sources.json").read_text())
    except OSError:
        return {}


def sources(root=None):
    return config(root).get("readers", DEFAULT_SOURCES)


def expand(src):
    """(host, entry with absolute roots) for each machine an entry covers: this one, then <hosts>/<host>/projects."""
    yield None, {**src, "roots": [os.path.expanduser(r) for r in src.get("roots") or []]}
    if src.get("hosts"):
        for h in sorted(Path(os.path.expanduser(src["hosts"])).glob("*/projects")):
            yield h.parent.name, {**src, "roots": [str(h)]}


def sync(only=None, root=None):
    """Read every configured native log's new bytes into the store. Returns how many sessions grew."""
    root = root or store()
    secure(root)
    grew = 0
    with private_open(root / ".sync.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)  # two syncs at once would append the same tail twice
        for src in sources(root):
            reader = READERS.get(src.get("reader"))
            if reader is None or (only and src["reader"] not in only):
                continue
            for host, s in expand(src):
                grew += sync_one(reader, s, (root / "hosts" / host if host else root) / reader.runtime / "native")
    return grew


def sync_one(reader, src, base):
    private_dirs(base)
    prog = load_progress(base)
    grew = 0
    for sid, (native, primary) in reader.find(src).items():
        try:
            st = native.stat()
        except OSError:
            continue
        dest = base / f"{sid}.jsonl"
        p = prog.get(sid) if dest.exists() else None
        p = p or {}
        if p.get("done", 0) > st.st_size:  # the runtime rewrote its log: this session starts over
            dest.unlink()
            p = {}
        p.update(path=str(native), primary=primary, role=src.get("role"))
        done = p.setdefault("done", 0)
        if done < st.st_size:
            state, lines = p.setdefault("state", {}), []
            for fields, end in reader.convert(native, done, state):
                for f in fields:
                    ts = f.pop("ts", None)
                    lines.append(dumps(record(role=src.get("role"), runtime=reader.runtime, session=sid, via="reader",
                                              ts=ts, src=end, **f)))
                done = end
            if lines:
                with private_open(dest, "a") as f:
                    f.writelines(lines)
                grew += 1
            p["done"] = done
        if dest.exists():
            os.utime(dest, (st.st_mtime, st.st_mtime))  # consumers' idle checks and dates follow the real session
        prog[sid] = p
    tmp = base / ".progress.json.tmp"
    with private_open(tmp, "w") as f:
        f.write(json.dumps(prog, ensure_ascii=False))
    os.replace(tmp, base / ".progress.json")
    return grew


def store_offset(path, native_offset):
    """The store-file offset matching byte `native_offset` of the native log: just past the last record whose source
    line ended at or before it (moves a consumer's progress kept against the native log onto the store file)."""
    pos = 0
    with open(path, "rb") as f:
        for line in f:
            try:
                src = json.loads(line).get("src", 0)
            except ValueError:
                break
            if src > native_offset:
                break
            pos += len(line)
    return pos


# ---------------------------------------------------------------------------------------------------- bridge hook

def from_cc_connect(env, cfg):
    """A record from cc-connect's command-hook environment (bridge/core/hooks.go eventToEnv); None for other events or
    no text. sources.json "bridge": {project: {"role": …, "runtime": …}} says whose and which runtime (role defaults
    to the project name); CC_HOOK_AGENT, where the build exports it, overrides the runtime."""
    ev = env.get("CC_HOOK_EVENT")
    if ev not in ("message.received", "message.sent") or not (env.get("CC_HOOK_CONTENT") or "").strip():
        return None
    proj = env.get("CC_HOOK_PROJECT") or ""
    m = (cfg.get("bridge") or {}).get(proj) or {}
    ts = env.get("CC_HOOK_TIMESTAMP")
    if ts:
        try:  # RFC 3339 with a zone offset → UTC
            ts = iso_utc(datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp())
        except ValueError:
            ts = None
    role = m.get("role") or proj
    received = ev == "message.received"
    return record(role=role, runtime=env.get("CC_HOOK_AGENT") or m.get("runtime") or "unknown",
                  channel=env.get("CC_HOOK_SESSION_KEY"), session=env.get("CC_HOOK_AGENT_SESSION_ID"),
                  dir="in" if received else "out", text=env["CC_HOOK_CONTENT"], ts=ts, via="bridge",
                  speaker=(env.get("CC_HOOK_USER_NAME") or None) if received else role,
                  speaker_id=(env.get("CC_HOOK_USER_ID") or None) if received else None, project=proj or None)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("where")
    p = sub.add_parser("sync"); p.add_argument("readers", nargs="*")
    p = sub.add_parser("ls"); p.add_argument("--role"); p.add_argument("--hosts", action="store_true")
    p = sub.add_parser("append")
    p.add_argument("--role", required=True); p.add_argument("--runtime", required=True)
    p.add_argument("--dir", required=True, choices=DIRS)
    p.add_argument("--kind", default="message", choices=("message", "tool"))
    for k in ("channel", "session", "speaker", "ts", "tool", "text"):
        p.add_argument("--" + k)
    sub.add_parser("hook")
    a = ap.parse_args(argv)
    if a.cmd == "where":
        print(store())
    elif a.cmd == "sync":
        print(f"{sync(a.readers or None)} session(s) grew")
    elif a.cmd == "ls":
        for s in sessions(a.role, a.hosts):
            print(f"{s.runtime}\t{s.via}\t{s.role}\t{s.host or '-'}\t{s.path}")
    elif a.cmd == "append":
        text = a.text if a.text is not None else sys.stdin.read()
        print(append(record(role=a.role, runtime=a.runtime, dir=a.dir, kind=a.kind, text=text, channel=a.channel,
                            session=a.session, ts=a.ts, via="bridge", speaker=a.speaker, tool=a.tool)))
    elif a.cmd == "hook":
        rec = from_cc_connect(os.environ, config())
        if rec:
            append(rec)


if __name__ == "__main__":
    main()
