import asyncio
import io
import threading
import time
import wave
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest

from voice.app import create_app, TurnInput
from voice.fast_brain import FastBrainUnavailable, MockProvider
from voice.settings import Settings


def wav(frames=48):
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        audio.writeframes(b'\x10\x01' * frames)
    return out.getvalue()


class Speech:
    def __init__(self):
        self.texts = []

    def synthesize_stream(self, text, on_chunk, **options):
        self.texts.append(text)
        on_chunk(wav())
        return wav()


class Bridge:
    def __init__(self):
        self.calls = []

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path.startswith('/input/bindings?'):
            return dict(project='gge', session_key='discord:test-channel',
                        session_id='bound', agent_session_id='cli', busy=False)
        if body is not None:
            return {'status': 'running'}
        return {'status': 'completed', 'text': '大脑回答。', 'session_id': 'bound',
                'agent_session_id': 'cli'}


def settings(tmp_path, **overrides):
    values = dict(project='gge', role_name='G哥', session_key='discord:test-channel',
                  bridge_socket=str(tmp_path / 'api.sock'), model_path=str(tmp_path / 'model'),
                  data_dir=str(tmp_path), shared_memory_dir=str(tmp_path / 'memory'),
                  modes_enabled=True, fast_brain_provider='mock',
                  memory_pack_path=str(tmp_path / 'pack.json'))
    values.update(overrides)
    return Settings(**values)


def build(tmp_path, provider=None, **overrides):
    speech = Speech()
    bridge = Bridge()
    app = create_app(settings(tmp_path, **overrides), speech, bridge)
    if provider is not None and app.state.service.fast_brain is not None:
        app.state.service.fast_brain.provider = provider
    return app, speech, bridge


def payload(text, mode='companion', **kwargs):
    return {'id': str(uuid4()), 'project': 'gge', 'text': text, 'mode': mode, **kwargs}


async def run_turn(app, data):
    await app.state.service.submit(TurnInput(**data))
    await asyncio.gather(*app.state.service.tasks)
    return app.state.service.turns[data['id']]


async def test_companion_mode_answers_from_small_brain_without_bridge(tmp_path):
    app, speech, bridge = build(tmp_path, provider=MockProvider('我在呢，慢慢说。'))
    data = payload('你好', speech_end_ms=round(time.time() * 1000) - 120)
    turn = await run_turn(app, data)
    assert turn['status'] == 'ready', turn
    assert turn['route'] == 'small' and turn['mode'] == 'companion'
    assert turn['text'] == '我在呢，慢慢说。'
    assert speech.texts == ['我在呢，慢慢说。']
    assert bridge.calls == []
    assert turn['timings']['e2e_first_audio_ms'] >= 0
    assert turn['timings']['submit_to_first_audio_ms'] >= 0
    assert turn['audio_url'].startswith('/api/turn/')


async def test_work_mode_still_uses_the_big_brain(tmp_path):
    app, speech, bridge = build(tmp_path, provider=MockProvider('不该用我'))
    data = payload('帮我看看这个报错', mode='work')
    turn = await run_turn(app, data)
    assert turn['status'] == 'ready', turn
    assert turn['route'] == 'big'
    assert [path for path, _ in bridge.calls if path == '/input']
    assert speech.texts == ['大脑回答。']


async def test_auto_routes_greeting_small_and_task_big(tmp_path):
    app, _, bridge = build(tmp_path, provider=MockProvider('在的。'))
    small = await run_turn(app, payload('晚安', mode='auto'))
    assert small['route'] == 'small'
    big = await run_turn(app, payload('替我打开项目目录', mode='auto'))
    assert big['route'] == 'big'
    assert [path for path, _ in bridge.calls if path == '/input']


async def test_provider_failure_before_audio_falls_back_to_big_brain(tmp_path):
    app, speech, bridge = build(tmp_path, provider=MockProvider(fail=RuntimeError('offline')))
    turn = await run_turn(app, payload('你好', mode='companion'))
    assert turn['status'] == 'ready', turn
    assert turn['route'] == 'big'
    assert turn['route_escalated'] is True
    assert [path for path, _ in bridge.calls if path == '/input']
    assert turn['text'] == '大脑回答。'


async def test_partial_failure_is_not_reanswered(tmp_path):
    app, speech, bridge = build(tmp_path, provider=MockProvider('半句'))
    service = app.state.service

    async def broken(service_, turn, request_id):
        turn['audio_chunks'] = [{'index': 0}]
        raise FastBrainUnavailable('断线', partial=True)

    service.fast_brain.run = broken
    turn = await run_turn(app, payload('你好', mode='companion'))
    assert turn['status'] == 'error'
    assert '不会重播' in turn['error']
    assert not [path for path, _ in bridge.calls if path == '/input']


async def test_mode_disabled_keeps_existing_path(tmp_path):
    app, speech, bridge = build(tmp_path, provider=MockProvider('不该用我'),
                                modes_enabled=False)
    data = payload('你好', mode='companion')
    turn = await run_turn(app, data)
    assert app.state.service.fast_brain is None
    # 关闭三模式时完全不记录/不改变路由，旧链路行为保持不变。
    assert 'route' not in turn
    assert [path for path, _ in bridge.calls if path == '/input']
