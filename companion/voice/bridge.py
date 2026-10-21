"""Request-correlated local input API; never read Discord credentials."""
from __future__ import annotations

import http.client
import json
import socket


class BridgeError(RuntimeError):
    def __init__(self, message: str, status: int = 503, *, not_sent: bool = False):
        super().__init__(message)
        self.status = status
        self.not_sent = not_sent


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

    def call(self, path: str, body: dict | None = None) -> dict:
        connection = UnixConnection(self.path)
        try:
            connection.request('GET' if body is None else 'POST', path,
                               None if body is None else json.dumps(body),
                               {'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw = response.read(2_000_000)
            if response.status >= 400:
                # Only the explicit private-relay admission contract proves
                # non-submission. A generic 503 or lost response does not.
                if (path == '/relay/send' and body is not None
                        and body.get('mode') == 'voice' and response.status == 503):
                    try:
                        rejection = json.loads(raw)
                    except (ValueError, UnicodeError):
                        rejection = None
                    if isinstance(rejection, dict) and rejection.get('submission') == 'not_sent':
                        raise BridgeError('语音转发暂时无法接纳，本轮未发送。', 503, not_sent=True)
                messages = {
                    404: '桥接没有此接口或会话。请核对部署与会话绑定。',
                    409: '原会话正忙或请求冲突；这条话没有被重新发送。',
                    400: '桥接拒绝输入，请检查已有会话是否可以恢复。',
                    422: '原会话不能安全恢复，请先在 Discord 核对。',
                    503: '桥接暂时不可用。',
                }
                raise BridgeError(messages.get(response.status, f'桥接返回 HTTP {response.status}。'), response.status)
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError('invalid response')
            return value
        except (OSError, http.client.HTTPException, ValueError):
            raise BridgeError('未取得桥接回执；请求可能已送达，不会自动重复发送。') from None
        finally:
            connection.close()
