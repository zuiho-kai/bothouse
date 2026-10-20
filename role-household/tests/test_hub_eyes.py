"""频道网页按「用户视角验收清单」修的显示问题（/tmp/rh-eyes/REPORT.md）。
用户原话：「你这什么狗屎，你是怎么验收过的，这叫对齐么」「你可以去修一下自建平台…距离discord差异」。
无头 Chromium 静音，只连测试里起的本地 hub，不点“开声音”。"""
from __future__ import annotations

import time
import unittest

from tests.test_hub_mobile import DESKTOP, PHONE, WebBase

FOOT = "平台通了\n\n*claude-opus-5-5 · out 90 · in 2 cw 16.9k cr 12.2k · ctx 15%\n~/im-bridge/claude*"
ROLES = [{"id": "ju", "name": "橘"}, {"id": "jing", "name": "鲸鱼娘"}, {"id": "mao", "name": "彩虹猫"}]


def bot_says(hub, text, bot="maomao", name="橘", room=1):
    return hub.create(room, {"author_kind": "role", "author": bot, "name": name, "text": text})[0]


class Desktop(WebBase):
    VIEWPORT = DESKTOP

    def seed_bots(self):
        self.hub.set_members(ROLES)
        self.hub.remember_bot("maomao", "橘")
        self.hub.remember_bot("longniang", "龙娘")

    async def test_footer_is_faint_small_italic_without_stars(self):
        """清单第 5 条：bot 回复末尾的尾注照 Discord 显示成淡色小号斜体，不露星号。"""
        self.seed_bots()
        bot_says(self.hub, FOOT)
        await self.open()
        foot = ".msg:last-of-type .foot"
        self.assertEqual(await self.page.locator(foot).count(), 1)
        t = await self.page.text_content(foot)
        self.assertNotIn("*", t)
        self.assertIn("claude-opus-5-5", t)
        self.assertIn("~/im-bridge/claude", t)
        st = await self.page.eval_on_selector(foot, """e => { const s = getComputedStyle(e), b = getComputedStyle(e.closest('.text'));
          return {it: s.fontStyle, fs: parseFloat(s.fontSize), body: parseFloat(b.fontSize), color: s.color, bc: b.color}; }""")
        self.assertEqual(st["it"], "italic")
        self.assertLess(st["fs"], st["body"])
        self.assertNotEqual(st["color"], st["bc"])
        # 正文还在、不带尾注
        body = await self.page.eval_on_selector(".msg:last-of-type .text", "e => e.querySelector('.p').textContent")
        self.assertEqual(body, "平台通了")

    async def test_footer_only_for_bots(self):
        """用户自己发的结尾斜体段照常是斜体正文，不当尾注。"""
        self.seed_bots()
        self.hub.create(1, {"text": "看这个\n\n*只是强调*"})
        await self.open()
        self.assertEqual(await self.page.locator(".foot").count(), 0)

    async def test_placeholder_and_topic_match_mention_usage(self):
        """清单第 9 条：占位、topic 不再是旧会议模式「发话题、轮流接话」，改成 @ 角色说话；占位带当前频道名。"""
        self.seed_bots()
        await self.open()
        ph = await self.page.get_attribute("#in", "placeholder")
        topic = await self.page.text_content("#main .top .topic")
        for s in (ph, topic):
            self.assertNotIn("轮流", s)
            self.assertNotIn("话题", s)
            self.assertIn("@", s)
        self.assertIn("#大厅", ph)
        self.assertNotIn("轮流", await self.page.text_content("#empty"))

    async def test_mention_lists_every_bot_names_only(self):
        """清单第 12 条：@ 弹窗列出所有能 @ 的（含只有 bot 的龙娘），同名只出一次，只显示中文名、不露 ju/jing/mao。"""
        self.seed_bots()
        await self.open()
        await self.page.click("#in")
        await self.page.keyboard.type("@")
        await self.page.wait_for_selector("#mention-pop [role=option]")
        names = await self.page.eval_on_selector_all("#mention-pop [role=option] .nm", "es => es.map(e => e.textContent.trim())")
        shown = await self.page.text_content("#mention-pop")
        for pinyin in ("ju", "jing", "mao", "maomao", "longniang"):
            self.assertNotIn(pinyin, shown)
        self.assertEqual(sorted(names), sorted(["橘", "鲸鱼娘", "彩虹猫", "龙娘"]))
        await self.page.keyboard.type("龙")
        await self.page.wait_for_function("document.querySelectorAll('#mention-pop [role=option]').length === 1")
        await self.page.keyboard.press("Enter")
        self.assertEqual(await self.page.input_value("#in"), "@龙娘 ")

    async def test_my_name_is_ni_everywhere(self):
        """清单第 8 条：自己的名字统一叫「你」：消息署名、成员栏、左下角、搜索结果一致。"""
        self.seed_bots()
        self.hub.create(1, {"text": "我说一句暗号"})
        await self.open()
        self.assertEqual(await self.page.text_content(".msg:last-of-type .who"), "你")
        self.assertEqual(await self.page.text_content("#me .nm"), "你")
        await self.page.fill("#q", "暗号")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results .hit")
        self.assertEqual(await self.page.text_content("#results .hit .who"), "你")

    async def test_search_hit_footer_without_stars(self):
        """搜索结果里 bot 回复的尾注也不露星号，单独成淡色小字。"""
        self.seed_bots()
        bot_says(self.hub, FOOT)
        await self.open()
        await self.page.fill("#q", "平台")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results .hit")
        self.assertNotIn("*", await self.page.text_content("#results .hit .text"))
        self.assertEqual(await self.page.locator("#results .hit .foot").count(), 1)

    async def test_twin_bot_merges_and_has_bot_tag(self):
        """清单第 13、20 条：同名的角色和 bot（同一个人）连发合并成一组；bot 的消息名字后有 BOT 标。"""
        self.seed_bots()
        self.hub.create(1, {"author_kind": "role", "author": "ju", "name": "橘", "text": "第一句"})
        bot_says(self.hub, "第二句")
        bot_says(self.hub, "龙娘说", bot="longniang", name="龙娘")
        await self.open()
        self.assertEqual(await self.page.locator(".msg.cont").count(), 1)
        tags = await self.page.eval_on_selector_all(".msg:not(.cont) .hdr", "es => es.map(e => !!e.querySelector('.tag'))")
        self.assertEqual(tags, [False, True])   # 橘那组第一条是主机角色发的；龙娘是 bot

    async def test_day_divider_and_short_time(self):
        """清单第 14 条：跨天有日期分隔线；头上只写时间（今天的写「今天」），不再每条都是 2026/10/18 16:03。"""
        self.seed_bots()
        old = time.mktime((2026, 10, 18, 16, 3, 0, 0, 0, -1))
        a = self.hub.create(1, {"text": "前天的"})[0]
        b = self.hub.create(1, {"text": "前天第二条"})[0]
        c = self.hub.create(1, {"text": "今天的"})[0]
        with self.hub.db:
            self.hub.db.execute("UPDATE messages SET created_at=?, updated_at=? WHERE id IN (?, ?)", (old, old, a["id"], b["id"]))
        await self.open()
        divs = await self.page.eval_on_selector_all("#log > .daydiv", "es => es.map(e => e.textContent.trim())")
        self.assertEqual(len(divs), 2)
        self.assertIn("2026年10月18日", divs[0])
        heads = await self.page.eval_on_selector_all("#log > .msg:not(.cont) .t", "es => es.map(e => e.textContent)")
        self.assertEqual(heads[0], "16:03")
        self.assertTrue(heads[-1].startswith("今天 "), heads[-1])
        # 日期线在两天之间：第三条前面紧挨一条
        prev = await self.page.evaluate(f"""() => {{ const m = document.querySelector('#log > .msg[data-id="{c["id"]}"]');
          let p = m.previousElementSibling; if (p && p.classList.contains('newdiv')) p = p.previousElementSibling; return p.className; }}""")
        self.assertEqual(prev, "daydiv")


class Phone(WebBase):
    VIEWPORT = PHONE

    async def name_fully_visible(self):
        return await self.page.eval_on_selector("#room", """e => { const r = e.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + 2, r.top + r.height / 2);
          return e.scrollWidth <= e.clientWidth + 0.5 && r.width > 0 && !!top && (top === e || e.contains(top)); }""")

    async def test_topbar_keeps_channel_name(self):
        """清单第 7 条：手机顶栏照 Discord 只有 ☰ 频道名 搜索 成员；闭麦、开声音在左抽屉；频道名一直完整可见（开搜索时也是）。"""
        self.hub.set_members(ROLES)
        made = self.hub.create_room({"name": "八个字的长频道名"})
        await self.open()
        await self.page.evaluate(f"joinRoom({made['id']})")
        await self.page.wait_for_function("roomName === '八个字的长频道名'")
        for sel in ("#mic", "#sound", "#conn", "#q"):
            self.assertFalse(await self.page.eval_on_selector(sel, "e => !!e.closest('#main .top') && e.getBoundingClientRect().width > 0"), sel)
        self.assertTrue(await self.in_view("#open-search"))
        self.assertTrue(await self.name_fully_visible())
        await self.page.click("#open-search")
        self.assertTrue(await self.in_view("#q"))
        self.assertTrue(await self.name_fully_visible())
        await self.page.fill("#q", "什么")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results:not([hidden])")
        self.assertTrue(await self.in_view("#q"))   # 结果面板不盖住搜索框
        self.assertTrue(await self.name_fully_visible())
        # 闭麦、开声音在左抽屉里能点
        await self.page.click("#open-left")
        await self.page.wait_for_timeout(350)
        self.assertTrue(await self.in_view("#mic"))
        self.assertTrue(await self.in_view("#sound"))


if __name__ == "__main__":
    unittest.main()
