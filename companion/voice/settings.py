from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import re
import os
from pathlib import Path


DEFAULT_CONFIG = Path('~/.conest/voice/config.json')

REQUIRED_BINDINGS = (
    ('project', '伙伴项目标识，如 gge 或 cursor'),
    ('role_name', '伙伴显示名称，如 G哥 或 Cursor'),
    ('session_key', '会话绑定，如 discord:<频道ID>'),
    ('bridge_socket', '桥接 api.sock 路径'),
    ('model_path', '本地语音识别模型目录'),
    ('data_dir', '本实例语音数据目录'),
    ('shared_memory_dir', '共享语音记录目录'),
)


def _nonempty_str(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def default_config_path() -> Path:
    if env := os.environ.get('VOICE_CONFIG', '').strip():
        return Path(env).expanduser()
    if home := os.environ.get('CONEST_HOME', '').strip():
        return Path(home).expanduser() / 'voice/config.json'
    return DEFAULT_CONFIG.expanduser()


def _resolve_config_path(path: Path) -> Path:
    return default_config_path() if path == DEFAULT_CONFIG else Path(path).expanduser()


@dataclass(frozen=True)
class Settings:
    project: str = ''
    role_name: str = ''
    session_key: str = ''
    session_label: str = 'Discord · 常规'
    bridge_socket: str = ''
    model_path: str = ''
    voice: str = 'Tingting'
    tts_backend: str = 'say'
    asr_prewarm: bool = False
    # 远程识别（如经 SSH 隧道转发的 3060 faster-whisper），空则只用本机 MLX。失败自动回落本机。
    asr_remote_url: str = ''
    asr_remote_timeout_s: float = 3.0
    require_isolated_voice: bool = False
    tts_python: str = ''
    tts_model_path: str = ''
    tts_voice: str = 'uncle_fu'
    tts_volc_credentials: str = ''  # 私密 JSON；角色音色是火山音色 ID 时走云端合成
    sentence_stream: bool = False
    port: int = 8787
    data_dir: str = ''
    shared_memory_dir: str = ''

    def validate(self) -> 'Settings':
        if not isinstance(self.asr_prewarm, bool):
            raise ValueError('asr_prewarm 必须为布尔值')
        if not isinstance(self.require_isolated_voice, bool):
            raise ValueError('require_isolated_voice 必须为布尔值')
        missing = [
            f'{field}（{desc}）'
            for field, desc in REQUIRED_BINDINGS
            if not _nonempty_str(getattr(self, field, None))
        ]
        if missing:
            raise ValueError('语音实例缺少显式配置绑定：' + '、'.join(missing) + '。请核对配置文件，不会回退到旧实例。')
        for field in ('session_label', 'voice', 'tts_backend', 'tts_python', 'tts_model_path', 'tts_voice',
                      'tts_volc_credentials'):
            if not isinstance(getattr(self, field, None), str):
                raise ValueError(f'{field} 必须为字符串')
        for field in ('session_label', 'voice', 'tts_voice'):
            if not _nonempty_str(getattr(self, field, None)):
                raise ValueError(f'{field} 必须为非空字符串')
        if isinstance(self.port, bool) or not isinstance(self.port, int) or not 1024 <= self.port <= 65535:
            raise ValueError('port 必须在 1024—65535 之间')
        if not isinstance(self.asr_remote_url, str) or (
                self.asr_remote_url and not re.fullmatch(r'https?://[^\s]+', self.asr_remote_url)):
            raise ValueError('asr_remote_url 必须为空或 http(s) 地址')
        if (isinstance(self.asr_remote_timeout_s, bool) or not isinstance(self.asr_remote_timeout_s, (int, float))
                or not 0.5 <= self.asr_remote_timeout_s <= 30):
            raise ValueError('asr_remote_timeout_s 必须在 0.5—30 秒之间')
        if not isinstance(self.sentence_stream, bool):
            raise ValueError('sentence_stream 必须为布尔值')
        if self.tts_backend not in {'say', 'qwen3', 'volc'}:
            raise ValueError('tts_backend 必须为 say、qwen3 或 volc。')
        if self.tts_backend == 'volc':
            from .roles import VOLC_VOICE
            if not self.tts_volc_credentials.strip() or not VOLC_VOICE.fullmatch(self.tts_voice):
                raise ValueError('豆包专用模式需要凭据路径和豆包默认音色，禁止回落本地合成。')
        return self

    @classmethod
    def read(cls, path: Path = DEFAULT_CONFIG) -> 'Settings':
        resolved = _resolve_config_path(path)
        if not resolved.is_file():
            raise FileNotFoundError(f'未找到语音实例配置文件：{resolved}；请参考 companion/examples/ 准备独立实例配置。')
        values = json.loads(resolved.read_text(encoding='utf-8'))
        if not isinstance(values, dict):
            raise ValueError('语音实例配置必须是 JSON 对象。')
        return cls(**values).validate()


def initialize(path: Path = DEFAULT_CONFIG, **overrides) -> Settings:
    resolved = _resolve_config_path(path)
    if resolved.exists():
        return Settings.read(resolved)
    env_map = {
        'project': 'VOICE_PROJECT',
        'role_name': 'VOICE_ROLE_NAME',
        'session_key': 'VOICE_SESSION_KEY',
        'session_label': 'VOICE_SESSION_LABEL',
        'bridge_socket': 'VOICE_BRIDGE_SOCKET',
        'model_path': 'VOICE_MODEL_PATH',
        'voice': 'VOICE_SYSTEM_VOICE',
        'tts_backend': 'VOICE_TTS_BACKEND',
        'tts_python': 'VOICE_TTS_PYTHON',
        'tts_model_path': 'VOICE_TTS_MODEL_PATH',
        'tts_voice': 'VOICE_TTS_VOICE',
        'data_dir': 'VOICE_DATA_DIR',
        'shared_memory_dir': 'VOICE_SHARED_MEMORY_DIR',
    }
    values: dict[str, object] = {}
    for field_name, env_name in env_map.items():
        if env_val := os.environ.get(env_name, '').strip():
            values[field_name] = env_val
    if port_env := os.environ.get('VOICE_PORT', '').strip():
        values['port'] = int(port_env)
    for key, val in overrides.items():
        if key != 'port' and val is not None and not isinstance(val, str):
            raise ValueError(f'{key} 必须为字符串')
        if val is not None and val != '':
            values[key] = val

    missing_identity = [
        name for name in ('project', 'role_name', 'session_key')
        if not _nonempty_str(values.get(name))
    ]
    if missing_identity:
        raise ValueError(
            f'未找到配置文件 {resolved}，且缺少初始化必填绑定：{", ".join(missing_identity)}。'
            '请先参考 companion/examples/ 创建独立实例配置，或显式提供绑定后再初始化。'
        )

    instance_root = resolved.parent.parent
    values.setdefault('data_dir', str(resolved.parent))
    values.setdefault('shared_memory_dir', str(instance_root / 'shared-memory'))
    values.setdefault('bridge_socket', str(instance_root / 'data/run/api.sock'))

    if not _nonempty_str(values.get('model_path')):
        cache = Path('~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/snapshots').expanduser()
        models = sorted(p.parent for p in cache.glob('*/config.json')
                        if (p.parent / 'weights.safetensors').is_file())
        if not models:
            raise RuntimeError('未找到完整本地识别模型，请配置 model_path；不会自动下载。')
        values['model_path'] = str(models[-1])

    settings = Settings(**values).validate()
    resolved.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with resolved.open('x', encoding='utf-8') as stream:
        os.chmod(resolved, 0o600)
        json.dump(asdict(settings), stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    return settings
