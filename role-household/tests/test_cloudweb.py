"""hub 的 cloud_web 入口：cc-connect 驱动的 bot 拨进 hub 说话（CWIP，cc-connect docs/cloud-web.md）。
这里用 aiohttp 客户端假装 cc-connect，不起 cc-connect、不调模型。"""
from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from urllib.parse import quote

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.meeting import MAX_TEXT_CHARS
from tests.test_hub import AUTH, TOKEN, HubBase, wait_for

JU_ID, LN_ID = "100000000000000101", "100000000000000102"   # 例子用 Discord 用户 ID 当 mention_id


class CloudWebBase(HubBase):
    async def bot(self, bot, name, mention_id="", token=TOKEN, project="p"):
        q = f"bot={bot}&name={quote(name)}" + (f"&mention_id={mention_id}" if mention_id else "")
        ws = await self.http.ws_connect(f"{self.url}/cloud-web/ws?{q}",
                                        headers={"Authorization": f"Bearer {token}"})
        self.ws_list.append(ws)
        await ws.send_json({"type": "register", "platform": "cloud_web", "client": "cc-connect",
                            "project": project, "transport": "websocket", "metadata": {"protocol_version": 1}})
        return ws

    async def registered(self, bot, name, mention_id=""):
        ws = await self.bot(bot, name, mention_id)
        ack = await self.recv(ws)
        self.assertEqual((ack["type"], ack["ok"]), ("register_ack", True))
        return ws

    async def nothing(self, ws, wait=0.3):
        with self.assertRaises(asyncio.TimeoutError):
            await ws.receive(timeout=wait)


class CloudWebHandshake(CloudWebBase):
    async def test_bad_token_rejected(self):
        with self.assertRaises(aiohttp.WSServerHandshakeError):
            await self.http.ws_connect(f"{self.url}/cloud-web/ws?bot=ju", headers={"Authorization": "Bearer wrong"})

    async def test_register_ack(self):
        ws = await self.bot("maomao", "橘")
        ack = await self.recv(ws)
        self.assertEqual(ack["type"], "register_ack")
        self.assertTrue(ack["ok"])
        self.assertIn("text", ack["capabilities"])

    async def test_bot_id_from_project_when_no_query(self):
        ws = await self.http.ws_connect(f"{self.url}/cloud-web/ws", headers=AUTH)
        self.ws_list.append(ws)
        await ws.send_json({"type": "register", "project": "longniang", "transport": "websocket"})
        self.assertTrue((await self.recv(ws))["ok"])
        await ws.send_json({"type": "reply", "reply_ctx": "1", "content": "在"})
        await wait_for(lambda: self.rows(author="longniang"), what="龙娘的话进频道")

    async def test_first_frame_must_be_register(self):
        ws = await self.http.ws_connect(f"{self.url}/cloud-web/ws?bot=x", headers=AUTH)
        self.ws_list.append(ws)
        await ws.send_json({"type": "reply", "content": "x"})
        ack = await self.recv(ws)   # cc-connect 把 ok=false 的 error 记进日志（protocol.go parseRegisterAck）
        self.assertEqual((ack["type"], ack["ok"]), ("register_ack", False))
        msg = await ws.receive(timeout=5)
        self.assertEqual(msg.type, aiohttp.WSMsgType.CLOSE)


class CloudWebInbound(CloudWebBase):
    async def test_user_message_goes_to_every_bot_with_mention_flag(self):
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        status, msg = await self.post("@龙娘 帮我看看 git 状态")
        self.assertEqual(status, 200)
        a, b = await self.recv(ju), await self.recv(ln)
        for m in (a, b):
            self.assertEqual((m["type"], m["chat_id"], m["chat_type"], m["user_id"], m["user_name"], m["reply_ctx"]),
                             ("message", "room-1", "group", "user", "用户", "room-1"))
            self.assertEqual(m["msg_id"], f"hub-{msg['id']}")
            self.assertFalse(m.get("from_bot"))
            self.assertNotIn("session_key", m)   # 会话键交给 cc-connect 按 share_session_in_channel 拼
        # 龙娘：被 @，自己的 @ 去掉（同 Discord）
        self.assertTrue(b["mentioned"])
        self.assertEqual(b["content"], "帮我看看 git 状态")
        # 橘：没被 @；@ 别人写成 <@id>，gate 的「@了别人」规则（~/im-bridge/gate/gate.py decide）照常生效
        self.assertFalse(a["mentioned"])
        self.assertEqual(a["content"], f"<@{LN_ID}> 帮我看看 git 状态")
        self.assertEqual(self.rows()[-1]["text"], "@龙娘 帮我看看 git 状态")   # 频道里存的是人写的原文

    async def test_mention_by_id_and_by_discord_form(self):
        ju = await self.registered("maomao", "橘", JU_ID)
        await self.post("@maomao 在吗")
        self.assertTrue((await self.recv(ju))["mentioned"])
        await self.post(f"<@{JU_ID}> 在吗")
        m = await self.recv(ju)
        self.assertTrue(m["mentioned"])
        self.assertEqual(m["content"], "在吗")

    async def test_self_mention_kept_as_marker_when_others_mentioned(self):
        """同 Discord markSelfMention：同时 @ 了别人时，自己的 @ 改成「@名字(你)」，看得出是一起叫的。"""
        ju = await self.registered("maomao", "橘", JU_ID)
        await self.registered("longniang", "龙娘", LN_ID)
        await self.post("@橘 @龙娘 你们看看")
        m = await self.recv(ju)
        self.assertTrue(m["mentioned"])
        self.assertEqual(m["content"], f"@橘(你) <@{LN_ID}> 你们看看")

    async def test_room_is_chat_id(self):
        ju = await self.registered("maomao", "橘")
        rid = self.hub.db.execute("INSERT INTO rooms(name, created_at) VALUES('二号', 0)").lastrowid
        self.hub.db.commit()
        await self.post("@橘 这边", room=rid)
        m = await self.recv(ju)
        self.assertEqual((m["chat_id"], m["reply_ctx"]), (f"room-{rid}", f"room-{rid}"))   # = hub.session_key(rid)

    async def test_system_messages_not_forwarded(self):
        ju = await self.registered("maomao", "橘")
        await self.post("话题结束", author_kind="system")
        await self.nothing(ju)


class CloudWebOutbound(CloudWebBase):
    async def test_reply_lands_in_room_and_reaches_teammates_as_bot(self):
        web = await self.web_client()
        await self.recv(web)
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "session_key": "cloud_web:1", "reply_ctx": "1",
                            "content": "看了，干净", "format": "text"})
        ev = await self.recv(web)
        while ev["type"] == "bots":   # bot 连上时网页先收到成员栏更新（tests/test_cloudweb_botux.py Members）
            ev = await self.recv(web)
        m = ev["message"]
        self.assertEqual((m["author_kind"], m["author"], m["name"], m["text"], m["status"]),
                         ("role", "maomao", "橘", "看了，干净", "done"))
        r = await self.recv(ln)
        self.assertEqual((r["from_bot"], r["mentioned"], r["user_id"], r["user_name"], r["content"]),
                         (True, False, "maomao", "橘", "【橘】看了，干净"))
        await self.nothing(ju)   # 自己说的不回给自己

    async def test_bot_hands_off_with_discord_style_mention(self):
        """bot 人设里写的是「<@id> 就会 @ 到她」：hub 认这个写法，接力照 Discord 走。"""
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": f"<@{LN_ID}> 你来写"})
        r = await self.recv(ln)
        self.assertTrue(r["mentioned"])
        self.assertTrue(r["from_bot"])
        self.assertEqual(r["content"], "【橘】你来写")
        self.assertEqual(self.rows(author="maomao")[-1]["text"], "@龙娘 你来写")   # 网页上显示名字，不显示数字 ID

    async def test_notices_not_relayed(self):
        """同 Discord isBotNotice：「↪ 已插入」这类状态提示进频道，但不转给队友。"""
        ju = await self.registered("maomao", "橘")
        ln = await self.registered("longniang", "龙娘")
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "↪ 已插入"})
        await wait_for(lambda: self.rows(author="maomao"), what="提示进频道")
        await self.nothing(ln)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "❌ 出错了"})   # 报错要转给队长
        self.assertEqual((await self.recv(ln))["content"], "【橘】❌ 出错了")

    async def test_long_reply_not_split(self):
        """cc-connect 已按 4000 字分好段，hub 一段存一条（tests/test_cloudweb_botux.py LongReply）。"""
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "字" * (MAX_TEXT_CHARS + 10)})
        await wait_for(lambda: self.rows(author="maomao"), what="长回复进频道")
        self.assertEqual([len(m["text"]) for m in self.rows(author="maomao")], [MAX_TEXT_CHARS + 10])

    async def test_room_from_session_key_when_no_reply_ctx(self):
        ju = await self.registered("maomao", "橘")
        rid = self.hub.db.execute("INSERT INTO rooms(name, created_at) VALUES('二号', 0)").lastrowid
        self.hub.db.commit()
        await ju.send_json({"type": "reply", "session_key": f"cloud_web:{rid}", "content": "这边"})
        await wait_for(lambda: self.hub.history(rid, 0), what="按会话键找到频道")

    async def test_unknown_room_dropped(self):
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "reply", "reply_ctx": "99", "content": "x"})
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "y"})
        await wait_for(lambda: self.rows(author="maomao"), what="正常那条进频道")
        self.assertEqual([m["text"] for m in self.rows(author="maomao")], ["y"])

    async def test_ping_pong_and_reconnect_replaces(self):
        old = await self.registered("maomao", "橘")
        new = await self.registered("maomao", "橘")
        msg = await old.receive(timeout=5)
        self.assertEqual(msg.type, aiohttp.WSMsgType.CLOSE)
        await self.post("@橘 hi")
        self.assertEqual((await self.recv(new))["content"], "hi")


class CloudWebReviewFixes(CloudWebBase):
    """代码审查（2026-10-20）指出的和 Discord 不一致处。"""

    async def test_bare_mention_gets_placeholder(self):
        """只 @ 不写字：同 Discord 补一句占位，cc-connect 不会把空正文丢掉。"""
        ju = await self.registered("maomao", "橘", JU_ID)
        await self.post("@橘")
        m = await self.recv(ju)
        self.assertTrue(m["mentioned"])
        self.assertIn("只 @ 了你", m["content"])

    async def test_non_numeric_mention_id_ignored(self):
        """gate 只认 <@数字>，不是数字的 mention_id 不用，免得写出 gate 认不出的 @。"""
        await self.registered("maomao", "橘", "abc")
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await self.post("@橘 你好")
        self.assertEqual((await self.recv(ln))["content"], "@橘 你好")

    async def test_long_reply_relayed_once_whole(self):
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        text = "字" * (MAX_TEXT_CHARS - 3) + f"<@{LN_ID}> 接一下"
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": text})
        r = await self.recv(ln)
        self.assertTrue(r["mentioned"])
        self.assertEqual(r["content"], "【橘】" + "字" * (MAX_TEXT_CHARS - 3) + " 接一下")
        await self.nothing(ln)   # 只转一次
        self.assertEqual(len(self.rows(author="maomao")), 1)   # 频道里也是一条（不再按 2000 字拆）

    async def test_teammate_name_call_counts_as_mention(self):
        """同 Discord nameCalled：队友「行了龙娘，…」算叫她；句中提到不算。"""
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "行了龙娘，你来"})
        self.assertTrue((await self.recv(ln))["mentioned"])
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "龙娘说得对"})
        self.assertFalse((await self.recv(ln))["mentioned"])

    async def test_mention_in_code_fence_ignored(self):
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "日志：\n```\n@龙娘 x\n```"})
        r = await self.recv(ln)
        self.assertFalse(r["mentioned"])
        self.assertIn("@龙娘 x", r["content"])

    async def test_footer_stripped_for_teammates(self):
        """同 Discord cleanBotText：用量尾注只给人看，不转给队友；只剩尾注的不转。"""
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "reply_ctx": "1",
                            "content": "看完了\n\n*claude-haiku · out 1 · ctx 15%\n/tmp/x*"})
        self.assertEqual((await self.recv(ln))["content"], "【橘】看完了")
        self.assertIn("ctx 15%", self.rows(author="maomao")[-1]["text"])   # 频道里照样显示
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "*opus · out 1 · ctx 1%*"})
        await self.nothing(ln)

    async def test_long_bot_id_not_echoed_to_itself(self):
        long_id = "b" * 100
        ws = await self.registered(long_id, "长")
        await ws.send_json({"type": "reply", "reply_ctx": "1", "content": f"@{long_id[:64]} 自己"})
        await wait_for(lambda: self.rows(author=long_id[:64]), what="进频道")
        await self.nothing(ws)

    async def test_bad_field_types_do_not_crash(self):
        ws = await self.http.ws_connect(f"{self.url}/cloud-web/ws", headers=AUTH)
        self.ws_list.append(ws)
        await ws.send_json({"type": "register", "project": 1})
        self.assertFalse((await self.recv(ws))["ok"])
        ju = await self.registered("maomao", "橘")
        await ju.send_json({"type": "reply", "session_key": 5, "reply_ctx": None, "content": "x"})
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "y"})
        await wait_for(lambda: self.rows(author="maomao"), what="正常那条进频道")


class CloudWebShutdown(CloudWebBase):
    async def test_hub_shutdown_closes_bot_connections(self):
        """hub 关服务时要主动断开 bot，否则老进程被 bot 连接拖着不退、bot 也不会去连新 hub（端到端测试里撞到的）。"""
        ju = await self.registered("maomao", "橘")
        await asyncio.wait_for(self.runner.shutdown(), 5)
        msg = await ju.receive(timeout=5)
        self.assertIn(msg.type, (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING))


class CloudWebReReview(CloudWebBase):
    """复审（2026-10-20）指出的三处。"""

    async def test_code_indent_kept(self):
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "@龙娘 看下\n```\ndef f():\n    return 1\n```"})
        self.assertIn("    return 1", (await self.recv(ln))["content"])

    async def test_bot_bare_mention_dropped(self):
        """同 Discord：队友只发一个 @、没有内容，不转（不空开一轮）。"""
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ln.send_json({"type": "reply", "reply_ctx": "1", "content": "@橘"})
        await wait_for(lambda: self.rows(author="longniang"), what="进频道")
        await self.nothing(ju)

    async def test_name_call_short_name(self):
        """同 discord nameCalled：显示名去掉开头英文部分的短名也算（「Claude橘」→「橘」）。"""
        ju = await self.registered("maomao", "Claude橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ln.send_json({"type": "reply", "reply_ctx": "1", "content": "橘，你看"})
        self.assertTrue((await self.recv(ju))["mentioned"])


if __name__ == "__main__":
    unittest.main()
