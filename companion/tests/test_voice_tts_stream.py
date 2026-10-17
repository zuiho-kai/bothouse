"""Real worker pipes, deterministic audio, no model or automatic file cleanup."""
from concurrent.futures import ThreadPoolExecutor
import io
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import ModuleType, SimpleNamespace
import wave

import pytest
import numpy as np

from voice import neural_tts, tts_worker
from voice.neural_tts import NeuralTTS


FAKE_WORKER = r'''
import base64, io, json, os, sys, wave
def wav(pcm):
    out = io.BytesIO()
    with wave.open(out, 'wb') as w:
        w.setparams((1, 2, 24000, 0, 'NONE', ''))
        w.writeframes(pcm)
    return out.getvalue()
for line in sys.stdin:
    r = json.loads(line)
    first, second = wav(b'\x01\x00' * 16), wav(b'\x02\x00' * 8)
    def chunk(seq, audio):
        return {'id': r['id'], 'type': 'chunk', 'seq': seq,
                'wav': base64.b64encode(audio).decode('ascii')}
    def emit(frame):
        print(json.dumps(frame), flush=True)
    if r.get('stream'):
        emit(chunk(0, first))
    os.read(int(sys.argv[1]), 1)  # Only the first callback can release synthesis.
    if r.get('stream'):
        emit(chunk(1, second))
        emit({'id': r['id'], 'type': 'done', 'seq': 2, 'ok': True,
              'total_bytes': len(first) + len(second), 'samples': 24})
    else:
        with open(r['output'], 'wb') as f:
            f.write(wav(b'\x01\x00' * 16 + b'\x02\x00' * 8))
        emit({'id': r['id'], 'ok': True})
'''


@pytest.fixture
def worker_factory(monkeypatch):
    root = Path(tempfile.mkdtemp(prefix='conest-39-tts-'))
    (root / 'model.safetensors').write_bytes(b'fixture')
    monkeypatch.setattr('voice.neural_tts._cache_directory', lambda: root)
    workers = []

    def create(script=FAKE_WORKER, *, pass_fds=(), args=(), timeout=2):
        class FakeTTS(NeuralTTS):
            def _start(self):
                if self.process is None or self.process.poll() is not None:
                    self.launches += 1
                    self.process = subprocess.Popen(
                        [sys.executable, '-u', '-c', script, *map(str, args)],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                        pass_fds=pass_fds,
                    )
        tts = FakeTTS(sys.executable, str(root), timeout=timeout)
        tts.launches = 0
        workers.append(tts)
        return tts

    yield create
    for tts in workers:
        tts.close()


def pcm(audio):
    with wave.open(io.BytesIO(audio), 'rb') as reader:
        assert (reader.getframerate(), reader.getnchannels(), reader.getsampwidth()) == (24000, 1, 2)
        return reader.readframes(reader.getnframes())


def test_first_chunk_callback_releases_blocked_synthesis(worker_factory):
    gate_read, gate_write = os.pipe()
    tts = worker_factory(pass_fds=(gate_read,), args=(gate_read,))
    chunks = []
    first = threading.Event()

    def receive(audio):
        chunks.append(audio)
        if len(chunks) == 1:
            first.set()
            os.write(gate_write, b'1')

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            # Exercise the previous blocking API on the baseline, too.
            synthesize = getattr(tts, 'synthesize_stream', lambda text, callback: tts.synthesize(text))
            result = pool.submit(synthesize, '第一块之后才继续合成', receive)
            assert first.wait(1), 'first chunk was held until complete synthesis'
            audio = result.result(timeout=3)
        assert len(chunks) == 2
        assert pcm(audio) == b'\x01\x00' * 16 + b'\x02\x00' * 8
        assert pcm(audio) == b''.join(map(pcm, chunks))
    finally:
        os.close(gate_read)
        os.close(gate_write)


SCRIPTED_WORKER = r'''
import base64, io, json, os, sys, time, wave
mode = sys.argv[1]
previous = None
for line in sys.stdin:
    r = json.loads(line)
    if previous and mode == 'late':
        print(json.dumps(previous), flush=True)
    frames = []
    for seq, size in enumerate((16, 8)):
        out = io.BytesIO()
        with wave.open(out, 'wb') as w:
            w.setparams((1, 2, 16000 if mode == 'rate' else 24000, 0, 'NONE', ''))
            w.writeframes(bytes((seq + 1, 0)) * size)
        audio = out.getvalue()
        if mode == 'bad_wav': audio += b'trailer'
        frames.append({'id': r['id'], 'type': 'chunk', 'seq': seq,
                       'wav': base64.b64encode(audio).decode('ascii')})
    done = {'id': r['id'], 'type': 'done', 'seq': 2, 'ok': True,
            'total_bytes': 136, 'samples': 24, 'voice': r['voice']}
    frames.append(done)
    if mode == 'wrong_id': frames[0]['id'] = 'another-request'
    if mode == 'wrong_done_id': done['id'] = 'another-request'
    if mode == 'gap': frames[1]['seq'] = 2
    if mode == 'duplicate': frames[1] = frames[0]
    if mode == 'bool_seq': frames[0]['seq'] = False
    if mode == 'unexpected': frames[0]['type'] = 'notice'
    if mode == 'bad_base64': frames[0]['wav'] = '?'
    if mode == 'failed_chunk': frames[0]['ok'] = False
    if mode == 'failed': frames = frames[:1] + [dict(done, type='error', seq=1, ok=False)]
    if mode == 'false_done': done['ok'] = False
    if mode == 'truthy_done': done['ok'] = 1
    if mode == 'bytes_mismatch': done['total_bytes'] += 1
    if mode == 'samples_mismatch': done['samples'] += 1
    if mode == 'empty': frames = [dict(done, seq=0, total_bytes=0, samples=0)]
    if mode == 'trailing': frames.append(frames[0])
    if mode == 'long_line':
        os.write(1, b'x' * 1100000)
        continue
    if mode == 'bad_json':
        os.write(1, b'[]\n')
        continue
    if mode in ('exit', 'partial', 'hang'):
        os.write(1, (json.dumps(frames[0]) + '\n').encode())
        if mode == 'partial': os.write(1, b'{"id":')
        if mode == 'hang': time.sleep(10)
        sys.exit(1)
    # One atomic write: multiple complete frames are available in one read.
    os.write(1, ''.join(json.dumps(f) + '\n' for f in frames).encode())
    previous = done
'''


def test_multiple_frames_in_one_read_and_process_reuse(worker_factory, monkeypatch):
    reads = []
    original = os.read

    def read(fd, size):
        data = original(fd, size)
        reads.append(data)
        return data

    monkeypatch.setattr(neural_tts.os, 'read', read)
    tts = worker_factory(SCRIPTED_WORKER, args=('ok',))
    request_ids = []
    for voice in ('serena', 'uncle_fu'):
        chunks = []
        result = tts.synthesize_stream('测试', chunks.append, voice=voice)
        assert pcm(result) == b''.join(map(pcm, chunks))
        assert tts.last_metrics['voice'] == voice
        assert tts.last_metrics['first_chunk_seconds'] <= tts.last_metrics['seconds']
        assert Path(tts.last_metrics['path']).read_bytes() == result
        request_ids.append(tts.last_metrics['id'])
    assert request_ids[0] != request_ids[1]
    assert tts.launches == 1
    assert any(data.count(b'\n') == 3 for data in reads)


@pytest.mark.parametrize('mode, delivered', [
    ('wrong_id', 0), ('wrong_done_id', 2), ('gap', 1), ('duplicate', 1),
    ('bool_seq', 0), ('unexpected', 0), ('bad_base64', 0), ('bad_json', 0),
    ('failed_chunk', 0),
    ('rate', 0), ('bad_wav', 0), ('empty', 0), ('long_line', 0),
    ('failed', 1), ('false_done', 2), ('truthy_done', 2),
    ('bytes_mismatch', 2), ('samples_mismatch', 2),
    ('exit', 1), ('partial', 1), ('hang', 1), ('trailing', 2),
])
def test_protocol_failures_abort_even_after_delivery(worker_factory, mode, delivered):
    tts = worker_factory(SCRIPTED_WORKER, args=(mode,), timeout=0.5)
    chunks = []
    with pytest.raises(RuntimeError, match='文字回答仍然保留'):
        tts.synthesize_stream('测试', chunks.append)
    assert len(chunks) == delivered
    assert tts.process is None
    assert tts.last_metrics == {}
    assert tts.launches == 1  # No automatic regeneration after any failure.


@pytest.mark.parametrize('limit, value', [
    ('MAX_WAV_BYTES', 130), ('MAX_SAMPLES', 20), ('MAX_CHUNKS', 1),
    ('MAX_WIRE_BYTES', 250), ('MAX_FRAME_BYTES', 100),
])
def test_request_limits_are_cumulative(worker_factory, monkeypatch, limit, value):
    monkeypatch.setattr(neural_tts, limit, value)
    tts = worker_factory(SCRIPTED_WORKER, args=('ok',))
    chunks = []
    with pytest.raises(RuntimeError):
        tts.synthesize_stream('测试', chunks.append)
    assert len(chunks) <= 1
    assert tts.process is None and tts.launches == 1


def test_late_frames_never_reach_next_request_callback(worker_factory):
    tts = worker_factory(SCRIPTED_WORKER, args=('late',))
    tts.synthesize_stream('上一句', lambda chunk: None)
    chunks = []
    with pytest.raises(RuntimeError):
        tts.synthesize_stream('下一句', chunks.append)
    assert chunks == []
    assert tts.process is None and tts.last_metrics == {}


@pytest.mark.parametrize('error', [ValueError('consumer error'), RuntimeError('consumer error')])
def test_callback_error_is_preserved_and_aborts_worker(worker_factory, error):
    tts = worker_factory(SCRIPTED_WORKER, args=('ok',))
    chunks = []

    def receive(chunk):
        chunks.append(chunk)
        raise error

    with pytest.raises(type(error)) as caught:
        tts.synthesize_stream('测试', receive)
    assert caught.value is error
    assert len(chunks) == 1
    assert tts.process is None and tts.launches == 1
    # A new, explicitly requested synthesis starts cleanly after the abort.
    assert pcm(tts.synthesize_stream('新的请求', lambda chunk: None))
    assert tts.launches == 2


def test_callback_time_counts_against_deadline(worker_factory, monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(neural_tts.time, 'monotonic', lambda: clock[0])
    tts = worker_factory(SCRIPTED_WORKER, args=('ok',), timeout=1)
    chunks = []

    def receive(chunk):
        chunks.append(chunk)
        clock[0] = 2.0

    with pytest.raises(RuntimeError):
        tts.synthesize_stream('测试', receive)
    assert len(chunks) == 1 and tts.process is None


@pytest.mark.parametrize('text', [None, '', ' \n', '字' * 501, '坏\x00文本',
                                  '[[slnc 99]]', 'text]]', '\ud800'])
def test_neural_stream_and_blocking_validate_before_worker(worker_factory, text):
    tts = worker_factory(SCRIPTED_WORKER, args=('ok',))
    for call in (lambda: tts.synthesize(text),
                 lambda: tts.synthesize_stream(text, lambda chunk: None)):
        with pytest.raises(ValueError):
            call()
    assert tts.launches == 0


def run_model_worker(monkeypatch, results, *, streaming=True, text='测试'):
    """Exercise worker main/IPC with an external model iterator, no MLX imports."""
    root = Path(tempfile.mkdtemp(prefix='conest-39-model-'))
    (root / 'model.safetensors').write_bytes(b'fixture')
    output = io.StringIO()
    calls = []

    def generate(*args, **kwargs):
        calls.append((args, kwargs))
        yield from results(output)

    model = SimpleNamespace(sample_rate=24000, generate_custom_voice=generate)
    for name in ('mlx_audio', 'mlx_audio.tts', 'mlx_audio.tts.utils'):
        monkeypatch.setitem(sys.modules, name, ModuleType(name))
    sys.modules['mlx_audio.tts.utils'].load_model = lambda path: model
    request = {'id': 'model-test', 'text': text, 'voice': 'uncle_fu',
               'stream': streaming, 'output': str(root / 'full.wav')}
    monkeypatch.setattr(sys, 'argv', ['tts_worker.py', str(root)])
    monkeypatch.setattr(sys, 'stdin', io.StringIO(json.dumps(request) + '\n'))
    monkeypatch.setattr(sys, 'stdout', output)
    tts_worker.main()
    frames = [json.loads(line) for line in output.getvalue().splitlines()]
    return frames, calls, root / 'full.wav'


def model_chunk(tokens=8, *, final=False, audio=None):
    return SimpleNamespace(
        token_count=tokens, is_final_chunk=final, is_streaming_chunk=True,
        sample_rate=24000,
        audio=np.array([0.25, -0.25], dtype=np.float32) if audio is None else audio,
    )


@pytest.mark.parametrize('final', [False, True])
def test_model_emits_before_advancing_and_accepts_boundary_eos(monkeypatch, final):
    def results(output):
        yield model_chunk()
        # This runs when the iterator is resumed for the second chunk.
        first = json.loads(output.getvalue())
        assert first['type'] == 'chunk' and first['seq'] == 0
        print('library diagnostics')  # Redirected away from protocol stdout.
        yield model_chunk(3 if final else 8, final=final)

    frames, calls, _ = run_model_worker(monkeypatch, results)
    assert [f['type'] for f in frames] == ['chunk', 'chunk', 'done']
    assert [f['seq'] for f in frames] == [0, 1, 2]
    assert frames[-1]['ok'] is True
    assert frames[-1]['samples'] == 4 and frames[-1]['total_bytes'] == 96
    for f in frames[:2]:
        assert pcm(base64.b64decode(f['wav'])) == b'\x00\x20\x00\xe0'
    assert calls[0][1]['stream'] is True
    assert calls[0][1]['streaming_interval'] == 0.64


@pytest.mark.parametrize('final', [False, True])
def test_model_cumulative_token_limit_rejects_truncation(monkeypatch, final):
    def results(output):
        for i in range(32):
            yield model_chunk(final=final and i == 31)

    frames, _, _ = run_model_worker(monkeypatch, results)
    assert len(frames) == 32
    assert frames[-1]['type'] == 'error' and frames[-1]['ok'] is False
    assert frames[-1]['seq'] == 31
    assert all(f['type'] != 'done' for f in frames)


@pytest.mark.parametrize('mode', ['exception', 'after_final', 'nan', 'empty', 'stereo', 'tokens'])
def test_model_failure_after_audio_never_emits_success(monkeypatch, mode):
    def results(output):
        yield model_chunk(final=mode == 'after_final')
        if mode == 'exception':
            raise RuntimeError('private model payload')
        if mode == 'nan':
            yield model_chunk(audio=np.array([np.nan]))
        elif mode == 'empty':
            yield model_chunk(audio=np.array([]))
        elif mode == 'stereo':
            yield model_chunk(audio=np.zeros((2, 2)))
        else:
            yield model_chunk(tokens=0 if mode == 'tokens' else 8)

    frames, _, _ = run_model_worker(monkeypatch, results)
    assert [f['type'] for f in frames] == ['chunk', 'error']
    assert 'private' not in json.dumps(frames)


def test_nonstreaming_worker_keeps_replay_and_emits_only_completion(monkeypatch):
    def results(output):
        yield model_chunk()
        assert not output.getvalue()
        yield model_chunk(2, final=True)

    frames, calls, path = run_model_worker(monkeypatch, results, streaming=False)
    assert len(frames) == 1 and frames[0]['ok'] is True
    assert pcm(path.read_bytes()) == b'\x00\x20\x00\xe0' * 2
    assert calls[0][1]['stream'] is True


@pytest.mark.parametrize('text', ['[[slnc 99]]', '坏\x00文本', '\ud800'])
def test_worker_rejects_invalid_text_before_model(monkeypatch, text):
    frames, calls, _ = run_model_worker(monkeypatch, lambda output: iter(()), text=text)
    assert calls == []
    assert len(frames) == 1 and frames[0]['type'] == 'error'


def test_empty_generation_is_not_success(monkeypatch):
    frames, _, _ = run_model_worker(monkeypatch, lambda output: iter(()))
    assert len(frames) == 1 and frames[0]['type'] == 'error'


@pytest.mark.parametrize('limit, value', [('MAX_WAV_BYTES', 90), ('MAX_SAMPLES', 3)])
def test_worker_limits_apply_before_emitting_excess_audio(monkeypatch, limit, value):
    monkeypatch.setattr(tts_worker, limit, value)
    frames, _, _ = run_model_worker(monkeypatch, lambda output: iter([model_chunk(), model_chunk()]))
    assert [f['type'] for f in frames] == ['chunk', 'error']
