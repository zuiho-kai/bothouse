"""多频道：hub 建 / 列 / 改名 / 归档（删除不丢消息）/ 恢复频道；网页左栏切频道、新建；
主机订阅全部频道，每个频道一个会话（一份对话上下文），切频道不串。秒级，假大脑，不调 claude、不出声。"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.config import Role
from rh.host import Host, room_session_dir
from rh.brain import ClaudeBrain
from rh.hub import MIGRATE_ARCHIVED, MIGRATE_AVATAR, MIGRATE_KEY, Hub, add_column, session_key
from rh.meeting import Meeting
from tests.test_hub import AUTH, TOKEN, HubBase, async_playwright, wait_for
from tests.test_fixes import FakeEnv
from tests.test_meeting import FakeBrain

ROLES = [Role("a", "A", "p"), Role("b", "B", "p")]
SHOTS = Path(os.environ.get("RH_SHOTS", ROOT / "shots"))


class RecordingBrain(FakeBrain):
    """记下每次收到的提示：用来查一个频道的角色有没有看到别的频道的话。"""

    def __init__(self, name):
        super().__init__(name)
        self.prompts: list[str] = []

    def reply(self, new_messages):
        self.prompts.append(new_messages)
        return super().reply(new_messages)


class RoomsBase(HubBase):
    async def api(self, method, path, body=None):
        async with self.http.request(method, self.url + path, json=body, headers=AUTH) as r:
            return r.status, (await r.json() if r.content_type == "application/json" else await r.text())

    async def make_room(self, name):
        status, room = await self.api("POST", "/api/rooms", {"name": name})
        self.assertEqual(status, 200, room)
        return room

    async def client(self, room=None, kind="web", since=None, rooms=None):
        ws = await (self.http.ws_connect(self.url + "/ws/host", headers=AUTH) if kind == "host"
                    else self.http.ws_connect(self.url + "/ws"))
        self.ws_list.append(ws)
        hello = {"type": "hello", "token": TOKEN, "kind": kind, "since": since}
        if room is not None:
            hello["room"] = room
        if rooms is not None:
            hello["rooms"] = rooms
        await ws.send_json(hello)
        return ws

    async def next_of(self, ws, kind, timeout=3.0):
        while True:
            ev = await self.recv(ws, timeout)
            if ev["type"] == kind:
                return ev

    async def nothing_of(self, ws, kind, wait=0.3):
        try:
            while True:
                ev = await self.recv(ws, wait)
                self.assertNotEqual(ev["type"], kind, ev)
        except asyncio.TimeoutError:
            pass


class RoomApi(RoomsBase):
    async def test_create_list_rename(self):
        room = await self.make_room("工作")
        self.assertEqual(room["name"], "工作")
        self.assertIsNone(room["archived_at"])
        status, rooms = await self.api("GET", "/api/rooms")
        self.assertEqual(status, 200)
        self.assertEqual([r["name"] for r in rooms], ["大厅", "工作"])
        status, got = await self.api("PATCH", f"/api/rooms/{room['id']}", {"name": "  加班 "})
        self.assertEqual((status, got["name"], got["id"]), (200, "加班", room["id"]))
        self.assertEqual((await self.api("POST", "/api/rooms", {"name": "加班"}))[0], 409)   # 重名
        self.assertEqual((await self.api("PATCH", "/api/rooms/1", {"name": "加班"}))[0], 409)
        for bad in ({}, {"name": ""}, {"name": "   "}, {"name": 3}, {"name": "x" * 65}):
            self.assertEqual((await self.api("POST", "/api/rooms", bad))[0], 400, bad)
        self.assertEqual((await self.api("PATCH", "/api/rooms/99", {"name": "y"}))[0], 404)

    async def test_room_api_needs_token(self):
        for method, path in (("GET", "/api/rooms"), ("POST", "/api/rooms"), ("PATCH", "/api/rooms/1"),
                             ("DELETE", "/api/rooms/1")):
            async with self.http.request(method, self.url + path, json={"name": "x"}) as r:
                self.assertEqual(r.status, 401, path)

    async def test_delete_archives_and_keeps_messages(self):
        room = await self.make_room("工作")
        status, msg = await self.post("留着我", room=room["id"])
        self.assertEqual(status, 200)
        status, got = await self.api("DELETE", f"/api/rooms/{room['id']}")
        self.assertEqual(status, 200)
        self.assertIsNotNone(got["archived_at"])
        self.assertEqual([r["name"] for r in (await self.api("GET", "/api/rooms"))[1]], ["大厅"])
        archived = (await self.api("GET", "/api/rooms?archived=1"))[1]
        self.assertEqual([(r["name"], r["archived_at"] is not None) for r in archived], [("大厅", False), ("工作", True)])
        self.assertEqual([m["text"] for m in self.hub.history(room["id"], None)], ["留着我"])   # 消息还在
        self.assertEqual((await self.post("归档后", room=room["id"]))[0], 409)   # 归档的只读
        # 归档的频道也能打开看历史
        ws = await self.client(room=room["id"])
        ready = await self.next_of(ws, "ready")
        self.assertEqual([m["id"] for m in ready["messages"]], [msg["id"]])
        # 恢复
        status, got = await self.api("PATCH", f"/api/rooms/{room['id']}", {"archived": False})
        self.assertEqual((status, got["archived_at"]), (200, None))
        self.assertEqual((await self.post("又能说了", room=room["id"]))[0], 200)

    async def test_default_room_cannot_be_deleted(self):
        """最早的频道（大厅）是语音和旧主机的落脚处，不能删；也不会因此一个频道都不剩。"""
        self.assertEqual((await self.api("DELETE", "/api/rooms/1"))[0], 400)
        self.assertEqual((await self.api("PATCH", "/api/rooms/1", {"archived": True}))[0], 400)
        self.assertEqual((await self.api("DELETE", "/api/rooms/99"))[0], 404)

    async def test_room_ids_never_reused(self):
        """频道 id 当会话键：删除只归档，id 不会被新频道再用。"""
        a = await self.make_room("甲")
        await self.api("DELETE", f"/api/rooms/{a['id']}")
        b = await self.make_room("乙")
        self.assertGreater(b["id"], a["id"])
        self.assertEqual(session_key(b["id"]), f"room-{b['id']}")

    async def test_old_db_gets_archive_column(self):
        """云端旧库（rooms 没有 archived_at）：开库时补列，旧频道和消息原样保留。"""
        await self.stop_hub()
        self.db.unlink()
        con = sqlite3.connect(self.db)
        con.executescript("""
CREATE TABLE rooms(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at REAL NOT NULL);
CREATE TABLE members(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, position INTEGER NOT NULL,
  avatar TEXT NOT NULL DEFAULT '');
CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id),
  author_kind TEXT NOT NULL, author TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
  spoken INTEGER, created_at REAL NOT NULL, updated_at REAL NOT NULL, client_key TEXT);
INSERT INTO rooms VALUES(1, '大厅', 1.0);
INSERT INTO members VALUES('ju', '橘', 'role', 0, '');
INSERT INTO messages(room_id, author_kind, author, name, text, status, created_at, updated_at)
  VALUES(1, 'user', 'user', '用户', '旧消息', 'user', 1.0, 1.0);
""")
        con.commit()
        con.close()
        await self.start_hub()
        status, rooms = await self.api("GET", "/api/rooms")
        self.assertEqual((status, [(r["id"], r["name"], r["archived_at"]) for r in rooms]), (200, [(1, "大厅", None)]))
        self.assertEqual([m["text"] for m in self.hub.history(1, None)], ["旧消息"])
        self.assertEqual([(m["id"], m["name"]) for m in self.hub.members()], [("ju", "橘")])   # 成员还在
        room = await self.make_room("新频道")
        self.assertEqual(room["id"], 2)


class RoomPush(RoomsBase):
    async def test_ready_has_rooms_and_room_changes_pushed(self):
        ws = await self.client()
        ready = await self.next_of(ws, "ready")
        self.assertEqual([r["name"] for r in ready["rooms"]], ["大厅"])
        room = await self.make_room("工作")
        ev = await self.next_of(ws, "rooms")
        self.assertEqual([r["name"] for r in ev["rooms"]], ["大厅", "工作"])
        await self.api("DELETE", f"/api/rooms/{room['id']}")
        ev = await self.next_of(ws, "rooms")   # 推送带上归档的，网页放进“已归档”
        self.assertEqual([(r["name"], r["archived_at"] is not None) for r in ev["rooms"]], [("大厅", False), ("工作", True)])

    async def test_messages_only_go_to_their_room(self):
        room = await self.make_room("工作")
        a, b = await self.client(), await self.client(room=room["id"])
        self.assertEqual((await self.next_of(a, "ready"))["room"]["id"], 1)
        self.assertEqual((await self.next_of(b, "ready"))["room"]["id"], room["id"])
        await self.post("工作的事", room=room["id"])
        self.assertEqual((await self.next_of(b, "message"))["message"]["text"], "工作的事")
        await self.nothing_of(a, "message")
        await self.post("大厅的事")
        self.assertEqual((await self.next_of(a, "message"))["message"]["text"], "大厅的事")
        await self.nothing_of(b, "message")

    async def test_web_join_switches_room_on_same_connection(self):
        """网页切频道不断线（断线会把开了声音的设备一起断掉）：发 join，收到新频道的 ready。"""
        room = await self.make_room("工作")
        await self.post("工作的事", room=room["id"])
        ws = await self.client()
        await self.next_of(ws, "ready")
        await ws.send_json({"type": "join", "room": room["id"]})
        ready = await self.next_of(ws, "ready")
        self.assertEqual((ready["room"]["name"], [m["text"] for m in ready["messages"]]), ("工作", ["工作的事"]))
        await self.post("大厅的事")
        await self.nothing_of(ws, "message")
        await ws.send_json({"type": "join", "room": 99})   # 不存在的：不动
        await self.post("工作二", room=room["id"])
        self.assertEqual((await self.next_of(ws, "message"))["message"]["text"], "工作二")

    async def test_thinking_is_per_room(self):
        room = await self.make_room("工作")
        host = await self.client(kind="host", rooms="all")
        await self.next_of(host, "ready")
        a, b = await self.client(), await self.client(room=room["id"])
        await self.next_of(a, "ready"); await self.next_of(b, "ready")
        await host.send_json({"type": "thinking", "role": "a", "room": room["id"]})
        ev = await self.next_of(b, "thinking")
        self.assertEqual((ev["role"], ev["room"]), ("a", room["id"]))
        await self.nothing_of(a, "thinking")
        c = await self.client(room=room["id"])
        self.assertEqual((await self.next_of(c, "ready"))["thinking"], "a")
        d = await self.client()
        self.assertIsNone((await self.next_of(d, "ready"))["thinking"])
        await host.send_json({"type": "thinking", "role": "b"})   # 旧主机不带 room：算默认频道
        self.assertEqual((await self.next_of(a, "thinking"))["role"], "b")


class RoomHostSubscription(RoomsBase):
    async def test_host_all_rooms_gets_every_room(self):
        room = await self.make_room("工作")
        _, m1 = await self.post("大厅旧")
        host = await self.client(kind="host", rooms="all", since=0)
        ready = await self.next_of(host, "ready")
        self.assertEqual(ready["room"]["id"], 1)   # 默认频道（语音落在这里）
        self.assertEqual([r["name"] for r in ready["rooms"]], ["大厅", "工作"])
        self.assertEqual([m["text"] for m in ready["messages"]], ["大厅旧"])
        await self.post("工作的事", room=room["id"])
        ev = await self.next_of(host, "message")
        self.assertEqual((ev["message"]["room_id"], ev["message"]["text"]), (room["id"], "工作的事"))
        new = await self.make_room("新建的")   # 订了全部：后建的频道也收到
        await self.next_of(host, "rooms")
        await self.post("新频道的话", room=new["id"])
        self.assertEqual((await self.next_of(host, "message"))["message"]["room_id"], new["id"])

    async def test_host_catch_up_spans_rooms(self):
        room = await self.make_room("工作")
        _, m1 = await self.post("一")
        await self.post("二", room=room["id"])
        await self.post("三")
        host = await self.client(kind="host", rooms="all", since=m1["id"])
        ready = await self.next_of(host, "ready")
        self.assertEqual([(m["room_id"], m["text"]) for m in ready["messages"]], [(room["id"], "二"), (1, "三")])
        self.assertEqual(ready["last_id"], max(m["id"] for m in ready["messages"]))

    async def test_old_host_stays_in_default_room(self):
        """旧主机（hello 不带 rooms）：和以前一样只订默认频道。"""
        room = await self.make_room("工作")
        host = await self.client(kind="host")
        await self.next_of(host, "ready")
        await self.post("工作的事", room=room["id"])
        await self.nothing_of(host, "message")

    async def test_host_disconnect_interrupts_speaking_in_all_rooms(self):
        room = await self.make_room("工作")
        host = await self.client(kind="host", rooms="all")
        await self.next_of(host, "ready")
        _, rm = await self.post("在说", room=room["id"], author_kind="role", author="a", name="A")
        await host.close()
        await wait_for(lambda: self.hub.message(rm["id"])["status"] == "interrupted", what="被打断")


class HostRooms(RoomsBase):
    """主机：每个频道一个会话。默认频道用传进来的 meeting（语音在这里），别的频道按需建。"""

    def make_host(self, factory=True):
        self.brains = {}   # 频道 id -> {角色: RecordingBrain}

        def meeting_for(room_id):
            brains = {r.id: RecordingBrain(r.name) for r in ROLES}
            self.brains[room_id] = brains
            return Meeting(ROLES, brains, 2, 1000.0, sleep_scale=0.01)

        main = Meeting(ROLES, {r.id: RecordingBrain(r.name) for r in ROLES}, 2, 1000.0, sleep_scale=0.01)
        self.main_brains = main.brains
        host = Host(main, self.url, TOKEN, self.dir / "host-state.json", reconnect_min=0.05, reconnect_max=0.2,
                    room_meeting=meeting_for if factory else None)
        return host, main

    async def run_host(self, host):
        task = asyncio.create_task(host.run())
        await wait_for(host.connected.is_set, what="角色主机连上")
        return task

    async def stop(self, host, task):
        host.stop()
        await asyncio.wait_for(task, 5)
        for m in [host.meeting, *host.meetings.values()]:
            await asyncio.get_running_loop().run_in_executor(None, m.wait_idle, 5)

    def topic_done(self, room_id, after=0):
        return lambda: any(r["author_kind"] == "system" and r["id"] > after for r in self.hub.history(room_id, 0))

    async def test_each_room_its_own_context(self):
        room = await self.make_room("工作")
        host, main = self.make_host()
        task = await self.run_host(host)
        await self.post("大厅话题：周末去海边")
        await wait_for(self.topic_done(1), what="大厅讨论结束")
        _, um = await self.post("工作话题：周报怎么写", room=room["id"])
        await wait_for(self.topic_done(room["id"], um["id"]), what="工作频道讨论结束")
        work = [m for m in self.hub.history(room["id"], 0) if m["author_kind"] == "role"]
        self.assertEqual([m["author"] for m in work], ["a", "b"])   # 角色回在工作频道
        hall = [m for m in self.hub.history(1, 0) if m["author_kind"] == "role"]
        self.assertEqual(len(hall), 2)   # 大厅没多出工作频道的发言
        seen_work = "".join(p for b in self.brains[room["id"]].values() for p in b.prompts)
        seen_main = "".join(p for b in self.main_brains.values() for p in b.prompts)
        self.assertIn("周报", seen_work)
        self.assertNotIn("海边", seen_work)    # 工作频道的会话没见过大厅的话
        self.assertNotIn("周报", seen_main)    # 反过来也一样
        self.assertIs(host.meetings[1], main)  # 默认频道用传进来的（有语音的）那个
        await self.stop(host, task)

    async def test_archive_clears_speaking_and_thinking(self):
        room = await self.make_room("工作")
        host = await self.client(kind="host", rooms="all")
        await self.next_of(host, "ready")
        web = await self.client(room=room["id"])
        await self.next_of(web, "ready")
        _, rm = await self.post("在说", room=room["id"], author_kind="role", author="a", name="A")
        await host.send_json({"type": "thinking", "role": "b", "room": room["id"]})
        self.assertEqual((await self.next_of(web, "thinking"))["role"], "b")
        await self.api("DELETE", f"/api/rooms/{room['id']}")
        self.assertEqual(self.hub.message(rm["id"])["status"], "interrupted")
        self.assertIsNone((await self.next_of(web, "thinking"))["role"])
        self.assertNotIn(room["id"], self.hub.thinking)

    async def test_thinking_reports_room(self):
        room = await self.make_room("工作")
        host, _ = self.make_host()
        task = await self.run_host(host)
        b = await self.client(room=room["id"])
        await self.next_of(b, "ready")
        await self.post("工作话题", room=room["id"])
        ev = await self.next_of(b, "thinking")
        self.assertEqual(ev["room"], room["id"])
        await self.stop(host, task)

    async def test_archived_room_meeting_stops(self):
        room = await self.make_room("工作")
        host, _ = self.make_host()
        task = await self.run_host(host)
        await self.post("工作话题", room=room["id"])
        await wait_for(lambda: room["id"] in host.meetings, what="建了工作频道的会话")
        await self.api("DELETE", f"/api/rooms/{room['id']}")
        await wait_for(lambda: room["id"] not in host.meetings, what="归档后停掉会话")
        await self.stop(host, task)

    async def test_host_without_factory_ignores_other_rooms(self):
        """没给建会话的工厂（旧调用方式）：hello 不订别的频道；就算收到别的频道的消息（推送或补漏），
        也不塞进默认频道的会话、不建新会话。"""
        room = await self.make_room("工作")
        host, main = self.make_host(factory=False)
        task = await self.run_host(host)
        self.assertFalse(any(i.get("all") for i in self.hub.subs.values() if i["kind"] == "host"))
        await self.post("大厅话题")
        await wait_for(self.topic_done(1), what="大厅讨论结束")
        base = {"author_kind": "user", "author": "user", "name": "用户", "status": "user"}
        await host._handle_message({**base, "id": 10_000, "room_id": room["id"], "text": "工作话题"})
        await host._handle_ready({"room": {"id": 1}, "rooms": [], "messages": [
            {**base, "id": 10_001, "room_id": room["id"], "text": "补漏的工作话题"}], "last_id": 10_001})
        await asyncio.sleep(0.2)
        seen = "".join(p for b in self.main_brains.values() for p in b.prompts)
        self.assertIn("大厅话题", seen)
        self.assertNotIn("工作话题", seen)
        self.assertEqual(list(host.meetings), [1])
        self.assertEqual([m for m in self.hub.history(room["id"], 0) if m["author_kind"] != "user"], [])
        await self.stop(host, task)

    async def test_reconnect_skips_archived_room(self):
        """主机离线期间某频道有新消息、随后被归档：重连补漏时不给它建会话、不调大脑（会花真钱）。"""
        room = await self.make_room("工作")
        host, _ = self.make_host()
        task = await self.run_host(host)
        await self.stop(host, task)
        await self.post("离线时的工作话题", room=room["id"])
        await self.api("DELETE", f"/api/rooms/{room['id']}")
        host, _ = self.make_host()
        task = await self.run_host(host)
        await self.post("大厅话题")   # 等大厅的讨论走完，补漏一定处理过了
        await wait_for(self.topic_done(1), what="大厅讨论结束")
        self.assertNotIn(room["id"], host.meetings)
        self.assertNotIn(room["id"], self.brains)
        await self.stop(host, task)

    async def test_other_rooms_do_not_touch_dial_or_voice(self):
        """非默认频道纯文字：不推板子表盘，不改“最近说话的人”（语音调音量调的是她的板子）。"""
        room = await self.make_room("工作")
        host, _ = self.make_host()
        calls = []

        class Dial:
            def think(self, role): calls.append(("think", role))
            def event(self, event, msg): calls.append(("event", msg.text))
        host.dial = Dial()
        task = await self.run_host(host)
        _, um = await self.post("工作话题", room=room["id"])
        await wait_for(self.topic_done(room["id"], um["id"]), what="工作频道讨论结束")
        self.assertEqual(calls, [])
        self.assertIsNone(host._last_speaker)
        await self.stop(host, task)

    async def test_disconnect_stops_every_room(self):
        room = await self.make_room("工作")
        host, _ = self.make_host()
        slow = {r.id: FakeBrain(r.name, delay=30) for r in ROLES}
        cancelled = []
        for b in slow.values():
            b.cancel = (lambda orig: lambda: (cancelled.append(1), orig()))(b.cancel)
        host.room_meeting = lambda rid: Meeting(ROLES, slow, 2, 1000.0, sleep_scale=0.01)
        task = await self.run_host(host)
        await self.post("工作话题", room=room["id"])
        await wait_for(lambda: room["id"] in host.meetings and slow["a"].calls == 1, what="工作频道开始想")
        await self.stop_hub()
        await wait_for(lambda: not host.connected.is_set(), what="主机发现断线")
        await wait_for(lambda: cancelled, what="工作频道的会话被停")
        await self.start_hub()
        await self.stop(host, task)

    async def test_hub_db_swapped_drops_old_room_meetings(self):
        """云端库换过（同一个 id 是另一个频道）：旧的频道会话全扔掉，不把旧上下文接到新频道上。"""
        room = await self.make_room("工作")
        host, _ = self.make_host()
        task = await self.run_host(host)
        _, um = await self.post("工作话题", room=room["id"])
        await wait_for(self.topic_done(room["id"], um["id"]), what="工作频道讨论结束")
        old = host.meetings[room["id"]]
        await self.stop_hub()
        self.db.unlink()
        await self.start_hub()
        await asyncio.sleep(0.01)
        new = await self.make_room("另一个")   # 新库里同一个 id
        self.assertEqual(new["id"], room["id"])
        await wait_for(host.connected.is_set, what="主机重连")
        await wait_for(lambda: host.meetings.get(room["id"]) is not old, what="旧会话被扔掉")
        await self.stop(host, task)

    def test_session_dir_per_room(self):
        self.assertEqual(room_session_dir(Path("/r"), 3, "ju"), Path("/r/data/sessions/room-3/ju"))


class SessionPersist(FakeEnv):
    """清单第⑥项：会话 id 存在这个频道自己的会话目录里，主机重启、频道恢复后用 --resume 接着同一个会话。"""

    def argv(self):
        return [json.loads(l) for l in (Path(self.dir) / "argv").read_text().splitlines()]

    def test_restart_resumes_same_session(self):
        a = self.brain()
        self.assertEqual(a.reply("第一句"), "嗯。")
        b = self.brain()   # 同一个会话目录：主机重启 / 频道恢复后新建的大脑
        self.assertEqual(b.session_id, a.session_id)
        self.assertEqual(b.reply("第二句"), "嗯。")
        last = self.argv()[-1]
        self.assertEqual(last[last.index("--resume") + 1], a.session_id)

    def test_rooms_do_not_share_sessions(self):
        a = ClaudeBrain(ROLES[0], ["X"], "haiku", 10, room_session_dir(Path(self.dir), 2, "a"))
        a.reply("hi")
        b = ClaudeBrain(ROLES[0], ["X"], "haiku", 10, room_session_dir(Path(self.dir), 3, "a"))
        self.assertNotEqual(b.session_id, a.session_id)

    def test_failed_first_call_not_saved(self):
        os.environ["FAKE_MODE"] = "exit1_first"
        a = self.brain()
        with self.assertRaises(RuntimeError):
            a.reply("hi")
        self.assertEqual(self.brain().reply("hi"), "嗯。")   # 没存半截的会话 id，新大脑重新开

    def test_lost_session_starts_fresh(self):
        """存着的会话在 claude 那边没了（换机器、清过缓存）：开一个新会话，不一直报错。"""
        a = self.brain()
        a.reply("hi")
        (Path(self.dir) / a.session_id).unlink()   # 假 claude 的会话文件
        b = self.brain()
        self.assertEqual(b.reply("hi"), "嗯。")
        self.assertNotEqual(b.session_id, a.session_id)
        self.assertEqual(self.brain().session_id, b.session_id)   # 新的存下来了


class MigrateRace(unittest.TestCase):
    def test_add_column_twice_is_fine(self):
        """两个进程同时开旧库：都看见没这列、都去补，后补的那个碰到 duplicate column 不能崩。"""
        con = sqlite3.connect(":memory:")
        con.executescript("CREATE TABLE rooms(id INTEGER PRIMARY KEY, name TEXT, created_at REAL);"
                          "CREATE TABLE members(id TEXT PRIMARY KEY);CREATE TABLE messages(id INTEGER PRIMARY KEY);")
        for sql in (MIGRATE_ARCHIVED, MIGRATE_AVATAR, MIGRATE_KEY):
            add_column(con, sql)
            add_column(con, sql)   # 第二次：列已经有了
        with self.assertRaises(sqlite3.OperationalError):
            add_column(con, "ALTER TABLE nosuch ADD COLUMN x TEXT")   # 别的错照常抛


@__import__("unittest").skipIf(async_playwright is None, "没装 playwright")
class RoomsWeb(RoomsBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch(args=["--mute-audio"])
        self.page = await self.browser.new_page(viewport={"width": 1280, "height": 760})
        self.page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def open(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)

    def chan(self, name):
        return self.page.locator("#chlist .ch", has_text=name)

    async def shot(self, name):
        SHOTS.mkdir(parents=True, exist_ok=True)
        await self.page.screenshot(path=str(SHOTS / f"{name}.png"))

    async def texts(self):
        return await self.page.locator("#log .text").all_inner_texts()

    async def test_sidebar_create_switch_rename_archive_restore(self):
        self.hub.set_members([{"id": "a", "name": "A"}, {"id": "b", "name": "B"}])
        await self.post("大厅里的话")
        await self.open()
        self.assertEqual(await self.page.locator("#chlist .ch.on .nm").inner_text(), "大厅")
        # 新建
        await self.page.click("#newroom")
        await self.page.fill("#roomname", "工作")
        await self.page.press("#roomname", "Enter")
        await self.page.wait_for_function("document.getElementById('room').textContent === '工作'", timeout=3000)
        self.assertEqual(await self.page.locator("#chlist .ch.on .nm").inner_text(), "工作")
        self.assertEqual(await self.texts(), [])   # 新频道是空的，没带大厅的话
        await self.page.fill("#in", "工作里的话")
        await self.page.press("#in", "Enter")
        await self.page.wait_for_function("[...document.querySelectorAll('#log .text')].some(e => e.textContent === '工作里的话')",
                                          timeout=3000)
        work = next(r for r in self.hub.rooms(True) if r["name"] == "工作")
        self.assertEqual([m["text"] for m in self.hub.history(work["id"], None)], ["工作里的话"])
        await self.shot("01-new-room")
        # 切回大厅：只看到大厅的话；刷新后记得上次在哪个频道
        await self.chan("大厅").click()
        await self.page.wait_for_function("document.getElementById('room').textContent === '大厅'", timeout=3000)
        self.assertEqual(await self.texts(), ["大厅里的话"])
        await self.chan("工作").click()
        await self.page.wait_for_function("document.getElementById('room').textContent === '工作'", timeout=3000)
        await self.page.reload()
        await self.page.wait_for_function("document.getElementById('room').textContent === '工作'", timeout=5000)
        self.assertEqual(len([i for i in self.hub.subs.values() if i["kind"] == "web"]), 1)
        # 改名
        await self.chan("工作").hover()
        await self.chan("工作").locator(".rename").click()
        await self.page.fill("#chlist .ch input", "周报")
        await self.page.press("#chlist .ch input", "Enter")
        await self.page.wait_for_function("document.getElementById('room').textContent === '周报'", timeout=3000)
        await self.shot("02-renamed")
        # 删除 = 归档：进“已归档”，消息还在，只读
        await self.chan("周报").hover()
        await self.chan("周报").locator(".archive").click()
        await self.page.wait_for_selector("#chlist .ch.archived", timeout=3000)
        await self.page.wait_for_function("document.getElementById('in').disabled", timeout=3000)
        self.assertEqual(await self.texts(), ["工作里的话"])
        self.assertEqual([m["text"] for m in self.hub.history(work["id"], None)], ["工作里的话"])
        await self.shot("03-archived")
        # 恢复
        await self.chan("周报").hover()
        await self.chan("周报").locator(".restore").click()
        await self.page.wait_for_function("!document.getElementById('in').disabled", timeout=3000)
        self.assertEqual(await self.page.locator("#chlist .ch.archived").count(), 0)
        await self.shot("04-restored")

    async def test_other_room_message_does_not_show(self):
        await self.open()
        room = await self.make_room("工作")
        await self.page.wait_for_selector("#chlist .ch >> text=工作", timeout=3000)   # 别的页面建的也出现
        await self.post("别处的话", room=room["id"])
        await self.post("这里的话")
        await self.page.wait_for_function("document.querySelectorAll('#log .text').length === 1", timeout=3000)
        self.assertEqual(await self.texts(), ["这里的话"])

    async def test_room_name_escaped(self):
        bad = '<img src=x onerror="window.pwned=1">'
        await self.make_room(bad)
        await self.open()
        await self.page.wait_for_selector("#chlist .ch >> nth=1", timeout=3000)
        await asyncio.sleep(0.2)
        self.assertIsNone(await self.page.evaluate("window.pwned"))
        self.assertEqual(await self.page.locator("#chlist .ch .nm").nth(1).inner_text(), bad)
        self.assertEqual(await self.page.locator("#chlist img").count(), 0)

    async def test_default_room_has_no_archive_button(self):
        await self.open()
        self.assertEqual(await self.chan("大厅").locator(".archive").count(), 0)


if __name__ == "__main__":
    __import__("unittest").main()


class MainLeavesOtherRoomsToBots(unittest.TestCase):
    """线上主机（rh.host main）不在非默认频道建会话：那边由 cc-connect 经 cloud_web 接进来的 bot 回。
    来源：2026-10-20 现场，room 2「@橘 …」收到两条回复（hub 消息 229 作者 ju = 主机的 claude -p 角色，
    230 作者 maomao = cc-connect 的橘），同一个角色回了两遍。默认频道（大厅，语音和板子）不变。"""

    def test_main_builds_host_without_room_factory(self):
        import tempfile
        from unittest import mock
        import rh.host as hostmod

        class Built(Exception):
            pass

        got = {}

        def fake_host(*a, **kw):
            got.update(kw)
            raise Built

        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(hostmod, "Host", fake_host), \
                mock.patch.object(hostmod, "build", lambda *a, **k: object()), \
                mock.patch.dict(os.environ, {"RH_HUB_URL": "http://127.0.0.1:9", "RH_HUB_TOKEN": "t"}), \
                mock.patch.object(sys, "argv", ["rh.host", "--no-voice", "--config", str(ROOT / "roles.example.toml"),
                                                "--state", f"{d}/s.json", "--log", f"{d}/speech.jsonl"]):
            with self.assertRaises(Built):
                hostmod.main()
        self.assertIn("room_meeting", got)   # 确实走到了建 Host 这一步
        self.assertIsNone(got["room_meeting"])
