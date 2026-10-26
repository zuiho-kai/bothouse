"""d10's event-driven wake registration on the local bridge."""
import http.client
import json
import os
import socket
import sys
from pathlib import Path


class _UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(self.socket_path))


def socket_path():
    if os.environ.get("D10_API_SOCKET"):
        return Path(os.environ["D10_API_SOCKET"])
    base = os.environ.get("CC_DATA_DIR")
    if base:
        return Path(base).expanduser() / "run" / "api.sock"
    try:
        import _team
    except ImportError:
        return Path.home() / ".cc-connect" / "run" / "api.sock"
    return _team.api_socket()


def request(action, project, session, owner, title, since):
    c = _UnixHTTP("localhost", timeout=10)
    c.socket_path = socket_path()
    try:
        payload = dict(action=action, project=project, session_key=session,
                       owner=owner, title=title, since=int(since))
        c.request("POST", "/team/watch", json.dumps(payload),
                  {"Content-Type": "application/json"})
        r = c.getresponse()
        body = r.read().decode("utf-8", "replace")
        if r.status == 404:  # older bridge: retain the existing deadline timer
            return None
        if r.status != 200:
            raise OSError(f"看门登记失败（{r.status}）：{body.strip()}")
        return json.loads(body)
    finally:
        c.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["socket"]:
        print(socket_path())
    else:
        result = request(*sys.argv[1:])
        print("covered" if result and result.get("covered") else "registered" if result else "legacy")
