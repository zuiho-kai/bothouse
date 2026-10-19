"""Qwen3-TTS 后端：常驻进程只加载一次、出错/超时/退出改用 say、配置切换。用假合成进程，秒级，不加载模型、不出声。"""
from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import config, voice
from rh.host import build_tts
from tests.test_device import silent_wav

# 假合成进程：按协议回 ready 和静音 WAV。模式：ok / crash（收到请求就退出）/ hang（不回）/ badload / fail（回 ok=false）
FAKE_WORKER = r'''
import base64, io, json, os, sys, wave
mode = sys.argv[1]
if mode == "badload":
    print(json.dumps({"ready": False, "error": "no model"}), flush=True); sys.exit(1)
print(json.dumps({"ready": True, "load_sec": 0.0, "pid": os.getpid()}), flush=True)
for line in sys.stdin:
    req = json.loads(line)
    if mode == "crash": sys.exit(3)
    if mode == "hang": continue
    if mode == "fail":
        print(json.dumps({"ok": False, "error": "boom"}), flush=True); continue
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(bytes(2400 * 2))
    print("mlx-audio 打到 stdout 的杂字不该出现在这里", file=sys.stderr)
    print(json.dumps({"ok": True, "wav": base64.b64encode(buf.getvalue()).decode(),
                      "secs": 0, "echo": [req["speaker"], req["instruct"], req["text"], os.getpid()]}), flush=True)
'''
VOICES = {"Tingting": ("Ono_Anna", "干脆"), "Meijia": ("Serena", "慵懒")}


def worker(mode: str) -> list[str]:
    d = Path(tempfile.mkdtemp())
    (d / "w.py").write_text(FAKE_WORKER)
    return [sys.executable, str(d / "w.py"), mode]


def qwen(mode: str, **kw) -> voice.QwenSynth:
    return voice.QwenSynth(worker(mode), VOICES, log=lambda s: None, **kw)


class FakeSay:
    def __init__(self):
        self.calls = []

    def synth(self, text, v):
        self.calls.append((text, v))
        return silent_wav(0.05)


class QwenBackend(unittest.TestCase):
    def test_loads_once_and_returns_wav(self):
        q = qwen("ok")
        q.start()
        pid = q._proc.pid
        for _ in range(3):
            wav = q.synth("你好。", "Tingting")
            self.assertAlmostEqual(voice.wav_secs(wav), 0.1, places=2)
        self.assertEqual(q._proc.pid, pid)   # 三句同一个进程，没有每句冷启动
        q.close()

    def test_speaker_and_instruct_follow_voice(self):
        q = voice.QwenSynth(worker("ok"), VOICES, log=lambda s: None)
        seen = []
        orig = q._read
        q._read = lambda t: (lambda r: (seen.append(r.get("echo")), r)[1])(orig(t))
        q.synth("一", "Meijia")
        self.assertEqual(seen[-1][:3], ["Serena", "慵懒", "一"])
        q.close()

    def test_crash_falls_back_to_say_then_restarts(self):
        q = qwen("crash")
        say = FakeSay()
        logs = []
        fs = voice.FallbackSynth(q, say, logs.append)
        fs.synth("第一句。", "Tingting")
        self.assertEqual(say.calls, [("第一句。", "Tingting")])
        self.assertTrue(any("改用 say" in x for x in logs))
        fs.synth("第二句。", "Tingting")   # 下一句会重启进程再试，失败照样落回 say
        self.assertEqual(len(say.calls), 2)
        q.close()

    def test_hang_times_out_and_kills(self):
        q = qwen("hang", timeout=0.3)
        q.start()
        proc = q._proc
        t0 = time.time()
        with self.assertRaises(RuntimeError):
            q.synth("卡住", "Tingting")
        self.assertLess(time.time() - t0, 2)
        self.assertIsNotNone(proc.poll())   # 卡住的进程被杀掉
        q.close()

    def test_error_reply_and_unknown_voice_fall_back(self):
        say = FakeSay()
        fs = voice.FallbackSynth(qwen("fail"), say, lambda s: None)
        fs.synth("一", "Tingting")
        fs.synth("二", "Sinji")   # 没配 Qwen 音色
        self.assertEqual([c[1] for c in say.calls], ["Tingting", "Sinji"])
        fs.close()

    def test_bad_load_raises(self):
        with self.assertRaises(RuntimeError):
            qwen("badload").start()

    def test_close_unblocks_running_synth(self):
        q = qwen("hang", timeout=30)
        q.start()
        out = []

        def run():
            try:
                q.synth("一", "Tingting")
            except RuntimeError as e:
                out.append(e)
        t = threading.Thread(target=run)
        t.start()
        time.sleep(0.2)
        t0 = time.time()
        q.close()
        t.join(3)
        self.assertLess(time.time() - t0, 2)
        self.assertEqual(len(out), 1)


class PlayLocal(unittest.TestCase):
    def test_cancel_kills_player(self):
        fake = Path(tempfile.mkdtemp()) / "afplay"
        fake.write_text("#!/bin/sh\nexec sleep 30\n")
        fake.chmod(0o755)
        tts = voice.PlayTTS(FakeSay(), str(fake))
        cancel = threading.Event()
        threading.Timer(0.2, cancel.set).start()
        t0 = time.time()
        self.assertFalse(tts.speak("你好", "Tingting", cancel))
        self.assertLess(time.time() - t0, 2)

    def test_plays_to_end(self):
        fake = Path(tempfile.mkdtemp()) / "afplay"
        fake.write_text("#!/bin/sh\ntest -s \"$1\"\n")   # 收到非空 wav 文件就算播完
        fake.chmod(0o755)
        self.assertTrue(voice.PlayTTS(FakeSay(), str(fake)).speak("你好", "Tingting", threading.Event()))


TOML = '''
[meeting]
max_turns_per_topic = 2
chars_per_sec = 5.0
[brain]
model = "haiku"
timeout_sec = 10
{voice}
[[roles]]
id = "a"
name = "A"
persona = "p"
voice = "Tingting"
qwen_speaker = "Ono_Anna"
qwen_instruct = "干脆"
[[roles]]
id = "b"
name = "B"
persona = "p"
voice = "{bvoice}"
qwen_speaker = "Serena"
'''


def load(voice_section: str = "", bvoice: str = "Meijia") -> config.Config:
    f = Path(tempfile.mkdtemp()) / "roles.toml"
    f.write_text(TOML.format(voice=voice_section, bvoice=bvoice))
    return config.load(f)


class Config(unittest.TestCase):
    def test_default_is_say(self):
        c = load()
        self.assertEqual(c.voice_backend, "say")
        self.assertIsInstance(build_tts(c, log=lambda s: None).synth, voice.SaySynth)

    def test_qwen_backend_survives_broken_worker(self):
        c = load('[voice]\nbackend = "qwen"\nqwen_python = "/nonexistent/python"\nqwen_model = "~/m"')
        self.assertEqual(c.qwen_model, str(Path("~/m").expanduser()))
        logs = []
        tts = build_tts(c, log=logs.append)   # 起不来：打日志，主机照常起，合成走 FallbackSynth
        self.assertIsInstance(tts.synth, voice.FallbackSynth)
        self.assertIsInstance(tts.local, voice.PlayTTS)
        self.assertTrue(any("启动失败" in x for x in logs))
        self.assertEqual(tts.synth.primary.voices, {"Tingting": ("Ono_Anna", "干脆"), "Meijia": ("Serena", "")})
        tts.close()

    def test_bad_backend_and_conflicting_voice_rejected(self):
        with self.assertRaises(ValueError):
            load('[voice]\nbackend = "edge"')
        with self.assertRaises(ValueError):
            load(bvoice="Tingting")   # 同一个 say 音色配了两套 Qwen 音色


if __name__ == "__main__":
    unittest.main()
