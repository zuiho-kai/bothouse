from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path


DEFAULT_CONFIG = Path.home() / '.cc-connect-maomao/voice/config.json'


@dataclass(frozen=True)
class Settings:
    project: str = 'gge'
    role_name: str = 'G哥'
    session_key: str = 'discord:1560320196239953953'
    session_label: str = 'Discord · 常规'
    bridge_socket: str = str(Path.home() / '.cc-connect-maomao/data/run/api.sock')
    model_path: str = ''
    voice: str = 'Tingting'
    tts_backend: str = 'say'
    tts_python: str = ''
    tts_model_path: str = ''
    tts_voice: str = 'uncle_fu'
    port: int = 8787
    data_dir: str = str(Path.home() / '.cc-connect-maomao/voice')
    shared_memory_dir: str = str(Path.home() / 'agents-demo/.cc-connect/shared-memory')

    @classmethod
    def read(cls, path: Path = DEFAULT_CONFIG) -> 'Settings':
        values = json.loads(path.expanduser().read_text())
        settings = cls(**values)
        if settings.project != 'gge':
            raise ValueError('首版仅验收 G哥（gge）；其它后端须先验证严格会话恢复。')
        if not 1024 <= settings.port <= 65535:
            raise ValueError('port 必须在 1024—65535 之间')
        if settings.tts_backend not in {'say', 'qwen3'}:
            raise ValueError('tts_backend 必须为 say 或 qwen3。')
        return settings


def initialize(path: Path = DEFAULT_CONFIG) -> Settings:
    path = path.expanduser()
    if path.exists():
        return Settings.read(path)
    cache = Path.home() / '.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/snapshots'
    models = sorted(p.parent for p in cache.glob('*/config.json')
                    if (p.parent / 'weights.safetensors').is_file())
    if not models:
        raise RuntimeError('未找到完整本地识别模型，请配置 model_path；不会自动下载。')
    settings = Settings(model_path=str(models[-1]))
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(asdict(settings), stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return settings
