"""语音输入输出：麦克风常开收音 -> 按停顿切句 -> ASR 转文字；角色发言 -> TTS 播放。

两个很小的接口，换实现（CoNest 的 mlx_whisper / Qwen3-TTS、机器人上的小智协议）时频道和发言锁不用动：
- ASR.transcribe(wav 字节) -> 文字
- TTS.speak(文字, 音色, 打断事件, role=角色 id) -> True 说完 / False 被打断；阻塞到播完为止，播放时长就是“在说”时长。
  两种实现：SayTTS（本机 Mac 喇叭直接念）、rh.device.DeviceSpeaker（合成音频推给该角色的设备，等设备回执）。
- Synth.synth(文字, 音色) -> WAV 字节：只合成不播放，推给设备用（SaySynth = macOS say -o）。

第一版实现：GatewayASR（本机 ai-gateway 的 /v1/audio/transcriptions，Apple SpeechTranscriber）、
SayTTS（macOS say，从系统默认输出播放）。收音用 sounddevice（PortAudio）读系统默认输入设备。
"""
from __future__ import annotations

import array
import io
import json
import math
import queue
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid
import wave
from collections import deque
from pathlib import Path
from typing import Callable, Iterable, Iterator, Protocol

SAMPLE_RATE = 16000   # 16 kHz 单声道 16 位：ASR 常用格式。来源：实现者定。
FRAME_MS = 30         # 每帧毫秒数，按帧算音量。来源：实现者定。
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
# 音量（RMS，16 位采样）超过它算有人在说话。来源：实现者定。2026-10-18 实测 Jabra 耳麦底噪中位约 3、
# 偶尔碰到约 80；喇叭放 say 时耳麦收到的最高约 90。人声贴着耳麦远高于此，但真人音量没实测过。
VOICE_RMS = 300.0
END_SILENCE_MS = 700  # 说话后静音这么久算一句结束。来源：实现者定。
MIN_VOICE_MS = 300    # 一句里有声帧不到这么长就当噪声丢掉，不送 ASR。来源：实现者定。
MAX_UTTER_MS = 30000  # 一句最长这么久，到了就切。来源：实现者定。
PREROLL_MS = 300      # 句首往前多带这么久，免得吞掉第一个字。来源：实现者定。
# 转出的文字去掉标点空白后不到这么多字就丢掉（“嗯”“啊”这类）。来源：实现者定。
MIN_TEXT_CHARS = 2
# 每隔这么久在日志里打一行最近的音量峰值，看得出“输入音量为 0”这类问题。
# 来源：协调者要求定期打、间隔实现者定；60 秒 = 一小时 60 行，不刷屏。
LEVEL_LOG_SEC = 60.0
ASR_TIMEOUT = 60.0    # 单次转写请求超时秒数。来源：实现者定。
SYNTH_TIMEOUT = 60.0  # say -o 合成一句的超时秒数。来源：实现者定，一到三句口语实测不到 1 秒。

_PUNCT = re.compile(r"[\s\W_]+", re.UNICODE)


class ASR(Protocol):
    def transcribe(self, wav: bytes) -> str: ...


class TTS(Protocol):
    def speak(self, text: str, voice: str, cancel: threading.Event, role: str = "") -> bool: ...


class Synth(Protocol):
    def synth(self, text: str, voice: str) -> bytes: ...


# ---------- 实现 ----------
class GatewayASR:
    """OpenAI 兼容的 /v1/audio/transcriptions（本机 ai-gateway）。"""

    def __init__(self, base_url: str, api_key: str, language: str = "zh-CN"):
        self.url = base_url.rstrip("/") + "/audio/transcriptions"
        self.api_key = api_key
        self.language = language

    def transcribe(self, wav: bytes) -> str:
        boundary = uuid.uuid4().hex
        parts = [
            f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{self.language}\r\n'.encode(),
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n'
            "Content-Type: audio/wav\r\n\r\n".encode(), wav, f"\r\n--{boundary}--\r\n".encode(),
        ]
        req = urllib.request.Request(self.url, data=b"".join(parts), method="POST", headers={
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(req, timeout=ASR_TIMEOUT) as r:
            return str(json.loads(r.read()).get("text", ""))


GATEWAY_CONFIG = Path.home() / "ai-gateway" / "state" / "config.json"


def gateway_key(path: Path = GATEWAY_CONFIG) -> str:
    return str(json.loads(path.read_text())["api_key"])


def gateway_asr(base_url: str, log: Callable[[str], None], path: Path = GATEWAY_CONFIG) -> GatewayASR | None:
    """读不到 gateway key 就返回 None（只关语音输入，主机照常起）；日志里不打印 key。"""
    try:
        return GatewayASR(base_url, gateway_key(path))
    except (OSError, ValueError, KeyError, TypeError) as e:
        log(f"[voice] 读不到 gateway key（{path}：{type(e).__name__}），语音输入关闭，播放和文字照常")
        return None


class SayTTS:
    """macOS say：阻塞到念完；打断事件一响就杀掉 say。"""

    def __init__(self, cmd: str = "say"):
        self.cmd = cmd
        self._mu = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._closed = False

    def close(self) -> None:
        """主机退出时调用：杀掉还在念的 say，之后不再念（话题线程是 daemon，等不到它自己收尾）。"""
        with self._mu:
            self._closed = True
            proc = self._proc
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()

    def speak(self, text: str, voice: str, cancel: threading.Event, role: str = "") -> bool:
        with self._mu:
            if self._closed:
                return False
            # 文字走 stdin（-f -），不进 argv：以“-”开头的文字不会被当成参数。
            proc = subprocess.Popen([self.cmd, "-v", voice, "-f", "-"], stdin=subprocess.PIPE,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self._proc = proc
        try:
            proc.stdin.write(text.encode("utf-8", "replace"))
            proc.stdin.close()
        except BrokenPipeError:
            pass
        while proc.poll() is None:
            if cancel.wait(0.03):
                proc.kill()
                proc.wait()
                return False
        with self._mu:
            self._proc = None
            if self._closed:
                return False
        if proc.returncode != 0:
            raise RuntimeError(f"say 退出码 {proc.returncode}（音色 {voice} 不存在？）")
        return True


class SaySynth:
    """macOS say -o：合成成 16 kHz 单声道 16 位 WAV（和收音同格式），不出声。"""

    def __init__(self, cmd: str = "say"):
        self.cmd = cmd

    def synth(self, text: str, voice: str) -> bytes:
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "a.wav"
            # 文字走 stdin（-f -），同 SayTTS。
            r = subprocess.run([self.cmd, "-v", voice, "-o", str(out), "--file-format=WAVE",
                                f"--data-format=LEI16@{SAMPLE_RATE}", "-f", "-"],
                               input=text.encode("utf-8", "replace"), capture_output=True, timeout=SYNTH_TIMEOUT)
            if r.returncode != 0 or not out.is_file():
                raise RuntimeError(f"say -o 退出码 {r.returncode}（音色 {voice} 不存在？）")
            return out.read_bytes()


def wav_secs(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav), "rb") as r:
        return r.getnframes() / r.getframerate()


# ---------- 切句 ----------
def rms(frame: bytes) -> float:
    a = array.array("h", frame)
    return math.sqrt(sum(x * x for x in a) / len(a)) if a else 0.0


class Segmenter:
    """按音量切句：超过阈值开始，静音够久结束。feed 每次一帧，返回切好的一句 PCM（或 None）。"""

    def __init__(self, threshold: float = VOICE_RMS):
        self.threshold = threshold
        self._pre: deque[bytes] = deque(maxlen=PREROLL_MS // FRAME_MS)
        self._cur: list[bytes] | None = None
        self._voiced = 0
        self._silent = 0

    def feed(self, frame: bytes) -> bytes | None:
        loud = rms(frame) >= self.threshold
        if self._cur is None:
            if not loud:
                self._pre.append(frame)
                return None
            self._cur, self._voiced, self._silent = list(self._pre) + [frame], 1, 0
            self._pre.clear()
            return None
        self._cur.append(frame)
        if loud:
            self._voiced += 1
            self._silent = 0
        else:
            self._silent += 1
        if self._silent * FRAME_MS >= END_SILENCE_MS or len(self._cur) * FRAME_MS >= MAX_UTTER_MS:
            return self.flush()
        return None

    def flush(self) -> bytes | None:
        cur, voiced = self._cur, self._voiced
        self._cur, self._voiced, self._silent = None, 0, 0
        if cur is None or voiced * FRAME_MS < MIN_VOICE_MS:
            return None
        return b"".join(cur)


def to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def worth_sending(text: str) -> bool:
    return len(_PUNCT.sub("", text)) >= MIN_TEXT_CHARS


# ---------- 音源 ----------
MIC_RETRY_SEC = 3.0   # 读麦出错后隔这么久重开。来源：协调者要求“每隔几秒重试”，具体值实现者定。
MIC_STALL_SEC = 2.0   # 这么久没收到一帧就当设备没了（拔掉时可能不报错只是不出数据），关流重开。来源：实现者定。


def resilient(open_frames: Callable[[], Iterable[bytes]], stop: threading.Event,
              log: Callable[[str], None], retry: float = MIC_RETRY_SEC) -> Iterator[bytes]:
    """打开音源读帧；出错（拔掉、没设备、卡住）就打日志、隔 retry 秒重开，直到 stop。"""
    last_err = None
    while not stop.is_set():
        try:
            for frame in open_frames():
                if last_err is not None:
                    log("[voice] 麦克风恢复了")
                    last_err = None
                yield frame
                if stop.is_set():
                    return
            raise RuntimeError("音源结束")
        except Exception as e:
            if repr(e) != last_err:   # 同一个错只打一次，拔着几个小时也不刷屏
                log(f"[voice] 读麦出错，每 {retry:g} 秒重开一次：{e!r}")
            last_err = repr(e)
        stop.wait(retry)


def _open_mic() -> Iterator[bytes]:
    import sounddevice as sd   # 只有真收音时才要 PortAudio
    sd._terminate()   # PortAudio 初始化时缓存设备列表，重新初始化才能认出新插上的麦
    sd._initialize()
    q: queue.Queue[bytes] = queue.Queue()

    def cb(indata, n, t, status):
        q.put(bytes(indata))

    with sd.RawInputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME_SAMPLES,
                           callback=cb):
        while True:
            try:
                yield q.get(timeout=MIC_STALL_SEC)
            except queue.Empty:
                raise RuntimeError(f"{MIC_STALL_SEC:g} 秒没收到声音数据（麦克风拔掉了？）") from None


def mic_frames(stop: threading.Event, log: Callable[[str], None] = lambda s: print(s, flush=True)) -> Iterator[bytes]:
    """系统默认输入设备，16 kHz 单声道；出错自动重开。"""
    return resilient(_open_mic, stop, log)


def file_frames(path: str | Path, ffmpeg: str = "ffmpeg") -> Iterator[bytes]:
    """把音频文件解码成和麦克风一样的帧（端到端自测用），末尾补静音让最后一句收尾。"""
    pcm = subprocess.run([ffmpeg, "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE),
                          "-f", "s16le", "-"], check=True, capture_output=True).stdout
    n = FRAME_SAMPLES * 2
    for i in range(0, len(pcm) - n + 1, n):
        yield pcm[i:i + n]
    for _ in range(END_SILENCE_MS // FRAME_MS + 1):
        yield bytes(n)


# ---------- 收音线程 ----------
class Listener:
    """读音源 -> 切句 -> ASR -> 文字够长就交给 on_text（角色主机把它作为用户消息发到云端频道）。"""

    def __init__(self, asr: ASR, on_text: Callable[[str], None],
                 sources: Callable[[threading.Event], Iterable[Iterable[bytes]]],
                 log: Callable[[str], None] = lambda s: print(s, flush=True),
                 level_every: float = LEVEL_LOG_SEC):
        self.asr, self.on_text, self.sources, self.log = asr, on_text, sources, log
        self.level_every = level_every
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # 切好的句子排队交给转写线程：转写（可能好几秒）期间读麦线程照常读，后面的话不丢；单线程转写，顺序不乱。
        self._q: queue.Queue[bytes | None] = queue.Queue()

    def start(self) -> None:
        self._thread = threading.Thread(target=self.run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._q.put(None)

    def join(self, timeout: float | None = None) -> None:
        if self._thread:
            self._thread.join(timeout)

    def run(self) -> None:
        """读麦线程：只读帧、切句、把句子放进队列。音源读完（或 stop）后等转写线程把队列里的做完。"""
        worker = threading.Thread(target=self._asr_loop, daemon=True)
        worker.start()
        peak, since = 0.0, time.monotonic()
        try:
            for frames in self.sources(self._stop):
                seg = Segmenter()
                for frame in frames:
                    if self._stop.is_set():
                        return
                    peak = max(peak, rms(frame))
                    if time.monotonic() - since >= self.level_every:
                        self.log(f"[voice] 最近 {self.level_every:g} 秒音量峰值 {peak:.0f}（说话阈值 {VOICE_RMS:g}）")
                        peak, since = 0.0, time.monotonic()
                    pcm = seg.feed(frame)
                    if pcm is not None:
                        self._q.put(pcm)
                pcm = seg.flush()
                if pcm is not None:
                    self._q.put(pcm)
        except Exception as e:   # 收音坏了不拖垮主机：文字频道照常能用
            self.log(f"[voice] 收音停止：{e!r}")
        finally:
            self._q.put(None)
            worker.join()

    def _asr_loop(self) -> None:
        while (pcm := self._q.get()) is not None:
            if self._stop.is_set():
                return
            try:
                self.handle(pcm)
            except Exception as e:   # on_text 出错（比如退出时事件循环已关）不能让转写线程死掉
                self.log(f"[voice] 处理一句话出错：{e!r}")

    def handle(self, pcm: bytes) -> None:
        secs = len(pcm) / 2 / SAMPLE_RATE
        t0 = time.time()
        try:
            text = self.asr.transcribe(to_wav(pcm)).strip()
        except Exception as e:
            self.log(f"[voice] 转写失败（{secs:.1f} 秒音频）：{e!r}")
            return
        if not worth_sending(text):
            self.log(f"[voice] 丢掉 {secs:.1f} 秒音频，转出「{text}」太短或为空")
            return
        self.log(f"[voice] 听到（{secs:.1f} 秒音频，转写 {time.time() - t0:.2f} 秒）：{text}")
        self.on_text(text)
