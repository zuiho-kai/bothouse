#!/usr/bin/env python3
"""Minimal CWIP (cloud-web) external bot client for bothouse channels.

M3 example for #321. Zero dependencies: Python 3.8+ standard library only.

What it does
------------
1. Connects to a bothouse hub's cloud-web WebSocket gateway.
2. Sends the `register` frame and waits for `register_ack`.
3. Receives `message` frames.
4. Replies only when `mentioned == True` and `from_bot == False`, deduping by `msg_id`.
5. Reconnects with backoff when the socket closes.

It deliberately does NOT implement M1/M2 features (pre-provisioned members,
per-member credentials, offline state); those do not exist yet.

Configuration is read from environment variables or CLI flags.
"""
import argparse
import base64
import hashlib
import json
import os
import signal
import socket
import ssl
import struct
import sys
import time
import urllib.parse

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocketClient:
    """Tiny RFC 6455 client: text frames, ping/pong, close. No extensions."""

    def __init__(self, url: str, auth_value: str, timeout: float = 15.0):
        self.url = url
        self.auth_value = auth_value
        self.timeout = timeout
        self.sock = None
        self.buffer = b""

    def connect(self) -> None:
        u = urllib.parse.urlparse(self.url)
        if u.scheme not in ("ws", "wss"):
            raise ValueError("URL must start with ws:// or wss://")
        host = u.hostname or "127.0.0.1"
        port = u.port or (443 if u.scheme == "wss" else 80)
        path = u.path or "/"
        if u.query:
            path += "?" + u.query

        raw = socket.create_connection((host, port), timeout=self.timeout)
        if u.scheme == "wss":
            ctx = ssl.create_default_context()
            raw = ctx.wrap_socket(raw, server_hostname=host)
        self.sock = raw

        key = base64.b64encode(os.urandom(16)).decode("ascii")
        headers = [
            f"GET {path} HTTP/1.1",
            f"Host: {host}:{port}",
            "Upgrade: websocket",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {key}",
            "Sec-WebSocket-Version: 13",
            "User-Agent: cwip-example/0.1",
        ]
        if self.auth_value:
            headers.append(f"Authorization: Bearer {self.auth_value}")
        self.sock.sendall(("\r\n".join(headers) + "\r\n\r\n").encode("utf-8"))

        head = self._read_until(b"\r\n\r\n", 65536).decode("utf-8", "replace")
        status = head.split("\r\n", 1)[0]
        if " 101 " not in status:
            raise ConnectionError(f"WebSocket upgrade failed: {status}")
        accept = None
        for line in head.split("\r\n")[1:]:
            if line.lower().startswith("sec-websocket-accept:"):
                accept = line.split(":", 1)[1].strip()
        expected = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        if accept and accept != expected:
            raise ConnectionError("bad Sec-WebSocket-Accept")

    def send_text(self, text: str) -> None:
        self._send_frame(0x1, text.encode("utf-8"))

    def recv_text(self, timeout: float = None):
        """Return ('text', str) / ('close', None) / ('ping'/'pong'/'other', None)."""
        self.sock.settimeout(timeout if timeout is not None else self.timeout)
        while True:
            opcode, payload = self._read_frame()
            if opcode == 0x8:  # close
                return ("close", None)
            if opcode == 0x9:  # ping -> pong
                self._send_frame(0xA, payload)
                return ("ping", None)
            if opcode == 0xA:
                return ("pong", None)
            if opcode == 0x1:
                return ("text", payload.decode("utf-8", "replace"))
            return ("other", None)

    def close(self) -> None:
        try:
            if self.sock:
                self._send_frame(0x8, b"")
                self.sock.close()
        except OSError:
            pass
        finally:
            self.sock = None

    # -- internals -----------------------------------------------------
    def _send_frame(self, opcode: int, payload: bytes) -> None:
        if not self.sock:
            raise ConnectionError("not connected")
        b1 = 0x80 | opcode  # FIN=1
        n = len(payload)
        if n < 126:
            header = bytes([b1, 0x80 | n])
        elif n < 65536:
            header = bytes([b1, 0x80 | 126]) + struct.pack("!H", n)
        else:
            header = bytes([b1, 0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        masked = bytes(payload[i] ^ mask[i % 4] for i in range(n))
        self.sock.sendall(header + mask + masked)

    def _read_frame(self):
        hdr = self._read_exact(2)
        b1, b2 = hdr[0], hdr[1]
        opcode = b1 & 0x0F
        masked = bool(b2 & 0x80)
        n = b2 & 0x7F
        if n == 126:
            n = struct.unpack("!H", self._read_exact(2))[0]
        elif n == 127:
            n = struct.unpack("!Q", self._read_exact(8))[0]
        mask = self._read_exact(4) if masked else None
        payload = self._read_exact(n)
        if mask:
            payload = bytes(payload[i] ^ mask[i % 4] for i in range(n))
        return opcode, payload

    def _read_exact(self, n: int) -> bytes:
        while len(self.buffer) < n:
            chunk = self.sock.recv(max(4096, n - len(self.buffer)))
            if not chunk:
                raise ConnectionError("socket closed")
            self.buffer += chunk
        out, self.buffer = self.buffer[:n], self.buffer[n:]
        return out

    def _read_until(self, marker: bytes, limit: int) -> bytes:
        while marker not in self.buffer:
            if len(self.buffer) > limit:
                raise ConnectionError("handshake headers too large")
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("socket closed during handshake")
            self.buffer += chunk
        idx = self.buffer.index(marker) + len(marker)
        out, self.buffer = self.buffer[:idx], self.buffer[idx:]
        return out


class Bot:
    def __init__(self, opts):
        self.opts = opts
        self.seen = []
        self.seen_set = set()
        self.stopping = False

    def stop(self, *_):
        self.stopping = True

    def run(self) -> None:
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)
        backoff = 1.0
        while not self.stopping:
            try:
                self._connect_once()
                backoff = 1.0
            except Exception as exc:  # noqa: BLE001 - demo: log and retry
                print(f"[cwip-example] connection error: {exc}", file=sys.stderr, flush=True)
                if self.stopping:
                    break
                time.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    def _connect_once(self) -> None:
        ws = WebSocketClient(self.opts.url, self.opts.auth_value)
        ws.connect()
        print("[cwip-example] connected, registering", flush=True)
        ws.send_text(json.dumps({
            "type": "register",
            "platform": "cloud_web",
            "client": "cwip-example",
            "project": self.opts.bot,
            "transport": "ws",
        }))

        while not self.stopping:
            kind, text = ws.recv_text(timeout=60)
            if kind == "close":
                print("[cwip-example] server closed the socket", flush=True)
                return
            if kind != "text":
                continue
            try:
                frame = json.loads(text)
            except json.JSONDecodeError:
                continue
            if frame.get("type") == "register_ack":
                if not frame.get("ok"):
                    raise ConnectionError(f"register rejected: {frame.get('error')}")
                print("[cwip-example] registered; waiting for messages", flush=True)
                continue
            if frame.get("type") == "message":
                self._on_message(ws, frame)

    def _on_message(self, ws: WebSocketClient, frame: dict) -> None:
        # Core rule: only answer a direct mention from a non-bot sender.
        if not frame.get("mentioned") or frame.get("from_bot"):
            return
        msg_id = frame.get("msg_id")
        if not msg_id or msg_id in self.seen_set:
            return
        self.seen.append(msg_id)
        self.seen_set.add(msg_id)
        if len(self.seen) > 500:
            old = self.seen.pop(0)
            self.seen_set.discard(old)

        reply_ctx = frame.get("reply_ctx") or frame.get("chat_id")
        if not reply_ctx:
            return
        # Replace this with the actual answer from your bot/LLM.
        text = frame.get("content") or ""
        answer = f"[cwip-example] received: {text[:200]}"
        ws.send_text(json.dumps({"type": "reply", "reply_ctx": reply_ctx, "content": answer}))
        print(f"[cwip-example] replied to {msg_id}", flush=True)


def build_url(opts) -> str:
    u = urllib.parse.urlparse(opts.url)
    query = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
    query["bot"] = opts.bot
    if opts.name:
        query["name"] = opts.name
    if opts.mention_id:
        query["mention_id"] = opts.mention_id
    if opts.room:
        query["room"] = opts.room
    return urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(query)))


def main() -> int:
    p = argparse.ArgumentParser(description="Minimal CWIP/cloud-web external bot client (M3 example)")
    p.add_argument("--url", default=os.environ.get("CWIP_URL", ""), help="ws(s)://host:port/cloud-web/ws")
    p.add_argument("--auth", default=os.environ.get("CWIP_AUTH", ""), help="bot auth value (prefer env)")
    p.add_argument("--bot", default=os.environ.get("CWIP_BOT_ID", "example-bot"), help="member id")
    p.add_argument("--name", default=os.environ.get("CWIP_NAME", "ExampleBot"), help="display name")
    p.add_argument("--mention-id", default=os.environ.get("CWIP_MENTION_ID", ""), help="numeric mention id (optional)")
    p.add_argument("--room", default=os.environ.get("CWIP_ROOM", ""), help="room id to scope to (recommended)")
    opts = p.parse_args()
    if not opts.url or not opts.auth:
        print("error: --url and --auth (or CWIP_URL / CWIP_AUTH) are required", file=sys.stderr)
        return 2
    opts.url = build_url(opts)
    opts.auth_value = opts.auth
    Bot(opts).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
