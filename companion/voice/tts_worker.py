"""Private stdio worker: MLX TTS has a separate dependency environment."""
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys
import time


def main():
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    model_path = Path(sys.argv[1]).resolve(strict=True)
    if not (model_path / 'model.safetensors').is_file():
        raise ValueError('local model incomplete')
    model = None
    for line in sys.stdin:
        request = json.loads(line)
        started = time.monotonic()
        try:
            text = request['text']
            if not isinstance(text, str) or not text.strip() or len(text) > 500:
                raise ValueError('invalid text')
            with redirect_stdout(sys.stderr):
                import numpy as np
                import soundfile as sf
                from mlx_audio.tts.utils import load_model
                if model is None:
                    model = load_model(str(model_path))
                chunks = []
                max_tokens = min(3000, max(256, len(text) * 9))
                for result in model.generate_custom_voice(
                    text, speaker=request['voice'], language='Chinese',
                    temperature=0.7, max_tokens=max_tokens, verbose=False,
                ):
                    if result.token_count >= max_tokens:
                        raise ValueError('generation reached its limit')
                    chunks.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
                audio = np.concatenate(chunks)
                if not audio.size or not np.isfinite(audio).all() or audio.size > model.sample_rate * 300:
                    raise ValueError('invalid generated audio')
                sf.write(request['output'], audio, model.sample_rate, subtype='PCM_16', format='WAV')
                os.chmod(request['output'], 0o600)
            response = {'id': request['id'], 'ok': True,
                        'seconds': round(time.monotonic()-started, 3),
                        'duration': round(audio.size/model.sample_rate, 3)}
        except Exception as exc:
            # Neither text nor library error bodies go into the protocol/log.
            response = {'id': request.get('id'), 'ok': False, 'error': type(exc).__name__}
        print(json.dumps(response), flush=True)


if __name__ == '__main__':
    main()
