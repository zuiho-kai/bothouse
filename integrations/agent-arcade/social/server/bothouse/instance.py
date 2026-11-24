"""Local Bothouse transport. Never serialize configuration, credentials or provider settings."""
import base64
import hashlib
import http.client
import json
import secrets
import socket
import sys
import time
import tomllib
from pathlib import Path
from urllib.parse import quote


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


def run(file, request):
    with file.open("rb") as stream:
        cfg = tomllib.load(stream)
    mgmt = cfg["management"]
    if not mgmt.get("enabled") or not mgmt.get("token"):
        raise ValueError("unavailable")
    actor = "arcade:" + request["account"]
    def get(route):
        return read_json(mgmt.get("port") or 9820, mgmt["token"], "/api/v1/" + route)
    bridge = cfg.get("bridge", {})
    roles = []
    instance = None
    for item in get("roles")["roles"]:
        project = item["name"]
        if item.get("source") or not project or "/" in project or project in (".", ".."):
            continue  # DSH-native roles use a different chat protocol.
        if instance is None:
            instance = instance_id(cfg, file)
        number = "bh_" + digest(instance + "\0" + project)[:21]
        if request.get("number", number) != number:
            continue
        access = get("projects/" + quote(project, safe="") + "/users")
        if not any(actor in rule.get("user_ids", []) for rule in access.get("roles", {}).values()):
            continue
        ready = bool(bridge.get("enabled") and bridge.get("token") and not item.get("paused"))
        roles.append(dict(id=project, number=number, displayName=item.get("display_name") or project,
                          configured=ready, kind="ai", source="bothouse"))
    listing = request["action"] == "list"
    if not roles:
        return {"contacts": [], "directoryStatus": "empty"} if listing else {"error": "unavailable"}
    if not any(r["configured"] for r in roles):
        return {"contacts": roles, "directoryStatus": "offline"} if listing else {"error": "unavailable"}
    if not listing and (request["action"] != "chat" or len(roles) != 1):
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
        ws.send(json.dumps(dict(type="message", project=target, msg_id=str(request["messageId"]),
                                user_id=actor, session_key=session, reply_ctx=ref,
                                direct=request["direct"], mentioned=not request["direct"],
                                from_bot=False, content=request["text"])))
        until = time.monotonic() + 60
        while time.monotonic() < until:
            row = json.loads(ws.recv(timeout=max(0.01, until - time.monotonic())))
            if row.get("type") == "reply" and row.get("reply_ctx") == ref and row.get("session_key") == session:
                text = row.get("content")
                if isinstance(text, str) and text.strip() and len(text) <= 4000:
                    return {"text": text}
                break
    return {"error": "unavailable"}


if __name__ == "__main__":
    try:
        result = run(Path(sys.argv[1]), json.load(sys.stdin))
    except Exception:
        result = {"error": "unavailable"}
    print(json.dumps(result))
