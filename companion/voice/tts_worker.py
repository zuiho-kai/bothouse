"""Private stdio worker: MLX TTS has a separate dependency environment."""
from contextlib import redirect_stdout
import base64
import io
import json
import os
from pathlib import Path
import sys
import time
import wave


MAX_WAV_BYTES = 15_000_000
MAX_SAMPLES = 24000 * 300
MAX_CHUNKS = 4096
MAX_FRAME_BYTES = 1_048_576
MAX_WIRE_BYTES = 21_000_000


def wav_bytes(pcm):
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setparams((1, 2, 24000, 0, 'NONE', ''))
        writer.writeframes(pcm)
    return output.getvalue()


def main():
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    model_path = Path(sys.argv[1]).resolve(strict=True)
    if not (model_path / 'model.safetensors').is_file():
        raise ValueError('local model incomplete')
    model = None
    # The subprocess runs this file directly; tests may import it as a module.
    if __package__:
        from .speech import _validate_tts_text
    else:
        from speech import _validate_tts_text
    protocol = sys.stdout

    def emit(frame):
        line = json.dumps(frame)
        if len(line) > MAX_FRAME_BYTES:
            raise ValueError('worker frame too large')
        # This handle bypasses redirect_stdout, which keeps model/library
        # chatter off the IPC pipe while each audio chunk is flushed at once.
        print(line, file=protocol, flush=True)

    for line in sys.stdin:
        request = json.loads(line)
        started = time.monotonic()
        count = total_tokens = total_bytes = samples = 0
        try:
            text = request['text']
            _validate_tts_text(text)
            with redirect_stdout(sys.stderr):
                import numpy as np
                from mlx_audio.tts.utils import load_model
                if model is None:
                    model = load_model(str(model_path))
                if model.sample_rate != 24000:
                    raise ValueError('invalid model sample rate')
                pcm = bytearray()
                final_seen = False
                max_tokens = min(3000, max(256, len(text) * 9))
                for result in model.generate_custom_voice(
                    text, speaker=request['voice'], language='Chinese',
                    temperature=0.7, max_tokens=max_tokens, verbose=False,
                    stream=True, streaming_interval=0.64,
                ):
                    # MLX-Audio 0.5.9 _generate_with_instruct reports *new*
                    # tokens per chunk. EOS before a chunk boundary can mark a
                    # remainder final; EOS exactly on a boundary emits no
                    # final-marked chunk. Exhaustion with sum < max_tokens is
                    # therefore required; is_final_chunk alone is insufficient.
                    if (final_seen or result.is_streaming_chunk is not True
                            or result.sample_rate != 24000
                            or type(result.token_count) is not int or result.token_count <= 0):
                        raise ValueError('invalid generation chunk')
                    total_tokens += result.token_count
                    if total_tokens >= max_tokens:
                        raise ValueError('generation reached its limit')
                    final_seen = result.is_final_chunk
                    audio = np.asarray(result.audio, dtype=np.float32)
                    if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all():
                        raise ValueError('invalid generated audio')
                    samples += audio.size
                    if samples > MAX_SAMPLES or count >= MAX_CHUNKS:
                        raise ValueError('generated audio exceeds limit')
                    # Convert once. The replay WAV uses these exact PCM bytes,
                    # so concatenation cannot introduce a second quantization.
                    chunk_pcm = np.clip(audio * 32768, -32768, 32767).astype('<i2').tobytes()
                    chunk = wav_bytes(chunk_pcm)
                    total_bytes += len(chunk)
                    if total_bytes > MAX_WAV_BYTES:
                        raise ValueError('generated audio exceeds limit')
                    if request.get('stream'):
                        emit({'id': request['id'], 'type': 'chunk', 'seq': count,
                              'wav': base64.b64encode(chunk).decode('ascii')})
                    else:
                        pcm.extend(chunk_pcm)
                    count += 1
                if not count:
                    raise ValueError('empty generation')
                if not request.get('stream'):
                    with open(request['output'], 'wb') as output:
                        output.write(wav_bytes(pcm))
                    os.chmod(request['output'], 0o600)
            response = {'id': request['id'], 'ok': True,
                        'type': 'done', 'seq': count,
                        'total_bytes': total_bytes, 'samples': samples,
                        'seconds': round(time.monotonic()-started, 3),
                        'duration': round(samples/24000, 3)}
        except Exception as exc:
            # Neither text nor library error bodies go into the protocol/log.
            response = {'id': request.get('id'), 'type': 'error', 'seq': count,
                        'ok': False, 'error': type(exc).__name__}
        emit(response)


if __name__ == '__main__':
    main()
