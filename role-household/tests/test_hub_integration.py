"""集成分支（plat-integration）的跨分支语义：手机布局/断线重连/发送中（feat/plat-mobile）和
历史翻页/增量渲染/未读（feat/plat-history）等合在一起后的行为。无头 Chromium 静音（--mute-audio），只连本地 hub。"""
from __future__ import annotations

import asyncio
import unittest

from rh.hub import HISTORY_LIMIT
from tests.test_hub import AUTH, wait_for
from tests.test_hub_history import HistoryBase
from tests.test_hub_mobile import DESKTOP, PHONE, WebBase
from tests.test_cloudweb import CloudWebBase
from rh.hub import session_key

URL = "**/api/rooms/*/messages"


class MobileHistoryDesktop(WebBase, HistoryBase):
    VIEWPORT = DESKTOP

    async def texts(self):
        return await self.page.eval_on_selector_all("#log .msg .text", "es => es.map(e => e.textContent)")

    async def load_all_older(self, n):
        for _ in range(10):
            await self.page.evaluate("document.getElementById('log').scrollTop = 0; "
                                     "document.getElementById('log').dispatchEvent(new Event('scroll'))")
            if await self.page.locator("#log .msg").count() >= n:
                return
            await self.page.wait_for_timeout(200)
        self.fail("没加载到全部更早消息")

    async def test_pending_row_with_older_pages_and_new_message(self):
        """往上翻出更早的之后发一条：发送中那行在最后，更早的节点不重建；发送中时别人来了新消息，
        发送中那行仍排在最后；发成后只剩一条正式消息，按 id 排在新消息之后。"""
        self.seed(HISTORY_LIMIT + 20)
        await self.open()
        await self.load_all_older(HISTORY_LIMIT + 20)
        await self.page.evaluate("window.__first = document.querySelector('#log .msg')")
        hold = asyncio.Event()

        async def slow(route):
            if route.request.method != "POST":
                return await route.continue_()
            await hold.wait()
            await route.continue_()
        await self.page.route(URL, slow)
        await self.page.fill("#in", "我发的")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector("#log .msg.pending", timeout=3000)
        self.assertEqual((await self.texts())[-1], "我发的")
        await self.post("别人刚说的", author_kind="role", author="a", name="A", status="done")   # 走 HTTP，hub 推给网页
        await self.page.wait_for_function("[...document.querySelectorAll('#log .msg .text')].some(e => e.textContent === '别人刚说的')")
        t = await self.texts()
        self.assertEqual(t[-2:], ["别人刚说的", "我发的"])
        self.assertTrue(await self.page.evaluate("document.querySelector('#log .msg:last-of-type').classList.contains('pending')"))
        hold.set()
        await self.page.wait_for_selector("#log .msg.pending", state="detached", timeout=5000)
        t = await self.texts()
        self.assertEqual(t[-2:], ["别人刚说的", "我发的"])
        self.assertEqual(t.count("我发的"), 1)
        self.assertEqual(len(t), HISTORY_LIMIT + 22)
        self.assertTrue(await self.page.evaluate("window.__first.isConnected"))

    async def test_failed_row_survives_reconnect_merge(self):
        """没发出去那行在断线重连（since 只补缺的）后还在，重试成功后变成一条正式消息。"""
        self.seed(5)
        await self.open()
        await self.page.route(URL, lambda route: route.abort() if route.request.method == "POST" else route.continue_())
        await self.page.fill("#in", "没发出去的")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector("#log .msg.failed .retry", timeout=5000)
        await self.page.evaluate("ws.close()")
        self.hub.create(1, {"text": "断线时来的"})
        await self.page.wait_for_function("[...document.querySelectorAll('#log .msg .text')].some(e => e.textContent === '断线时来的')",
                                          timeout=8000)
        self.assertEqual((await self.texts())[-2:], ["断线时来的", "没发出去的"])
        self.assertEqual(await self.page.locator("#log .msg.failed").count(), 1)
        self.assertEqual((await self.hellos())[-1], 5)   # since = 断线前收到过的最大 id，不是整表重取
        await self.page.unroute(URL)
        await self.page.click("#log .msg.failed .retry")
        await self.page.wait_for_selector("#log .msg.failed, #log .msg.pending", state="detached", timeout=5000)
        self.assertEqual((await self.texts())[-2:], ["断线时来的", "没发出去的"])

    async def test_newbar_below_banner(self):
        """断线横幅和新消息浮条同时出现时，浮条在横幅下面，不盖住它。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(60)
        self.hub.last_read(1)
        self.seed(40, start=61, kind="role")
        await self.open()
        await self.page.wait_for_selector("#newbar", state="visible")
        await self.page.evaluate("retry = 60000")
        await self.stop_hub()
        await self.page.wait_for_selector("#banner", state="visible", timeout=5000)
        self.assertTrue(await self.in_view("#banner"))
        self.assertTrue(await self.in_view("#newbar"))
        b = await self.page.locator("#banner").bounding_box()
        n = await self.page.locator("#newbar").bounding_box()
        self.assertGreaterEqual(n["y"], b["y"] + b["height"] - 0.5)


class MobileHistoryPhone(WebBase, HistoryBase):
    VIEWPORT = PHONE

    async def test_phone_search_box_and_drawers(self):
        """390 宽：搜索框在顶栏看得见、能搜；频道栏、成员栏仍是抽屉（历史分支原来在窄屏把它们 display:none）；
        搜索结果点过去后关掉结果盖层。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(30)
        await self.open()
        for sel in ("#open-search", "#open-left", "#open-right"):   # 顶栏照 Discord 手机版（验收清单第 7 条），闭麦在左抽屉
            self.assertTrue(await self.in_view(sel), sel)
        await self.page.click("#open-left")
        await self.page.wait_for_timeout(350)
        self.assertTrue(await self.in_view("#channels .ch.on"))
        await self.page.keyboard.press("Escape")
        await self.page.wait_for_timeout(350)
        await self.page.click("#open-right")
        await self.page.wait_for_timeout(350)
        self.assertTrue(await self.in_view("#head-a"))
        await self.page.keyboard.press("Escape")
        await self.page.wait_for_timeout(350)
        await self.page.click("#open-search")
        self.assertTrue(await self.in_view("#q"))
        await self.page.fill("#q", "消息 3")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results .hit")
        q = await self.page.locator("#main .top").bounding_box()
        r = await self.page.locator("#results").bounding_box()
        self.assertGreaterEqual(r["y"], q["y"] + q["height"] - 0.5)   # 结果盖层不压住顶栏
        box = await self.page.locator("#q").bounding_box()
        self.assertGreaterEqual(r["y"], box["y"] + box["height"])   # 也不压住搜索框
        await self.page.locator("#results .hit").first.click()
        await self.page.wait_for_selector("#results", state="hidden")
        await self.page.wait_for_selector("#log .msg.flash")


class RoomsHistoryApi(HistoryBase):
    """多频道（feat/plat-rooms）的 Hub.ready() 合入历史分支的 web_ready：join 换频道后的 ready 也带 has_more/未读。"""

    async def test_join_ready_has_more_and_unread(self):
        r2 = self.hub.create_room({"name": "工作"})["id"]
        for k in range(HISTORY_LIMIT + 5):
            self.hub.create(r2, {"text": f"工作 {k}"})
        self.hub.last_read(r2)
        for k in range(3):
            self.hub.create(r2, {"text": f"新 {k}", "author_kind": "role", "author": "a", "name": "A", "status": "done"})
        ws = await self.web_client()
        first = await self.recv(ws)
        self.assertEqual(first["type"], "ready")
        self.assertIn("has_more", first)
        await ws.send_json({"type": "join", "room": r2})
        ready = await self.recv(ws)
        while ready["type"] != "ready":
            ready = await self.recv(ws)
        self.assertEqual(ready["room"]["id"], r2)
        self.assertTrue(ready["has_more"])
        self.assertEqual(ready["unread"], 3)
        self.assertEqual(ready["last_read"], self.hub.last_read(r2))
        await ws.close()

    async def test_host_ready_has_no_read_fields(self):
        """主机（订全部频道）的 ready 不带已读字段，连上也不算用户读过。"""
        ws = await self.web_client(kind="host")
        ready = await self.recv(ws)
        self.assertNotIn("last_read", ready)
        await ws.close()


class RoomsHistoryWeb(WebBase, HistoryBase):
    VIEWPORT = DESKTOP

    async def texts(self):
        return await self.page.eval_on_selector_all("#log .msg .text", "es => es.map(e => e.textContent)")

    async def switch(self, name):
        await self.page.locator("#chlist .ch", has_text=name).click()
        await self.page.wait_for_function(f"document.getElementById('room').textContent === {name!r}", timeout=3000)

    async def test_switch_room_pages_unread_and_reconnect(self):
        """切到另一个频道：能往上翻页（has_more 来自 join 的 ready）、有它自己的未读分割线；
        在这个频道断线重连：hello 带这个频道和 since（不是 null），往上翻出的更早消息不丢。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(3)
        r2 = self.hub.create_room({"name": "工作"})["id"]
        for k in range(HISTORY_LIMIT + 10):
            self.hub.create(r2, {"text": f"工作 {k}"})
        self.hub.last_read(r2)
        self.hub.create(r2, {"text": "工作新消息", "author_kind": "role", "author": "a", "name": "A", "status": "done"})
        await self.open()
        await self.switch("工作")
        await self.page.wait_for_selector("#log .newdiv")
        # 唯一一条未读就在底部，停在分割线即看到底：已读记到工作频道，大厅的不动
        newest = self.hub.history(r2, None)[-1]["id"]
        await wait_for(lambda: self.hub.last_read(r2) == newest, what="工作频道标为已读")
        for _ in range(10):
            await self.page.evaluate("document.getElementById('log').scrollTop = 0; "
                                     "document.getElementById('log').dispatchEvent(new Event('scroll'))")
            if await self.page.locator("#log .msg").count() == HISTORY_LIMIT + 11:
                break
            await self.page.wait_for_timeout(200)
        self.assertEqual(await self.page.locator("#log .msg").count(), HISTORY_LIMIT + 11)
        self.assertEqual((await self.texts())[0], "工作 0")
        await self.page.evaluate("window.__first = document.querySelector('#log .msg')")
        await self.page.evaluate("ws.close()")
        await self.post("断线时工作里来的", room=r2)
        await self.page.wait_for_function("[...document.querySelectorAll('#log .msg .text')].some(e => e.textContent === '断线时工作里来的')",
                                          timeout=8000)
        hello = (await self.page.evaluate("window.__sent.filter(x => x.type === 'hello')"))[-1]
        self.assertEqual(hello["room"], r2)
        self.assertIsNotNone(hello["since"])
        self.assertTrue(await self.page.evaluate("window.__first.isConnected"))
        self.assertEqual(await self.page.locator("#log .msg").count(), HISTORY_LIMIT + 12)
        # 切回大厅：大厅自己的消息，工作的不混进来
        await self.switch("大厅")
        self.assertEqual(await self.texts(), ["消息 1", "消息 2", "消息 3"])

    async def test_pending_stays_in_its_room(self):
        """大厅里没发出去的那条：切到别的频道看不到，切回大厅还在，重试发回大厅。"""
        r2 = self.hub.create_room({"name": "工作"})["id"]
        await self.open()
        await self.page.route(URL, lambda route: route.abort() if route.request.method == "POST" else route.continue_())
        await self.page.fill("#in", "大厅没发出去的")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector("#log .msg.failed .retry", timeout=5000)
        await self.switch("工作")
        self.assertEqual(await self.page.locator("#log .msg").count(), 0)
        await self.switch("大厅")
        self.assertEqual(await self.page.locator("#log .msg.failed").count(), 1)
        await self.page.unroute(URL)
        await self.page.click("#log .msg.failed .retry")
        await self.page.wait_for_selector("#log .msg.failed, #log .msg.pending", state="detached", timeout=5000)
        self.assertEqual([m["text"] for m in self.hub.history(1, None)], ["大厅没发出去的"])
        self.assertEqual(self.hub.history(r2, None), [])

    async def test_archived_room_post_rejected_text_back(self):
        """频道在别处被归档、本页还没收到推送时发：409 提示“已归档”，文字放回输入框，不留重试行。"""
        r2 = self.hub.create_room({"name": "工作"})["id"]
        await self.open()
        await self.switch("工作")
        self.hub.update_room(r2, {"archived": True})   # 直接改库，不推 rooms：模拟推送还没到
        await self.page.fill("#in", "归档了还发")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_function("document.getElementById('err').textContent.includes('已归档')", timeout=5000)
        self.assertEqual(await self.page.input_value("#in"), "归档了还发")
        self.assertEqual(await self.page.locator("#log .msg.failed, #log .msg.pending").count(), 0)


class RoomsPhone(WebBase, HistoryBase):
    VIEWPORT = PHONE

    async def test_drawer_switches_room_and_closes(self):
        """手机：左抽屉里点频道，切过去并收起抽屉；新建频道也收起抽屉。"""
        self.hub.create_room({"name": "工作"})
        await self.open()
        await self.page.click("#open-left")
        await self.page.wait_for_timeout(350)
        await self.page.locator("#chlist .ch", has_text="工作").click()
        await self.page.wait_for_function("document.getElementById('room').textContent === '工作'", timeout=3000)
        await self.page.wait_for_timeout(350)
        self.assertFalse(await self.in_view("#channels"))
        await self.page.click("#open-left")
        await self.page.wait_for_timeout(350)
        await self.page.click("#newroom")
        await self.page.fill("#roomname", "手机建的")
        await self.page.press("#roomname", "Enter")
        await self.page.wait_for_function("document.getElementById('room').textContent === '手机建的'", timeout=3000)
        await self.page.wait_for_timeout(350)
        self.assertFalse(await self.in_view("#channels"))


class CloudWebRooms(CloudWebBase):
    """cloud_web 网关（feat/plat-cloudweb）× 多频道（feat/plat-rooms）：会话键、频道路由、归档、未读。"""

    async def test_chat_id_is_session_key_per_room(self):
        """别的频道的用户消息转给 bot 时 chat_id/reply_ctx = session_key(频道)，bot 回的话回到那个频道，
        只推给看那个频道的网页，并算那个频道的未读。"""
        ju = await self.registered("maomao", "橘")
        r2 = self.hub.create_room({"name": "工作"})["id"]
        web1 = await self.web_client()
        await self.recv(web1)
        await self.post("@橘 工作这边", room=r2)
        m = await self.recv(ju)
        self.assertEqual((m["chat_id"], m["reply_ctx"]), (session_key(r2), session_key(r2)))
        self.hub.last_read(r2)
        await ju.send_json({"type": "reply", "reply_ctx": m["reply_ctx"], "content": "收到"})
        await wait_for(lambda: [x["text"] for x in self.hub.history(r2, None)][-1:] == ["收到"], what="回到工作频道")
        self.assertEqual([x["text"] for x in self.hub.history(1, None)], [])
        with self.assertRaises(asyncio.TimeoutError):   # 看大厅的网页收不到工作频道的话
            while True:
                f = await self.recv(web1, timeout=0.3)
                self.assertNotEqual(f.get("type"), "message", f)
        self.assertEqual(self.hub.unread(r2), 1)

    async def test_reply_ctx_formats(self):
        """回来的 reply_ctx 认 room-<id> 和纯数字；没有 reply_ctx 时从 cc-connect 拼的会话键 cloud_web:room-<id> 取。"""
        ju = await self.registered("maomao", "橘")
        r2 = self.hub.create_room({"name": "工作"})["id"]
        await ju.send_json({"type": "reply", "reply_ctx": f"room-{r2}", "content": "一"})
        await ju.send_json({"type": "reply", "reply_ctx": str(r2), "content": "二"})
        await ju.send_json({"type": "reply", "session_key": f"cloud_web:room-{r2}", "content": "三"})
        await ju.send_json({"type": "reply", "reply_ctx": "room-x", "content": "丢"})
        await wait_for(lambda: len(self.hub.history(r2, None)) == 3, what="三条进工作频道")
        self.assertEqual([x["text"] for x in self.hub.history(r2, None)], ["一", "二", "三"])

    async def test_reply_into_archived_room_dropped_connection_kept(self):
        """bot 回话时频道已被归档：这条丢掉（hub 拒收），bot 的连接不断，之后往别的频道说话照常。"""
        ju = await self.registered("maomao", "橘")
        r2 = self.hub.create_room({"name": "工作"})["id"]
        self.hub.update_room(r2, {"archived": True})
        await ju.send_json({"type": "reply", "reply_ctx": session_key(r2), "content": "晚了"})
        await ju.send_json({"type": "ping"})
        self.assertEqual((await self.recv(ju))["type"], "pong")
        await ju.send_json({"type": "reply", "reply_ctx": session_key(1), "content": "大厅"})
        await wait_for(lambda: self.rows(author="maomao"), what="大厅那条进频道")
        self.assertEqual([m["text"] for m in self.rows(author="maomao")], ["大厅"])
        self.assertEqual(self.hub.history(r2, None), [])


class RenderIntegrationApi(HistoryBase):
    """渲染与编辑（feat/plat-render）× 多频道 / 历史。"""

    async def test_archived_room_messages_read_only(self):
        """归档的频道只读：用户改、删自己的消息都 409；恢复后能改。"""
        r2 = self.hub.create_room({"name": "工作"})["id"]
        um, _ = self.hub.create(r2, {"text": "原话"})
        self.hub.update_room(r2, {"archived": True})
        async with self.http.patch(f"{self.url}/api/messages/{um['id']}", json={"text": "改"}, headers=AUTH) as r:
            self.assertEqual(r.status, 409)
        async with self.http.delete(f"{self.url}/api/messages/{um['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 409)
        self.assertEqual(self.hub.message(um["id"])["text"], "原话")
        self.hub.update_room(r2, {"archived": False})
        async with self.http.patch(f"{self.url}/api/messages/{um['id']}", json={"text": "改"}, headers=AUTH) as r:
            self.assertEqual(r.status, 200)

    async def test_last_id_with_rooms_and_delete(self):
        """last_id 取全库自增序列：删了某频道最新一条也不变小；全部频道（主机）和单个频道都不小于发过的最大 id。"""
        r2 = self.hub.create_room({"name": "工作"})["id"]
        self.seed(3)
        m, _ = self.hub.create(r2, {"text": "工作最新"})
        self.hub.delete(m["id"])
        self.assertEqual(self.hub.last_id(r2), m["id"])
        self.assertEqual(self.hub.last_id(None), m["id"])
        self.assertGreaterEqual(self.hub.last_id(1), m["id"])
        self.assertEqual(self.hub.history(r2, None), [])


class RenderIntegrationWeb(WebBase, HistoryBase):
    VIEWPORT = DESKTOP

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

    async def switch(self, name):
        await self.page.locator("#chlist .ch", has_text=name).click()
        await self.page.wait_for_function(f"document.getElementById('room').textContent === {name!r}", timeout=3000)

    async def test_markdown_edit_delete_incremental(self):
        """增量渲染下：Markdown 照样渲染；改一条只换那一条（别的节点不重建，显示已编辑）；
        别处删一条只摘掉那一条；往上翻出的更早消息不受影响。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.seed(HISTORY_LIMIT + 5)
        um, _ = self.hub.create(1, {"text": "**粗** 和 `code`"})
        await self.open()
        await self.page.wait_for_selector("#log .msg .text strong")
        self.assertEqual(await self.page.locator("#log .msg .text code").last.text_content(), "code")
        for _ in range(10):
            await self.page.evaluate("document.getElementById('log').scrollTop = 0; "
                                     "document.getElementById('log').dispatchEvent(new Event('scroll'))")
            if await self.page.locator("#log .msg").count() == HISTORY_LIMIT + 6:
                break
            await self.page.wait_for_timeout(200)
        await self.page.evaluate("window.__first = document.querySelector('#log .msg'); "
                                 "window.__other = document.querySelectorAll('#log .msg')[3]")
        target = self.page.locator(f"#log .msg[data-id='{um['id']}']")
        await target.hover()
        await target.locator(".acts [data-act=edit]").click()
        await self.page.fill("#in", "改成 *斜*")
        await self.page.keyboard.press("Enter")
        await self.page.wait_for_selector(f"#log .msg.edited[data-id='{um['id']}'] .text em")
        self.assertTrue(await self.page.evaluate("window.__first.isConnected && window.__other.isConnected"))
        # 别的设备删了第 2 条
        async with self.http.delete(f"{self.url}/api/messages/2", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        await self.page.wait_for_selector("#log .msg[data-id='2']", state="detached")
        self.assertEqual(await self.page.locator("#log .msg").count(), HISTORY_LIMIT + 5)
        self.assertTrue(await self.page.evaluate("window.__first.isConnected && window.__other.isConnected"))

    async def test_pending_row_has_no_edit_actions(self):
        """发送中/没发出去那行没有复制/编辑/删除栏（它有自己的重试、删除），长按也不出菜单。"""
        await self.open()
        await self.page.route(URL, lambda route: route.abort() if route.request.method == "POST" else route.continue_())
        await self.page.fill("#in", "没发出去的")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector("#log .msg.failed .retry", timeout=5000)
        self.assertEqual(await self.page.locator("#log .msg.failed .acts").count(), 0)

    async def test_archived_room_hides_edit_and_switch_exits_edit(self):
        """归档的频道里自己的消息只剩复制；编辑到一半切频道，退出编辑、输入框还原成草稿。"""
        r2 = self.hub.create_room({"name": "工作"})["id"]
        self.hub.create(r2, {"text": "工作里我说的"})
        self.hub.create(1, {"text": "大厅里我说的"})
        await self.open()
        await self.page.fill("#in", "草稿")
        m = self.page.locator("#log .msg").first
        await m.hover()
        await m.locator(".acts [data-act=edit]").click()
        self.assertEqual(await self.page.input_value("#in"), "大厅里我说的")
        await self.switch("工作")
        self.assertFalse(await self.page.is_visible("#editing"))
        self.assertEqual(await self.page.input_value("#in"), "草稿")
        m = self.page.locator("#log .msg").first
        await m.hover()
        self.assertEqual(await m.locator(".acts [data-act=edit]").count(), 1)
        async with self.http.delete(f"{self.url}/api/rooms/{r2}", headers=AUTH) as r:   # 别处归档（hub 推 rooms）
            self.assertEqual(r.status, 200)
        await self.page.wait_for_function("document.getElementById('in').disabled", timeout=3000)
        await m.hover()
        self.assertEqual(await m.locator(".acts [data-act=copy]").count(), 1)
        self.assertEqual(await m.locator(".acts [data-act=edit], .acts [data-act=delete]").count(), 0)

    async def test_switch_room_closes_search_results(self):
        """搜索结果是某个频道的：切到别的频道，结果面板关掉、搜索框清空，不会点着旧频道的结果在新频道里一路往上加载。"""
        self.seed(5)
        r2 = self.hub.create_room({"name": "工作"})["id"]
        self.hub.create(r2, {"text": "工作的话"})
        await self.open()
        await self.page.fill("#q", "消息")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results .hit")
        await self.switch("工作")
        await self.page.wait_for_selector("#results", state="hidden")
        self.assertEqual(await self.page.input_value("#q"), "")

    async def test_channel_buttons_not_styled_as_message_toolbar(self):
        """频道栏的改名/删除按钮（.ch .acts）不吃消息工具栏的样式（.msg .acts 绝对定位、浮在上方）。"""
        self.hub.create_room({"name": "工作"})
        await self.open()
        pos = await self.page.eval_on_selector("#chlist .ch.on .acts", "e => getComputedStyle(e).position")
        self.assertNotEqual(pos, "absolute")


class RenderPhone(WebBase, HistoryBase):
    VIEWPORT = PHONE

    async def test_phone_textarea_16px(self):
        """手机：多行输入框（textarea）字号不小于 16px（iOS 聚焦不放大）。"""
        self.hub.create(1, {"text": "我说的"})
        await self.open()
        fs = await self.page.eval_on_selector("#in", "e => parseFloat(getComputedStyle(e).fontSize)")
        self.assertGreaterEqual(fs, 16)
        self.assertEqual(await self.page.eval_on_selector("#in", "e => e.tagName"), "TEXTAREA")


if __name__ == "__main__":
    unittest.main()
