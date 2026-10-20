"""cc-connect 的 bot 在 hub 上补「频道里你上次看到之后的消息」（同 Discord：conest core/backfill.go，
discord.go ChannelHistory）。bot 掉线、重启期间频道里说的话，下一轮由 cc-connect 用 bot 的 token
读 GET /api/rooms/{room}/messages?before=&limit= 补回来；它自己在会话里写过的回复（reply 带 agent=true）
存成 from_turn=1，补发时跳过，别的同名发言（定时任务输出、状态提示）照常补。
用户原话：「你先看看距离discord差异有什么」「你继续不要停」；差距表 /tmp/rh-botux/GAP.md。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.hub import Hub
from tests import test_cloudweb_botux as botux
from tests.test_hub import AUTH, TOKEN, wait_for

BOT = {"Authorization": "Bearer bot-token"}


class BotReadsHistory(botux.BotToken):
    test_bots_use_their_own_token = None   # 只借它的 bot token 起 hub，它的用例在原文件里跑

    async def test_bot_token_reads_room_page_only(self):
        await self.post("掉线时说的")
        async with self.http.get(self.url + "/api/rooms/1/messages?limit=50", headers=BOT) as r:
            self.assertEqual(r.status, 200)
            self.assertEqual([m["text"] for m in (await r.json())["messages"]], ["掉线时说的"])
        # 只开这一个只读接口：别的接口、往频道里写仍然不认 bot 的 token
        async with self.http.post(self.url + "/api/rooms/1/messages", json={"text": "冒充用户"}, headers=BOT) as r:
            self.assertEqual(r.status, 401)
        async with self.http.get(self.url + "/api/rooms", headers=BOT) as r:
            self.assertEqual(r.status, 401)
        async with self.http.get(self.url + "/api/rooms/1/messages", headers={"Authorization": "Bearer wrong"}) as r:
            self.assertEqual(r.status, 401)

    async def test_agent_reply_stored_as_from_turn(self):
        ju = await self.bot("maomao", "橘", token="bot-token")
        self.assertTrue((await self.recv(ju))["ok"])
        await ju.send_json({"type": "reply", "reply_ctx": "room-1", "content": "会话里写的", "agent": True})
        await ju.send_json({"type": "reply", "reply_ctx": "room-1", "content": "定时任务输出"})
        await wait_for(lambda: len(self.rows(author="maomao")) == 2, what="两条进频道")
        async with self.http.get(self.url + "/api/rooms/1/messages", headers=BOT) as r:
            got = [(m["text"], m["from_turn"]) for m in (await r.json())["messages"]]
        self.assertEqual(got, [("会话里写的", 1), ("定时任务输出", None)])

    async def test_from_turn_not_settable_by_web(self):
        status, msg = await self.post("网页发的", from_turn=1)
        self.assertEqual(status, 200)
        self.assertIsNone(msg["from_turn"])


class Migration(unittest.TestCase):
    def test_old_db_gets_from_turn_column(self):
        import sqlite3, tempfile
        db = Path(tempfile.mkdtemp()) / "hub.sqlite3"
        Hub(db, TOKEN).db.close()
        con = sqlite3.connect(db)
        con.execute("ALTER TABLE messages DROP COLUMN from_turn")   # 做成升级前的库
        con.commit(); con.close()
        hub = Hub(db, TOKEN)
        msg, _ = hub.create(1, {"text": "老库也能用"})
        self.assertIsNone(msg["from_turn"])


if __name__ == "__main__":
    unittest.main()
