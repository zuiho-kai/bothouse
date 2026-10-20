"""连云端失败时的日志不带 token：aiohttp 握手异常的 repr 里有请求头（Authorization: Bearer <token>）。
起一个对 /ws/host 回 401 的假云端，让真的 Host.run 去连，抓 stdout。秒级，假大脑，不调 claude、不出声。"""
from __future__ import annotations

import asyncio
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

import aiohttp
from aiohttp import web
from multidict import CIMultiDict, CIMultiDictProxy
from yarl import URL

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.config import Role
from rh.host import Host, brief_error
from rh.meeting import Meeting
from tests.test_meeting import FakeBrain

SECRET = "tok-should-never-be-logged-123"
ROLES = [Role("a", "A", "p")]


class HostLogHasNoToken(unittest.IsolatedAsyncioTestCase):
    async def test_handshake_failure_log_has_no_token(self):
        async def reject(request):
            return web.Response(status=401, text="bad token")
        app = web.Application()
        app.router.add_get("/ws/host", reject)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as d:
            meeting = Meeting(ROLES, {"a": FakeBrain("A")}, 2, 1000.0, sleep_scale=0.01)
            host = Host(meeting, f"http://127.0.0.1:{port}", SECRET, Path(d) / "s.json",
                        reconnect_min=0.05, reconnect_max=0.1)
            with contextlib.redirect_stdout(out):
                task = asyncio.create_task(host.run())
                for _ in range(100):
                    if "连接云端失败" in out.getvalue():
                        break
                    await asyncio.sleep(0.05)
                host.stop()
                await asyncio.wait_for(task, 5)
        await runner.cleanup()
        log = out.getvalue()
        self.assertIn("连接云端失败", log)
        self.assertIn("401", log)   # 状态码还在，排错用得上
        self.assertNotIn(SECRET, log)
        self.assertNotIn("Authorization", log)

    def test_brief_error_drops_headers(self):
        info = aiohttp.RequestInfo(URL("https://hub.example/ws/host"), "GET",
                                   CIMultiDictProxy(CIMultiDict({"Authorization": f"Bearer {SECRET}"})))
        e = aiohttp.WSServerHandshakeError(info, (), status=401, message="Invalid response status")
        self.assertIn(SECRET, repr(e))   # 前提：repr 真的带 token
        s = brief_error(e)
        self.assertNotIn(SECRET, s)
        self.assertIn("401", s)
        self.assertIn("WSServerHandshakeError", s)


if __name__ == "__main__":
    unittest.main()
