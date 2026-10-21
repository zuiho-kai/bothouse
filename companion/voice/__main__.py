import argparse
import json
import os
from pathlib import Path
import urllib.request
import tempfile
import time

from .settings import DEFAULT_CONFIG, initialize


def main():
    parser = argparse.ArgumentParser(description='一家子电脑语音入口')
    parser.add_argument('command', choices=['init', 'serve', 'status', 'sample'])
    parser.add_argument('--config', type=Path, default=Path(os.environ.get('VOICE_CONFIG', DEFAULT_CONFIG)))
    parser.add_argument('--text', default='嗯，记住了，青柠七号。以后不管你打字还是说话，我们都接着聊。今天想先做点什么？')
    parser.add_argument('--speaker', help='仅 sample 使用，例如 uncle_fu、serena')
    args = parser.parse_args()
    settings = initialize(args.config)
    if args.command == 'init':
        print(f'配置已就绪：{args.config}\n角色：{settings.role_name}；会话：{settings.session_label}')
    elif args.command == 'status':
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{settings.port}/api/config', timeout=3) as response:
                value = json.load(response)
            value.pop('token', None)
            print(json.dumps(value, ensure_ascii=False, indent=2))
        except OSError:
            raise SystemExit('语音服务未响应；运行 scripts/voice serve。')
    elif args.command == 'sample':
        from .speech import Speech, _cache_directory
        tts = None
        if settings.tts_backend == 'qwen3':
            from .neural_tts import NeuralTTS
            tts = NeuralTTS(settings.tts_python, settings.tts_model_path, args.speaker or settings.tts_voice)
        elif settings.tts_backend == 'volc':
            from .volc_tts import VolcTTS
            tts = VolcTTS(settings.tts_volc_credentials, default_voice=args.speaker or settings.tts_voice)
        speech = Speech(settings.model_path, settings.voice, tts=tts)
        started = time.monotonic()
        try:
            audio = speech.synthesize(args.text)
            fd, path = tempfile.mkstemp(prefix='sample-', suffix='.wav', dir=_cache_directory())
            with os.fdopen(fd, 'wb') as f:
                f.write(audio)
            print(json.dumps({'file': path, 'elapsed_seconds': round(time.monotonic()-started, 3)}, ensure_ascii=False))
        finally:
            speech.close()
    else:
        import uvicorn
        from .app import create_app
        uvicorn.run(create_app(settings), host='127.0.0.1', port=settings.port, access_log=False)


if __name__ == '__main__':
    main()
