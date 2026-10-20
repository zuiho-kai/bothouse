"""成员栏一个角色只出现一次（用户 2026-10-20「你这什么狗屎，你是怎么验收过的，这叫对齐么」，截图里橘、鲸鱼娘、彩虹猫各两行：
主机角色「待机 + 音量」一行、cc-connect bot「BOT 在线」一行）。照 Discord：一个角色一行；有 bot 的按 bot 显示在线/思考中/离线，
主机角色在说话时照旧进「正在说」；板子在线才有音量滑条，并在同一行。"""
from __future__ import annotations

import unittest

from tests import test_hub as th
from tests.test_cloudweb import CloudWebBase
from tests.test_hub import TOKEN, async_playwright

LAUNCH_ARGS = ["--mute-audio", "--autoplay-policy=user-gesture-required"]   # 无头浏览器静音（用户禁令「不让板子或 Mac 出声」）


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class MemberDedupe(CloudWebBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(args=LAUNCH_ARGS)
        self.page = await self.browser.new_page(viewport={"width": 390, "height": 844})

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    async def names(self):
        return await self.page.eval_on_selector_all("#members .member .nm",
                                                    "es => es.map(e => e.firstChild.textContent.trim())")

    async def test_one_row_per_role(self):
        self.hub.set_members([{"id": "ju", "name": "橘"}, {"id": "jy", "name": "鲸鱼娘"}, {"id": "solo", "name": "小板"}])
        await self.registered("maomao", "橘")
        await self.registered("longniang", "龙娘")
        self.hub.remember_bot("jingyu", "鲸鱼娘")   # 鲸鱼娘 bot 离线
        await self.open()
        await self.page.wait_for_function("document.querySelectorAll('#members .member.bot').length >= 2", timeout=5000)
        names = await self.names()
        self.assertEqual(sorted(names), sorted(["你", "橘", "鲸鱼娘", "小板", "龙娘"]), names)   # 每人一行
        # 有 bot 的按 bot：橘在线带 BOT 标；鲸鱼娘 bot 离线进「离线」；没 bot 的主机角色照旧待机
        self.assertEqual(await self.page.text_content("#bot-maomao .state"), "在线")
        self.assertEqual(await self.page.locator("#bot-maomao .tag").count(), 1)
        self.assertEqual(await self.page.text_content("#bot-jingyu .state"), "离线")
        self.assertEqual(await self.page.text_content("#head-solo .state"), "待机")
        self.assertEqual(await self.page.locator("#head-ju").count(), 0)
        # 没板子在线时不画灰掉的音量条（Discord 没有这东西，灰条只是噪音）
        self.assertEqual(await self.page.locator("#members .vol").count(), 0)

    async def test_voice_state_and_volume_merge_into_bot_row(self):
        self.hub.set_members([{"id": "ju", "name": "橘"}])
        await self.registered("maomao", "橘")
        await self.open()
        await self.page.wait_for_selector("#bot-maomao", timeout=5000)
        # 板子音量到了：滑条出现在同一行
        await self.page.evaluate("() => { volumes = {ju: 40}; renderMembers(); }")
        self.assertEqual(await self.page.locator("#bot-maomao .vol input[data-role=ju]").count(), 1)
        self.assertEqual(await self.names(), ["你", "橘"])
        # 主机角色在说话：这一行进「正在说」，不另起一行
        await self.http.post(self.url + "/api/rooms/1/messages", headers=th.AUTH,
                             json={"text": "在说", "author_kind": "role", "author": "ju", "name": "橘"})
        await self.page.wait_for_selector("#bot-maomao.speaking", timeout=5000)
        self.assertEqual(await self.page.text_content("#members .cat"), "正在说 — 1")
        self.assertEqual(await self.page.text_content("#bot-maomao .state"), "正在说")
        self.assertEqual(await self.names(), ["橘", "你"])

    async def test_bot_offline_but_board_online_stays_reachable(self):
        self.hub.set_members([{"id": "jy", "name": "鲸鱼娘"}])
        self.hub.remember_bot("jingyu", "鲸鱼娘")   # bot 离线
        await self.open()
        await self.page.wait_for_selector("#bot-jingyu", timeout=5000)
        self.assertEqual(await self.page.text_content("#bot-jingyu .state"), "离线")
        await self.page.evaluate("() => { volumes = {jy: 30}; renderMembers(); }")   # 板子上线：语音还能找她
        self.assertEqual(await self.page.text_content("#bot-jingyu .state"), "待机")
        self.assertEqual(await self.page.locator("#members .cat").all_text_contents(), ["在线 — 2"])
        self.assertEqual(await self.names(), ["你", "鲸鱼娘"])

