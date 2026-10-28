"""Bounded, ordered speech from explicit public text deltas; no second prompt."""
import asyncio
import io
import re
import time
import wave

from .bridge import BridgeError

_MARKUP = ('<', chr(96), '[[')


class SentenceSpeech:
    def __init__(self, service, turn, request_id, options):
        self.service, self.turn = service, turn
        self.request_id, self.options = request_id, options
        self.raw = ''
        self.pending = ''
        self.spoken = 0
        self.blocked = False
        self.sentences = []  # relay receipt sentences already accepted
        self.played = 0      # how many of them were enqueued for speech
        self.queue = asyncio.Queue(maxsize=64)
        self.worker = None
        self.audio = []

    def validate(self, result):
        expected = self.turn.get('_binding')
        if (not expected or result.get('request_id') != self.request_id or
                any(result.get(k) != expected[k] for k in ('session_id', 'agent_session_id'))):
            raise BridgeError('增量回答与原请求或会话不一致；已停止本轮播放。', 422)

    async def feed(self, result, *, final=False):
        self.validate(result)
        if self.worker and self.worker.done():
            self.worker.result()
        if self.service.output_stopped(self.turn):
            raise BridgeError('本轮播放已停止。', 409)
        current = result.get('speech_text', '')
        if not isinstance(current, str) or not current.startswith(self.raw):
            raise BridgeError('增量回答发生改写；已停止本轮播放。', 422)
        if final and current:
            text = result.get('text', '')
            if not isinstance(text, str) or not text.startswith(current):
                raise BridgeError('最终回答与已播放片段不一致；请查看文字结果。', 422)
            current = text
        delta, self.raw = current[len(self.raw):], current
        # Do not try to read code/markup/tool-like text token by token. Once
        # encountered, keep the remainder for the final visual answer only.
        if self.blocked:
            return
        self.pending += delta
        if any(token in self.pending for token in ('<', chr(96), '[[')):
            self.blocked = True
            self.pending = ''
            return
        while match := re.search(r'[。！？!?\n]|\.(?=\s|$)', self.pending):
            end = match.end()
            await self.enqueue(self.pending[:end])
            self.pending = self.pending[end:]
        if final and self.raw:
            await self.enqueue(self.pending)
            self.pending = ''

    async def feed_sentences(self, result, *, final=False):
        """Relay receipts carry complete public sentences; replay of a poll is
        a no-op and a rewritten prefix stops the turn. Markup stops streaming
        and the remainder is left for final handling, like ``rest``."""
        if self.worker and self.worker.done():
            self.worker.result()
        if self.service.output_stopped(self.turn):
            raise BridgeError('本轮播放已停止。', 409)
        sentences = result.get('sentences', [])
        rest = result.get('rest', '')
        if (not isinstance(sentences, list) or not all(isinstance(s, str) for s in sentences)
                or len(sentences) > 64 or sum(len(s.encode()) for s in sentences) > 16384
                or not isinstance(rest, str)):
            raise BridgeError('增量回答格式不正确；已停止本轮播放。', 422)
        if sentences[:len(self.sentences)] != self.sentences:
            raise BridgeError('增量回答发生改写；已停止本轮播放。', 422)
        if final and ('sentences' in result or 'rest' in result or self.sentences) and result.get('text') != ''.join(sentences) + rest:
            raise BridgeError('最终回答与已播放片段不一致；已停止本轮播放。', 422)
        self.sentences = list(sentences)
        while not self.blocked and self.played < len(self.sentences):
            sentence = self.sentences[self.played]
            if any(token in sentence for token in _MARKUP):
                self.blocked = True
                break
            self.played += 1
            await self.enqueue(sentence)
        if final and self.worker is not None:
            # Same spoken processing the full answer would get; only the part
            # not yet spoken. Without any streamed sentence, the caller keeps
            # the existing whole-answer path.
            await self.enqueue(''.join(self.sentences[self.played:]) + rest)
            self.played = len(self.sentences)

    async def feed_delta(self, delta: str, *, final: bool = False) -> None:
        """Feed raw model deltas (small brain) instead of a bridge receipt.

        Same sentence splitting and markup stop as ``feed``; there is no
        binding to validate because this text never passed through the bridge.
        """
        if self.worker and self.worker.done():
            self.worker.result()
        if self.service.output_stopped(self.turn):
            raise BridgeError('本轮播放已停止。', 409)
        if not isinstance(delta, str):
            raise BridgeError('增量回答格式不正确；已停止本轮播放。', 422)
        if len((self.raw + delta).encode()) > 16384:  # 沿用 relay 增量路径的同一上限
            raise BridgeError('增量回答过长；已停止本轮播放。', 422)
        self.raw += delta
        if self.blocked:
            return
        self.pending += delta
        if any(token in self.pending for token in ('<', chr(96), '[[')):
            self.blocked = True
            self.pending = ''
            return
        while match := re.search(r'[。！？!?\n]|\.(?=\s|$)', self.pending):
            end = match.end()
            await self.enqueue(self.pending[:end])
            self.pending = self.pending[end:]
        if final and self.pending:
            await self.enqueue(self.pending)
            self.pending = ''

    async def enqueue(self, text):
        from .app import spoken_answer
        text = spoken_answer(text).strip()
        if not text or self.spoken >= 450:
            return
        text = text[:450-self.spoken]
        self.spoken += len(text)
        self.turn['spoken_text'] += text
        if self.worker is None:
            self.turn['status'] = 'synthesizing'
            self.turn['_tts_started'] = time.monotonic()
            self.turn['timings']['agent_first_sentence_ms'] = round(
                (time.monotonic()-self.turn['started'])*1000)
            self.worker = asyncio.create_task(self.consume())
        try:
            self.queue.put_nowait(text)
        except asyncio.QueueFull:
            raise BridgeError('语音分段过多；已停止播放，请查看文字。', 422) from None

    async def consume(self):
        while (text := await self.queue.get()) is not None:
            if self.service.output_stopped(self.turn):
                raise BridgeError('本轮播放已停止。', 409)
            audio = await self.service.synthesize_stream(self.turn, self.options, text=text, append=True)
            self.audio.append(audio)

    async def finish(self):
        if self.worker is None:
            return None
        # Never block putting the terminator after a failed consumer.
        if self.worker.done():
            self.worker.result()
        self.queue.put_nowait(None)
        await self.worker
        out = io.BytesIO()
        with wave.open(out, 'wb') as writer:
            writer.setparams((1, 2, 24000, 0, 'NONE', ''))
            for audio in self.audio:
                with wave.open(io.BytesIO(audio), 'rb') as reader:
                    writer.writeframes(reader.readframes(reader.getnframes()))
        return out.getvalue()

    async def close(self):
        if self.worker:
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
