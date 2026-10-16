"""Explicit roster for one shared channel; no discovery or implicit enrollment."""
from dataclasses import dataclass
import json
from pathlib import Path
import re


QWEN_VOICES = frozenset({'uncle_fu', 'serena', 'vivian', 'ryan', 'aiden', 'eric', 'dylan'})
VOICE_NAMES = {'uncle_fu': '温和男声', 'serena': '柔和女声', 'vivian': '明亮女声'}


@dataclass(frozen=True)
class Role:
    project: str
    name: str
    tts_voice: str | None = None

    def __post_init__(self):
        if not isinstance(self.project, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', self.project):
            raise ValueError('伙伴 project 必须是1至64位字母、数字、下划线或短横线。')
        if not isinstance(self.name, str) or not self.name.strip() or len(self.name) > 40:
            raise ValueError('伙伴名称必须是1至40字。')
        if self.tts_voice is not None and self.tts_voice not in QWEN_VOICES:
            raise ValueError('伙伴的 Qwen 音色不受支持。')


def read_roles(path: Path) -> tuple[Role, ...]:
    value = json.loads(path.expanduser().read_text(encoding='utf-8'))
    if not isinstance(value, dict) or set(value) != {'roles'} or not isinstance(value['roles'], list):
        raise ValueError('名单必须是含 roles 数组的 JSON 对象。')
    return tuple(Role(**item) for item in value['roles'])


def validate_roles(roles, settings) -> tuple[Role, ...]:
    roles = tuple(roles)
    if not 1 <= len(roles) <= 8 or any(not isinstance(role, Role) for role in roles):
        raise ValueError('请明确配置1至8位伙伴。')
    ids = [role.project for role in roles]
    if len(set(ids)) != len(ids) or settings.project not in ids:
        raise ValueError('伙伴 project 不得重复，且必须包含配置中的默认伙伴。')
    if settings.tts_backend != 'qwen3' and any(role.tts_voice is not None for role in roles):
        raise ValueError('逐伙伴自然音色需要 tts_backend=qwen3；系统音色名单请省略 tts_voice。')
    return roles


def voice_label(settings, role: Role) -> str:
    if settings.tts_backend == 'qwen3':
        voice = role.tts_voice or settings.tts_voice
        return '本机自然音色 · ' + VOICE_NAMES.get(voice, voice)
    return '系统音色 · ' + settings.voice
