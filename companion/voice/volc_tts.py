"""豆包语音（火山引擎）云端合成，和本地 Qwen3-TTS 并存。

角色的 tts_voice 若是火山的音色 ID（如 zh_female_sajiaoxuemei_uranus_bigtts），走这里；
其他（vivian、serena……）照旧走本地 Qwen3-TTS。凭据放在私密 JSON 里，路径由配置项
tts_volc_credentials 指定，文件里只读 access_token（新版控制台的 API Key）。

接口：https://openspeech.bytedance.com/api/v3/tts/unidirectional（HTTP 分块流式，
每行一个 JSON，data 是 base64 的 PCM）。资源 ID seed-tts-2.0 对应 *_uranus_bigtts 音色。
"""
from __future__ import annotations

import base64
from collections.abc import Callable
import io
import json
import re
import threading
from pathlib import Path
from uuid import uuid4
import wave

import httpx

ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
RATE = 24000
# 攒够这么多 PCM 再回调一次，和本地 Qwen 每块约 0.64 秒的节奏一致。
CHUNK_SECONDS = 0.6
VOLC_VOICE = re.compile(r'^[a-z]{2}_[a-z0-9_]+_(bigtts|tts)$')


def is_volc_voice(voice: str | None) -> bool:
    return bool(voice) and bool(VOLC_VOICE.fullmatch(voice))


def resource_for(voice: str) -> str:
    # 豆包语音合成 2.0 的音色名带 _uranus_；其余按 1.0 资源。
    return 'seed-tts-2.0' if '_uranus_' in voice else 'seed-tts-1.0'


def wav_bytes(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return buf.getvalue()


class VolcTTS:
    def __init__(self, credentials: str, timeout: float = 30.0, client: httpx.Client | None = None,
                 default_voice: str | None = None):
        if default_voice is not None and not is_volc_voice(default_voice):
            raise ValueError('默认音色必须是豆包音色。')
        self.default_voice = default_voice
        data = json.loads(Path(credentials).expanduser().read_text(encoding='utf-8'))
        key = data.get('access_token', '') if isinstance(data, dict) else ''
        if not isinstance(key, str) or not key.strip():
            raise ValueError('火山语音凭据缺少 access_token。')
        self._key = key.strip()
        self.lock = threading.Lock()
        self.http = client or httpx.Client(timeout=timeout, trust_env=False)

    def close(self):
        self.http.close()

    def synthesize(self, text: str, *, voice: str | None = None) -> bytes:
        return self._synthesize(text, None, voice=voice)

    def synthesize_stream(self, text: str, on_chunk: Callable[[bytes], None], *, voice: str | None = None) -> bytes:
        if not callable(on_chunk):
            raise TypeError('on_chunk 必须可调用。')
        return self._synthesize(text, on_chunk, voice=voice)

    def _synthesize(self, text, on_chunk, *, voice):
        voice = voice if voice is not None else self.default_voice
        if not is_volc_voice(voice):
            raise ValueError('不是火山语音的音色 ID。')
        headers = {'X-Api-Key': self._key, 'X-Api-Resource-Id': resource_for(voice),
                   'X-Api-Request-Id': str(uuid4())}
        body = {'user': {'uid': 'conest'},
                'req_params': {'text': text, 'speaker': voice,
                               'audio_params': {'format': 'pcm', 'sample_rate': RATE}}}
        whole, pending = bytearray(), bytearray()
        step = int(RATE * CHUNK_SECONDS) * 2
        with self.lock, self.http.stream('POST', ENDPOINT, headers=headers, json=body) as r:
            if r.status_code != 200:
                raise RuntimeError(f'火山语音合成失败 HTTP {r.status_code}')
            for line in r.iter_lines():
                if not line.strip():
                    continue
                d = json.loads(line)
                code = d.get('code', 0)
                if code not in (0, 20000000):
                    raise RuntimeError(f'火山语音合成失败：{code} {d.get("message", "")[:80]}')
                if d.get('data'):
                    pcm = base64.b64decode(d['data'])
                    whole += pcm
                    pending += pcm
                    while on_chunk and len(pending) >= step:
                        on_chunk(wav_bytes(bytes(pending[:step])))
                        del pending[:step]
        if not whole:
            raise RuntimeError('火山语音没有返回音频。')
        if on_chunk and pending:
            on_chunk(wav_bytes(bytes(pending)))
        return wav_bytes(bytes(whole))


class HybridTTS:
    """按音色 ID 分流：火山音色走云端，其余走本地。"""

    def __init__(self, local, volc: VolcTTS):
        self.local, self.volc = local, volc

    def _pick(self, voice):
        return self.volc if is_volc_voice(voice) else self.local

    def close(self):
        for tts in (self.local, self.volc):
            if tts is not None:
                tts.close()

    def synthesize(self, text: str, *, voice: str | None = None) -> bytes:
        tts = self._pick(voice)
        if tts is None:
            raise RuntimeError('本地合成未启用。')
        return tts.synthesize(text, **({'voice': voice} if voice is not None else {}))

    def synthesize_stream(self, text, on_chunk, *, voice=None):
        tts = self._pick(voice)
        if tts is None:
            raise RuntimeError('本地合成未启用。')
        return tts.synthesize_stream(text, on_chunk, **({'voice': voice} if voice is not None else {}))
