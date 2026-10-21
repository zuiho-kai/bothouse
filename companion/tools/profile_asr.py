"""Bounded, local-only ASR profiling of an existing synthetic WAV.

Never import this probe into a server: it temporarily instruments MLX classes
in this disposable process. No microphone, HTTP, TTS, playback, or model download.
Encoder evaluation is synchronized for attribution and can perturb throughput.
Reports contain numbers only, never transcripts, tokens, or model paths.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import importlib
import json
from pathlib import Path
import resource
import sys
import time


@contextmanager
def model_profile(holder, clock=time.perf_counter):
    """Measure cache lookups/loads without retaining model paths or weights."""
    descriptor = holder.__dict__['get_model']
    original = holder.get_model
    lookups = []

    def get_model(cls, model_path, dtype):
        row = {'cache_hit': cls.model is not None and cls.model_path == model_path,
               'lookup_ms': 0.0, 'succeeded': False}
        lookups.append(row)
        started = clock()
        try:
            result = original(model_path, dtype)
            row['succeeded'] = True
            return result
        finally:
            row['lookup_ms'] = round((clock() - started) * 1000, 3)

    holder.get_model = classmethod(get_model)
    try:
        yield lookups
    finally:
        holder.get_model = descriptor


@contextmanager
def decoding_profile(task_type, evaluate, clock=time.perf_counter):
    """Instrument real decode attempts, retaining no text or token values."""
    original_run = task_type.run
    original_features = task_type._get_audio_features
    attempts = []
    active = []

    def features(task, mel):
        started = clock()
        value = original_features(task, mel)
        # Includes any lazy mel-feature work feeding the encoder, not just
        # encoder kernels. No per-kernel attribution is claimed.
        evaluate(value)
        if active:
            active[-1]['features_encoder_ms'] += (clock() - started) * 1000
        return value

    def run(task, mel):
        row = {'temperature': float(task.options.temperature),
               'features_encoder_ms': 0.0, 'attempt_ms': 0.0, 'succeeded': False}
        attempts.append(row)
        active.append(row)
        started = clock()
        try:
            result = original_run(task, mel)
            row['succeeded'] = True
            # Count only; never retain tokens or decoded text.
            row['tokens'] = sum(len(item.tokens) for item in result)
            return result
        finally:
            row['attempt_ms'] = (clock() - started) * 1000
            active.pop()

    task_type.run = run
    task_type._get_audio_features = features
    try:
        yield attempts
    finally:
        task_type.run = original_run
        task_type._get_audio_features = original_features


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--synthetic-wav', required=True, type=Path)
    parser.add_argument('--repeats', default=2, type=int)
    parser.add_argument('--prewarm', action='store_true')
    parser.add_argument('--idle-seconds', default=0, type=int,
                        help='Bounded idle gap between samples (0..60); no keepalive.')
    args = parser.parse_args()
    if not 1 <= args.repeats <= 5:
        parser.error('--repeats must be 1..5')
    if not 0 <= args.idle_seconds <= 60:
        parser.error('--idle-seconds must be 0..60')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from voice.speech import Speech, _pcm_samples, MAX_WAV_BYTES, MAX_AUDIO_SECONDS

    # Validate before loading MLX or changing any class methods.
    with args.synthetic_wav.open('rb') as source:
        data = source.read(MAX_WAV_BYTES + 1)
    _pcm_samples(data, rate=16000, max_bytes=MAX_WAV_BYTES,
                 max_seconds=MAX_AUDIO_SECONDS)
    speech = Speech(args.model)  # Existing local model only.
    mlx = importlib.import_module('mlx.core')
    decoding = importlib.import_module('mlx_whisper.decoding')
    transcribe = importlib.import_module('mlx_whisper.transcribe')
    if args.prewarm:
        print(json.dumps({'warmup': speech.warmup()}), flush=True)
    with (decoding_profile(decoding.DecodingTask, mlx.eval) as attempts,
          model_profile(transcribe.ModelHolder) as lookups):
        for sample in range(args.repeats):
            if sample and args.idle_seconds:
                print(json.dumps({'idle_seconds': args.idle_seconds}), flush=True)
                time.sleep(args.idle_seconds)
            attempts.clear()
            lookups.clear()
            before = resource.getrusage(resource.RUSAGE_SELF)
            text, timings = speech.transcribe_timed(data)
            after = resource.getrusage(resource.RUSAGE_SELF)
            print(json.dumps({
                'sample': sample + 1, 'timings': timings, 'chars': len(text),
                'model_lookups': lookups,
                'attempts': [{k: round(v, 3) if type(v) is float else v
                              for k, v in row.items()} for row in attempts],
                'major_faults': after.ru_majflt - before.ru_majflt,
                'minor_faults': after.ru_minflt - before.ru_minflt,
                'cpu_ms': round(1000 * (after.ru_utime + after.ru_stime -
                                       before.ru_utime - before.ru_stime), 3),
            }), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Backend exception bodies may contain paths or decoded content.
        print(json.dumps({'failed': True, 'error_type': type(error).__name__}), flush=True)
        raise SystemExit(1) from None
