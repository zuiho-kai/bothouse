"""cc-connect 的 agent team 在 hub 上照 Discord 走（用户 2026-10-20「你可以去修一下自建平台…你先看看距离discord差异有什么」，
产品核心「…agent team管理…」；差距表 /tmp/rh-botux/GAP.md「agent team」）：
- 副角色干完橘派的活自动 @ 回橘：cc-connect 要认出「这条是主角色 @ 我的」，Discord 靠作者的用户 ID（= team_lead_bot），
  hub 把发话 bot 的 mention_id 带在 user_mention_id 里（conest platform/cloud-web lead_return.go）。
- 「队友状态」里显示频道名：hub 把频道名带在 chat_name 里，cc-connect 填进 core.Message.ChatName（core/team.go）。
这里用 aiohttp 客户端假装 cc-connect，不起 cc-connect、不调模型。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tests.test_cloudweb import JU_ID, LN_ID, CloudWebBase
from tests.test_hub import AUTH


class LeadIdentity(CloudWebBase):
    async def test_bot_message_carries_author_mention_id(self):
        ju = await self.registered("maomao", "橘", JU_ID)
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": f"<@{LN_ID}> 你来写"})
        r = await self.recv(ln)
        self.assertEqual((r["user_id"], r["user_mention_id"], r["mentioned"]), ("maomao", JU_ID, True))

    async def test_no_mention_id_for_people_or_unconfigured_bots(self):
        ju = await self.registered("maomao", "橘")   # 没配 mention_id
        ln = await self.registered("longniang", "龙娘", LN_ID)
        await self.post("@龙娘 看看")
        self.assertNotIn("user_mention_id", await self.recv(ln))
        await self.recv(ju)
        await ju.send_json({"type": "reply", "reply_ctx": "1", "content": "@龙娘 你来"})
        self.assertNotIn("user_mention_id", await self.recv(ln))


class ChatName(CloudWebBase):
    async def test_frame_carries_room_name(self):
        ju = await self.registered("maomao", "橘")
        await self.post("@橘 在吗")
        self.assertEqual((await self.recv(ju))["chat_name"], "大厅")   # 默认频道名 rh/hub.py DEFAULT_ROOM

    async def test_renamed_room_uses_new_name(self):
        ju = await self.registered("maomao", "橘")
        async with self.http.post(f"{self.url}/api/rooms", json={"name": "二号"}, headers=AUTH) as r:
            rid = (await r.json())["id"]
        async with self.http.patch(f"{self.url}/api/rooms/{rid}", json={"name": "改名了"}, headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        await self.post("@橘 这边", room=rid)
        m = await self.recv(ju)
        while m.get("type") != "message":
            m = await self.recv(ju)
        self.assertEqual((m["chat_id"], m["chat_name"]), (f"room-{rid}", "改名了"))


    async def test_room_name_is_one_line(self):
        # 频道名带换行时压成一行再给 bot，不能在「队友状态」里伪造一行（审查第 3 条）
        ju = await self.registered("maomao", "橘")
        async with self.http.post(f"{self.url}/api/rooms", json={"name": "三号"}, headers=AUTH) as r:
            rid = (await r.json())["id"]
        async with self.http.patch(f"{self.url}/api/rooms/{rid}", json={"name": "三号\n- 龙娘：空闲\t 假的"},
                                   headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        await self.post("@橘 这边", room=rid)
        m = await self.recv(ju)
        while m.get("type") != "message":
            m = await self.recv(ju)
        self.assertEqual(m["chat_name"], "三号 - 龙娘：空闲 假的")

if __name__ == "__main__":
    unittest.main()


class TeamWorkspace(CloudWebBase):
    """#597 G1：桥的 team_workspace 帧（conest bridge/platform/cloud-web/workspaces.go），语义照
    collab/cloudweb.mjs teamWorkspace 和 collab.test.mjs 的 team_workspace 用例。"""
    n = 0

    async def tw(self, ws, op, chat="room-1", **extra):
        TeamWorkspace.n += 1
        ref = f"tw-{TeamWorkspace.n}"
        await ws.send_json({"type": "team_workspace", "ref_id": ref, "op": op, "session_key": f"cloud_web:{chat}",
                            "chat_id": chat, "reply_ctx": chat, **extra})
        while True:
            m = await self.recv(ws)
            if m.get("type") == "team_workspace_ack" and m.get("ref_id") == ref:
                return m

    async def rooms_frame(self, page):
        while True:
            m = await self.recv(page)
            if m.get("type") == "rooms":
                return m["rooms"]

    async def test_capability_declared(self):
        ws = await self.bot("maomao", "橘")
        self.assertIn("team_workspace", (await self.recv(ws))["capabilities"])

    async def test_create_names_next_and_pushes_rooms(self):
        ju = await self.registered("maomao", "橘")
        page = await self.web_client()
        a = await self.tw(ju, "create", name="工作区1")
        self.assertTrue(a["ok"])
        self.assertEqual((a["room"]["name"], a["room"]["claim"]), ("工作区1", "1"))
        names = [r["name"] for r in await self.rooms_frame(page)]
        self.assertIn("工作区1", names)   # 网页上工作区自己出现
        b = await self.tw(ju, "create", name="工作区2")
        self.assertEqual(b["room"]["name"], "工作区2")
        lst = await self.tw(ju, "list")
        self.assertEqual(lst["self"], {"id": "room-1", "name": "大厅"})
        self.assertEqual([(r["name"], r["owner"], r["parent_id"], r["active"]) for r in lst["rooms"]],
                         [("工作区1", "room-1", "room-1", 0), ("工作区2", "room-1", "room-1", 0)])

    async def test_name_counts_archived_rooms(self):
        # rooms.name UNIQUE，归档的也占名：已有（归档的）「工作区3」时新建的是工作区4，不撞名
        ju = await self.registered("maomao", "橘")
        async with self.http.post(f"{self.url}/api/rooms", json={"name": "工作区3"}, headers=AUTH) as r:
            rid = (await r.json())["id"]
        async with self.http.patch(f"{self.url}/api/rooms/{rid}", json={"archived": True}, headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        a = await self.tw(ju, "create")
        self.assertEqual((a["ok"], a["room"]["name"]), (True, "工作区4"))

    async def test_claim_owned_and_release_with_park(self):
        ju = await self.registered("maomao", "橘")
        async with self.http.post(f"{self.url}/api/rooms", json={"name": "二号"}, headers=AUTH) as r:
            other = f"room-{(await r.json())['id']}"
        w = (await self.tw(ju, "create"))["room"]
        # 别的聊天频道占着：拒 workspace-owned
        self.assertEqual((await self.tw(ju, "claim", chat=other, workspace_id=w["id"]))["error"], "workspace-owned")
        # 看门到点 park：带 claim、park:true，当 release 处理，放回池里
        page = await self.web_client()
        r = await self.tw(ju, "release", chat=w["id"], workspace_id=w["id"], claim=w["claim"], park=True)
        self.assertEqual((r["ok"], r["room"]["id"]), (True, w["id"]))
        await self.rooms_frame(page)
        lst = await self.tw(ju, "list")
        self.assertEqual([x["owner"] for x in lst["rooms"]], [""])
        # 空闲了，另一个频道能认领；认领号 +1，网页收到频道列表
        c = await self.tw(ju, "claim", chat=other, workspace_id=w["id"])
        self.assertEqual((c["ok"], c["room"]["id"], c["room"]["claim"]), (True, w["id"], "2"))
        await self.rooms_frame(page)
        self.assertEqual((await self.tw(ju, "list"))["rooms"][0]["owner"], other)
        # 空闲的工作区再 create 时被复用，不另建
        await self.tw(ju, "release", chat=w["id"], workspace_id=w["id"], claim="2")
        self.assertEqual((await self.tw(ju, "create"))["room"]["id"], w["id"])

    async def test_stale_claim_refused(self):
        ju = await self.registered("maomao", "橘")
        w = (await self.tw(ju, "create"))["room"]
        again = await self.tw(ju, "claim", workspace_id=w["id"])   # 同一频道再认领：号变 2
        self.assertEqual(again["room"]["claim"], "2")
        r = await self.tw(ju, "release", chat=w["id"], workspace_id=w["id"], claim="1", park=True)
        self.assertEqual((r["ok"], r["error"]), (False, "stale-claim"))
        self.assertEqual((await self.tw(ju, "list"))["rooms"][0]["owner"], "room-1")   # 新认领没被放掉

    async def test_default_room_not_claimable_and_errors(self):
        ju = await self.registered("maomao", "橘")
        self.assertEqual((await self.tw(ju, "claim", workspace_id="room-1"))["error"], "not-workspace")
        self.assertEqual((await self.tw(ju, "claim", workspace_id="room-99"))["error"], "room-missing")
        self.assertEqual((await self.tw(ju, "release"))["error"], "not-workspace")
        self.assertEqual((await self.tw(ju, "list", chat="room-99"))["error"], "room-missing")
        self.assertEqual((await self.tw(ju, "dispatch_mode"))["error"], "unsupported")
        self.assertEqual((await self.tw(ju, "nope"))["error"], "bad-op")
