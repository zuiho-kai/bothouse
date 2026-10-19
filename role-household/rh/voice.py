"""语音输入输出：麦克风常开收音 -> 按停顿切句 -> ASR 转文字；角色发言 -> TTS 播放。

两个很小的接口，换实现（CoNest 的 mlx_whisper / Qwen3-TTS、机器人上的小智协议）时频道和发言锁不用动：
- ASR.transcribe(wav 字节) -> 文字，或 (文字, 置信度)
- TTS.speak(文字, 音色, 打断事件, role=角色 id) -> True 说完 / False 被打断；阻塞到播完为止，播放时长就是“在说”时长。
  实现：SayTTS（本机 Mac 喇叭直接念）、PlayTTS（先合成再用 afplay 播）、
  rh.device.DeviceSpeaker（合成音频推给该角色的设备，等设备回执）。
- Synth.synth(文字, 音色) -> WAV 字节：只合成不播放，推给设备用。SaySynth = macOS say -o；
  QwenSynth = 本机 Qwen3-TTS 常驻进程（rh/qwen_worker.py）；FallbackSynth = Qwen 出错就改用 say。
  音色参数一律是 roles.toml 里角色的 voice（say 音色名）；QwenSynth 按它查该角色的 Qwen speaker 和语气。

第一版实现：GatewayASR（本机 ai-gateway 的 /v1/audio/transcriptions，Apple SpeechTranscriber）、
SayTTS（macOS say，从系统默认输出播放）。收音用 sounddevice（PortAudio）读系统默认输入设备。
"""
from __future__ import annotations

import array
import base64
import difflib
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
# ---- 说话检测：按底噪自适应（替代原来的固定阈值 300）----
# 实测（2026-10-18，Jabra EVOLVE 30 II 挂在书架上、人在一米多外，/tmp/micmeter/rec.wav 与 /tmp/rhasr/*.wav 按 30 毫秒帧算 RMS）：
#   底噪帧 RMS 中位约 6；用户在桌前正常说话的帧 p90 约 38、p99 约 136、最高约 292；
#   喇叭放角色声音被隔空收到时 0.5 秒均值 70-130。固定 300 时用户的话几乎全被当成静音。
# 底噪 = 最近 NOISE_WIN_SEC 秒帧 RMS 的第 NOISE_PCTL 分位：说话的字与字之间有停顿，低分位仍落在底噪上。
NOISE_WIN_SEC = 10.0  # 来源：实现者定；比一句话（实测多在 2-6 秒）长，说话时底噪估计不被抬高。
NOISE_PCTL = 0.10     # 来源：实现者定；rec.wav（150 秒，含用户说话）帧 RMS 的 p10 = 5，与安静时底噪一致。
NOISE_INIT = 6.0      # 刚开麦、还没有历史时的底噪。来源：实测底噪帧 RMS 中位约 6。
NOISE_MIN = 3.0       # 底噪下限，防数字静音（全 0）时阈值变 0、什么都算说话。来源：实测安静时帧 RMS 中位 3-6。
VOICE_RATIO = 4.0     # 帧 RMS ≥ 底噪 × 它算有声。来源：实测底噪约 6 → 阈值约 24，用户说话帧 p90 约 38 在线上；
                      # 安静录音 amb_noise.wav 帧 RMS p90 约 13 在线下。偶发噪声尖峰（最高约 219）靠 MIN_VOICE_MS 和置信度挡。
# 送 ASR 前把整句峰值放大到它（不缩小）。来源：实现者定，-6 dBFS 留余量；上一位排查者实测 RMS 42 的干净人声和放大 30 倍后都能转对。
NORM_PEAK = 16384
END_SILENCE_MS = 700  # 说话后静音这么久算一句结束。来源：实现者定。
MIN_VOICE_MS = 300    # 一句里有声帧不到这么长就当噪声丢掉，不送 ASR。来源：实现者定。
MAX_UTTER_MS = 30000  # 一句最长这么久，到了就切。来源：实现者定。
PREROLL_MS = 300      # 句首往前多带这么久，免得吞掉第一个字。来源：实现者定。
# 转出的文字去掉标点空白后不到这么多字就丢掉（“嗯”“啊”这类）。来源：实现者定。
MIN_TEXT_CHARS = 2
# 每隔这么久在日志里打一行最近的音量峰值，看得出“输入音量为 0”这类问题。
# 来源：协调者要求定期打、间隔实现者定；60 秒 = 一小时 60 行，不刷屏。
LEVEL_LOG_SEC = 60.0
# 转写置信度低于它就当噪声幻听丢掉。来源：2026-10-18 实测（/tmp/rhasr、/tmp/micmeter 的录音切句后过 speech-bridge）：
# 纯噪声转出的假字「Siri」0.42/0.535、「真」0.52、「我」0.15/0.38、「you」0.16-0.33，最高 0.535；
# 远场真人整句最低 0.597（「今天晚上我们聊聊回家的路上看到了什么」，字全对），其余 0.70-1.00。取两者之间。
MIN_CONFIDENCE = 0.56
# 角色在播时，转出的字和正在念的文字相似度（转出的字里有多少按顺序出现在角色原文里）≥ 它就当回声丢掉。
# 来源：2026-10-18 实测：Qwen 角色台词从 Mac 喇叭放、耳麦隔空收，4 段回声转写相似度 0.83-1.00；
# 8 句模拟用户插话（「等一下」「你们先别聊了」「我们聊聊别的吧」等）对 3 句角色原文最高 0.67。取两者之间。
ECHO_MATCH = 0.75
# 唤醒模型（rh/kws.py）的命中挂到哪句话上：检出时刻落在 [句子开始, 句子结束 + KWS_LATE_SEC] 里。
# 来源：/tmp/kws/report.md perf.log，词说完到检出最长 570 毫秒；句子结束本来就在说完后 END_SILENCE_MS（0.7 秒），
# 多留的这点是实现者定的余量。
KWS_LATE_SEC = 0.3
# 唤醒模型听到词时，查最近这么多秒角色在念的话里有没有这个词，有就当回声。来源：实现者定，一个唤醒词约 1 秒长，取两倍。
KWS_ECHO_SEC = 2.0
# 没挂到任何一句上的命中留这么久就扔。来源：实现者定，比最长一句 MAX_UTTER_MS（30 秒）长。
KWS_KEEP_SEC = 60.0
ASR_TIMEOUT = 60.0    # 单次转写请求超时秒数。来源：实现者定。
SYNTH_TIMEOUT = 60.0  # say -o / Qwen 合成一句的超时秒数。来源：实现者定，一到三句口语实测不到 1 秒（Qwen 热启动实测见提交信息）。
# 等 Qwen 常驻进程加载完模型的秒数。来源：实现者定；2026-10-18 实测 0.6B 8bit 加载 1.4 秒，留足冷盘余量。
QWEN_READY_TIMEOUT = 120.0

_PUNCT = re.compile(r"[\s\W_]+", re.UNICODE)


class ASR(Protocol):
    """返回文字，或 (文字, 置信度 0-1 / None)；只返回文字或置信度为 None 时不按置信度过滤。"""
    def transcribe(self, wav: bytes) -> str | tuple[str, float | None]: ...


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

    def transcribe(self, wav: bytes) -> tuple[str, float | None]:
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
            body = json.loads(r.read())
        # confidence：gateway 2026-10-18 新加的字段（speech-bridge 按字加权的平均置信度）；旧版没有就是 None。
        conf = body.get("confidence")
        return str(body.get("text", "")), (float(conf) if isinstance(conf, (int, float)) else None)


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


class QwenSynth:
    """本机 Qwen3-TTS：一个常驻子进程（rh/qwen_worker.py，用装了 mlx-audio 的 Python 跑），模型只加载一次。

    voices：角色的 voice（say 音色名）-> (Qwen speaker, 语气 instruct)。
    子进程出错、超时、退出都抛 RuntimeError 并杀掉它，下次 synth 再重启（外层 FallbackSynth 接住改用 say）。
    """

    def __init__(self, cmd: list[str], voices: dict[str, tuple[str, str]],
                 log: Callable[[str], None] = lambda s: print(s, flush=True),
                 timeout: float = SYNTH_TIMEOUT, ready_timeout: float = QWEN_READY_TIMEOUT):
        self.cmd, self.voices, self.log = cmd, voices, log
        self.timeout, self.ready_timeout = timeout, ready_timeout
        self._mu = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._lines: queue.Queue[str | None] = queue.Queue()
        self._closed = False

    def _read(self, timeout: float) -> dict:
        try:
            line = self._lines.get(timeout=timeout)
        except queue.Empty:
            raise RuntimeError(f"Qwen 合成进程 {timeout:g} 秒没回应") from None
        if line is None:
            raise RuntimeError("Qwen 合成进程退出了")
        return json.loads(line)

    def _kill(self) -> None:
        proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()

    def _ensure(self) -> subprocess.Popen:
        if self._proc is not None and self._proc.poll() is None:
            return self._proc
        self._kill()
        t0 = time.monotonic()
        proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
        self._proc, lines = proc, queue.Queue()
        self._lines = lines

        def pump() -> None:   # 读线程：每个子进程一个、一个队列，旧进程的残行进不了新队列
            for line in proc.stdout:
                lines.put(line)
            lines.put(None)
        threading.Thread(target=pump, daemon=True).start()
        try:
            r = self._read(self.ready_timeout)
            if not r.get("ready"):
                raise RuntimeError(f"Qwen 模型加载失败：{r.get('error')}")
        except BaseException:
            self._kill()
            raise
        self.log(f"[voice] Qwen3-TTS 常驻进程就绪，加载模型 {r.get('load_sec')} 秒（含启动共 {time.monotonic() - t0:.2f} 秒）")
        return proc

    def start(self) -> None:
        """主机启动时预先加载模型，第一句不用等。"""
        with self._mu:
            self._ensure()

    def synth(self, text: str, voice: str) -> bytes:
        speaker, instruct = self.voices[voice]   # 没配 Qwen 音色：KeyError，外层改用 say
        with self._mu:
            if self._closed:
                raise RuntimeError("Qwen 合成已关闭")
            proc = self._ensure()
            t0 = time.monotonic()
            try:
                proc.stdin.write(json.dumps({"text": text, "speaker": speaker, "instruct": instruct},
                                            ensure_ascii=False) + "\n")
                proc.stdin.flush()
                r = self._read(self.timeout)
            except BaseException:
                self._kill()
                raise
        if not r.get("ok"):
            raise RuntimeError(f"Qwen 合成失败：{r.get('error')}")
        wav = base64.b64decode(r["wav"])
        self.log(f"[voice] Qwen {speaker} 合成 {len(text)} 字用 {time.monotonic() - t0:.2f} 秒（音频 {wav_secs(wav):.2f} 秒）")
        return wav

    def close(self) -> None:
        """主机退出时调用：不等锁（合成中的那句可能占着），直接杀子进程，读的那边会收到“退出了”。"""
        self._closed = True
        proc = self._proc
        if proc is not None and proc.poll() is None:
            proc.kill()


class FallbackSynth:
    """先用 primary（Qwen）合成，出错就打日志改用 fallback（say -o）合成这一句。"""

    def __init__(self, primary: Synth, fallback: Synth, log: Callable[[str], None] = lambda s: print(s, flush=True)):
        self.primary, self.fallback, self.log = primary, fallback, log

    def synth(self, text: str, voice: str) -> bytes:
        try:
            return self.primary.synth(text, voice)
        except Exception as e:
            self.log(f"[voice] Qwen 合成出错，这句改用 say（音色 {voice}）：{e!r}")
            return self.fallback.synth(text, voice)

    def close(self) -> None:
        if hasattr(self.primary, "close"):
            self.primary.close()


class PlayTTS:
    """本机喇叭：先用 synth 合成整段，再用 afplay 播，阻塞到播完；打断事件一响就杀掉 afplay。"""

    def __init__(self, synth: Synth, cmd: str = "afplay"):
        self.synth, self.cmd = synth, cmd
        self._mu = threading.Lock()
        self._proc: subprocess.Popen | None = None
        self._closed = False

    def close(self) -> None:
        with self._mu:
            self._closed = True
            proc = self._proc
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait()

    def speak(self, text: str, voice: str, cancel: threading.Event, role: str = "") -> bool:
        wav = self.synth.synth(text, voice)
        if cancel.is_set():
            return False
        return self.play_wav(wav, cancel)

    def play_wav(self, wav: bytes, cancel: threading.Event) -> bool:
        """播已经合成好的 WAV（rh.vpio 播不了时借它播）。"""
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "a.wav"
            f.write_bytes(wav)
            with self._mu:
                if self._closed:
                    return False
                proc = subprocess.Popen([self.cmd, str(f)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self._proc = proc
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
            raise RuntimeError(f"{self.cmd} 退出码 {proc.returncode}")
        return True


def wav_secs(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav), "rb") as r:
        return r.getnframes() / r.getframerate()


# ---------- 切句 ----------
def rms(frame: bytes) -> float:
    a = array.array("h", frame)
    return math.sqrt(sum(x * x for x in a) / len(a)) if a else 0.0


class NoiseFloor:
    """持续估计底噪：最近 NOISE_WIN_SEC 秒帧 RMS 的低分位。开头用 NOISE_INIT 填满窗口，刚开麦就有人说话也不会把底噪估高。"""

    def __init__(self, init: float = NOISE_INIT):
        n = int(NOISE_WIN_SEC * 1000 / FRAME_MS)
        self._win: deque[float] = deque([init] * n, maxlen=n)
        self._k = max(0, min(n - 1, int(NOISE_PCTL * n)))
        self._every = max(1, 300 // FRAME_MS)   # 每约 0.3 秒重算一次分位，省 CPU；来源：实现者定
        self._tick = 0
        self.value = max(init, NOISE_MIN)

    def update(self, level: float) -> float:
        self._win.append(level)
        self._tick += 1
        if self._tick >= self._every:
            self._tick = 0
            self.value = max(sorted(self._win)[self._k], NOISE_MIN)
        return self.value


class Segmenter:
    """按音量切句：帧 RMS ≥ 底噪 × VOICE_RATIO 算有声，有声开始、静音够久结束。feed 每次一帧，返回切好的一句 PCM（或 None）。
    threshold 给定时用固定阈值（测试用）；默认按底噪自适应。"""

    def __init__(self, threshold: float | None = None):
        self.fixed = threshold
        self.noise = NoiseFloor()
        self.threshold = threshold if threshold is not None else self.noise.value * VOICE_RATIO
        self._pre: deque[bytes] = deque(maxlen=PREROLL_MS // FRAME_MS)
        self._cur: list[bytes] | None = None
        self._voiced = 0
        self._silent = 0

    def feed(self, frame: bytes) -> bytes | None:
        level = rms(frame)
        loud = level >= self.threshold
        floor = self.noise.update(level)
        if self.fixed is None:
            self.threshold = floor * VOICE_RATIO
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


def normalize(pcm: bytes, target: int = NORM_PEAK) -> bytes:
    """增益归一化：整句峰值放大到 target（远场人声峰值只有 150-300，放大后再送 ASR）；已经够响的不缩小。"""
    a = array.array("h", pcm)
    peak = max((abs(x) for x in a), default=0)
    if peak == 0 or peak >= target:
        return pcm
    g = target / peak
    return array.array("h", (max(-32768, min(32767, round(x * g))) for x in a)).tobytes()


def to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def echo_score(heard: str, spoken: str) -> float:
    """转出的字有多少（按顺序）出现在 spoken 里：0-1。去掉标点空白、英文不分大小写。"""
    h, sp = _PUNCT.sub("", heard).lower(), _PUNCT.sub("", spoken).lower()
    if not h or not sp:
        return 0.0
    m = difflib.SequenceMatcher(None, h, sp, autojunk=False)
    return sum(b.size for b in m.get_matching_blocks()) / len(h)


def is_echo(heard: str, spoken: Iterable[str]) -> bool:
    return any(echo_score(heard, t) >= ECHO_MATCH for t in spoken)


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
                 level_every: float = LEVEL_LOG_SEC,
                 playing: Callable[[float, float], list[str]] | None = None,
                 urgent: Callable[[str], bool] | None = None, timed: bool = False,
                 kws=None, on_kws: Callable[[object], None] | None = None,
                 muted: Callable[[], bool] | None = None, save_dir: Path | None = None):
        self.asr, self.on_text, self.sources, self.log = asr, on_text, sources, log
        # kws：本地唤醒模型（rh/kws.py Spotter，有 feed(帧) -> [Hit]、reset()）。每帧也喂给它，和切句、转文字并联：
        # 听到一个词先交给 on_kws(hit)（主机当场执行暂停、闭麦、开麦），再挂到时间上落在同一句里的那句话上，
        # 随 on_text(文字, 开始, 结束, kws=[Hit...]) 交给主机（名字由主机和转写结果合起来定谁回答，rh/host.py）。
        self.kws, self.on_kws = kws, on_kws
        self._hits: list = []
        self._hits_mu = threading.Lock()
        # muted()：闭麦中。在切出一句、放进队列时查（_stamp），不是轮到转写时才查：闭麦中说的话排在队里、开麦后才转完，
        # 也按闭麦中处理。闭麦中切出的句子照样转文字（唤醒模型漏了「开麦」时靠转文字补），但不存音频，
        # 交给主机时标 muted=True，主机只拿它认「开麦」，别的话丢掉、不进频道、不记原文（rh/host.py _on_voice）。
        # 来源：用户「我希望可以语音闭麦」；审稿 ~/.claude/reviews/rh-kws-union.md 第 3 条「闭麦期间，本地只能对「开麦」起反应，
        # 别的话一律不转文字、不进频道」；代码审查（f0f122f）：闭麦时不转写会导致只靠转文字时说了闭麦就再也叫不开。
        self.muted = muted
        # save_dir：每句切出的音频（送转写前、没放大）存一份 WAV，给真人调唤醒阈值用（README「本地唤醒模型」调参步骤）。
        # 来源：派活要求「为真人调参，把每句切出的音频存一份到 logs/ 下」（用户原话里没有，交付时列出）。
        self.save_dir = save_dir
        # urgent(文字)：这句里有停下的口令（「暂停」「闭麦」，rh/wake.py）。有就不看置信度、不当回声丢：
        # 2026-10-19 实测单说「闭麦」转成「必卖」「碧麦」置信度只有 0.33-0.38，低于 MIN_CONFIDENCE；
        # 用户在角色说话时喊停，转出的字里混着角色的声音，可能被当回声。只有角色自己正在念的话里也有这个口令时才照常过滤。
        self.urgent = urgent
        self.timed = timed   # True：on_text(文字, 开始, 结束)，主机用时间把一句话被停顿切开的后半句接上（rh/host.py）
        # playing(t0, t1)：这段时间（time.time()）里角色在念的文字（本机喇叭、设备都算）；转出的字像它就是回声。
        self.playing = playing
        self.level_every = level_every
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # 切好的句子排队交给转写线程：转写（可能好几秒）期间读麦线程照常读，后面的话不丢；单线程转写，顺序不乱。
        self._q: queue.Queue[tuple[bytes, float, float, bool] | None] = queue.Queue()

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
                if self.kws is not None:
                    self.kws.reset()
                for frame in frames:
                    if self._stop.is_set():
                        return
                    if self.kws is not None:
                        self._spot(frame)
                    peak = max(peak, rms(frame))
                    if time.monotonic() - since >= self.level_every:
                        self.log(f"[voice] 最近 {self.level_every:g} 秒音量峰值 {peak:.0f}（底噪 {seg.noise.value:.0f}，说话阈值 {seg.threshold:.0f}）")
                        peak, since = 0.0, time.monotonic()
                    pcm = seg.feed(frame)
                    if pcm is not None:
                        self._q.put(self._stamp(pcm))
                pcm = seg.flush()
                if pcm is not None:
                    self._q.put(self._stamp(pcm))
        except Exception as e:   # 收音坏了不拖垮主机：文字频道照常能用
            self.log(f"[voice] 收音停止：{e!r}")
        finally:
            self._q.put(None)
            worker.join()

    def _spot(self, frame: bytes) -> None:
        """读麦线程里：一帧喂给唤醒模型；听到词先查是不是角色自己正在念的（回声），不是就交给主机、记下来等那句转完。"""
        try:
            hits = self.kws.feed(frame)
        except Exception as e:   # 唤醒模型出错不拖垮收音：转文字那一路照常
            self.log(f"[kws] 出错，这一帧跳过：{e!r}")
            return
        for h in hits:
            if self.playing is not None:
                spoken = self.playing(h.t - KWS_ECHO_SEC, h.t)
                if any(h.term.heard_in(s) for s in spoken):
                    self.log(f"[kws] 听到「{h.label}」，角色正在念的话里也有它，当回声不算")
                    continue
            self.log(f"[kws] 听到「{h.label}」")
            if self.on_kws is not None:
                try:
                    self.on_kws(h)
                except Exception as e:
                    self.log(f"[kws] 处理「{h.label}」出错：{e!r}")
            with self._hits_mu:
                self._hits = [x for x in self._hits if h.t - x.t <= KWS_KEEP_SEC] + [h]

    def _take_hits(self, t0: float | None, t1: float | None) -> list:
        """取走检出时刻落在这句 [开始, 结束 + KWS_LATE_SEC] 里的唤醒模型命中。"""
        if self.kws is None or t0 is None or t1 is None:
            return []
        with self._hits_mu:
            mine = [h for h in self._hits if t0 <= h.t <= t1 + KWS_LATE_SEC]
            self._hits = [h for h in self._hits if h not in mine]
        return mine

    def _save(self, pcm: bytes, t1: float | None) -> str:
        if self.save_dir is None:
            return ""
        t = time.time() if t1 is None else t1
        try:
            self.save_dir.mkdir(parents=True, exist_ok=True)
            p = self.save_dir / f"{time.strftime('%H%M%S', time.localtime(t))}-{int(t * 1000) % 1000:03d}.wav"
            p.write_bytes(to_wav(pcm))
            return f"，音频 {p.name}"
        except OSError as e:
            self.log(f"[voice] 存这句音频失败：{e!r}")
            return ""

    def _stamp(self, pcm: bytes) -> tuple[bytes, float, float, bool]:
        """切出一句的时刻就是它的结束时间（麦克风帧是实时来的），往前推它的时长是开始时间；同时记下这时是否闭麦。"""
        t1 = time.time()
        return pcm, t1 - len(pcm) / 2 / SAMPLE_RATE, t1, self.muted is not None and self.muted()

    def _asr_loop(self) -> None:
        while (item := self._q.get()) is not None:
            if self._stop.is_set():
                return
            try:
                self.handle(*item)
            except Exception as e:   # on_text 出错（比如退出时事件循环已关）不能让转写线程死掉
                self.log(f"[voice] 处理一句话出错：{e!r}")

    def handle(self, pcm: bytes, t0: float | None = None, t1: float | None = None, muted: bool | None = None) -> None:
        """muted：这句切出时是否闭麦（_stamp 记的）；直接调用没给时按现在的状态。"""
        secs = len(pcm) / 2 / SAMPLE_RATE
        if muted is None:
            muted = self.muted is not None and self.muted()
        if muted:
            self._handle_muted(pcm, secs, t0, t1)
            return
        saved = self._save(pcm, t1)
        asr_t0 = time.time()
        try:
            got = self.asr.transcribe(to_wav(normalize(pcm)))
        except Exception as e:
            self.log(f"[voice] 转写失败（{secs:.1f} 秒音频{saved}）：{e!r}")
            got = ("", None)
        text, conf = (got, None) if isinstance(got, str) else got
        text = text.strip()
        hits = self._take_hits(t0, t1)   # 转写完再取：词说完到唤醒模型检出约半秒，句尾的词这时也到了
        heard = "、".join(h.label for h in hits)
        if any(h.action == "say" and h.done is None for h in hits):   # "say"：rh/wake.py SAY（这里不导入 wake）
            # 唤醒模型在这句里听到了名字（或没当场执行的口令）：任一认出即生效，不按置信度、太短丢掉。
            # 转出的字像回声时不要这些字（名字已在 _spot 里查过不是回声），主机用听到的词当这句话。
            if text and self.playing is not None and t0 is not None and t1 is not None and is_echo(text, self.playing(t0, t1)):
                text = ""
            self.log(f"[voice] 听到（{secs:.1f} 秒音频{saved}，唤醒模型「{heard}」，转写 {time.time() - asr_t0:.2f} 秒，置信度 "
                     f"{'无' if conf is None else f'{conf:.2f}'}）：{text}")
            self._emit(text, t0, t1, hits)
            return
        spoken = None
        if self.urgent is not None and text and self.urgent(text):
            spoken = self.playing(t0, t1) if self.playing is not None and t0 is not None and t1 is not None else []
            if not any(self.urgent(s) for s in spoken):
                self.log(f"[voice] 听到口令（{secs:.1f} 秒音频{saved}，置信度 {'无' if conf is None else f'{conf:.2f}'}）：{text}")
                self._emit(text, t0, t1, hits)
                return
        if conf is not None and conf < MIN_CONFIDENCE and text:
            self.log(f"[voice] 丢掉 {secs:.1f} 秒音频{saved}，转出「{text}」置信度 {conf:.2f} 低于 {MIN_CONFIDENCE:g}，当噪声")
            return
        if not worth_sending(text):
            self.log(f"[voice] 丢掉 {secs:.1f} 秒音频{saved}，转出「{text}」太短或为空")
            return
        if self.playing is not None and t0 is not None and t1 is not None:
            if spoken is None:
                spoken = self.playing(t0, t1)
            if is_echo(text, spoken):
                self.log(f"[voice] 丢掉 {secs:.1f} 秒音频{saved}，转出「{text}」和角色正在念的话相似，当回声")
                return
        self.log(f"[voice] 听到（{secs:.1f} 秒音频{saved}，转写 {time.time() - asr_t0:.2f} 秒，置信度 "
                 f"{'无' if conf is None else f'{conf:.2f}'}）：{text}")
        self._emit(text, t0, t1, hits)

    def _handle_muted(self, pcm: bytes, secs: float, t0: float | None, t1: float | None) -> None:
        """闭麦中切出的一句：转文字只为认口令（开麦、暂停、闭麦）。不存音频、不看置信度和长短（开麦两个字常被转得很短、置信度低），
        像回声的丢掉；日志不记原文（闭麦中说的是私话）。交给主机时标 muted=True，由主机只认这几个口令。"""
        try:
            got = self.asr.transcribe(to_wav(normalize(pcm)))
        except Exception as e:
            self.log(f"[voice] 闭麦中，转写失败（{secs:.1f} 秒音频）：{e!r}")
            got = ("", None)
        text = (got if isinstance(got, str) else got[0]).strip()
        hits = self._take_hits(t0, t1)
        if text and self.playing is not None and t0 is not None and t1 is not None and is_echo(text, self.playing(t0, t1)):
            text = ""
        if not text and not hits:
            self.log(f"[voice] 闭麦中，{secs:.1f} 秒音频没转出字，丢掉")
            return
        self.log(f"[voice] 闭麦中，{secs:.1f} 秒音频只用来认开麦、暂停、闭麦（不存音频、不进频道）")
        if self.timed:
            self._emit(text, t0, t1, hits, muted=True)
        # 不带时间的 on_text 没法标闭麦：直接丢掉，免得私话进频道

    def _emit(self, text: str, t0: float | None, t1: float | None, hits: list | None = None, muted: bool = False) -> None:
        if muted and self.kws is not None:
            self.on_text(text, t0, t1, kws=hits or [], muted=True)
        elif muted:
            self.on_text(text, t0, t1, muted=True)
        elif self.timed and self.kws is not None:
            self.on_text(text, t0, t1, kws=hits or [])
        elif self.timed:
            self.on_text(text, t0, t1)
        else:
            self.on_text(text)
