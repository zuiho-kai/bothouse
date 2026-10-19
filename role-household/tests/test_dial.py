"""板子表盘（rh/dial.py）：主机告诉板子它是哪个角色、在干什么，给板子按屏幕大小的头像图。

真 hub + 真 host + 假小智板子（tools/fake_xiaozhi.py），假合成、假大脑，不出声。
"""
from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import subprocess
import threading
import types
import unittest
from datetime import datetime, timezone

import aiohttp

from pathlib import Path

from rh import dial as dialmod
from rh.config import DiscordBot
from rh.meeting import Message
from rh.xiaozhi import find_ffmpeg
from tests.test_hub import wait_for
from tests.test_xiaozhi import DEV_A, DEV_B, DEV_X, XiaozhiBase
from tools.fake_xiaozhi import FakeXiaozhi

FFMPEG = shutil.which(find_ffmpeg())


def states(dev) -> list[str]:
    return [d["state"] for d in dev.jsons(type=dialmod.MSG_TYPE) if "state" in d]


class RoleStatesUnit(unittest.TestCase):
    """规则同网页 rh/static/rh-client.js roleStates()。"""

    def setUp(self):
        self.now = 100.0
        self.st = dialmod.RoleStates(["a", "b"], clock=lambda: self.now)

    def msg(self, author, status="speaking"):
        return Message(1, author, author.upper(), "x", status, 0.0)

    def test_think_speak_idle(self):
        self.assertEqual(self.st.states(), {"a": "idle", "b": "idle"})
        self.st.think("a")
        self.assertEqual(self.st.states(), {"a": "thinking", "b": "idle"})
        self.st.event("start", self.msg("a"))
        self.st.think("b")   # 有人在说时，思考中不显示（网页同样）
        self.assertEqual(self.st.states(), {"a": "speaking", "b": "idle"})
        self.st.event("end", self.msg("a", "done"))
        self.assertEqual(self.st.states(), {"a": "idle", "b": "thinking"})

    def test_interrupted_for_2_5_seconds(self):
        self.st.event("start", self.msg("a"))
        self.st.event("end", self.msg("a", "interrupted"))
        self.assertEqual(self.st.states()["a"], "interrupted")
        self.now += dialmod.INTERRUPTED_SEC + 0.01
        self.assertEqual(self.st.states()["a"], "idle")

    def test_user_and_system_ignored(self):
        self.st.event("start", self.msg("user", "user"))
        self.assertEqual(self.st.states(), {"a": "idle", "b": "idle"})


class BusyAndCanvasUnit(unittest.TestCase):
    """工作状态读 ~/im-bridge/team/<project>.json 的 sessions[].busy；画布边长 = 屏幕短边。"""

    def test_read_busy(self):
        up = "2026-10-20T04:26:46.919766+09:00"   # 实际文件的 updated 格式（~/im-bridge/team/maomao.json）
        now = datetime.fromisoformat(up).timestamp() + 5
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            def w(fname, **kw):
                (d / fname).write_text(json.dumps({"updated": up, **kw}))
            w("p1.json", sessions=[{"busy": False}, {"busy": True}])   # 任一忙就算忙
            w("p2.json", sessions=[{"busy": False}])
            w("p3.json", sessions=[])                                  # 没有会话：空闲
            (d / "p4.json").write_text("{坏")                          # 读不懂：未知，不出现
            w("p5.json", name="x")                                     # 没有 sessions：未知
            w("p7.json", sessions=None)                                # 实际文件没会话时就是 null：空闲
            w("p8.json", sessions="x")                                 # 不是列表：未知
            got = dialmod.read_busy(d, {"p1": "a", "p2": "b", "p3": "c", "p4": "d", "p5": "e", "p6": "f", "p7": "g", "p8": "h"}, now=now)
            self.assertEqual(got, {"a": True, "b": False, "c": False, "g": False})

    def test_read_busy_stale(self):
        """updated 超过 TEAM_STALE_SEC（conest team.go teamStaleAfter 1 分钟）没重写：写的进程没了，未知。"""
        up = "2026-10-20T04:26:46.919766+09:00"
        t0 = datetime.fromisoformat(up).timestamp()
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            (d / "p.json").write_text(json.dumps({"updated": up, "sessions": [{"busy": True}]}))
            (d / "q.json").write_text(json.dumps({"sessions": [{"busy": True}]}))   # 没有 updated：未知
            self.assertEqual(dialmod.read_busy(d, {"p": "a", "q": "b"}, now=t0 + dialmod.TEAM_STALE_SEC), {"a": True})
            self.assertEqual(dialmod.read_busy(d, {"p": "a"}, now=t0 + dialmod.TEAM_STALE_SEC + 1), {})
        # Go 的 RFC 3339：9 位小数、Z、没有小数都认
        t_utc = datetime(2026, 10, 20, tzinfo=timezone.utc).timestamp()
        for v, want in (("2026-10-20T00:00:00.123456789Z", t_utc + 0.123456),
                        ("2026-10-20T09:00:00+09:00", t_utc),
                        ("2026-10-20T00:00:00.5Z", t_utc + 0.5)):
            self.assertAlmostEqual(dialmod._updated_at(v), want, places=5)
        for bad in (None, 5, "", "2026-10-20 00:00:00", "2026-10-20T00:00:00"):   # 没时区也不认
            self.assertIsNone(dialmod._updated_at(bad))

    def test_read_busy_role_with_several_projects(self):
        """一个角色绑几个 project：任一忙就忙；都读得到且空闲才空闲；有未知又没忙的算未知。"""
        up = "2026-10-20T04:26:46+09:00"
        now = datetime.fromisoformat(up).timestamp()
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            for name, busy in (("x1", False), ("x2", True), ("y1", False), ("y2", False), ("z1", False)):
                (d / f"{name}.json").write_text(json.dumps({"updated": up, "sessions": [{"busy": busy}]}))
            projects = {"x1": "x", "x2": "x", "y1": "y", "y2": "y", "z1": "z", "z2": "z", "w1": "w", "w2": "w"}
            (d / "w1.json").write_text(json.dumps({"updated": up, "sessions": [{"busy": True}]}))   # w2 没文件，w1 忙：忙
            self.assertEqual(dialmod.read_busy(d, projects, now=now), {"x": True, "y": False, "w": True})   # z2 没文件：z 未知
            # 先读的忙、后读的闲也还是忙（之前是后读的覆盖前面的）
            self.assertEqual(dialmod.read_busy(d, {"x2": "x", "x1": "x"}, now=now), {"x": True})

    def test_canvas_side(self):
        self.assertEqual(dialmod.canvas_side({"w": 240, "h": 240}), 240)
        self.assertEqual(dialmod.canvas_side({"w": 320, "h": 240}), 240)
        self.assertEqual(dialmod.canvas_side({"w": 240, "h": 320}), 240)
        for bad in (None, {}, {"w": 0, "h": 240}, {"w": "240", "h": 240}, []):
            self.assertIsNone(dialmod.canvas_side(bad))


class PushRace(unittest.TestCase):
    """meeting 线程和事件循环同时推状态：先算出的旧状态不能后推、后写进 _sent。"""

    def test_stale_state_not_pushed_last(self):
        pushed = []
        server = types.SimpleNamespace(routes=[], on_board=None, _loop=None, by_role={},
                                       push=lambda role, m: pushed.append(m["state"]))
        role = types.SimpleNamespace(id="a", name="A", avatar="")
        d = dialmod.Dial(server, [role], ".", log=lambda s: None)
        d._on_board("a", "http://h")
        d.st.think("a")                       # 线程 A 将推 thinking
        real, first = d.st.states, [True]
        b = threading.Thread(target=lambda: (d.st.think(None), d._push_changes()))   # 线程 B：思考结束，推 idle

        def slow_states():
            out = real()
            if first[0]:                      # A 算完旧状态后，让 B 抢在 A 推送之前跑完
                first[0] = False
                b.start()
                b.join(0.3)                   # 修好后 B 卡在锁上，等不完；修之前 B 已推完 idle
            return out
        d.st.states = slow_states
        a = threading.Thread(target=d._push_changes)
        a.start(); a.join(5); b.join(5)
        self.assertEqual(real()["a"], "idle")
        self.assertEqual(pushed[-1], "idle", pushed)   # 板子最后收到的是当前状态
        self.assertEqual(d._sent["a"], "idle")


class DialOnBoard(XiaozhiBase):
    async def test_board_told_who_it_is_on_connect(self):
        await self.start_host(dial=True)
        a = await self.board(DEV_A)
        await wait_for(lambda: a.jsons(type=dialmod.MSG_TYPE), what="板子收到表盘全量")
        m = a.jsons(type=dialmod.MSG_TYPE)[0]
        self.assertEqual((m["role"], m["name"], m["state"], m["live"]), ("a", "A", "idle", True))
        self.assertEqual(m["color"], dialmod.DEFAULT_COLOR)   # 不在网页预设里的角色用网页同一个默认灰
        port = self.xz.port
        self.assertEqual(m["avatar"], f"http://127.0.0.1:{port}{dialmod.IMAGE_PATH}a.rgb565")
        self.assertEqual(m["avatar_think"], m["avatar"])   # 没有单独的思考图：同一个地址，板子只下一张
        # 板子不发问候、提示音、表情、字幕（表盘和读音量的 MCP 除外）
        self.assertEqual([d for _, k, d in a.got if k != "json" or d.get("type") not in ("mcp", dialmod.MSG_TYPE)], [])

    async def test_distinct_thinking_picture_gets_own_url(self):
        d = self.dir / "avatars" / "dial"
        d.mkdir(parents=True)
        (d / "a.jpg").write_bytes(b"base")
        (d / "a-thinking.jpg").write_bytes(b"think")
        (d / "b.jpg").write_bytes(b"same")
        (d / "b-thinking.jpg").write_bytes(b"same")
        await self.start_host(dial=True)
        m = self.host.dial.message("a", "http://h")
        self.assertEqual(m["avatar_think"], f"http://h{dialmod.IMAGE_PATH}a-thinking.rgb565")
        self.assertEqual(self.host.dial.message("b", "http://h")["avatar_think"], f"http://h{dialmod.IMAGE_PATH}b.rgb565")

    async def test_board_frame_stats_logged(self):
        await self.start_host(dial=True)
        a = await self.board(DEV_A)
        await a.ws.send_json({"session_id": "", "type": "mcp", "payload": {
            "jsonrpc": "2.0", "method": "notifications/rh_dial_stats",
            "params": {"state": "idle", "secs": 30.0, "fps": 29.5, "timer_hz": 30.0, "render_ms": 6.1, "heap_internal": 1}}})
        await wait_for(lambda: any("[dial] a 的板子帧率：idle 30.0 秒，29.5 帧/秒" in x for x in self.log), what="帧率日志")

    async def test_unbound_board_gets_no_dial(self):
        await self.start_host(dial=True)
        x = await self.board(DEV_X, wait_online=False)
        await asyncio.sleep(0.3)
        self.assertEqual(x.jsons(type=dialmod.MSG_TYPE), [])

    async def test_states_follow_discussion(self):
        await self.start_host(dial=True)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        await wait_for(lambda: states(a)[-1:] == ["idle"], what="a 回到待机")
        s = states(a)
        self.assertEqual(s[0], "idle")
        i = s.index("thinking")
        self.assertIn("speaking", s[i:])
        self.assertEqual(s[s.index("speaking", i) + 1], "idle")
        self.assertTrue(any("[dial] a 的板子表盘 → speaking" in x for x in self.log))

    async def test_pause_shows_interrupted_then_idle(self):
        await self.start_host(max_turns=3, synth_secs=5.0, dial=True)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(lambda: a.audio(), what="板子收到音频")
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, "暂停")
        await wait_for(lambda: "interrupted" in states(a), what="表盘被打断")
        await wait_for(lambda: states(a)[-1] == "idle", timeout=dialmod.INTERRUPTED_SEC + 2, what="红圈过后回待机")

    def team(self, **projects):
        """临时队友状态目录：project=busy（True/False），None = 删掉文件。"""
        if not hasattr(self, "team_dir"):
            self.team_dir = self.dir / "team"
            self.team_dir.mkdir()
        for proj, busy in projects.items():
            f = self.team_dir / f"{proj}.json"
            if busy is None:
                f.unlink(missing_ok=True)
            else:
                f.write_text(json.dumps({"project": proj, "updated": datetime.now(timezone.utc).isoformat(),
                                         "sessions": [{"key": "k", "busy": busy}]}))
        return self.team_dir

    def busy_msgs(self, dev):
        return [d["conest_status"]["busy"] for d in dev.jsons(type=dialmod.MSG_TYPE) if "conest_status" in d]

    async def test_busy_on_connect_and_on_change(self):
        bots = [DiscordBot("1", "A", "a", "pa"), DiscordBot("2", "B", "b", "pb"), DiscordBot("3", "X", "nobody", "px")]
        await self.start_host(dial={"bots": bots, "team_dir": self.team(pa=True), "busy_poll": None})
        a = await self.board(DEV_A)
        b = await self.board(DEV_B)
        await wait_for(lambda: a.jsons(type=dialmod.MSG_TYPE) and b.jsons(type=dialmod.MSG_TYPE), what="两块板子收到全量")
        self.assertEqual(a.jsons(type=dialmod.MSG_TYPE)[0]["conest_status"], {"busy": True})   # 全量里带上
        self.assertNotIn("conest_status", b.jsons(type=dialmod.MSG_TYPE)[0])   # pb 没文件：不发，板子不显示
        dial = self.host.dial
        self.team(pa=False, pb=True)
        dial.refresh_busy()
        await wait_for(lambda: self.busy_msgs(a) == [True, False] and self.busy_msgs(b) == [True], what="忙闲变化推到板子")
        dial.refresh_busy()   # 没变：不重复推
        self.team(pb=None)    # 文件没了：未知，推 null（板子隐藏工作状态），不推「空闲」
        dial.refresh_busy()
        await wait_for(lambda: self.busy_msgs(b) == [True, None], what="未知推 null")
        dial.refresh_busy()   # 还是未知：不重复推
        await asyncio.sleep(0.2)
        self.assertEqual((self.busy_msgs(a), self.busy_msgs(b)), ([True, False], [True, None]))
        self.assertTrue(any("[dial] b 的板子工作状态 → 未知（隐藏）" in x for x in self.log))
        self.team(pb=True)    # 又读得到：照常推
        dial.refresh_busy()
        await wait_for(lambda: self.busy_msgs(b) == [True, None, True], what="恢复后再推")
        m = [d for d in a.jsons(type=dialmod.MSG_TYPE) if "conest_status" in d][-1]
        self.assertEqual(set(m) - {"session_id"}, {"type", "role", "conest_status"})   # 只推工作状态，不动别的字段（session_id 是推送通道加的）
        self.assertTrue(any("[dial] b 的板子工作状态 → 工作中" in x for x in self.log))

    async def test_busy_polled(self):
        await self.start_host(dial={"bots": [DiscordBot("1", "A", "a", "pa")], "team_dir": self.team(pa=False),
                                    "busy_poll": 0.05})
        a = await self.board(DEV_A)
        await wait_for(lambda: self.busy_msgs(a) == [False], what="全量带空闲")
        self.team(pa=True)
        await wait_for(lambda: self.busy_msgs(a) == [False, True], what="轮询读到变忙")

    async def test_canvas_side_logged(self):
        await self.start_host(dial=True)
        b = FakeXiaozhi(self.ota, DEV_A)
        b.display = {"w": 320, "h": 240, "shape": "rect", "font_min_px": 16, "fonts_px": [16],
                     "asset_formats": ["rgb565raw"], "battery": "none"}
        await b.connect()
        self.boards_.append(b)
        await wait_for(lambda: any("[dial] a 的板子画布边长 240，头像按 240×240 给" in x for x in self.log), what="画布边长日志")
        b2 = FakeXiaozhi(self.ota, DEV_B)
        b2.display = {"w": 1600, "h": 1200, "shape": "rect", "font_min_px": 16, "fonts_px": [16],
                      "asset_formats": ["rgb565raw"], "battery": "none"}
        await b2.connect()
        self.boards_.append(b2)
        await wait_for(lambda: any("[dial] b 的板子画布边长 1200" in x and "头像会要不到" in x for x in self.log),
                       what="超出 MAX_SIZE 的提示")


@unittest.skipUnless(FFMPEG, "没有 ffmpeg")
class DialImage(XiaozhiBase):
    async def test_avatar_sized_rgb565(self):
        d = self.dir / "avatars" / "dial"
        d.mkdir(parents=True)
        # 一张纯红 466×466 的 JPEG 当网页表盘图
        subprocess.run([FFMPEG, "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=466x466", "-frames:v", "1",
                        str(d / "a.jpg")], check=True)
        await self.start_host(dial=True)
        base = f"http://127.0.0.1:{self.xz.port}{dialmod.IMAGE_PATH}"
        async with aiohttp.ClientSession() as s:
            async with s.get(base + "a.rgb565?size=240") as r:
                self.assertEqual(r.status, 200)
                px = await r.read()
            async with s.get(base + "a-thinking.rgb565?size=240") as r:   # 没有思考图：用待机图
                self.assertEqual(r.status, 200)
                self.assertEqual(await r.read(), px)
            async with s.get(base + "b.rgb565?size=240") as r:   # 没有图
                self.assertEqual(r.status, 404)
            for bad in (dialmod.MAX_SIZE + 1, 5000, dialmod.MIN_SIZE - 1):   # 超出范围：400（不是 404）
                async with s.get(base + f"a.rgb565?size={bad}") as r:
                    self.assertEqual(r.status, 400, bad)
            async with s.get(base + f"a.rgb565?size={dialmod.MAX_SIZE}") as r:   # 上限 1024 能给（大于原来的 466）
                self.assertEqual(r.status, 200)
                self.assertEqual(len(await r.read()), dialmod.MAX_SIZE * dialmod.MAX_SIZE * 2)
        self.assertEqual(len(px), 240 * 240 * 2)
        v = int.from_bytes(px[240 * 120 * 2 + 240:240 * 120 * 2 + 242], "little")   # 中间一个像素：RGB565 小端
        self.assertGreater(v >> 11, 28)              # 红满
        self.assertLess((v >> 5) & 0x3f, 6)          # 绿、蓝接近 0
        self.assertLess(v & 0x1f, 4)


    async def test_rect_board_gets_square_canvas_picture(self):
        # 长方屏 320×240：板子按画布边长（短边 240）要图，主机给 240×240 正方图（边带由板子填背景色）
        d = self.dir / "avatars" / "dial"
        d.mkdir(parents=True)
        subprocess.run([FFMPEG, "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=466x466", "-frames:v", "1",
                        str(d / "a.jpg")], check=True)
        await self.start_host(dial=True)
        side = dialmod.canvas_side({"w": 320, "h": 240})
        async with aiohttp.ClientSession() as s:
            async with s.get(f"http://127.0.0.1:{self.xz.port}{dialmod.IMAGE_PATH}a.rgb565?size={side}") as r:
                self.assertEqual(r.status, 200)
                self.assertEqual(len(await r.read()), 240 * 240 * 2)

    async def test_non_square_center_cropped_and_cache_one_size(self):
        d = self.dir / "avatars" / "dial"
        d.mkdir(parents=True)
        # 300×100：左蓝、中红、右绿。居中裁方应全红；拉伸的话左边是蓝的
        subprocess.run([FFMPEG, "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=100x100",
                        "-f", "lavfi", "-i", "color=c=red:s=100x100", "-f", "lavfi", "-i", "color=c=lime:s=100x100",
                        "-filter_complex", "hstack=inputs=3", "-frames:v", "1", "-q:v", "1", str(d / "a.jpg")], check=True)
        await self.start_host(dial=True)
        dial = self.host.dial
        px = dial.pixels(d / "a.jpg", 64)
        for x in (4, 32, 59):                  # 左、中、右（避开 JPEG 色块边缘）
            v = int.from_bytes(px[(32 * 64 + x) * 2:(32 * 64 + x) * 2 + 2], "little")
            self.assertGreater(v >> 11, 26, x)
            self.assertLess(v & 0x1f, 6, x)
        dial.pixels(d / "a.jpg", 32)
        dial.pixels(d / "a.jpg", 48)
        self.assertEqual(len(dial._images), 1)   # 每个文件只留最近一个边长
        self.assertEqual(dial._images[str(d / "a.jpg")][1], 48)


if __name__ == "__main__":
    unittest.main()


class DialPage(XiaozhiBase):
    """网页圆屏（conest device-ui 外部状态输入，conest Issue #90）：/rh/dial/events SSE 和原图。"""

    async def read_events(self, resp, want, timeout=5.0):
        got = []
        async def go():
            async for line in resp.content:
                line = line.decode().strip()
                if line.startswith("data: "):
                    got.append(__import__("json").loads(line[6:]))
                    if want(got):
                        return
        await asyncio.wait_for(go(), timeout)
        return got

    async def test_sse_full_then_changes_with_emotion(self):
        d = self.dir / "avatars" / "dial"
        d.mkdir(parents=True)
        (d / "a.jpg").write_bytes(b"\xff\xd8jpeg-a")
        await self.start_host(dial=True)
        url = f"http://127.0.0.1:{self.xz.port}"
        async with aiohttp.ClientSession() as s:
            async with s.get(url + dialmod.EVENTS_PATH) as r:
                self.assertEqual(r.headers["Content-Type"], "text/event-stream")
                self.assertEqual(r.headers["Access-Control-Allow-Origin"], "*")
                first = await self.read_events(r, lambda g: len(g) >= 3)
                self.assertEqual([m["role"] for m in first], ["a", "b", "c"])
                self.assertEqual(first[0]["state"], "idle")
                self.assertEqual(first[0]["avatar"], f"{url}{dialmod.IMAGE_PATH}a.jpg")
                await self.post("话题")
                got = await self.read_events(r, lambda g: any(m.get("state") == "speaking" for m in g)
                                             and g[-1].get("state") == "idle", timeout=10)
                sp = next(m for m in got if m.get("state") == "speaking")
                self.assertEqual(sp["emotion"], "happy")   # 同板子收到的表情
                self.assertIn("thinking", [m.get("state") for m in got])
            async with s.get(url + dialmod.IMAGE_PATH + "a.jpg") as r:
                self.assertEqual(r.status, 200)
                self.assertEqual(await r.read(), b"\xff\xd8jpeg-a")
            async with s.get(url + dialmod.IMAGE_PATH + "a-thinking.jpg") as r:   # 没有思考图：用待机图
                self.assertEqual(await r.read(), b"\xff\xd8jpeg-a")
            async with s.get(url + dialmod.IMAGE_PATH + "zz.jpg") as r:
                self.assertEqual(r.status, 404)
