"""只记录诊断的契约测试：默认关闭、不改变返回值、绝不抛错。"""
import io
import json
import wave

import numpy as np
import pytest

from voice import asr_diag


def read_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line]


def tone_wav(seconds=0.5, rate=16000, amplitude=0.2):
    """有声正弦波：能通过识别入口的静音/音量门槛。"""
    frames = int(seconds * rate)
    samples = (amplitude * np.sin(2 * np.pi * 220 * np.arange(frames) / rate) * 32767)
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        audio.writeframes(samples.astype('<i2').tobytes())
    return out.getvalue()


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv(asr_diag.ENV_NAME, raising=False)


def test_disabled_by_default_is_a_noop(tmp_path, monkeypatch):
    assert not asr_diag.enabled()
    before = {'cpu_ms': 0.0, 'major_faults': 0, 'minor_faults': 0}
    after = {'cpu_ms': 900.0, 'major_faults': 1, 'minor_faults': 2}
    assert asr_diag.record({'total_ms': 1000}, before, after) is False
    assert list(tmp_path.iterdir()) == []


def test_records_wall_cpu_and_descheduled(tmp_path, monkeypatch):
    path = tmp_path / 'asr-diag.jsonl'
    monkeypatch.setenv(asr_diag.ENV_NAME, str(path))
    before = {'cpu_ms': 100.0, 'major_faults': 3, 'minor_faults': 10, 'loadavg': [1.0, 1.0, 1.0], 'rss_mb': 10.0}
    after = {'cpu_ms': 1300.0, 'major_faults': 9, 'minor_faults': 40, 'loadavg': [7.5, 6.0, 5.0], 'rss_mb': 512.0}
    assert asr_diag.record({'total_ms': 4000, 'inference_ms': 3900, 'queue_ms': 0,
                            'audio_ms': 3007}, before, after, idle_seconds=12.5)
    row, = read_rows(path)
    assert row['wall_ms'] == 4000
    assert row['cpu_ms'] == pytest.approx(1200.0)
    # 墙钟减 CPU 就是没在算的那段：等锁、被抢占、等缺页。
    assert row['descheduled_ms'] == pytest.approx(2800.0)
    assert row['cpu_ratio'] == pytest.approx(0.3)
    assert (row['major_faults'], row['minor_faults']) == (6, 30)
    assert row['loadavg'] == [7.5, 6.0, 5.0]
    assert row['idle_seconds'] == 12.5
    # 不写入内容型字段。
    assert not {'text', 'audio', 'path', 'model'} & set(row)


def test_unwritable_target_never_raises(tmp_path, monkeypatch):
    monkeypatch.setenv(asr_diag.ENV_NAME, str(tmp_path / 'missing' / 'diag.jsonl'))
    assert asr_diag.record({'total_ms': 10}, {'cpu_ms': 0}, {'cpu_ms': 5}) is False


def test_idle_is_none_first_then_measured_from_previous_end(monkeypatch):
    asr_diag._last_end = None
    assert asr_diag.take_idle(now=100.0) is None
    # A 14s recognition ending at 114, next one starting at 115: idle is 1s, not 15s.
    asr_diag.finish({'total_ms': 14000}, None, None, now=114.0)
    assert asr_diag.take_idle(now=115.0) == 1.0
    assert asr_diag.take_idle(now=115.0) == 1.0  # reading does not move the end mark


def test_transcribe_returns_the_same_text_and_timings(tmp_path, monkeypatch):
    """埋点开着也不能改变返回值，只多出一行记录。"""
    from voice.speech import Speech

    path = tmp_path / 'asr-diag.jsonl'
    monkeypatch.setenv(asr_diag.ENV_NAME, str(path))
    model = tmp_path / 'model'
    model.mkdir()
    (model / 'config.json').write_text('{}', encoding='utf-8')
    (model / 'weights.npz').write_bytes(b'')
    speech = Speech(str(model))
    speech._transcribe_fn = lambda *args, **kwargs: {'text': ' 同一句识别结果。 '}

    text, timings = speech.transcribe_timed(tone_wav())

    assert text == '同一句识别结果。'
    assert set(timings) == {'audio_ms', 'validation_ms', 'queue_ms',
                            'setup_ms', 'inference_ms', 'total_ms'}
    row, = read_rows(path)
    assert row['wall_ms'] == timings['total_ms']
    assert row['inference_ms'] == timings['inference_ms']
    assert row['cpu_ms'] >= 0


def make_speech(tmp_path):
    from voice.speech import Speech

    model = tmp_path / 'model'
    model.mkdir()
    (model / 'config.json').write_text('{}', encoding='utf-8')
    (model / 'weights.npz').write_bytes(b'')
    speech = Speech(str(model))
    speech._transcribe_fn = lambda *args, **kwargs: {'text': '照常识别。'}
    return speech


@pytest.mark.parametrize('broken', ['before', 'after'])
def test_sampling_failure_never_breaks_recognition(tmp_path, monkeypatch, broken):
    monkeypatch.setenv(asr_diag.ENV_NAME, str(tmp_path / 'diag.jsonl'))
    real, calls = asr_diag.snapshot, []

    def snapshot():
        calls.append(1)
        if (broken == 'before') == (len(calls) == 1):
            raise OSError('sampling broke')
        return real()

    monkeypatch.setattr(asr_diag, 'snapshot', snapshot)
    text, _ = make_speech(tmp_path).transcribe_timed(tone_wav())
    assert text == '照常识别。'
