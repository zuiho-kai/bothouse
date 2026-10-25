import io
import json
import threading
import urllib.request
import wave
from dataclasses import replace
from http.server import ThreadingHTTPServer

import numpy as np
import pytest

from tests.test_voice_asr_diag import tone_wav
from tools import remote_asr_server
from voice import speech as speech_module
from voice.settings import Settings


def make_speech(tmp_path, monkeypatch, local_text='本机结果。', **kwargs):
    model = tmp_path / 'model'
    model.mkdir(exist_ok=True)
    (model / 'config.json').write_text('{}', encoding='utf-8')
    (model / 'weights.npz').write_bytes(b'')
    s = speech_module.Speech(str(model), remote_url='http://127.0.0.1:19940/transcribe', **kwargs)
    calls = []

    def local(*args, **kw):
        calls.append(1)
        return {'text': local_text}

    s._transcribe_fn = local
    return s, calls


def test_remote_result_is_used_and_timed(tmp_path, monkeypatch):
    monkeypatch.setattr(speech_module, '_remote_transcribe', lambda url, wav, timeout: ('远程结果。', 300.0))
    s, local = make_speech(tmp_path, monkeypatch)
    text, timings = s.transcribe_timed(tone_wav())
    assert text == '远程结果。' and local == []
    assert timings['remote_inference_ms'] == 300 and 'remote_ms' in timings


def test_remote_failure_falls_back_and_backs_off(tmp_path, monkeypatch):
    attempts = []

    def broken(url, wav, timeout):
        attempts.append(1)
        raise TimeoutError

    monkeypatch.setattr(speech_module, '_remote_transcribe', broken)
    s, local = make_speech(tmp_path, monkeypatch)
    assert s.transcribe_timed(tone_wav())[0] == '本机结果。'
    assert s.transcribe_timed(tone_wav())[0] == '本机结果。'
    assert attempts == [1] and len(local) == 2  # second turn skips the dead remote


def test_empty_remote_text_defers_to_local(tmp_path, monkeypatch):
    monkeypatch.setattr(speech_module, '_remote_transcribe', lambda url, wav, timeout: ('  ', None))
    s, local = make_speech(tmp_path, monkeypatch)
    assert s.transcribe_timed(tone_wav())[0] == '本机结果。' and local == [1]


def test_no_remote_url_never_calls_remote(tmp_path, monkeypatch):
    monkeypatch.setattr(speech_module, '_remote_transcribe', lambda *a: pytest.fail('remote called'))
    s, _ = make_speech(tmp_path, monkeypatch)
    s.remote_url = ''
    assert s.transcribe_timed(tone_wav())[0] == '本机结果。'


@pytest.mark.parametrize('field,value', [
    ('asr_remote_url', 'ftp://x'), ('asr_remote_url', 3),
    ('asr_remote_timeout_s', 0.1), ('asr_remote_timeout_s', True),
])
def test_settings_reject_bad_remote(field, value):
    base = Settings(project='p', role_name='r', session_key='s', bridge_socket='/tmp/b', model_path='/m')
    with pytest.raises(ValueError):
        replace(base, **{field: value}).validate()


class FakeModel:
    def transcribe(self, samples, **kwargs):
        assert samples.dtype == np.float32
        return [type('S', (), {'text': '你好'})()], None


def test_server_round_trip():
    server = ThreadingHTTPServer(('127.0.0.1', 0), remote_asr_server.make_handler(FakeModel(), threading.Lock()))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = 'http://127.0.0.1:%d/transcribe' % server.server_address[1]
        text, inference = speech_module._remote_transcribe(url, tone_wav(), 5)
        assert text == '你好' and inference is not None
        stereo = io.BytesIO()
        with wave.open(stereo, 'wb') as w:
            w.setparams((2, 2, 16000, 0, 'NONE', 'not compressed'))
            w.writeframes(b'\0' * 64)
        req = urllib.request.Request(url, data=stereo.getvalue(), headers={'Content-Type': 'audio/wav'})
        with pytest.raises(urllib.error.HTTPError) as err:
            urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=5)
        assert err.value.code == 400
    finally:
        server.shutdown()
