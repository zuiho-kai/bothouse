"""Relay sentence streaming: bridge receipts carry complete public sentences."""
import asyncio
import threading
from dataclasses import replace
from urllib.parse import parse_qs, urlparse

import pytest

from voice import relay
from voice.app import TurnInput, spoken_answer
from voice.roles import Role
from test_voice_app import setup, payload, finish
from test_voice_sentence_stream import wav
from test_voice_device_app import setup as setup_device, path as device_path


@pytest.fixture(autouse=True)
def fast_polls(monkeypatch):
    monkeypatch.setattr(relay, 'POLL_SECONDS', 0.001)


class Speech:
    def __init__(self):
        self.texts = []
        self.spoke = threading.Event()

    def synthesize_stream(self, text, receive, **options):
        self.texts.append(text)
        receive(wav())
        self.spoke.set()
        return wav()


class ScriptBridge:
    """Each GET returns the next scripted receipt (the last one repeats)."""

    def __init__(self, script, speech, *, wait_audio_before=None):
        self.script, self.speech = script, speech
        self.wait_audio_before = wait_audio_before
        self.calls, self.post, self.polls = [], None, 0

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path.startswith('/relay/voice/binding?'):
            result = {k: v[0] for k, v in parse_qs(urlparse(path).query).items()}
            return dict(result, relay_key='a' * 64, busy=False)
        if path == '/relay/send':
            self.post = body
            return {'status': 'running'}
        if path.endswith('/cancel'):
            return {'status': 'failed'}
        index = min(self.polls, len(self.script) - 1)
        self.polls += 1
        if index == self.wait_audio_before:
            assert self.speech.spoke.wait(2), 'first sentence must be audible before the terminal receipt'
        row = self.script[index]
        if callable(row):
            row = row()
        return dict(request_id=self.post['request_id'], relay_key='a' * 64,
                    agent_session_id='native', **row)


def running(*sentences):
    return dict(status='running', text='', **({'sentences': list(sentences)} if sentences else {}))


async def relay_run(tmp_path, script, *, stream=True, device=None, speech=None, **kwargs):
    speech = speech or Speech()
    bridge = ScriptBridge(script, speech, **kwargs)
    app, client, _, _ = setup(tmp_path, bridge, speech)
    service = app.state.service
    service.roles['gge'] = Role('gge', 'G哥', relay_project='grok')
    service.settings = replace(service.settings, sentence_stream=stream)
    data = TurnInput(**payload())
    await service._submit(data, device=device)
    await asyncio.wait_for(finish(app), 4)
    await client.aclose()
    return service, service.turns[data.id], bridge, speech


async def test_sentences_play_before_completion_once_then_rest(tmp_path):
    done = dict(status='completed', text='第一句。第二句。尾巴', sentences=['第一句。', '第二句。'], rest='尾巴')
    service, turn, bridge, speech = await relay_run(tmp_path, [
        running(), running('第一句。'), running('第一句。'), running('第一句。', '第二句。'), done,
    ], wait_audio_before=4)
    assert bridge.post['stream'] is True and bridge.post['mode'] == 'voice'
    assert speech.texts == ['第一句。', '第二句。', '尾巴']
    assert turn['status'] == 'ready' and turn['audio_complete'] is True
    assert turn['text'] == '第一句。第二句。尾巴'
    assert [c['index'] for c in turn['audio_chunks']] == [0, 1, 2]
    assert turn['timings']['agent_first_sentence_ms'] <= turn['timings']['agent_ms']
    assert not any(p.endswith('/cancel') for p, _ in bridge.calls)


async def test_terminal_first_poll_still_speaks_everything_once(tmp_path):
    done = dict(status='completed', text='甲。乙。丙', sentences=['甲。', '乙。'], rest='丙')
    _, turn, _, speech = await relay_run(tmp_path, [done])
    assert speech.texts == ['甲。', '乙。', '丙'] and turn['status'] == 'ready'


async def test_whitespace_receipts_preserve_identity_without_speaking_blank_chunks(tmp_path):
    done = dict(status='completed', text='甲。\n\n乙。尾巴', sentences=['甲。', '\n\n', '乙。'], rest='尾巴')
    _, turn, _, speech = await relay_run(tmp_path, [running('甲。'), running('甲。', '\n\n'), done])
    assert speech.texts == ['甲。', '乙。', '尾巴'] and turn['status'] == 'ready'


async def test_no_streamed_sentence_uses_whole_answer_path(tmp_path):
    done = dict(status='completed', text='没有句末标点的完整回答')
    _, turn, _, speech = await relay_run(tmp_path, [running(), done])
    assert speech.texts == ['没有句末标点的完整回答'] and turn['status'] == 'ready'


async def test_failure_after_audible_sentence_stops_without_success(tmp_path):
    failed = dict(status='failed', text='', error='voice relay failed')
    service, turn, _, speech = await relay_run(tmp_path, [running('第一句。'), failed], wait_audio_before=1)
    assert speech.texts == ['第一句。']
    assert turn['status'] == 'error' and turn['speech_incomplete'] is True
    assert '转发未完成' in turn['error'] and not turn.get('audio_complete')
    assert len(turn['audio_chunks']) == 1


async def test_failure_before_any_sentence_stays_silent(tmp_path):
    failed = dict(status='failed', text='', error='voice relay failed')
    _, turn, _, speech = await relay_run(tmp_path, [running(), failed])
    assert speech.texts == [] and turn['status'] == 'error'
    assert 'speech_incomplete' not in turn


async def test_rewritten_sentences_stop_and_never_replay(tmp_path):
    _, turn, bridge, speech = await relay_run(tmp_path, [running('第一句。'), running('改写。', '第二句。')],
                                              wait_audio_before=1)
    assert speech.texts == ['第一句。']
    assert turn['status'] == 'error' and '改写' in turn['error']
    assert any(p.endswith('/cancel') for p, _ in bridge.calls)


async def test_stopped_turn_does_not_revive_or_notice(tmp_path):
    device = dict(device_id='desk-grok', stop_requested=False)

    def stop_then_more():
        device['stop_requested'] = True
        return running('第一句。', '第二句。')
    _, turn, bridge, speech = await relay_run(
        tmp_path, [running('第一句。'), stop_then_more, running('第一句。', '第二句。', '第三句。')],
        device=device, wait_audio_before=1)
    assert speech.texts == ['第一句。']
    assert turn['status'] == 'error' and 'speech_incomplete' not in turn
    assert any(p.endswith('/cancel') for p, _ in bridge.calls)
    chunks = len(turn['audio_chunks'])
    await asyncio.sleep(0.02)
    assert len(turn['audio_chunks']) == chunks == 1


async def test_markup_sentence_is_left_for_final_processing(tmp_path):
    tagged = '我会<待转达 to="deep">明早开会</待转达>。'
    done = dict(status='completed', text='好的。' + tagged + '再见。', sentences=['好的。', tagged], rest='再见。')
    seen, speech = [], Speech()

    def check():
        seen.append(list(speech.texts))
        return running('好的。', tagged)
    _, turn, _, _ = await relay_run(tmp_path, [running('好的。', tagged), check, done],
                                    speech=speech, wait_audio_before=1)
    # While streaming, the tagged sentence was never offered to synthesis.
    assert seen[0] == ['好的。']
    assert speech.texts == ['好的。', spoken_answer(tagged + '再见。')]
    assert turn['status'] == 'ready'


async def test_switch_off_ignores_sentences_and_sends_no_stream(tmp_path):
    done = dict(status='completed', text='第一句。第二句。', sentences=['第一句。'], rest='第二句。')
    _, turn, bridge, speech = await relay_run(tmp_path, [running('第一句。'), done], stream=False)
    assert 'stream' not in bridge.post
    assert speech.texts == ['第一句。第二句。'] and turn['status'] == 'ready'
    assert 'speech_incomplete' not in turn


async def test_device_can_fetch_first_audio_while_model_receipt_is_paused(tmp_path):
    speech = Speech()
    release = threading.Event()

    class PausedBridge(ScriptBridge):
        def call(self, path, body=None):
            if path.startswith('/relay/voice/voice-') and not path.endswith('/cancel') and self.polls >= 1:
                assert release.wait(5), 'fixture did not release the final model receipt'
            return super().call(path, body)

    done = dict(status='completed', text='第一句。尾巴', sentences=['第一句。'], rest='尾巴')
    bridge = PausedBridge([running('第一句。'), done], speech)
    app, client, _, _ = setup_device(tmp_path, speech=speech)
    service = app.state.service
    service.bridge = bridge
    service.roles['gge'] = Role('gge', 'G哥', relay_project='grok')
    service.settings = replace(service.settings, sentence_stream=True)
    data = payload()
    try:
        async with client:
            assert (await client.post(device_path() + '/turn', json=data)).status_code == 202
            assert await asyncio.to_thread(speech.spoke.wait, 2)
            snapshot = (await client.get(device_path('gge', data['id']))).json()
            assert snapshot['status'] == 'synthesizing' and not snapshot.get('audio_complete')
            assert snapshot['playback_allowed'] is True
            audio = await client.get(snapshot['audio_chunks'][0]['audio_url'])
            assert audio.status_code == 200 and audio.content.startswith(b'RIFF')
            assert any(not task.done() for task in service.tasks)
            release.set()
            await finish(app)
            assert (await client.get(device_path('gge', data['id']))).json()['status'] == 'ready'
    finally:
        release.set()
        await finish(app)
    assert speech.texts == ['第一句。', '尾巴']
