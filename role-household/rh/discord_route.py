"""板子的话进 Discord 时「发到哪个频道」和「念哪几句」：按意思选频道、新建频道、朗读摘要、按频道建 webhook。

用户 2026-10-19：
- 「我预期是有一个中间小模型，或者用一个便宜模型去做一个判断，类似jev，比如我现在说帮我看看我那个量化那边跑怎么样了，
  他就会转到那个量化模型频道那边去，并且可以说新建频道，或者说我们独立开一个频道啊，他专门在这个频道里面干活」
- 「你这样子完全全头全尾的说太烦了，太笨了，太慢了，我预期你有个总结，就是说你文字版是一个，但是你给我朗读出来的又是另一个」
审稿 ~/.claude/reviews/rh-voice-summary-router.md：小模型做主判断（候选 = 现有频道 + 默认 + 新建），不用拼音别名表；
新建之后不粘在新频道；webhook 只放行主机自己建的 ID；摘要只用于 bot 回主人的话。

    主人的一句 ──Router.choose（OpenAI 兼容接口，本机是 LM Studio 上的 Qwen3.5-4B，只答一个字母）──▶
        默认 → [discord] channel        某频道 → 那个频道        新建 → DiscordAPI.create_channel（名字 Router.name 取）
    ──WebhookStore（每个频道一个「板子」webhook：有就用，没有 DiscordAPI.create_webhook 建，ID 追加进放行文件）──▶ 发

    bot 回主人的话 ──Summarizer（同一类接口）──▶ 一两句口语摘要 ──▶ 板子念；没配 → 念全文（和改动前一样）；
    配了但失败、超时 → 只念第一句。频道里的文字不动（文字一份、朗读一份）。

两个模型都是可替换的接口：任何 OpenAI 兼容的 /chat/completions 都行；什么都没配 = 现状（只进默认频道、念全文）。
选频道的候选不含 [discord.router] exclude_channels（如机器日志子频道），也不含被叫到的 bot 看不到或不能发言的频道。
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import string
import threading
import time
import urllib.request
from pathlib import Path
from typing import Callable

import aiohttp

from .config import LLMEndpoint

# 摘要接口超时（秒）。来源：2026-10-19 本机 ai-gateway → LM Studio Qwen3.5-4B 实测热的时候 0.23–0.30 秒，
# 冷启动（模型没加载）6.3 秒；超过 3 秒就不等了，退回第一句（用户嫌「太慢」）。
SUMMARY_TIMEOUT = 3.0
# 选频道接口超时（秒）。来源：同上实测选频道 0.08–0.24 秒（docs/DISCORD_BODY.md「本机实测」）；超时就进默认频道，不让主人的话卡住。
ROUTER_TIMEOUT = 2.0
# 摘要最多生成多少 token。来源：实现者定，40 个汉字的摘要实测 31 token，留余量。
SUMMARY_MAX_TOKENS = 120
# 起频道名最多生成多少 token。来源：实现者定，频道名十来个字。
NAME_MAX_TOKENS = 24
# 频道名最长几个字。来源：实现者定（Discord 上限 100，太长在侧栏里看不全）。
NAME_MAX_CHARS = 20
# 起名失败时的频道名。来源：实现者定，webhook 显示名同一个词，一看就知道是板子建的。
NAME_FALLBACK = "板子新频道"
# 频道列表缓存多久（秒）。来源：实现者定；主机自己新建的频道立即加进缓存，别人在 Discord 里新建/改名的最迟这么久后认得。
CHANNELS_TTL = 300.0
# 选频道时每个频道的说明（topic）最多带几个字。来源：实现者定，现服务器最长的 topic 约 60 字，控制提示词长度。
TOPIC_CHARS = 80
# 选项是单个大写字母（模型只答一个字母）：A 默认、B 新建，频道最多 24 个，再多按 Discord 里的排序取前 24 个。
LETTERS = string.ascii_uppercase
DEFAULT, NEW = "default", "new"
TEXT_CHANNEL = 0   # Discord 频道类型：文字频道

FIRST_END = re.compile(r"[。！？!?；;…\n]")   # 句末（discord_body.speakable 也用）
_NAME_RULE = re.compile(r"(?:专门|用来|拿来)(?:做|聊|搞|研究|弄|讨论|干|放|跑)?(.{1,%d}?)(?:的|吧|呀|啊|。|，|,|$)" % NAME_MAX_CHARS)
_NAME_BAD = re.compile(r"[\s`*#|>~<@:：，,。.!！?？「」\"'（）()\[\]{}/\\]+")


def first_sentence(text: str) -> str:
    """只念第一句（配了摘要但失败、超时时的退路）。"""
    t = text.strip()
    m = FIRST_END.search(t)
    return t[:m.end()].strip() if m else t


def read_key(env: dict[str, str], ep: LLMEndpoint) -> str:
    """接口 key：先看 key_env 指的环境变量，再看 key_file（JSON 取 api_key，否则整份文字）。都没有返回空。"""
    if ep.key_env and env.get(ep.key_env):
        return env[ep.key_env]
    if ep.key_file:
        try:
            raw = Path(ep.key_file).read_text().strip()
        except OSError:
            return ""
        try:
            d = json.loads(raw)
            return str(d.get("api_key", "")) if isinstance(d, dict) else raw
        except ValueError:
            return raw
    return ""


class ChatLLM:
    """OpenAI 兼容 /chat/completions 的最小客户端（同步，调用方放到线程里）。不打日志、不记 key。"""

    def __init__(self, ep: LLMEndpoint, key: str = "", default_timeout: float = SUMMARY_TIMEOUT):
        self.ep, self.key = ep, key
        self.timeout = ep.timeout or default_timeout

    def complete(self, system: str, user: str, max_tokens: int) -> str:
        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        if self.ep.prefill:
            msgs.append({"role": "assistant", "content": self.ep.prefill})
        body = {"model": self.ep.model, "messages": msgs, "max_tokens": max_tokens, "temperature": 0}
        headers = {"Content-Type": "application/json"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(self.ep.url + "/chat/completions", json.dumps(body).encode(), headers)
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            d = json.loads(r.read())
        return str(d["choices"][0]["message"].get("content") or "").strip()


SUMMARY_PROMPT = ("下面是一个 AI 助手在群聊里回主人的一段话。把它压成念给主人听的口语摘要：一两句中文，{chars} 字以内，"
                  "保留结论和要主人做的事，保持她原来的口吻（第一人称）。不要 markdown、代码、链接、文件名、路径。只输出摘要本身。")


class Summarizer:
    """bot 回主人的话 → 一两句口语摘要（用户「文字版是一个，但是你给我朗读出来的又是另一个」）。"""

    def __init__(self, llm: ChatLLM | None, chars: int, clean: Callable[[str], str] = lambda s: s):
        self.llm, self.chars, self.clean = llm, chars, clean

    def brief(self, text: str) -> tuple[str, str]:
        """→ (要念的话, 怎么来的：short / full / summary / first:<原因>)。本来就不长的原样念；
        没配摘要模型念全文（= 没有摘要功能时的行为，审查建议 4）；配了但失败、超时、为空只念第一句。"""
        if len(text) <= self.chars:
            return text, "short"
        if self.llm is None:
            return text, "full"
        try:
            out = self.clean(self.llm.complete(SUMMARY_PROMPT.format(chars=self.chars), text, SUMMARY_MAX_TOKENS))
        except Exception as e:   # 连不上、超时、回的不是 JSON：退回第一句
            return first_sentence(text), f"first:{type(e).__name__}"
        if not out:
            return first_sentence(text), "first:摘要为空"
        return out, "summary"


ROUTE_PROMPT = ("主人对着语音助手说了一句话，要把这句话发到 Discord 的某个频道让 AI 去做。"
                "按这句话说的是哪摊事选频道：说到某个频道管的事（比如「量化那边」就是管量化的频道），选那个频道；"
                "开头叫的名字（比如「小橘」）只是在叫人，不算选频道的依据。\n{options}\n只答一个字母。")
NAME_PROMPT = ("主人要新开一个 Discord 频道，从他这句话里取频道名：说明这个频道干什么，2 到 {n} 个字，"
               "不要「频道」两个字、不要标点。只输出名字。")


class Router:
    """按意思选频道（审稿第 1 条：小模型做主判断）。候选 = A 默认 + B 新建 + 服务器里的文字频道（名字和说明）。"""

    def __init__(self, llm: ChatLLM):
        self.llm = llm

    def options(self, channels: list[dict], default_id: str) -> tuple[str, list[str]]:
        """→ (选项说明, 每个字母对应什么：DEFAULT / NEW / 频道 ID)。默认频道不单列，就是 A。"""
        here = next((f"（#{c['name']}" + (f"：{_topic(c)}" if _topic(c) else "") + "）"
                     for c in channels if c["id"] == default_id), "")
        lines = [f"A 原地：就在主人平常和她说话的频道{here}。闲聊、问候、没指明哪个频道或哪摊事的，都选 A",
                 "B 新建频道：主人明确说要新建/新开/独立开一个频道来做这件事"]
        keys = [DEFAULT, NEW]
        for c in [c for c in channels if c["id"] != default_id][:len(LETTERS) - 2]:
            topic = _topic(c)
            lines.append(f"{LETTERS[len(keys)]} #{c['name']}" + (f"：{topic}" if topic else ""))
            keys.append(c["id"])
        return "\n".join(lines), keys

    def choose(self, text: str, channels: list[dict], default_id: str) -> tuple[str, str]:
        """→ (DEFAULT / NEW / 频道 ID, 模型答的字母或出错原因)。出错、答的不是选项 → DEFAULT。"""
        opts, keys = self.options(channels, default_id)
        try:
            a = self.llm.complete(ROUTE_PROMPT.format(options=opts), f"主人说：「{text}」", 4)
        except Exception as e:
            return DEFAULT, f"出错 {type(e).__name__}"
        letter = a[:1].upper()
        if letter not in LETTERS[:len(keys)]:
            return DEFAULT, f"答的不是选项 {a[:10]!r}"
        return keys[LETTERS.index(letter)], letter

    def name(self, text: str) -> str:
        """新频道的名字：先让模型从这句话里取，不行再按「专门做 X」取 X，再不行用 NAME_FALLBACK。"""
        try:
            n = clean_name(self.llm.complete(NAME_PROMPT.format(n=NAME_MAX_CHARS), text, NAME_MAX_TOKENS))
        except Exception:
            n = ""
        return n or rule_name(text) or NAME_FALLBACK


def _topic(c: dict) -> str:
    return (c.get("topic") or "").strip().replace("\n", " ")[:TOPIC_CHARS]


def clean_name(s: str) -> str:
    s = _NAME_BAD.sub("-", s.strip().splitlines()[0] if s.strip() else "").strip("-").lower()
    s = s.removesuffix("频道").strip("-")
    return s[:NAME_MAX_CHARS]


def rule_name(text: str) -> str:
    m = _NAME_RULE.search(text)
    return clean_name(m.group(1)) if m else ""


# Discord 权限位（https://discord.com/developers/docs/topics/permissions）：管理员、看频道、在频道发言。
ADMINISTRATOR, VIEW_CHANNEL, SEND_MESSAGES = 1 << 3, 1 << 10, 1 << 11
_SCRUB = re.compile(r"webhooks/\d+/[\w.-]+")


def scrub(s: str) -> str:
    """错误文字里若带 webhook 地址（含 token），抹成 webhooks/<id>/<token>。"""
    return _SCRUB.sub("webhooks/<id>/<token>", s)


def can_post(channel: dict, guild: str, roles: dict[str, int], member_roles: list[str], user: str) -> bool:
    """这个成员在这个频道能不能看见并发言（Discord 文档的权限计算：@everyone + 身份组，再叠频道的覆盖）。"""
    base = roles.get(guild, 0)
    for r in member_roles:
        base |= roles.get(r, 0)
    if base & ADMINISTRATOR:
        return True
    ow = {o["id"]: (int(o.get("allow", 0)), int(o.get("deny", 0))) for o in channel.get("overwrites", [])}
    perm = base
    if guild in ow:
        perm = (perm & ~ow[guild][1]) | ow[guild][0]
    allow = deny = 0
    for r in member_roles:
        if r in ow:
            allow, deny = allow | ow[r][0], deny | ow[r][1]
    perm = (perm & ~deny) | allow
    if user in ow:
        perm = (perm & ~ow[user][1]) | ow[user][0]
    return perm & (VIEW_CHANNEL | SEND_MESSAGES) == VIEW_CHANNEL | SEND_MESSAGES


class DiscordAPI:
    """bot token 调 Discord REST：列频道、读身份组和成员、建文字频道、建 webhook。token 不进日志、不进错误信息。"""

    def __init__(self, base: str, token: str, timeout: float):
        self.base, self.token, self.timeout = base.rstrip("/"), token, timeout

    async def _req(self, method: str, path: str, body: dict | None = None):
        headers = {"Authorization": f"Bot {self.token}", "User-Agent": "DiscordBot (role-household, 1)"}
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=self.timeout)) as s:
            async with s.request(method, self.base + path, json=body, headers=headers) as r:
                if r.status // 100 != 2:
                    raise RuntimeError(f"Discord {method} {path.split('/')[1]} HTTP {r.status}")
                return await r.json()

    async def text_channels(self, guild: str) -> list[dict]:
        out = await self._req("GET", f"/guilds/{guild}/channels")
        chans = [c for c in out if c.get("type") == TEXT_CHANNEL]
        chans.sort(key=lambda c: (c.get("position", 0), c["id"]))
        return [{"id": str(c["id"]), "name": str(c.get("name", "")), "topic": c.get("topic") or "",
                 "overwrites": [{"id": str(o["id"]), "allow": str(o.get("allow", 0)), "deny": str(o.get("deny", 0))}
                                for o in c.get("permission_overwrites") or []]} for c in chans]

    async def roles(self, guild: str) -> dict[str, int]:
        """身份组 ID → 权限位（@everyone 的 ID = 服务器 ID）。"""
        return {str(r["id"]): int(r.get("permissions", 0)) for r in await self._req("GET", f"/guilds/{guild}/roles")}

    async def member_roles(self, guild: str, user: str) -> list[str]:
        m = await self._req("GET", f"/guilds/{guild}/members/{user}")
        return [str(r) for r in m.get("roles") or []]

    async def create_channel(self, guild: str, name: str) -> dict:
        c = await self._req("POST", f"/guilds/{guild}/channels", {"name": name, "type": TEXT_CHANNEL})
        return {"id": str(c["id"]), "name": str(c.get("name", name)), "topic": c.get("topic") or "", "overwrites": []}

    async def create_webhook(self, channel: str, name: str) -> tuple[str, str]:
        """→ (webhook ID, 发消息的地址)。地址里带 token：只存进 webhooks_file（0600），不进日志。"""
        w = await self._req("POST", f"/channels/{channel}/webhooks", {"name": name})
        return str(w["id"]), f"{self.base}/webhooks/{w['id']}/{w['token']}"


class WebhookStore:
    """每个频道一个主机建的 webhook：频道 ID → {id, url}，存 webhooks_file（权限 0600，不进 git）。
    建了新的先把 ID 追加进 allow_bots_file（cc-connect 运行时读，审稿 rh-voice-summary-router 第 3 条：只放行主机自己建的
    webhook ID），追加成功才存（审查建议 3：放行名单写不进去时不留一个 cc-connect 永远丢弃的 webhook）。"""

    def __init__(self, path: str = "", allow_file: str = ""):
        """path 空 = 只记在内存里（没配 roles.toml 时，例如测试）。"""
        self.path = Path(path) if path else None
        self.allow_file = Path(allow_file) if allow_file else None
        self._mu = threading.Lock()
        try:
            self.hooks: dict[str, dict] = json.loads(self.path.read_text()) if self.path else {}
        except (OSError, ValueError):
            self.hooks = {}

    def url(self, channel: str) -> str:
        with self._mu:
            return str(self.hooks.get(channel, {}).get("url", ""))

    def add(self, channel: str, wid: str, url: str) -> None:
        """出错（放行文件或存储写不进去）抛 OSError；放行文件写失败时什么都不存。"""
        with self._mu:
            self._allow(wid)
            self.hooks[channel] = {"id": wid, "url": url, "created": time.strftime("%F %T")}
            if self.path is not None:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as f:
                    json.dump(self.hooks, f, ensure_ascii=False, indent=1)
                os.replace(tmp, self.path)

    def reconcile(self) -> list[str]:
        """启动时对账：存着的 webhook ID 不在放行文件里的补上（之前追加失败、文件被手改）。→ 补上的 ID。"""
        if self.allow_file is None:
            return []
        with self._mu:
            have = set(self.allow_file.read_text().split()) if self.allow_file.exists() else set()
            missing = [str(h["id"]) for h in self.hooks.values() if h.get("id") and str(h["id"]) not in have]
            for wid in missing:
                self._allow(wid)
            return missing

    def _allow(self, wid: str) -> None:
        if self.allow_file is None:
            return
        text = self.allow_file.read_text() if self.allow_file.exists() else ""
        if wid in text.split():
            return
        self.allow_file.parent.mkdir(parents=True, exist_ok=True)
        with self.allow_file.open("a") as f:
            # 用户手改过、末尾没换行：先补一个，不然新 ID 接在上一行后面，两个都失效
            f.write(("\n" if text and not text.endswith("\n") else "") + f"{wid}\n")


class Channels:
    """服务器的文字频道列表，缓存 CHANNELS_TTL 秒；主机新建的立刻加进去。
    get(bots) 去掉 exclude 里的频道和这几个 bot 看不到、不能发言的频道（审查建议 2）。
    身份组或成员读不到时不按权限过滤（只记一次日志），排除列表照样生效。"""

    def __init__(self, api: DiscordAPI, guild: str, exclude: list[str] | tuple = (),
                 log: Callable[[str], None] = lambda s: None):
        self.api, self.guild, self.exclude, self.log = api, guild, set(exclude), log
        self._list: list[dict] = []
        self._roles: dict[str, int] | None = None
        self._members: dict[str, list[str] | None] = {}   # bot ID → 身份组；None = 读不到
        self._at = 0.0
        self._lock = asyncio.Lock()

    async def get(self, bots: list[str] | tuple = (), refresh: bool = False) -> list[dict]:
        """refresh = 不管缓存，重新列一次（新建频道前找同名的用）。"""
        async with self._lock:
            if refresh or not self._list or time.monotonic() - self._at > CHANNELS_TTL:
                self._list = await self.api.text_channels(self.guild)
                self._at = time.monotonic()
                self._roles, self._members = None, {}
            chans = [c for c in self._list if c["id"] not in self.exclude]
            if not bots:
                return [dict(c) for c in chans]
            if self._roles is None:
                try:
                    self._roles = await self.api.roles(self.guild)
                except Exception as e:
                    self.log(f"[discord] 读服务器身份组失败（{type(e).__name__}: {e}），这次不按权限筛频道")
                    self._roles = {}
            if not self._roles:
                return [dict(c) for c in chans]
            known = []
            for b in bots:
                if b not in self._members:
                    try:
                        self._members[b] = await self.api.member_roles(self.guild, b)
                    except Exception as e:
                        self.log(f"[discord] 读 bot {b} 的身份组失败（{type(e).__name__}: {e}），不按她的权限筛频道")
                        self._members[b] = None
                if self._members[b] is not None:
                    known.append(b)
            return [dict(c) for c in chans
                    if all(can_post(c, self.guild, self._roles, self._members[b], b) for b in known)]

    def add(self, c: dict) -> None:
        if all(x["id"] != c["id"] for x in self._list):
            self._list.append(c)
