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
    # 板子听到叫映射了 bot 的角色时，把这句以 webhook 身份发进 Discord（而不是自建频道），默认关
    discord_relay: bool = False
    discord_channel: str = ""    # 板子的话发进哪个频道（Discord 频道 ID）；只念这个频道里的回复
    discord_bots: list["DiscordBot"] = field(default_factory=list)
    # 服务器相关的其余设置（按意思选频道、新建频道、朗读摘要、webhook 放行），见 DiscordSettings
    discord: "DiscordSettings" = field(default_factory=lambda: DiscordSettings())


@dataclass
class LLMEndpoint:
    """一个 OpenAI 兼容的对话接口（/chat/completions）。url 空 = 不用（退回现状）。
    本机 4B、别家便宜 API 都行：填 base 地址（如 http://127.0.0.1:8787/v1）和模型名。"""
    url: str = ""
    model: str = ""
    key_env: str = ""    # 从哪个环境变量读 key（不写值）
    key_file: str = ""   # 或从这个文件读 key：JSON 取 api_key 字段，否则整份文字（本机 ai-gateway 是 JSON）
    # 拼在 assistant 消息开头的一段：Qwen3.5 在 LM Studio 上关不掉思考（reasoning_effort、/no_think 都不管用，
    # 2026-10-19 实测 0.85 秒只出思考、正文为空），预填空的思考块才直接出正文（0.23–0.30 秒）。别的模型留空。
    prefill: str = ""
    timeout: float = 0.0   # 秒；0 = 用调用方的默认值


@dataclass
class DiscordSettings:
    """[discord] 段里和服务器有关的设置；换一个服务器 / 换一个人只改 roles.toml（模板 roles.example.toml）。"""
    api: str = "https://discord.com/api/v10"   # Discord REST 地址（测试指向本机假服务器）
    guild: str = ""            # 服务器 ID；空 = 不列频道、不建频道，只进默认频道（channel）
    username: str = "板子"     # webhook 发言显示的名字，也是主机新建 webhook 的名字
    token_env: str = "DISCORD_BOT_TOKEN"   # bot token 的环境变量名（列频道、建频道、建 webhook 用）
    token_file: str = ""       # 另外从这个 dotenv 文件里找 token_env（如 cc-connect 的 secrets.env）；空 = 只看环境变量和仓库 .env
    webhook_env: str = "RH_DISCORD_WEBHOOK"   # 默认频道已有 webhook 地址的环境变量名；没有就按需新建
    webhooks_file: str = "data/discord-webhooks.json"   # 主机建的 webhook（频道 → ID、地址）缓存，相对 roles.toml；不进 git
    allow_bots_file: str = ""  # 主机建了 webhook 就把 ID 追加进这个文件（cc-connect allow_bots_file 读它）；空 = 不写
    create_channels: bool = False   # 判出「新建频道」时真的建；关着就进默认频道
    router: LLMEndpoint = field(default_factory=LLMEndpoint)    # 按意思选频道；没配 = 只进默认频道
    # 选频道时不列进候选的频道 ID（[discord.router] exclude_channels），例如机器日志子频道
    exclude_channels: list[str] = field(default_factory=list)
    summary: LLMEndpoint = field(default_factory=LLMEndpoint)   # 朗读摘要；没配 = 念全文（和没有摘要功能时一样）
    # 摘要长度目标（字）。来源：用户嫌整段念「太烦了，太笨了，太慢了」，橘定十秒内念完；按 rh/hub.py 记的
    # 2026-10-18 实测中文约每秒 4.3 字，取 4 字/秒 × 10 秒 = 40 字。
    summary_chars: int = 40


@dataclass
class DiscordBot:
    """现有平台（Discord）里的一个 bot 对应哪个角色：用这个角色的音色、在绑给这个角色的板子上念。"""
    bot_id: str   # Discord 用户 ID（bot 的）
    name: str     # 只用于日志
    role: str     # roles.toml 里的角色 id
    project: str = ""   # cc-connect 里这个 bot 的 project 名（message.sent 钩子里的 project 字段）；空 = 不收钩子


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
        proj = str(bt.get("project", "") or "")
        if proj and any(b.project == proj for b in bots):
            raise ValueError(f"roles.toml: project {proj} 映射了两次")
        bots.append(DiscordBot(bid, str(bt.get("name", "")) or bid, rid, proj))
    for k in ("play", "relay"):
        if not isinstance(dc.get(k, False), bool):
            raise ValueError(f"roles.toml: [discord] {k} 只能是 true 或 false，现在是 {dc.get(k)!r}")
    channel = str(dc.get("channel", "") or "").strip()
    if channel and not channel.isdigit():
        raise ValueError(f"roles.toml: [discord] channel 要是数字频道 ID，现在是 {channel!r}")
    if dc.get("relay", False) and not channel:
        raise ValueError("roles.toml: [discord] relay = true 要配 channel（板子的话发进哪个频道）")
    settings = _discord_settings(dc, path.resolve().parent)
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
        discord_relay=bool(dc.get("relay", False)),
        discord_channel=channel,
        discord_bots=bots,
        discord=settings,
    )


def _endpoint(d, where: str) -> LLMEndpoint:
    if not isinstance(d, dict):
        raise ValueError(f"roles.toml: [{where}] 要是一张表，现在是 {d!r}")
    known = {"url", "model", "key_env", "key_file", "prefill", "timeout"}
    if set(d) - known:
        raise ValueError(f"roles.toml: [{where}] 不认识 {sorted(set(d) - known)}（只有 {sorted(known)}）")
    e = LLMEndpoint(url=str(d.get("url", "") or "").rstrip("/"), model=str(d.get("model", "") or ""),
                    key_env=str(d.get("key_env", "") or ""),
                    key_file=str(Path(d["key_file"]).expanduser()) if d.get("key_file") else "",
                    prefill=str(d.get("prefill", "") or ""), timeout=float(d.get("timeout", 0) or 0))
    if e.url and not e.model:
        raise ValueError(f"roles.toml: [{where}] 配了 url 要配 model")
    if e.timeout < 0:
        raise ValueError(f"roles.toml: [{where}] timeout 不能是负数")
    return e


# [discord] 段认识的键（DiscordSettings 的项 + play/relay/channel/bots）。多出来的报错，免得写错的键悄悄当成默认值。
DISCORD_KEYS = {"play", "relay", "channel", "bots", "api", "guild", "username", "token_env", "token_file", "webhook_env",
                "webhooks_file", "allow_bots_file", "create_channels", "router", "summary"}


def _discord_settings(dc: dict, base: Path) -> DiscordSettings:
    """[discord] 段里服务器相关的设置；一项都不写 = 现状（只进 channel、念全文、不建频道）。写错的键报错（审查建议 8）。"""
    d = DiscordSettings()
    if set(dc) - DISCORD_KEYS:
        raise ValueError(f"roles.toml: [discord] 不认识 {sorted(set(dc) - DISCORD_KEYS)}（只有 {sorted(DISCORD_KEYS)}）")
    guild = str(dc.get("guild", "") or "").strip()
    if guild and not guild.isdigit():
        raise ValueError(f"roles.toml: [discord] guild 要是数字服务器 ID，现在是 {guild!r}")
    if not isinstance(dc.get("create_channels", False), bool):
        raise ValueError(f"roles.toml: [discord] create_channels 只能是 true 或 false，现在是 {dc.get('create_channels')!r}")
    if dc.get("create_channels") and not guild:
        raise ValueError("roles.toml: [discord] create_channels = true 要配 guild（在哪个服务器建）")
    chars = dc.get("summary", {}).get("chars", d.summary_chars) if isinstance(dc.get("summary"), dict) else d.summary_chars
    if not isinstance(chars, int) or chars <= 0:
        raise ValueError(f"roles.toml: [discord.summary] chars 要是正整数，现在是 {chars!r}")

    def path_of(v: str) -> str:
        p = Path(v).expanduser()
        return str(p if p.is_absolute() else base / p)

    summary = dict(dc.get("summary", {}) or {})
    summary.pop("chars", None)
    router = dict(dc.get("router", {}) or {}) if isinstance(dc.get("router", {}), dict) else dc.get("router")
    exclude = router.pop("exclude_channels", []) if isinstance(router, dict) else []
    if not isinstance(exclude, list) or not all(isinstance(x, str) and x.strip().isdigit() for x in exclude):
        raise ValueError(f"roles.toml: [discord.router] exclude_channels 要是数字频道 ID 的列表，现在是 {exclude!r}")
    return DiscordSettings(
        api=str(dc.get("api", d.api)).rstrip("/"),
        guild=guild,
        username=str(dc.get("username", d.username)) or d.username,
        token_env=str(dc.get("token_env", d.token_env)),
        token_file=str(Path(dc["token_file"]).expanduser()) if dc.get("token_file") else "",
        webhook_env=str(dc.get("webhook_env", d.webhook_env)),
        webhooks_file=path_of(str(dc.get("webhooks_file", d.webhooks_file))),
        allow_bots_file=path_of(str(dc["allow_bots_file"])) if dc.get("allow_bots_file") else "",
        create_channels=bool(dc.get("create_channels", False)),
        router=_endpoint(router, "discord.router"),
        exclude_channels=[x.strip() for x in exclude],
        summary=_endpoint(summary, "discord.summary"),
        summary_chars=chars,
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
