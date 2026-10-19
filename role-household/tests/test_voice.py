"""语音输入输出：切句 + 假 ASR 进频道、播放时长交棒、用户打断播放、空文本丢弃。秒级，不录音、不出声、不调 claude。"""
from __future__ import annotations

import array
import asyncio
import sys
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import voice
from rh.config import Role
from rh.meeting import Meeting
from tests.test_hub import HubBase, wait_for, TOKEN
from tests.test_meeting import FakeBrain
from rh.host import Host

SILENT = bytes(voice.FRAME_SAMPLES * 2)
LOUD = array.array("h", [3000, -3000] * (voice.FRAME_SAMPLES // 2)).tobytes()


def frames(ms_pattern: list[tuple[bytes, int]]) -> list[bytes]:
    out = []
    for frame, ms in ms_pattern:
        out += [frame] * (ms // voice.FRAME_MS)
    return out


class FakeASR:
    def __init__(self, text: str):
        self.text, self.calls = text, []

    def transcribe(self, wav: bytes) -> str:
        self.calls.append(wav)
        return self.text


class FakeTTS:
    """按音色给固定播放时长；记下每次播放的起止，打断时立刻返回 False。"""

    def __init__(self, secs: dict[str, float]):
        self.secs, self.played, self.cancelled = secs, [], []

    def speak(self, text, voice_name, cancel, role=""):
        t0 = time.time()
        if cancel.wait(self.secs[voice_name]):
            self.cancelled.append(voice_name)
            return False
        self.played.append((voice_name, t0, time.time()))
        return True


def run_listener(asr, pattern):
    got = []
    lst = voice.Listener(asr, got.append, lambda stop: [frames(pattern)], log=lambda s: None)
    lst.run()
    return got


class SegmentAndDrop(unittest.TestCase):
    def test_one_sentence_to_text(self):
        asr = FakeASR("今天聊聊周末去哪")
        got = run_listener(asr, [(SILENT, 600), (LOUD, 900), (SILENT, 1000)])
        self.assertEqual(got, ["今天聊聊周末去哪"])
        self.assertEqual(len(asr.calls), 1)
        self.assertTrue(asr.calls[0].startswith(b"RIFF"))   # 送给 ASR 的是 wav

    def test_two_sentences_split_by_pause(self):
        asr = FakeASR("一句话")
        got = run_listener(asr, [(LOUD, 600), (SILENT, 900), (LOUD, 600), (SILENT, 900)])
        self.assertEqual(len(got), 2)

    def test_empty_or_short_text_dropped(self):
        for text in ["", "  ", "。", "嗯"]:
            self.assertEqual(run_listener(FakeASR(text), [(LOUD, 900), (SILENT, 900)]), [], text)

    def test_noise_blip_not_sent_to_asr(self):
        asr = FakeASR("不该出现")
        self.assertEqual(run_listener(asr, [(LOUD, 90), (SILENT, 900)]), [])
        self.assertEqual(asr.calls, [])


def tone(level: int) -> bytes:
    """一帧方波，帧 RMS = level。"""
    return array.array("h", [level, -level] * (voice.FRAME_SAMPLES // 2)).tobytes()


class AdaptiveVoiceDetect(unittest.TestCase):
    """说话检测按底噪自适应：远场轻声（帧 RMS 约 40，实测用户桌前说话）过得了线；持续的嗡嗡声几秒后不再当说话。"""

    def test_quiet_far_voice_detected(self):
        # 底噪 6、说话 40：实测数据量级；旧的固定阈值 300 下这句会被当成静音。
        asr = FakeASR("今天聊聊周末去哪")
        got = run_listener(asr, [(tone(6), 3000), (tone(40), 1500), (tone(6), 1000)])
        self.assertEqual(got, ["今天聊聊周末去哪"])

    def test_floor_noise_and_blips_not_sent(self):
        asr = FakeASR("不该出现")
        self.assertEqual(run_listener(asr, [(tone(6), 5000), (tone(15), 2000), (tone(6), 1000)]), [])
        self.assertEqual(asr.calls, [])

    def test_floor_follows_steady_hum(self):
        # 突然来一段持续 10 秒、RMS 60 的嗡嗡声：底噪跟上之前最多切出一句，跟上之后不再切；之后高出它 4 倍的话照样听得到。
        seg = voice.Segmenter()
        cuts = [seg.feed(f) for f in frames([(tone(6), 2000), (tone(60), 10000)])]
        self.assertLessEqual(sum(c is not None for c in cuts), 1)
        self.assertGreater(seg.noise.value, 40)
        cuts = [seg.feed(f) for f in frames([(tone(300), 1000), (tone(60), 1000)])]
        self.assertEqual(sum(c is not None for c in cuts), 1)

    def test_digital_silence_does_not_make_everything_voice(self):
        seg = voice.Segmenter()
        cuts = [seg.feed(f) for f in frames([(SILENT, 12000), (tone(5), 2000), (SILENT, 1000)])]
        self.assertEqual([c for c in cuts if c is not None], [])
        self.assertGreaterEqual(seg.noise.value, voice.NOISE_MIN)


class GainNormalize(unittest.TestCase):
    def test_quiet_sentence_boosted_loud_kept(self):
        quiet = array.array("h", [150, -300, 20] * 100).tobytes()
        out = array.array("h", voice.normalize(quiet))
        self.assertEqual(max(abs(x) for x in out), voice.NORM_PEAK)
        self.assertEqual(out[0], round(150 * voice.NORM_PEAK / 300))
        loud = array.array("h", [30000, -20000] * 50).tobytes()
        self.assertEqual(voice.normalize(loud), loud)
        self.assertEqual(voice.normalize(SILENT), SILENT)

    def test_listener_sends_normalized_audio(self):
        import io, wave
        asr = FakeASR("一句话")
        run_listener(asr, [(tone(6), 2000), (tone(40), 900), (tone(6), 900)])
        with wave.open(io.BytesIO(asr.calls[0])) as w:
            pcm = array.array("h", w.readframes(w.getnframes()))
        self.assertEqual(max(abs(x) for x in pcm), voice.NORM_PEAK)


class ConfidenceFilter(unittest.TestCase):
    """gateway 返回置信度：噪声幻听（实测「Siri」0.535）丢掉，真人句（实测最低 0.597）照收；没有置信度时照旧。"""

    def test_low_confidence_dropped_high_kept(self):
        pat = [(LOUD, 900), (SILENT, 900)]
        self.assertEqual(run_listener(FakeASR(("Siri", 0.535)), pat), [])
        self.assertEqual(run_listener(FakeASR(("回家回家回家我家我家", 0.3)), pat), [])
        self.assertEqual(run_listener(FakeASR(("今天晚上我们聊聊回家的路上看到了什么", 0.597)), pat),
                         ["今天晚上我们聊聊回家的路上看到了什么"])
        self.assertEqual(run_listener(FakeASR(("聊聊猫", None)), pat), ["聊聊猫"])
        self.assertEqual(run_listener(FakeASR("聊聊猫"), pat), ["聊聊猫"])

    def test_gateway_asr_reads_confidence_and_old_format(self):
        import http.server, json as _json
        replies = [{"text": "你好呀", "language": "zh_CN", "confidence": 0.91}, {"text": "旧版", "language": "zh_CN"}]

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                body = _json.dumps(replies.pop(0)).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            asr = voice.GatewayASR(f"http://127.0.0.1:{srv.server_port}/v1", "k")
            self.assertEqual(asr.transcribe(voice.to_wav(SILENT)), ("你好呀", 0.91))
            self.assertEqual(asr.transcribe(voice.to_wav(SILENT)), ("旧版", None))
        finally:
            srv.shutdown()


class EchoReject(unittest.TestCase):
    """角色在播时麦克风收到的是她自己的声音：转出的字像正在念的话就丢掉；不像的是用户插话，照常进频道。"""
    SPOKEN = ["哼，回家这种事情我才不急呢，反正路上的风景我都看腻了。", "你们说得都对，那我们今天先聊到这里吧。"]

    def test_scores_on_measured_samples(self):
        # 实测回声转写（2026-10-18 喇叭放 Qwen、耳麦隔空收）
        for heard in ["回家这种事情我才不急呢 ，反正路上的风景我都看腻了。", "你们说的都对。", "那我们今天先聊到这里吧"]:
            self.assertTrue(voice.is_echo(heard, self.SPOKEN), heard)
        for heard in ["等一下", "你们先别聊了", "我们聊聊别的吧", "不对我觉得应该去山里"]:
            self.assertFalse(voice.is_echo(heard, self.SPOKEN), heard)
        self.assertFalse(voice.is_echo("你们说的都对", []))   # 没人在播：不当回声

    def _listen(self, text, spoken):
        got, asked = [], []

        def playing(t0, t1):
            asked.append((t0, t1))
            return spoken
        voice.Listener(FakeASR(text), got.append, lambda stop: [frames([(LOUD, 900), (SILENT, 900)])],
                       log=lambda s: None, playing=playing).run()
        return got, asked

    def test_listener_drops_echo_keeps_interjection(self):
        got, asked = self._listen("那我们今天先聊到这里吧", self.SPOKEN)
        self.assertEqual(got, [])
        t0, t1 = asked[0]
        self.assertAlmostEqual(t1 - t0, 1.5, delta=0.5)   # 一句的起止时间：900 毫秒有声 + 700 毫秒静音收尾 ≈ 1.5 秒
        self.assertEqual(self._listen("等一下，我想说两句", self.SPOKEN)[0], ["等一下，我想说两句"])

    def test_meeting_reports_what_is_being_said(self):
        tts = FakeTTS({"va": 5.0, "vb": 5.0})
        m = Meeting(ROLES_V, {r.id: FakeBrain(r.name) for r in ROLES_V}, 1, 1e6, tts=tts)
        m.user_say("话题一")
        end = time.time() + 2
        while m.speaking() is None and time.time() < end:
            time.sleep(0.01)
        now = time.time()
        said = m.spoken_between(now - 1, now)
        self.assertEqual(said, [m.speaking().text])
        self.assertEqual(m.spoken_between(now - 100, now - 50), [])   # 那时候没人在说
        # 回声不打断；用户插话打断
        lst = voice.Listener(FakeASR(said[0]), m.user_say, lambda stop: [frames([(LOUD, 900), (SILENT, 900)])],
                             log=lambda s: None, playing=m.spoken_between)
        lst.run()
        self.assertEqual(m.speaking().status, "speaking")
        self.assertEqual(tts.cancelled, [])
        lst = voice.Listener(FakeASR("等一下我想说两句"), m.user_say,
                             lambda stop: [frames([(LOUD, 900), (SILENT, 900)])],
                             log=lambda s: None, playing=m.spoken_between)
        lst.run()
        self.assertEqual(tts.cancelled, ["va"])
        m.stop()
        m.wait_idle(6)


class ReadWhileTranscribing(unittest.TestCase):
    def test_slow_asr_does_not_block_reading(self):
        # 第一句转写卡住，直到音源把后面的帧（含第二句）全部读完才放行；读麦被转写卡住的话这里会超时。
        release, read_all = threading.Event(), threading.Event()

        class SlowASR:
            calls, released = 0, None

            def transcribe(self, wav):
                SlowASR.calls += 1
                if SlowASR.calls == 1:
                    SlowASR.released = release.wait(1)   # 读麦被卡住的话等不到，返回 False
                return f"第{SlowASR.calls}句话"

        def src(stop):
            def gen():
                yield from frames([(LOUD, 600), (SILENT, 900), (LOUD, 600), (SILENT, 900)])
                read_all.set()
                release.set()
            return [gen()]

        got = []
        voice.Listener(SlowASR(), got.append, src, log=lambda s: None).run()
        self.assertTrue(SlowASR.released)
        self.assertEqual(got, ["第1句话", "第2句话"])   # 两句都在，顺序不乱


class LevelLog(unittest.TestCase):
    def test_peak_logged_periodically(self):
        logs = []
        voice.Listener(FakeASR(""), lambda t: None, lambda stop: [[SILENT, LOUD, SILENT]],
                       log=logs.append, level_every=0.0).run()
        levels = [x for x in logs if "音量峰值" in x]
        self.assertTrue(levels)
        self.assertIn("峰值 3000", levels[1])   # 第二帧是响的
        self.assertIn("峰值 0", levels[0])      # 静音帧峰值 0，输入音量为 0 时一眼能看出


class GatewayKeyMissing(unittest.TestCase):
    def test_missing_key_disables_voice_input_only(self):
        import tempfile
        d = Path(tempfile.mkdtemp())
        logs = []
        self.assertIsNone(voice.gateway_asr("http://127.0.0.1:1/v1", logs.append, d / "nope.json"))
        (d / "bad.json").write_text("{}")
        self.assertIsNone(voice.gateway_asr("http://127.0.0.1:1/v1", logs.append, d / "bad.json"))
        self.assertEqual(len(logs), 2)
        self.assertTrue(all("语音输入关闭" in x for x in logs))
        (d / "ok.json").write_text('{"api_key": "secret-k"}')
        asr = voice.gateway_asr("http://127.0.0.1:1/v1", logs.append, d / "ok.json")
        self.assertEqual(asr.api_key, "secret-k")
        self.assertFalse(any("secret-k" in x for x in logs))


class SayClose(unittest.TestCase):
    def test_close_kills_running_say(self):
        import tempfile
        fake = Path(tempfile.mkdtemp()) / "say"
        fake.write_text("#!/bin/sh\ncat >/dev/null\nexec sleep 30\n")
        fake.chmod(0o755)
        tts = voice.SayTTS(str(fake))
        out = []
        t = threading.Thread(target=lambda: out.append(tts.speak("你好", "v", threading.Event())))
        t.start()
        end = time.time() + 3
        while (tts._proc is None or tts._proc.poll() is not None) and time.time() < end:
            time.sleep(0.01)
        proc = tts._proc
        t0 = time.time()
        tts.close()
        t.join(2)
        self.assertLess(time.time() - t0, 1.5)
        self.assertIsNotNone(proc.poll())            # say 进程已死
        self.assertEqual(out, [False])
        self.assertFalse(tts.speak("再说", "v", threading.Event()))   # 关了之后不再念


class MicRetry(unittest.TestCase):
    def test_reopens_after_error(self):
        opens, logs, stop = [], [], threading.Event()

        def open_frames():
            opens.append(1)
            if len(opens) == 1:
                raise OSError("没有输入设备")
            yield LOUD
            yield LOUD
            if len(opens) == 2:
                raise OSError("设备被拔掉")

        got = []
        for f in voice.resilient(open_frames, stop, logs.append, retry=0.01):
            got.append(f)
            if len(got) == 4:
                stop.set()
        self.assertEqual(len(opens), 3)            # 出错两次，都重开了，没有永久停
        self.assertEqual(len(got), 4)
        self.assertTrue(any("没有输入设备" in x for x in logs))
        self.assertTrue(any("设备被拔掉" in x for x in logs))
        self.assertTrue(any("恢复" in x for x in logs))


ROLES_V = [Role("a", "A", "p", voice="va"), Role("b", "B", "p", voice="vb"), Role("c", "C", "p")]


class PlaybackHandoff(unittest.TestCase):
    def test_playback_duration_decides_handoff(self):
        # 字数估算极快（chars_per_sec 很大），所以“在说”时长只能来自播放
        tts = FakeTTS({"va": 0.3, "vb": 0.15})
        brains = {r.id: FakeBrain(r.name) for r in ROLES_V}
        m = Meeting(ROLES_V, brains, 3, 1e6, tts=tts)
        m.user_say("话题")
        m.wait_idle(5)
        roles = [x for x in m.messages if x.author in ("a", "b", "c")]
        self.assertEqual([x.status for x in roles], ["done"] * 3)
        a, b, c = roles
        self.assertGreaterEqual(a.end - a.start, 0.29)
        self.assertGreaterEqual(b.end - b.start, 0.14)
        self.assertLess(c.end - c.start, 0.1)       # 没有音色的角色退回字数估算
        self.assertGreaterEqual(b.start, a.end)      # 播完才交棒，不重叠
        self.assertGreaterEqual(c.start, b.end)
        self.assertEqual([p[0] for p in tts.played], ["va", "vb"])

    def test_tts_error_hands_off_without_estimated_wait(self):
        class BrokenTTS:
            def speak(self, text, voice_name, cancel, role=""):
                raise RuntimeError("say 退出码 1")

        brains = {r.id: FakeBrain(r.name) for r in ROLES_V[:2]}
        # chars_per_sec=1：要是退回字数估算，每句要等十几秒
        m = Meeting(ROLES_V[:2], brains, 2, 1.0, tts=BrokenTTS())
        t0 = time.time()
        m.user_say("话题")
        m.wait_idle(5)
        self.assertLess(time.time() - t0, 2.0)
        self.assertEqual([x.status for x in m.messages if x.author in ("a", "b")], ["done", "done"])

    def test_user_interrupts_playback(self):
        tts = FakeTTS({"va": 5.0, "vb": 5.0})
        brains = {r.id: FakeBrain(r.name) for r in ROLES_V}
        m = Meeting(ROLES_V, brains, 1, 1e6, tts=tts)
        m.user_say("话题一")
        end = time.time() + 2
        while m.speaking() is None and time.time() < end:
            time.sleep(0.01)
        self.assertEqual(m.speaking().author, "a")
        t0 = time.time()
        m.user_say("等一下")
        self.assertLess(time.time() - t0, 1.0)      # 播放立刻停，不等 5 秒
        first = [x for x in m.messages if x.author == "a"][0]
        self.assertEqual(first.status, "interrupted")
        self.assertEqual(tts.cancelled, ["va"])
        m.stop()
        m.wait_idle(6)


class VoiceToChannel(HubBase):
    async def test_spoken_sentence_goes_to_channel_as_user(self):
        brains = {r.id: FakeBrain(r.name) for r in ROLES_V}
        m = Meeting(ROLES_V, brains, 3, 1000.0, tts=FakeTTS({"va": 0.05, "vb": 0.05}))
        host = Host(m, self.url, TOKEN, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2)
        task = asyncio.create_task(host.run())
        await wait_for(host.connected.is_set, what="角色主机连上")
        lst = voice.Listener(FakeASR("聊聊猫"), host.say_as_user,
                             lambda stop: [frames([(LOUD, 900), (SILENT, 900)])], log=lambda s: None)
        await asyncio.get_running_loop().run_in_executor(None, lst.run)
        await wait_for(lambda: any(r["author_kind"] == "system" for r in self.rows()), what="讨论结束")
        users = self.rows(author_kind="user")
        self.assertEqual([(u["text"], u["author"]) for u in users], [("聊聊猫", "user")])
        self.assertEqual([r["status"] for r in self.rows(author_kind="role")], ["done"] * 3)
        host.stop()
        await asyncio.wait_for(task, 5)
        await asyncio.get_running_loop().run_in_executor(None, m.wait_idle, 5)


if __name__ == "__main__":
    unittest.main()
