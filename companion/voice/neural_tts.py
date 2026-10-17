"""Persistent local TTS worker with bounded, request-correlated IPC."""
import base64
from collections.abc import Callable
import io
import json
import math
import os
from pathlib import Path
import select
import subprocess
import tempfile
import threading
import time
import wave
from uuid import uuid4

from .speech import _cache_directory, _pcm_samples, _validate_tts_text
from .roles import QWEN_VOICES
from .tts_worker import (MAX_CHUNKS, MAX_FRAME_BYTES, MAX_SAMPLES,
                         MAX_WAV_BYTES, MAX_WIRE_BYTES, wav_bytes)


class NeuralTTS:
    def __init__(self, python: str, model_path: str, voice: str = 'uncle_fu', timeout: float = 120):
        # Resolving a venv's interpreter symlink loses its pyvenv.cfg context.
        interpreter = Path(python).expanduser().absolute()
        if not interpreter.is_file():
            raise ValueError('本地语音解释器不存在。')
        self.python = str(interpreter)
        self.model = str(Path(model_path).expanduser().resolve(strict=True))
        if not (Path(self.model) / 'model.safetensors').is_file():
            raise ValueError('本地自然音色模型不完整。')
        if voice not in QWEN_VOICES:
            raise ValueError('本地音色名称不受支持。')
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('合成超时必须为有限正数。')
        self.voice, self.timeout = voice, timeout
        self.lock = threading.Lock()
        self.process = None
        self.last_metrics = {}
        self._pending = bytearray()

    def _start(self):
        if self.process and self.process.poll() is None:
            return
        if self.process:
            self._stop()
        cache = _cache_directory()
        fd = os.open(cache / 'neural-worker.log', os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'ab') as log:
            self.process = subprocess.Popen(
                [self.python, '-u', str(Path(__file__).with_name('tts_worker.py')), self.model],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log,
                env={**os.environ, 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'},
            )

    def _stop(self):
        process, self.process = self.process, None
        self._pending.clear()
        if process:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            process.stdin.close()
            process.stdout.close()

    def close(self):
        with self.lock:
            self._stop()

    def synthesize(self, text: str, *, voice: str | None = None) -> bytes:
        return self._synthesize(text, None, voice=voice)

    def synthesize_stream(
        self, text: str, on_chunk: Callable[[bytes], None], *, voice: str | None = None,
    ) -> bytes:
        """Callbacks run under the worker lock; exceptions abort without retry.

        The deadline includes callback time, but cannot interrupt a callback.
        Callbacks must return promptly and must not reenter synthesize/close.
        """
        if not callable(on_chunk):
            raise TypeError('on_chunk 必须可调用。')
        return self._synthesize(text, on_chunk, voice=voice)

    def _read_frame(self, deadline):
        # Never mix buffered readline with select/os.read: readline can hide
        # several frames in Python while the OS pipe appears empty. Keep every
        # unread byte here, and consume complete frames before waiting again.
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('worker timeout')
            end = self._pending.find(b'\n')
            if end >= 0:
                if end > MAX_FRAME_BYTES:
                    raise ValueError('worker frame too large')
                line = bytes(self._pending[:end])
                del self._pending[:end + 1]
                frame = json.loads(line)
                if not isinstance(frame, dict):
                    raise ValueError('invalid worker frame')
                return frame, end + 1
            if len(self._pending) > MAX_FRAME_BYTES:
                raise ValueError('worker frame too large')
            if not select.select([self.process.stdout], [], [], remaining)[0]:
                raise TimeoutError('worker timeout')
            part = os.read(self.process.stdout.fileno(), 65536)
            if not part:
                raise ValueError('worker closed before completion')
            self._pending.extend(part)

    def _synthesize(self, text, on_chunk, *, voice):
        _validate_tts_text(text)
        selected_voice = self.voice if voice is None else voice
        if selected_voice not in QWEN_VOICES:
            raise ValueError('本地音色名称不受支持。')
        with self.lock:
            self.last_metrics = {}
            callback_active = False
            try:
                started = time.monotonic()
                deadline = started + self.timeout
                self._start()
                if self._pending or select.select([self.process.stdout], [], [], 0)[0]:
                    raise ValueError('unsolicited worker response')
                request_id = str(uuid4())
                fd, path = tempfile.mkstemp(prefix='neural-', suffix='.wav', dir=_cache_directory())
                os.close(fd)
                request = {'id': request_id, 'text': text, 'voice': selected_voice,
                           'output': path, 'stream': on_chunk is not None}
                self.process.stdin.write((json.dumps(request)+'\n').encode())
                self.process.stdin.flush()
                count = total_bytes = wire_bytes = 0
                pcm = bytearray()
                first_chunk_seconds = None
                while True:
                    result, size = self._read_frame(deadline)
                    wire_bytes += size
                    if wire_bytes > MAX_WIRE_BYTES or result.get('id') != request_id:
                        raise ValueError('invalid worker response')
                    if result.get('ok', True) is not True:
                        raise ValueError('worker failed')
                    if on_chunk is None:
                        if result.get('ok') is not True or result.get('type') not in (None, 'done'):
                            raise ValueError('worker failed')
                        with open(path, 'rb') as f:
                            audio = f.read(MAX_WAV_BYTES + 1)
                        _pcm_samples(audio, rate=24000, max_bytes=MAX_WAV_BYTES, max_seconds=300)
                        break
                    if type(result.get('seq')) is not int or result['seq'] != count:
                        raise ValueError('worker sequence mismatch')
                    if result.get('type') == 'chunk':
                        if count >= MAX_CHUNKS or not isinstance(result.get('wav'), str):
                            raise ValueError('invalid worker chunk')
                        chunk = base64.b64decode(result['wav'], validate=True)
                        total_bytes += len(chunk)
                        if total_bytes > MAX_WAV_BYTES:
                            raise ValueError('worker audio too large')
                        _pcm_samples(chunk, rate=24000, max_bytes=MAX_WAV_BYTES, max_seconds=300)
                        with wave.open(io.BytesIO(chunk), 'rb') as reader:
                            chunk_pcm = reader.readframes(reader.getnframes())
                        if len(pcm) + len(chunk_pcm) > MAX_SAMPLES * 2:
                            raise ValueError('worker audio too long')
                        pcm.extend(chunk_pcm)
                        count += 1
                        if first_chunk_seconds is None:
                            first_chunk_seconds = time.monotonic() - started
                        if time.monotonic() >= deadline:
                            raise TimeoutError('worker timeout')
                        callback_active = True
                        on_chunk(chunk)
                        callback_active = False
                        continue
                    if (result.get('type') != 'done' or result.get('ok') is not True
                            or not count or type(result.get('total_bytes')) is not int
                            or result['total_bytes'] != total_bytes
                            or type(result.get('samples')) is not int
                            or result['samples'] != len(pcm) // 2):
                        raise ValueError('worker failed or incomplete')
                    audio = wav_bytes(pcm)
                    with open(path, 'wb') as f:
                        f.write(audio)
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError('worker timeout')
                if self._pending:
                    raise ValueError('trailing worker response')
                self.last_metrics = {**result, 'path': path,
                                     'first_chunk_seconds': first_chunk_seconds,
                                     'seconds': time.monotonic() - started}
                return audio
            except BaseException as exc:
                self._stop()
                if callback_active or not isinstance(exc, Exception):
                    raise
                raise RuntimeError('本机自然语音合成失败或超时；文字回答仍然保留。') from exc
