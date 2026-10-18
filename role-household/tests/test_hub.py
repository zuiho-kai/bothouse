"""云端频道 hub 和本地角色主机 host：收发、推送、鉴权、断线重连补话题。秒级，假大脑，不调 claude。"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path

import aiohttp
from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.config import Role
from rh.host import Host
from rh.hub import MAX_BODY, Hub, make_app
from rh.meeting import Meeting
from tests.test_meeting import FakeBrain

try:
    from playwright.async_api import async_playwright
    sys.path.insert(0, str(ROOT / "tools"))
    from screenshot_hub import speaking_now
except ImportError:  # 运行时不依赖 playwright
    async_playwright = None

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ROLES = [Role("a", "A", "p"), Role("b", "B", "p"), Role("c", "C", "p")]


async def wait_for(cond, timeout=5.0, what="条件"):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while loop.time() < end:
        if cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"等 {what} 超时")


class HubBase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.db = self.dir / "hub.sqlite3"
        self.port = None
        await self.start_hub()
        self.http = aiohttp.ClientSession()
        self.ws_list = []

    async def start_hub(self):
        self.hub = Hub(self.db, TOKEN)
        self.runner = web.AppRunner(make_app(self.hub))
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", self.port or 0)
        await site.start()
        self.port = self.runner.addresses[0][1]
        self.url = f"http://127.0.0.1:{self.port}"

    async def stop_hub(self):
        await self.runner.cleanup()
        self.hub.db.close()

    async def asyncTearDown(self):
        for ws in self.ws_list:
            await ws.close()
        await self.http.close()
        await self.stop_hub()

    async def web_client(self, since=None, token=TOKEN, kind="web"):
        if kind == "host":
            ws = await self.http.ws_connect(self.url + "/ws/host", headers={"Authorization": f"Bearer {token}"})
        else:
            ws = await self.http.ws_connect(self.url + "/ws")
        self.ws_list.append(ws)
        await ws.send_json({"type": "hello", "token": token, "kind": kind, "since": since})
        return ws

    async def recv(self, ws, timeout=5.0):
        msg = await ws.receive(timeout=timeout)
        self.assertEqual(msg.type, aiohttp.WSMsgType.TEXT, f"{msg.type} {ws.close_code}")
        return json.loads(msg.data)

    async def post(self, text, room=1, headers=AUTH, **extra):
        async with self.http.post(f"{self.url}/api/rooms/{room}/messages", json={"text": text, **extra},
                                  headers=headers) as r:
            return r.status, (await r.json() if r.status == 200 else await r.text())

    def rows(self, **where):
        out = self.hub.history(1, 0)
        return [m for m in out if all(m[k] == v for k, v in where.items())]


class HubAuth(HubBase):
    async def test_http_needs_token(self):
        for h in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}):
            async with self.http.put(self.url + "/api/members", json=[], headers=h) as r:
                self.assertEqual(r.status, 401, h)
            self.assertEqual((await self.post("x", headers=h))[0], 401)
        async with self.http.get(self.url + "/") as r:  # 网页本身不含数据，不要 token
            self.assertEqual(r.status, 200)
            self.assertIn("WebSocket", await r.text())
        self.assertEqual(self.rows(), [])

    async def test_ws_needs_token(self):
        ws = await self.web_client(token="wrong")
        msg = await ws.receive(timeout=5)
        self.assertEqual(msg.type, aiohttp.WSMsgType.CLOSE)
        self.assertEqual(ws.close_code, 4001)
        ws2 = await self.http.ws_connect(self.url + "/ws")
        self.ws_list.append(ws2)
        await ws2.send_str("not json")
        await ws2.receive(timeout=5)
        self.assertEqual(ws2.close_code, 4001)


    async def test_no_extra_get_api(self):
        """简易版：历史只走 WebSocket ready 帧，不留没人用的 GET 接口。"""
        for path in ("/api/rooms", "/api/members", "/api/rooms/1/messages"):
            async with self.http.get(self.url + path, headers=AUTH) as r:
                self.assertIn(r.status, (404, 405), path)


class HubMessages(HubBase):
    async def test_post_pushes_to_all_and_history(self):
        a, b = await self.web_client(), await self.web_client()
        for ws in (a, b):
            self.assertEqual((await self.recv(ws))["type"], "ready")
        status, msg = await self.post("周末去海边？")
        self.assertEqual(status, 200)
        self.assertEqual((msg["author_kind"], msg["status"], msg["name"]), ("user", "user", "用户"))
        for ws in (a, b):
            ev = await self.recv(ws)
            self.assertEqual((ev["type"], ev["message"]["id"], ev["message"]["text"]), ("message", msg["id"], "周末去海边？"))
        # 角色发言：在说 -> 说完，推送同 id 覆盖
        _, rm = await self.post("好呀", author_kind="role", author="a", name="A")
        self.assertEqual(rm["status"], "speaking")
        self.assertEqual((await self.recv(a))["message"]["status"], "speaking")
        async with self.http.patch(f"{self.url}/api/messages/{rm['id']}", json={"status": "interrupted", "spoken": 1},
                                   headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        ev = (await self.recv(a))["message"]
        self.assertEqual((ev["id"], ev["status"], ev["spoken"]), (rm["id"], "interrupted", 1))
        # 新连上的网页从 ready 里拿到全部历史；带 since 的只拿之后的
        c = await self.web_client()
        ready = await self.recv(c)
        self.assertEqual(ready["room"]["name"], "大厅")
        self.assertEqual([(m["author"], m["status"]) for m in ready["messages"]], [("user", "user"), ("a", "interrupted")])
        d = await self.web_client(since=msg["id"])
        self.assertEqual([m["id"] for m in (await self.recv(d))["messages"]], [rm["id"]])

    async def test_bad_requests(self):
        cases = [
            ({"text": ""}, 400), ({"text": 1}, 400), ({"text": "x", "author_kind": "god"}, 400),
            ({"text": "x", "author_kind": "role"}, 400), ({"text": "x", "status": "weird"}, 400),
        ]
        for body, code in cases:
            async with self.http.post(f"{self.url}/api/rooms/1/messages", json=body, headers=AUTH) as r:
                self.assertEqual(r.status, code, body)
        for raw in (b"{bad", b"[]", b"\xff\xfe"):   # 坏 JSON、不是对象、不是 UTF-8（原单机版第 8 条）
            async with self.http.post(f"{self.url}/api/rooms/1/messages", data=raw, headers=AUTH) as r:
                self.assertEqual(r.status, 400, raw)
        async with self.http.post(f"{self.url}/api/rooms/1/messages", data=b"x" * (MAX_BODY + 1), headers=AUTH) as r:
            self.assertEqual(r.status, 413)
        self.assertEqual((await self.post("x", room=99))[0], 404)
        async with self.http.patch(f"{self.url}/api/messages/999", json={"status": "done"}, headers=AUTH) as r:
            self.assertEqual(r.status, 404)
        self.assertEqual(self.rows(), [])

    async def test_lone_surrogate_stored_as_question_mark(self):
        """原单机版复审 A：落单代理字符不让库和推送崩，存成“?”，后面的消息照常。"""
        async with self.http.post(f"{self.url}/api/rooms/1/messages", data=b'{"text":"hi \\ud800 x"}',
                                  headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual((await self.post("normal"))[0], 200)
        self.assertEqual([m["text"] for m in self.rows()], ["hi ? x", "normal"])

    async def test_client_key_dedup(self):
        """H1：同一个 client_key 重发只存一条、只推一次，返回同一个 id。"""
        ws = await self.web_client(); await self.recv(ws)
        body = dict(author_kind="role", author="a", name="A", client_key="boot:1")
        s1, m1 = await self.post("好呀", **body)
        s2, m2 = await self.post("好呀", **body)
        self.assertEqual((s1, s2, m1["id"]), (200, 200, m2["id"]))
        self.assertEqual(len(self.rows(author_kind="role")), 1)
        await self.recv(ws)
        with self.assertRaises(asyncio.TimeoutError):
            await self.recv(ws, timeout=0.3)
        self.assertEqual((await self.post("x", client_key=""))[0], 400)

    async def test_old_db_gets_key_column(self):
        """H1：服务器上的旧库没有 client_key 列，启动时补上。"""
        await self.stop_hub()
        import sqlite3
        old = self.dir / "old.sqlite3"
        con = sqlite3.connect(old)
        con.executescript("""CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL,
          author_kind TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL,
          status TEXT NOT NULL, spoken INTEGER, created_at REAL NOT NULL, updated_at REAL NOT NULL);""")
        con.close()
        self.db = old
        await self.start_hub()
        _, m1 = await self.post("x", client_key="k")
        _, m2 = await self.post("x", client_key="k")
        self.assertEqual(m1["id"], m2["id"])

    async def test_restart_clears_leftover_speaking(self):
        """M3：hub 在 host 说话时重启、host 再也不回来，残留的“在说”启动时改成被打断。"""
        _, rm = await self.post("说到一半", author_kind="role", author="a", name="A")
        await self.stop_hub()
        await self.start_hub()
        self.assertEqual(self.hub.message(rm["id"])["status"], "interrupted")

    async def test_patch_only_role_messages(self):
        """L6：PATCH 只能把角色消息改成 done / interrupted，用户消息、别的状态都拒。"""
        _, um = await self.post("用户说的")
        _, rm = await self.post("角色说的", author_kind="role", author="a", name="A")
        for mid, body in ((um["id"], {"status": "done"}), (rm["id"], {"status": "speaking"}),
                          (rm["id"], {"status": "user"})):
            async with self.http.patch(f"{self.url}/api/messages/{mid}", json=body, headers=AUTH) as r:
                self.assertEqual(r.status, 400, (mid, body))
        self.assertEqual(self.hub.message(um["id"])["status"], "user")
        async with self.http.patch(f"{self.url}/api/messages/{rm['id']}", json={"status": "done"}, headers=AUTH) as r:
            self.assertEqual(r.status, 200)

    async def test_host_disconnect_interrupts_speaking(self):
        web_ws, host_ws = await self.web_client(), await self.web_client(kind="host")
        await self.recv(web_ws); await self.recv(host_ws)
        _, rm = await self.post("说到一半", author_kind="role", author="a", name="A")
        await self.recv(web_ws)
        await host_ws.close()
        ev = (await self.recv(web_ws))["message"]
        self.assertEqual((ev["id"], ev["status"]), (rm["id"], "interrupted"))

    async def test_members_pushed(self):
        ws = await self.web_client(); await self.recv(ws)
        async with self.http.put(self.url + "/api/members", json=[{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
                                 headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        ev = await self.recv(ws)
        self.assertEqual((ev["type"], [m["id"] for m in ev["members"]]), ("members", ["a", "b"]))

    async def test_member_avatar(self):
        """头像随成员表上报：图片 data URL 存下、推给网页；别的 URL 和超长的拒掉。"""
        from rh.config import avatar_data_url
        url = avatar_data_url(Role("ju", "橘", "p", avatar="avatars/ju.png"), ROOT)
        self.assertTrue(url.startswith("data:image/png;base64,"))
        async with self.http.put(self.url + "/api/members", json=[{"id": "ju", "name": "橘", "avatar": url}],
                                 headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual(self.hub.members()[0]["avatar"], url)
        for bad in ("javascript:alert(1)", "http://evil.example/a.png", "data:image/png;base64," + "A" * 400_000):
            async with self.http.put(self.url + "/api/members", json=[{"id": "ju", "name": "橘", "avatar": bad}],
                                     headers=AUTH) as r:
                self.assertIn(r.status, (400, 413), bad[:30])


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class HubWeb(HubBase):
    """网页（无头 Chromium）：验收脚本数的东西、转义、重复连接。"""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch()
        self.page = await self.browser.new_page()

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    def web_conns(self):
        return [i for i in self.hub.subs.values() if i["kind"] == "web"]

    async def test_check_counts_speaking_messages_not_heads(self):
        """H2：库里两条 speaking 时，网页只亮一个头，但验收脚本数到 2 条，能报错。"""
        self.hub.set_members([{"id": "a", "name": "A"}, {"id": "b", "name": "B"}])
        for who in ("a", "b"):
            self.hub.create(1, {"text": "在说", "author_kind": "role", "author": who, "name": who.upper()})
        await self.open()
        self.assertEqual(await self.page.locator(".head.speaking").count(), 1)
        self.assertEqual(sorted(await speaking_now(self.page)), ["A", "B"])

    async def test_avatar_shown_in_head(self):
        """网页虚拟头显示角色头像。"""
        from rh.config import avatar_data_url
        url = avatar_data_url(Role("ju", "橘", "p", avatar="avatars/ju.png"), ROOT)
        self.hub.set_members([{"id": "ju", "name": "橘", "avatar": url}, {"id": "b", "name": "B"}])
        await self.open()
        self.assertEqual(await self.page.locator("#head-ju img.face").count(), 1)
        self.assertGreater(await self.page.eval_on_selector("#head-ju img.face", "e => e.naturalWidth"), 0)
        self.assertEqual(await self.page.locator("#head-b img.face").count(), 0)

    async def test_rejected_keeps_input_and_shows_error(self):
        """原单机版复审 C：发送被拒（413）时保留输入框内容并提示；正常发送清空输入框和提示。"""
        await self.open()
        long_text = "长" * 4000   # 约 12KB，超过请求体上限
        await self.page.fill("#in", long_text)
        await self.page.click("#f button")
        await self.page.wait_for_function("document.getElementById('err').textContent !== ''", timeout=5000)
        self.assertEqual(await self.page.input_value("#in"), long_text)
        self.assertIn("没发出去", await self.page.text_content("#err"))
        await self.page.fill("#in", "正常话题")
        await self.page.click("#f button")
        await self.page.wait_for_function("document.getElementById('in').value === ''", timeout=5000)
        self.assertEqual(await self.page.text_content("#err"), "")

    async def test_member_id_cannot_inject_attribute(self):
        """L1：成员 id 里的引号被转义，不能往 HTML 属性里注入。"""
        self.hub.set_members([{"id": 'x" data-pwn="1', "name": "X"}])
        await self.open()
        self.assertEqual(await self.page.locator("[data-pwn]").count(), 0)
        self.assertEqual(await self.page.locator(".head").count(), 1)

    async def test_relogin_while_reconnect_pending_one_connection(self):
        """L4：断线重连还在等时重新登录，只留一条连接。"""
        await self.open()
        await wait_for(lambda: len(self.web_conns()) == 1, what="网页连上")
        await self.page.evaluate("""() => { ws.close();
            document.getElementById('tok').value = %s;
            document.getElementById('login').dispatchEvent(new Event('submit', {cancelable: true})); }""" % json.dumps(TOKEN))
        await asyncio.sleep(1.5)   # 网页首次重连等 1 秒（hub.html 的 RETRY_MIN），等它过去
        self.assertEqual(len(self.web_conns()), 1)


class HostClient(HubBase):
    """本地角色主机连 hub：收到用户消息开讨论、发言发回云端；断线重连、重启都补话题。"""

    def make_host(self, max_turns=3):
        brains = {r.id: FakeBrain(r.name) for r in ROLES}
        m = Meeting(ROLES, brains, max_turns, 1000.0, sleep_scale=0.01)
        host = Host(m, self.url, TOKEN, self.dir / "host-state.json", reconnect_min=0.05, reconnect_max=0.2)
        return host, m, brains

    async def start_host(self, **kw):
        host, m, brains = self.make_host(**kw)
        task = asyncio.create_task(host.run())
        await wait_for(host.connected.is_set, what="角色主机连上")
        return host, task, m

    async def stop_host(self, host, task, m):
        host.stop()
        await asyncio.wait_for(task, 5)
        await asyncio.get_running_loop().run_in_executor(None, m.wait_idle, 5)

    def topic_done(self, after_id=0):
        return lambda: any(r["author_kind"] == "system" and r["id"] > after_id for r in self.rows())

    async def test_topic_round_trip_one_speaker(self):
        watcher = await self.web_client(); await self.recv(watcher)
        host, task, m = await self.start_host()
        status, um = await self.post("话题一")
        await wait_for(self.topic_done(), what="讨论结束")
        roles = [(r["author"], r["status"]) for r in self.rows(author_kind="role")]
        self.assertEqual(roles, [("a", "done"), ("b", "done"), ("c", "done")])
        self.assertEqual([x["id"] for x in self.hub.members()], ["a", "b", "c"])
        # 网页收到的推送里，任何时刻最多一条“在说”
        speaking, worst = set(), 0
        while True:
            try:
                ev = await self.recv(watcher, timeout=0.3)
            except asyncio.TimeoutError:
                break
            if ev["type"] != "message":
                continue
            msg = ev["message"]
            (speaking.add if msg["status"] == "speaking" else speaking.discard)(msg["id"])
            worst = max(worst, len(speaking))
        self.assertEqual(worst, 1)
        await self.stop_host(host, task, m)

    async def test_lost_response_retry_no_duplicate(self):
        """H1：POST 已写库但响应丢了，host 重试同一条，云端不出重复消息，也没有卡住的“在说”。"""
        host, m, _ = self.make_host()
        real_req, lost = host._req, []

        async def flaky(http, method, path, body):
            got = await real_req(http, method, path, body)
            if method == "POST" and not lost:   # 第一条发言：云端收到了，但当作超时
                lost.append(body)
                raise asyncio.TimeoutError()
            return got
        host._req = flaky
        task = asyncio.create_task(host.run())
        await wait_for(host.connected.is_set, what="角色主机连上")
        await self.post("话题一")
        await wait_for(self.topic_done(), what="讨论结束")
        await asyncio.sleep(0.1)
        self.assertTrue(lost)
        roles = [(r["author"], r["status"]) for r in self.rows(author_kind="role")]
        self.assertEqual(roles, [("a", "done"), ("b", "done"), ("c", "done")])
        await self.stop_host(host, task, m)

    async def test_second_host_replaces_first(self):
        """M1：开了两个角色主机时只留新的一个，旧的退出；一个话题只有一份回复。"""
        _, rm = await self.post("旧主机留下的", author_kind="role", author="a", name="A")
        host1, task1, m1 = await self.start_host()
        self.assertEqual(self.hub.message(rm["id"])["status"], "interrupted")   # host 连上时清掉残留
        host2, task2, m2 = await self.start_host()
        await asyncio.wait_for(task1, 5)   # 旧的自己退出，不重连
        self.assertEqual([i["kind"] for i in self.hub.subs.values()], ["host"])
        await self.post("话题一")
        await wait_for(self.topic_done(rm["id"]), what="讨论结束")
        await asyncio.sleep(0.2)
        self.assertEqual([r["author"] for r in self.rows(author_kind="role") if r["id"] > rm["id"]], ["a", "b", "c"])
        self.assertEqual([r.text for r in m1.messages if r.author == "user"], [])
        await self.stop_host(host2, task2, m2)

    async def test_stale_cursor_after_hub_db_wiped(self):
        """M2：云端库被清空，本机已读位置还是旧的大数字，host 要自动重置，否则新话题全被忽略。"""
        (self.dir / "host-state.json").write_text(json.dumps({"cursor": 500}))
        host, task, m = await self.start_host()
        self.assertEqual(host.cursor, 0)
        await self.post("库清空后的话题")
        await wait_for(self.topic_done(), what="讨论结束")
        self.assertEqual([r.text for r in m.messages if r.author == "user"], ["库清空后的话题"])
        await self.stop_host(host, task, m)

    async def test_cursor_saved_after_handoff(self):
        """L2：已读位置在消息交给 meeting 之后才落盘，中间被杀不会丢消息。"""
        host, task, m = await self.start_host()
        state = self.dir / "host-state.json"
        seen = []
        m.user_say = lambda text: seen.append(json.loads(state.read_text())["cursor"])
        _, um = await self.post("话题一")
        await wait_for(lambda: seen, what="交给 meeting")
        self.assertLess(seen[0], um["id"])
        await wait_for(lambda: json.loads(state.read_text())["cursor"] == um["id"], what="之后落盘")
        await self.stop_host(host, task, m)

    async def test_ready_timeout_reconnects(self):
        """L5：云端接了 WebSocket 却不回 ready，host 不卡死，超时后重连。"""
        hits = []

        async def silent_ws(request):
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            hits.append(1)
            async for _ in ws:
                pass
            return ws
        app = web.Application()
        app.add_routes([web.get("/ws/host", silent_ws)])
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        url = f"http://127.0.0.1:{runner.addresses[0][1]}"
        m = Meeting(ROLES, {r.id: FakeBrain(r.name) for r in ROLES}, 3, 1000.0, sleep_scale=0.01)
        host = Host(m, url, TOKEN, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2)
        host.ready_timeout = 0.2
        task = asyncio.create_task(host.run())
        try:
            await wait_for(lambda: len(hits) >= 2, what="超时后重连")
        finally:
            host.stop()
            await asyncio.wait_for(task, 5)
            await runner.cleanup()

    async def test_inflight_start_after_disconnect_gets_interrupted(self):
        """复审中-1：“开始说话”已发出，回来前主机断线过（讨论已停、说完事件已作废），这条要补成被打断。"""
        host, m, _ = self.make_host()
        real_req, hit = host._req, []

        async def late(http, method, path, body):
            got = await real_req(http, method, path, body)
            if method == "POST" and body.get("status") == "speaking" and not hit:
                hit.append(got["id"])
                m.stop(); host._gen += 1; host._hub_ids.clear()   # 同 run() 里断线时的处理顺序
            return got
        host._req = late
        task = asyncio.create_task(host.run())
        await wait_for(host.connected.is_set, what="角色主机连上")
        await self.post("话题一")
        await wait_for(lambda: hit and self.hub.message(hit[0])["status"] != "speaking", timeout=2,
                       what="路上那条被补成被打断")
        self.assertEqual(self.hub.message(hit[0])["status"], "interrupted")
        await self.stop_host(host, task, m)

    async def test_kicked_host_inflight_start_gets_interrupted(self):
        """复审中-1：被新主机踢掉的旧主机，踢之前发出、踢之后才到云端的“开始说话”要补成被打断。"""
        host1, m1, _ = self.make_host()
        real_req, hit = host1._req, []

        async def slow(http, method, path, body):
            if method == "POST" and body.get("status") == "speaking" and not hit:
                hit.append(0)
                await host1._stop.wait()   # 在路上卡到旧主机被踢
                got = await real_req(http, method, path, body)
                hit[0] = got["id"]
                return got
            return await real_req(http, method, path, body)
        host1._req = slow
        task1 = asyncio.create_task(host1.run())
        await wait_for(host1.connected.is_set, what="旧主机连上")
        await self.post("话题一")
        await wait_for(lambda: hit, what="旧主机开始发")
        host2, task2, m2 = await self.start_host()
        await asyncio.wait_for(task1, 5)
        self.assertTrue(hit[0])
        self.assertEqual(self.hub.message(hit[0])["status"], "interrupted")
        await self.stop_host(host2, task2, m2)

    async def test_first_start_does_not_replay_history(self):
        await self.post("很早以前的话题")
        host, task, m = await self.start_host()
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(author_kind="role"), [])
        await self.stop_host(host, task, m)

    async def test_hub_restart_reconnects_and_catches_up(self):
        host, task, m = await self.start_host()
        await self.post("话题一")
        await wait_for(self.topic_done(), what="第一个话题")
        last = max(r["id"] for r in self.rows())
        await self.stop_hub()
        await wait_for(lambda: not host.connected.is_set(), what="角色主机发现掉线")
        # 云端重启期间（角色主机连不上）有人发了新话题：直接写库，再开端口
        hub2 = Hub(self.db, TOKEN)
        hub2.create(1, {"text": "断线期间的话题"})
        hub2.db.close()
        await self.start_hub()
        await wait_for(host.connected.is_set, what="重连")
        await wait_for(self.topic_done(last), what="补上的话题讨论完")
        users = [r.text for r in m.messages if r.author == "user"]
        self.assertEqual(users, ["话题一", "断线期间的话题"])
        await self.stop_host(host, task, m)

    async def test_disconnect_stops_local_discussion(self):
        """M4：断线时本机讨论停掉；重连后补上的新话题后面不会跟着旧话题的发言。"""
        brains = {r.id: FakeBrain(r.name) for r in ROLES}
        # 每句“在说”约 0.5 秒（FakeBrain 的话 12 字 / 24 字每秒），断线时旧话题还没讲完。
        m = Meeting(ROLES, brains, 3, 24.0)
        host = Host(m, self.url, TOKEN, self.dir / "host-state.json", reconnect_min=0.05, reconnect_max=0.2)
        task = asyncio.create_task(host.run())
        await wait_for(host.connected.is_set, what="角色主机连上")
        await self.post("旧话题")
        await wait_for(lambda: self.rows(author_kind="role"), what="第一句开始")
        await self.stop_hub()
        await wait_for(lambda: not host.connected.is_set(), what="角色主机发现掉线")
        n = len(m.messages)
        await asyncio.sleep(1.2)   # 没停的话这段时间会再说两句
        self.assertIsNone(m.speaking())
        self.assertEqual(len(m.messages), n)
        hub2 = Hub(self.db, TOKEN)
        new_id = hub2.create(1, {"text": "断线期间的新话题"})[0]["id"]
        hub2.db.close()
        await self.start_hub()
        await wait_for(self.topic_done(new_id), what="新话题讨论完")
        await asyncio.sleep(0.3)
        rows = self.rows(author_kind="role")
        self.assertEqual([r["status"] for r in rows if r["id"] < new_id], ["interrupted"])
        self.assertEqual([(r["author"], r["status"]) for r in rows if r["id"] > new_id],
                         [("a", "done"), ("b", "done"), ("c", "done")])
        await self.stop_host(host, task, m)

    async def test_host_restart_catches_up(self):
        host, task, m = await self.start_host()
        await self.post("话题一")
        await wait_for(self.topic_done(), what="第一个话题")
        await self.stop_host(host, task, m)
        last = max(r["id"] for r in self.rows())
        await self.post("主机关着时的话题A")
        await self.post("主机关着时的话题B")
        host2, task2, m2 = await self.start_host()   # 新进程：新 meeting，已读位置从文件读
        await wait_for(self.topic_done(last), what="补上的话题讨论完")
        self.assertEqual([r.text for r in m2.messages if r.author == "user"], ["主机关着时的话题A", "主机关着时的话题B"])
        roles = [r for r in self.rows(author_kind="role") if r["id"] > last]
        self.assertEqual([r["author"] for r in roles], ["a", "b", "c"])   # 两条一起补，只开一轮
        await self.stop_host(host2, task2, m2)


if __name__ == "__main__":
    unittest.main()
