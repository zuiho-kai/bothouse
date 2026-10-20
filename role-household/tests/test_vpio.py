"""系统语音处理（rh/vpio.py）：收音按帧交出、播放回执、打断立刻停、辅助进程起不来/中途死掉的处理、闭麦按钮照样停。
用假辅助进程（tests/fakebin/fake_vpio.py），不碰声卡、不出声、不录音。另有一条只编译真辅助进程（不运行）。"""
from __future__ import annotations

import io
import os
import shutil
import struct
import sys
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import config as cfgmod, voice, vpio

FAKE = [sys.executable, str(ROOT / "tests" / "fakebin" / "fake_vpio.py")]


def wav(secs: float, sr: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(bytes(int(secs * sr) * 2))
    return buf.getvalue()


class FakeSynth:
    def __init__(self, data: bytes):
        self.data, self.calls = data, 0

    def synth(self, text, voice):
        self.calls += 1
        return self.data


class FakeFallback:
    def __init__(self):
        self.played = []

    def play_wav(self, data, cancel):
        self.played.append(data)
        return True


class Env:
    def __init__(self, **kv):
        self.kv, self.old = kv, {}

    def __enter__(self):
        for k, v in self.kv.items():
            self.old[k] = os.environ.get(k)
            os.environ[k] = v

    def __exit__(self, *a):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


class VPIOTest(unittest.TestCase):
    def setUp(self):
        self.logs = []
        self.v = vpio.VPIO(FAKE, log=self.logs.append, ready_timeout=5)

    def tearDown(self):
        self.v.close()

    def test_mic_frames_are_30ms_in_order(self):
        it = self.v.mic()
        got = [next(it) for _ in range(5)]
        self.assertTrue(all(len(f) == voice.FRAME_SAMPLES * 2 for f in got))
        # 假进程每 10 毫秒一块、样本值 = 块序号：一帧 30 毫秒 = 连着的 3 块
        first = [struct.unpack_from("<h", got[0], i * 320)[0] for i in range(3)]
        self.assertEqual(first, [first[0], first[0] + 1, first[0] + 2])
        self.assertTrue(any("就绪" in s and "level" in s for s in self.logs), self.logs)

    def test_play_waits_until_done(self):
        t0 = time.monotonic()
        self.assertTrue(self.v.play(bytes(24000 * 2 * 2), 24000, threading.Event()))   # 2 秒音频，假进程 0.2 秒回 done
        self.assertGreaterEqual(time.monotonic() - t0, 0.15)

    def test_cancel_stops_at_once(self):
        cancel = threading.Event()
        threading.Timer(0.1, cancel.set).start()
        t0 = time.monotonic()
        self.assertFalse(self.v.play(bytes(24000 * 2 * 60), 24000, cancel))   # 60 秒音频，打断后立刻回
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertTrue(self.v.play(bytes(2400 * 2), 24000, threading.Event()))   # 打断后下一句照常播

    def test_mic_keeps_running_while_playing(self):
        """角色说话时不关收音：播放期间收音帧照样来。"""
        it = self.v.mic()
        next(it)
        th = threading.Thread(target=self.v.play, args=(bytes(24000 * 2 * 5), 24000, threading.Event()))
        th.start()
        for _ in range(10):
            next(it)
        th.join()

    def test_start_failure_raises_with_reason(self):
        with Env(FAKE_VPIO="fail"):
            with self.assertRaises(vpio.VPIOError) as cm:
                self.v.play(bytes(100), 16000, threading.Event())
        self.assertIn("假的", str(cm.exception))
        self.assertFalse(cm.exception.started)

    def test_not_ready_times_out(self):
        v = vpio.VPIO(FAKE, log=self.logs.append, ready_timeout=0.3)
        with Env(FAKE_VPIO="hang"):
            with self.assertRaises(vpio.VPIOError):
                next(v.mic())
        v.close()

    def test_death_mid_play_and_restart(self):
        with Env(FAKE_VPIO="die_on_play"):
            it = self.v.mic()
            next(it)
            with self.assertRaises(vpio.VPIOError) as cm:
                self.v.play(bytes(24000 * 2), 24000, threading.Event())
            self.assertTrue(cm.exception.started)
            with self.assertRaises(RuntimeError):   # 收音那边也知道停了（rh.voice.resilient 会重开）
                for _ in range(1000):
                    next(it)
        it = self.v.mic()   # 重开后正常
        self.assertEqual(len(next(it)), voice.FRAME_SAMPLES * 2)

    def test_resilient_reopens_after_death(self):
        stop = threading.Event()
        logs = []
        n = {"opens": 0}

        def opener():
            n["opens"] += 1
            if n["opens"] == 1:
                with Env(FAKE_VPIO="fail"):
                    next(self.v.mic())   # 起不来：抛错
            return self.v.mic()

        frames = voice.resilient(opener, stop, logs.append, retry=0.05)
        self.assertEqual(len(next(frames)), voice.FRAME_SAMPLES * 2)
        stop.set()
        self.assertEqual(n["opens"], 2)
        self.assertTrue(any("读麦出错" in s for s in logs), logs)



class VPIOPlayTTSTest(unittest.TestCase):
    def setUp(self):
        self.logs = []
        self.v = vpio.VPIO(FAKE, log=self.logs.append, ready_timeout=5)

    def tearDown(self):
        self.v.close()

    def test_speaks_through_vpio_at_synth_rate(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / "play.log"
            with Env(FAKE_VPIO_LOG=str(log)):
                fb = FakeFallback()
                tts = vpio.VPIOPlayTTS(FakeSynth(wav(0.5)), self.v, fb, self.logs.append)
                self.assertTrue(tts.speak("你好", "Tingting", threading.Event()))
            self.assertEqual(log.read_text().split()[2:], ["24000", str(12000 * 2)])
        self.assertEqual(fb.played, [])

    def test_falls_back_to_afplay_when_vpio_cannot_start(self):
        fb = FakeFallback()
        data = wav(0.2)
        synth = FakeSynth(data)
        tts = vpio.VPIOPlayTTS(synth, self.v, fb, self.logs.append)
        with Env(FAKE_VPIO="fail"):
            self.assertTrue(tts.speak("你好", "Tingting", threading.Event()))
        self.assertEqual(fb.played, [data])
        self.assertEqual(synth.calls, 1)   # 不重复合成
        self.assertTrue(any("改用 afplay" in s for s in self.logs), self.logs)

    def test_no_replay_when_died_mid_sentence(self):
        fb = FakeFallback()
        tts = vpio.VPIOPlayTTS(FakeSynth(wav(0.2)), self.v, fb, self.logs.append)
        with Env(FAKE_VPIO="die_on_play"):
            self.assertTrue(tts.speak("你好", "Tingting", threading.Event()))
        self.assertEqual(fb.played, [])

    def test_cancel_before_play(self):
        cancel = threading.Event()
        cancel.set()
        fb = FakeFallback()
        tts = vpio.VPIOPlayTTS(FakeSynth(wav(0.2)), self.v, fb)
        self.assertFalse(tts.speak("你好", "Tingting", cancel))


class BuildTTSTest(unittest.TestCase):
    def test_say_backend_uses_vpio_for_local(self):
        from rh.host import build_tts
        cfg = cfgmod.load(ROOT / "roles.example.toml")   # 只看 player 怎么搭，不依赖本地 roles.toml
        cfg.voice_backend = "say"
        v = vpio.VPIO(FAKE)
        tts = build_tts(cfg, vpio=v)
        self.assertIsInstance(tts.local, vpio.VPIOPlayTTS)
        self.assertIsInstance(tts.local.fallback, voice.PlayTTS)
        self.assertIsInstance(build_tts(cfg).local, voice.SayTTS)   # 不给 vpio：旧方式
        v.close()


class ConfigTest(unittest.TestCase):
    def test_player_option(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "roles.toml"
            base = (ROOT / "roles.example.toml").read_text().replace('backend = "say"', 'backend = "say"\nplayer = "vpio"', 1)
            p.write_text(base)
            self.assertEqual(cfgmod.load(p).voice_player, "vpio")
            p.write_text(base.replace('player = "vpio"', 'player = "afplay"'))
            self.assertEqual(cfgmod.load(p).voice_player, "afplay")
            p.write_text(base.replace('player = "vpio"', 'player = "livekit"'))
            with self.assertRaises(ValueError):
                cfgmod.load(p)
            p.write_text(base.replace('player = "vpio"\n', ''))
            self.assertEqual(cfgmod.load(p).voice_player, "afplay")   # 旧配置照旧


@unittest.skipUnless(shutil.which("swiftc"), "没有 swiftc")
class BuildHelperTest(unittest.TestCase):
    def test_real_helper_compiles(self):
        """只编译、不运行（运行会开麦和喇叭）。"""
        with tempfile.TemporaryDirectory() as d:
            out = vpio.build_helper(out=Path(d) / "rh_vpio")
            self.assertTrue(out.is_file())
            mtime = out.stat().st_mtime
            self.assertEqual(vpio.build_helper(out=out), out)   # 源码没变不重编
            self.assertEqual(out.stat().st_mtime, mtime)


if __name__ == "__main__":
    unittest.main()
