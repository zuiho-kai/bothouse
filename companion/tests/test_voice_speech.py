"""Mock tests by default; no model, say, network, or directory cleanup.

Fixtures are retained under ~/Library/Caches/yijiazi-voice-tests/run-*.
Run the independent real smoke test explicitly (prints text/timing, no audio):
YIJIAZI_VOICE_REAL_MODEL=/absolute/model/path .venv/bin/python -B -m pytest \
    -p no:cacheprovider -q -s tests/test_voice_speech.py -k real_local
"""

from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import socket
import stat
import struct
import subprocess
import tempfile
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock
import wave

import numpy as np
import pytest

from voice import speech
from voice.speech import Speech


def wav(*, rate=16000, channels=1, width=2, seconds=0.2, samples=None):
    if samples is None:
        samples = (np.sin(np.arange(round(rate * seconds)) * 0.1) * 12000).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setparams((channels, width, rate, 0, "NONE", ""))
        writer.writeframes(np.asarray(samples).tobytes())
    return output.getvalue()


def replace_u32(data, offset, value):
    result = bytearray(data)
    struct.pack_into("<I", result, offset, value)
    return bytes(result)


@pytest.fixture(scope="module")
def retained_root():
    root = Path.home() / "Library" / "Caches" / "yijiazi-voice-tests"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="run-", dir=root))


@pytest.fixture(scope="module")
def model_dir(retained_root):
    model = retained_root / "model"
    model.mkdir(mode=0o700)
    (model / "config.json").write_text("{}")
    (model / "weights.safetensors").write_bytes(b"mock weights")
    return model


@pytest.fixture
def backend(monkeypatch):
    transcribe = Mock(return_value={"text": "  你好，世界。  "})
    importer = Mock(return_value=SimpleNamespace(transcribe=transcribe))
    monkeypatch.setattr(speech.importlib, "import_module", importer)
    return SimpleNamespace(transcribe=transcribe, importer=importer)


@pytest.fixture
def engine(model_dir, backend):
    return Speech(str(model_dir))


@pytest.mark.parametrize("payload", [
    b"", b"not a wav", None, bytearray(b"RIFF"),
    wav(rate=24000), wav(rate=8000), wav(channels=2), wav(width=1), wav(width=3),
    wav(seconds=30.001), b"x" * 1_000_001,
    wav(samples=np.array([], dtype="<i2")),
    wav(samples=np.zeros(3200, dtype="<i2")),
    wav(samples=np.full(3200, 8000, dtype="<i2")),  # DC offset
    wav(samples=np.tile(np.array([-2, 2], dtype="<i2"), 1600)),
    wav(samples=np.r_[np.int16(16000), np.zeros(3199, dtype="<i2")]),
    wav()[:-2], wav() + b"hidden trailer",
    replace_u32(wav(), 4, 12), replace_u32(wav(), 40, 400000),
    replace_u32(wav(), 28, 1), replace_u32(wav(), 32, 0),
    wav()[:20] + b"\x03\x00" + wav()[22:],  # IEEE float format tag
])
def test_reject_bad_audio_before_import(engine, backend, payload):
    with pytest.raises(ValueError):
        engine.transcribe(payload)
    backend.importer.assert_not_called()


def test_accept_exact_thirty_seconds_numpy_chinese_and_lazy(engine, backend):
    backend.importer.assert_not_called()
    assert engine.transcribe(wav(seconds=30)) == "你好，世界。"
    assert engine.transcribe(wav()) == "你好，世界。"
    backend.importer.assert_called_once_with("mlx_whisper")
    samples = backend.transcribe.call_args.args[0]
    assert isinstance(samples, np.ndarray) and samples.dtype == np.float32
    assert samples.shape == (3200,) and np.max(np.abs(samples)) <= 1
    assert backend.transcribe.call_args.kwargs == {
        "path_or_hf_repo": engine.model_path, "language": "zh", "task": "transcribe",
        "verbose": None, "condition_on_previous_text": False,
    }


def test_reject_duplicate_chunks(engine):
    original = wav()
    for chunk in (original[12:36], original[36:]):
        duplicate = original + chunk
        with pytest.raises(ValueError):
            engine.transcribe(replace_u32(duplicate, 4, len(duplicate) - 8))


def test_startup_warmup_reuses_model_without_changing_recognition(engine, backend):
    first = engine.warmup()
    assert first["cached"] is False
    samples = backend.transcribe.call_args.args[0]
    assert samples.shape == (16000,) and not samples.any()
    assert backend.transcribe.call_args.kwargs["sample_len"] == 1
    assert engine.warmup()["cached"] is True
    assert backend.transcribe.call_count == 1
    assert engine.transcribe(wav()) == "你好，世界。"
    backend.importer.assert_called_once()
    assert "sample_len" not in backend.transcribe.call_args.kwargs
    assert "temperature" not in backend.transcribe.call_args.kwargs


def test_failed_warmup_can_retry_and_concurrent_warmups_run_once(engine, backend):
    backend.transcribe.side_effect = RuntimeError("private backend error")
    with pytest.raises(RuntimeError):
        engine.warmup()
    backend.transcribe.side_effect = None
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: engine.warmup(), range(4)))
    assert sum(not result["cached"] for result in results) == 1
    assert backend.transcribe.call_count == 2


def test_accept_unknown_padded_chunk(engine):
    original = wav()
    extended = original[:12] + b"JUNK\x01\x00\x00\x00x\x00" + original[12:]
    assert engine.transcribe(replace_u32(extended, 4, len(extended) - 8))


def test_model_paths_are_local_and_complete(retained_root, model_dir, backend):
    for path in ("", "mlx-community/not-a-local-model", str(retained_root / "missing"),
                 str(model_dir / "config.json"), str(retained_root)):
        with pytest.raises(ValueError):
            Speech(path)
    backend.importer.assert_not_called()


def test_huggingface_cache_root_resolves_without_download(retained_root, model_dir):
    root = retained_root / "hf-cache"
    (root / "refs").mkdir(parents=True)
    (root / "snapshots").mkdir()
    revision = "a" * 40
    (root / "refs/main").write_text(revision)
    (root / "snapshots" / revision).symlink_to(model_dir, target_is_directory=True)
    assert Speech(str(root)).model_path == str(model_dir)


def test_missing_model_rechecked_before_backend(engine, backend, monkeypatch):
    resolver = Mock(side_effect=ValueError("模型已不可用"))
    monkeypatch.setattr(speech, "_resolve_model_path", resolver)
    with pytest.raises(ValueError, match="模型已不可用"):
        engine.transcribe(wav())
    backend.importer.assert_not_called()


def test_import_error_is_readable(engine, backend):
    backend.importer.side_effect = ImportError("no mlx")
    with pytest.raises(RuntimeError, match="requirements-voice.txt"):
        engine.transcribe(wav())


def test_backend_errors_and_empty_output(engine, backend):
    backend.transcribe.side_effect = RuntimeError("private payload /private/internal/model")
    with pytest.raises(RuntimeError, match="本地语音识别失败") as caught:
        engine.transcribe(wav())
    assert "private" not in str(caught.value)
    assert caught.value.__cause__ is backend.transcribe.side_effect
    backend.transcribe.side_effect = None
    backend.transcribe.return_value = {"text": " "}
    with pytest.raises(ValueError, match="未识别到"):
        engine.transcribe(wav())


def test_model_calls_are_serialized_across_instances(model_dir, backend):
    active = peak = 0
    guard = threading.Lock()

    def transcribe(*args, **kwargs):
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
        time.sleep(0.02)
        with guard:
            active -= 1
        return {"text": "测试"}

    backend.transcribe.side_effect = transcribe
    engines = [Speech(str(model_dir)), Speech(str(model_dir))]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(engines[i % 2].transcribe, wav()) for i in range(8)]
        assert [f.result(timeout=5) for f in futures] == ["测试"] * 8
    assert peak == 1


@pytest.fixture
def fake_say(monkeypatch, retained_root):
    monkeypatch.setattr(speech, "_cache_directory", lambda: retained_root)

    def run(args, **kwargs):
        Path(args[args.index("-o") + 1]).write_bytes(wav(rate=24000))
        return subprocess.CompletedProcess(args, 0)

    runner = Mock(side_effect=run)
    monkeypatch.setattr(speech.subprocess, "run", runner)
    return runner


def test_tts_uses_stdin_safe_args_unique_private_retained_wav(engine, fake_say):
    text = "你好； $(touch DO_NOT_EXECUTE) `echo nope` \n --voice=Other"
    output = engine.synthesize(text)
    engine.synthesize("第二次")
    paths = []
    for call in fake_say.call_args_list:
        args, kwargs = call.args[0], call.kwargs
        assert args[0] == "/usr/bin/say"
        assert args[-2:] == ["-f", "-"]
        assert "--data-format=LEI16@24000" in args and "--channels=1" in args
        assert text not in args
        assert kwargs["shell"] is False and kwargs["check"] is True
        assert kwargs["timeout"] == speech.TTS_TIMEOUT_SECONDS
        path = Path(args[args.index("-o") + 1])
        assert path.is_file() and stat.S_IMODE(path.stat().st_mode) == 0o600
        paths.append(path)
    assert paths[0] != paths[1]
    assert fake_say.call_args_list[0].kwargs["input"] == text.encode("utf-8")
    with wave.open(io.BytesIO(output)) as audio:
        assert (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) == (24000, 1, 2)


@pytest.mark.parametrize("text", [None, "", " \n", "字" * 501, "坏\x00文本",
                                   "[[slnc 999999999]]", "\ud800"])
def test_tts_rejects_invalid_text_before_say(engine, fake_say, text):
    with pytest.raises(ValueError):
        engine.synthesize(text)
    fake_say.assert_not_called()


@pytest.mark.parametrize("voice", ["", "?", "-o", "Tingting\nOther", None])
def test_invalid_voice(model_dir, voice):
    with pytest.raises(ValueError, match="音色"):
        Speech(str(model_dir), voice=voice)


@pytest.mark.parametrize("error, message", [
    (subprocess.TimeoutExpired("say", 180), "超时"),
    (subprocess.CalledProcessError(1, "say", stderr=b"private text"), "退出码 1"),
    (FileNotFoundError("say unavailable"), "语音合成"),
])
def test_tts_failures_are_readable_and_keep_files(engine, fake_say, error, message):
    fake_say.side_effect = error
    with pytest.raises(RuntimeError, match=message) as caught:
        engine.synthesize("你好")
    assert "private text" not in str(caught.value)
    args = fake_say.call_args.args[0]
    assert Path(args[args.index("-o") + 1]).is_file()


def test_tts_rejects_invalid_output(engine, fake_say):
    fake_say.side_effect = None  # Leaves the allocated file empty.
    with pytest.raises(RuntimeError, match="WAV 读取失败"):
        engine.synthesize("你好")


@pytest.mark.parametrize('text', [None, '', ' \n', '字' * 501, '坏\x00文本',
                                  '[[slnc 999999999]]', 'text]]', '\ud800'])
@pytest.mark.parametrize('kind', ['system', 'blocking', 'streaming'])
def test_stream_rejects_text_before_any_backend(engine, fake_say, text, kind):
    backend = Mock()
    if kind == 'blocking':
        engine.tts = SimpleNamespace(synthesize=backend)
    elif kind == 'streaming':
        engine.tts = SimpleNamespace(synthesize_stream=backend)
    callback = Mock()
    with pytest.raises(ValueError):
        engine.synthesize_stream(text, callback)
    fake_say.assert_not_called()
    backend.assert_not_called()
    callback.assert_not_called()


def test_stream_delegates_voice_and_delivers_before_backend_returns(engine):
    chunks = []
    first, second, complete = wav(rate=24000), wav(rate=24000), wav(rate=24000, seconds=0.4)

    def stream(text, on_chunk, *, voice):
        assert text == '测试' and voice == 'serena'
        on_chunk(first)
        assert chunks == [first]
        on_chunk(second)
        return complete

    engine.tts = SimpleNamespace(synthesize_stream=stream)
    assert engine.synthesize_stream('测试', chunks.append, voice='serena') == complete
    assert chunks == [first, second]


def test_stream_system_say_falls_back_to_one_chunk(engine, fake_say):
    chunks = []
    assert engine.synthesize_stream('测试', chunks.append) == chunks[0]
    assert len(chunks) == 1 and fake_say.call_count == 1
    with pytest.raises(ValueError, match='Qwen'):
        engine.synthesize_stream('测试', chunks.append, voice='serena')


def test_stream_blocking_backend_compatibility_and_voice(engine):
    backend = Mock(return_value=wav(rate=24000))
    engine.tts = SimpleNamespace(synthesize=backend)
    chunks = []
    assert engine.synthesize_stream('测试', chunks.append, voice='serena') == chunks[0]
    backend.assert_called_once_with('测试', voice='serena')
    assert len(chunks) == 1
    backend.return_value = b'invalid'
    with pytest.raises(ValueError):
        engine.synthesize_stream('测试', chunks.append)
    assert len(chunks) == 1


def test_stream_fallback_callback_failure_is_not_swallowed(engine, fake_say):
    error = ValueError('callback failed')
    callback = Mock(side_effect=error)
    with pytest.raises(ValueError) as caught:
        engine.synthesize_stream('测试', callback)
    assert caught.value is error
    assert callback.call_count == 1 and fake_say.call_count == 1


@pytest.mark.skipif(not os.environ.get("YIJIAZI_VOICE_REAL_MODEL"),
                    reason="Independent opt-in local model/say smoke test")
def test_real_local_say_and_whisper(monkeypatch):
    from scipy.signal import resample_poly

    def no_network(*args, **kwargs):
        raise AssertionError("真实语音验证禁止联网")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    engine = Speech(os.environ["YIJIAZI_VOICE_REAL_MODEL"])
    text = "你好，这是本地语音测试。今天我们一起读书。"
    started = time.perf_counter()
    audio = engine.synthesize(text)
    synthesis_seconds = time.perf_counter() - started
    with wave.open(io.BytesIO(audio)) as reader:
        assert (reader.getframerate(), reader.getnchannels(), reader.getsampwidth()) == (24000, 1, 2)
        source = np.frombuffer(reader.readframes(reader.getnframes()), dtype="<i2").astype(np.float32)
    # TTS is 24 kHz; ASR deliberately refuses it. Resample only in this fixture.
    resampled = np.clip(np.rint(resample_poly(source, 2, 3)), -32768, 32767).astype("<i2")
    asr_input = wav(samples=resampled)
    started = time.perf_counter()
    recognized = engine.transcribe(asr_input)
    transcription_seconds = time.perf_counter() - started
    print("VOICE_REAL_RESULT " + json.dumps({
        "synthesized_text": text, "recognized_text": recognized,
        "synthesis_seconds": round(synthesis_seconds, 3),
        "cold_transcription_seconds": round(transcription_seconds, 3),
        "audio_seconds": round(len(resampled) / 16000, 3),
        "tts_bytes": len(audio), "asr_bytes": len(asr_input),
        "cache_directory": str(speech._cache_directory()),
    }, ensure_ascii=False))
    assert "语音测试" in recognized and "读书" in recognized


def test_asr_timings_are_per_request_without_changing_inference(engine, backend):
    text, timings = engine.transcribe_timed(wav())
    assert text == '你好，世界。'
    assert timings['audio_ms'] == 200
    assert set(timings) == {'audio_ms', 'validation_ms', 'queue_ms', 'setup_ms', 'inference_ms', 'total_ms'}
    assert all(isinstance(v, int) and v >= 0 for v in timings.values())
    assert backend.transcribe.call_count == 1
