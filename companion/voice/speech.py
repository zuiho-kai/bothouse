"""Offline, blocking ASR/TTS for the single-speaker Mac prototype.

Install requirements-voice.txt separately into the project virtual environment.
Model paths may name an MLX model directory or an existing HF cache root with
refs/main. No repository ID or model download is accepted. MLX imports and model
loading happen on the first valid transcription, behind a process-wide lock.

say output (including failed attempts) stays in ~/Library/Caches/yijiazi-voice,
a private directory. Files are deliberately never automatically deleted.
These methods block: web adapters should invoke them in a worker thread.
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import Callable
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import tempfile
import threading
import time

from . import asr_diag

logger = logging.getLogger("uvicorn.error")  # same sink as the other ASR logs (server.log)

import numpy as np


MAX_WAV_BYTES = 1_000_000
MAX_AUDIO_SECONDS = 30
MAX_TEXT_CHARS = 500
TTS_TIMEOUT_SECONDS = 180
_MAX_TTS_BYTES = 15_000_000
_ASR_LOCK = threading.Lock()  # mlx_whisper.ModelHolder is process-global.
_TTS_LOCK = threading.Lock()


def _validate_tts_text(text: str) -> bytes:
    """One validation contract for blocking and streaming synthesis."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("待合成文本不能为空。")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"待合成文本不得超过 {MAX_TEXT_CHARS} 个字符，请分段播放。")
    if any(ord(c) < 32 and c not in "\n\t" for c in text):
        raise ValueError("待合成文本含不支持的控制字符。")
    if "[[" in text or "]]" in text:
        raise ValueError("待合成文本不允许包含 say 的内嵌控制指令。")
    try:
        return text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ValueError("待合成文本不是有效的 UTF-8 文本。") from exc


def _resolve_model_path(model_path: str) -> Path:
    if not isinstance(model_path, str) or not model_path.strip():
        raise ValueError("model_path 必须是已存在的本地 MLX 模型目录。")
    try:
        path = Path(model_path).expanduser().resolve(strict=True)
        if not path.is_dir():
            raise ValueError("model_path 必须是目录。")
        # Hugging Face's cache root is not itself a loadable model directory.
        if not (path / "config.json").is_file() and (path / "refs/main").is_file():
            revision = (path / "refs/main").read_text(encoding="utf-8").strip()
            if not re.fullmatch(r"[0-9a-f]{40,64}", revision):
                raise ValueError("本地模型缓存 refs/main 格式无效。")
            path = (path / "snapshots" / revision).resolve(strict=True)
        if not (path / "config.json").is_file():
            raise ValueError("本地模型缺少 config.json。")
        if not any((path / name).is_file() for name in
                   ("weights.safetensors", "weights.npz")):
            raise ValueError("本地模型缺少 weights.safetensors 或 weights.npz。")
        return path
    except (OSError, RuntimeError) as exc:
        raise ValueError("本地模型不存在或无法读取；不会自动下载，请提供完整模型目录。") from exc


def _pcm_samples(data: bytes, *, rate: int, max_bytes: int, max_seconds: int) -> np.ndarray:
    """Validate the whole RIFF envelope, then return normalized mono float32."""
    if not isinstance(data, bytes):
        raise ValueError("音频必须是 WAV bytes。")
    if not data:
        raise ValueError("音频为空。")
    if len(data) > max_bytes:
        raise ValueError(f"WAV 超过大小上限 {max_bytes} 字节。")
    invalid = f"音频必须是完整的 {rate}Hz 单声道 16bit PCM WAV。"
    if (len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE"
            or struct.unpack_from("<I", data, 4)[0] != len(data) - 8):
        raise ValueError(invalid)
    offset, fmt, pcm = 12, None, None
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError(invalid)
        kind, size = struct.unpack_from("<4sI", data, offset)
        start = offset + 8
        end = start + size
        offset = end + (size & 1)
        if offset > len(data):
            raise ValueError(invalid)
        if kind == b"fmt ":
            # Accept classic PCM with either no extension or an empty one.
            if fmt is not None or size not in (16, 18):
                raise ValueError(invalid)
            fmt = struct.unpack_from("<HHIIHH", data, start)
            if fmt != (1, 1, rate, rate * 2, 2, 16):
                raise ValueError(invalid)
            if size == 18 and data[start + 16:end] != b"\x00\x00":
                raise ValueError(invalid)
        elif kind == b"data":
            if fmt is None or pcm is not None or size % 2:
                raise ValueError(invalid)
            pcm = data[start:end]
    if fmt is None or pcm is None:
        raise ValueError(invalid)
    if not pcm:
        raise ValueError("音频没有采样数据。")
    if len(pcm) > rate * 2 * max_seconds:
        raise ValueError(f"音频不得超过 {max_seconds} 秒。")
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def _cache_directory() -> Path:
    path = Path.home() / "Library" / "Caches" / "yijiazi-voice"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise OSError(f"语音缓存目录必须由当前用户持有、权限为 0700 且不是符号链接：{path}")
    return path


REMOTE_ASR_BACKOFF_SECONDS = 60


def _remote_transcribe(url: str, wav_bytes: bytes, timeout: float) -> tuple[str, float | None]:
    """POST the WAV to a remote recognizer; returns (text, remote inference ms). Never uses a proxy."""
    import json
    import urllib.request

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(url, data=wav_bytes, headers={"Content-Type": "audio/wav"})
    with opener.open(request, timeout=timeout) as response:
        payload = json.loads(response.read(64 * 1024))
    text = payload.get("text")
    if not isinstance(text, str):
        raise TypeError("远程识别没有返回文本")
    inference = payload.get("inference_ms")
    return text, float(inference) if isinstance(inference, (int, float)) else None


class Speech:
    def __init__(self, model_path: str, voice: str = "Tingting", tts=None, *,
                 remote_url: str = "", remote_timeout: float = 3.0):
        self.remote_url = remote_url
        self.remote_timeout = remote_timeout
        self._remote_down_until = 0.0
        self.model_path = str(_resolve_model_path(model_path))
        if not isinstance(voice, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9 _-]{0,79}", voice):
            raise ValueError("音色名称无效，请使用已安装的系统音色，例如 Tingting。")
        self.voice = voice
        self._transcribe_fn = None
        self._asr_warmed = False
        self.tts = tts

    def close(self):
        if self.tts is not None:
            self.tts.close()

    def _try_remote(self, wav_bytes: bytes) -> tuple[str, float | None] | None:
        """Remote recognition, or None to fall back to local. A failure pauses remote tries
        for a minute so each turn does not pay the timeout again."""
        if time.monotonic() < self._remote_down_until:
            return None
        try:
            text, inference = _remote_transcribe(self.remote_url, wav_bytes, self.remote_timeout)
        except Exception as exc:
            self._remote_down_until = time.monotonic() + REMOTE_ASR_BACKOFF_SECONDS
            logger.warning("远程识别失败，%d 秒内改用本机识别：%s", REMOTE_ASR_BACKOFF_SECONDS, type(exc).__name__)
            return None
        if not text.strip():
            return None  # let the local model decide; an empty remote result is not authoritative
        return text, inference

    def transcribe(self, wav_bytes: bytes) -> str:
        return self.transcribe_timed(wav_bytes)[0]

    def warmup(self) -> dict:
        """Initialize local ASR before serving; discard all synthetic output.

        Use the same process-wide lock and model cache as real recognition.
        One silent second runs the encoder/decoder without a microphone, TTS,
        bridge request, or temperature fallback. Normal decoding is unchanged.
        """
        started = time.monotonic()
        with _ASR_LOCK:
            path = str(_resolve_model_path(self.model_path))
            if self._asr_warmed:
                return {"cached": True, "total_ms": 0}
            if self._transcribe_fn is None:
                self._transcribe_fn = importlib.import_module("mlx_whisper").transcribe
            self._transcribe_fn(
                np.zeros(16000, dtype=np.float32), path_or_hf_repo=path,
                language="zh", task="transcribe", verbose=None,
                condition_on_previous_text=False, temperature=0.0, sample_len=1,
            )
            self._asr_warmed = True
        return {"cached": False, "total_ms": round((time.monotonic() - started) * 1000)}

    def transcribe_timed(self, wav_bytes: bytes) -> tuple[str, dict]:
        # Per-call timings, never a shared "last result" which races requests.
        # 只记录诊断：默认关闭，VOICE_ASR_DIAG 指向文件时才采样，且绝不影响返回值。
        diag_before, diag_idle = asr_diag.begin()
        started = time.monotonic()
        samples = _pcm_samples(wav_bytes, rate=16000, max_bytes=MAX_WAV_BYTES,
                               max_seconds=MAX_AUDIO_SECONDS)
        # Remove DC for the energy test. A constant offset is not audible speech.
        centered = samples - samples.mean()
        rms = float(np.sqrt(np.mean(centered * centered)))
        active_samples = int(np.count_nonzero(np.abs(centered) >= 0.003))
        if rms < 0.001 or active_samples < 160:  # -60 dBFS / 10 ms activity floor
            raise ValueError("音频为空、静音或音量过低，请靠近麦克风后重试。")
        queued = time.monotonic()
        remote = self._try_remote(wav_bytes) if self.remote_url else None
        if remote is not None:
            text, remote_inference = remote
            ended = time.monotonic()
            timings = {
                'audio_ms': round(len(samples) / 16),
                'validation_ms': round((queued-started)*1000),
                'queue_ms': 0,
                'setup_ms': 0,
                'inference_ms': round((ended-queued)*1000),
                'total_ms': round((ended-started)*1000),
                'remote_ms': round((ended-queued)*1000),
            }
            if remote_inference is not None:
                timings['remote_inference_ms'] = round(remote_inference)
            asr_diag.finish(timings, diag_before, diag_idle)
            return text.strip(), timings
        with _ASR_LOCK:
            acquired = time.monotonic()
            # Recheck even after warm-up: upstream downloads when a path is missing.
            path = str(_resolve_model_path(self.model_path))
            try:
                if self._transcribe_fn is None:
                    self._transcribe_fn = importlib.import_module("mlx_whisper").transcribe
                infer_started = time.monotonic()
                result = self._transcribe_fn(
                    samples, path_or_hf_repo=path, language="zh", task="transcribe",
                    verbose=None, condition_on_previous_text=False,
                )
                text = result["text"]
                if not isinstance(text, str):
                    raise TypeError("模型返回的 text 不是字符串")
            except ImportError as exc:
                raise RuntimeError("缺少 MLX 语音依赖，请在项目虚拟环境安装 requirements-voice.txt。") from exc
            except Exception as exc:
                # Preserve the cause for local debugging, never expose it in the UI.
                raise RuntimeError("本地语音识别失败，请重试或检查本地模型。") from exc
        if not text.strip():
            raise ValueError("未识别到可用语音，请重新录音。")
        ended = time.monotonic()
        timings = {
            'audio_ms': round(len(samples) / 16),
            'validation_ms': round((queued-started)*1000),
            'queue_ms': round((acquired-queued)*1000),
            'setup_ms': round((infer_started-acquired)*1000),
            'inference_ms': round((ended-infer_started)*1000),
            'total_ms': round((ended-started)*1000),
        }
        asr_diag.finish(timings, diag_before, diag_idle)
        return text.strip(), timings

    def synthesize(self, text: str, *, voice: str | None = None) -> bytes:
        encoded = _validate_tts_text(text)
        if self.tts is not None:
            return self.tts.synthesize(text, **({'voice': voice} if voice is not None else {}))
        if voice is not None:
            raise ValueError('逐伙伴自然音色需要本地 Qwen 后端。')
        with _TTS_LOCK:
            try:
                cache = _cache_directory()
                fd, filename = tempfile.mkstemp(prefix="say-", suffix=".wav", dir=cache)
                os.close(fd)  # mkstemp creates a private 0600 ordinary file.
                subprocess.run(
                    ["/usr/bin/say", "-v", self.voice, "-o", filename,
                     "--file-format=WAVE", "--data-format=LEI16@24000",
                     "--channels=1", "-f", "-"],
                    input=encoded, shell=False, check=True,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    timeout=TTS_TIMEOUT_SECONDS,
                )
                with open(filename, "rb") as audio_file:
                    audio = audio_file.read(_MAX_TTS_BYTES + 1)
                _pcm_samples(audio, rate=24000, max_bytes=_MAX_TTS_BYTES, max_seconds=300)
                return audio
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError("系统语音合成超时，请缩短文本后重试；缓存 WAV 已保留。") from exc
            except subprocess.CalledProcessError as exc:
                # Do not echo stdout/stderr, which can contain the user's text.
                raise RuntimeError(
                    f"系统 say 合成失败（退出码 {exc.returncode}），请检查音色 {self.voice}；缓存 WAV 已保留。"
                ) from exc
            except (OSError, ValueError) as exc:
                raise RuntimeError("系统语音合成或 WAV 读取失败，请检查本地音色及缓存目录。") from exc

    def synthesize_stream(
        self, text: str, on_chunk: Callable[[bytes], None], *, voice: str | None = None,
    ) -> bytes:
        """Deliver WAV chunks synchronously; return a complete WAV only on success.

        Callbacks must return promptly and must not reenter synthesis/close on
        this backend. A later exception invalidates completion, even if audio
        has already been delivered. Blocking backends emit one validated chunk.
        """
        _validate_tts_text(text)
        if not callable(on_chunk):
            raise TypeError("on_chunk 必须可调用。")
        stream = getattr(self.tts, 'synthesize_stream', None)
        if callable(stream):
            return stream(text, on_chunk, **({'voice': voice} if voice is not None else {}))
        audio = self.synthesize(text, **({'voice': voice} if voice is not None else {}))
        _pcm_samples(audio, rate=24000, max_bytes=_MAX_TTS_BYTES, max_seconds=300)
        on_chunk(audio)
        return audio
