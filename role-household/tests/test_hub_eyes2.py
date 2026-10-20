"""频道网页和 Discord 对齐的第二轮（019de9a、44e689c 审查留下的几条）。
用户原话：「你这什么狗屎，你是怎么验收过的，这叫对齐么」。
无头 Chromium 静音，只连测试里起的本地 hub，不点“开声音”。"""
from __future__ import annotations

import datetime
import re
import time
import unittest

from tests.test_hub_eyes import FOOT, ROLES, bot_says
from tests.test_hub_mobile import WebBase


class Eyes2(WebBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.page.set_default_timeout(5000)

    def seed_bots(self):
        self.hub.set_members(ROLES)
        self.hub.remember_bot("maomao", "橘")
        self.hub.remember_bot("longniang", "龙娘")

    # ---------- 1. bot 正文里的 @用户 显示成 @你，像 Discord 提到自己那样高亮 ----------
    async def test_bot_mention_of_user_shows_ni_and_highlights(self):
        self.seed_bots()
        m = bot_says(self.hub, "弄好了 @用户 你看一下")
        bot_says(self.hub, "@龙娘 你接着做", bot="maomao")
        await self.open()
        first = f'#log > .msg[data-id="{m["id"]}"]'
        self.assertEqual(await self.page.text_content(f"{first} .mention.me"), "@你")
        self.assertNotIn("@用户", await self.page.text_content(f"{first} .text"))
        self.assertTrue(await self.page.eval_on_selector(first, "e => e.classList.contains('mentioned')"))
        st = await self.page.eval_on_selector(first, "e => { const s = getComputedStyle(e); return [s.backgroundColor, s.borderLeftWidth]; }")
        self.assertNotEqual(st[0], "rgba(0, 0, 0, 0)")   # 整条消息有底色，同 Discord 提到自己
        # 提到别人的那条照旧：普通提及，不整条高亮
        self.assertEqual(await self.page.locator("#log > .msg.mentioned").count(), 1)
        self.assertEqual(await self.page.locator(".mention.me").count(), 1)
        # 库里存的照旧是「用户」（bot 的 @、手机通知靠它）
        row = self.hub.db.execute("SELECT text FROM messages WHERE id=?", (m["id"],)).fetchone()
        self.assertIn("@用户", row[0])

    async def test_mention_user_needs_word_boundary(self):
        """@user 后面接着字母（@username）不是叫我，同 rh/hub.py 的 @ 判断。"""
        self.seed_bots()
        bot_says(self.hub, "@username 不是你，@user 才是")
        await self.open()
        self.assertEqual(await self.page.locator(".mention.me").count(), 1)
        self.assertIn("@username", await self.page.text_content(".msg:last-of-type .text"))

    # ---------- 2. 尾注照 cc-connect 的写法认：content + "\n\n*" + footer + "*" ----------
    async def split(self, raw):
        return await self.page.evaluate(
            "raw => splitFoot({author_kind: 'role', author: 'maomao'}, raw)", raw)

    async def test_footer_rules_follow_cc_connect(self):
        self.seed_bots()
        await self.open()
        cases = {
            FOOT: ["平台通了", "claude-opus-5-5 · out 90 · in 2 cw 16.9k cr 12.2k · ctx 15%\n~/im-bridge/claude"],
            # 关掉上下文指示：只剩工作目录，没有「·」
            "好了\n\n*~/im-bridge/claude*": ["好了", "~/im-bridge/claude"],
            "好了\n\n*/opt/work*": ["好了", "/opt/work"],
            # 富卡片那套（用时、模型行、额度行、目录）
            "好了\n\n*⏱ 用时 3.2 秒\nclaude-opus-5-5 · high · out 90 · ctx 15%\n额度剩余 40%\n~/x*": [
                "好了", "⏱ 用时 3.2 秒\nclaude-opus-5-5 · high · out 90 · ctx 15%\n额度剩余 40%\n~/x"],
            "好了\n\n*⏱ Elapsed 1m 02s*": ["好了", "⏱ Elapsed 1m 02s"],
            # 旧版一行（buildReplyFooter）
            "好了\n\n*gpt-6.1 · xhigh · [ctx: ~40%] · 额度暂不可查询 · ~/im-bridge/longniang*": [
                "好了", "gpt-6.1 · xhigh · [ctx: ~40%] · 额度暂不可查询 · ~/im-bridge/longniang"],
            "好了\n\n*gpt-6.1 · 剩余 60%*": ["好了", "gpt-6.1 · 剩余 60%"],
            # 正文为空时 cc-connect 只发 "*footer*"
            "*~/im-bridge/claude*": ["", "~/im-bridge/claude"],
            # 正文最后一段碰巧是斜体：不是尾注
            "说完了\n\n*以上纯属个人看法*": None,
            "说完了\n\n*第一 · 第二*": None,
            "说完了\n\n*ok*": None,
            # 整条都是斜体：正文不能被清空
            "*整条都是斜体的一句话*": None,
            "*a · b*": None,
            # 只隔一个换行、后面还有字、尾注里有星号：都不是 cc-connect 的写法
            "好了\n*~/im-bridge/claude*": None,
            "好了\n\n*~/im-bridge/claude* 还有字": None,
            "好了\n\n**~/im-bridge/claude**": None,
        }
        for raw, want in cases.items():
            got = await self.split(raw)
            self.assertEqual(got, want if want else [raw, None], raw)

    async def test_footer_only_bots(self):
        self.seed_bots()
        await self.open()
        got = await self.page.evaluate("splitFoot({author_kind: 'user', author: 'user'}, '好了\\n\\n*~/x*')")
        self.assertEqual(got, ["好了\n\n*~/x*", None])

    async def test_footer_without_dot_and_all_italic_in_dom(self):
        self.seed_bots()
        a = bot_says(self.hub, "好了\n\n*~/im-bridge/claude*")
        b = bot_says(self.hub, "*整条都是斜体的一句话*")
        await self.open()
        sa, sb = (f'#log > .msg[data-id="{x["id"]}"]' for x in (a, b))
        self.assertEqual(await self.page.text_content(f"{sa} .foot"), "~/im-bridge/claude")
        self.assertEqual(await self.page.eval_on_selector(f"{sa} .text", "e => e.querySelector('.p').textContent"), "好了")
        self.assertEqual(await self.page.locator(f"{sb} .foot").count(), 0)
        self.assertEqual(await self.page.text_content(f"{sb} .text em"), "整条都是斜体的一句话")

    # ---------- 3. 搜索结果里 bot 有 BOT 标 ----------
    async def test_search_hit_bot_tag(self):
        self.seed_bots()
        self.hub.create(1, {"text": "暗号甲"})
        bot_says(self.hub, "暗号乙")
        await self.open()
        await self.page.fill("#q", "暗号")
        await self.page.press("#q", "Enter")
        await self.page.wait_for_selector("#results .hit")
        tags = await self.page.eval_on_selector_all("#results .hit", "es => es.map(e => [e.querySelector('.who').textContent, e.querySelector('.hdr .tag') ? e.querySelector('.hdr .tag').textContent : null])")
        self.assertEqual(sorted(tags, key=str), sorted([["你", None], ["橘", "BOT"]], key=str))

    # ---------- 4. 写死的占位和动态生成的一致 ----------
    async def test_static_placeholder_matches_dynamic(self):
        html = await (await self.page.request.get(f"{self.url}/")).text()   # 不用 urllib：hub 和测试在同一个事件循环里
        ph = re.search(r'<textarea id="in"[^>]*placeholder="([^"]*)"', html).group(1)
        await self.open()
        self.assertEqual(ph, await self.page.evaluate("inputHint(null)"))
        self.assertEqual(await self.page.get_attribute("#in", "placeholder"), await self.page.evaluate("inputHint(roomName)"))

    # ---------- 5. 「今天/昨天」进 msgSig，过了午夜会更新 ----------
    async def test_today_label_updates_after_midnight(self):
        self.seed_bots()
        late = datetime.datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
        t = time.mktime(late.timetuple())
        m = self.hub.create(1, {"text": "睡前一句"})[0]
        with self.hub.db:
            self.hub.db.execute("UPDATE messages SET created_at=?, updated_at=? WHERE id=?", (t, t, m["id"]))
        await self.page.clock.install(time=late + datetime.timedelta(seconds=30))
        await self.open()
        sel = f'#log > .msg[data-id="{m["id"]}"] .t'
        self.assertEqual(await self.page.text_content(sel), "今天 23:59")
        await self.page.clock.fast_forward(2 * 60 * 1000)
        await self.page.wait_for_function(f"document.querySelector('{sel}').textContent === '昨天 23:59'", timeout=3000)


if __name__ == "__main__":
    unittest.main()
