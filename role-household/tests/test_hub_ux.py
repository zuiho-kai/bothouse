"""频道网页的易用性小修（用户 2026-10-20「然后还有就是其他易用性」「我现在基本不在电脑前面了」）：
手机编辑条不挡消息、登录页说明 token 在哪、空频道和连接中有提示、旧 http 地址把 token 带到 https、
手机顶栏搜索框不挤掉频道名、手机不提示 Esc、没连上时发消息有提示。
无头 Chromium 静音启动（--mute-audio）；只连测试里起的本地 hub，不点“开声音”。"""
from __future__ import annotations

import unittest

from tests.test_hub import TOKEN, async_playwright
from tests.test_hub_mobile import PHONE, WebBase

# 这条消息整块在 #log 的可见范围里（没被编辑条、输入框挡住，也没滚出去）
FULLY_IN_LOG = """id => {
  const e = document.querySelector(`.msg[data-id="${id}"]`), l = document.getElementById('log');
  if (!e) return false;
  const r = e.getBoundingClientRect(), lr = l.getBoundingClientRect();
  return r.top >= lr.top - 0.5 && r.bottom <= lr.bottom + 0.5;
}"""


def seed(hub, n=30):
    hub.set_members([{"id": "a", "name": "A"}])
    for i in range(n):
        hub.create(1, {"text": f"第 {i} 条", "author_kind": "role", "author": "a", "name": "A", "status": "done"})


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class PhoneEditing(WebBase):
    VIEWPORT = PHONE

    async def test_edit_last_message_not_covered(self):
        """在底部时编辑最后一条（多行）：编辑条和变高的输入框出来后，那条消息整块还看得见。"""
        seed(self.hub)
        mine, _ = self.hub.create(1, {"text": "第一行\n第二行\n第三行\n第四行"})
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)
        await self.page.evaluate("jumpToLatest()")
        await self.page.evaluate(f"act({mine['id']}, 'edit')")
        await self.page.wait_for_timeout(200)
        self.assertTrue(await self.in_view("#editing"))
        self.assertTrue(await self.page.evaluate(FULLY_IN_LOG, mine["id"]))

    async def test_edit_scrolls_message_into_view(self):
        """停在别处（如未读分割线、往上翻着）时编辑自己的一条：滚到能看见它。"""
        seed(self.hub)
        mine, _ = self.hub.create(1, {"text": "要改的这条"})
        await self.open()
        await self.page.evaluate("document.getElementById('log').scrollTop = 0")
        await self.page.evaluate(f"act({mine['id']}, 'edit')")
        await self.page.wait_for_timeout(200)
        self.assertTrue(await self.page.evaluate(FULLY_IN_LOG, mine["id"]))

    async def test_input_growing_keeps_bottom(self):
        """在底部时输入框打多行变高：最后一条不被顶到输入框后面。"""
        seed(self.hub)
        last, _ = self.hub.create(1, {"text": "最后一条", "author_kind": "role", "author": "a", "name": "A", "status": "done"})
        await self.open()
        await self.page.evaluate("jumpToLatest()")
        await self.page.fill("#in", "一\n二\n三\n四\n五")
        await self.page.wait_for_timeout(200)
        self.assertTrue(await self.page.evaluate(FULLY_IN_LOG, last["id"]))

    async def test_keeps_bottom_after_send_and_regrow(self):
        """发完一条输入框变回一行（消息区变高）以后，再打多行：仍然贴底（变高那次不能把“在底部”记丢）。"""
        seed(self.hub)
        await self.open()
        await self.page.evaluate("jumpToLatest()")
        await self.page.fill("#in", "一\n二\n三\n四\n五")
        await self.page.wait_for_timeout(100)
        await self.page.click("#f .box button")
        await self.page.wait_for_selector(".msg.pending", state="detached", timeout=3000)
        await self.page.wait_for_timeout(100)
        await self.page.fill("#in", "六\n七\n八\n九\n十")
        await self.page.wait_for_timeout(200)
        last = await self.page.evaluate("Math.max(...msgs.keys())")
        self.assertTrue(await self.page.evaluate(FULLY_IN_LOG, last))

    async def test_no_esc_hint_on_phone(self):
        """手机（触屏、粗指针）没有 Esc 键：编辑条只留「取消」。"""
        self.hub.create(1, {"text": "一"})
        ctx = await self.browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        self.page = await ctx.new_page()
        await self.open()
        self.assertTrue(await self.page.evaluate("matchMedia('(pointer: coarse)').matches"))
        await self.page.evaluate("act(Math.max(...msgs.keys()), 'edit')")
        self.assertNotIn("Esc", await self.page.inner_text("#editing"))


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class PhoneTopbar(WebBase):
    VIEWPORT = PHONE

    async def test_room_name_not_squeezed_by_search(self):
        """手机顶栏：搜索平时只是个图标，频道名「我的频道」整个看得见；点图标在顶栏下面出整行搜索框（验收清单第 7 条）。"""
        r = self.hub.create_room({"name": "我的频道"})
        await self.page.add_init_script(f"localStorage.setItem('rh_room', '{r['id']}')")
        await self.open()
        self.assertEqual(await self.page.text_content("#room"), "我的频道")
        self.assertTrue(await self.page.eval_on_selector("#room", "e => e.scrollWidth <= e.clientWidth"))
        self.assertFalse(await self.page.is_visible("#q"))
        await self.page.click("#open-search")
        self.assertGreater((await self.page.locator("#q").bounding_box())["width"], 300)
        self.assertTrue(await self.page.eval_on_selector("#room", "e => e.scrollWidth <= e.clientWidth"))


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class LoginAndEmpty(WebBase):
    async def test_login_says_where_token_is(self):
        """登录页写明 token 在哪：.env 的 RH_HUB_TOKEN、带 #token= 的链接（不写服务器路径）；token 错了提示也还在。"""
        await self.page.goto(self.url + "/")
        await self.page.wait_for_selector("#login", state="visible", timeout=5000)
        text = await self.page.inner_text("#login")
        for want in ("RH_HUB_TOKEN", ".env", "#token="):
            self.assertIn(want, text)
        self.assertNotIn("hub.env", text)
        self.assertNotIn("/opt/", text)
        await self.page.fill("#tok", "wrong")
        await self.page.click("#login button")
        await self.page.wait_for_function("document.getElementById('loginwhy').textContent.includes('不对')", timeout=5000)
        self.assertIn("RH_HUB_TOKEN", await self.page.inner_text("#login"))

    async def test_empty_room_hint(self):
        """空频道：消息区说「还没有消息」和怎么开始；发了一条以后提示消失。"""
        r = self.hub.create_room({"name": "空的"})
        await self.page.add_init_script(f"localStorage.setItem('rh_room', '{r['id']}')")
        await self.open()
        self.assertTrue(await self.in_view("#empty"))
        self.assertIn("还没有消息", await self.page.inner_text("#empty"))
        await self.page.fill("#in", "第一句")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_selector("#empty", state="hidden", timeout=3000)

    async def test_connecting_hint(self):
        """第一次连接还没回话：消息区说「正在连接云端」，不是一片空白。"""
        await self.page.route_web_socket("**/ws", lambda ws: None)   # 接住连接、不回 ready
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_timeout(500)
        self.assertTrue(await self.in_view("#empty"))
        self.assertIn("正在连接云端", await self.page.inner_text("#empty"))

    async def test_first_connect_fail_hint(self):
        """第一次就连不上：消息区说连不上、几秒后重试（以前只有角落一个黄点）。"""
        async def close(ws):
            await ws.close()
        await self.page.route_web_socket("**/ws", close)
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('empty').innerText.includes('连不上云端')", timeout=5000)
        self.assertTrue(await self.in_view("#empty"))
        self.assertRegex(await self.page.inner_text("#empty"), r"\d+ 秒后")

    async def test_send_before_connected_says_why(self):
        """还没连上就点发送：说明为什么没发，字留在输入框里。"""
        await self.page.route_web_socket("**/ws", lambda ws: None)
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.fill("#in", "早到的话")
        await self.page.press("#in", "Enter")
        self.assertIn("还没连上", await self.page.text_content("#err"))
        self.assertEqual(await self.page.input_value("#in"), "早到的话")


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class HttpToHttps(WebBase):
    """旧地址 http://IP:8790 上浏览器存着 token；https 是另一个源，读不到。vps-arm 的 nginx 把旧地址的 / 和 /dial
    反代到 /to-https（deploy/hub/nginx-rh-hub.conf）：这页把 token 放到 https 地址的 # 后面跳过去（# 后面不发给服务器），
    旧地址里存的那份删掉。"""

    async def go(self, path, saved=None, hash_=""):
        landed = []

        async def https_page(route):
            landed.append(route.request.url)
            await route.fulfill(content_type="text/html", body="<p>https</p>")
        await self.page.route("https://127.0.0.1/**", https_page)
        if saved is not None:   # 先在旧地址这个源里存上 token（同以前登录过）
            await self.page.goto(self.url + "/rh-md.js")
            await self.page.evaluate(f"localStorage.setItem('rh_token', {saved!r})")
        # nginx 反代时浏览器地址还是 /、/dial：用 route 把这两个路径接到 /to-https 模拟
        await self.page.route(f"{self.url}{path}*", lambda route: route.continue_(url=self.url + "/to-https"))
        await self.page.goto(self.url + path + hash_)
        await self.page.wait_for_url("https://127.0.0.1/**", timeout=5000)
        return self.page.url

    async def test_carries_saved_token(self):
        url = await self.go("/", saved="tok/1+2")
        self.assertEqual(url, "https://127.0.0.1/#token=tok%2F1%2B2")

    async def test_keeps_path_and_link_token(self):
        url = await self.go("/dial", hash_="#token=fromlink")
        self.assertEqual(url, "https://127.0.0.1/dial#token=fromlink")

    async def test_no_token_plain_redirect(self):
        url = await self.go("/")
        self.assertEqual(url, "https://127.0.0.1/")

    async def test_old_origin_copy_removed(self):
        await self.go("/", saved="abc")
        await self.page.unroute_all()
        await self.page.goto(self.url + "/rh-md.js")
        self.assertIsNone(await self.page.evaluate("localStorage.getItem('rh_token')"))

    async def test_served_without_token(self):
        """/to-https 不要 token 就能取（旧地址上还没登录的人也走这页）。"""
        resp = await self.http.get(self.url + "/to-https")
        self.assertEqual(resp.status, 200)
        self.assertIn("text/html", resp.headers["Content-Type"])


if __name__ == "__main__":
    unittest.main()
