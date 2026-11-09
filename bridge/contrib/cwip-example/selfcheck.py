#!/usr/bin/env python3
"""Self-check for cwip_bot.py: a tiny fake hub, no real hub or credentials needed.

It starts a fake CWIP gateway on 127.0.0.1, runs the example bot as a subprocess,
and asserts:
  1. the bot registers with the expected query parameters and auth header;
  2. it replies once to a mentioned, non-bot message;
  3. it stays silent for an unmentioned message;
  4. it stays silent for a bot message even if mentioned.

Exit code 0 = PASS; non-zero = FAIL (prints the bot output).
"""
import base64
import hashlib
import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.parse

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
HERE = os.path.dirname(os.path.abspath(__file__))
BOT = os.path.join(HERE, "cwip_bot.py")
AUTH_VALUE = "selfcheck-only-value"


def _exact(conn, n):
    buf = b""
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("socket closed")
        buf += chunk
    return buf


def recv_frame(conn, timeout=5.0):
    conn.settimeout(timeout)
    hdr = _exact(conn, 2)
    b1, b2 = hdr[0], hdr[1]
    opcode = b1 & 0x0F
    masked = bool(b2 & 0x80)
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack("!H", _exact(conn, 2))[0]
    elif n == 127:
        n = struct.unpack("!Q", _exact(conn, 8))[0]
    mask = _exact(conn, 4) if masked else None
    payload = _exact(conn, n)
    if mask:
        payload = bytes(payload[i] ^ mask[i % 4] for i in range(n))
    return opcode, payload


def send_frame(conn, opcode, payload):
    b1 = 0x80 | opcode
    n = len(payload)
    if n < 126:
        header = bytes([b1, n])
    elif n < 65536:
        header = bytes([b1, 126]) + struct.pack("!H", n)
    else:
        header = bytes([b1, 127]) + struct.pack("!Q", n)
    conn.sendall(header + payload)


def send_json(conn, obj):
    send_frame(conn, 1, json.dumps(obj).encode("utf-8"))


def read_http(conn):
    conn.settimeout(10)
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = conn.recv(4096)
        if not chunk:
            raise ConnectionError("closed during handshake")
        buf += chunk
        if len(buf) > 65536:
            raise ConnectionError("handshake too large")
    head, _, rest = buf.partition(b"\r\n\r\n")
    return head.decode("utf-8", "replace"), rest


class FakeHub:
    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.sock.listen(1)
        self.done = threading.Event()
        self.errors = []
        self.replies = []
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def _serve(self):
        try:
            conn, _ = self.sock.accept()
            self._handle(conn)
        except Exception as exc:  # noqa: BLE001
            self.errors.append(str(exc))
        finally:
            try:
                self.sock.close()
            except OSError:
                pass
            self.done.set()

    def _handle(self, conn):
        head, _rest = read_http(conn)
        lines = head.split("\r\n")
        request = lines[0]
        path = request.split(" ")[1]
        url = urllib.parse.urlparse(path)
        query = dict(urllib.parse.parse_qsl(url.query, keep_blank_values=True))
        headers = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        if query.get("bot") != "example-bot":
            raise AssertionError(f"bad bot query: {query!r}")
        if headers.get("authorization") != f"Bearer {AUTH_VALUE}":
            raise AssertionError("bad Authorization header")
        key = headers.get("sec-websocket-key")
        if not key:
            raise AssertionError("missing Sec-WebSocket-Key")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        conn.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode("utf-8")
        )

        op, payload = recv_frame(conn, 10)
        register = json.loads(payload)
        if register.get("type") != "register":
            raise AssertionError(f"expected register, got {register!r}")
        send_json(conn, {
            "type": "register_ack",
            "ok": True,
            "capabilities": ["text"],
            "server": {"name": "fake-hub"},
        })

        def message(msg_id, mentioned, from_bot):
            send_json(conn, {
                "type": "message",
                "msg_id": msg_id,
                "chat_id": "room-1",
                "chat_type": "group",
                "user_id": "owner",
                "user_name": "Owner",
                "content": f"message {msg_id}",
                "reply_ctx": "room-1",
                "mentioned": mentioned,
                "from_bot": from_bot,
            })

        # 1) mentioned, human -> exactly one reply
        message("hub-1", True, False)
        op, payload = recv_frame(conn, 5)
        reply = json.loads(payload)
        if reply.get("type") != "reply":
            raise AssertionError(f"expected reply, got {reply!r}")
        if reply.get("reply_ctx") != "room-1":
            raise AssertionError(f"bad reply_ctx: {reply!r}")
        if not reply.get("content"):
            raise AssertionError("empty reply content")
        self.replies.append(reply)

        # 2) unmentioned -> no reply
        message("hub-2", False, False)
        try:
            recv_frame(conn, 1.0)
            raise AssertionError("bot replied to an unmentioned message")
        except socket.timeout:
            pass

        # 3) from another bot, even if mentioned -> no reply
        message("hub-3", True, True)
        try:
            recv_frame(conn, 1.0)
            raise AssertionError("bot replied to a from_bot message")
        except socket.timeout:
            pass


def main():
    hub = FakeHub().start()
    env = dict(os.environ)
    env.update({
        "CWIP_URL": f"ws://127.0.0.1:{hub.port}/cloud-web/ws",
        "CWIP_AUTH": AUTH_VALUE,
        "CWIP_BOT_ID": "example-bot",
        "CWIP_NAME": "ExampleBot",
        "CWIP_MENTION_ID": "999",
        "CWIP_ROOM": "1",
    })
    proc = subprocess.Popen(
        [sys.executable, "-u", BOT],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        hub.done.wait(timeout=20)
        out = ""
        try:
            proc.terminate()
            out, _ = proc.communicate(timeout=5)
        except Exception:  # noqa: BLE001
            proc.kill()
            try:
                out, _ = proc.communicate(timeout=5)
            except Exception:  # noqa: BLE001
                out = ""
        if hub.errors:
            print("SELF-CHECK FAILED:", file=sys.stderr)
            for err in hub.errors:
                print(" -", err, file=sys.stderr)
            if out:
                print("--- bot output ---", file=sys.stderr)
                print(out, file=sys.stderr)
            return 1
        if len(hub.replies) != 1:
            print(f"SELF-CHECK FAILED: expected 1 reply, got {len(hub.replies)}", file=sys.stderr)
            if out:
                print(out, file=sys.stderr)
            return 1
        print("SELF-CHECK PASS: registered via fake hub; replied once to mentioned/human; stayed silent for unmentioned and from_bot messages")
        return 0
    finally:
        if proc.poll() is None:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
