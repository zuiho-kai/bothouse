"""Exercise actual worker pipes without downloading or running a model."""
import subprocess
import sys
import venv

import pytest

from voice.neural_tts import NeuralTTS


def worker(tmp_path, monkeypatch, mode='ok'):
    monkeypatch.setattr('voice.neural_tts._cache_directory', lambda: tmp_path)
    (tmp_path / 'model.safetensors').write_bytes(b'fixture')
    script = tmp_path / 'worker.py'
    script.write_text('''import json,sys,wave,time
for line in sys.stdin:
    r=json.loads(line)
    mode=sys.argv[1]
    if mode=='hang': time.sleep(10)
    if mode=='exit': sys.exit(1)
    with wave.open(r['output'],'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(b'\\0\\0'*2400)
    print(json.dumps({'id':r['id'] if mode!='wrong' else 'stale', 'ok':True}),flush=True)
''')
    class FakeTTS(NeuralTTS):
        def _start(self):
            if not self.process or self.process.poll() is not None:
                self.process = subprocess.Popen([sys.executable, '-u', str(script), mode],
                                                stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    return FakeTTS(sys.executable, str(tmp_path), timeout=0.3)


def test_worker_reuses_process_and_correlates_answers(tmp_path, monkeypatch):
    tts = worker(tmp_path, monkeypatch)
    try:
        assert tts.synthesize('第一句').startswith(b'RIFF')
        pid = tts.process.pid
        first = tts.last_metrics['id']
        assert tts.synthesize('第二句').startswith(b'RIFF')
        assert tts.process.pid == pid
        assert tts.last_metrics['id'] != first
    finally:
        tts.close()


@pytest.mark.parametrize('mode', ['wrong', 'hang', 'exit'])
def test_worker_failure_does_not_return_stale_or_fallback_audio(tmp_path, monkeypatch, mode):
    tts = worker(tmp_path, monkeypatch, mode)
    with pytest.raises(RuntimeError, match='文字回答仍然保留'):
        tts.synthesize('一句话')
    assert tts.process is None


def test_missing_model_fails_without_download(tmp_path):
    with pytest.raises(ValueError, match='不完整'):
        NeuralTTS(sys.executable, str(tmp_path))


def test_worker_preserves_virtual_environment_interpreter(tmp_path):
    environment = tmp_path / 'tts-env'
    venv.EnvBuilder(with_pip=False, symlinks=True).create(environment)
    (tmp_path / 'model.safetensors').write_bytes(b'fixture')
    tts = NeuralTTS(str(environment / 'bin/python'), str(tmp_path))
    prefix = subprocess.check_output([tts.python, '-c', 'import sys;print(sys.prefix)'], text=True).strip()
    assert prefix == str(environment)
