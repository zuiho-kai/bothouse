"""Project the local Bothouse role snapshot to one owner's Little Worlds connection."""
import argparse
import base64
import getpass
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import runpy
import socket
import sys
import time
import tomllib
import unicodedata
from urllib.parse import parse_qs, quote, urlsplit

# Both python -I and the shared Windows host load the exact installed sibling.
portraits = runpy.run_path(str(Path(__file__).resolve().with_name("resident_portraits.py")))

LIMIT = 4 * 1024 * 1024
SLUG = re.compile(r"[-a-z0-9_]{1,64}")
ACTIVITIES = {"idle": "idle", "working": "working", "thinking": "thinking", "speech": "talking"}

# Family pairs from Bothouse dsh/packages/client-ui-discord/src/client/avatars.ts
# (AVATAR_SETS). Match management metadata, never the displayed name.
BRANDS = {"brand-claude": "orange", "brand-openai": "dragon", "brand-deepseek": "whale",
          "brand-gemini": "rainbow", "brand-grok": "grok", "brand-minimax": "lanxi"}
AGENTS = {"claude": "orange", "claudecode": "orange", "codex": "dragon",
          "deepseek": "whale", "gemini": "rainbow", "antigravity": "rainbow",
          "grok": "grok", "minimax": "lanxi"}


def role_looks(rows):
    looks = {}
    for row in rows:
        name = row.get("name")
        source = row.get("source") or "bridge"
        if not isinstance(name, str) or source not in ("bridge", "dsh"):
            continue
        if source == "dsh" and not name.startswith("dsh:"):
            continue
        key = (source, name[4:] if source == "dsh" else name)
        model = str(row.get("model") or "").lower()
        match = re.fullmatch(r"(?:(?:anthropic|openai|deepseek|google|xai|minimax)/)?"
                             r"(claude|gpt|codex|o[134]|deepseek|gemini|grok|minimax)(?:[-.:][a-z0-9.-]+)?", model)
        if match:
            family = match[1]
            look = "dragon" if family in ("gpt", "o1", "o3", "o4") else AGENTS[family]
        else:
            # Management also emits 'dsh' for external bots with unknown CLI.
            look = AGENTS.get(row.get("agent_type"), "default")
        looks[key] = look if key not in looks or looks[key] == look else "default"
    return looks


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def finalize_looks(wire):
    for row in wire["residents"]:
        inferred = row.pop("_builtin", None)
        if inferred is not None:
            row["appearanceKey"] = inferred
            continue
        explicit = row["appearanceKey"]
        if explicit in BRANDS or explicit in BRANDS.values():
            row["appearanceKey"] = BRANDS.get(explicit, explicit)
            # A known built-in remains drawable without a library pack. An
            # approved replacement retains its descriptor and wins on screen.
            if row.get("portrait") is None:
                row.pop("portrait", None)


def origin(value, local=False):
    u = urlsplit(value)
    loop = u.hostname in ("127.0.0.1", "::1", "localhost")
    if (u.path not in ("", "/") or u.query or u.fragment or u.username or u.password or
            not u.hostname or (local and not loop) or
            not (u.scheme == "https" or (u.scheme == "http" and loop))):
        raise ValueError("Use an HTTPS origin or a local loopback origin.")
    return u


class HTTPStatusError(ConnectionError):
    def __init__(self, status):
        super().__init__(f"HTTP {status}")
        self.status = status


def request(base, path, headers, payload=None, snapshot=False):
    connection = (http.client.HTTPSConnection if base.scheme == "https" else
                  http.client.HTTPConnection)(base.hostname, base.port, timeout=5)
    try:
        connection.request("GET" if payload is None else "POST", path,
                           body=None if payload is None else json.dumps(payload).encode(), headers=headers)
        res = connection.getresponse()
        if res.status != 200:
            raise HTTPStatusError(res.status)
        if snapshot:
            # The upstream opens the SSE stream with an aggregate snapshot. Stop
            # at its first frame, before speech text or room events.
            size = 0
            event = None
            lines = []
            while size <= LIMIT:
                line = res.readline(LIMIT + 1 - size)
                size += len(line)
                if not line or size > LIMIT:
                    break
                line = line.rstrip(b"\r\n")
                if not line and event == b"snapshot":
                    return json.loads(b"\n".join(lines))
                if line.startswith(b"event:"):
                    event = line[6:].strip()
                elif line.startswith(b"data:"):
                    lines.append(line[5:].lstrip())
            raise ValueError("No bounded role snapshot.")
        raw = res.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError("Response too large.")
        return json.loads(raw)
    finally:
        connection.close()


# Same public-key fingerprint and role-number derivation as Agent Arcade's
# social/server/bothouse/instance.py. No private signing key is used.
def fingerprint(data_dir):
    try:
        line = (data_dir / "identity" / "signing.pub").read_text().strip()
    except FileNotFoundError:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(3)
            sock.connect(str(data_dir / "run" / "identity.sock"))
            conn = http.client.HTTPConnection("localhost", timeout=3)
            conn.sock = sock
            try:
                conn.request("GET", "/identity/pubkey")
                response = conn.getresponse()
                if response.status != 200:
                    raise ValueError("Instance identity unavailable.")
                line = json.loads(response.read(4096))["pubkey"]
            finally:
                conn.close()
    prefix, public = line.split()
    if prefix != "bothouse-ed25519" or len(base64.b64decode(public, validate=True)) != 32:
        raise ValueError("Invalid instance public key.")
    return digest(public)


def native_dsh_profiles(base, headers, data_dir):
    """Read the native member's selected built-in look through Bothouse Channels."""
    local_host = None
    home = Path.home()
    default_data_dirs = (home / ".bothouse", home / ".cc-connect")
    collab_dir = home / ".conest-collab" if data_dir.resolve() in default_data_dirs else data_dir / "conest-collab"
    record = Path(os.getenv("CONEST_COLLAB_DATA") or collab_dir) / "collab.owner.json"
    try:
        try:
            with record.open("rb") as stream:
                raw = stream.read(4097)
        except FileNotFoundError:
            # Web-only Channels uses the management panel's existing owner proxy.
            state = request(base, "/dsh/collab/api/state", headers)
        else:
            if len(raw) > 4096:
                return None, {}
            owner = json.loads(raw)["local"]
            site = origin(owner["origin"], local=True)
            token = owner["token"]
            if (site.scheme != "http" or not ipaddress.ip_address(site.hostname).is_loopback or
                    not site.port or not isinstance(token, str) or not token.isascii() or
                    not token.isprintable() or not token.strip()):
                return None, {}
            local_host = site.netloc
            state = request(site, "/collab/api/state", {"X-Collab-Local": token})
        return local_host, {row["id"]: (row.get("avatar") or "") for row in state["members"]
                if isinstance(row, dict) and row.get("kind") == "dsh" and isinstance(row.get("id"), str)}
    except (OSError, ValueError, TypeError, KeyError, http.client.HTTPException):
        return None, {}


def bound_busy_members(cfg, host, engines):
    """Recognize only the native member's own active Cloud Web transport."""
    bound = set()
    if not host or not engines:
        return bound
    for project in cfg.get("projects", []):
        name = project.get("name")
        if project.get("disabled") or name not in engines:
            continue
        channels = [p for p in project.get("platforms", []) if p.get("type") == "cloud_web"]
        if len(channels) != 1 or channels[0].get("disabled"):
            continue
        opts = channels[0].get("options", {})
        try:
            url = urlsplit(opts.get("ws_url", ""))
            if (url.scheme == "ws" and url.netloc == host and url.path == "/cloud-web/ws"
                    and not url.fragment and parse_qs(url.query).get("bot") == [name]
                    and (opts.get("name") or "cloud_web") in engines[name]):
                bound.add(name)
        except (TypeError, ValueError):
            continue
    return bound


def read_portrait_approvals(config):
    # Optional per-config grants; a missing or partially edited file grants nothing.
    try:
        with config.with_suffix(".resident-portraits.json").open("rb") as stream:
            raw = stream.read(1_048_577)
        if len(raw) <= 1_048_576:
            rows = json.loads(raw)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    except (OSError, ValueError):
        pass
    return []


def project_snapshot(cfg_file, selected, friends=None):
    with cfg_file.open("rb") as f:
        cfg = tomllib.load(f)
    mgmt = cfg["management"]
    if not mgmt.get("enabled") or not mgmt.get("token"):
        raise ValueError("Local management unavailable.")
    data_dir = Path(cfg.get("data_dir") or cfg_file.parent).expanduser()
    if not data_dir.is_absolute():
        raise ValueError("Absolute instance data directory required.")
    instance = fingerprint(data_dir)
    base = origin("http://127.0.0.1:" + str(mgmt.get("port") or 9820))
    headers = {"Authorization": "Bearer " + mgmt["token"]}

    def get(path):
        value = request(base, "/api/v1/" + path, headers)
        if value.get("ok") is not True:
            raise ValueError("Bothouse directory unavailable.")
        return value["data"]

    permitted = None
    if callable(friends):
        # In the Friends service the verified account's existing directory is
        # read through a private process pipe. No login cookie leaves Friends.
        members = friends()
        if not isinstance(members, (list, set, frozenset, tuple)) or not all(
                isinstance(m, str) and re.fullmatch(r"bh_[a-f0-9]{21}", m) for m in members):
            raise ValueError("Expected authorized Bothouse resident IDs.")
        permitted = set(members)
        if not permitted:
            return {"instance": instance, "residents": []}
    elif friends:
        # Shared hosts supply the existing Friends session; never fall back to
        # the machine-wide directory when its account or consent disappears.
        site, account, cookie = friends
        h = {"Cookie": cookie}
        try:
            me = request(site, "/api/v1/me", h)["user"]["number"]
            if me != account:
                return {"instance": instance, "residents": []}
            contacts = request(site, "/api/v1/ai-contacts", h)["contacts"]
            permitted = {r["number"] for r in contacts if r.get("source") == "bothouse"}
        except (OSError, ValueError, KeyError, http.client.HTTPException):
            return {"instance": instance, "residents": []}
        if not permitted:
            return {"instance": instance, "residents": []}

    try:
        data = request(base, "/api/v1/roles/events", headers, snapshot=True)
    except (OSError, ValueError, http.client.HTTPException):
        if friends:
            return {"instance": instance, "residents": []}
        raise

    try:
        setup = get("setup/state").get("setup", {})
    except (OSError, ValueError, KeyError):
        setup = {}
    avatars = {}
    try:
        management_roles = get("roles").get("roles", [])
    except (OSError, ValueError, KeyError, http.client.HTTPException):
        management_roles = []
    inferred = role_looks(management_roles)
    # Friends issues a native number only after binding the roster member to the
    # local Cloud Web engine by instance, project ID and bot endpoint. That
    # number is checked below before projecting any engine activity.
    busy_engines = {row["name"]: {p.get("name") for p in row.get("platforms", []) if p.get("ready") is True}
                    for row in management_roles
                    if isinstance(row.get("name"), str) and row.get("source", "") in ("", "bridge")
                    and row.get("agent_type") == "dsh" and row.get("online") is True
                    and row.get("paused") is False and row.get("busy") is True}
    for key in ("team", "cloud_web_team"):
        for item in setup.get(key) or []:
            avatars.setdefault(item.get("project"), set()).add(item.get("avatar") or "")
    residents = []
    dsh_looks = None
    bound_busy = set()
    for role in data["roles"]:
        project = role["name"]
        source = role["source"]
        if source not in ("bridge", "dsh") or role.get("role_key") != source + ":" + project:
            continue
        if not project or len(project) > 256 or any(c in project for c in "/\\") or not project.isprintable():
            continue
        if selected and role["role_key"] not in selected and project not in selected:
            continue
        key = project if source == "bridge" else "dsh\0" + project
        if permitted is not None:
            if "bh_" + digest(instance + "\0" + key)[:21] not in permitted:
                continue
        elif source == "bridge":
            try:
                access = get("projects/" + quote(project, safe="") + "/users")
            except (OSError, ValueError, KeyError, http.client.HTTPException):
                continue
            if access.get("configured") is not False:
                # Explicit user ACLs require the already paired Friends host.
                continue
        display = "".join(c for c in (role.get("display_name") or project)
                          if unicodedata.category(c) != "Cc").strip()[:128] or "Bothouse AI"
        if re.search(r"(?:[A-Za-z]:[\\/]|\\\\|https?://|^/|^(?:sk-|ghp_|github_pat_|Bearer\s)\S{12,})", display, re.I):
            display = "Bothouse AI"
        options = avatars.get(project, set()) if source == "bridge" else set()
        look = next(iter(options)) if len(options) == 1 else "default"
        activity = ACTIVITIES.get(role.get("status"), "unknown")
        if role.get("online") is False:
            activity = "offline"
        elif role.get("online") is not True:
            activity = "unknown"
        residents.append(dict(source=source, project=project, displayName=display, appearanceKey=look if SLUG.fullmatch(look) else "default",
                              activity=activity))
        if source == "dsh":
            if dsh_looks is None:
                host, dsh_looks = native_dsh_profiles(base, headers, data_dir)
                if permitted is not None:
                    bound_busy = bound_busy_members(cfg, host, busy_engines)
            if activity == "idle" and project in dsh_looks and project in bound_busy:
                # Channels may have no team reader. Only project the engine busy bit.
                residents[-1]["activity"] = "working"
            avatar = dsh_looks.get(project)
            if isinstance(avatar, str) and avatar:
                look = BRANDS.get(avatar, avatar if avatar in BRANDS.values() else "default")
                residents[-1]["_builtin"] = look
                continue
        if not any(options):
            residents[-1]["_builtin"] = inferred.get((source, project), "default")
    return {"instance": instance, "residents": residents}


def publish(config, selected, friends, world, token, **options):
    return portraits["publish_current"](globals(), config, selected, friends, world, token,
                                       approvals=read_portrait_approvals(config), **options)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--world", required=True)
    ap.add_argument("--project", action="append", default=[])
    ap.add_argument("--friends-origin", help="Existing local shared Friends service")
    ap.add_argument("--friend-account", help="Account confirmed by the host session")
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()
    world = origin(args.world)
    friends = None
    if args.friends_origin or args.friend_account:
        if not args.friends_origin or not args.friend_account or not os.getenv("LITTLE_WORLDS_FRIENDS_COOKIE"):
            ap.error("Shared-host mode requires the bound Friends account and its existing session.")
        friends = origin(args.friends_origin, local=True), args.friend_account, os.environ["LITTLE_WORLDS_FRIENDS_COOKIE"]
    token = os.getenv("LITTLE_WORLDS_PUBLISHER_TOKEN") or getpass.getpass("星球专用连接码：")
    if not re.fullmatch("[0-9a-f]{64}", token):
        ap.error("Invalid world connection code.")
    while True:
        try:
            try:
                publish(args.config.resolve(), set(args.project), friends, world, token)
            except HTTPStatusError as error:
                if error.status in (401, 403):
                    print("星球连接已失效。请在自己的星球重新连接。", file=sys.stderr)
                    return 1
                raise
        except (ValueError, OSError, KeyError, http.client.HTTPException):
            # Never log upstream bodies/configuration or request headers.
            print("居民暂未更新。请核对世界连接和本机 Bothouse。", file=sys.stderr)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(6)


if __name__ == "__main__":
    sys.exit(main())
