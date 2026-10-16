"""Persistent local TTS worker with bounded, request-correlated IPC."""
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import threading
import time
from uuid import uuid4

from .speech import _cache_directory, _pcm_samples
from .roles import QWEN_VOICES


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
        self.voice, self.timeout = voice, timeout
        self.lock = threading.Lock()
        self.process = None
        self.last_metrics = {}

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
        if not isinstance(text, str) or not text.strip() or len(text) > 500:
            raise ValueError('待合成文本长度必须为1至500字。')
        selected_voice = self.voice if voice is None else voice
        if selected_voice not in QWEN_VOICES:
            raise ValueError('本地音色名称不受支持。')
        with self.lock:
            try:
                self._start()
                request_id = str(uuid4())
                fd, path = tempfile.mkstemp(prefix='neural-', suffix='.wav', dir=_cache_directory())
                os.close(fd)
                request = {'id': request_id, 'text': text, 'voice': selected_voice, 'output': path}
                self.process.stdin.write((json.dumps(request)+'\n').encode())
                self.process.stdin.flush()
                deadline, raw = time.monotonic()+self.timeout, b''
                while b'\n' not in raw:
                    remaining = deadline-time.monotonic()
                    if remaining <= 0 or not select.select([self.process.stdout], [], [], remaining)[0]:
                        raise TimeoutError('worker timeout')
                    part = os.read(self.process.stdout.fileno(), 4096)
                    if not part or len(raw)+len(part) > 8192:
                        raise ValueError('invalid worker response')
                    raw += part
                result = json.loads(raw)
                if result.get('id') != request_id or not result.get('ok'):
                    raise ValueError('worker failed')
                with open(path, 'rb') as f:
                    audio = f.read(15_000_001)
                _pcm_samples(audio, rate=24000, max_bytes=15_000_000, max_seconds=300)
                self.last_metrics = {**result, 'path': path}
                return audio
            except (OSError, ValueError, subprocess.SubprocessError) as exc:
                self._stop()
                raise RuntimeError('本机自然语音合成失败或超时；文字回答仍然保留。') from exc
