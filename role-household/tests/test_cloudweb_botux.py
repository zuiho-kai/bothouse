"""cc-connect 的 bot 在 hub 上的显示（用户 2026-10-20「你可以去修一下自建平台，那边感觉还是很垃圾…你先看看距离discord差异有什么」）：
成员栏里的 bot 和在线、思考中；进度卡片原地更新（照 Discord：做完保留、只留最近 6 步）；长回复不再拆碎；bot 用单独的 token。
差距表见 /tmp/rh-botux/GAP.md（分支 feat/plat-botux）。这里用 aiohttp 客户端假装 cc-connect，不起 cc-connect、不调模型。"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.hub import Hub, make_app
from rh.meeting import MAX_TEXT_CHARS
from tests.test_cloudweb import JU_ID, LN_ID, CloudWebBase
from tests.test_hub import AUTH, TOKEN, async_playwright, wait_for
from tests.test_hub_render import RenderWeb
from rh.cloudweb import card_from

PREFIX = "__cc_connect_progress_card_v1__:"   # cc-connect core/progress_compact.go ProgressCardPayloadPrefix


def card(state="running", steps=1, items=None, sec=3):
    items = items if items is not None else [{"kind": "tool_use", "text": "ls -la", "tool": "Bash"}]
    return PREFIX + json.dumps({"agent": "CC", "lang": "zh", "state": state, "items": items, "truncated": False,
                                "steps": steps, "elapsed_sec": sec, "line_len": 200}, ensure_ascii=False)


class BotsBase(CloudWebBase):
    async def until(self, ws, typ, timeout=5.0):
        """收帧直到某类型（中间的 message 等不管）。"""
        while True:
            d = await self.recv(ws, timeout)
            if d.get("type") == typ:
                return d


class Capabilities(BotsBase):
    async def test_ack_declares_editing(self):
        """进度卡片要 preview + update_message；流式预览收尾要 delete_message；思考中靠 typing（cc-connect cloudweb.go 各方法按能力降级）。"""
        ws = await self.bot("maomao", "橘")
        ack = await self.recv(ws)
        for cap in ("text", "reconstruct_reply", "preview", "update_message", "delete_message", "typing"):
            self.assertIn(cap, ack["capabilities"])


class Members(BotsBase):
    async def test_bots_listed_with_online_state(self):
        web = await self.web_client()
        ready = await self.recv(web)
        self.assertEqual(ready["bots"], [])
        ju = await self.registered("maomao", "橘", JU_ID)
        d = await self.until(web, "bots")
        self.assertEqual([(b["id"], b["name"], b["online"]) for b in d["bots"]], [("maomao", "橘", True)])
        await ju.close()
        d = await self.until(web, "bots")
        self.assertEqual([(b["id"], b["online"]) for b in d["bots"]], [("maomao", False)])   # 断了还在，显示离线

    async def test_bots_remembered_across_hub_restart(self):
        ju = await self.registered("maomao", "橘")
        await self.registered("longniang", "龙娘")
        await ju.close()
        await self.stop_hub()
        await self.start_hub()
        web = await self.web_client()
        ready = await self.recv(web)
        self.assertEqual([(b["id"], b["name"], b["online"]) for b in ready["bots"]],
                         [("maomao", "橘", False), ("longniang", "龙娘", False)])   # 按第一次连上的先后

    async def test_typing_is_thinking_per_room(self):
        async with self.http.post(self.url + "/api/rooms", json={"name": "二"}, headers=AUTH) as r:
            room2 = (await r.json())["id"]
        web = await self.web_client()
        await self.recv(web)
        ju = await self.registered("maomao", "橘")
        ln = await self.registered("longniang", "龙娘")
        await ju.send_json({"type": "typing_start", "session_key": "cloud_web:room-1", "reply_ctx": "room-1"})
        d = await self.until(web, "bot_thinking")
        self.assertEqual((d["room"], d["bots"]), (1, ["maomao"]))
        await ln.send_json({"type": "typing_start", "session_key": "cloud_web:room-1", "reply_ctx": "room-1"})
        self.assertEqual((await self.until(web, "bot_thinking"))["bots"], ["maomao", "longniang"])   # 可以几个一起想
        await ln.send_json({"type": "typing_start", "reply_ctx": f"room-{room2}"})   # 别的频道的不推给这个频道
        await ju.send_json({"type": "typing_stop", "session_key": "cloud_web:room-1", "reply_ctx": "room-1"})
        self.assertEqual((await self.until(web, "bot_thinking"))["bots"], ["longniang"])
        web2 = await self.web_client()
        await web2.send_json({"type": "join", "room": room2})
        await self.recv(web2)
        self.assertEqual((await self.recv(web2))["bots_thinking"], ["longniang"])   # 切过去的 ready 里带着
        await ln.close()   # 断线 = 不在想了
        self.assertEqual((await self.until(web, "bot_thinking"))["bots"], [])


class ProgressCard(BotsBase):
    async def test_card_updates_in_place_and_stays(self):
        web = await self.web_client()
        await self.recv(web)
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "preview_start", "ref_id": "prev-1", "session_key": "cloud_web:room-1",
                            "reply_ctx": "room-1", "content": card()})
        ack = await self.until(ju, "preview_ack")
        self.assertEqual(ack["ref_id"], "prev-1")
        m = (await self.until(web, "message"))["message"]
        self.assertEqual(ack["preview_handle"], str(m["id"]))
        self.assertEqual((m["author"], m["name"], m["status"]), ("maomao", "橘", "done"))
        c = json.loads(m["card"])
        self.assertEqual((c["state"], c["steps"], c["title"]), ("running", 1, "CC · 处理中"))
        self.assertIn("🔧 Bash — ls -la", m["text"])
        steps = [{"kind": "tool_use", "text": f"echo {i}", "tool": "Bash"} for i in range(6)]
        await ju.send_json({"type": "update_message", "session_key": "cloud_web:room-1",
                            "preview_handle": ack["preview_handle"], "content": card("completed", 7, steps, 75)})
        m2 = (await self.until(web, "message"))["message"]
        self.assertEqual(m2["id"], m["id"])   # 同一条原地改，不新发
        self.assertEqual(json.loads(m2["card"])["title"], "CC · 已完成")
        self.assertEqual(m2["text"].splitlines()[0], "第 7 步 · 1分15秒")   # 同 discord progress.go buildDiscordProgressBarLine
        self.assertEqual(m2["text"].splitlines()[1:], [f"🔧 Bash — echo {i}" for i in range(6)])
        self.assertEqual(len(self.rows(author="maomao")), 1)   # 做完保留，不收起
        await self.nothing(ln)   # 卡片不是对话，不转给队友

    async def test_stream_preview_deleted_then_final_reply(self):
        """cc-connect 流式预览：preview 原地长字，收尾删掉预览、另发正式回复（同 Discord DeletePreviewMessage）。"""
        web = await self.web_client()
        await self.recv(web)
        ju = await self.registered("maomao", "橘")
        ln = await self.registered("longniang", "龙娘")
        await ju.send_json({"type": "preview_start", "ref_id": "p2", "reply_ctx": "room-1", "content": "写到一半"})
        h = (await self.until(ju, "preview_ack"))["preview_handle"]
        await ju.send_json({"type": "update_message", "preview_handle": h, "content": "写到一半，又多了几个字"})
        await wait_for(lambda: [m["text"] for m in self.rows(author="maomao")] == ["写到一半，又多了几个字"], what="原地改")
        await ju.send_json({"type": "delete_message", "preview_handle": h})
        d = await self.until(web, "deleted")
        self.assertEqual(d["id"], int(h))
        await ju.send_json({"type": "reply", "reply_ctx": "room-1", "content": "写完了"})
        await wait_for(lambda: [m["text"] for m in self.rows(author="maomao")] == ["写完了"], what="正式回复")
        self.assertEqual((await self.recv(ln))["content"], "【橘】写完了")   # 只有正式回复转给队友
        await self.nothing(ln)

    async def test_cannot_touch_others_messages(self):
        ju = await self.registered("maomao", "橘")
        ln = await self.registered("longniang", "龙娘")
        _, user_msg = await self.post("人说的话")
        await ju.send_json({"type": "preview_start", "ref_id": "p3", "reply_ctx": "room-1", "content": "橘的"})
        h = (await self.until(ju, "preview_ack"))["preview_handle"]
        for bad in (h, str(user_msg["id"])):
            await ln.send_json({"type": "update_message", "preview_handle": bad, "content": "改掉"})
            await ln.send_json({"type": "delete_message", "preview_handle": bad})
        await ln.send_json({"type": "ping"})
        await self.until(ln, "pong")   # 上面几帧都处理完了
        self.assertEqual([m["text"] for m in self.hub.history(1, 0)], ["人说的话", "橘的"])

    async def test_preview_in_unknown_room_still_acked(self):
        """不回 ack 的话 cc-connect 要干等 10 秒（cloudweb.go SendPreviewStart）。"""
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "preview_start", "ref_id": "p4", "reply_ctx": "room-99", "content": card()})
        ack = await self.until(ju, "preview_ack")
        self.assertEqual((ack["ref_id"], ack["preview_handle"]), ("p4", ""))
        self.assertEqual(self.rows(author="maomao"), [])


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class CardMarkdownInBrowser(RenderWeb):
    async def test_thinking_bold_rendered_like_discord(self):
        """进度卡片正文照 Discord embed 的 description 渲染 Markdown（conest bridge/platform/discord/progress.go
        buildDiscordProgressList 原样拼进 Description，Discord 把 ** 画成粗体）。线上 room 2 #307 原样露了「**Confirming calculation**」。"""
        text, meta = card_from(card(items=[{"kind": "thinking", "text": "**Confirming calculation** I need to determine if 13 multiplied by 82 equals 1066."}]))
        self.hub.create(1, {"text": text, "author_kind": "role", "author": "longniang", "name": "龙娘", "status": "done"}, 100000, meta)
        await self.open()
        html = await self.page.eval_on_selector(".msg:last-child .pcard .pb", "e => e.innerHTML")
        body = await self.page.text_content(".msg:last-child .pcard .pb")
        self.assertIn("<strong>Confirming calculation</strong>", html)
        self.assertNotIn("**", body)
        self.assertEqual(body.split("💭")[0].strip(), "第 1 步 · 3秒")   # 第一行和步骤行还是分两行
        self.assertIn("\n", await self.page.eval_on_selector(".msg:last-child .pcard .pb", "e => e.innerText"))


class ReviewFixes(BotsBase):
    """代码审查（新上下文子 agent）提出的问题。"""

    async def test_reconnect_clears_stale_thinking(self):
        """一轮中途 cc-connect 重启：旧连接被新连接顶掉，typing_stop 不会再来，重新注册时清掉。"""
        web = await self.web_client()
        await self.recv(web)
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "typing_start", "reply_ctx": "room-1"})
        self.assertEqual((await self.until(web, "bot_thinking"))["bots"], ["maomao"])
        await self.registered("maomao", "橘")   # 同名新连接
        self.assertEqual((await self.until(web, "bot_thinking"))["bots"], [])

    async def test_bot_id_cannot_be_a_role(self):
        """bot id 和主机角色撞了的话，它能改主机角色的消息、成员栏也乱：不让连。"""
        async with self.http.put(self.url + "/api/members", json=[{"id": "ju", "name": "橘"}], headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        ws = await self.bot("ju", "橘")
        ack = await self.recv(ws)
        self.assertFalse(ack["ok"])

    async def test_only_preview_messages_editable(self):
        """bot 只能改、删自己用 preview_start 建的（进度卡片），已经转给队友的正式回复不能改。"""
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "reply", "reply_ctx": "room-1", "content": "正式回复"})
        await wait_for(lambda: self.rows(author="maomao"), what="回复进频道")
        rid = str(self.rows(author="maomao")[0]["id"])
        await ju.send_json({"type": "update_message", "preview_handle": rid, "content": "改掉"})
        await ju.send_json({"type": "delete_message", "preview_handle": rid})
        await ju.send_json({"type": "ping"})
        await self.until(ju, "pong")
        self.assertEqual([m["text"] for m in self.rows(author="maomao")], ["正式回复"])

    async def test_reconnect_ready_carries_card_updates(self):
        """网页断线期间卡片改了：重连只补新 id 的话卡片停在「处理中」。ready 带上这个频道的卡片最新样子。"""
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "preview_start", "ref_id": "r1", "reply_ctx": "room-1", "content": card()})
        h = (await self.until(ju, "preview_ack"))["preview_handle"]
        since = int(h)
        await ju.send_json({"type": "update_message", "preview_handle": h, "content": card("completed", 2)})
        await wait_for(lambda: json.loads(self.rows(author="maomao")[0]["card"])["state"] == "completed", what="卡片改完")
        web = await self.web_client(since=since)
        ready = await self.recv(web)
        self.assertEqual(ready["messages"], [])
        self.assertEqual([(m["id"], json.loads(m["card"])["state"]) for m in ready["cards"]], [(since, "completed")])


class Migration(unittest.TestCase):
    def test_old_db_gets_card_column_and_bots_table(self):
        import sqlite3, tempfile
        db = Path(tempfile.mkdtemp()) / "hub.sqlite3"
        Hub(db, TOKEN).db.close()
        con = sqlite3.connect(db)
        con.execute("ALTER TABLE messages DROP COLUMN card")   # 做成升级前的库
        con.execute("DROP TABLE bots")
        con.commit(); con.close()
        hub = Hub(db, TOKEN)
        msg, _ = hub.create(1, {"text": "老库也能用"})
        self.assertIsNone(msg["card"])
        hub.remember_bot("maomao", "橘")
        self.assertEqual(hub.bot_list(), [{"id": "maomao", "name": "橘", "online": False}])


class LongReply(BotsBase):
    async def test_long_reply_is_one_message(self):
        """cc-connect 已经按 4000 字、不切断代码块地分好段（core/engine.go maxPlatformMessageLen、SplitMessageCodeFenceAware），
        hub 再按 2000 字硬切会把代码块切断、碎成几条：一段回复存一条。"""
        ju = await self.registered("maomao", "橘")
        text = "```python\n" + "x = 1\n" * 600 + "```"   # 3600 多字，跨过 MAX_TEXT_CHARS
        self.assertGreater(len(text), MAX_TEXT_CHARS)
        await ju.send_json({"type": "reply", "reply_ctx": "room-1", "content": text})
        await wait_for(lambda: self.rows(author="maomao"), what="回复进频道")
        self.assertEqual([m["text"] for m in self.rows(author="maomao")], [text])


class BotToken(BotsBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await self.stop_hub()
        self.start_hub = self._start_with_bot_token
        await self.start_hub()

    async def _start_with_bot_token(self):
        from aiohttp import web
        self.hub = Hub(self.db, TOKEN, bot_token="bot-token")
        self.runner = web.AppRunner(make_app(self.hub))
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", self.port or 0)
        await site.start()
        self.port = self.runner.addresses[0][1]
        self.url = f"http://127.0.0.1:{self.port}"

    async def test_bots_use_their_own_token(self):
        for tok in (TOKEN, "wrong"):   # 网页登录的 token 不能当 bot 连
            with self.assertRaises(Exception):
                await self.http.ws_connect(f"{self.url}/cloud-web/ws?bot=maomao",
                                           headers={"Authorization": f"Bearer {tok}"})
        ws = await self.bot("maomao", "橘", token="bot-token")
        self.assertTrue((await self.recv(ws))["ok"])
        async with self.http.get(self.url + "/api/rooms", headers={"Authorization": "Bearer bot-token"}) as r:
            self.assertEqual(r.status, 401)   # bot 的 token 不能读写网页的接口
        web = await self.web_client(token="bot-token")
        msg = await web.receive(timeout=5)
        self.assertEqual(web.close_code, 4001, msg)


if __name__ == "__main__":
    unittest.main()
