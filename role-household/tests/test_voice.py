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
