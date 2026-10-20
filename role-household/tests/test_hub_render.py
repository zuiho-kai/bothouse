"""网页消息渲染与编辑：Markdown/代码块/可点链接（转义安全）、@ 补全与提及高亮、多行输入、编辑/删除/复制自己的消息。
用户 2026-10-20「你可以去修一下自建平台，那边感觉还是很垃圾……你先看看距离discord差异有什么」；差距表见 /tmp/rh-gap/msg.md。"""
from __future__ import annotations

import asyncio
import json
import unittest

from tests import test_hub as th
from tests.test_hub import AUTH, TOKEN, HubBase, async_playwright, wait_for

# 无头浏览器静音（用户禁令「不让板子或 Mac 出声」）。
LAUNCH_ARGS = ["--mute-audio", "--autoplay-policy=user-gesture-required"]


class HubRest(HubBase):
    """编辑/删除自己（用户）的消息：只能改用户消息的正文、只能删用户消息；角色消息照旧只能由主机改状态。"""

    async def test_edit_own_message_text(self):
        _, um = await self.post("发错了")
        ws = await self.web_client(); await self.recv(ws)
        async with self.http.patch(f"{self.url}/api/messages/{um['id']}", json={"text": "改好了"}, headers=AUTH) as r:
            self.assertEqual(r.status, 200)
            m = await r.json()
        self.assertEqual(m["text"], "改好了")
        self.assertGreater(m["updated_at"], m["created_at"])   # 网页据此显示“已编辑”
        push = await self.recv(ws)
        self.assertEqual((push["type"], push["message"]["id"], push["message"]["text"]), ("message", um["id"], "改好了"))

    async def test_edit_rejects_bad(self):
        _, um = await self.post("用户说的")
        _, rm = await self.post("角色说的", author_kind="role", author="a", name="A")
        for mid, body in ((rm["id"], {"text": "改角色的话"}), (um["id"], {"text": "   "}), (um["id"], {"text": 3}),
                          (um["id"], {"status": "done"})):
            async with self.http.patch(f"{self.url}/api/messages/{mid}", json=body, headers=AUTH) as r:
                self.assertEqual(r.status, 400, (mid, body))
        self.assertEqual(self.hub.message(rm["id"])["text"], "角色说的")
        async with self.http.patch(f"{self.url}/api/messages/9999", json={"text": "x"}, headers=AUTH) as r:
            self.assertEqual(r.status, 404)

    async def test_delete_own_message(self):
        _, um = await self.post("删掉我")
        _, rm = await self.post("角色说的", author_kind="role", author="a", name="A")
        ws = await self.web_client(); await self.recv(ws)
        async with self.http.delete(f"{self.url}/api/messages/{rm['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 400)   # 角色的话不能删
        async with self.http.delete(f"{self.url}/api/messages/{um['id']}", headers={}) as r:
            self.assertEqual(r.status, 401)
        async with self.http.delete(f"{self.url}/api/messages/{um['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        push = await self.recv(ws)
        self.assertEqual(push, {"type": "deleted", "id": um["id"], "room_id": 1})
        self.assertIsNone(self.hub.message(um["id"]))
        async with self.http.delete(f"{self.url}/api/messages/{um['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 404)


class HostAfterDelete(HubBase):
    """审查 1：主机已处理到第 N 条，用户删了第 N 条，主机重连不能误判“云端库被清空”、已读位置不能退回。"""
    make_host, start_host, stop_host = th.HostClient.make_host, th.HostClient.start_host, th.HostClient.stop_host

    async def test_last_id_counts_deleted(self):
        _, a = await self.post("一")
        _, b = await self.post("二")
        async with self.http.delete(f"{self.url}/api/messages/{b['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        self.assertEqual(self.hub.last_id(1), b["id"])
        ws = await self.web_client(); ready = await self.recv(ws)
        self.assertEqual(ready["last_id"], b["id"])

    async def test_host_cursor_kept_after_last_message_deleted(self):
        _, a = await self.post("一")
        _, b = await self.post("二")
        (self.dir / "host-state.json").write_text(json.dumps({"cursor": b["id"]}))
        async with self.http.delete(f"{self.url}/api/messages/{b['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        host, task, m = await self.start_host()
        self.assertEqual(host.cursor, b["id"])
        await self.stop_host(host, task, m)


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class RenderWeb(HubBase):
    mobile = False

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(args=LAUNCH_ARGS)
        if self.mobile:
            self.ctx = await self.browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
                                                      is_mobile=True, device_scale_factor=2)
        else:
            self.ctx = await self.browser.new_context(viewport={"width": 1440, "height": 900})
        self.page = await self.ctx.new_page()
        self.page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    async def last_text_html(self):
        return await self.page.eval_on_selector(".msg:last-child .text", "e => e.innerHTML")


class RenderDesktop(RenderWeb):
    async def test_markdown_blocks_and_inline(self):
        self.hub.set_members([{"id": "ju", "name": "橘"}])
        self.hub.create(1, {"text": "# 标题\n**粗体** 和 *斜体* 和 ~~删~~ 和 `x<y`\n- 一\n- 二\n1. 甲\n2. 乙\n> 引用一句\n\n第二段\n第二行",
                            "author_kind": "role", "author": "ju", "name": "橘"})
        await self.open()
        t = ".msg:last-child .text"
        for sel, want in ((f"{t} strong", "粗体"), (f"{t} em", "斜体"), (f"{t} del", "删"), (f"{t} code", "x<y"),
                          (f"{t} blockquote", "引用一句")):
            self.assertEqual(await self.page.text_content(sel), want, sel)
        self.assertEqual(await self.page.locator(f"{t} ul > li").count(), 2)
        self.assertEqual(await self.page.locator(f"{t} ol > li").count(), 2)
        self.assertEqual(await self.page.locator(f"{t} .h1").count(), 1)
        self.assertEqual(await self.page.locator(f"{t} br").count(), 1)   # 段内换行保留

    async def test_code_block(self):
        self.hub.create(1, {"text": "看：\n```python\nif a < b:\n    print('**不是粗体**')\n```\n完"})
        await self.open()
        code = ".msg:last-child .text pre code"
        self.assertEqual(await self.page.text_content(code), "if a < b:\n    print('**不是粗体**')")
        self.assertEqual(await self.page.locator(".msg:last-child .text pre strong").count(), 0)

    async def test_links_clickable_and_safe(self):
        self.hub.create(1, {"text": "看 https://example.com/a?b=1&c=2。还有[文档](https://ex.org/d) 和 [坏](javascript:alert(1))"})
        await self.open()
        links = await self.page.eval_on_selector_all(
            ".msg:last-child .text a", "as => as.map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel])")
        self.assertEqual(links, [["https://example.com/a?b=1&c=2", "https://example.com/a?b=1&c=2", "_blank", "noopener noreferrer"],
                                 ["文档", "https://ex.org/d", "_blank", "noopener noreferrer"]])
        self.assertIn("[坏](javascript:alert(1))", await self.page.text_content(".msg:last-child .text"))

    async def test_xss_payloads_stay_text(self):
        payloads = [
            '<img src=x onerror="window.__pwned=1">',
            "<script>window.__pwned=1</script>",
            '[x](https://a.com/"onmouseover="window.__pwned=1)',
            'https://a.com/"><img src=x onerror=window.__pwned=1>',
            "**<b onclick=window.__pwned=1>b</b>**",
            "```\n</code></pre><img src=x onerror=window.__pwned=1>\n```",
            "`<svg onload=window.__pwned=1>`",
            "@<img src=x onerror=window.__pwned=1>",
        ]
        self.hub.set_members([{"id": "ju", "name": '橘"><img src=x onerror=window.__pwned=1>'}])
        for p in payloads:
            self.hub.create(1, {"text": p})
        await self.open()
        await asyncio.sleep(0.3)
        self.assertIsNone(await self.page.evaluate("window.__pwned"))
        bad = await self.page.evaluate("""() => [...document.querySelectorAll('#log *')].filter(e =>
            ['IMG','SCRIPT','SVG','B','IFRAME'].includes(e.tagName.toUpperCase()) && !e.closest('.av') ||
            [...e.attributes].some(a => a.name.startsWith('on'))).map(e => e.outerHTML)""")
        self.assertEqual(bad, [])
        hrefs = await self.page.eval_on_selector_all("#log a", "as => as.map(a => a.getAttribute('href'))")
        self.assertTrue(all(h.startswith("https://") and '"' not in h for h in hrefs), hrefs)

    async def test_mention_highlight(self):
        self.hub.set_members([{"id": "ju", "name": "橘"}, {"id": "long", "name": "龙娘"}])
        self.hub.create(1, {"text": "@龙娘 写代码，@橘 验收，@路人 不算"})
        await self.open()
        self.assertEqual(await self.page.eval_on_selector_all(".msg:last-child .mention", "es => es.map(e => e.textContent)"),
                         ["@龙娘", "@橘"])

    async def test_multiline_input_enter_sends_shift_enter_newline(self):
        await self.open()
        self.assertEqual(await self.page.eval_on_selector("#in", "e => e.tagName"), "TEXTAREA")
        await self.page.click("#in")
        await self.page.keyboard.type("第一行")
        await self.page.keyboard.press("Shift+Enter")
        await self.page.keyboard.type("第二行")
        self.assertEqual(await self.page.input_value("#in"), "第一行\n第二行")
        await self.page.keyboard.press("Enter")
        await self.page.wait_for_function("document.getElementById('in').value === ''", timeout=5000)
        await wait_for(lambda: self.rows(author_kind="user"), what="消息入库")
        self.assertEqual(self.rows(author_kind="user")[-1]["text"], "第一行\n第二行")
        await self.page.wait_for_selector(".msg:last-child .text br", state="attached")

    async def test_enter_during_ime_composition_does_not_send(self):
        await self.open()
        await self.page.fill("#in", "nihao")
        await self.page.dispatch_event("#in", "keydown", {"key": "Enter", "isComposing": True})
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(author_kind="user"), [])

    async def test_at_autocomplete(self):
        self.hub.set_members([{"id": "ju", "name": "橘"}, {"id": "long", "name": "龙娘"}, {"id": "jing", "name": "鲸鱼娘"}])
        await self.open()
        await self.page.click("#in")
        await self.page.keyboard.type("请 @")
        await self.page.wait_for_selector("#mention-pop [role=option]")
        self.assertEqual(await self.page.locator("#mention-pop [role=option]").count(), 3)
        await self.page.keyboard.type("龙")
        await self.page.wait_for_function("document.querySelectorAll('#mention-pop [role=option]').length === 1")
        await self.page.keyboard.press("Enter")   # 选中，不发送
        self.assertEqual(await self.page.input_value("#in"), "请 @龙娘 ")
        self.assertFalse(await self.page.is_visible("#mention-pop"))
        self.assertEqual(self.rows(author_kind="user"), [])
        # 方向键换选项、Tab 也能选；Esc 关掉
        await self.page.keyboard.type("和 @")
        await self.page.keyboard.press("ArrowDown")
        await self.page.keyboard.press("Tab")
        self.assertEqual(await self.page.input_value("#in"), "请 @龙娘 和 @龙娘 ")
        await self.page.keyboard.type("@")
        await self.page.keyboard.press("Escape")
        self.assertFalse(await self.page.is_visible("#mention-pop"))
        # 点选
        await self.page.keyboard.type("鲸")
        await self.page.keyboard.press("Backspace")
        await self.page.keyboard.type("鲸")
        await self.page.wait_for_selector("#mention-pop [role=option]")
        await self.page.click("#mention-pop [role=option]")
        self.assertTrue((await self.page.input_value("#in")).endswith("@鲸鱼娘 "))

    async def test_edit_delete_copy_own_message(self):
        self.hub.set_members([{"id": "ju", "name": "橘"}])
        self.hub.create(1, {"text": "原话"})
        self.hub.create(1, {"text": "橘说的", "author_kind": "role", "author": "ju", "name": "橘", "status": "done"})
        await self.open()
        await self.ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        user_msg, role_msg = self.page.locator(".msg").nth(0), self.page.locator(".msg").nth(1)
        await role_msg.hover()
        self.assertTrue(await role_msg.locator(".acts [data-act=copy]").is_visible())
        self.assertEqual(await role_msg.locator(".acts [data-act=edit]").count(), 0)   # 角色的话不能改
        await role_msg.locator(".acts [data-act=copy]").click()
        self.assertEqual(await self.page.evaluate("navigator.clipboard.readText()"), "橘说的")
        # 编辑：正文进输入框，Enter 保存
        await user_msg.hover()
        await user_msg.locator(".acts [data-act=edit]").click()
        self.assertEqual(await self.page.input_value("#in"), "原话")
        self.assertTrue(await self.page.is_visible("#editing"))
        await self.page.fill("#in", "改过的话")
        await self.page.keyboard.press("Enter")
        await self.page.wait_for_function("document.querySelector('.msg .text').textContent === '改过的话'")
        self.assertEqual(await self.page.locator(".msg.edited").count(), 1)   # CSS 在正文后显示“（已编辑）”
        self.assertEqual(len(self.rows(author_kind="user")), 1)
        self.assertFalse(await self.page.is_visible("#editing"))
        # 删除（确认框由 dialog 处理器点确定）
        await user_msg.hover()
        await user_msg.locator(".acts [data-act=delete]").click()
        await self.page.wait_for_function("document.querySelectorAll('.msg').length === 1")
        self.assertEqual(self.rows(author_kind="user"), [])

    async def test_editing_message_deleted_elsewhere(self):
        """审查 2：正在编辑的那条被别的设备删了，编辑条自动退出、提示，草稿还原。"""
        _, um = await self.post("原话")
        await self.open()
        await self.page.fill("#in", "草稿")
        await self.page.hover(".msg")
        await self.page.click(".msg .acts [data-act=edit]")
        self.assertTrue(await self.page.is_visible("#editing"))
        async with self.http.delete(f"{self.url}/api/messages/{um['id']}", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        await self.page.wait_for_selector("#editing", state="hidden", timeout=5000)
        self.assertEqual(await self.page.input_value("#in"), "草稿")
        self.assertEqual(await self.page.text_content("#toast"), "这条已被删除")

    async def test_system_message_keeps_newlines(self):
        """审查 3：系统消息的换行不能压成一行。"""
        self.hub.create(1, {"text": "第一行\n第二行", "author_kind": "system"})
        await self.open()
        self.assertEqual(await self.page.eval_on_selector(".msg.system .text", "e => e.innerText"), "第一行\n第二行")

    async def test_enter_keycode_229_does_not_send(self):
        """审查 4：Safari 输入法选字时回车只给 keyCode=229（isComposing 为 false），不能发出去。"""
        await self.open()
        await self.page.fill("#in", "nihao")
        await self.page.evaluate("""() => { const e = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
            Object.defineProperty(e, 'keyCode', {get: () => 229}); document.getElementById('in').dispatchEvent(e); }""")
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(author_kind="user"), [])
        self.assertEqual(await self.page.input_value("#in"), "nihao")

    async def test_edit_escape_cancels(self):
        self.hub.create(1, {"text": "原话"})
        await self.open()
        await self.page.fill("#in", "草稿")
        await self.page.hover(".msg")
        await self.page.click(".msg .acts [data-act=edit]")
        await self.page.keyboard.press("Escape")
        self.assertFalse(await self.page.is_visible("#editing"))
        self.assertEqual(await self.page.input_value("#in"), "草稿")   # 取消编辑还原草稿
        self.assertEqual(self.rows(author_kind="user")[0]["text"], "原话")


class RenderMobile(RenderWeb):
    mobile = True

    async def test_enter_newline_send_button_sends(self):
        """手机没有 Shift：回车换行，点发送按钮发（同 Discord 手机版）。"""
        await self.open()
        await self.page.tap("#in")
        await self.page.keyboard.type("一")
        await self.page.keyboard.press("Enter")
        await self.page.keyboard.type("二")
        self.assertEqual(await self.page.input_value("#in"), "一\n二")
        await self.page.tap("#f button")
        await wait_for(lambda: self.rows(author_kind="user"), what="消息入库")
        self.assertEqual(self.rows(author_kind="user")[-1]["text"], "一\n二")

    async def test_long_press_opens_actions(self):
        self.hub.create(1, {"text": "手机上发错了"})
        await self.open()
        box = await self.page.locator(".msg .text").bounding_box()
        x, y = box["x"] + 10, box["y"] + box["height"] / 2
        cdp = await self.ctx.new_cdp_session(self.page)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        await asyncio.sleep(0.7)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        await self.page.wait_for_selector("#msgmenu [data-act=edit]", state="visible", timeout=3000)
        for act in ("copy", "edit", "delete"):
            self.assertTrue(await self.page.is_visible(f"#msgmenu [data-act={act}]"), act)
        await self.page.tap("#msgmenu [data-act=edit]")
        self.assertEqual(await self.page.input_value("#in"), "手机上发错了")
        self.assertFalse(await self.page.is_visible("#msgmenu"))

    async def test_long_press_in_archived_room_copy_only(self):
        """审查 1（集成）：归档频道只读，手机长按菜单也只剩复制，和桌面悬停栏一致。"""
        r2 = self.hub.create_room({"name": "工作"})["id"]
        self.hub.create(r2, {"text": "工作里我说的"})
        await self.open()
        await self.page.evaluate(f"document.querySelector('#chlist .ch[data-id=\"{r2}\"]').click()")
        await self.page.wait_for_function("document.getElementById('room').textContent === '工作'", timeout=3000)
        async with self.http.delete(f"{self.url}/api/rooms/{r2}", headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        await self.page.wait_for_function("document.getElementById('in').disabled", timeout=3000)
        box = await self.page.locator(".msg .text").bounding_box()
        x, y = box["x"] + 10, box["y"] + box["height"] / 2
        cdp = await self.ctx.new_cdp_session(self.page)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        await asyncio.sleep(0.7)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        await self.page.wait_for_selector("#msgmenu [data-act=copy]", state="visible", timeout=3000)
        self.assertEqual(await self.page.locator("#msgmenu [data-act=edit], #msgmenu [data-act=delete]").count(), 0)

    async def test_long_press_then_pointercancel_resets_swallow(self):
        """审查 4：长按出菜单后收到 pointercancel（如系统接管手势），吞点击的标记要复位，否则下一次正常点击被吞。"""
        self.hub.create(1, {"text": "手机上发错了"})
        await self.open()
        box = await self.page.locator(".msg .text").bounding_box()
        x, y = box["x"] + 10, box["y"] + box["height"] / 2
        cdp = await self.ctx.new_cdp_session(self.page)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        await asyncio.sleep(0.7)
        await self.page.wait_for_selector("#msgmenu.on", timeout=3000)
        await cdp.send("Input.dispatchTouchEvent", {"type": "touchCancel", "touchPoints": []})
        await asyncio.sleep(0.6)
        self.assertFalse(await self.page.evaluate("swallow"))


if __name__ == "__main__":
    unittest.main()
