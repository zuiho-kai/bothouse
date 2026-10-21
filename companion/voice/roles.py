"""Explicit roster for one shared channel; no discovery or implicit enrollment."""
from dataclasses import dataclass
import json
from pathlib import Path
import re


QWEN_VOICES = frozenset({'uncle_fu', 'serena', 'vivian', 'ryan', 'aiden', 'eric', 'dylan'})
VOICE_NAMES = {'uncle_fu': '温和男声', 'serena': '柔和女声', 'vivian': '明亮女声',
               'zh_female_sajiaoxuemei_uranus_bigtts': '撒娇学妹（豆包）'}
# 豆包语音（火山引擎）音色 ID，如 zh_female_sajiaoxuemei_uranus_bigtts；需要配置 tts_volc_credentials。
VOLC_VOICE = re.compile(r'^[a-z]{2}_[a-z0-9_]+_(bigtts|tts)$')


@dataclass(frozen=True)
class Role:
    project: str
    name: str
    tts_voice: str | None = None
    relay_project: str = ""

    def __post_init__(self):
        if (not isinstance(self.relay_project, str) or (self.relay_project and
                not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", self.relay_project))):
            raise ValueError("relay_project 必须为空或明确的伙伴项目标识。")
        if not isinstance(self.project, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', self.project):
            raise ValueError('伙伴 project 必须是1至64位字母、数字、下划线或短横线。')
        if not isinstance(self.name, str) or not self.name.strip() or len(self.name) > 40:
            raise ValueError('伙伴名称必须是1至40字。')
        if (self.tts_voice is not None and self.tts_voice not in QWEN_VOICES
                and not (isinstance(self.tts_voice, str) and VOLC_VOICE.fullmatch(self.tts_voice))):
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
    if settings.require_isolated_voice and any(role.relay_project != role.project for role in roles):
        raise ValueError('独立语音模式要求每个角色显式转发到自己的项目；禁止回到工作会话。')
    if len(set(ids)) != len(ids) or settings.project not in ids:
        raise ValueError('伙伴 project 不得重复，且必须包含配置中的默认伙伴。')
    if settings.tts_backend not in {'qwen3', 'volc'} and any(role.tts_voice is not None for role in roles):
        raise ValueError('逐伙伴自然音色需要 tts_backend=qwen3 或 volc；系统音色名单请省略 tts_voice。')
    if settings.tts_backend == 'volc' and any(
            not VOLC_VOICE.fullmatch(role.tts_voice or settings.tts_voice) for role in roles):
        raise ValueError('豆包专用模式要求每个角色使用豆包音色，禁止本地音色。')
    return roles


def voice_label(settings, role: Role) -> str:
    if settings.tts_backend in {'qwen3', 'volc'}:
        voice = role.tts_voice or settings.tts_voice
        if VOLC_VOICE.fullmatch(voice or ''):
            return '豆包云端音色 · ' + VOICE_NAMES.get(voice, voice)
        return '本机自然音色 · ' + VOICE_NAMES.get(voice, voice)
    return '系统音色 · ' + settings.voice
