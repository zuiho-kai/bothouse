"""Resident transcriber for listener.mjs: one wav path per stdin line, one JSON line {"text": ...} back.

Run with a python that has mlx_whisper (and zhconv for simplified Chinese):
    <python> -I asr_worker.py
The model is loaded once; a wav per process would reload it for every sentence.
"""
import json, os, sys

out = os.fdopen(os.dup(1), "w", encoding="utf-8")
os.dup2(2, 1)  # anything the libraries print goes to stderr, stdout carries only the protocol

import mlx_whisper

try:
    import zhconv
    simplified = lambda s: zhconv.convert(s, "zh-cn")
except ImportError:
    simplified = lambda s: s

MODEL = "mlx-community/whisper-large-v3-turbo"

for line in sys.stdin:
    wav = line.strip()
    if not wav:
        continue
    text = ""
    try:
        r = mlx_whisper.transcribe(wav, path_or_hf_repo=MODEL, language="zh", condition_on_previous_text=False)
        # no_speech_prob: whisper makes up a sentence for noise; drop segments it marks as not speech.
        # source: 0.6 is whisper's own default no_speech_threshold (mlx_whisper/transcribe.py)
        text = "".join(s["text"] for s in r["segments"] if s.get("no_speech_prob", 0) < 0.6)
        text = simplified(text).strip()
    except Exception as e:  # one bad wav must not stop the meeting
        print(f"asr_worker: {wav}: {e}", file=sys.stderr)
    out.write(json.dumps({"text": text}, ensure_ascii=False) + "\n")
    out.flush()
