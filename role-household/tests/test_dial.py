"""板子表盘（rh/dial.py）：主机告诉板子它是哪个角色、在干什么，给板子按屏幕大小的头像图。

真 hub + 真 host + 假小智板子（tools/fake_xiaozhi.py），假合成、假大脑，不出声。
"""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import threading
import types
import unittest

import aiohttp

from rh import dial as dialmod
from rh.meeting import Message
from rh.xiaozhi import find_ffmpeg
from tests.test_hub import wait_for
from tests.test_xiaozhi import DEV_A, DEV_X, XiaozhiBase

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


class PushRace(unittest.TestCase):
    """meeting 线程和事件循环同时推状态：先算出的旧状态不能后推、后写进 _sent。"""

    def test_stale_state_not_pushed_last(self):
        pushed = []
        server = types.SimpleNamespace(routes=[], on_board=None, _loop=None,
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
            async with s.get(base + "a.rgb565?size=5000") as r:
                self.assertEqual(r.status, 404)
        self.assertEqual(len(px), 240 * 240 * 2)
        v = int.from_bytes(px[240 * 120 * 2 + 240:240 * 120 * 2 + 242], "little")   # 中间一个像素：RGB565 小端
        self.assertGreater(v >> 11, 28)              # 红满
        self.assertLess((v >> 5) & 0x3f, 6)          # 绿、蓝接近 0
        self.assertLess(v & 0x1f, 4)


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
