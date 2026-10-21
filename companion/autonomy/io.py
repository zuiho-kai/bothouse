"""Small stdlib adapters. Credentials never enter state, logs or exception text."""
from __future__ import annotations

import http.client
import json
import math
import os
from pathlib import Path
import socket
import ssl
import time
import tomllib
import urllib.error
import urllib.request


class RemoteError(RuntimeError):
    def __init__(self, message, *, kind="remote", cause="unknown", attempts=1, status=None):
        super().__init__(message)
        self.kind, self.cause = kind, cause
        self.attempts, self.status = attempts, status


def transport_cause(exc):
    """Classify without retaining URLs, response bodies or exception messages."""
    reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
    for cls, name in ((ssl.SSLCertVerificationError, "tls_certificate"),
                      (ssl.SSLEOFError, "tls_eof"), (ssl.SSLError, "tls"),
                      (TimeoutError, "timeout"), (socket.gaierror, "dns"),
                      (ConnectionError, "connection"),
                      (http.client.IncompleteRead, "incomplete_read"),
                      (http.client.HTTPException, "http_transport")):
        if isinstance(reason, cls):
            return name
    return "network"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(path.suffix + '.new')
    with temporary.open('w', encoding='utf-8') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str):
        super().__init__('localhost', timeout=15)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class Bridge:
    def __init__(self, path: str):
        self.path = path

    def call(self, path: str, body: dict | None = None):
        connection = UnixConnection(self.path)
        try:
            connection.request('GET' if body is None else 'POST', path,
                               None if body is None else json.dumps(body),
                               {'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw = response.read()
            if response.status >= 400:
                raise RemoteError(f'bridge {path.split("?")[0]} HTTP {response.status}')
            return json.loads(raw) if raw else None
        except (OSError, http.client.HTTPException, ValueError) as exc:
            raise RemoteError(f'bridge unavailable ({type(exc).__name__})') from None
        finally:
            connection.close()


class Discord:
    def __init__(self, bridge_config: str, project: str):
        with Path(bridge_config).expanduser().open('rb') as stream:
            config = tomllib.load(stream)
        entry = next(p for p in config['projects'] if p['name'] == project)
        options = next(p['options'] for p in entry['platforms'] if p['type'] == 'discord')
        self.token = options['token']
        # urllib honors the host's normal proxy configuration. Never log options.
        self.opener = urllib.request.build_opener()

    def call(self, path: str, body: dict | None = None, *, files=None, deadline=None):
        headers = {'Authorization': 'Bot ' + self.token, 'User-Agent': 'YijiaziJournal/1.0'}
        data = None
        if files is not None:
            boundary = 'yijiazi-' + os.urandom(12).hex()
            payload = json.dumps(body, ensure_ascii=False).encode()
            parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n'.encode() + payload]
            for i, (filename, content) in enumerate(files):
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="files[{i}]"; filename="{filename}"\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'.encode() + content)
            data = b'\r\n'.join(parts) + f'\r\n--{boundary}--\r\n'.encode()
            headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
        elif body is not None:
            data = json.dumps(body, ensure_ascii=False).encode()
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request('https://discord.com/api/v10' + path, data=data, headers=headers)
        read_only = body is None and files is None
        # Bound retry work, including all pagination calls through their shared deadline.
        end = time.monotonic() + (45 if read_only else 20)
        if deadline is not None:
            end = min(end, deadline)
        attempts = 3 if read_only else 1
        for attempt in range(1, attempts + 1):
            remaining = end - time.monotonic()
            if remaining <= 0:
                raise RemoteError("Discord read budget exhausted", kind="deadline", attempts=attempt - 1)
            delay = float(attempt)
            try:
                with self.opener.open(request, timeout=min(20, remaining)) as response:
                    result = json.load(response)
                return result
            except urllib.error.HTTPError as exc:
                status = exc.code
                retryable = status in (408, 429, 500, 502, 503, 504)
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                if retry_after is not None:
                    try:
                        wait = float(retry_after)
                        if not math.isfinite(wait) or wait < 0:
                            raise ValueError
                        delay = max(delay, wait)
                    except (ValueError, TypeError):
                        retryable = False
                exc.close()
                error = RemoteError(f"Discord HTTP {status}", kind="http", status=status, attempts=attempt)
            except (OSError, http.client.HTTPException) as exc:
                cause = transport_cause(exc)
                retryable = cause != "tls_certificate"
                error = RemoteError(f"Discord unavailable ({cause})", kind="transport", cause=cause, attempts=attempt)
            except ValueError:
                retryable = False
                error = RemoteError("Discord invalid JSON", kind="invalid_data", attempts=attempt)
            if not read_only or not retryable or attempt == attempts or delay >= end - time.monotonic():
                raise error from None
            time.sleep(delay)
