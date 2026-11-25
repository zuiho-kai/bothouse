"""One load-once model, sequential independent PCM jobs, no devices.

The pinned model loader mirrors src/voice/qwen-file-worker.py; this worker adds
only the self.model is None boundary and a versioned resident protocol. It is
used only by the app-owned file recognizer. Third-party logs stay off protocol stdout.
"""
import base64
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys

VERSION = 1
MAX_JOBS = 128
MAX_PCM = 48000 * 2 * 30
MAX_LINE = ((MAX_PCM + 2) // 3) * 4 + 2048
RATES = (16000, 24000, 32000, 44100, 48000)
UUID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")


class ProtocolError(Exception):
    pass


def decode_request(row, nonce, seen):
    keys = {"version", "nonce", "event", "id", "pcm", "sampleRate", "locale"}
    if not isinstance(row, dict) or set(row) != keys or type(row["version"]) is not int or row["version"] != VERSION or row["nonce"] != nonce or row["event"] != "transcribe":
        raise ProtocolError("invalid_response")
    job_id = row["id"]
    if not isinstance(job_id, str) or not UUID.fullmatch(job_id) or job_id in seen or len(seen) >= MAX_JOBS:
        raise ProtocolError("invalid_response")
    if row["locale"] not in ("zh-CN", "en-US"):
        raise ProtocolError("invalid_response")
    rate, encoded = row["sampleRate"], row["pcm"]
    if type(rate) is not int or rate not in RATES or not isinstance(encoded, str) or len(encoded) > MAX_LINE - 2048:
        raise ProtocolError("voice_format")
    try:
        pcm = bytearray(base64.b64decode(encoded, validate=True))
    except (TypeError, ValueError):
        raise ProtocolError("voice_format")
    if len(pcm) % 2 or not rate * 2 * .2 <= len(pcm) <= rate * 2 * 30:
        pcm[:] = b"\0" * len(pcm)
        raise ProtocolError("duration_limit")
    seen.add(job_id)
    return pcm, rate


class ModelRuntime:
    def __init__(self, model_path):
        self.model_path = Path(model_path)
        self.model = None

    def load(self):
        if self.model is not None:
            return
        for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"):
            os.environ[key] = "1"
        if not all((self.model_path / name).is_file() for name in ("config.json", "model.safetensors", "preprocessor_config.json")):
            raise ProtocolError("asr_unavailable")
        if importlib.metadata.version("qwen-asr") != "0.0.6" or importlib.metadata.version("transformers") != "4.57.6":
            raise ProtocolError("asr_unavailable")
        import torch
        from qwen_asr import Qwen3ASRModel
        if sys.platform == "darwin":
            dtype, device = torch.float32, "cpu"
        else:
            if not torch.cuda.is_available():
                raise ProtocolError("asr_unavailable")
            dtype, device = torch.bfloat16, "cuda:0"
        torch.set_num_threads(1)
        self.model = Qwen3ASRModel.from_pretrained(
            str(self.model_path), dtype=dtype, device_map=device,
            attn_implementation="sdpa", local_files_only=True, trust_remote_code=False,
            use_safetensors=True, max_inference_batch_size=1, max_new_tokens=256)

    def transcribe(self, pcm, sample_rate, locale):
        self.load()
        import numpy as np
        waveform = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        try:
            results = self.model.transcribe(audio=(waveform, sample_rate), language={"zh-CN": "Chinese", "en-US": "English"}[locale])
            return str(results[0].text).strip() if results else ""
        finally:
            waveform.fill(0)


def run(input_stream, protocol, runtime, nonce, pid, parent_pid):
    if not isinstance(nonce, str) or not UUID.fullmatch(nonce):
        return 1
    def emit(event, **fields):
        protocol.write(json.dumps({"version": VERSION, "nonce": nonce, "event": event, **fields}, ensure_ascii=True) + "\n")
        protocol.flush()
    emit("ready", pid=pid, parentPid=parent_pid, modelLoaded=False)
    seen = set()
    while True:
        line = input_stream.readline(MAX_LINE + 1)
        if not line:
            return 0
        row, pcm, text, job_id = None, None, None, None
        try:
            if not line.endswith("\n") or len(line) > MAX_LINE:
                raise ProtocolError("invalid_response")
            row = json.loads(line)
            line = None
            if isinstance(row, dict) and isinstance(row.get("id"), str) and UUID.fullmatch(row["id"]):
                job_id = row["id"]
            pcm, rate = decode_request(row, nonce, seen)
            locale = row["locale"]
            row.clear()
            row = None
            text = runtime.transcribe(pcm, rate, locale)
            if not isinstance(text, str) or len(text.encode("utf-16-le")) // 2 > 2000:
                raise ProtocolError("transcript_invalid")
            pcm[:] = b"\0" * len(pcm)
            pcm = None
            emit("transcript", id=job_id, text=text)
            text = None
            emit("job-clean", id=job_id)
        except Exception as error:
            if pcm is not None:
                pcm[:] = b"\0" * len(pcm)
            if isinstance(row, dict):
                row.clear()
            text, pcm, row, line = None, None, None, None
            code = str(error) if isinstance(error, ProtocolError) else "asr_failed"
            emit("error", id=job_id, code=code)
            return 1


def main():
    if len(sys.argv) != 4 or sys.argv[3] != "--resident":
        return 1
    protocol = sys.stdout
    sys.stdout = sys.stderr
    return run(sys.stdin, protocol, ModelRuntime(sys.argv[1]), sys.argv[2], os.getpid(), os.getppid())


if __name__ == "__main__":
    raise SystemExit(main())
