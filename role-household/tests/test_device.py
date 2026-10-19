"""设备播放：推给该角色的设备、等回执交棒；打断发 stop；设备不在线回退本机；回执超时兜底。秒级，假合成、假大脑。"""
from __future__ import annotations

import asyncio
import aiohttp
import base64
import io
import json
import sys
import threading
import time
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh.config import Role
from rh.device import DeviceSpeaker, sentences
from rh.host import Host
from rh.meeting import Meeting
from tests.test_hub import HubBase, TOKEN, wait_for
from tests.test_meeting import FakeBrain

try:
    from playwright.async_api import async_playwright
except ImportError:  # 运行时不依赖 playwright
    async_playwright = None

RATE = 16000


def silent_wav(secs: float) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(int(secs * RATE) * 2))
    return buf.getvalue()


class FakeSynth:
    """每句合成成固定秒数的静音 WAV。"""

    def __init__(self, secs: float = 0.05):
        self.secs, self.calls = secs, []

    def synth(self, text, voice):
        self.calls.append((text, voice))
        return silent_wav(self.secs)


class FakeLocal:
    """本机设备（Mac 喇叭）的替身：记下谁在本机播了。"""

    def __init__(self, secs: float = 0.0):
        self.secs, self.played = secs, []

    def speak(self, text, voice, cancel, role=""):
        self.played.append(role)
        return not cancel.wait(self.secs)


class FakeLink:
    """主机连 hub 的替身：on_frames 决定设备怎么回执。"""

    def __init__(self, online=True, on_frames=None):
        self.online, self.frames, self.on_frames = online, [], on_frames

    def device_online(self, role):
        return self.online

    def send_device(self, frames):
        self.frames += frames
        if self.on_frames:
            self.on_frames(frames)
        return True

    def events(self):
        return [f["event"] for f in self.frames]


def speaker_with(link, local=None, grace=5.0, synth=None):
    sp = DeviceSpeaker(synth or FakeSynth(), local, log=lambda s: None, grace=grace)
    sp.link = link
    return sp


def receipt_later(sp, result, delay):
    """最后一块音频送到后 delay 秒回执（模拟设备播完）。"""
    def on_frames(frames):
        for f in frames:
            if f["event"] == "audio" and f["last"]:
                threading.Timer(delay, sp.on_receipt, (f["play_id"], result)).start()
    return on_frames


class SpeakerUnit(unittest.TestCase):
    def test_sentences(self):
        self.assertEqual(sentences("你好。今天去海边吗？好！"), ["你好。", "今天去海边吗？", "好！"])
        self.assertEqual(sentences("没有标点"), ["没有标点"])

    def test_waits_for_receipt_then_hands_off(self):
        link = FakeLink()
        sp = speaker_with(link)
        link.on_frames = receipt_later(sp, "done", 0.3)
        t0 = time.monotonic()
        self.assertTrue(sp.speak("第一句。第二句。", "v", threading.Event(), role="a"))
        self.assertGreaterEqual(time.monotonic() - t0, 0.29)   # 回执来之前不交棒
        self.assertEqual(link.events(), ["start", "audio", "audio"])
        audio = [f for f in link.frames if f["event"] == "audio"]
        self.assertEqual([(f["index"], f["last"]) for f in audio], [(0, False), (1, True)])
        with wave.open(io.BytesIO(base64.b64decode(audio[0]["data"]))) as w:   # 每块是独立可播的 WAV
            self.assertEqual(w.getframerate(), RATE)

    def test_interrupt_sends_stop(self):
        link = FakeLink()
        sp = speaker_with(link)
        cancel = threading.Event()
        threading.Timer(0.1, cancel.set).start()
        t0 = time.monotonic()
        self.assertFalse(sp.speak("说很久。", "v", cancel, role="a"))
        self.assertLess(time.monotonic() - t0, 1.0)
        self.assertEqual(link.events(), ["start", "audio", "stop"])

    def test_offline_falls_back_to_local(self):
        link, local = FakeLink(online=False), FakeLocal()
        sp = speaker_with(link, local)
        self.assertTrue(sp.speak("你好。", "v", threading.Event(), role="a"))
        self.assertEqual((link.frames, local.played), ([], ["a"]))

    def test_no_device_receipt_falls_back_to_local(self):
        """hub 说这个角色刚好没设备（页面刚关）：改在本机播。"""
        link, local = FakeLink(), FakeLocal()
        sp = speaker_with(link, local)
        link.on_frames = lambda fs: [sp.on_receipt(f["play_id"], "no_device") for f in fs if f["event"] == "start"]
        self.assertTrue(sp.speak("你好。", "v", threading.Event(), role="a"))
        self.assertEqual(local.played, ["a"])

    def test_receipt_timeout_hands_off(self):
        link = FakeLink()   # 设备永远不回执
        sp = speaker_with(link, grace=0.2, synth=FakeSynth(0.1))
        t0 = time.monotonic()
        self.assertTrue(sp.speak("你好。", "v", threading.Event(), role="a"))
        dt = time.monotonic() - t0
        self.assertGreaterEqual(dt, 0.29)   # 音频 0.1 + 余量 0.2
        self.assertLess(dt, 1.0)
        self.assertEqual(link.events(), ["start", "audio", "stop"])   # 超时也给设备发 stop

    def test_receipt_timeout_falls_back_to_local_and_skips_stuck_device(self):
        """设备收了音频却不播也不回执（2026-10-19 Mac 上没声音）：改用本机喇叭；之后直接本机，设备名单变了再试设备。"""
        link, local = FakeLink(), FakeLocal()
        sp = speaker_with(link, local, grace=0.1, synth=FakeSynth(0.05))
        self.assertTrue(sp.speak("你好。", "v", threading.Event(), role="a"))
        self.assertEqual(local.played, ["a"])
        n = len(link.frames)
        t0 = time.monotonic()
        self.assertTrue(sp.speak("再说一句。", "v", threading.Event(), role="a"))
        self.assertLess(time.monotonic() - t0, 0.1)   # 不再空等超时
        self.assertEqual((len(link.frames), local.played), (n, ["a", "a"]))
        sp.devices_changed()
        link.on_frames = receipt_later(sp, "done", 0.0)
        self.assertTrue(sp.speak("第三句。", "v", threading.Event(), role="a"))
        self.assertEqual(local.played, ["a", "a"])   # 设备好了就回到设备

    def test_device_stopped_or_lost_still_hands_off(self):
        for result in ("stopped", "failed", "lost"):
            link = FakeLink()
            sp = speaker_with(link)
            link.on_frames = receipt_later(sp, result, 0.0)
            self.assertTrue(sp.speak("你好。", "v", threading.Event(), role="a"), result)


ROLES = [Role("a", "A", "p", voice="va"), Role("b", "B", "p", voice="vb"), Role("c", "C", "p", voice="vc")]


class DeviceBase(HubBase):
    """真 hub + 真 host；DeviceThroughHub 用假设备页面（WebSocket 客户端），WebPageAsDevice 用真网页。"""

    async def start_host(self, max_turns=3, grace=5.0, local=None, synth_secs=0.05):
        brains = {r.id: FakeBrain(r.name) for r in ROLES}
        self.local = local or FakeLocal()
        self.speaker = DeviceSpeaker(FakeSynth(synth_secs), self.local, log=self.log.append, grace=grace)
        self.m = Meeting(ROLES, brains, max_turns, 1e6, tts=self.speaker)
        self.host = Host(self.m, self.url, TOKEN, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2,
                         speaker=self.speaker)
        self.task = asyncio.create_task(self.host.run())
        await wait_for(self.host.connected.is_set, what="角色主机连上")

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.log = []
        self.task = None

    async def asyncTearDown(self):
        if self.task:
            self.host.stop()
            await asyncio.wait_for(self.task, 5)
            await asyncio.get_running_loop().run_in_executor(None, self.m.wait_idle, 5)
        await super().asyncTearDown()

    async def device(self, roles, play_secs=0.2, reply=True):
        """假设备：登记角色；收到最后一块音频后 play_secs 秒回执 done（reply=False 不回执）。"""
        ws = await self.web_client()
        await self.recv(ws)
        await ws.send_json({"type": "device_hello", "roles": roles})
        got = []

        async def finish(d):
            await asyncio.sleep(play_secs)
            if not any(e == "stop" and p == d["play_id"] for _, e, _, p in got) and not ws.closed:
                got.append((time.monotonic(), "receipt", d["role"], d["play_id"]))
                await ws.send_json({"type": "receipt", "play_id": d["play_id"], "result": "done"})

        async def loop():
            async for frame in ws:
                d = json.loads(frame.data)
                if d.get("type") != "device":
                    continue
                got.append((time.monotonic(), d["event"], d["role"], d["play_id"]))
                if reply and d["event"] == "audio" and d["last"]:
                    asyncio.create_task(finish(d))   # “播放”时照样收帧，stop 能马上到
                elif d["event"] == "stop":
                    await ws.send_json({"type": "receipt", "play_id": d["play_id"], "result": "stopped"})

        self.ws_tasks = getattr(self, "ws_tasks", []) + [asyncio.create_task(loop())]
        await wait_for(lambda: set(roles) <= self.host.device_roles, what="主机看到设备在线")
        return ws, got


class DeviceThroughHub(DeviceBase):

    async def test_handoff_on_receipt_in_order(self):
        await self.start_host()
        _, got = await self.device(["a", "b", "c"])
        await self.post("话题")
        await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), what="讨论结束")
        starts = [(t, r) for t, e, r, _ in got if e == "start"]
        receipts = [(t, r) for t, e, r, _ in got if e == "receipt"]
        self.assertEqual([r for _, r in starts], ["a", "b", "c"])
        self.assertEqual([r for _, r in receipts], ["a", "b", "c"])
        for (rt, _), (st, _) in zip(receipts, starts[1:]):   # 上一个回执之后，下一个才开始
            self.assertGreaterEqual(st, rt)
        self.assertEqual([r["status"] for r in self.rows(author_kind="role")], ["done"] * 3)
        self.assertEqual(self.local.played, [])   # 有设备就不在本机播
        self.assertEqual(sum("回执 done" in x for x in self.log), 3)

    async def test_user_interrupt_sends_stop_to_device(self):
        await self.start_host(max_turns=1)
        _, got = await self.device(["a", "b", "c"], play_secs=5.0)
        await self.post("话题")
        await wait_for(lambda: any(e == "audio" for _, e, _, _ in got), what="设备收到音频")
        t0 = time.monotonic()
        await self.post("等一下")
        await wait_for(lambda: any(e == "stop" for _, e, _, _ in got), what="设备收到 stop")
        self.assertLess(time.monotonic() - t0, 1.0)
        first = self.rows(author_kind="role")[0]
        self.assertEqual(first["status"], "interrupted")

    async def test_no_device_uses_local(self):
        await self.start_host()
        _, got = await self.device(["a"])   # 只有 a 有设备
        await self.post("话题")
        await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), what="讨论结束")
        self.assertEqual([r for _, e, r, _ in got if e == "start"], ["a"])
        self.assertEqual(self.local.played, ["b", "c"])

    async def test_device_closed_mid_play_hands_off(self):
        """设备播到一半页面关了：hub 回执 lost，主机马上交棒（下一个角色没设备，在本机播）。"""
        await self.start_host(max_turns=2)
        ws, got = await self.device(["a"], play_secs=30.0)
        await self.post("话题")
        await wait_for(lambda: any(e == "audio" for _, e, _, _ in got), what="设备收到音频")
        t0 = time.monotonic()
        await ws.close()
        await wait_for(lambda: self.local.played == ["b"], what="b 在本机播")
        self.assertLess(time.monotonic() - t0, 2.0)
        self.assertTrue(any("回执 lost" in x for x in self.log))

    async def test_receipt_timeout_hands_off(self):
        await self.start_host(max_turns=2, grace=0.3)
        _, got = await self.device(["a", "b"], reply=False)
        t0 = time.monotonic()
        await self.post("话题")
        await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), what="讨论结束")
        self.assertEqual([e for _, e, r, _ in got if r == "a"], ["start", "audio", "stop"])
        self.assertEqual([r["status"] for r in self.rows(author_kind="role")], ["done", "done"])
        self.assertLess(time.monotonic() - t0, 3.0)
        # a 超时后改本机；b 同样超时改本机（各自第一次才等）
        self.assertEqual(self.local.played, ["a", "b"])
        self.assertEqual(sum("回执超时" in x for x in self.log), 2)

    async def test_receipt_from_other_page_ignored(self):
        """同一角色两个页面都开了声音：只发给先开的；后开的页面回执不算数。"""
        await self.start_host(max_turns=1)
        _, got1 = await self.device(["a", "b", "c"], play_secs=0.5)
        ws2, got2 = await self.device(["a", "b", "c"], reply=False)
        await self.post("话题")
        await wait_for(lambda: any(e == "audio" for _, e, _, _ in got1), what="先开的页面收到音频")
        pid = next(p for _, e, _, p in got1 if e == "start")
        await ws2.send_json({"type": "receipt", "play_id": pid, "result": "done"})
        await asyncio.sleep(0.2)
        self.assertEqual(self.rows(author_kind="role")[0]["status"], "speaking")   # 假回执没让它交棒
        self.assertEqual(got2, [])
        await wait_for(lambda: self.rows(author_kind="role")[0]["status"] == "done", what="真回执后交棒")


@unittest.skipIf(async_playwright is None, "没装 playwright（uv sync 的 dev 组）")
class WebPageAsDevice(DeviceBase):
    """网页（无头 Chromium）点“开声音”后当三个角色的设备：真的播放音频、播完回执，主机按回执交棒。"""

    async def test_page_plays_and_receipts(self):
        await self.start_host(synth_secs=0.3)
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            page = await b.new_page()
            await page.goto(f"{self.url}/#token={TOKEN}")
            await page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)
            await page.click("#sound")
            await wait_for(lambda: {"a", "b", "c"} <= self.host.device_roles, what="网页登记成设备")
            await self.post("话题")
            await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), timeout=15,
                           what="讨论结束")
            log = await page.evaluate("window.rhAudioLog")
            await b.close()
        evs = [(x["role"], x["ev"]) for x in log if x["ev"] in ("playing", "completed", "receipt:done")]
        for r in ("a", "b", "c"):
            self.assertIn((r, "playing"), evs)
            self.assertIn((r, "receipt:done"), evs)
        order = [x["role"] for x in log if x["ev"] == "receipt:done"]
        self.assertEqual(order, ["a", "b", "c"])
        self.assertEqual(sum("回执 done" in x for x in self.log), 3)

    async def test_dial_page_is_device_for_its_role(self):
        """表盘页 /dial?role=b 轻点开声音后只当 b 的设备：b 的话在表盘里播、回执，表盘这时亮“正在回答”。"""
        await self.start_host(synth_secs=0.3)
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            page = await b.new_page()
            await page.goto(f"{self.url}/dial?role=b#token={TOKEN}")
            await page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)
            await page.click("#dial-b .pill.tap")
            await wait_for(lambda: self.host.device_roles == {"b"}, what="表盘登记成 b 的设备")
            await self.post("话题")
            await page.wait_for_function("document.querySelector('#dial-b').dataset.state === 'speaking'", timeout=10000)
            await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), timeout=15,
                           what="讨论结束")
            log = await page.evaluate("window.rhAudioLog")
            await b.close()
        self.assertEqual([x["ev"] for x in log if x["ev"].startswith("receipt:")], ["receipt:done"])
        self.assertEqual({x["role"] for x in log}, {"b"})

    async def test_dial_plays_even_if_audiocontext_suspended(self):
        """表盘页的 AudioContext 被挂起时照样出声、回执 done（2026-10-19：以前 <audio> 接进 AudioContext，
        挂起后时间不走、没声音、不回执，三个角色每句回执超时）。"""
        await self.start_host(max_turns=1, synth_secs=0.3)
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            page = await b.new_page()
            await page.goto(f"{self.url}/dial?role=a#token={TOKEN}")
            await page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)
            await page.click("#dial-a .pill.tap")
            await wait_for(lambda: self.host.device_roles == {"a"}, what="表盘登记成 a 的设备")
            await page.wait_for_function("actx && actx.state === 'running'", timeout=5000)
            await page.evaluate("actx.suspend()")
            await self.post("话题")
            await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), timeout=15, what="讨论结束")
            log = await page.evaluate("window.rhAudioLog")
            await b.close()
        self.assertEqual([x["ev"] for x in log if x["ev"].startswith("receipt:")], ["receipt:done"])
        self.assertEqual(self.local.played, [])

    async def test_3_audio_unlocked_on_click_and_6_log_capped(self):
        """点“开声音”时就给每个角色建好 Audio 并解锁（iOS 要求在点击里先播一次）；播放记录有上限。"""
        self.hub.set_members([{"id": r.id, "name": r.name} for r in ROLES])
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            page = await b.new_page()
            await page.goto(f"{self.url}/#token={TOKEN}")
            await page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)
            self.assertEqual(await page.evaluate("players.size"), 0)
            await page.click("#sound")
            self.assertEqual(await page.evaluate("[...players.keys()].sort()"), ["a", "b", "c"])
            n = await page.evaluate("() => { for (let i = 0; i < 5000; i++) logAudio({ev: 'x'}); "
                                    "return window.rhAudioLog.length; }")
            await b.close()
        self.assertLessEqual(n, 1000)


# ---------- 代码审查（~/.claude/reviews/role-household-arch-code.md）第 1-7 条回归 ----------
class FailSecondSynth(FakeSynth):
    def synth(self, text, voice):
        self.calls.append((text, voice))
        if len(self.calls) == 2:
            raise RuntimeError("say -o 退出码 1")
        return silent_wav(self.secs)


class SlowSynth(FakeSynth):
    def __init__(self, secs, delay):
        super().__init__(secs)
        self.delay = delay

    def synth(self, text, voice):
        if self.calls:
            time.sleep(self.delay)   # 第一句之后每句合成都比播放慢
        return super().synth(text, voice)


class EmptyForSymbols(FakeSynth):
    """纯符号片段合成出 0 帧（say 对“——”就是这样）。"""

    def synth(self, text, voice):
        self.calls.append((text, voice))
        return silent_wav(0 if not any(ch.isalnum() for ch in text) else self.secs)


class ReviewFixesUnit(unittest.TestCase):
    def test_1_synth_error_after_start_sends_stop(self):
        link = FakeLink()
        sp = speaker_with(link, synth=FailSecondSynth())
        with self.assertRaises(RuntimeError):
            sp.speak("第一句。第二句。", "v", threading.Event(), role="a")
        self.assertEqual(link.events(), ["start", "audio", "stop"])

    def test_4_deadline_accumulates_slow_synthesis(self):
        """每句合成 0.4 秒、播放 0.2 秒：设备真实播完在最后一句送到后 0.2 秒，不能被误判超时。"""
        link = FakeLink()
        sp = speaker_with(link, grace=0.15, synth=SlowSynth(0.2, 0.4))
        link.on_frames = receipt_later(sp, "done", 0.2)
        logs = []
        sp.log = logs.append
        self.assertTrue(sp.speak("一。二。三。", "v", threading.Event(), role="a"))
        self.assertNotIn("stop", link.events())
        self.assertFalse([x for x in logs if "回执超时" in x])

    def test_6_zero_second_sentence_skipped(self):
        link = FakeLink()
        sp = speaker_with(link, synth=EmptyForSymbols())
        link.on_frames = receipt_later(sp, "done", 0.0)
        self.assertTrue(sp.speak("好。——。后面还有话。", "v", threading.Event(), role="a"))
        audio = [f for f in link.frames if f["event"] == "audio"]
        self.assertTrue(all(f.get("duration", 1) > 0 for f in audio if "data" in f))
        self.assertEqual([f["index"] for f in audio], list(range(len(audio))))   # 序号连续
        self.assertTrue(audio[-1]["last"])
        self.assertEqual(sum(f["last"] for f in audio), 1)

    def test_6_trailing_empty_sentence_still_marks_last(self):
        link = FakeLink()
        sp = speaker_with(link, synth=EmptyForSymbols())
        link.on_frames = receipt_later(sp, "done", 0.0)
        self.assertTrue(sp.speak("好。——", "v", threading.Event(), role="a"))
        audio = [f for f in link.frames if f["event"] == "audio"]
        self.assertTrue(audio[-1]["last"])
        self.assertTrue(all(f["duration"] > 0 for f in audio if "data" in f))

    def test_3_failed_before_playing_falls_back_to_local(self):
        """设备一句都没播出来就失败（浏览器拒绝播放）：改用本机喇叭，不静默交棒。"""
        link, local = FakeLink(), FakeLocal()
        sp = speaker_with(link, local)
        def on_frames(frames):
            for f in frames:
                if f["event"] == "audio" and f["last"]:
                    sp.on_receipt(f["play_id"], "failed", started=False)
        link.on_frames = on_frames
        self.assertTrue(sp.speak("你好。", "v", threading.Event(), role="a"))
        self.assertEqual(local.played, ["a"])

    def test_7_bad_avatar_skipped_with_log(self):
        from rh.config import avatar_data_url
        import tempfile
        d = Path(tempfile.mkdtemp())
        (d / "a.gif").write_bytes(b"GIF89a")
        (d / "big.png").write_bytes(b"\x89PNG" + bytes(400_000))
        logs = []
        for name in ("a.gif", "big.png"):
            self.assertEqual(avatar_data_url(Role("x", "X", "p", avatar=name), d, log=logs.append), "")
        self.assertEqual(len(logs), 2)



    def test_8_no_device_seen_without_extra_synthesis(self):
        """hub 回 no_device（设备刚下线）在合成第一句期间到达：合成完就改用本机，不再多合成一句、不发音频。"""
        link, local = FakeLink(), FakeLocal()
        synth = SlowSynth(0.05, 0.2)
        synth.calls.append(("（让第一句也慢）", ""))   # SlowSynth 从第二次调用起才慢
        sp = speaker_with(link, local, synth=synth)
        link.on_frames = lambda fs: [threading.Timer(0.05, sp.on_receipt, (f["play_id"], "no_device")).start()
                                     for f in fs if f["event"] == "start"]
        self.assertTrue(sp.speak("第一句。第二句。第三句。", "v", threading.Event(), role="a"))
        self.assertEqual(len(synth.calls), 2)   # 占位 1 + 只合成了第一句
        self.assertEqual(link.events(), ["start"])
        self.assertEqual(local.played, ["a"])

class ReviewFixesHub(DeviceBase):
    async def test_2_web_socket_small_frame_limit(self):
        """/ws 上（hello 前后）收不到大帧；主机走 /ws/host，要带 token 头才能连。"""
        from rh.hub import MAX_BODY
        ws = await self.http.ws_connect(self.url + "/ws")
        self.ws_list.append(ws)
        await ws.send_str("x" * (MAX_BODY * 4))
        msg = await ws.receive(timeout=5)
        self.assertIn(msg.type, (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING))
        async with self.http.get(self.url + "/ws/host", headers={"Upgrade": "websocket", "Connection": "Upgrade",
                                 "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}) as r:
            self.assertEqual(r.status, 401)

    async def test_2_host_audio_still_flows(self):
        """主机走大上限的路径，一句较长的音频照样推到设备。"""
        await self.start_host(synth_secs=3.0)   # 3 秒 16k 音频约 96KB，base64 约 128KB，远超 /ws 的上限
        _, got = await self.device(["a", "b", "c"], play_secs=0.0)
        await self.post("话题")
        await wait_for(lambda: any(e == "receipt" for _, e, _, _ in got), timeout=10, what="设备回执")

    async def test_7_bad_avatar_still_registers_members(self):
        import tempfile
        d = Path(tempfile.mkdtemp())
        (d / "a.gif").write_bytes(b"GIF89a")
        brains = {r.id: FakeBrain(r.name) for r in ROLES}
        roles = [Role("a", "A", "p", voice="va", avatar="a.gif"), *ROLES[1:]]
        self.m = Meeting(roles, brains, 1, 1e6)
        self.host = Host(self.m, self.url, TOKEN, self.dir / "s.json", reconnect_min=0.05, config_dir=d)
        self.task = asyncio.create_task(self.host.run())
        await wait_for(lambda: len(self.hub.members()) == 3, what="成员表登记")



class HubDeviceQueue(unittest.IsolatedAsyncioTestCase):
    async def test_5_stop_jumps_ahead_of_queued_audio(self):
        """设备网慢、大音频帧还没发完时，stop 排到最前，同一播放没发出去的音频丢掉。"""
        from rh.hub import DeviceOut
        sent, gate = [], asyncio.Event()

        class SlowWS:
            closed = False
            async def send_str(self, data):
                await gate.wait()
                sent.append(json.loads(data)["event"])

        out = DeviceOut(SlowWS())
        for i in range(3):
            out.put(json.dumps({"event": "audio", "play_id": "p", "index": i}), "p", stop=False)
        await asyncio.sleep(0.05)   # 第一块已经在发（卡在慢网上）
        out.put(json.dumps({"event": "stop", "play_id": "p"}), "p", stop=True)
        gate.set()
        await asyncio.sleep(0.1)
        out.close()
        self.assertEqual(sent, ["audio", "stop"])


class HostStopBypass(unittest.IsolatedAsyncioTestCase):
    async def test_5_host_stop_not_behind_audio_batch(self):
        """主机侧：stop 不等前一批音频发完；还没发出的同一播放的帧丢掉。"""
        sent, gate = [], asyncio.Event()

        class SlowWS:
            closed = False
            async def send_json(self, f):
                if f["event"] == "audio":
                    await gate.wait()
                sent.append(f["event"])

        m = Meeting(ROLES, {r.id: FakeBrain(r.name) for r in ROLES}, 1, 1e6)
        host = Host(m, "http://127.0.0.1:1", TOKEN, Path("/tmp/rh-test-state.json"))
        host._ws_lock = asyncio.Lock()
        ws = SlowWS()
        batch = [{"event": "start", "play_id": "p"}, {"event": "audio", "play_id": "p"},
                 {"event": "audio", "play_id": "p"}]
        t = asyncio.create_task(host._send_frames(ws, batch))
        await asyncio.sleep(0.05)
        await asyncio.wait_for(host._send_frames(ws, [{"event": "stop", "play_id": "p"}]), 1)
        gate.set()
        await t
        self.assertEqual(sent, ["start", "stop", "audio"])


class PublicAddressRedacted(unittest.TestCase):
    def test_9_no_public_ip_in_tracked_files(self):
        """仓库要同步到 conest：进 git 的文件里不能有公网 IP（云端 hub 地址写成 <cloud-hub>）。"""
        import re
        import subprocess
        files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
        hits = []
        for name in files:
            if name.endswith((".png", ".jpg", ".jpeg", ".webp")):
                continue
            text = (ROOT / name).read_text(errors="replace")
            for ip in re.findall(r"(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])", text):
                if not ip.startswith("127.") and ip != "0.0.0.0":
                    hits.append((name, ip))
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
