"""读 roles.toml。"""
from __future__ import annotations

import base64
import mimetypes
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass
class Role:
    id: str
    name: str
    persona: str
    avatar: str = ""
    voice: str = ""


@dataclass
class Config:
    roles: list[Role]
    max_turns_per_topic: int
    chars_per_sec: float
    model: str
    timeout_sec: float
    path: Path = field(default=Path("roles.toml"))


def load(path: str | Path = "roles.toml") -> Config:
    path = Path(path)
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    m, b = data["meeting"], data["brain"]
    roles = [Role(**r) for r in data["roles"]]
    if len({r.id for r in roles}) != len(roles):
        raise ValueError("roles.toml: 角色 id 重复")
    return Config(
        roles=roles,
        max_turns_per_topic=int(m["max_turns_per_topic"]),
        chars_per_sec=float(m["chars_per_sec"]),
        model=str(b["model"]),
        timeout_sec=float(b["timeout_sec"]),
        path=path,
    )


def avatar_data_url(role: Role, base: Path, log: Callable[[str], None] = lambda s: print(s, flush=True)) -> str:
    """角色头像（路径相对 roles.toml 所在目录）读成 data URL，随成员表发给云端；没配或读不到返回空。
    类型或大小 hub 不收的也返回空并打警告：只这个角色没头像，不连累整张成员表被拒（审查第 7 条）。"""
    from .hub import AVATAR_TYPES, MAX_AVATAR   # 和 hub 的检查用同一组常量；放函数里，避开 hub -> meeting -> config 的循环导入
    if not role.avatar:
        return ""
    f = base / role.avatar
    ctype = mimetypes.guess_type(f.name)[0] or ""
    if ctype not in AVATAR_TYPES:
        log(f"[host] 警告：{role.name} 的头像 {f} 类型 {ctype or '未知'} 云端不收（只收 {'/'.join(AVATAR_TYPES)}），这个角色不带头像")
        return ""
    try:
        data = f.read_bytes()
    except OSError:
        return ""
    url = f"data:{ctype};base64," + base64.b64encode(data).decode()
    if len(url) > MAX_AVATAR:
        log(f"[host] 警告：{role.name} 的头像 {f} 太大（{len(data)} 字节，转成 data URL 后超过云端上限 {MAX_AVATAR} 字符），"
            f"这个角色不带头像")
        return ""
    return url
