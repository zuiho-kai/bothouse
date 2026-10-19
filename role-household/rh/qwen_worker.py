"""Qwen3-TTS 常驻合成进程：模型加载一次，按行收请求、按行回 WAV。由 rh.voice.QwenSynth 启动和管理。

不在主机的 uv 环境里跑：用装了 mlx-audio 的 Python（roles.toml [voice] qwen_python，~/ai-voice/tts-venv）执行，
所以这个文件不导入 rh 的任何东西。

    <python> -I qwen_worker.py <模型目录>

协议（stdin/stdout 各一行一个 JSON）：
    启动后先回 {"ready": true, "load_sec": 秒}（加载失败回 {"ready": false, "error": ...} 并退出）
    请求 {"text": ..., "speaker": ..., "instruct": ...}
    回复 {"ok": true, "wav": base64 的 16 位单声道 WAV, "secs": 合成耗时} 或 {"ok": false, "error": ...}
mlx-audio 自己会往 stdout 打字，所以回复走复制出来的原 stdout，进程内的 stdout 改指 stderr。
"""
import base64
import io
import json
import os
import sys
import time
import wave


def main() -> None:
    out = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def reply(obj) -> None:
        out.write(json.dumps(obj, ensure_ascii=False) + "\n")
        out.flush()

    try:
        import numpy as np
        from mlx_audio.tts.utils import load_model
        t = time.time()
        model = load_model(sys.argv[1])
        load_sec = time.time() - t
    except Exception as e:
        reply({"ready": False, "error": repr(e)})
        return

    def synth(text: str, speaker: str, instruct: str | None) -> bytes:
        chunks, sr = [], 24000
        # lang_code="chinese" 同 18:00 试听脚本（橘派的试听 subagent 的 /tmp/q3run.py）。
        for r in model.generate(text=text, voice=speaker, instruct=instruct or None, lang_code="chinese"):
            chunks.append(np.asarray(r.audio, dtype=np.float32))
            sr = r.sample_rate
        audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
        pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm)
        return buf.getvalue()

    reply({"ready": True, "load_sec": round(load_sec, 2)})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            t = time.time()
            wav = synth(req["text"], req["speaker"], req.get("instruct"))
            reply({"ok": True, "wav": base64.b64encode(wav).decode(), "secs": round(time.time() - t, 3)})
        except Exception as e:
            reply({"ok": False, "error": repr(e)})


if __name__ == "__main__":
    main()
