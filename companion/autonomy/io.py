"""Small stdlib adapters. Credentials never enter state, logs or exception text."""
from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import socket
import tomllib
import urllib.error
import urllib.request


class RemoteError(RuntimeError):
    pass


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

    def call(self, path: str, body: dict | None = None, *, files=None):
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
        try:
            with self.opener.open(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            # Do not echo a response body: it may contain message content or credentials.
            raise RemoteError(f'Discord HTTP {exc.code}') from None
        except (OSError, ValueError) as exc:
            raise RemoteError(f'Discord unavailable ({type(exc).__name__})') from None
