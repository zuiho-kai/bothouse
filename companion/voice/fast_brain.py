"""Small-brain answers for companion/auto mode, streamed into existing TTS.

The small brain never answers from tools and never invents facts. It reads the
pre-generated memory pack, streams text from a configurable provider, and feeds
complete sentences straight into ``SentenceSpeech`` so the first sentence can be
synthesised before the rest of the answer exists.

Failure is explicit: ``FastBrainUnavailable`` means "nothing was spoken yet, the
caller may fall back to the big brain". Once any audio has been published the
exception carries ``partial=True`` and the caller must not re-answer.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import AsyncIterator

from fastapi import HTTPException

from .bridge import BridgeError
from .sentence_stream import SentenceSpeech


DEFAULT_INSTRUCTION = (
    '你是主人的陪伴语音伙伴。用口语、简短中文回答，一次最多两三句。'
    '只回答你知道的；不要编造事实，不要假装调用工具或已执行操作。'
    '不知道就说不知道，并建议切到工作模式。'
)
DEFAULT_FIRST_TOKEN_TIMEOUT_S = 0.8  # 研究笔记 §12：首字 800ms 超时回退大脑
MAX_ANSWER_CHARS = 450  # 沿用现有语音朗读 450 字上限（app.spoken_answer）


class FastBrainUnavailable(Exception):
    """Provider was not configured, timed out, or failed before speaking."""

    def __init__(self, message: str, *, partial: bool = False):
        super().__init__(message)
        self.partial = partial


class MockProvider:
    """Deterministic offline provider; records prompts for assertions."""

    def __init__(self, reply: str = '我在呢，慢慢说。', chunk: str = '', fail=None):
        self.reply = reply
        self.chunk = chunk
        self.fail = fail
        self.calls: list[list[dict]] = []

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        self.calls.append(messages)
        if self.fail:
            raise self.fail
        step = self.chunk or max(1, len(self.reply) // 4)
        for index in range(0, len(self.reply), step):
            yield self.reply[index:index + step]
            await asyncio.sleep(0)


class OpenAICompatibleProvider:
    """Minimal streaming client for an OpenAI-compatible chat endpoint."""

    def __init__(self, base_url: str, model: str, api_key_env: str = 'FAST_BRAIN_API_KEY',
                 request_timeout_s: float = 10.0):
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.api_key_env = api_key_env
        self.request_timeout_s = request_timeout_s

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise FastBrainUnavailable('快脑 HTTP 客户端未安装') from exc
        key = os.environ.get(self.api_key_env, '').strip()
        if not key:
            raise FastBrainUnavailable(f'快脑密钥未配置（环境变量 {self.api_key_env}）')
        payload = {'model': self.model, 'messages': messages, 'stream': True}
        headers = {'Authorization': 'Bearer ' + key}
        async with httpx.AsyncClient(timeout=self.request_timeout_s) as client:
            async with client.stream('POST', self.base_url + '/chat/completions',
                                     json=payload, headers=headers) as response:
                if response.status_code != 200:
                    raise FastBrainUnavailable(f'快脑返回 HTTP {response.status_code}')
                async for line in response.aiter_lines():
                    if not line.startswith('data:'):
                        continue
                    data = line[5:].strip()
                    if data == '[DONE]':
                        break
                    try:
                        delta = json.loads(data)['choices'][0]['delta'].get('content')
                    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                        continue
                    if delta:
                        yield delta


def build_provider(settings):
    """Create the configured provider; ``None`` means not configured."""
    provider = getattr(settings, 'fast_brain_provider', 'mock')
    if provider == 'mock':
        return MockProvider()
    if provider == 'openai':
        return OpenAICompatibleProvider(
            getattr(settings, 'fast_brain_base_url', ''),
            getattr(settings, 'fast_brain_model', ''),
            getattr(settings, 'fast_brain_api_key_env', 'FAST_BRAIN_API_KEY'),
        )
    if provider == 'disabled':
        return None
    raise ValueError(f'未知快脑 provider：{provider}')


class FastBrain:
    def __init__(self, provider, memory, outbox, *, first_token_timeout_s: float = DEFAULT_FIRST_TOKEN_TIMEOUT_S):
        self.provider = provider
        self.memory = memory
        self.outbox = outbox
        self.first_token_timeout_s = first_token_timeout_s

    def messages(self, turn: dict) -> list[dict]:
        pack = self.memory.get() if self.memory is not None else ''
        system = (pack + '\n\n' if pack else '') + DEFAULT_INSTRUCTION
        return [{'role': 'system', 'content': system},
                {'role': 'user', 'content': turn.get('input_text', '')}]

    async def run(self, service, turn: dict, request_id: str) -> bool:
        if self.provider is None:
            raise FastBrainUnavailable('快脑未配置')
        turn['model'] = getattr(self.provider, 'model', 'mock')
        options = {}
        role = service.roles.get(turn['project'])
        if role is not None and role.tts_voice is not None:
            options['voice'] = role.tts_voice
        sentences = None
        if callable(getattr(service.speech, 'synthesize_stream', None)):
            sentences = SentenceSpeech(service, turn, request_id, options)
        text = ''
        first = True
        started = time.monotonic()
        stream = self.provider.stream(self.messages(turn))
        try:
            while True:
                try:
                    wait = self.first_token_timeout_s if first else None
                    delta = await (asyncio.wait_for(anext(stream), wait) if wait else anext(stream))
                except StopAsyncIteration:
                    break
                except asyncio.TimeoutError as exc:
                    raise FastBrainUnavailable('快脑首字超时', partial=bool(turn.get('audio_chunks'))) from exc
                except (FastBrainUnavailable, BridgeError):
                    raise
                except Exception as exc:
                    raise FastBrainUnavailable(f'快脑调用失败：{exc}',
                                               partial=bool(turn.get('audio_chunks'))) from exc
                if first:
                    first = False
                    turn['timings']['fast_first_token_ms'] = round(
                        (time.monotonic() - turn['started']) * 1000)
                text += delta
                if len(text) > MAX_ANSWER_CHARS:
                    text = text[:MAX_ANSWER_CHARS]
                    break
                if sentences is not None:
                    await sentences.feed_delta(delta)
        finally:
            close = getattr(stream, 'aclose', None)
            if close is not None:
                await close()
        text = text.strip()
        if not text:
            raise FastBrainUnavailable('快脑没有给出回答', partial=bool(turn.get('audio_chunks')))
        turn['text'] = text
        audio = None
        try:
            if sentences is not None:
                await sentences.feed_delta('', final=True)
                audio = await sentences.finish()
                turn['timings']['agent_first_sentence_ms'] = turn['timings'].get(
                    'agent_first_sentence_ms', round((time.monotonic() - turn['started']) * 1000))
            if audio is None:
                turn['spoken_text'] = text
                turn['status'] = 'synthesizing'
                turn['_tts_started'] = time.monotonic()
                audio = await service.synthesize_stream(turn, options)
        except (BridgeError, HTTPException):
            raise
        except Exception as exc:
            raise FastBrainUnavailable('快脑回答合成失败', partial=bool(turn.get('audio_chunks'))) from exc
        finally:
            if sentences is not None:
                await sentences.close()
        if audio is None:
            raise FastBrainUnavailable('快脑没有可播放音频', partial=bool(turn.get('audio_chunks')))
        service.audio[turn['id']] = audio
        turn.update(audio_url='/api/turn/' + turn['id'] + '/audio',
                    status='stopped' if service.output_stopped(turn) else 'ready',
                    audio_complete=not service.output_stopped(turn))
        turn['timings']['fast_ms'] = round((time.monotonic() - started) * 1000)
        if self.outbox is not None:
            from .memory_pack import record_turn
            record = record_turn(turn.get('device_id', 'desktop'), turn,
                                 mode=turn.get('mode', ''), route='small',
                                 model=turn.get('model', ''), confidence=turn.get('confidence', 1.0))
            if not self.outbox.append(record):
                turn['outbox_duplicate'] = True
        return True
