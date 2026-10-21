"""Local-only synthetic ASR timing, no microphone, HTTP, model download or playback.

Run with the MLX voice environment; --model must be an existing model directory.
WAVs are retained in a private temporary directory. Reports contain synthetic
text only. First call includes lazy model loading; warm calls reuse that model.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from voice.speech import Speech


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--prewarm', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.repeats <= 10:
        parser.error('repeats must be 1..10')
    speech = Speech(args.model)
    directory = Path(tempfile.mkdtemp(prefix='conest-synthetic-asr-'))
    phrases = ['你能听到我说话吗？', '请告诉我现在的工作进度。只需要简短回答，不要执行任何任务。']
    fixtures = []
    for i, phrase in enumerate(phrases):
        wav = directory / f'synthetic-{i}.wav'
        subprocess.run(['/usr/bin/say', '-v', 'Tingting', '-o', str(wav),
                        '--file-format=WAVE', '--data-format=LEI16@16000',
                        '--channels=1', '-f', '-'], input=phrase.encode(), check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        fixtures.append((phrase, wav.read_bytes()))
    report = {'time': time.strftime('%Y-%m-%d %H:%M:%S %z'),
              'system': platform.platform(), 'python': platform.python_version(),
              'mlx_whisper': importlib.metadata.version('mlx-whisper'),
              'model_revision': Path(speech.model_path).name, 'fixtures_dir': str(directory),
              'samples': []}
    def measure(label, index):
        phrase, data = fixtures[index]
        text, timing = speech.transcribe_timed(data)
        row = dict(mode=label, fixture=index, expected=phrase, recognized=text,
                   wav_sha256=hashlib.sha256(data).hexdigest(), **timing)
        report['samples'].append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    if args.prewarm:
        report['startup_warmup'] = speech.warmup()
        print(json.dumps(report['startup_warmup']), flush=True)
    measure('first-after-warmup' if args.prewarm else 'cold-default', 0)
    for index in range(len(fixtures)):
        for _ in range(args.repeats):
            measure('warm-default', index)
    # A single-variable experiment only; no production settings are changed.
    original = speech._transcribe_fn
    speech._transcribe_fn = lambda *a, **kw: original(*a, **kw, without_timestamps=True)
    for index in range(len(fixtures)):
        for _ in range(args.repeats):
            measure('warm-no-timestamps', index)


if __name__ == '__main__':
    main()
