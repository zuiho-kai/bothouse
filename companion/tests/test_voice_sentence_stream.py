import asyncio
import io
import threading
import time
import wave
from dataclasses import replace
import pytest
from voice.app import TurnInput
from voice.sentence_stream import SentenceSpeech
from voice.bridge import BridgeError
from test_voice_app import setup, payload, finish


def wav():
    out = io.BytesIO()
    with wave.open(out, 'wb') as writer:
        writer.setparams((1, 2, 24000, 0, 'NONE', ''))
        writer.writeframes(b'\x01\x00' * 24)
    return out.getvalue()


class Speech:
    def __init__(self):
        self.called = threading.Event()
        self.texts = []
    def synthesize_stream(self, text, receive, **options):
        self.texts.append(text)
        receive(wav())
        self.called.set()
        return wav()


class Bridge:
    def __init__(self, speech, *, fail=False, mismatch=False, unsupported=False):
        self.speech, self.fail, self.mismatch = speech, fail, mismatch
        self.unsupported = unsupported
        self.polls, self.posts = 0, []
    def call(self, path, body=None):
        if path.startswith('/input/bindings?'):
            return dict(project='gge', session_key='discord:test-channel', session_id='bound', agent_session_id='cli', busy=False)
        if body:
            self.posts.append(body)
            return {'status': 'running'}
        self.polls += 1
        result = dict(request_id=self.posts[0]['request_id'], session_id='bound', agent_session_id='cli',
                      status='running', speech_text='第一句。')
        if self.mismatch:
            result['agent_session_id'] = 'foreign'
        if self.unsupported:
            result.update(status='completed', text='完整回答。')
            result.pop('speech_text')
        elif self.polls >= 3:
            assert self.speech.called.is_set(), 'first audio must precede terminal result'
            result.update(status='failed' if self.fail else 'completed',
                          speech_text='第一句。第二句。', text='第一句。第二句。')
        return result


async def service_turn(tmp_path, **kwargs):
    speech = Speech()
    bridge = Bridge(speech, **kwargs)
    app, _, _, _ = setup(tmp_path, bridge, speech)
    service = app.state.service
    service.check_bindings = True
    service.settings = replace(service.settings, sentence_stream=True)
    data = payload()
    await service._submit(TurnInput(**data), expected_binding={'session_id': 'bound', 'agent_session_id': 'cli'})
    await asyncio.wait_for(finish(app), 4)
    return service, service.turns[data['id']], bridge, speech


async def test_first_sentence_precedes_terminal_and_duplicate_poll_not_replayed(tmp_path):
    service, turn, bridge, speech = await service_turn(tmp_path)
    assert turn['status'] == 'ready', turn
    assert speech.texts == ['第一句。', '第二句。']
    assert len(bridge.posts) == 1 and bridge.posts[0]['stream'] is True
    assert [c['index'] for c in turn['audio_chunks']] == [0, 1]
    assert len(service.audio_chunks[turn['id']]) == 2
    with wave.open(io.BytesIO(service.audio[turn['id']]), 'rb') as reader:
        assert reader.getnframes() == 48


@pytest.mark.parametrize('mode', ['fail', 'mismatch'])
async def test_failed_or_cross_session_never_finishes_audio(tmp_path, mode):
    _, turn, _, speech = await service_turn(tmp_path, **{mode: True})
    assert turn['status'] == 'error'
    assert 'audio_url' not in turn and not turn.get('audio_complete')
    assert speech.texts == (['第一句。'] if mode == 'fail' else [])


async def test_backend_without_deltas_uses_existing_final_path(tmp_path):
    _, turn, _, speech = await service_turn(tmp_path, unsupported=True)
    assert turn['status'] == 'ready', turn
    assert speech.texts == ['完整回答。']


async def test_stop_and_text_rewrite_refused(tmp_path):
    speech = Speech()
    app, _, _, _ = setup(tmp_path, speech=speech)
    turn = dict(id='stream-test', _binding={'session_id': 'b', 'agent_session_id': 'a'},
                started=time.monotonic(), timings={}, spoken_text='', status='thinking', _device={})
    stream = SentenceSpeech(app.state.service, turn, 'r', {})
    row = dict(request_id='r', session_id='b', agent_session_id='a', speech_text='未完')
    try:
        await stream.feed(row)
        with pytest.raises(BridgeError):
            await stream.feed({**row, 'speech_text': '改写'})
        turn['_device']['stop_requested'] = True
        with pytest.raises(BridgeError):
            await stream.feed({**row, 'speech_text': '未完句子。'})
        assert speech.texts == []
    finally:
        await stream.close()


async def test_markup_is_not_read_as_partial_sentence(tmp_path):
    speech = Speech()
    app, _, _, _ = setup(tmp_path, speech=speech)
    turn = dict(id='markup', _binding={'session_id': 'b', 'agent_session_id': 'a'},
                started=time.monotonic(), timings={}, spoken_text='', status='thinking')
    stream = SentenceSpeech(app.state.service, turn, 'r', {})
    await stream.feed(dict(request_id='r', session_id='b', agent_session_id='a', speech_text='<think>不要播。'))
    assert stream.blocked and speech.texts == []
    await stream.close()


async def test_late_synthesis_callback_after_cancel_cannot_publish(tmp_path):
    entered, release = threading.Event(), threading.Event()
    class Slow(Speech):
        def synthesize_stream(self, text, receive, **options):
            entered.set()
            release.wait(2)
            receive(wav())
            return wav()
    app, _, _, _ = setup(tmp_path, speech=Slow())
    turn = dict(id='late', _binding={'session_id': 'b', 'agent_session_id': 'a'},
                started=time.monotonic(), timings={}, spoken_text='', status='thinking', _device={})
    stream = SentenceSpeech(app.state.service, turn, 'r', {})
    try:
        await stream.feed(dict(request_id='r', session_id='b', agent_session_id='a', speech_text='你好。'))
        assert await asyncio.to_thread(entered.wait, 1)
        turn['_device']['stop_requested'] = True
        await stream.close()
    finally:
        release.set()
    await asyncio.sleep(.02)
    assert turn['audio_chunks'] == []

async def test_first_poll_already_terminal_includes_unstreamed_final_suffix(tmp_path):
    speech = Speech()
    app, _, _, _ = setup(tmp_path, speech=speech)
    turn = dict(id='final-first', _binding={'session_id':'b','agent_session_id':'a'},
                started=time.monotonic(), timings={}, spoken_text='', status='thinking')
    stream = SentenceSpeech(app.state.service, turn, 'r', {})
    try:
        await stream.feed(dict(request_id='r',session_id='b',agent_session_id='a',
                              speech_text='第一句。',text='第一句。第二句。'),final=True)
        await stream.finish()
        assert speech.texts == ['第一句。','第二句。']
    finally:
        await stream.close()
