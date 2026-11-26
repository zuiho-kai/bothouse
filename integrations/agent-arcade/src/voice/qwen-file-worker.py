"""One bounded memory PCM job; no audio device or recording file is opened.

Model-only settings deliberately mirror qwen-asr-worker.Runtime.load. Keeping
this small loader separate avoids changing the already verified capture/VAD
lifecycle. Both loaders must change together if the pinned ASR is upgraded.
"""
import base64
import importlib.metadata
import json
import os
from pathlib import Path
import sys

MAX_PCM = 48000 * 2 * 30
MAX_LINE = ((MAX_PCM + 2) // 3) * 4 + 1024
RATES = (16000, 24000, 32000, 44100, 48000)


class FileVoiceError(Exception):
    pass


def request_pcm(row):
    if not isinstance(row, dict) or set(row) != {"id", "sampleRate", "pcm", "locale"}:
        raise FileVoiceError("invalid_response")
    if not isinstance(row["id"], str) or len(row["id"]) != 36 or row["locale"] not in ("zh-CN", "en-US"):
        raise FileVoiceError("invalid_response")
    rate, encoded = row["sampleRate"], row["pcm"]
    if type(rate) is not int or rate not in RATES or not isinstance(encoded, str) or len(encoded) > MAX_LINE - 1024:
        raise FileVoiceError("voice_format")
    try:
        audio = bytearray(base64.b64decode(encoded, validate=True))
    except (ValueError, TypeError):
        raise FileVoiceError("voice_format")
    if len(audio) % 2 or not rate * 2 * .2 <= len(audio) <= rate * 2 * 30:
        audio[:] = b"\0" * len(audio)
        raise FileVoiceError("duration_limit")
    return audio, rate


class ModelRuntime:
    def __init__(self, model_path):
        self.model_path = Path(model_path)
        self.model = None

    def transcribe(self, pcm, sample_rate, locale):
        # Load on the protocol main thread, as required by the previously
        # verified Windows initialization fix. Device libraries are not imported.
        for key in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"):
            os.environ[key] = "1"
        if not all((self.model_path / file).is_file() for file in ("config.json", "model.safetensors", "preprocessor_config.json")):
            raise FileVoiceError("asr_unavailable")
        if importlib.metadata.version("qwen-asr") != "0.0.6" or importlib.metadata.version("transformers") != "4.57.6":
            raise FileVoiceError("asr_unavailable")
        import numpy as np
        import torch
        from qwen_asr import Qwen3ASRModel
        if not torch.cuda.is_available():
            raise FileVoiceError("asr_unavailable")
        torch.set_num_threads(1)
        self.model = Qwen3ASRModel.from_pretrained(
            str(self.model_path), dtype=torch.bfloat16, device_map="cuda:0",
            attn_implementation="sdpa", local_files_only=True, trust_remote_code=False,
            use_safetensors=True, max_inference_batch_size=1, max_new_tokens=256)
        waveform = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        try:
            results = self.model.transcribe(audio=(waveform, sample_rate), language={"zh-CN": "Chinese", "en-US": "English"}[locale])
            return str(results[0].text).strip() if results else ""
        finally:
            waveform.fill(0)


def process(row, runtime):
    audio, rate = request_pcm(row)
    try:
        text = runtime.transcribe(audio, rate, row["locale"])
        if not isinstance(text, str) or len(text) > 2000:
            raise FileVoiceError("transcript_invalid")
        return {"id": row["id"], "event": "transcript", "text": text}
    finally:
        audio[:] = b"\0" * len(audio)


def main():
    protocol = sys.stdout
    sys.stdout = sys.stderr
    op_id = None
    try:
        line = sys.stdin.readline(MAX_LINE + 1)
        if not line.endswith("\n") or len(line) > MAX_LINE:
            raise FileVoiceError("invalid_response")
        row = json.loads(line)
        if isinstance(row, dict) and isinstance(row.get("id"), str) and len(row["id"]) == 36:
            op_id = row["id"]
        result = process(row, ModelRuntime(sys.argv[1]))
    except FileVoiceError as error:
        result = {"id": op_id, "event": "error", "code": str(error)}
    except Exception:
        result = {"id": op_id, "event": "error", "code": "asr_failed"}
    protocol.write(json.dumps(result, ensure_ascii=True) + "\n")
    protocol.flush()


if __name__ == "__main__":
    main()
