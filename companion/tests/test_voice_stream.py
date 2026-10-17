import asyncio
import io
import threading
import wave

import pytest

from test_voice_app import setup, payload, finish


def wav(frames=2400):
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        audio.writeframes(b'\x10\x01' * frames)
    return out.getvalue()


class GatedSpeech:
    def __init__(self, fail=False):
        self.first = threading.Event()
        self.release = threading.Event()
        self.finished = threading.Event()
        self.fail = fail

    def synthesize(self, text):
        self.first.set()
        assert self.release.wait(5)
        return wav(4800)

    def synthesize_stream(self, text, on_chunk, **options):
        try:
            on_chunk(wav())
            self.first.set()
            assert self.release.wait(5)
            if self.fail:
                raise RuntimeError('fixture stream failure')
            on_chunk(wav())
            return wav(4800)
        finally:
            self.finished.set()


async def test_first_chunk_is_available_while_synthesis_is_still_blocked(tmp_path):
    speech = GatedSpeech()
    app, client, headers, _ = setup(tmp_path, speech=speech)
    data = payload()
    path = '/api/turn/' + data['id']
    try:
        async with client:
            assert (await client.post('/api/turn', headers=headers, json=data)).status_code == 202
            assert await asyncio.to_thread(speech.first.wait, 2)
            current = (await client.get(path)).json()
            assert current['status'] == 'synthesizing'
            assert len(current.get('audio_chunks', [])) == 1
            assert current['audio_complete'] is False
            chunk = current['audio_chunks'][0]
            assert chunk['index'] == 0
            assert chunk['duration_seconds'] == pytest.approx(.1)
            assert (await client.get(chunk['audio_url'])).content == wav()
            assert (await client.get(path + '/audio/chunks/-1')).status_code == 404
            assert (await client.get(path + '/audio/chunks/1')).status_code == 404
            assert (await client.get(path + '/audio')).status_code == 404
            assert (await client.post(path + '/playback', headers=headers, json={
                'state': 'completed', 'position_seconds': .1, 'duration_seconds': .1,
            })).status_code == 409
            assert (await client.post(path + '/playback', headers=headers, json={
                'state': 'playing', 'position_seconds': 0, 'duration_seconds': .1,
            })).status_code == 200
            speech.release.set()
            await finish(app)
            current = (await client.get(path)).json()
            assert current['status'] == 'ready' and current['audio_complete'] is True
            assert len(current['audio_chunks']) == 2
            assert (await client.get(current['audio_url'])).content == wav(4800)
            assert current['timings']['tts_first_chunk_ms'] <= current['timings']['tts_ms']
            assert current['timings']['tts_to_playback_ms'] <= current['timings']['tts_ms']
            assert (await client.post(path + '/playback', headers=headers, json={
                'state': 'completed', 'position_seconds': .1, 'duration_seconds': .1,
            })).status_code == 409
            assert (await client.post(path + '/playback', headers=headers, json={
                'state': 'completed', 'position_seconds': .2, 'duration_seconds': .2,
            })).status_code == 200
    finally:
        speech.release.set()
        await finish(app)


async def test_partial_stream_failure_preserves_text_but_never_completes(tmp_path):
    speech = GatedSpeech(fail=True)
    app, client, headers, _ = setup(tmp_path, speech=speech)
    data = payload()
    path = '/api/turn/' + data['id']
    try:
        async with client:
            await client.post('/api/turn', headers=headers, json=data)
            assert await asyncio.to_thread(speech.first.wait, 2)
            speech.release.set()
            await finish(app)
            current = (await client.get(path)).json()
            assert current['status'] == 'error' and current['text']
            assert current['audio_complete'] is False
            assert 'audio_url' not in current
            assert (await client.get(path + '/audio/chunks/0')).status_code == 404
            assert (await client.post(path + '/playback', headers=headers, json={
                'state': 'completed', 'position_seconds': .1, 'duration_seconds': .1,
            })).status_code == 409
    finally:
        speech.release.set()
        await finish(app)


async def test_stop_during_stream_prevents_next_discussion_speaker(tmp_path):
    from test_voice_multi import setup as multi_setup
    from test_voice_discussion import discussion, settle
    app, client, headers, bridge, _ = multi_setup(tmp_path)
    speech = GatedSpeech()
    app.state.service.speech = speech
    data = discussion()
    path = '/api/discussion/' + data['id']
    try:
        async with client:
            await client.post('/api/discussion', headers=headers, json=data)
            assert await asyncio.to_thread(speech.first.wait, 2)
            current = (await client.get(path)).json()
            t = current['turns'][0]
            assert t['status'] == 'synthesizing' and t['audio_chunks']
            assert (await client.post(path + '/advance', headers=headers, json={
                'turn_id': t['id'], 'outcome': 'completed',
            })).status_code == 409
            stopped = await client.post(path + '/stop', headers=headers, json={})
            assert stopped.json()['status'] == 'stopping'
            speech.release.set()
            await settle(app)
            assert (await client.get(path)).json()['status'] == 'stopped'
            stopped_turn = (await client.get('/api/turn/' + t['id'])).json()
            assert len(stopped_turn['audio_chunks']) == 1
            assert stopped_turn['audio_complete'] is False
            for index in (0, 1):
                assert (await client.get('/api/turn/' + t['id'] + '/audio/chunks/' + str(index))).status_code == 404
            for state in ('playing', 'completed'):
                assert (await client.post('/api/turn/' + t['id'] + '/playback', headers=headers, json={
                    'state': state, 'position_seconds': .2, 'duration_seconds': .2,
                })).status_code == 409
            assert (await client.post(path + '/advance', headers=headers, json={
                'turn_id': t['id'], 'outcome': 'skipped',
            })).status_code == 409
            assert len(bridge.requests) == 1
    finally:
        speech.release.set()
        await settle(app)


async def test_thinking_cannot_prestore_completed_and_advance_without_playing(tmp_path):
    from test_voice_multi import setup as multi_setup
    from test_voice_discussion import discussion, settle
    app, client, headers, bridge, _ = multi_setup(tmp_path)
    service = app.state.service
    entered, release = asyncio.Event(), asyncio.Event()
    run = service.run

    async def delayed_run(turn):
        entered.set()
        await release.wait()
        await run(turn)

    service.run = delayed_run
    data = discussion()
    path = '/api/discussion/' + data['id']
    try:
        async with client:
            await client.post('/api/discussion', headers=headers, json=data)
            await entered.wait()
            turn = (await client.get(path)).json()['turns'][0]
            assert turn['status'] == 'thinking'
            for state in ('completed', 'playing'):
                response = await client.post('/api/turn/' + turn['id'] + '/playback', headers=headers, json={
                    'state': state, 'position_seconds': 0, 'duration_seconds': 0,
                })
                assert response.status_code == 409
            release.set()
            await settle(app)
            assert (await client.post(path + '/advance', headers=headers, json={
                'turn_id': turn['id'], 'outcome': 'completed',
            })).status_code == 409
            assert len(bridge.requests) == 1
    finally:
        release.set()
        await settle(app)


async def test_cancelled_consumer_cannot_publish_late_chunks(tmp_path):
    speech = GatedSpeech()
    app, client, headers, _ = setup(tmp_path, speech=speech)
    data = payload()
    try:
        async with client:
            await client.post('/api/turn', headers=headers, json=data)
            assert await asyncio.to_thread(speech.first.wait, 2)
            turn = app.state.service.turns[data['id']]
            before = app.state.service.snapshot(turn)
            turn['_task'].cancel()
            await asyncio.gather(turn['_task'], return_exceptions=True)
            speech.release.set()
            assert await asyncio.to_thread(speech.finished.wait, 2)
            assert turn['status'] == 'error' and not turn['audio_complete']
            assert len(turn['audio_chunks']) == len(before['audio_chunks']) == 1
    finally:
        speech.release.set()
        await asyncio.gather(*app.state.service.tasks, return_exceptions=True)


@pytest.mark.parametrize('mode', ['invalid_chunk', 'no_chunks', 'mismatched_final', 'too_many'])
async def test_invalid_or_incomplete_stream_does_not_publish_success(tmp_path, mode):
    class InvalidSpeech:
        def synthesize_stream(self, text, on_chunk):
            if mode == 'invalid_chunk':
                on_chunk(b'broken WAV')
            elif mode == 'mismatched_final':
                on_chunk(wav())
            elif mode == 'too_many':
                for _ in range(513):
                    on_chunk(wav(1))
            return wav(4800)
    app, client, headers, _ = setup(tmp_path, speech=InvalidSpeech())
    data = payload()
    async with client:
        await client.post('/api/turn', headers=headers, json=data)
        await finish(app)
        turn = (await client.get('/api/turn/' + data['id'])).json()
        assert turn['status'] == 'error'
        assert not turn['audio_complete'] and 'audio_url' not in turn
        assert turn['text']
