"""Offline listening experiment; never connects to the CoNest bridge or Discord."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import sys
import time


TEXTS = {
    "short": "嗯，记住了，青柠七号。今天想先聊点什么？",
    "conversation": "别着急，我们一步一步来。你先说说卡在哪里，我陪你一起想办法。",
    "mixed": "我们下午三点半开始，先检查 Discord 的语音功能，再试两轮对话。",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", choices=["cosyvoice", "qwen"], required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--tokenizer", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--reference-text", default="希望你以后能够做的比我还好呦。")
    parser.add_argument("--speaker", default="uncle_fu")
    parser.add_argument("--cases", nargs="+", choices=TEXTS, default=list(TEXTS))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    args.model = args.model.resolve(strict=True)
    if not (args.model / "model.safetensors").is_file():
        parser.error("--model must contain local weights")
    if args.backend == "cosyvoice" and (not args.tokenizer or not args.reference):
        parser.error("CosyVoice requires --tokenizer and --reference")
    args.output.mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model

    model = load_model(str(args.model))
    reference = None
    if args.backend == "cosyvoice":
        from mlx_audio.codec.models.s3tokenizer import S3TokenizerV3
        from scipy.signal import resample_poly
        from math import gcd

        # The pinned community wrapper otherwise downloads an unpinned tokenizer.
        # Load exactly the supplied local weights, without changing its inference.
        tokenizer = S3TokenizerV3("speech_tokenizer_v3")
        weights = mx.load(str(args.tokenizer.resolve(strict=True) / "model.safetensors"))
        tokenizer.load_weights(list(weights.items()))
        tokenizer.eval()
        mx.eval(tokenizer.parameters())
        model._s3_tokenizer = tokenizer
        model._ensure_model_loaded()
        model._ensure_tokenizers_loaded()
        if not model._speaker_encoder._loaded:
            raise RuntimeError("Speaker encoder weights missing; zero-embedding fallback is not a valid voice trial")
        # MLX excludes private wrapper attributes from parameters(). Evaluate
        # the real modules so lazy weight loading is part of setup timing.
        mx.eval(model._model.parameters(), model._speaker_encoder.model.parameters())
        reference, rate = sf.read(args.reference.resolve(strict=True), dtype="float32")
        if reference.ndim == 2:
            reference = reference.mean(axis=1)
        if len(reference) > rate * 30:
            raise ValueError("reference longer than 30 seconds")
        divisor = gcd(rate, model.sample_rate)
        reference = mx.array(resample_poly(reference, model.sample_rate // divisor, rate // divisor))
    load_seconds = time.perf_counter() - started
    print(json.dumps({"backend": args.backend, "load_seconds": load_seconds}), flush=True)
    distribution = "mlx-audio-plus" if args.backend == "cosyvoice" else "mlx-audio"
    report = {
        "backend": args.backend, "load_seconds": load_seconds, "samples": [],
        "python": sys.version, "platform": sys.platform,
        "runtime": {distribution: importlib.metadata.version(distribution), "mlx": importlib.metadata.version("mlx")},
        "maxrss_unit": "bytes" if sys.platform == "darwin" else "KiB",
    }
    # Repeat the first text immediately to expose cold/warm differences.
    cases = [args.cases[0], *args.cases]
    for index, case in enumerate(cases):
        mx.random.seed(42)
        begun = time.perf_counter()
        if args.backend == "cosyvoice":
            results = model.generate(
                TEXTS[case], ref_audio=reference, ref_text=args.reference_text,
                seed=42, temperature=0.7, verbose=False, stream=False,
            )
        else:
            results = model.generate_custom_voice(
                TEXTS[case], speaker=args.speaker, language="Chinese",
                temperature=0.7, max_tokens=768, verbose=False,
            )
        chunks, first_chunk = [], None
        for result in results:
            chunk = np.asarray(result.audio, dtype=np.float32).reshape(-1)
            if first_chunk is None:
                first_chunk = time.perf_counter() - begun
            if args.backend == "qwen" and result.token_count >= 768:
                raise RuntimeError("generation hit token limit")
            chunks.append(chunk)
        seconds = time.perf_counter() - begun
        audio = np.concatenate(chunks)
        if not audio.size or not np.isfinite(audio).all():
            raise ValueError("empty or invalid audio")
        path = args.output / f"{index:02d}-{case}.wav"
        if path.exists():
            raise FileExistsError(path)
        sf.write(path, audio, model.sample_rate, subtype="PCM_16")
        os.chmod(path, 0o600)
        sample = {
            "file": str(path.resolve()), "text": TEXTS[case],
            "generation_seconds": seconds, "first_chunk_seconds": first_chunk,
            "audio_seconds": len(audio) / model.sample_rate,
            "sample_rate": model.sample_rate,
            "mlx_peak_bytes": mx.get_peak_memory(),
            "process_maxrss": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "streaming": False,
        }
        report["samples"].append(sample)
        (args.output / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(json.dumps(sample, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
