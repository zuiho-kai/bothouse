"""What the user said on Discord and on the cloud_web hub in a time window, read from each by sender (read only).

The one source of the user's words for dream / reflect quotes from bridged sessions (reviewed plans
~/.claude/reviews/dream-quote-source.md and dream-quote-window.md, user 2026-10-23「怎么好像同一个问题错了五六次啊」):
every message whose author id is the user's, in every channel the bots can see (DMs included), within [lo, hi).
No session → channel mapping: a session's transcript is context only and never decides which line is the user's.

  user_id()          the user's Discord id: admin_from, else the first allow_from id, in the bridge config (CONFIG)
  said(lo, hi)       [Msg] the user's messages in [lo, hi), oldest first, across all channels and cloud_web rooms
  cloud_said(lo, hi) [Msg] the cloud_web part: hub messages whose author_kind is "user" (see below)

Channels are listed by the API, not by hand (review dream-quote-window.md「频道列表自动列出，含私聊」): each bot's
guilds → their channels, active threads and archived threads, plus each bot's DM with the user. Which bots: the
wiki's own bot for a sub's wiki (her channels and her DM are where the user talks to her), every bot for the main
wiki (the main wiki's dream/reflect covers the whole team; user 2026-10-23「用户说过的话一条都不能丢」).

The bridge config: ~/.bothouse/config.toml (open-source bothouse, since 2026-10-28 11:59; im-bridge 073ea354), else
the old ~/.cc-connect/config.toml; WIKI_BRIDGE_CONFIG (a file) or WIKI_CC_CONNECT (its directory) override. None
readable: Unavailable, never a crash (2026-10-28: ~/.cc-connect gone, every ingest batch died in page_checks).
Tokens: a platform's `token = "..."` in it, either the token itself (bothouse) or `"${VAR}"` (cc-connect), VAR from
the environment or secrets.env next to the config; never logged. Fetching reuses
~/im-bridge/bin/channel-page.py fetch()/get().
"""
import json, os, re, time, urllib.parse, urllib.request
from types import SimpleNamespace
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path

def _config_path():
    if os.environ.get("WIKI_BRIDGE_CONFIG"):
        return Path(os.path.expanduser(os.environ["WIKI_BRIDGE_CONFIG"]))
    if os.environ.get("WIKI_CC_CONNECT"):
        return Path(os.path.expanduser(os.environ["WIKI_CC_CONNECT"])) / "config.toml"
    for d in ("~/.bothouse", "~/.cc-connect"):
        if (p := Path(os.path.expanduser(d)) / "config.toml").exists():
            return p
    return Path(os.path.expanduser("~/.bothouse/config.toml"))


CONFIG = _config_path()  # secrets.env (cc-connect's `${VAR}` tokens) sits next to it
API = "https://discord.com/api/v10"
DISCORD_EPOCH = 1420070400000
FORWARD = "（转发）"
IMAGE = "（图片）"  # the user sent only image(s) (reviewed plan: 「用“（图片）”一类的占位记下」)
FILE = "（附件）"  # only other attachments
EMPTY = "（空消息）"  # no text, no attachment (sticker, embed)
# a bridge command (「/compact」「/new」), not the user's words (派活 2026-10-23「斜杠命令（如 /compact）不算用户原话」).
# A whitelist, not any 「/word」 (派活 2026-10-23「斜杠命令改用白名单…"/tmp 下面有啥" 这类不能丢」): cc-connect's
# builtinCommands names (~/code/cc-connect core/engine.go:6804-6849), matched like its matchPrefix() (core/engine.go:6886,
# exact name, else the one command an unambiguous prefix names). Left out: 「ps」/「btw」 (core/engine.go:6849): their
# text goes into the running turn, so it is the user's words. An unknown 「/x」 falls through to the agent
# (core/engine.go:7129-7131) and is the user's words too; config.toml defines no custom commands.
COMMANDS = {
    "new": ["new"], "list": ["list", "sessions"], "switch": ["switch"], "name": ["name", "rename"],
    "current": ["current"], "status": ["status"], "usage": ["usage", "quota"], "history": ["history"],
    "allow": ["allow"], "model": ["model"], "reasoning": ["reasoning", "effort"], "mode": ["mode"], "lang": ["lang"],
    "quiet": ["quiet"], "provider": ["provider"], "memory": ["memory"], "cron": ["cron"],
    "timer": ["timer", "at", "remind"], "heartbeat": ["heartbeat", "hb"], "compress": ["compress", "compact"],
    "stop": ["stop"], "cancel": ["cancel"], "help": ["help"], "version": ["version"],
    "commands": ["commands", "command", "cmd"], "skills": ["skills", "skill"], "config": ["config"],
    "doctor": ["doctor"], "upgrade": ["upgrade", "update"], "restart": ["restart"], "alias": ["alias"],
    "delete": ["delete", "del", "rm"], "bind": ["bind"], "search": ["search", "find"],
    "shell": ["shell", "sh", "exec", "run"], "show": ["show"], "dir": ["dir", "cd", "chdir", "workdir"],
    "tts": ["tts"], "workspace": ["workspace", "ws"], "whoami": ["whoami", "myid"], "web": ["web"], "diff": ["diff"],
    "ps": ["ps", "btw"],
}
CARRIES_TEXT = {"ps"}  # 「/btw …」: words for the turn in flight
# Discord message types (API docs, Message Types) that a person typed: 0 DEFAULT, 19 REPLY. Pins, thread
# creations, joins and the like are system messages, not the user's words (派活 2026-10-23).
TYPED = {0, 19}
# Discord channel types (API docs, Channel Types): 4 category and 15/16 forum/media hold no messages of their own
NO_MESSAGES = {4, 15, 16}
THREAD_PARENTS = {0, 5, 15, 16}  # text, announcement, forum, media: the channel types that have threads

Msg = namedtuple("Msg", "ts channel name text")  # unix ts, channel id, 「#name」 or 「私聊·<bot>」, the user's text


class Forbidden(Exception):
    """This bot may not read the channel (403); another bot may (said() tries the next token)."""


class Unavailable(Exception):
    """Discord history can't be read (no token, network): the caller must not treat the window as quote-free."""


GONE = set()  # channels skipped while listing/fetching: deleted (404) or unreadable (403); the caller logs them


def _config():
    try:
        return CONFIG.read_text()
    except OSError as e:  # no bridge on this machine (or moved): no history, not a crash
        raise Unavailable(f"no bridge config {CONFIG}: {type(e).__name__}") from None


def user_id():
    """admin_from (cc-connect), else the first allow_from id (bothouse has only allow_from)."""
    text = _config()
    for key in ("admin_from", "allow_from"):
        if m := re.search(rf'(?m)^\s*{key}\s*=\s*"(\d+)', text):
            return m.group(1)
    raise Unavailable("no admin_from / allow_from in config.toml")


def bot_tokens():
    """{team_name: token ref} of each project's discord platform token: `${VAR}` or the token itself (_token)."""
    out, team, platform = {}, None, None
    for line in _config().splitlines():
        s = line.strip()
        if s == "[[projects]]":
            team, platform = None, None
        elif s == "[[projects.platforms]]":
            platform = None
        elif m := re.match(r'team_name\s*=\s*"([^"]+)"', s):
            team = m[1]
        elif m := re.match(r'type\s*=\s*"([^"]+)"', s):
            platform = m[1]
        elif (m := re.match(r'token\s*=\s*"([^"]+)"', s)) and platform == "discord" and team:
            out[team] = m[1]
    return out


def _secret(var):
    t = os.environ.get(var)
    if t:
        return t
    try:
        for line in (CONFIG.parent / "secrets.env").read_text().splitlines():
            if line.startswith(var + "="):
                return line.split("=", 1)[1].strip().strip('"\'')
    except OSError:
        pass
    raise Unavailable(f"no {var}")


def _token(ref):
    """A config token value: `${VAR}` names a secret (_secret), anything else is the token itself."""
    m = re.fullmatch(r"\$\{(\w+)\}", ref)
    return _secret(m[1]) if m else ref


def tokens(assistant, main):
    """The tokens whose channels hold what the user said to `assistant`: all bots' for the main wiki, else hers."""
    bots = bot_tokens()
    names = list(bots) if main else [assistant]
    if not main and assistant not in bots:
        raise Unavailable(f"no discord bot for {assistant} in config.toml")
    return [_token(bots[n]) for n in names]


def _page():
    def get(url, tok):
        req = urllib.request.Request(url, headers={"Authorization": f"Bot {tok}", "User-Agent": "bothouse-wiki/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    return SimpleNamespace(get=get)


def _get(path, tok, data=None):
    if data is None:
        return _page().get(API + path, tok)
    payload = json.dumps(data).encode()
    req = urllib.request.Request(API + path, data=payload, method="POST",
                                 headers={"Authorization": f"Bot {tok}", "User-Agent": "bothouse-wiki/1.0",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def _snow_ts(sid):
    return ((int(sid) >> 22) + DISCORD_EPOCH) / 1000


def _skippable(e):
    return getattr(e, "code", None) in (403, 404)  # 403 the bot can't read it, 404 deleted: no history to read


def channels(tok, uid, lo):
    """[(id, label)] every channel this bot can read that may hold a message at or after `lo`."""
    out = []
    try:
        me = _get("/users/@me", tok)
        dm = _get("/users/@me/channels", tok, {"recipient_id": uid})
        out.append((dm["id"], f"私聊·{me.get('username', '?')}"))
        for g in _get("/users/@me/guilds", tok):
            chans = _get(f"/guilds/{g['id']}/channels", tok)
            threads = _get(f"/guilds/{g['id']}/threads/active", tok).get("threads", [])
            for c in chans:
                if c.get("type") in THREAD_PARENTS:
                    for kind in ("public", "private"):
                        threads += archived(c["id"], kind, tok, lo)
            for c in chans + threads:
                if c.get("type") in NO_MESSAGES:
                    continue
                last = c.get("last_message_id")
                if not last or _snow_ts(last) < lo:
                    continue  # nothing posted since `lo`
                out.append((c["id"], "#" + (c.get("name") or c["id"])))
    except Unavailable:
        raise
    except Exception as e:  # noqa: BLE001 — urllib/HTTP errors: no listing, not "the user said nothing"
        raise Unavailable(f"listing channels: {type(e).__name__} {getattr(e, 'code', '')}") from None
    return out


def archived(channel, kind, tok, lo):
    """The channel's `kind` (public/private) threads archived at or after `lo`, every page (API docs, List Public
    Archived Threads: newest archived first, at most 100 a page, `before` an ISO timestamp, `has_more`)."""
    out, before = [], ""
    # private: the ones the bot joined (List Joined Private Archived Threads); the channel-wide list needs
    # MANAGE_THREADS, which a bot without it gets 403 for (派活 2026-10-23「私有归档帖子改走 …/users/@me/…」)
    path = f"/channels/{channel}/users/@me/threads/archived/private" if kind == "private" else \
        f"/channels/{channel}/threads/archived/{kind}"
    while True:
        try:
            got = _get(f"{path}?limit=100{before}", tok)
        except Exception as e:  # noqa: BLE001
            if _skippable(e):
                GONE.add(f"archived-{kind}:{channel}")  # logged by the caller: not silently "no threads"
                return out
            raise
        page = got.get("threads", [])
        stamps = [(t.get("thread_metadata") or {}).get("archive_timestamp") for t in page]
        out += [t for t, a in zip(page, stamps) if _iso(a) >= lo]
        # newest archived first: once a thread was archived before `lo`, the rest were too
        if not got.get("has_more") or not page or not stamps[-1] or _iso(stamps[-1]) < lo:
            return out
        before = "&before=" + urllib.parse.quote(stamps[-1])


def _iso(s):
    if not s:
        return 0.0
    # Go/Discord write 1–9 fraction digits; fromisoformat before 3.11 takes only 3 or 6
    s = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], s.replace("Z", "+00:00"), count=1)
    return datetime.fromisoformat(s).timestamp()


def text_of(m):
    """The message's words; a forward (message_snapshots, API docs Message Snapshot Object) is someone else's
    words, so it is only marked （转发）, never quoted as the user's; only attachments → （图片）/（附件）."""
    t = (m.get("content") or "").strip()
    if t:
        return t
    att = m.get("attachments") or []
    if not att:
        if m.get("message_snapshots"):
            return FORWARD
    if any((a.get("content_type") or "").startswith("image/") for a in att):
        return IMAGE
    return FILE if att else EMPTY


def _command(word):
    """cc-connect matchPrefix(): the command id an exact name or an unambiguous prefix names, else ""."""
    for cid, names in COMMANDS.items():
        if word in names:
            return cid
    hits = {cid for cid, names in COMMANDS.items() if any(n.startswith(word) for n in names)}
    return hits.pop() if len(hits) == 1 else ""


def is_command(text):
    """A cc-connect builtin command line (handleCommand lower-cases the first word, core/engine.go:6968)."""
    if not text.startswith("/"):
        return False
    word = text[1:].split(None, 1)[0].lower() if text[1:].strip() else ""
    cid = _command(word) if word and "/" not in word else ""
    return bool(cid) and cid not in CARRIES_TEXT


def history(channel, lo, hi, tok):
    """The channel's messages in [lo, hi); a deleted channel is empty (in GONE); one this bot may not read raises
    Forbidden (said() tries the other bots)."""
    try:
        return _page().fetch(channel, datetime.fromtimestamp(lo, timezone.utc), datetime.fromtimestamp(hi, timezone.utc), tok)
    except Exception as e:  # noqa: BLE001
        if getattr(e, "code", None) == 403:
            raise Forbidden(channel) from None
        if _skippable(e):
            GONE.add(channel)
            return []
        raise Unavailable(f"channel {channel}: {type(e).__name__} {getattr(e, 'code', '')}") from None


_LISTED, _HISTORY = {}, {}  # one process (a night run) lists each bot's channels and reads each channel once


def _listed(tok, uid, lo, hi=None):
    """channels(), cached while the listing covers [lo, hi]: listed from no later a start, and at or after `hi` (a
    channel or thread that got its first message after the listing isn't in it; demo: dream lists, reflect hours
    later must list again)."""
    hi = time.time() if hi is None else hi
    have = _LISTED.get(tok)
    if not have or have[0] > lo or have[1] < hi:
        at = time.time()
        _LISTED[tok] = have = (lo, at, channels(tok, uid, lo))
    return have[2]


def _history(channel, lo, hi, tok):
    have = _HISTORY.get((channel, tok))
    if not have or have[0] > lo or have[1] < hi:
        if have:
            lo, hi = min(lo, have[0]), max(hi, have[1])
        _HISTORY[(channel, tok)] = have = (lo, hi, history(channel, lo, hi, tok))
    return have[2]


# ── cloud_web: the role-household hub (~/code/role-household/rh/hub.py), the other place the user talks to the bots.
# Its messages table stores the sender of every message (author_kind "user" = the person at the web page or the
# voice host; "role" a bot; "system"), so the user's words there are read the same way: by sender, in [lo, hi).
# Rooms are listed with the hub's web token (GET /api/rooms?archived=1 takes only it, rh/hub.py make_app auth);
# messages are paged with the bot token cc-connect's cloud_web uses (GET /api/rooms/{room}/messages?before=&limit=,
# oldest first, `has_more`; conest bridge/platform/cloud-web/history.go reads it the same way).
HUB_WEB_TOKEN = "RH_HUB_TOKEN"  # the hub's web token in secrets.env next to the config (bothouse 2026-10-28: no cloud_web) (wiki conest/role-household-conest-sync-current.md)
HUB_PAGE = 200  # rh/hub.py HISTORY_LIMIT: the most one page returns


def hubs(assistant, main):
    """{hub http origin: bot token ref (_token)} of the cloud_web platforms of the projects whose words count (all for
    the main wiki, else hers). Origin from ws_url like history.go historyBaseURL: wss → https, ws → http."""
    out, team, platform, opts = {}, None, None, {}
    def flush():
        if platform == "cloud_web" and team and (main or team == assistant) and opts.get("ws_url") and opts.get("token"):
            u = urllib.parse.urlparse(opts["ws_url"])
            scheme = {"wss": "https", "ws": "http"}.get(u.scheme)
            if scheme and u.netloc:
                out.setdefault(f"{scheme}://{u.netloc}", opts["token"])
    for line in _config().splitlines():
        s = line.strip()
        if s in ("[[projects]]", "[[projects.platforms]]"):
            flush()
            platform, opts = None, {}
            if s == "[[projects]]":
                team = None
        elif m := re.match(r'team_name\s*=\s*"([^"]+)"', s):
            team = m[1]
        elif m := re.match(r'type\s*=\s*"([^"]+)"', s):
            platform = m[1]
        elif m := re.match(r'ws_url\s*=\s*"([^"]+)"', s):
            opts["ws_url"] = m[1]
        elif m := re.match(r'token\s*=\s*"([^"]+)"', s):
            opts["token"] = m[1]
    flush()
    return out


def _hub_get(url, tok):
    import json, urllib.request
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=20) as r:  # 20 s: history.go historyTimeout
        return json.loads(r.read())


def cloud_said(lo, hi, assistant, main, get=None):
    """[Msg] the user's own messages (author_kind "user") on the cloud_web hub(s) in [lo, hi), every room including
    archived ones. `get(url, tok)` is injectable (tests). Any failure is Unavailable, as for Discord."""
    get = get or _hub_get
    out = []
    for base, botvar in hubs(assistant, main).items():
        try:
            web, bot = _secret(HUB_WEB_TOKEN), _token(botvar)
            for room in get(f"{base}/api/rooms?archived=1", web):
                before = ""
                while True:
                    try:
                        page = get(f"{base}/api/rooms/{room['id']}/messages?limit={HUB_PAGE}{before}", bot)
                    except Exception as e:  # noqa: BLE001
                        if _skippable(e):
                            GONE.add(f"cloud:{room['id']}")
                            break
                        raise
                    msgs = page.get("messages", [])
                    for m in msgs:
                        ts = float(m.get("created_at") or 0)
                        if m.get("author_kind") != "user" or not (lo <= ts < hi):
                            continue
                        # the hub stores text only (rh/hub.py:149-162 has no attachment column); attachments, if
                        # a later hub sends them, are marked like Discord's
                        text = text_of({"content": m.get("text"), "attachments": m.get("attachments")})
                        if not is_command(text):
                            out.append(Msg(ts, f"cloud:{room['id']}", f"云端·{room.get('name') or room['id']}", text))
                    if not page.get("has_more") or not msgs or float(msgs[0].get("created_at") or 0) < lo:
                        break  # oldest first: the page's first message is its oldest
                    before = f"&before={msgs[0]['id']}"
        except Unavailable:
            raise
        except Exception as e:  # noqa: BLE001 — no listing/page: not "the user said nothing there"
            raise Unavailable(f"cloud_web {base}: {type(e).__name__} {getattr(e, 'code', '')}") from None
    return out


def said(lo, hi, assistant, main, list_channels=None, fetch=None, cloud=None):
    """The user's own messages in [lo, hi) across every Discord channel (DMs included) and every cloud_web room,
    oldest first. `list_channels(tok, uid, lo)`, `fetch(channel, lo, hi, tok)` and `cloud(lo, hi, assistant, main)`
    are injectable (tests)."""
    uid, out = user_id(), (cloud or cloud_said)(lo, hi, assistant, main)
    toks = tokens(assistant, main)
    listing = list_channels or (lambda tok, uid_, lo_: _listed(tok, uid_, lo_, hi))
    found = {}  # channel → (label, the bots that list it first, then the rest): a channel every bot sees is read once
    for tok in toks:
        for ch, label in listing(tok, uid, lo):
            found.setdefault(ch, (label, []))[1].append(tok)
    for ch, (label, first) in found.items():
        msgs = None
        for tok in first + [t for t in toks if t not in first]:
            try:
                msgs = (fetch or _history)(ch, lo, hi, tok)
                break
            except Forbidden:
                continue  # this bot may not read it: try the next one (one bot's 403 is not the channel's)
        if msgs is None:
            GONE.add(ch)  # every bot got 403: logged by the caller
            continue
        for m in msgs:
            ts = _iso(m["timestamp"])
            if not (lo <= ts < hi) or (m.get("author") or {}).get("id") != uid or m.get("type", 0) not in TYPED:
                continue
            text = text_of(m)
            if is_command(text):
                continue
            out.append(Msg(ts, ch, label, text))
    out.sort()
    return out
