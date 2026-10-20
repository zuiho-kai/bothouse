"""频道网页：手机布局（抽屉、顶栏按钮、视口）和连接（断线横幅、立即重连、增量补消息、发送中/失败重试）。
无头 Chromium 静音启动（--mute-audio）；只连测试里起的本地 hub，不点“开声音”，不走任何放声链路。"""
from __future__ import annotations

import asyncio
import json
import unittest

from tests.test_hub import AUTH, TOKEN, HubBase, async_playwright, wait_for

PHONE = {"width": 390, "height": 844}     # 来源：任务要求的手机截图尺寸（iPhone 12-15）
DESKTOP = {"width": 1440, "height": 900}  # 来源：任务要求的桌面截图宽度

# 记下网页通过 WebSocket 发出的每一帧（看 hello 带的 since）。
SPY_WS = """(() => { window.__sent = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { window.__sent.push(JSON.parse(d)); } catch (e) {} return send.call(this, d); };
})();"""


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class WebBase(HubBase):
    VIEWPORT = DESKTOP

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(args=["--mute-audio"])
        self.page = await self.browser.new_page(viewport=self.VIEWPORT)
        await self.page.add_init_script(SPY_WS)

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    async def in_view(self, sel):
        """元素看得见、整块在视口里、而且是这个位置最上层的（没被盖住）。"""
        return await self.page.eval_on_selector(sel, """e => {
          const r = e.getBoundingClientRect(), s = getComputedStyle(e);
          if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0 || r.height === 0) return false;
          if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return false;
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!top && (top === e || e.contains(top));
        }""")

    async def hellos(self):
        return await self.page.evaluate("window.__sent.filter(x => x.type === 'hello').map(x => x.since)")


class PhoneLayout(WebBase):
    VIEWPORT = PHONE

    async def test_phone_topbar_and_drawers(self):
        """390 宽：服务器栏、频道栏、成员栏不占主区；顶栏照 Discord 手机版只有 ☰ 频道名 搜索 成员（验收清单第 7 条），
        闭麦、开声音在左抽屉底下；两侧抽屉能开能关。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.hub.create(1, {"text": "话题"})
        await self.open()
        for sel in ("#servers", "#channels", "#members"):
            self.assertFalse(await self.in_view(sel), sel)
        for sel in ("#open-left", "#open-search", "#open-right"):
            self.assertTrue(await self.in_view(sel), sel)
            self.assertEqual(await self.page.eval_on_selector(sel, "e => !!e.closest('#main .top')"), True, sel)
        # 消息区和输入框占满宽度（以前服务器栏占 72px，输入框只有 211px）
        self.assertGreaterEqual((await self.page.locator("#in").bounding_box())["width"], 280)
        # 闭麦按钮在手机上能用（本地 hub，没有主机和板子）：在左抽屉里
        await self.page.click("#open-left")
        await self.page.wait_for_timeout(350)
        await self.page.click("#mic")
        await self.page.wait_for_function("document.getElementById('mic').classList.contains('off')", timeout=5000)
        await self.page.keyboard.press("Escape")
        await self.page.wait_for_timeout(350)
        # 左抽屉：服务器栏 + 频道栏（含 #me）
        await self.page.click("#open-left")
        await self.page.wait_for_timeout(350)   # 抽屉动画
        self.assertTrue(await self.in_view("#channels .ch.on"))
        self.assertTrue(await self.in_view("#servers .srv.on"))
        await self.page.click("#scrim", position={"x": 380, "y": 400})
        await self.page.wait_for_timeout(350)
        self.assertFalse(await self.in_view("#channels"))
        # 右抽屉：成员栏
        await self.page.click("#open-right")
        await self.page.wait_for_timeout(350)
        self.assertTrue(await self.in_view("#head-a"))
        await self.page.keyboard.press("Escape")
        await self.page.wait_for_timeout(350)
        self.assertFalse(await self.in_view("#members"))

    async def test_phone_viewport_rules(self):
        """输入框字号不小于 16px（iOS 聚焦不放大）；视口带 viewport-fit=cover；有 theme-color；高度用动态视口。"""
        await self.open()
        fs = await self.page.eval_on_selector("#in", "e => parseFloat(getComputedStyle(e).fontSize)")
        self.assertGreaterEqual(fs, 16)
        self.assertIn("viewport-fit=cover", await self.page.get_attribute("meta[name=viewport]", "content"))
        self.assertEqual(await self.page.locator("meta[name=theme-color]").count(), 1)
        css = await self.page.evaluate("[...document.styleSheets].flatMap(s => [...s.cssRules].map(r => r.cssText)).join('\\n')")
        self.assertIn("100dvh", css)
        self.assertIn("safe-area-inset-bottom", css)
        # 整页不出滚动条：主区正好一屏
        self.assertEqual(await self.page.evaluate("document.documentElement.scrollHeight <= innerHeight"), True)


class DesktopLayout(WebBase):
    async def test_desktop_keeps_three_columns(self):
        """1440 宽：和原来一样三栏，开声音和闭麦留在左下角 #me，没有抽屉按钮。"""
        await self.open()
        for sel in ("#servers .srv.on", "#channels .ch.on", "#members", "#me #sound", "#me #mic"):
            self.assertTrue(await self.in_view(sel), sel)
        for sel in ("#open-left", "#open-right"):
            self.assertFalse(await self.in_view(sel), sel)
        self.assertFalse(await self.in_view("#banner"))


class Reconnect(WebBase):
    async def drop(self):
        """把 hub 停掉（网页的连接被断开），网页的自动重连等待调到 60 秒，只剩事件能让它马上重连。"""
        await self.page.evaluate("retry = 60000")
        await self.stop_hub()
        await self.page.wait_for_selector("#banner", state="visible", timeout=5000)

    async def test_banner_and_online_reconnect_with_since(self):
        """断线：顶部横幅；网络恢复（online 事件）立刻重连，用 since 只补漏掉的消息，不整表重载。"""
        self.hub.create(1, {"text": "一"})
        self.hub.create(1, {"text": "二"})
        await self.open()
        self.assertFalse(await self.in_view("#banner"))
        await self.drop()
        self.assertIn("重新连接", await self.page.text_content("#banner"))
        self.assertTrue(await self.in_view("#banner"))
        await self.start_hub()
        self.hub.create(1, {"text": "断线时来的"})
        await self.page.evaluate("window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=3000)
        await self.page.wait_for_selector("#banner", state="hidden", timeout=3000)
        self.assertEqual(await self.hellos(), [None, 2])
        self.assertEqual(await self.page.eval_on_selector_all(".msg .text", "es => es.map(e => e.textContent)"),
                         ["一", "二", "断线时来的"])

    async def test_visible_again_reconnects(self):
        """手机锁屏回来（visibilitychange 变可见）立刻重连。"""
        self.hub.create(1, {"text": "一"})
        await self.open()
        await self.drop()
        await self.start_hub()
        await self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=3000)
        self.assertEqual(await self.hellos(), [None, 1])

    async def test_speaking_message_finished_while_offline(self):
        """断线前在说的那条、断线时说完了：补消息从它开始取，回来后不再显示“正在说”。"""
        self.hub.set_members([{"id": "a", "name": "A"}])
        self.hub.create(1, {"text": "话题"})
        m, _ = self.hub.create(1, {"text": "说着", "author_kind": "role", "author": "a", "name": "A"})
        self.hub.create(1, {"text": "插一句"})
        await self.open()
        await self.page.wait_for_selector(".msg.speaking", timeout=5000)
        await self.drop()
        await self.start_hub()
        self.hub.update(m["id"], {"status": "done"})
        await self.page.evaluate("window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=3000)
        self.assertEqual(await self.hellos(), [None, m["id"] - 1])
        self.assertEqual(await self.page.locator(".msg.speaking").count(), 0)
        self.assertEqual(await self.page.locator(".msg .text").count(), 3)

    async def test_hub_db_wiped_full_reload(self):
        """云端库被清空（最新 id 比本地的小）：丢掉本地消息，整表重新取。"""
        for t in ("一", "二", "三"):
            self.hub.create(1, {"text": t})
        await self.open()
        await self.drop()
        self.db.unlink()
        await self.start_hub()
        self.hub.create(1, {"text": "新库"})
        await self.page.evaluate("window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_function("document.querySelectorAll('.msg .text').length === 1", timeout=3000)
        self.assertEqual(await self.page.text_content(".msg .text"), "新库")
        self.assertEqual((await self.hellos())[-1], None)


    async def test_dial_demo_stays_offline(self):
        """审查 2：表盘演示页（/dial?demo=1）不连云端；登录过（本机存着 token）也不因回到前台、网络恢复被连上。"""
        await self.open()                                   # 频道页登录一次，token 存进 localStorage
        await self.page.goto(f"{self.url}/dial?demo=1")
        await self.page.evaluate("document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_timeout(800)
        self.assertEqual(await self.hellos(), [])
        self.assertEqual([i for i in self.hub.subs.values() if i["kind"] == "web"], [])

    async def test_own_http_reply_does_not_skip_missed(self):
        """审查 1：断线时自己发的一条经 HTTP 成功（id 最大），重连的 since 不能跳过断线期间别人的消息。"""
        self.hub.create(1, {"text": "一"})
        await self.open()
        await self.page.evaluate("retry = 60000; ws.onclose = null; ws.close(); ws = null")   # 推送断了，HTTP 还通
        self.hub.create(1, {"text": "别人说的", "author_kind": "role", "author": "a", "name": "A", "status": "done"})
        await self.page.fill("#in", "我说的")
        await self.page.press("#in", "Enter")
        await wait_for(lambda: len(self.rows(author_kind="user")) == 2, what="HTTP 发成")
        await self.page.wait_for_selector(".msg.pending", state="detached", timeout=3000)   # 网页收到 HTTP 回应
        await self.page.evaluate("window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_function("document.querySelectorAll('.msg .text').length === 3", timeout=3000)
        self.assertEqual(await self.hellos(), [None, 1])

    async def test_dead_socket_on_return_reconnects(self):
        """审查 3：回到前台时连接看着是开的但已经死了（探活没回音）：重连。活的连接不重连。"""
        self.hub.create(1, {"text": "一"})
        await self.open()
        await self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        await self.page.wait_for_timeout(500)
        self.assertEqual(await self.hellos(), [None])                     # 活的：探活有回音，不重连
        await self.page.evaluate("ws.send = () => {}")                    # 死的：发出去没回音
        await self.page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        await self.page.wait_for_function("window.__sent.filter(x => x.type === 'hello').length === 2", timeout=8000)
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=3000)
        self.assertEqual(await self.hellos(), [None, 1])

    async def test_online_restarts_pending_attempt(self):
        """审查 4：网络恢复时正有一次注定失败的连接在等：不等它，马上新连。"""
        await self.open()
        await self.drop()
        # 一次卡在“连接中”的尝试（断网时常见：握手发不出去，要等很久才失败）
        await self.page.evaluate("""() => { const Real = WebSocket;
            window.WebSocket = function () { return {readyState: 0, close() {}, send() {}}; };
            try { connect(); } finally { window.WebSocket = Real; } }""")
        await self.start_hub()
        await self.page.evaluate("window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=3000)

    async def test_auth_lost_while_offline_clears_banner(self):
        """审查 6：断线后重连发现 token 失效（4001）：横幅撤掉，出登录框。"""
        await self.open()
        await self.drop()
        await self.start_hub()
        self.hub.token = "changed"
        await self.page.evaluate("window.dispatchEvent(new Event('online'))")
        await self.page.wait_for_selector("#login", state="visible", timeout=3000)
        self.assertTrue(await self.page.evaluate("document.getElementById('banner').hidden"))


class Sending(WebBase):
    URL = "**/api/rooms/*/messages"

    async def test_pending_then_shown_once(self):
        """发送中：输入框马上清空，消息行内显示“发送中”；成功后只剩一条正式消息。"""
        await self.open()
        hold = asyncio.Event()

        async def slow(route):
            await hold.wait()
            await route.continue_()
        await self.page.route(self.URL, slow)
        await self.page.fill("#in", "慢慢发")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector(".msg.pending", timeout=3000)
        self.assertEqual(await self.page.input_value("#in"), "")
        self.assertIn("发送中", await self.page.text_content(".msg.pending"))
        hold.set()
        await self.page.wait_for_selector(".msg.pending", state="detached", timeout=5000)
        self.assertEqual(await self.page.eval_on_selector_all(".msg .text", "es => es.map(e => e.textContent)"), ["慢慢发"])
        self.assertEqual(len(self.rows(author_kind="user")), 1)

    async def test_failed_retry_same_key(self):
        """连不上：行内“没发出去·重试”；重试带同一个 client_key（服务端按它去重），成功后只有一条。"""
        await self.open()
        bodies = []
        self.page.on("request", lambda r: bodies.append(json.loads(r.post_data)) if r.method == "POST"
                     and "/messages" in r.url else None)
        await self.page.route(self.URL, lambda route: route.abort())
        await self.page.fill("#in", "第一次没发出去")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector(".msg.failed .retry", timeout=5000)
        self.assertEqual(self.rows(author_kind="user"), [])
        await self.page.unroute(self.URL)
        await self.page.click(".msg.failed .retry")
        await self.page.wait_for_selector(".msg.failed, .msg.pending", state="detached", timeout=5000)
        self.assertEqual(len(bodies), 2)
        self.assertTrue(bodies[0]["client_key"])
        self.assertEqual(bodies[0]["client_key"], bodies[1]["client_key"])
        self.assertEqual([m["text"] for m in self.rows(author_kind="user")], ["第一次没发出去"])
        self.assertEqual(await self.page.locator(".msg .text").count(), 1)

    async def test_response_lost_no_duplicate(self):
        """请求到了 hub 但回应丢了：WebSocket 推回的同 client_key 消息替掉“发送中”那行，不出现两条。"""
        await self.open()

        async def lose_reply(route):
            await route.fetch()      # 请求真的到 hub，消息已建
            await route.abort()      # 网页收不到回应
        await self.page.route(self.URL, lose_reply)
        await self.page.fill("#in", "回应丢了")
        await self.page.press("#in", "Enter")
        await wait_for(lambda: len(self.rows(author_kind="user")) == 1, what="hub 收到")
        await self.page.wait_for_function("document.querySelectorAll('.msg .text').length === 1 && "
                                          "!document.querySelector('.msg.pending, .msg.failed')", timeout=5000)

    async def test_retry_rejected_puts_text_back(self):
        """审查 5：重试时被 hub 拒（413 这类重试也没用的）：文字放回输入框并提示，不无声丢掉。"""
        await self.open()
        await self.page.route(self.URL, lambda route: route.abort())
        await self.page.fill("#in", "要被拒的")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector(".msg.failed .retry", timeout=5000)
        await self.page.unroute(self.URL)
        await self.page.route(self.URL, lambda route: route.fulfill(status=413, body="too large"))
        await self.page.click(".msg.failed .retry")
        await self.page.wait_for_function("document.getElementById('in').value === '要被拒的'", timeout=5000)
        self.assertIn("没发出去", await self.page.text_content("#err"))
        self.assertEqual(await self.page.locator(".msg").count(), 0)

    async def test_401_clears_pending_row(self):
        """审查 6：发送时 token 失效：不留“发送中”那行。"""
        await self.open()
        await self.page.route(self.URL, lambda route: route.fulfill(status=401, body="unauthorized"))
        await self.page.fill("#in", "token 坏了")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector("#login", state="visible", timeout=5000)
        self.assertEqual(await self.page.locator(".msg.pending, .msg.failed").count(), 0)

    async def test_failed_can_be_dropped(self):
        """没发出去的那条可以删掉（不重试）。"""
        await self.open()
        await self.page.route(self.URL, lambda route: route.abort())
        await self.page.fill("#in", "不要了")
        await self.page.press("#in", "Enter")
        await self.page.click(".msg.failed .drop", timeout=5000)
        self.assertEqual(await self.page.locator(".msg").count(), 0)


if __name__ == "__main__":
    unittest.main()
