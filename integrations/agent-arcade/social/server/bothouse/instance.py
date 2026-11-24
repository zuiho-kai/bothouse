"""Local Bothouse transport. Never serialize configuration, credentials or provider settings."""
import base64
import hashlib
import http.client
import json
import ipaddress
import os
import re
import secrets
import socket
import sys
import time
import tomllib
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def read_json(endpoint, token, route):
    conn = http.client.HTTPConnection("127.0.0.1", endpoint, timeout=3)
    try:
        conn.request("GET", route, headers={"Authorization": "Bearer " + token})
        res = conn.getresponse()
        if res.status != 200:
            raise ValueError("unavailable")
        raw = res.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("response limit exceeded")
        data = json.loads(raw)
        if data.get("ok") is not True:
            raise ValueError("unavailable")
        return data["data"]
    finally:
        conn.close()


def instance_id(cfg, file):
    data_dir = Path(cfg.get("data_dir") or file.parent).expanduser()
    if not data_dir.is_absolute():
        raise ValueError("ambiguous data directory")
    try:
        line = (data_dir / "identity" / "signing.pub").read_text().strip()
    except FileNotFoundError:
        # Bothouse lazily creates its keypair on its own public identity endpoint.
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as local:
            local.settimeout(3)
            local.connect(str(data_dir / "run" / "identity.sock"))
            conn = http.client.HTTPConnection("localhost", timeout=3)
            conn.sock = local
            try:
                conn.request("GET", "/identity/pubkey")
                res = conn.getresponse()
                if res.status != 200:
                    raise ValueError("unknown instance")
                line = json.loads(res.read(4096))["pubkey"]
            finally:
                conn.close()
    public = line.split()
    if len(public) != 2 or public[0] != "bothouse-ed25519" or len(base64.b64decode(public[1], validate=True)) != 32:
        raise ValueError("unknown instance")
    return digest(public[1])


# Bothouse records avatar choices by exact Bridge project in the wizard teams.
# Ambiguous choices fall back to the standard avatar.
def role_portrait(get, port, project):
    setup = get("setup/state").get("setup", {})
    matches = {entry.get("avatar") or "" for key in ("team", "cloud_web_team")
               for entry in (setup.get(key) or []) if entry.get("project") == project}
    if len(matches) != 1:
        return {}
    slug = matches.pop()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", slug):
        return {}
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        conn.request("GET", "/api/v1/library/avatar-image/" + slug)
        res = conn.getresponse()
        mime = res.getheader("Content-Type")
        if res.status != 200 or mime not in ("image/png", "image/jpeg"):
            return {}
        limit = 2 * 1024 * 1024
        data = res.read(limit + 1)
        if not data or len(data) > limit:
            return {}
        return {"mime": mime, "portrait": base64.b64encode(data).decode("ascii")}
    finally:
        conn.close()


def upstream_identity(access, actor, link, instance, project):
    ids = {value for rule in access.get("roles", {}).values() for value in rule.get("user_ids", [])}
    if actor in ids:
        return actor
    if link.get("instance") != instance:
        return None
    if link.get("identity") is not None and link["identity"] in ids:
        return link["identity"]
    if access.get("configured") is False and project in link.get("projects", []):
        return actor
    return None


def local_channels_host(cfg, file):
    # Follow collabDataDir's existing directory/legacy selection. Compare the
    # origin only; never use the Channels owner credential to speak for a friend.
    home = Path.home()
    data = Path(os.environ.get("BOTHOUSE_DATA_DIR") or cfg.get("data_dir") or file.parent)
    directory = data / "conest-collab"
    if data in (home / ".bothouse", home / ".cc-connect") or not directory.exists():
        directory = home / ".conest-collab"
    record = Path(os.environ.get("CONEST_COLLAB_DATA") or directory) / "collab.owner.json"
    with record.open("rb") as stream:
        origin = urlsplit(json.loads(stream.read(16385))["local"]["origin"])
    if (origin.scheme == "http" and origin.path in ("", "/") and not origin.username
            and not origin.password and not origin.query and not origin.fragment and origin.port
            and ipaddress.ip_address(origin.hostname).is_loopback):
        return origin.netloc
    return None


def is_bridge_role(row):
    # Management /roles omits the default source; the role-state feed names it.
    return row.get("source") in (None, "", "bridge")


def native_bindings(cfg, file, get, rows):
    # memberRole() uses the stored native member ID for both the project and
    # its cloud_web ?bot=. The management role roster also includes external bots.
    native = {r["name"][4:]: r for r in rows if r.get("source") == "dsh"
              and r.get("agent_type") == "dsh" and r.get("name", "").startswith("dsh:")}
    if not native:
        return {}
    try:
        host = local_channels_host(cfg, file)
        if not host:
            return {}
        stored = {m["id"] for m in get("dsh/members")["members"]
                  if m.get("source") in ("ui", "config") and m.get("cli") is None}
    except (OSError, KeyError, TypeError, ValueError, http.client.HTTPException):
        return {}
    engines = {r["name"]: r for r in rows if is_bridge_role(r) and r.get("agent_type") == "dsh"}
    bound = {}
    for project in cfg.get("projects", []):
        key = project.get("name")
        if key not in native or key not in stored or key not in engines:
            continue
        platforms = [p for p in project.get("platforms", []) if p.get("type") == "cloud_web"]
        if len(platforms) != 1:
            continue
        opts = platforms[0].get("options", {})
        try:
            url = urlsplit(opts.get("ws_url", ""))
            if (url.scheme != "ws" or url.netloc != host or url.path != "/cloud-web/ws"
                    or parse_qs(url.query).get("bot") != [key]):
                continue
        except ValueError:
            continue
        channel_ready = any(p.get("name") == (opts.get("name") or "cloud_web") and p.get("ready") is True
                            for p in engines[key].get("platforms", []))
        bound[key] = (native[key], channel_ready and native[key].get("online") is True
                      and not platforms[0].get("disabled") and not project.get("disabled"))
    return bound


def run(file, request):
    with file.open("rb") as stream:
        cfg = tomllib.load(stream)
    mgmt = cfg["management"]
    if not mgmt.get("enabled") or not mgmt.get("token"):
        raise ValueError("unavailable")
    account = request.get("account")
    actor = "arcade:" + account if account else None
    authority = request["action"] == "authority"
    link = request.get("link") or {}
    def get(route):
        return read_json(mgmt.get("port") or 9820, mgmt["token"], "/api/v1/" + route)
    bridge = cfg.get("bridge", {})
    roles = []
    instance = None
    upstream_user = actor
    rows = get("roles")["roles"]
    native = native_bindings(cfg, file, get, rows)
    for item in rows:
        project = item["name"]
        if not is_bridge_role(item) or not project or "/" in project or project in (".", ".."):
            continue  # A verified DSH member is emitted once through its own engine below.
        if instance is None:
            instance = instance_id(cfg, file)
        number = "bh_" + digest(instance + "\0" + project)[:21]
        legacy = None
        label = item.get("display_name") or project
        if project in native:
            member, connected = native[project]
            legacy = number
            number = "bh_" + digest(instance + "\0dsh\0" + project)[:21]
            label = member.get("display_name") or project
        if "number" in request and request["number"] not in (number, legacy):
            continue
        access_route = "projects/" + quote(project, safe="") + "/users"
        access = get(access_route)
        if authority:
            ids = {value for rule in access.get("roles", {}).values() for value in rule.get("user_ids", [])}
            roles.append(dict(id=project, displayName=label,
                              selectable=access.get("configured") is False, matches=request.get("identity") in ids))
            continue
        authorized = upstream_identity(access, actor, link, instance, project)
        if authorized is None:
            continue
        upstream_user = authorized
        ready = bool(bridge.get("enabled") and bridge.get("token") and not item.get("paused")
                     and (legacy is None or connected))
        if request["action"] == "portrait":
            if not request.get("number") or not ready:
                return {}
            portrait = role_portrait(get, mgmt.get("port") or 9820, project)
            if portrait and upstream_identity(get(access_route), actor, link, instance, project) is not None:
                return portrait
            return {}
        roles.append(dict(id=project, number=number, displayName=label,
                          configured=ready, kind="ai", source="bothouse", **({"legacyNumber": legacy} if legacy else {})))
    if authority:
        return {"instance": instance, "projects": roles}
    listing = request["action"] == "list"
    if not roles:
        if not listing:
            return {"error": "unavailable"}
        return {"contacts": [], "directoryStatus": "empty",
                "directoryReason": "no_roles" if instance is None else "not_shared"}
    if not any(r["configured"] for r in roles):
        return {"contacts": roles, "directoryStatus": "offline"} if listing else {"error": "unavailable"}
    if not listing and (request["action"] not in ("chat", "task") or len(roles) != 1):
        raise ValueError("invalid target")

    from websockets.sync.client import connect
    target = roles[0]["id"]
    platform = "arcade-" + secrets.token_hex(10)
    ref = secrets.token_hex(16)
    route = bridge.get("path") or "/bridge/ws"
    if not route.startswith("/") or "?" in route or "#" in route:
        raise ValueError("invalid bridge path")
    url = "ws://127.0.0.1:" + str(bridge.get("port") or 9810) + route
    with connect(url, additional_headers={"Authorization": "Bearer " + bridge["token"]},
                 open_timeout=3, close_timeout=1, max_size=1024 * 1024, proxy=None) as ws:
        ws.send(json.dumps({"type": "register", "platform": platform, "capabilities": ["text"],
                            "metadata": {"control_plane": ["capabilities_snapshot_v1"]}}))
        ack = json.loads(ws.recv(timeout=3))
        if ack.get("type") != "register_ack" or ack.get("ok") is not True:
            raise ValueError("registration failed")
        snapshot = json.loads(ws.recv(timeout=3))
        if snapshot.get("type") != "capabilities_snapshot" or snapshot.get("v") != 1:
            raise ValueError("unknown bridge")
        projects = {p["project"] for p in snapshot["projects"]}
        for role in roles:
            role["configured"] = role["configured"] and role["id"] in projects
        if listing:
            return {"contacts": roles, "directoryStatus": "ready" if any(r["configured"] for r in roles) else "offline"}
        if not roles[0]["configured"]:
            return {"error": "unavailable"}
        session = "arcade:" + digest(json.dumps([instance, actor, target, request["scope"]]))[:48]
        task = request["action"] == "task"
        # The board worker owns this adapter until handback or cancellation.
        # Ordinary chat keeps its short observation deadline.
        deadline = None if task else time.monotonic() + 60
        try:
            ws.send(json.dumps(dict(type="message", project=target, msg_id=str(request["messageId"]),
                                    user_id=upstream_user, session_key=session, reply_ctx=ref,
                                    direct=request["direct"], mentioned=not request["direct"],
                                    from_bot=False, content=request["text"])))
            heartbeat = time.monotonic() + 30
            while deadline is None or time.monotonic() < deadline:
                if task and time.monotonic() >= heartbeat:
                    # Bothouse resets the adapter's read deadline on application frames.
                    ws.send(json.dumps({"type": "ping", "ts": int(time.time() * 1000)}))
                    heartbeat = time.monotonic() + 30
                timeout = max(0.01, (heartbeat if task else deadline) - time.monotonic())
                try:
                    row = json.loads(ws.recv(timeout=timeout))
                except TimeoutError:
                    if not task:
                        raise
                    continue
                if row.get("type") == "reply" and row.get("reply_ctx") == ref and row.get("session_key") == session:
                    text = row.get("content")
                    if isinstance(text, str) and text.strip() and len(text) <= 4000:
                        return {"text": text}
                    break
        except Exception:
            if task:
                return {"error": "receipt_unknown"}
            raise
    return {"error": "unavailable"}


if __name__ == "__main__":
    try:
        result = run(Path(sys.argv[1]), json.load(sys.stdin))
    except Exception:
        result = {"error": "unavailable"}
    print(json.dumps(result))
