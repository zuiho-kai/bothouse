#!/usr/bin/env -S uv run -q --script
# /// script
# requires-python = ">=3.11"
# ///
"""peek: see what each bot (cc-connect project) is doing right now, read-only.

  peek                    one line per bot: last action, how long ago, the last two steps
  peek <bot>              the last 12 steps of one bot (time, duration, tool, command)
  peek <bot> -n 20        more steps
  peek --config <file>    use this cc-connect config.toml

<bot> is a project's name or team_name in config.toml (case-insensitive), or its agent type when only one
project uses that type. The bots come from cc-connect's own config: each [[projects]] entry's agent type and
work_dir say which session log to read. Nothing is written and no bot is disturbed.

  claudecode   $CLAUDE_CONFIG_DIR or ~/.claude: projects/<work_dir with every non-alphanumeric char as ->/*.jsonl
  codex        $CODEX_HOME or ~/.codex: sessions/**/rollout-*.jsonl whose session_meta cwd is the work_dir
  dsh (acp)    $DSH_HOME or ~/.dsh: sessions/*/*/session.v4.jsonl[.zstd] whose first line's cwd is the work_dir
               (zstd is DSH's default; dshlog.py, installed next to this script, reads both)
               (DSH_HOME also from the project's agent env, or an `export DSH_HOME=` line in its cmd script)
  antigravity  only whether the newest conversation file changed recently (it is protobuf in sqlite)
  others       not supported yet (the bot is listed as such)

Config: --config, else $CC_CONNECT_CONFIG, else ./config.toml, else ~/.cc-connect/config.toml (cc-connect's own
order), else config.toml in the data dir this script is installed under (<data_dir>/tools/peek.py).
"""
import glob
import json
import os
import re
import sys
import time
import tomllib
from datetime import datetime

HOME = os.path.expanduser("~")
# the numbers below (12 steps, 110/50-char lines, 90 s / 90 min "ago" steps, 15 min open-turn window, 120-char
# argument dumps) are carried over (沿用) from the maintainers' original peek script
DEFAULT_STEPS = 12  # 沿用原版 peek
LINE_CHARS = 110  # 沿用原版 peek
TAIL_CHARS = 50  # 沿用原版 peek
ARG_CHARS = 120  # 沿用原版 peek
OPEN_TURN_SECS = 900  # 沿用原版 peek：最后活动 15 分钟内算「还在跑」


# ---- config → bots ----

def config_path(explicit=None):
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for p in (explicit, os.environ.get("CC_CONNECT_CONFIG"), "config.toml",
              os.path.join(HOME, ".cc-connect", "config.toml"), os.path.join(here, "config.toml")):
        if p and os.path.isfile(p):
            return p
    return None


def dsh_home(opts):
    env = opts.get("env") or {}
    if env.get("DSH_HOME"):
        return os.path.expanduser(env["DSH_HOME"])
    cmd = opts.get("cmd") or ""
    if cmd and os.path.isfile(cmd) and os.path.getsize(cmd) < 65536:  # 来源：只读 shell 包装脚本，不读二进制（助手自定，64 KiB）
        try:
            m = re.search(r"^\s*(?:export\s+)?DSH_HOME=[\"']?([^\"'\s]+)", open(cmd, errors="ignore").read(), re.M)
            if m:
                return os.path.expanduser(m.group(1))
        except OSError:
            pass
    return os.environ.get("DSH_HOME") or os.path.join(HOME, ".dsh")


def kind_of(agent):
    t = (agent.get("type") or "").lower()
    opts = agent.get("options") or {}
    if t == "acp":
        if "dsh" in os.path.basename(opts.get("cmd") or "").lower() or (opts.get("display_name") or "").lower() == "dsh":
            return "dsh"
    return t


def load_bots(path):
    """[{name, label, kind, work_dir, env, opts}] from config.toml, in file order."""
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    bots = []
    for p in cfg.get("projects") or []:
        agent = p.get("agent") or {}
        opts = agent.get("options") or {}
        wd = opts.get("work_dir") or ""
        bots.append({"name": p.get("name") or "?", "label": p.get("team_name") or p.get("name") or "?",
                     "kind": kind_of(agent), "work_dir": os.path.abspath(os.path.expanduser(wd)) if wd else "",
                     "env": opts.get("env") or {}, "opts": opts})
    return bots


def find_bot(bots, who):
    w = who.strip().lower()
    for b in bots:
        if w in (b["name"].lower(), b["label"].lower()):
            return b
    same = [b for b in bots if b["kind"] == w]
    return same[0] if len(same) == 1 else None


# ---- helpers ----

def newest(paths):
    paths = [p for p in paths if os.path.exists(p)]
    return max(paths, key=os.path.getmtime) if paths else None


def hm(ts):
    return datetime.fromtimestamp(ts).strftime("%H:%M:%S")


def ago(ts):
    s = max(0, int(time.time() - ts))
    if s < 90:
        return f"{s}s ago"
    if s < 5400:
        return f"{s // 60}m ago"
    return f"{s // 3600}h ago"


def short(text, n=LINE_CHARS):
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def first_line(arg):
    t = str(arg or "").strip()
    for line in t.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return line
    return t


def iso_ts(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def read_jsonl(path, limit=None):
    rows = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue  # the line being written right now
                if limit and len(rows) >= limit:
                    break
    except OSError:
        return []
    return rows


def first_row(path):
    rows = read_jsonl(path, 1)
    return rows[0] if rows else {}


# ---- DSH logs: plain or zstd, through dshlog.py (bridge/contrib/hooks, shared with the hooks and the wiki export).
# Installed next to this script (<data_dir>/tools); in a checkout it is in ../hooks. Loaded on first use, so the
# other CLIs' bots never need it.
_DSHLOG = []


def dshlog():
    if not _DSHLOG:
        import importlib.util
        here = os.path.dirname(os.path.abspath(__file__))
        for p in (os.path.join(here, "dshlog.py"), os.path.join(os.path.dirname(here), "hooks", "dshlog.py")):
            if os.path.isfile(p):
                spec = importlib.util.spec_from_file_location("dshlog", p)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                _DSHLOG.append(mod)
                break
        else:
            raise FileNotFoundError(f"dshlog.py not found next to {here} (reinstall the tools: cc-connect setup tools)")
    return _DSHLOG[0]


_DSH_ROWS = {}  # (path, mtime, size) -> rows: a bot's steps and turn state read one log, decoded once


def dsh_rows(path, head=False):
    try:
        st = os.stat(path)
        key = (path, head, st.st_mtime_ns, st.st_size)
    except OSError:
        return []
    if key in _DSH_ROWS:
        return _DSH_ROWS[key]
    rows = []
    for line in dshlog().read_lines(path, head=head):
        try:
            r = json.loads(line)
        except ValueError:
            continue  # the line being written right now
        if isinstance(r, dict):
            rows.append(r)
    _DSH_ROWS.clear()
    _DSH_ROWS[key] = rows
    return rows


def dsh_first_row(path):
    rows = dsh_rows(path, head=True)
    return rows[0] if rows else {}


def dump(obj):
    return json.dumps(obj, ensure_ascii=False)[:ARG_CHARS]


# ---- per-CLI session logs ----

def claude_dir(bot):
    base = bot["env"].get("CLAUDE_CONFIG_DIR") or os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(HOME, ".claude")
    return os.path.join(os.path.expanduser(base), "projects", re.sub(r"[^A-Za-z0-9]", "-", bot["work_dir"]))


def claude_steps(path):
    calls, done, out = {}, {}, []
    for r in read_jsonl(path):
        c = (r.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        t = iso_ts(r.get("timestamp"))
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                calls[b.get("id")] = (t, b.get("name") or "tool", b.get("input") or {})
            elif b.get("type") == "tool_result":
                done[b.get("tool_use_id")] = t
    for cid, (t, name, inp) in calls.items():
        arg = ""
        if isinstance(inp, dict):
            arg = inp.get("command") or inp.get("file_path") or inp.get("description") or inp.get("prompt") or dump(inp)
        end = done.get(cid)
        out.append((t, (end - t) if (end and t) else None, name, arg))
    out.sort(key=lambda x: x[0] or 0)
    return out


def dsh_steps(path):
    calls, done, out = {}, {}, []
    for r in dsh_rows(path):
        t = r.get("time")
        t = t / 1000 if isinstance(t, (int, float)) else None
        d = r.get("data") or {}
        if r.get("type") == "tool/call":
            try:
                a = json.loads(d.get("arguments") or "{}")
            except ValueError:
                a = {}
            arg = a.get("command") or a.get("file_path") or a.get("path") or a.get("url") or dump(a)
            calls[d.get("callId")] = (t, d.get("name") or "tool", arg)
        elif r.get("type") == "tool/result":
            done[(d.get("message") or {}).get("toolCallId") or d.get("toolCallId")] = t
    for cid, (t, name, arg) in calls.items():
        end = done.get(cid)
        out.append((t, (end - t) if (end and t) else None, name, arg))
    out.sort(key=lambda x: x[0] or 0)
    return out


def dsh_turn(path):
    """(last turn still open, last activity, turn start)."""
    started = last = None
    open_ = False
    for r in dsh_rows(path):
        t = r.get("time")
        t = t / 1000 if isinstance(t, (int, float)) else None
        if r.get("type") == "turn/start":
            started, open_ = t, True
        elif r.get("type") in ("turn/end", "turn/complete"):
            open_ = False
        if t:
            last = t
    return open_, last, started


def codex_steps(path):
    calls, done, out = {}, {}, []
    for r in read_jsonl(path):
        p = r.get("payload") or {}
        t = iso_ts(r.get("timestamp"))
        ty = p.get("type")
        if ty in ("function_call", "custom_tool_call", "local_shell_call"):
            arg = p.get("arguments") or p.get("input") or ""
            if isinstance(arg, str) and arg.strip().startswith("{"):
                try:
                    a = json.loads(arg)
                    arg = a.get("command") or a.get("cmd") or arg
                    if isinstance(arg, list):
                        arg = " ".join(map(str, arg))
                except ValueError:
                    pass
            calls[p.get("call_id") or p.get("id")] = (t, p.get("name") or "tool", arg)
        elif ty in ("function_call_output", "custom_tool_call_output", "local_shell_call_output"):
            done[p.get("call_id")] = t
    for cid, (t, name, arg) in calls.items():
        end = done.get(cid)
        out.append((t, (end - t) if (end and t) else None, name, arg))
    out.sort(key=lambda x: x[0] or 0)
    return out


def session_for(bot):
    k, wd = bot["kind"], bot["work_dir"]
    if not wd and k in ("claudecode", "codex", "dsh"):
        return None
    if k == "claudecode":
        return newest(glob.glob(os.path.join(claude_dir(bot), "*.jsonl")))
    if k == "codex":
        base = bot["env"].get("CODEX_HOME") or os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
        fs = glob.glob(os.path.join(os.path.expanduser(base), "sessions", "**", "rollout-*.jsonl"), recursive=True)
        for p in sorted(fs, key=os.path.getmtime, reverse=True):  # newest first; the first one started in this work_dir
            if (first_row(p).get("payload") or {}).get("cwd") == wd:
                return p
        return None
    if k == "dsh":
        fs = [p for p in dshlog().session_logs(dsh_home(bot["opts"])) if os.path.exists(p)]
        for p in sorted(fs, key=os.path.getmtime, reverse=True):  # newest first: a .zstd head may cost a node run
            if dsh_first_row(p).get("cwd") == wd:
                return p
        return None
    if k == "antigravity":
        return newest(glob.glob(os.path.join(HOME, ".gemini", "antigravity-cli", "conversations", "*.db")))
    return None


STEPS = {"claudecode": claude_steps, "codex": codex_steps, "dsh": dsh_steps}


def summarize(bot):
    name, k = bot["label"], bot["kind"]
    if k not in STEPS and k != "antigravity":
        return f"[{name}] {k}: not supported yet"
    p = session_for(bot)
    if not p:
        return f"[{name}] no session log found"
    if k == "antigravity":
        return f"[{name}] conversation file written {ago(os.path.getmtime(p))} (no step details for {k})"
    steps = STEPS[k](p)
    if not steps:
        return f"[{name}] no tool calls in the newest session yet (written {ago(os.path.getmtime(p))})"
    state = ""
    if k == "dsh":
        open_, last, _ = dsh_turn(p)
        if open_:
            state = ", turn still running" if (last and time.time() - last < OPEN_TURN_SECS) else ", turn never closed"
    last = steps[-1]
    tail = " | ".join(short(first_line(s[3]), TAIL_CHARS) for s in steps[-2:])
    return f"[{name}] last action {ago(last[0]) if last[0] else '?'}{state} | last two: {tail}"


def detail(bot, n):
    name, k = bot["label"], bot["kind"]
    p = session_for(bot)
    if not p:
        print(f"{name}: no session log found" + ("" if k in STEPS or k == "antigravity" else f" ({k} not supported yet)"))
        return
    print(f"== {name} ({k}) {p}")
    if k not in STEPS:
        print(f"last written {ago(os.path.getmtime(p))} (no step details for {k})")
        return
    if k == "dsh":
        open_, last, started = dsh_turn(p)
        span = f", this turn has run {int((last - started) / 60)} min" if (started and last) else ""
        print("current turn:", "running" if open_ else "finished", "| last activity", (ago(last) if last else "?") + span)
    for t, dur, tool, arg in STEPS[k](p)[-n:]:
        d = f"{dur:6.1f}s" if isinstance(dur, (int, float)) else "     - "
        print(f"{hm(t) if t else '--:--:--'} {d}  {tool:10s} {short(first_line(arg))}")


def main(argv):
    args, n, cfg = list(argv), DEFAULT_STEPS, None
    if "-h" in args or "--help" in args:
        print(__doc__)
        return 0
    for flag in ("-n", "--config"):
        if flag in args:
            i = args.index(flag)
            if i + 1 >= len(args):
                print(f"{flag} needs a value", file=sys.stderr)
                return 2
            v = args[i + 1]
            del args[i:i + 2]
            if flag == "-n":
                try:
                    n = int(v)
                except ValueError:
                    print("-n needs a number", file=sys.stderr)
                    return 2
            else:
                cfg = v
    path = config_path(cfg)
    if not path:
        print("no cc-connect config.toml found (pass --config <file> or set CC_CONNECT_CONFIG)", file=sys.stderr)
        return 2
    bots = load_bots(path)
    if not bots:
        print(f"{path} has no [[projects]]", file=sys.stderr)
        return 2
    if args:
        bot = find_bot(bots, args[0])
        if not bot:
            names = " / ".join(b["label"] if b["label"] == b["name"] else f"{b['label']} ({b['name']})" for b in bots)
            print(f"no bot called {args[0]!r}; bots: {names}", file=sys.stderr)
            return 2
        detail(bot, n)
    else:
        for b in bots:
            print(summarize(b))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
