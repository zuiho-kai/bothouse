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
    voice: str = ""          # macOS say 音色；Qwen 出错时退回它，也是 [voice] backend = "say" 时用的音色
    qwen_speaker: str = ""   # Qwen3-TTS CustomVoice 的预置 speaker
    qwen_instruct: str = ""  # Qwen3-TTS 语气指令
    aliases: list[str] = field(default_factory=list)   # 语音里叫她的别的叫法（唤醒词），见 rh/wake.py
    # 语音唤醒词：填了就只认这几个（name、aliases 不再算语音唤醒，网页打字照旧按 name+aliases）；不填 = name+aliases。见 rh/wake.py
    wake: list[str] = field(default_factory=list)


@dataclass
class Config:
    roles: list[Role]
    max_turns_per_topic: int
    chars_per_sec: float
    model: str
    timeout_sec: float
    path: Path = field(default=Path("roles.toml"))
    voice_backend: str = "say"   # "qwen" 或 "say"；没有 [voice] 段时用 say（旧配置照旧）
    # 本机喇叭和收音："afplay" = 旧方式（afplay/say 播、直接读麦）；"vpio" = 都走 macOS 系统语音处理，带回声消除（rh/vpio.py）
    voice_player: str = "afplay"
    qwen_python: str = ""
    qwen_model: str = ""
    # 语音口令（[wake] 段，见 rh/wake.py）。没有 [wake] 段时用这些默认值。
    wake_product: list[str] = field(default_factory=lambda: ["小家"])
    wake_pause: str = "暂停"
    wake_mute: str = "闭麦"
    wake_unmute: str = "开麦"
    # 本地唤醒模型目录（rh/kws.py，不进 git，下载见 README「本地唤醒模型」）；空 = 不用唤醒模型，只靠转文字。
    wake_kws_model: str = ""
    # 小智板子（[xiaozhi] 段，rh/xiaozhi.py）：xiaozhi_port = None 表示没配这一段，不起小智协议服务。
    xiaozhi_port: int | None = None
    xiaozhi_boards: dict[str, str] = field(default_factory=dict)   # 板子 Device-Id（MAC，小写）-> 角色 id
    # 形态 B（[discord] 段，rh/discord_body.py）：现有平台里 bot 的发言由板子念。
    discord_play: bool = False   # 真板播放开关，默认关：关着只记日志不出声
    discord_bots: list["DiscordBot"] = field(default_factory=list)


@dataclass
class DiscordBot:
    """现有平台（Discord）里的一个 bot 对应哪个角色：用这个角色的音色、在绑给这个角色的板子上念。"""
    bot_id: str   # Discord 用户 ID（bot 的）
    name: str     # 只用于日志
    role: str     # roles.toml 里的角色 id


# [xiaozhi] 段没写 port 时用的端口。来源：固件编译默认 OTA 地址的端口（http://<Mac 局域网地址>:8791/xiaozhi/ota/，
# ~/code/role-household-fw/xiaozhi-esp32/main/Kconfig.projbuild CONFIG_OTA_URL），两边同一个端口。
XIAOZHI_PORT = 8791


def load(path: str | Path = "roles.toml") -> Config:
    path = Path(path)
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    m, b, v, w = data["meeting"], data["brain"], data.get("voice", {}), data.get("wake", {})
    roles = [Role(**r) for r in data["roles"]]
    if len({r.id for r in roles}) != len(roles):
        raise ValueError("roles.toml: 角色 id 重复")
    if v.get("backend", "say") not in ("qwen", "say"):
        raise ValueError(f"roles.toml: [voice] backend 只能是 qwen 或 say，现在是 {v.get('backend')!r}")
    if v.get("player", "afplay") not in ("afplay", "vpio"):
        raise ValueError(f"roles.toml: [voice] player 只能是 afplay 或 vpio，现在是 {v.get('player')!r}")
    seen: dict[str, tuple[str, str]] = {}
    for r in roles:   # Qwen 音色按 say 音色名查（rh.voice.QwenSynth），同一个 say 音色不能配两套 Qwen 音色
        if r.voice and seen.setdefault(r.voice, (r.qwen_speaker, r.qwen_instruct)) != (r.qwen_speaker, r.qwen_instruct):
            raise ValueError(f"roles.toml: 音色 {r.voice} 被多个角色配了不同的 Qwen 音色")
    xz = data.get("xiaozhi")
    boards: dict[str, str] = {}
    if xz is not None:
        ids = {r.id for r in roles}
        for bd in xz.get("boards", []):
            dev, rid = str(bd.get("device", "")).strip().lower().replace("-", ":"), str(bd.get("role", ""))
            if not dev or rid not in ids:
                raise ValueError(f"roles.toml: [[xiaozhi.boards]] 要有 device 和已有的角色 id，现在是 {bd!r}")
            if dev in boards:
                raise ValueError(f"roles.toml: 板子 {dev} 绑定了两次")
            boards[dev] = rid
    dc = data.get("discord", {})
    bots: list[DiscordBot] = []
    for bt in dc.get("bots", []):
        bid, rid = str(bt.get("bot_id", "")).strip(), str(bt.get("role", ""))
        if not bid.isdigit() or rid not in {r.id for r in roles}:
            raise ValueError(f"roles.toml: [[discord.bots]] 要有数字 bot_id 和已有的角色 id，现在是 {bt!r}")
        if any(b.bot_id == bid for b in bots):
            raise ValueError(f"roles.toml: bot {bid} 映射了两次")
        bots.append(DiscordBot(bid, str(bt.get("name", "")) or bid, rid))
    if not isinstance(dc.get("play", False), bool):
        raise ValueError(f"roles.toml: [discord] play 只能是 true 或 false，现在是 {dc.get('play')!r}")
    return Config(
        roles=roles,
        max_turns_per_topic=int(m["max_turns_per_topic"]),
        chars_per_sec=float(m["chars_per_sec"]),
        model=str(b["model"]),
        timeout_sec=float(b["timeout_sec"]),
        path=path,
        voice_backend=str(v.get("backend", "say")),
        voice_player=str(v.get("player", "afplay")),
        qwen_python=str(Path(v.get("qwen_python", "")).expanduser()) if v.get("qwen_python") else "",
        qwen_model=str(Path(v.get("qwen_model", "")).expanduser()) if v.get("qwen_model") else "",
        wake_product=[str(x) for x in w.get("product", ["小家"])],
        wake_pause=str(w.get("pause", "暂停")),
        wake_mute=str(w.get("mute", "闭麦")),
        wake_unmute=str(w.get("unmute", "开麦")),
        wake_kws_model=str(Path(w.get("kws_model", "")).expanduser()) if w.get("kws_model") else "",
        xiaozhi_port=int(xz.get("port", XIAOZHI_PORT)) if xz is not None else None,
        xiaozhi_boards=boards,
        discord_play=bool(dc.get("play", False)),
        discord_bots=bots,
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
