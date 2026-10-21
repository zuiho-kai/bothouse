"""Probe contracts without loading MLX, audio, network, or speakers."""
from types import SimpleNamespace
import json

import pytest

from tools.profile_asr import decoding_profile, model_profile


def test_model_profile_distinguishes_cache_and_restores_classmethod():
    now = [0.0]

    class Holder:
        model = None
        model_path = None

        @classmethod
        def get_model(cls, model_path, dtype):
            if cls.model is None or cls.model_path != model_path:
                now[0] += 0.2
                cls.model = object()
                cls.model_path = model_path
            return cls.model

    original = Holder.__dict__['get_model']
    with model_profile(Holder, lambda: now[0]) as rows:
        first = Holder.get_model('PRIVATE PATH', None)
        assert Holder.get_model('PRIVATE PATH', None) is first
        assert Holder.get_model('OTHER PRIVATE PATH', None) is not first
    assert Holder.__dict__['get_model'] is original
    assert [r['cache_hit'] for r in rows] == [False, True, False]
    assert [r['lookup_ms'] for r in rows] == [200, 0, 200]
    assert all(r['succeeded'] for r in rows)
    assert 'PRIVATE' not in json.dumps(rows)


def test_model_profile_restores_after_failed_load():
    class Holder:
        model = None
        model_path = None

        @classmethod
        def get_model(cls, model_path, dtype):
            raise RuntimeError('PRIVATE LOAD FAILURE')

    original = Holder.__dict__['get_model']
    with pytest.raises(RuntimeError):
        with model_profile(Holder) as rows:
            Holder.get_model('PRIVATE PATH', None)
    assert Holder.__dict__['get_model'] is original
    assert rows[0]['succeeded'] is False
    assert 'PRIVATE' not in json.dumps(rows)


def test_profile_waits_for_encoder_and_never_records_content():
    now = [0.0]
    events = []

    class Task:
        options = SimpleNamespace(temperature=0.0)

        def _get_audio_features(self, mel):
            events.append('encode')
            return mel

        def run(self, mel):
            self._get_audio_features(mel)
            events.append('decode')
            now[0] += 0.03
            return [SimpleNamespace(tokens=[10, 11], text='PRIVATE TRANSCRIPT')]

    def evaluate(value):
        events.append('eval')
        now[0] += 0.02

    original = (Task.run, Task._get_audio_features)
    with decoding_profile(Task, evaluate, lambda: now[0]) as attempts:
        result = Task().run(object())
        assert result[0].text == 'PRIVATE TRANSCRIPT'
        Task.options.temperature = 0.2
        Task().run(object())
    assert (Task.run, Task._get_audio_features) == original
    assert events == ['encode', 'eval', 'decode'] * 2
    assert len(attempts) == 2
    assert attempts[0]['features_encoder_ms'] == pytest.approx(20)
    assert attempts[0]['attempt_ms'] == pytest.approx(50)
    assert attempts[0]['tokens'] == 2
    assert attempts[1]['temperature'] == 0.2
    assert 'PRIVATE' not in json.dumps(attempts)


def test_profile_restores_methods_after_failure():
    class Task:
        options = SimpleNamespace(temperature=0.0)

        def _get_audio_features(self, mel):
            return mel

        def run(self, mel):
            raise RuntimeError('PRIVATE BACKEND ERROR')

    original = (Task.run, Task._get_audio_features)
    with pytest.raises(RuntimeError):
        with decoding_profile(Task, lambda _: None) as attempts:
            Task().run(None)
    assert (Task.run, Task._get_audio_features) == original
    assert attempts[0]['succeeded'] is False
    assert 'PRIVATE' not in json.dumps(attempts)
