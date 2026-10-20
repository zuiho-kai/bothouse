"""cc-connect 的子进程表在 hub 上的显示（用户 2026-10-20「你先看看距离discord差异有什么」；产品核心「agent team管理」）。
照 Discord（conest bridge/platform/discord/subtasks.go）：一张表一条消息，原地改到全部完成；复用进度卡片的 preview_start /
update_message（rh/cloudweb.py），不另做组件。这里用 aiohttp 客户端假装 cc-connect，不起 cc-connect、不调模型。"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.cloudweb import CAPABILITIES, subtask_table_from
from tests.test_cloudweb import JU_ID, LN_ID
from tests.test_cloudweb_botux import BotsBase
from tests.test_hub_render import RenderWeb
from tests.test_hub import async_playwright

PREFIX = "__cc_connect_subtask_table_v1__:"   # conest bridge/core/subtasks.go SubTaskTablePayloadPrefix
ZERO = "0001-01-01T00:00:00Z"                 # Go 的零时间：EndedAt 带 omitempty 也照样写出来


def table(*tasks, lang="zh"):
    return PREFIX + json.dumps({"lang": lang, "tasks": list(tasks)}, ensure_ascii=False)


def task(desc, status="running", bg=False, step="", summary="", start="2026-10-20T09:00:00.123456789Z", end=ZERO):
    t = {"id": desc, "description": desc, "status": status, "started_at": start, "ended_at": end}
    if bg:
        t["background"] = True
    if step:
        t["step"] = step
    if summary:
        t["summary"] = summary
    return t


START = 1792486800   # 2026-10-20T09:00:00Z


class Render(unittest.TestCase):
    def test_not_a_table(self):
        self.assertIsNone(subtask_table_from("普通的话"))
        self.assertIsNone(subtask_table_from(PREFIX + "{坏的"))

    def test_running_rows_like_discord(self):
        text, card = subtask_table_from(table(task("查代码", step="Grep foo"), task("跑实验", bg=True)))
        # discord/subtasks.go buildDiscordSubTaskRow：「图标 前台/后台 · 描述 · 开始于 <t:…:R>」，下一行「　└ 当前那一步」
        self.assertEqual(text.splitlines(), [f"🔄 前台 · 查代码 · 开始于 <t:{START}:R>", "　└ Grep foo",
                                             f"🔄 后台 · 跑实验 · 开始于 <t:{START}:R>"])
        self.assertEqual(json.loads(card), {"title": "子进程表", "state": "running"})

    def test_done_rows_show_duration_and_summary(self):
        text, card = subtask_table_from(table(
            task("查代码", "completed", step="Grep", summary="找到了三处", end="2026-10-20T09:01:05Z"),
            task("跑实验", "failed", bg=True, summary="exit 1", end="2026-10-20T09:00:09Z")))
        self.assertEqual(text.splitlines(), ["✅ 前台 · 查代码 · 用时 1分05秒", "　└ 找到了三处",
                                             "❌ 后台 · 跑实验 · 用时 9秒", "　└ exit 1"])
        self.assertEqual(json.loads(card)["state"], "failed")   # 同 Discord 颜色：有失败的红，全好绿
        _, card = subtask_table_from(table(task("a", "completed", end="2026-10-20T09:00:01Z"),
                                           task("b", "stopped", end="2026-10-20T09:00:01Z")))
        self.assertEqual(json.loads(card)["state"], "completed")

    def test_waiting_row(self):
        text, card = subtask_table_from(table(task("跑实验", "waiting", bg=True, step="等 nohup 跑完")))
        self.assertEqual(text.splitlines(), [f"⏳ 后台 · 跑实验 · 开始于 <t:{START}:R>", "　└ 等自己的后台任务 — 等 nohup 跑完"])
        self.assertEqual(json.loads(card)["state"], "running")   # 没真结束，还算在跑

    def test_long_text_trimmed(self):
        text, _ = subtask_table_from(table(task("长" * 100, step="步\n" * 100)))
        head, detail = text.splitlines()
        self.assertTrue(head.startswith("🔄 前台 · " + "长" * 79 + "… · "))   # discord maxDiscordProgressLineLen 80
        self.assertEqual(len(detail), len("　└ ") + 80)


class English(unittest.TestCase):
    """payload 带 lang：英文照 discord/subtasks.go（Sub-agents / fg / bg / started / 1m05s / waiting for …）。审查第 2 条。"""

    def test_english_rows(self):
        text, card = subtask_table_from(table(task("look", step="Grep"), task("run", "waiting", bg=True, step="nohup"),
                                              task("done", "completed", summary="ok", end="2026-10-20T09:01:05Z"), lang="en"))
        self.assertEqual(text.splitlines(), [f"🔄 fg · look · started <t:{START}:R>", "　└ Grep",
                                             f"⏳ bg · run · started <t:{START}:R>", "　└ waiting for its own background task — nohup",
                                             "✅ fg · done · 1m05s", "　└ ok"])
        self.assertEqual(json.loads(card)["title"], "Sub-agents")

    def test_lang_normalized_like_discord(self):
        """同 discord/subtasks.go（normalizeDiscordProgressLang == "zh"）：zh-CN 中文；zh-TW / zh-HK 和别的语言都是英文。"""
        for lang, want in (("zh-CN", "子进程表"), ("zh-TW", "Sub-agents"), ("zh-HK", "Sub-agents"), ("ja", "Sub-agents")):
            _, card = subtask_table_from(table(task("a"), lang=lang))
            self.assertEqual(json.loads(card)["title"], want, lang)


class TotalLimit(unittest.TestCase):
    def test_whole_table_capped_like_discord(self):
        """整张表最多 3500 字（discord/progress.go maxDiscordProgressDescLen），超了截断加「…」（trimDiscordRunes）。审查第 3 条。"""
        text, _ = subtask_table_from(table(*[task(f"任务{i}" + "长" * 70, step="步" * 80) for i in range(40)]))
        self.assertEqual(len(text), 3500)
        self.assertTrue(text.endswith("…"))


class Capability(BotsBase):
    async def test_declares_subtask_table(self):
        """cc-connect 只对声明了 subtask_table 的 hub 发表（旧 hub 会把表当原始数据显示）。审查第 1 条。"""
        self.assertIn("subtask_table", CAPABILITIES)
        ws = await self.bot("maomao", "橘")
        self.assertIn("subtask_table", (await self.recv(ws))["capabilities"])


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class TimeInBrowser(RenderWeb):
    async def test_discord_timestamp_drawn_as_local_time(self):
        """hub.html：卡片正文里 Discord 的 <t:秒:R> 画成本地时刻；普通消息里的同样字样不动。审查第 4 条。"""
        text, card = subtask_table_from(table(task("查代码", step="Grep")))
        self.hub.create(1, {"text": "原样 <t:1:R>", "author_kind": "role", "author": "ju", "name": "橘"})
        self.hub.create(1, {"text": text, "author_kind": "role", "author": "ju", "name": "橘", "status": "done"}, 100000, card)
        await self.open()
        want = await self.page.evaluate(f"new Date({START}*1000).toLocaleTimeString('zh-CN', {{hour12:false, hour:'2-digit', minute:'2-digit'}})")
        body = await self.page.text_content(".msg:last-child .pcard .pb")
        self.assertEqual(body.splitlines()[0], f"🔄 前台 · 查代码 · 开始于 {want}")
        self.assertEqual(await self.page.text_content(".pcard .pt"), "子进程表")
        self.assertIn("<t:1:R>", await self.page.text_content(".msg:nth-last-child(2) .text"))


class InPlace(BotsBase):
    async def test_table_updates_in_place_until_done(self):
        web = await self.web_client()
        await self.recv(web)
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "preview_start", "ref_id": "prev-9", "session_key": "cloud_web:room-1",
                            "reply_ctx": "room-1", "content": table(task("查代码", step="Grep"))})
        ack = await self.until(ju, "preview_ack")
        m = (await self.until(web, "message"))["message"]
        self.assertEqual(ack["preview_handle"], str(m["id"]))
        self.assertEqual(json.loads(m["card"])["title"], "子进程表")
        self.assertIn("🔄 前台 · 查代码", m["text"])
        await ju.send_json({"type": "update_message", "session_key": "cloud_web:room-1", "preview_handle": ack["preview_handle"],
                            "content": table(task("查代码", "completed", summary="好了", end="2026-10-20T09:00:30Z"))})
        m2 = (await self.until(web, "message"))["message"]
        self.assertEqual(m2["id"], m["id"])   # 同一条原地改
        self.assertEqual(json.loads(m2["card"])["state"], "completed")
        self.assertEqual(m2["text"], "✅ 前台 · 查代码 · 用时 30秒\n　└ 好了")
        self.assertEqual(len(self.rows(author="maomao")), 1)
        await self.nothing(ln)   # 表不是对话，不转给队友


if __name__ == "__main__":
    unittest.main()
