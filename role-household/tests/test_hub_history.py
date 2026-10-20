"""历史与未读（用户 2026-10-20「你可以去修一下自建平台，那边感觉还是很垃圾」；差距调研 /tmp/rh-gap/msg.md、ux.md）：
hub 按 id 向前翻页、搜索、每个频道的已读位置；网页滚到顶加载更早、搜索框、增量渲染、未读分割线 / 新消息浮条 / 标题未读数。"""
from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.hub import HISTORY_LIMIT
from rh.meeting import MAX_TEXT_CHARS
from tests.test_hub import AUTH, TOKEN, HubBase, async_playwright, wait_for


class HistoryBase(HubBase):
    def seed(self, n, start=1, kind="user"):
        """直接往库里灌 n 条（不走 HTTP，快）。正文“消息 k”。"""
        body = {"author_kind": "role", "author": "a", "name": "A", "status": "done"} if kind == "role" else {}
        return [self.hub.create(1, {"text": f"消息 {k}", **body})[0]["id"] for k in range(start, start + n)]

    async def get(self, room=1, headers=AUTH, **params):
        async with self.http.get(f"{self.url}/api/rooms/{room}/messages", params=params, headers=headers) as r:
            return r.status, (await r.json() if r.status == 200 else await r.text())


class HubHistoryApi(HistoryBase):
    async def test_page_before(self):
        """不带 before 给最新一页；带 before 给它之前的一页（旧到新）；到头 has_more 为假。"""
        ids = self.seed(HISTORY_LIMIT * 2 + 50)
        s, p1 = await self.get()
        self.assertEqual(s, 200)
        self.assertEqual([m["id"] for m in p1["messages"]], ids[-HISTORY_LIMIT:])
        self.assertTrue(p1["has_more"])
        _, p2 = await self.get(before=ids[-HISTORY_LIMIT])
        self.assertEqual([m["id"] for m in p2["messages"]], ids[50:50 + HISTORY_LIMIT])
        self.assertTrue(p2["has_more"])
        _, p3 = await self.get(before=ids[50])
        self.assertEqual([m["id"] for m in p3["messages"]], ids[:50])
        self.assertFalse(p3["has_more"])
        _, small = await self.get(before=ids[50], limit=10)
        self.assertEqual([m["id"] for m in small["messages"]], ids[40:50])
        self.assertTrue(small["has_more"])

    async def test_page_bad_params(self):
        self.seed(3)
        for params in ({"before": "x"}, {"before": "-1"}, {"limit": "0"}, {"limit": str(HISTORY_LIMIT + 1)},
                       {"limit": "x"}, {"q": ""}, {"q": "x" * (MAX_TEXT_CHARS + 1)}, {"q": "   "}):
            self.assertEqual((await self.get(**params))[0], 400, params)
        self.assertEqual((await self.get(room=99))[0], 404)
        self.assertEqual((await self.get(headers={}))[0], 401)

    async def test_search(self):
        """搜正文，新到旧；LIKE 的 % _ 当普通字符；分页同 before。"""
        self.seed(30)
        self.hub.create(1, {"text": "100% 海边"})
        self.hub.create(1, {"text": "a_b"})
        _, r = await self.get(q="消息 2")
        self.assertEqual([m["text"] for m in r["messages"]], ["消息 29", "消息 28", "消息 27", "消息 26", "消息 25",
                                                             "消息 24", "消息 23", "消息 22", "消息 21", "消息 20", "消息 2"])
        self.assertFalse(r["has_more"])
        _, r = await self.get(q="%")
        self.assertEqual([m["text"] for m in r["messages"]], ["100% 海边"])
        _, r = await self.get(q="_")
        self.assertEqual([m["text"] for m in r["messages"]], ["a_b"])
        _, r = await self.get(q="消息 1", limit=3)
        self.assertEqual([m["text"] for m in r["messages"]], ["消息 19", "消息 18", "消息 17"])
        self.assertTrue(r["has_more"])
        _, r2 = await self.get(q="消息 1", limit=3, before=r["messages"][-1]["id"])
        self.assertEqual([m["text"] for m in r2["messages"]], ["消息 16", "消息 15", "消息 14"])

    async def test_read_marker(self):
        """每个频道一个已读位置：第一次连上时从当前最新算起（老消息不算未读）；只增不减；推给同频道网页；
        未读数只数别人（角色、系统）的消息。"""
        self.seed(5)
        ws = await self.web_client()
        ready = await self.recv(ws)
        self.assertEqual((ready["last_read"], ready["unread"]), (ready["last_id"], 0))
        rid = self.seed(3, start=6, kind="role")
        self.seed(1, start=9)   # 用户自己发的不算
        ws2 = await self.web_client()
        r2 = await self.recv(ws2)
        self.assertEqual((r2["last_read"], r2["unread"]), (ready["last_id"], 3))
        async with self.http.post(f"{self.url}/api/rooms/1/read", json={"last_read": rid[1]}, headers=AUTH) as r:
            self.assertEqual((r.status, (await r.json())["last_read"]), (200, rid[1]))
        ev = await self.recv(ws2)
        self.assertEqual((ev["type"], ev["room"], ev["last_read"]), ("read", 1, rid[1]))
        async with self.http.post(f"{self.url}/api/rooms/1/read", json={"last_read": rid[0]}, headers=AUTH) as r:
            self.assertEqual((await r.json())["last_read"], rid[1])   # 不往回退
        async with self.http.post(f"{self.url}/api/rooms/1/read", json={"last_read": 10 ** 9}, headers=AUTH) as r:
            self.assertEqual((await r.json())["last_read"], self.hub.last_id(1))   # 不超过最新
        for bad in ({"last_read": "x"}, {"last_read": -1}, {"last_read": True}, []):
            async with self.http.post(f"{self.url}/api/rooms/1/read", json=bad, headers=AUTH) as r:
                self.assertEqual(r.status, 400, bad)
        async with self.http.post(f"{self.url}/api/rooms/99/read", json={"last_read": 1}, headers=AUTH) as r:
            self.assertEqual(r.status, 404)


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class HubWebHistory(HistoryBase):
    """网页（无头 Chromium，静音）。"""
    VIEW = {"width": 1100, "height": 800}

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(args=["--mute-audio"])
        self.page = await self.browser.new_page(viewport=self.VIEW)

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    async def count(self, sel=".msg"):
        return await self.page.locator(f"#log {sel}").count()

    async def to_top(self):
        await self.page.evaluate("document.getElementById('log').scrollTop = 0; "
                                 "document.getElementById('log').dispatchEvent(new Event('scroll'))")

    async def test_scroll_top_loads_older(self):
        """灌 450 条：先显示最近 200；滚到顶自动加载更早的，直到第 1 条；加载后视野不跳（原来最上面那条还在原处）。"""
        n = HISTORY_LIMIT * 2 + 50
        self.seed(n)
        await self.open()
        self.assertEqual(await self.count(), HISTORY_LIMIT)
        # 滚到顶的同一刻记下最上面那条的 id 和屏幕位置（加载是异步的，这时还没加载）
        before = await self.page.evaluate("""() => { const l = document.getElementById('log'); l.scrollTop = 0;
            const e = l.querySelector(':scope > .msg'), top = e.getBoundingClientRect().top;
            l.dispatchEvent(new Event('scroll')); return [e.dataset.id, top]; }""")
        await self.page.wait_for_function(f"document.querySelectorAll('#log .msg').length === {HISTORY_LIMIT * 2}",
                                          timeout=5000)
        # 视野不跳：原来最上面那条（可能被重画过，按 id 找）前后只差几个像素
        after = await self.page.evaluate(
            "id => document.querySelector(`#log .msg[data-id='${id}']`).getBoundingClientRect().top", before[0])
        self.assertLessEqual(abs(after - before[1]), 2, (before, after))
        for _ in range(5):
            await self.to_top()
            if await self.count() == n:
                break
            await self.page.wait_for_timeout(300)
        await self.page.wait_for_function(f"document.querySelectorAll('#log .msg').length === {n}", timeout=5000)
        self.assertEqual(await self.page.text_content("#log .msg .text"), "消息 1")
        self.assertIn("开头", await self.page.text_content("#logtop"))

    async def test_incremental_keeps_selection(self):
        """新消息只追加、状态变化只换那一条：别的消息的节点不重建，选中的文字不被冲掉。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(5)
        await self.open()
        await self.page.evaluate("""() => { const t = document.querySelectorAll('#log .msg .text')[1];
            window.__keep = t; const r = document.createRange(); r.selectNodeContents(t);
            getSelection().removeAllRanges(); getSelection().addRange(r); }""")
        self.assertEqual(await self.page.evaluate("getSelection().toString()"), "消息 2")
        _, rm = await self.post("说到一半", author_kind="role", author="a", name="A")
        await self.page.wait_for_selector("#log .msg.speaking")
        async with self.http.patch(f"{self.url}/api/messages/{rm['id']}", json={"status": "done"}, headers=AUTH):
            pass
        await self.page.wait_for_selector("#log .msg.done")
        await self.post("又一条")
        await self.page.wait_for_function("document.querySelectorAll('#log .msg').length === 7")
        self.assertTrue(await self.page.evaluate("window.__keep.isConnected"))
        self.assertEqual(await self.page.evaluate("getSelection().toString()"), "消息 2")

    async def test_unread_divider_bar_title(self):
        """离开期间来的角色消息：打开时有未读分割线、标题带未读数、浮条写 N 条新消息；
        滚到底标为已读（hub 记下）；上翻时再来新消息又出浮条，点浮条跳到底。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        old = self.seed(60)
        self.hub.last_read(1)            # 第一次：从当前最新算起
        new = self.seed(40, start=61, kind="role")
        await self.open()
        self.assertEqual(await self.page.title(), "(40) 角色小家")
        self.assertEqual(await self.page.locator("#log .newdiv").count(), 1)
        first_new = await self.page.evaluate("document.querySelector('#log .newdiv').nextElementSibling.dataset.id")
        self.assertEqual(int(first_new), new[0])
        self.assertTrue(await self.page.is_visible("#newbar"))
        self.assertIn("40 条新消息", await self.page.text_content("#newbar"))
        self.assertEqual(self.hub.last_read(1), old[-1])   # 没看到底，不算读过
        await self.page.click("#newbar")
        await wait_for(lambda: self.hub.last_read(1) == new[-1], what="标为已读")
        await self.page.wait_for_function("document.title === '角色小家'")
        self.assertFalse(await self.page.is_visible("#newbar"))
        self.assertEqual(await self.page.locator("#log .newdiv").count(), 1)   # 分割线留着，看得出从哪开始是新的
        # 上翻时来新消息
        await self.to_top()
        await self.page.wait_for_timeout(200)
        await self.page.evaluate("document.getElementById('log').scrollTop = 0")
        await self.post("又来一条", author_kind="role", author="a", name="A", status="done")
        await self.page.wait_for_function("document.getElementById('newbar').offsetParent !== null")
        self.assertIn("1 条新消息", await self.page.text_content("#newbar"))
        self.assertEqual(await self.page.title(), "(1) 角色小家")
        await self.page.click("#newbar")
        await self.page.wait_for_function("document.title === '角色小家'")
        self.assertTrue(await self.page.evaluate(
            "(() => { const l = document.getElementById('log'); return l.scrollTop + l.clientHeight >= l.scrollHeight - 2; })()"))

    async def test_search_box_jumps_to_old_message(self):
        """搜索框：回车出结果（新到旧，命中处高亮）；点一条很早的消息，往上加载到它并滚过去高亮。"""
        self.seed(HISTORY_LIMIT + 100)
        self.hub.create(1, {"text": "后来又说 消息 1 结束"})
        await self.open()
        await self.page.fill("#q", "消息 1")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results .hit")
        hits = await self.page.eval_on_selector_all("#results .hit .text", "els => els.map(e => e.textContent)")
        self.assertEqual(hits[0], "后来又说 消息 1 结束")
        self.assertEqual(hits[-1], "消息 1")
        self.assertGreater(await self.page.locator("#results .hit mark").count(), 0)
        await self.page.locator("#results .hit").last.click()
        await self.page.wait_for_selector("#log .msg.flash")
        self.assertEqual(await self.page.text_content("#log .msg.flash .text"), "消息 1")
        self.assertTrue(await self.page.locator("#log .msg.flash").is_visible())
        self.assertTrue(await self.page.evaluate("""(() => { const e = document.querySelector('#log .msg.flash').getBoundingClientRect(),
            l = document.getElementById('log').getBoundingClientRect(); return e.top >= l.top && e.bottom <= l.bottom; })()"""))

    async def test_reconnect_keeps_older_pages(self):
        """断线重连只补缺的（since），已经往上加载的更早消息不丢、不整页重建。"""
        self.seed(HISTORY_LIMIT + 20)
        await self.open()
        await self.to_top()
        await self.page.wait_for_function(f"document.querySelectorAll('#log .msg').length === {HISTORY_LIMIT + 20}")
        await self.page.evaluate("window.__first = document.querySelector('#log .msg')")
        await self.page.evaluate("ws.close()")
        await self.post("断线时来的")
        await self.page.wait_for_function("[...document.querySelectorAll('#log .msg .text')].some(e => e.textContent === '断线时来的')",
                                          timeout=8000)
        self.assertEqual(await self.count(), HISTORY_LIMIT + 21)
        self.assertTrue(await self.page.evaluate("window.__first.isConnected"))

    # ---------- 审查裁决（rh-plat-2 审查）----------
    async def test_unread_over_a_page(self):
        """裁决 1：未读超过一页（250 条）时计数以云端为准，不重复数；分割线等加载到真正的第一条未读再放上去并停在那。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(60)
        self.hub.last_read(1)
        new = self.seed(250, start=61, kind="role")
        await self.open()
        await self.page.wait_for_selector("#log .newdiv", timeout=8000)
        first = await self.page.evaluate("document.querySelector('#log .newdiv').nextElementSibling.dataset.id")
        self.assertEqual(int(first), new[0])
        self.assertEqual(await self.page.title(), "(250) 角色小家")
        self.assertIn("250 条新消息", await self.page.text_content("#newbar"))
        # 分割线在视野里（停在它下面，不被浮条盖住）
        self.assertTrue(await self.page.evaluate("""(() => { const d = document.querySelector('#log .newdiv').getBoundingClientRect(),
            l = document.getElementById('log').getBoundingClientRect(); return d.top >= l.top && d.bottom <= l.bottom; })()"""))
        await self.to_top()   # 再往上加载已读的那部分，数不变
        await self.page.wait_for_function("document.getElementById('logtop').textContent.includes('开头')", timeout=5000)
        self.assertEqual(await self.page.title(), "(250) 角色小家")

    async def test_has_more_from_server(self):
        """裁决 2：更早还有没有看云端给的 has_more：正好一页时不再白发一次请求，直接显示频道开头。"""
        self.seed(HISTORY_LIMIT)
        gets = []
        self.page.on("request", lambda r: gets.append(r.url) if "/messages" in r.url and r.method == "GET" else None)
        await self.open()
        await self.to_top()
        await self.page.wait_for_timeout(500)
        self.assertEqual(gets, [])
        self.assertIn("开头", await self.page.text_content("#logtop"))

    async def test_hello_room_and_room_switch(self):
        """裁决 2：hello 带 room；要连的频道和手上消息不是同一个频道时 since 为 null；
        换频道的 ready（join，多频道分支）来了按新频道重来：sentRead 换成新频道的已读位置。"""
        self.seed(30)
        frames = []
        self.page.on("websocket", lambda w: w.on("framesent", lambda f: frames.append(f)))
        await self.open()
        await wait_for(lambda: self.hub.last_read(1) == 30, what="看到底标已读")
        await self.page.evaluate("ws.close()")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=8000)
        hellos = [json.loads(f) for f in frames if '"hello"' in f]
        self.assertNotIn("room", hellos[0])           # 第一次不知道在哪个频道，hub 给默认频道
        self.assertEqual((hellos[1]["room"], hellos[1]["since"]), (1, 30))
        self.assertEqual(await self.page.evaluate("helloFrame(1).since"), 30)
        self.assertIsNone(await self.page.evaluate("helloFrame(2).since"))
        await self.page.evaluate("""ws.onmessage({data: JSON.stringify({type: "ready", room: {id: 2, name: "二"}, members: [],
            messages: [{id: 900, room_id: 2, author_kind: "user", author: "user", name: "用户", text: "二频道", status: "user",
                        spoken: null, created_at: 1, updated_at: 1}], last_id: 900, last_read: 5, unread: 0, has_more: false})})""")
        self.assertEqual(await self.page.evaluate("[sentRead, room, [...msgs.keys()]]"), [5, 2, [900]])
        self.assertEqual(await self.page.eval_on_selector_all("#log .msg .text", "els => els.map(e => e.textContent)"), ["二频道"])

    async def test_read_post_failure_retries(self):
        """裁决 6：已读上报回了非 2xx，之后要重报。"""
        self.seed(3)
        self.hub.last_read(1)
        ids = self.seed(3, start=4, kind="role")
        calls = []

        async def flaky(route):
            calls.append(1)
            if len(calls) == 1:
                await route.fulfill(status=500, body="boom")
            else:
                await route.continue_()
        await self.page.route("**/api/rooms/1/read", flaky)
        await self.open()
        await wait_for(lambda: len(calls) >= 1, what="第一次上报")
        await self.page.evaluate("document.getElementById('log').dispatchEvent(new Event('scroll'))")
        await wait_for(lambda: self.hub.last_read(1) == ids[-1], what="重报成功")

    async def test_load_older_failure_backoff(self):
        """裁决 7：加载更早的失败后退避，不是每次滚动都发；错误提示不被重画冲掉。"""
        self.seed(HISTORY_LIMIT + 50)
        calls = []

        async def fail(route):
            calls.append(route.request.url)
            await route.fulfill(status=500, body="boom")
        await self.page.route("**/api/rooms/1/messages?*", fail)
        await self.open()
        for _ in range(6):
            await self.to_top()
            await self.page.wait_for_timeout(80)
        await self.post("来一条触发重画")
        await self.page.wait_for_function("[...document.querySelectorAll('#log .msg .text')].some(e => e.textContent === '来一条触发重画')")
        await self.to_top()
        self.assertEqual(len(calls), 1, calls)
        self.assertIn("没加载出来", await self.page.text_content("#logtop"))

    async def test_search_drops_stale_results(self):
        """裁决 8：先搜的慢、后搜的快，慢的回来时丢掉，只显示后一次的结果。"""
        self.seed(5)
        self.hub.create(1, {"text": "慢慢来"})

        async def slow(route):
            if "q=%E6%85%A2" in route.request.url:
                await asyncio.sleep(1.0)
            await route.continue_()
        await self.page.route("**/api/rooms/1/messages?*", slow)
        await self.open()
        await self.page.fill("#q", "慢")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_timeout(100)
        await self.page.fill("#q", "消息 1")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_timeout(1500)
        hits = await self.page.eval_on_selector_all("#results .hit .text", "els => els.map(e => e.textContent)")
        self.assertEqual(hits, ["消息 1"])
        self.assertEqual(await self.page.text_content("#results .sum"), "1 条结果")

    async def test_reconnect_restores_speaking_status(self):
        """裁决 9：断线时“在说”的那条说完了，重连后补回它的新状态。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(3)
        _, rm = await self.post("说到一半", author_kind="role", author="a", name="A")
        await self.open()
        await self.page.wait_for_selector("#log .msg.speaking")
        await self.page.evaluate("ws.close()")
        async with self.http.patch(f"{self.url}/api/messages/{rm['id']}", json={"status": "done"}, headers=AUTH):
            pass
        await self.page.wait_for_selector("#log .msg.done", timeout=8000)
        self.assertEqual(await self.count(".msg.speaking"), 0)


class HubReviewApi(HistoryBase):
    """审查裁决里 hub 这边的。"""

    def add_room(self, name="二"):
        cur = self.hub.db.execute("INSERT INTO rooms(name, created_at) VALUES(?, 0)", (name,))
        self.hub.db.commit()
        return cur.lastrowid

    async def test_before_too_large(self):
        """裁决 3：before 超过 SQLite 整数范围返回 400，不是 500。"""
        self.seed(2)
        for v in (str(2 ** 63), "1" + "0" * 30):
            self.assertEqual((await self.get(before=v))[0], 400, v)
        self.assertEqual((await self.get(before=str(2 ** 63 - 1)))[0], 200)

    async def test_host_ready_does_not_start_read_marker(self):
        """裁决 5：已读起点只看网页：主机连上不在 reads 表里写行，ready 里也不带已读。"""
        self.seed(3)
        host = await self.web_client(kind="host")
        ready = await self.recv(host)
        self.assertNotIn("last_read", ready)
        self.assertEqual(self.hub.db.execute("SELECT COUNT(*) FROM reads").fetchone()[0], 0)
        self.seed(2, start=4, kind="role")
        web = await self.web_client()
        r = await self.recv(web)
        self.assertEqual((r["last_read"], r["unread"]), (5, 0))

    async def test_ready_has_more(self):
        """裁决 2：ready 帧带 has_more（最近一页之前还有没有）。"""
        self.seed(HISTORY_LIMIT)
        a = await self.web_client()
        self.assertFalse((await self.recv(a))["has_more"])
        self.seed(1, start=HISTORY_LIMIT + 1)
        b = await self.web_client()
        self.assertTrue((await self.recv(b))["has_more"])

    async def test_read_markers_per_room(self):
        """裁决 9：两个频道的已读互不影响；已读推送只给那个频道的页面。"""
        r2 = self.add_room()
        self.seed(3)
        for k in range(3):
            self.hub.create(r2, {"text": f"二 {k}"})
        a = await self.web_client()
        ra = await self.recv(a)
        ws2 = await self.http.ws_connect(self.url + "/ws")
        self.ws_list.append(ws2)
        await ws2.send_json({"type": "hello", "token": TOKEN, "kind": "web", "since": None, "room": r2})
        rb = await self.recv(ws2)
        l1, l2 = ra["last_read"], rb["last_read"]
        for k in range(2):
            self.hub.create(r2, {"text": f"角色 {k}", "author_kind": "role", "author": "a", "name": "A"})
        self.hub.create(1, {"text": "角色 1", "author_kind": "role", "author": "a", "name": "A"})
        self.assertEqual((self.hub.unread(1), self.hub.unread(r2)), (1, 2))
        async with self.http.post(f"{self.url}/api/rooms/{r2}/read", json={"last_read": self.hub.last_id(r2)},
                                  headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual((self.hub.last_read(1), self.hub.unread(1), self.hub.unread(r2)), (l1, 1, 0))
        self.assertGreater(self.hub.last_read(r2), l2)
        ev = await self.recv(ws2)
        self.assertEqual((ev["type"], ev["room"]), ("read", r2))
        with self.assertRaises(asyncio.TimeoutError):
            await self.recv(a, timeout=0.3)


if __name__ == "__main__":
    unittest.main()
