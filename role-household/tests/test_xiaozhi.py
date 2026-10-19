"""小智板子当角色设备（rh/xiaozhi.py）：真 hub + 真 host + 假小智板子（tools/fake_xiaozhi.py），假合成、假大脑，不出声。

覆盖：OTA 回包、握手、按绑定只给对应角色推音频、未绑定不播、暂停全停、重连不推问候、没连上回落、闭麦不改变播放。
"""
from __future__ import annotations

import asyncio
import shutil
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import wake as wakemod
from rh import xiaozhi as xz
from rh.device import DeviceSpeaker
from rh.host import Host
from rh.meeting import Meeting
from rh.voice import wav_secs
from tests.test_device import ROLES, DeviceBase, FakeLocal, FakeSynth, silent_wav
from tests.test_hub import wait_for
from tests.test_meeting import FakeBrain
from tools.fake_xiaozhi import FakeXiaozhi

DEV_A, DEV_B, DEV_X = "aa:bb:cc:dd:ee:0a", "aa:bb:cc:dd:ee:0b", "aa:bb:cc:dd:ee:ff"   # X 不绑定


def fake_encoder(wav: bytes) -> list[bytes]:
    """一帧 60 毫秒一个假 Opus 包（不调 ffmpeg，单测快）。"""
    return [bytes([i % 256]) * 8 for i in range(max(1, round(wav_secs(wav) / xz.FRAME_SEC)))]


class XiaozhiBase(DeviceBase):
    async def start_host(self, max_turns=3, grace=5.0, local=None, synth_secs=0.3, boards=None, words=True, port=0,
                         encoder=fake_encoder, dial=False):
        brains = {r.id: FakeBrain(r.name) for r in ROLES}
        self.local = local or FakeLocal()
        self.speaker = DeviceSpeaker(FakeSynth(synth_secs), self.local, log=self.log.append, grace=grace)
        self.m = Meeting(ROLES, brains, max_turns, 1e6, tts=self.speaker)
        self.xz = xz.XiaozhiServer({DEV_A: "a", DEV_B: "b"} if boards is None else boards, port=port, host="127.0.0.1",
                                   encoder=encoder, log=self.log.append)
        w = wakemod.Words([(r.id, [r.name]) for r in ROLES]) if words else None
        self.host = Host(self.m, self.url, TOKEN_, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2,
                         speaker=self.speaker, boards=self.xz, words=w, log=self.log.append)
        if dial:   # 板子表盘（rh/dial.py），tests/test_dial.py 用；头像目录用临时目录
            from rh.dial import Dial
            self.host.dial = Dial(self.xz, ROLES, self.dir, log=self.log.append)
        self.task = asyncio.create_task(self.host.run())
        await wait_for(self.host.connected.is_set, what="角色主机连上")
        self.ota = f"http://127.0.0.1:{self.xz.port}{xz.OTA_PATH}"
        self.boards_ = []

    async def board(self, dev, version=1, wait_online=True):
        b = FakeXiaozhi(self.ota, dev, version)
        await b.connect()
        self.boards_.append(b)
        role = self.xz.bindings.get(dev)
        if wait_online and role:
            await wait_for(lambda: self.xz.online(role), what=f"{role} 的板子在线")
        return b

    async def asyncTearDown(self):
        for b in getattr(self, "boards_", []):
            await b.close()
        await super().asyncTearDown()

    def done(self):
        return any(r["author_kind"] == "system" for r in self.rows())


from tests.test_hub import TOKEN as TOKEN_   # noqa: E402
from tests.test_hub import AUTH as AUTH_   # noqa: E402


class OtaAndHandshake(XiaozhiBase):
    async def test_ota_reply(self):
        await self.start_host()
        b = FakeXiaozhi(self.ota, DEV_A, fw="9.9.9")
        r = await b.ota()
        self.boards_.append(b)
        self.assertEqual(r["websocket"]["url"], f"ws://127.0.0.1:{self.xz.port}{xz.WS_PATH}")
        self.assertIn("token", r["websocket"])
        self.assertEqual(r["firmware"]["version"], "9.9.9")   # 回板子自己的版本：不升级
        self.assertNotIn("activation", r)   # 带了会在屏上显示激活码
        self.assertIn("timestamp", r["server_time"])
        async with b.http.get(self.ota.rstrip("/")) as g:   # GET、不带斜杠也通
            self.assertEqual(g.status, 200)

    async def test_handshake(self):
        await self.start_host()
        b = await self.board(DEV_A)
        self.assertEqual(b.hello["type"], "hello")
        self.assertEqual(b.hello["transport"], "websocket")
        self.assertEqual(b.hello["audio_params"]["sample_rate"], xz.SAMPLE_RATE)
        self.assertEqual(b.hello["audio_params"]["frame_duration"], xz.FRAME_MS)
        self.assertTrue(b.hello["session_id"])
        self.assertTrue(self.host.device_online("a"))
        self.assertFalse(self.host.device_online("c"))

    async def test_token_checked_when_set(self):
        await self.start_host()
        self.xz.token = "t0k"
        b = FakeXiaozhi(self.ota, DEV_A)
        r = await b.ota()
        self.assertEqual(r["websocket"]["token"], "t0k")
        await b.connect()
        self.boards_.append(b)
        await wait_for(lambda: self.xz.online("a"), what="带对 token 能连上")
        bad = FakeXiaozhi(self.ota, DEV_B)
        await bad.ota()
        bad.ota_reply["websocket"]["token"] = "wrong"
        with self.assertRaises(Exception):
            await bad.connect()
        await bad.close()


class Playback(XiaozhiBase):
    async def test_pushes_only_to_bound_role_in_turn(self):
        await self.start_host()
        a, bb = await self.board(DEV_A), await self.board(DEV_B, version=3)
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        n = len(fake_encoder(silent_wav(0.3)))
        for dev in (a, bb):
            kinds = [(k, d.get("type"), d.get("state")) if k == "json" else (k,) for _, k, d in dev.got
                     if not (k == "json" and d.get("type") == "mcp")]   # 连上时读音量的 MCP 请求不算播放
            self.assertEqual(kinds[:3], [("json", "tts", "start"), ("json", "llm", None), ("json", "tts", "sentence_start")])
            self.assertEqual(kinds[3:], [("audio",)] * n + [("json", "tts", "stop")])
            self.assertEqual(dev.jsons(type="llm")[0]["emotion"], xz.SPEAK_EMOTION)
            self.assertEqual(dev.audio(), fake_encoder(silent_wav(0.3)))   # v3 协议头去掉后就是原包
        self.assertEqual(self.local.played, ["c"])   # c 没有板子：Mac 喇叭
        # a 的 tts stop（回执 done）之后 b 才开始
        a_stop = [t for t, k, d in a.got if k == "json" and d.get("state") == "stop"][0]
        b_start = [t for t, k, d in bb.got if k == "json" and d.get("state") == "start"][0]
        self.assertGreaterEqual(b_start, a_stop)
        self.assertEqual([r["status"] for r in self.rows(author_kind="role")], ["done"] * 3)
        self.assertEqual(sum("回执 done" in x for x in self.log), 2)

    async def test_paced_not_dumped(self):
        """音频按 60 毫秒一帧的节奏发：1.2 秒的话，先一口气发 PRE_BUFFER 帧，之后一帧一帧补，
        第一帧到最后一帧隔（20-5）帧的时间；第 PRE_BUFFER+1 帧要等约一帧。"""
        await self.start_host(max_turns=1, synth_secs=1.2)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        ts = [t for t, k, _ in a.got if k == "audio"]
        self.assertEqual(len(ts), 20)
        # 容差 20 毫秒：asyncio 的定时器可能早醒约 1 毫秒、收包时刻也有抖动（原来按理论值卡，5 次挂 2 次）；
        # 取 1/3 帧，远小于“多预发一帧”的差（60 毫秒），差一照样测得出来。
        tol = 0.02
        self.assertGreater(ts[-1] - ts[0], (20 - xz.PRE_BUFFER) * xz.FRAME_SEC - tol)
        self.assertLess(ts[xz.PRE_BUFFER - 1] - ts[0], xz.FRAME_SEC - tol)   # 前 PRE_BUFFER 帧一口气发
        self.assertGreater(ts[xz.PRE_BUFFER] - ts[0], xz.FRAME_SEC - tol)   # 第 PRE_BUFFER+1 帧要等

    async def test_no_opus_fails_back_to_mac(self):
        """一句都编不出 Opus（如 ffmpeg 不可用）：回 failed、started=False，DeviceSpeaker 改用 Mac 喇叭，不会两边都没声。"""
        def broken(wav):
            raise FileNotFoundError("ffmpeg")
        await self.start_host(max_turns=1, encoder=broken)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        self.assertEqual(self.local.played, ["a"])
        self.assertEqual(a.audio(), [])
        self.assertTrue(a.jsons(type="tts", state="stop"))   # 屏上的“在说”收掉
        self.assertTrue(any("没播出来就失败" in s for s in self.log))

    async def test_stuck_cleared_when_board_answers(self):
        """板子偶发一次回执超时（这里用慢编码造出来）：板子对那次的 stop 有回执，说明连接正常，不再一直不用它。"""
        def slow(wav):
            time.sleep(0.6)
            return fake_encoder(wav)
        await self.start_host(max_turns=1, grace=0.05, encoder=slow)
        await self.board(DEV_A)
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        self.assertTrue(any("回执超时" in s for s in self.log))
        self.assertEqual(self.local.played, ["a"])   # 这一次照旧回落 Mac 喇叭
        await wait_for(lambda: "a" not in self.speaker._stuck, what="卡住标记清掉")
        self.assertTrue(any("下一句起照常推给板子" in s for s in self.log))

    async def test_port_taken_host_still_runs(self):
        """小智端口被占：主机照常起来、连 hub，用 Mac 喇叭。"""
        import socket
        busy = socket.socket()
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        self.addCleanup(busy.close)
        await self.start_host(max_turns=1, port=busy.getsockname()[1])
        self.assertIsNone(self.host.boards)
        self.assertTrue(any("小智协议服务起不来" in s for s in self.log))
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        self.assertEqual(self.local.played, ["a"])

    async def test_unbound_board_plays_nothing(self):
        await self.start_host()
        x = await self.board(DEV_X)
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        self.assertEqual(x.got, [])
        self.assertEqual(self.local.played, ["a", "b", "c"])
        self.assertTrue(any("未绑定的板子" in s and DEV_X in s for s in self.log))

    async def test_offline_bound_board_falls_back_to_mac(self):
        await self.start_host()
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        self.assertEqual(self.local.played, ["a", "b", "c"])

    async def test_board_drops_mid_play_hands_off(self):
        await self.start_host(max_turns=2, synth_secs=5.0)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(lambda: a.audio(), what="板子收到音频")
        t0 = time.monotonic()
        await a.close()
        await wait_for(lambda: any("回执 lost" in s for s in self.log), what="回执 lost")
        self.assertLess(time.monotonic() - t0, 2.0)

    async def test_pause_stops_board(self):
        await self.start_host(max_turns=3, synth_secs=5.0)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(lambda: a.audio(), what="板子收到音频")
        t0 = time.monotonic()
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, "暂停")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子收到 tts stop")
        self.assertLess(time.monotonic() - t0, 1.0)
        n = len(a.audio())
        await asyncio.sleep(0.5)
        self.assertEqual(len(a.audio()), n)   # 停了就不再发
        self.assertEqual(self.local.played, [])   # 后面的角色也不接着说
        self.assertEqual(self.rows(author_kind="role")[0]["status"], "interrupted")

    async def test_mute_does_not_block_board_playback(self):
        """闭麦只管不听用户：网页打字的话题照样从板子播出来（不是“闭麦不播”）。"""
        await self.start_host(max_turns=1)
        a = await self.board(DEV_A)
        self.host.mic_on = False
        await self.post("话题")
        await wait_for(self.done, what="讨论结束")
        self.assertTrue(a.audio())
        self.assertTrue(a.jsons(type="tts", state="stop"))


class Volume(XiaozhiBase):
    """板子音量：用户 2026-10-19「声音太小了，预期可以我通过语音让它调大，或者说我在这个网页端可以调大」。
    主机经 MCP 调固件的 self.audio_speaker.set_volume（假板子照固件回包）。"""

    async def web_volumes(self, ws, want):
        while True:
            d = await self.recv(ws)
            if d.get("type") == "volumes" and d["volumes"] == want:
                return

    async def test_reads_volume_on_connect_and_shows_on_web(self):
        await self.start_host()
        a = await self.board(DEV_A)
        await wait_for(lambda: self.hub.volumes == {"a": 70}, what="hub 知道 a 的板子音量 70")
        self.assertEqual(a.mcp_calls("self.get_device_status"), [{"name": "self.get_device_status", "arguments": {}}])
        self.assertEqual(a.mcp_calls("self.audio_speaker.set_volume"), [])   # 连上只读不写：固件自己记着音量
        w = await self.web_client()
        self.assertEqual((await self.recv(w))["volumes"], {"a": 70})   # ready 帧里带
        await a.close()
        await wait_for(lambda: self.hub.volumes == {}, what="板子断开后 hub 不再显示它的音量")

    async def test_web_slider_sets_board_volume(self):
        await self.start_host()
        a, bb = await self.board(DEV_A), await self.board(DEV_B)
        await wait_for(lambda: self.hub.volumes == {"a": 70, "b": 70}, what="两块板子音量")
        w = await self.web_client(); await self.recv(w)
        async with self.http.post(f"{self.url}/api/volume", json={"role": "a", "volume": 95}, headers=AUTH_) as r:
            self.assertEqual(r.status, 200)
        await self.web_volumes(w, {"a": 95, "b": 70})
        self.assertEqual(a.volume, 95)
        self.assertEqual(a.mcp_calls("self.audio_speaker.set_volume"),
                         [{"name": "self.audio_speaker.set_volume", "arguments": {"volume": 95}}])
        self.assertEqual(bb.mcp_calls("self.audio_speaker.set_volume"), [])   # 只调 a 的
        for bad in ({"role": "a", "volume": 101}, {"role": "a", "volume": "9"}, {"volume": 5}):
            async with self.http.post(f"{self.url}/api/volume", json=bad, headers=AUTH_) as r:
                self.assertEqual(r.status, 400, bad)

    async def voice(self, text):
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, text)

    async def test_voice_louder_all_boards_when_nobody_spoke(self):
        await self.start_host()
        a, bb = await self.board(DEV_A), await self.board(DEV_B)
        await wait_for(lambda: self.hub.volumes == {"a": 70, "b": 70}, what="两块板子音量")
        await self.voice("声音大一点")
        await wait_for(lambda: a.volume == 80 and bb.volume == 80, what="两块都调大 10")
        await self.voice("小声点")
        await wait_for(lambda: a.volume == 70 and bb.volume == 70, what="两块都调小 10")
        await wait_for(lambda: self.hub.volumes == {"a": 70, "b": 70}, what="网页看到调回 70")
        self.assertEqual(self.rows(), [])   # 不进频道

    async def test_voice_named_or_last_speaker(self):
        await self.start_host(max_turns=1)
        a, bb = await self.board(DEV_A), await self.board(DEV_B)
        await wait_for(lambda: self.hub.volumes == {"a": 70, "b": 70}, what="两块板子音量")
        await self.voice("B大声点")                      # 叫了名字：只调她的
        await wait_for(lambda: bb.volume == 80, what="b 调大")
        self.assertEqual(a.volume, 70)
        await self.post("话题")                          # 一轮只有 a 说
        await wait_for(self.done, what="讨论结束")
        await self.voice("大声点")                       # 没叫名字：调最近说话的 a
        await wait_for(lambda: a.volume == 80, what="a 调大")
        self.assertEqual(bb.volume, 80)
        a.volume = 95
        a.got.clear()
        for _ in range(2):                               # 上限 100（固件参数范围）
            await self.voice("大声点")
        await asyncio.sleep(0.3)
        self.assertEqual(a.volume, 100)
        self.assertEqual(self.hub.volumes["a"], 100)
        self.assertFalse(any(r["text"].endswith("大声点") for r in self.rows(author_kind="user")))

    async def test_board_not_answering_mcp_is_harmless(self):
        await self.start_host()
        a = FakeXiaozhi(self.ota, DEV_A)
        a.mcp_answer = False
        await a.connect()
        self.boards_.append(a)
        await wait_for(lambda: self.xz.online("a"), what="a 在线")
        await self.voice("大声点")
        await wait_for(lambda: any("音量读不到" in x for x in self.log), what="读不到音量记日志", timeout=xz.MCP_TIMEOUT * 3)
        self.assertEqual(self.hub.volumes, {})


class Reconnect(XiaozhiBase):
    async def test_reconnect_pushes_no_greeting(self):
        await self.start_host()
        a = await self.board(DEV_A)
        await a.upload_audio(b"\x00" * 40)   # 板子上传的音频丢掉
        await a.ws.send_json({"type": "listen", "state": "detect", "text": "你好小智"})   # 不当成用户说话
        await a.close()
        await wait_for(lambda: not self.xz.online("a"), what="板子断开")
        a2 = await self.board(DEV_A)
        await asyncio.sleep(0.5)
        # 连上、重连只有 hello，没有任何问候、提示音、表情（读音量的 MCP 请求不出声、不改屏，除外）
        no_mcp = lambda dev: [g for g in dev.got if not (g[1] == "json" and g[2].get("type") == "mcp")]
        self.assertEqual(no_mcp(a), [])
        self.assertEqual(no_mcp(a2), [])
        self.assertEqual([c["name"] for c in a2.mcp_calls()], ["self.get_device_status"])
        self.assertEqual([r for r in self.rows() if r["author_kind"] == "user"], [])
        self.assertTrue(any("listen" in s and "不处理" in s for s in self.log))


class ServerUnit(unittest.IsolatedAsyncioTestCase):
    """不经主机，直接给服务发事件。"""

    async def asyncSetUp(self):
        self.receipts, self.started = [], {}

        def rec(p, r, started=None):
            self.receipts.append((p, r))
            self.started[p] = started
        self.srv = xz.XiaozhiServer({DEV_A: "a", DEV_B: "b"}, port=0, host="127.0.0.1", encoder=fake_encoder,
                                    on_receipt=rec, log=lambda s: None)
        await self.srv.start()
        ota = f"http://127.0.0.1:{self.srv.port}{xz.OTA_PATH}"
        self.a, self.b = FakeXiaozhi(ota, DEV_A, version=2), FakeXiaozhi(ota, DEV_B)
        await self.a.connect()
        await self.b.connect()
        await wait_for(lambda: self.srv.online("a") and self.srv.online("b"), what="两块板子在线")

    async def asyncTearDown(self):
        await self.a.close()
        await self.b.close()
        await self.srv.close()

    def play(self, role, pid, secs):
        import base64
        self.srv.send([{"type": "device", "role": role, "play_id": pid, "event": "start", "text": "x"},
                       {"type": "device", "role": role, "play_id": pid, "event": "audio", "index": 0, "last": True,
                        "data": base64.b64encode(silent_wav(secs)).decode()}])

    async def test_stop_all_stops_every_board(self):
        self.play("a", "p1", 5.0)
        self.play("b", "p2", 5.0)
        await wait_for(lambda: self.a.audio() and self.b.audio(), what="两块板子都在播")
        self.srv.stop_all()
        await wait_for(lambda: self.a.jsons(type="tts", state="stop") and self.b.jsons(type="tts", state="stop"),
                       what="两块都收到 tts stop")
        self.assertEqual(sorted(self.receipts), [("p1", "stopped"), ("p2", "stopped")])
        n = len(self.a.audio()) + len(self.b.audio())
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.a.audio()) + len(self.b.audio()), n)

    async def test_v2_header_and_done_receipt(self):
        self.play("a", "p1", 0.3)
        await wait_for(lambda: self.receipts, what="回执")
        self.assertEqual(self.receipts, [("p1", "done")])
        self.assertEqual(self.a.audio(), fake_encoder(silent_wav(0.3)))   # v2 16 字节头去掉后就是原包

    async def test_second_board_same_role_does_not_kick_first(self):
        self.srv.bindings[DEV_X] = "a"
        x = FakeXiaozhi(f"http://127.0.0.1:{self.srv.port}{xz.OTA_PATH}", DEV_X)
        await x.connect()
        await asyncio.sleep(0.1)
        self.assertEqual(self.srv.by_role["a"].device, DEV_A)
        self.assertFalse(self.a.ws.closed)
        self.play("a", "p1", 0.3)
        await wait_for(lambda: self.receipts, what="回执")
        self.assertTrue(self.a.audio())
        self.assertEqual(x.got, [])
        await x.close()

    async def test_no_opus_receipt_failed_not_started(self):
        def broken(wav):
            raise FileNotFoundError("ffmpeg")
        self.srv.encoder = broken
        self.play("a", "p1", 0.3)
        await wait_for(lambda: self.receipts, what="回执")
        self.assertEqual(self.receipts, [("p1", "failed")])
        self.assertIs(self.started["p1"], False)

    async def test_stop_during_start_sends_no_subtitle(self):
        """tts start 发到一半被停：不再补发表情和字幕。"""
        orig = self.srv._send_json

        async def send(b, d):
            await orig(b, d)
            if d.get("state") == "start" and b.play:
                self.srv._stop(b, b.play)   # 发完 tts start 就被停（同 DeviceSpeaker 的 stop 到达）
        self.srv._send_json = send
        self.play("a", "p1", 0.3)
        await wait_for(lambda: self.receipts, what="回执")
        await asyncio.sleep(0.2)
        self.assertEqual(self.receipts, [("p1", "stopped")])
        self.assertEqual([(d.get("type"), d.get("state")) for _, k, d in self.a.got if k == "json" and d.get("type") != "mcp"],
                         [("tts", "start"), ("tts", "stop")])
        self.assertEqual(self.a.audio(), [])

    async def test_heartbeat_closes_half_open(self):
        """板子断电、掉 Wi-Fi（收不到 pong）：心跳把连接关掉，角色下线，回落 Mac 喇叭。"""
        srv = xz.XiaozhiServer({DEV_X: "c"}, port=0, host="127.0.0.1", encoder=fake_encoder, log=lambda s: None,
                               heartbeat=0.2)
        await srv.start()
        self.addAsyncCleanup(srv.close)
        x = FakeXiaozhi(f"http://127.0.0.1:{srv.port}{xz.OTA_PATH}", DEV_X)
        await x.connect(autoping=False)
        self.addAsyncCleanup(x.close)
        await wait_for(lambda: srv.online("c"), what="板子在线")
        t0 = time.monotonic()
        await wait_for(lambda: not srv.online("c"), what="心跳发现断了")
        self.assertLess(time.monotonic() - t0, 2.0)

    async def test_offline_role_gets_no_device(self):
        self.play("c", "p9", 0.3)
        await wait_for(lambda: self.receipts, what="回执")
        self.assertEqual(self.receipts, [("p9", "no_device")])


class Config(unittest.TestCase):
    def test_port_defaults_to_firmware_port(self):
        from tests.test_qwen import load
        self.assertEqual(load("[xiaozhi]").xiaozhi_port, 8791)
        self.assertEqual(load("[xiaozhi]\nport = 9000").xiaozhi_port, 9000)


@unittest.skipUnless(shutil.which(xz.find_ffmpeg()), "没有 ffmpeg")
class RealOpus(unittest.TestCase):
    def test_encode_60ms_frames(self):
        pk = xz.encode_opus(silent_wav(1.2))
        # 1.2 秒 = 20 帧；编码器前面补的 pre-skip 可能多出一帧
        self.assertIn(len(pk), (20, 21))
        self.assertTrue(all(opus_ms(p) == xz.FRAME_MS for p in pk), [opus_ms(p) for p in pk])


def opus_ms(p: bytes) -> float:
    """一个 Opus 包的时长（毫秒）。来源：RFC 6716 第 3.1 节（TOC 字节：高 5 位配置号定帧长，低 2 位定帧数）、第 3.2.5 节（code 3 第二字节低 6 位是帧数）。"""
    cfg, code = p[0] >> 3, p[0] & 3
    if cfg < 12:   # SILK：10/20/40/60
        ms = (10, 20, 40, 60)[cfg % 4]
    elif cfg < 16:   # Hybrid：10/20
        ms = (10, 20)[cfg % 2]
    else:   # CELT：2.5/5/10/20
        ms = (2.5, 5, 10, 20)[cfg % 4]
    n = 1 if code == 0 else 2 if code in (1, 2) else p[1] & 0x3F
    return ms * n


if __name__ == "__main__":
    unittest.main()


def fake_image(version: str, sha: bytes) -> bytes:
    """最小的 ESP-IDF 应用镜像头：24 字节镜像头 + 8 字节段头 + esp_app_desc_t（只填 magic、version、app_elf_sha256）。"""
    import struct
    desc = bytearray(256)
    desc[0:4] = struct.pack("<I", 0xABCD5432)
    desc[16:16 + len(version)] = version.encode()
    desc[144:176] = sha
    return bytes(32) + bytes(desc) + b"rest"


class FirmwareOverWifi(XiaozhiBase):
    async def test_upgrades_once_when_different(self):
        import aiohttp
        fw = self.dir / "xiaozhi.bin"
        fw.write_bytes(fake_image("2.5.2", bytes(range(32))))
        self.assertEqual(xz.app_desc(fw.read_bytes()), ("2.5.2", bytes(range(32)).hex()))
        await self.start_host()
        self.xz.firmware = fw
        a = await self.board(DEV_A)
        await wait_for(lambda: a.upgrades, what="板子收到升级")
        url = a.upgrades[0]
        self.assertTrue(url.endswith(f"{xz.FIRMWARE_PATH}{bytes(range(32)).hex()[:16]}.bin?device={DEV_A}"))
        async with aiohttp.ClientSession() as s:
            async with s.get(url) as r:
                self.assertEqual(await r.read(), fw.read_bytes())
            async with s.get(url.replace(".bin", "0.bin")) as r:
                self.assertEqual(r.status, 404)
        await a.close()
        await wait_for(lambda: not self.xz.online("a"), what="板子断开")
        a2 = await self.board(DEV_A)   # 升级没成（还是旧固件）：同一个文件不再让它升，免得反复重启
        await wait_for(lambda: any("不再重试" in s for s in self.log), what="不再重试")
        self.assertEqual(a2.upgrades, [])

    async def test_same_firmware_no_upgrade(self):
        fw = self.dir / "xiaozhi.bin"
        fw.write_bytes(fake_image("2.5.2", bytes(32)))
        await self.start_host()
        self.xz.firmware = fw
        a = await self.board(DEV_A)
        await wait_for(lambda: any("固件已是" in s for s in self.log), what="固件一致")
        self.assertEqual(a.upgrades, [])

    async def test_asked_survives_host_restart(self):
        # 坏固件回滚后，主机重启也不再让同一块板子升同一个文件：记在 fw_asked_file 里（发成功后才记）
        fw = self.dir / "xiaozhi.bin"
        fw.write_bytes(fake_image("2.5.2", bytes(range(32))))
        await self.start_host()
        self.xz.firmware = fw
        self.xz.fw_asked_file = self.dir / "logs" / "fw-asked.txt"
        a = await self.board(DEV_A)
        await wait_for(lambda: self.xz.fw_asked_file.exists(), what="升级记录写进文件")
        self.assertEqual(len(a.upgrades), 1)
        self.assertEqual(self.xz.fw_asked_file.read_text().split(), [DEV_A, bytes(range(32)).hex()])
        await a.close()
        await wait_for(lambda: not self.xz.online("a"), what="板子断开")
        self.xz._fw_asked = None   # 当主机重启：内存里的记录没了，只剩文件
        a2 = await self.board(DEV_A)
        await wait_for(lambda: any("不再重试" in s for s in self.log), what="不再重试")
        self.assertEqual(a2.upgrades, [])

    async def test_upgrade_waits_until_board_idle(self):
        # 板子正在播时不发升级（升级会关音频通道切断句子），空下来再发
        from unittest import mock
        fw = self.dir / "xiaozhi.bin"
        fw.write_bytes(fake_image("2.5.2", bytes(range(32))))
        await self.start_host()
        a = await self.board(DEV_A)   # 连上时还没设固件：不查
        b = self.xz.by_role["a"]
        b.play = "busy"
        self.xz.firmware = fw
        with mock.patch.object(xz, "FW_IDLE_POLL_SEC", 0.05):
            t = asyncio.ensure_future(self.xz._check_firmware(b, f"http://127.0.0.1:{self.xz.port}"))
            await wait_for(lambda: any("等它空下来" in s for s in self.log), what="等空闲")
            await asyncio.sleep(0.3)
            self.assertEqual(a.upgrades, [])
            b.play = None
            await wait_for(lambda: a.upgrades, what="空下来后收到升级")
            await t

    async def test_download_counts_as_asked_without_mcp_reply(self):
        # 真板子收到升级命令后先关音频通道，MCP 回包到不了：来下载固件就记为升过
        import aiohttp
        fw = self.dir / "xiaozhi.bin"
        sha = bytes(range(32)).hex()
        fw.write_bytes(fake_image("2.5.2", bytes(range(32))))
        await self.start_host()
        self.xz.firmware = fw
        self.xz.fw_asked_file = self.dir / "logs" / "fw-asked.txt"
        async with aiohttp.ClientSession() as s:
            async with s.get(f"http://127.0.0.1:{self.xz.port}{xz.FIRMWARE_PATH}{sha[:16]}.bin?device={DEV_A}") as r:
                self.assertEqual(r.status, 200)
        self.assertEqual(self.xz.fw_asked_file.read_text().split(), [DEV_A, sha])
        self.xz._fw_asked = None   # 当主机重启
        a = await self.board(DEV_A)
        await wait_for(lambda: any("不再重试" in s for s in self.log), what="不再重试")
        self.assertEqual(a.upgrades, [])
