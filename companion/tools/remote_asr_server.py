"""Remote speech recognition for the voice service, run on a CUDA machine (e.g. a 3060 in WSL).

POST /transcribe with a 16 kHz mono 16-bit WAV body returns {"text", "inference_ms"};
GET /health returns {"ok": true}. Binds to 127.0.0.1 only: reach it through an SSH
tunnel (scripts/voice/remote-asr-tunnel.sh), never expose it on the network.

    python remote_asr_server.py --port 9940 \
        --model deepdml/faster-whisper-large-v3-turbo-ct2 --compute-type int8_float16
"""

from __future__ import annotations

import argparse
import io
import json
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

MAX_BODY = 16_000 * 2 * 120 + 1024  # two minutes of audio


def load_samples(body: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(body)) as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16_000:
            raise ValueError("need 16 kHz mono 16-bit WAV")
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768


def make_handler(model, lock: threading.Lock):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self._send(200, {"ok": True}) if self.path == "/health" else self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/transcribe":
                return self._send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if not 0 < length <= MAX_BODY:
                return self._send(413, {"error": "bad length"})
            try:
                samples = load_samples(self.rfile.read(length))
            except Exception as exc:
                return self._send(400, {"error": str(exc)})
            with lock:  # one GPU, one recognition at a time
                started = time.monotonic()
                segments, _ = model.transcribe(samples, language="zh", beam_size=1,
                                               vad_filter=False, condition_on_previous_text=False)
                text = "".join(s.text for s in segments)
                inference_ms = round((time.monotonic() - started) * 1000)
            self._send(200, {"text": text, "inference_ms": inference_ms})

        def log_message(self, fmt, *args):  # keep request bodies out of logs; one line per call
            print(time.strftime("%H:%M:%S"), self.command, self.path, flush=True)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9940)
    parser.add_argument("--model", default="deepdml/faster-whisper-large-v3-turbo-ct2")
    parser.add_argument("--compute-type", default="int8_float16")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cuda", compute_type=args.compute_type)
    silence = np.zeros(16_000, dtype=np.float32)
    list(model.transcribe(silence, language="zh")[0])  # warm the CUDA kernels before serving
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(model, threading.Lock()))
    print("remote ASR ready on 127.0.0.1:%d" % args.port, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
