"""cc-connect 驱动的 bot 接进 hub：hub 当 cc-connect cloud_web 平台的网关（CWIP，协议见
conest bridge/docs/cloud-web.md）。这样 Discord 上那几个能干活的 bot（橘、龙娘、鲸鱼娘、彩虹猫）也能在
hub 的频道里说话，干活、续会话、gate 判谁回、bot 间接力都由 cc-connect 原样负责，hub 只做转发。

连接：cc-connect 拨 ws(s)://<hub>/cloud-web/ws?bot=<成员 id>&name=<显示名>&mention_id=<可选>
    鉴权：设了 RH_BOT_TOKEN 只认它（和网页登录的 RH_HUB_TOKEN 分开）；没设时认 RH_HUB_TOKEN。
    cc-connect 会放在 Authorization: Bearer 头和 ?token= 里。
    bot 缺省用 register 帧里的 project 名；name 缺省用 hub 成员表里同 id 的名字，再没有就用 id。
    mention_id：这个 bot 在消息里还能写成 <@mention_id>。bot 人设里写的是 Discord 的「<@id> 就会 @ 到她」，
    填 Discord 用户 ID 后，bot 在 hub 里照原样 @ 队友就能接力，不用改人设。
    mention_id 只收数字（gate 认的是 <@数字>）；不配时别的 bot 收到的是「@名字」，gate 的「@了别人」规则不生效，
    被 @ 的 sub 照样回，但橘可能也跟着回。所以上线要配。
    同一个 bot 再连上时踢掉旧连接（cc-connect 重启或重连）。
    cc-connect 那边要开 group_reply_all = true（不然没 @ 它的消息在 gate 之前就被丢了，sub 听不到频道）和
    share_session_in_channel = true（一个频道一个会话）。

hub → bot（每条新的用户/角色消息发给每个在线 bot，系统消息不发，自己说的不回给自己）：
    {"type":"message","msg_id":"hub-<id>","chat_id":"room-<频道 id>","chat_type":"group","user_id","user_name",
     "content","reply_ctx":"room-<频道 id>","mentioned":bool,"from_bot":bool,"chat_name":"<频道名>",
     "user_mention_id":"<发话 bot 的 mention_id，bot 发的且配了才有>"}
    chat_name：cc-connect 填进「队友状态」（别的频道里忙时显示 #频道名，同 Discord 的频道名）。
    user_mention_id：cc-connect 拿它和 team_lead_bot 比，认出「队长 @ 我派的活」，做完的回复自动带上 <@队长>（同 Discord lead_return）。
    chat_id 用 hub 的会话键 session_key(频道 id)（rh/hub.py「会话键」：主机的会话目录、接进来的 bot 都用它）。
    不带 session_key：由 cc-connect 按 share_session_in_channel 拼成 <平台名>:room-<频道 id>，一个频道一个会话。
    回来的 reply_ctx / session_key 认 room-<id>，也认纯数字的 <id>。归档的频道不收 bot 的话（hub 拒收，丢掉不断线）。
    @ 的写法：网页里人写 @名字 / @id / <@mention_id>。被 @ 的那个 bot 收到时去掉自己的 @（同时 @ 了别人时改成
    「@名字(你)」，同 Discord markSelfMention）；其他 bot 收到的 @ 写成 <@mention_id>（没配就留 @名字），
    这样 gate 的「@了别人」规则（~/im-bridge/gate/gate.py decide）和 Discord 上一样生效。
    bot 说的话：from_bot=true，正文前加【名字】（同 Discord，gate 和 rhbody 认这个前缀）；
    「↪ 已插入」这类状态提示不转（同 Discord isBotNotice），❌ ⚠️ 报错照转（队长要接）。
bot → hub：reply（content 写进频道，作者是这个 bot，状态 done；一段回复存一条，不再按 2000 字拆），ping 回 pong。
    reply 带 "agent": true 的是 bot 在会话里写的话，存成 from_turn=1。补「频道里你上次看到之后的消息」时 cc-connect 用 bot 的
    token 读 GET /api/rooms/{room}/messages，跳过自己 from_turn=1 的（它会话里已有），其余照补（同 Discord turn_sent.go）。
    显示（用户 2026-10-20「你可以去修一下自建平台，那边感觉还是很垃圾」，照 Discord 做）：
    typing_start / typing_stop：这个 bot 在这个频道干活 / 干完（cc-connect 每轮开头、结尾各发一次），成员栏显示思考中。
    preview_start {ref_id, content}：新建一条，回 {"type":"preview_ack","ref_id","preview_handle": 消息 id}；
        频道不对也回（handle 为空），不然 cc-connect 要干等 10 秒。
    update_message {preview_handle, content}：原地改那条；delete_message {preview_handle}：删掉那条。只能动自己发的。
    content 以 PROGRESS_PREFIX 开头的是进度卡片（cc-connect progress_style=card）：存成卡片，做完保留（同 Discord）。
    以 SUBTASK_PREFIX 开头的是子进程表（主回合开的子 agent），同样存成卡片、原地改到全部完成（同 Discord）。
    其余是流式预览（边写边改，写完 cc-connect 删掉它、另发 reply）。卡片和预览都不转给队友，只有 reply 转。
    其余类型没声明能力，cc-connect 会降级成 reply（cloud_web/cloudweb.go 各 Send* 方法）。
"""
from __future__ import annotations

import asyncio
import json
import re
from aiohttp import WSCloseCode, WSMsgType, web

from .meeting import MAX_TEXT_CHARS, clean

MAX_NAME = 64  # bot id、显示名最长多少字。来源：沿用 hub.py MAX_NAME（存消息时作者按它截，不同长会认不出自己）。

WS_PATH = "/cloud-web/ws"
# 声明给 cc-connect 的能力。reconstruct_reply 让 cron 等主动消息找得到频道（cc-connect 只在内存里记
# 频道的 reply_ctx，它重启后要等这个频道来一条新消息才找得到）。
# preview + update_message：进度卡片原地改（feat/cloudweb-botux 的 cc-connect 只拿 preview 发卡片，流式文字预览不走这里；
# 旧版 cc-connect 会拿它做流式预览）；delete_message：配合旧版的流式预览写完删掉（没有它预览删不掉，正式回复会重复一份，
# core/streaming.go finish）；typing：成员栏的「思考中」。
# 按钮、card（交互卡片）不声明，cc-connect 自动降级成文字（docs/cloud-web.md「Handshake」）。
# subtask_table：会画子进程表（subtask_table_from）；cc-connect 只对声明了它的 hub 发表，旧 hub 不会把表显示成原始数据。
CAPABILITIES = ["text", "reconstruct_reply", "typing", "preview", "update_message", "delete_message", "subtask_table"]
REGISTER_TIMEOUT = 10.0  # 连上后多少秒内要发 register。来源：沿用 hub.py HELLO_TIMEOUT。
HEARTBEAT = 30.0  # 来源：沿用 hub.py HEARTBEAT。
WS_BAD_REGISTER = 4002  # 来源：沿用 hub.py WS_BAD_HELLO（RFC 6455 应用自定义关闭码段）。
WS_REPLACED = 4003  # 来源：沿用 hub.py WS_REPLACED。
MAX_FRAME = MAX_TEXT_CHARS * 64  # bot 的一条回复可能很长。来源：实现者定，单条 128K 字以内。
# bot 一条消息最多多少字：一帧装得下的都存成一条。cc-connect 发来的回复已经按 4000 字、不切断代码块地分好段
# （conest bridge/core/engine.go maxPlatformMessageLen、SplitMessageCodeFenceAware），hub 再按 2000 字硬切会切断代码块。
MAX_BOT_CHARS = MAX_FRAME
# 进度卡片的前缀。来源：conest bridge/core/progress_compact.go ProgressCardPayloadPrefix。
PROGRESS_PREFIX = "__cc_connect_progress_card_v1__:"
# 卡片标题里的状态字、一行的写法：照 conest bridge/platform/discord/progress.go（discordProgress*Text、buildDiscordProgressLineN）。
CARD_STATES = {"running": "处理中", "completed": "已完成", "failed": "失败"}
CARD_ICONS = {"thinking": "💭", "tool_use": "🔧", "tool_result": "🧾", "error": "❌"}
CARD_LINE_LEN = 80  # payload 没带 line_len 时一行多少字。来源：discord/progress.go maxDiscordProgressLineLen。
# 这些开头的是 cc-connect 的状态提示，不转给队友。来源：conest bridge/platform/discord/discord.go isBotNotice。
NOTICE_PREFIXES = ("📬", "✅", "↪", "⏳", "🔄", "⏹", "⏸")
# cc-connect 加在回复末尾的「模型 · 用量」尾注，转给队友前去掉。来源：discord.go botFooter。
FOOTER = re.compile(r"(?:^|\n+)\*[^*\n]*·[^*]*\*\s*$", re.S)
# 只 @ 不写字时补的话。来源：discord.go 同一处的原文（maomao fork「a bare @ means look at what's going on」）。
BARE_MENTION = "（只 @ 了你，没写内容：看上面的频道消息判断要你做什么；看不出来就问）"
# 队友点名后面跟这些标点算叫她。来源：conest bridge/platform/discord/mentions.go nameCalled。
CALL_PUNCT = "，,：:！!？?、～~"
FENCE = "```"


def _trim(s: str, n: int) -> str:
    s = " ".join(str(s).split())   # 同 compactDiscordProgressText：换行、连续空白并成一个空格
    return s if len(s) <= n else s[:max(n - 1, 0)] + "…"


def card_from(content: str) -> tuple[str, str] | None:
    """cc-connect 的进度卡片 → (正文, card JSON)。不是卡片返回 None。
    正文照 Discord 的列表卡片（discord/progress.go buildDiscordProgressList）：第一行「第 N 步 · 用时」，下面每步一行；
    最近几步由 cc-connect 按 progress_card_entries 截好。card 只放网页画外框要的：标题、状态、步数、用时。"""
    if not content.startswith(PROGRESS_PREFIX):
        return None
    try:
        p = json.loads(content[len(PROGRESS_PREFIX):])
    except ValueError:
        return None
    if not isinstance(p, dict):
        return None
    state = p.get("state") if p.get("state") in CARD_STATES else "running"
    steps = p.get("steps") if isinstance(p.get("steps"), int) else 0
    sec = p.get("elapsed_sec") if isinstance(p.get("elapsed_sec"), int) else 0
    n = p.get("line_len") if isinstance(p.get("line_len"), int) and p.get("line_len") > 0 else CARD_LINE_LEN
    lines = [f"第 {steps} 步 · " + (f"{sec // 60}分{sec % 60:02d}秒" if sec >= 60 else f"{sec}秒")]
    items = p.get("items") if isinstance(p.get("items"), list) else         [{"kind": "info", "text": e} for e in p.get("entries") or [] if isinstance(e, str)]
    for it in items:
        if not isinstance(it, dict) or not str(it.get("text") or "").strip():
            continue
        kind, text, tool = it.get("kind"), str(it["text"]), str(it.get("tool") or "").strip()
        if kind == "tool_use":
            body = f"{tool or '工具'} — {_trim(text, n)}"
        elif kind == "tool_result":
            meta = [str(it["status"]).strip()] if str(it.get("status") or "").strip() else []
            if isinstance(it.get("exit_code"), int):
                meta.append(f"exit {it['exit_code']}")
            meta.append(_trim(text, n))
            body = (f"{tool} — " if tool else "") + " · ".join(meta)
        else:
            body = text
        lines.append(f"{CARD_ICONS.get(kind, '•')} {_trim(body, n - 2)}")
    agent = str(p.get("agent") or "Agent").strip() or "Agent"
    meta = {"title": f"{agent} · {CARD_STATES[state]}", "state": state, "steps": steps, "elapsed_sec": sec}
    return "\n".join(lines), json.dumps(meta, ensure_ascii=False)


# 子进程表（cc-connect 主回合开的子 agent，一个一行）。前缀来源：conest bridge/core/subtasks.go SubTaskTablePayloadPrefix。
SUBTASK_PREFIX = "__cc_connect_subtask_table_v1__:"
# 图标、前台/后台、「开始于 / 用时」、等后台任务的字样：照 conest bridge/platform/discord/subtasks.go buildDiscordSubTaskRow。
SUBTASK_ICONS = {"completed": "✅", "failed": "❌", "stopped": "⏹️", "waiting": "⏳"}
SUBTASK_LIVE = ("running", "waiting")
# 中文 / 英文字样：标题、前台、后台、开始于、用时前缀、等后台任务。来源：discord/subtasks.go:23-27、70-110。
SUBTASK_WORDS = {"zh": ("子进程表", "前台", "后台", "开始于", "用时 ", "等自己的后台任务"),
                 "en": ("Sub-agents", "fg", "bg", "started", "", "waiting for its own background task")}
SUBTASK_DESC_LEN = 3500   # 整张表最多多少字。来源：discord/progress.go maxDiscordProgressDescLen（表的 embed 正文同一上限）
_GO_TIME = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$")


def _go_time(v: object) -> int:
    """Go 的 time.Time JSON（RFC3339，小数到纳秒）→ unix 秒；零时间、坏数据为 0。"""
    from datetime import datetime
    m = _GO_TIME.match(v) if isinstance(v, str) else None
    if not m or m.group(1).startswith("0001-"):
        return 0
    try:
        return int(datetime.fromisoformat(m.group(1) + ("+00:00" if m.group(3) == "Z" else m.group(3))).timestamp())
    except ValueError:
        return 0


def _duration(sec: int, zh: bool = True) -> str:
    """同 discord/subtasks.go discordDuration。"""
    sec = max(sec, 0)
    if not zh:
        return f"{sec // 60}m{sec % 60:02d}s"
    return f"{sec // 60}分{sec % 60:02d}秒" if sec >= 60 else f"{sec}秒"


def _trim_runes(s: str, n: int) -> str:
    """同 discord/progress.go trimDiscordRunes：去首尾空白，超了截到 n-1 字加「…」（不并空白，保留换行）。"""
    s = s.strip()
    return s if len(s) <= n else s[:n - 1] + "…"


def subtask_table_from(content: str) -> tuple[str, str] | None:
    """cc-connect 的子进程表 → (正文, card JSON)。不是表返回 None。
    正文照 Discord（discord/subtasks.go buildDiscordSubTaskEmbed）：每个子 agent 两行，「图标 前台/后台 · 描述 · 开始于 <t:秒:R>」
    （<t:…:R> 是 Discord 的时间写法，网页 hub.html 画成本地时刻）或「· 用时 …」，下一行「　└ 当前那一步 / 结束总结」。
    payload 的 lang 不是 zh 开头时用英文字样（Sub-agents / fg / bg / started）。整张表最多 SUBTASK_DESC_LEN 字。
    card 用进度卡片的外框：标题「子进程表」/「Sub-agents」；state 同 Discord 颜色：有在跑的 running，否则有失败的 failed，否则 completed。"""
    if not content.startswith(SUBTASK_PREFIX):
        return None
    try:
        p = json.loads(content[len(SUBTASK_PREFIX):])
    except ValueError:
        return None
    tasks = p.get("tasks") if isinstance(p, dict) else None
    if not isinstance(tasks, list):
        return None
    # 同 discord/subtasks.go：normalizeDiscordProgressLang 为 "zh"（zh 开头、不是 zh-tw / zh-hk）才中文，其余英文
    lang = str(p.get("lang") or "").strip().lower()
    zh = lang.startswith("zh") and lang not in ("zh-tw", "zh-hk")
    title, fg, bg, started, took, wait = SUBTASK_WORDS["zh" if zh else "en"]
    rows, running, failed = [], 0, 0
    for t in tasks:
        if not isinstance(t, dict):
            continue
        status = str(t.get("status") or "")
        running += status in SUBTASK_LIVE
        failed += status == "failed"
        head = f"{SUBTASK_ICONS.get(status, '🔄')} {bg if t.get('background') else fg} · " \
               f"{_trim(t.get('description') or '', CARD_LINE_LEN)}"
        start, end = _go_time(t.get("started_at")), _go_time(t.get("ended_at"))
        if status in SUBTASK_LIVE and start:
            head += f" · {started} <t:{start}:R>"
        elif start and end:
            head += f" · {took}" + _duration(end - start, zh)
        detail = str(t.get("summary") or "") if status != "running" and t.get("summary") else str(t.get("step") or "")
        if status == "waiting":
            detail = wait + (f" — {_trim(detail, 10**6)}" if detail.strip() else "")
        if detail.strip():
            head += "\n　└ " + _trim(detail, CARD_LINE_LEN)
        rows.append(head)
    state = "running" if running else "failed" if failed else "completed"
    return _trim_runes("\n".join(rows), SUBTASK_DESC_LEN) or " ", json.dumps({"title": title, "state": state}, ensure_ascii=False)


class Bot:
    def __init__(self, ws: web.WebSocketResponse, bot_id: str, name: str, mention_id: str):
        self.ws, self.id, self.name, self.mention_id = ws, bot_id, name, mention_id


class CloudWeb:
    def __init__(self, hub):
        self.hub = hub
        self.bots: dict[str, Bot] = {}

    # ---------- @ ----------
    def _aliases(self) -> list[tuple[str, str]]:
        """(写法, bot id)，长的在前，免得「鲸鱼」先吃掉「鲸鱼娘」。"""
        out = []
        for b in self.bots.values():
            out += [("@" + b.name, b.id), ("@" + b.id, b.id)]
            # mention_id 只收数字：gate 认的是 <@数字>（gate.py「@了别人」规则）
            if b.mention_id:
                out += [(f"<@{b.mention_id}>", b.id), (f"<@!{b.mention_id}>", b.id)]
        return sorted(out, key=lambda x: len(x[0]), reverse=True)

    def _split(self, text: str) -> list[tuple[str, str | None]]:
        """按 @ 切开：[(片段, 被 @ 的 bot id 或 None)]。``` 代码块里的不算（同 discord mentions.go replaceMentions）。"""
        aliases = self._aliases()
        if not aliases:
            return [(text, None)]
        pat = re.compile("|".join(re.escape(a) for a, _ in aliases))
        lookup = dict(aliases)
        parts = []
        for i, seg in enumerate(text.split(FENCE)):
            if i:
                parts.append((FENCE, None))
            if i % 2:   # 代码块里
                parts.append((seg, None))
                continue
            pos = 0
            for m in pat.finditer(seg):
                parts.append((seg[pos:m.start()], None))
                parts.append((m.group(0), lookup[m.group(0)]))
                pos = m.end()
            parts.append((seg[pos:], None))
        return parts

    @staticmethod
    def name_called(text: str, name: str) -> bool:
        """队友没 @、直接点名叫她（「行了龙娘，…」「龙娘？」或一行开头的「龙娘 …」）。句中提到不算。
        照搬 discord mentions.go nameCalled。"""
        text = re.sub(r"(?s)```.*?```", "", text)
        names = [name]
        short = name.lstrip("".join(chr(c) for c in range(128)))   # 「Claude橘」→「橘」，同 Go 版去掉开头 ASCII
        if short and short != name:
            names.append(short)
        return any(CloudWeb._called(text, n) for n in names)

    @staticmethod
    def _called(text: str, name: str) -> bool:
        for line in text.split("\n"):
            line = line.strip()
            i = line.find(name)
            while i >= 0:
                rest = line[i + len(name):]
                if rest[:1] and rest[0] in CALL_PUNCT:
                    return True
                if i == 0 and (not rest or rest[0].isspace()):
                    return True
                i = line.find(name, i + len(name))
        return False

    def mentions(self, text: str) -> set[str]:
        return {b for _, b in self._split(text) if b}

    def for_display(self, text: str) -> str:
        """存进频道的写法：<@id> 换成 @名字（网页上显示名字）。"""
        return "".join(("@" + self.bots[b].name) if b else s for s, b in self._split(text))

    def for_bot(self, text: str, to: Bot) -> str:
        parts = self._split(text)
        others = any(b and b != to.id for _, b in parts)
        out, eat = [], False
        for s, b in parts:
            if b is None:
                out.append(s[1:] if eat and s[:1] in (" ", "\t") else s)   # 去掉自己的 @ 时连带它后面那个空格
                eat = False
            elif b == to.id:
                out.append(f"@{to.name}(你)" if others else "")
                eat = not others and (not "".join(out).strip() or "".join(out)[-1:].isspace())   # 前面也是空白才吃，免得两边粘一起
            else:
                ob = self.bots[b]
                out.append(f"<@{ob.mention_id}>" if ob.mention_id else "@" + ob.name)
        return "".join(out).strip()   # 不整段收空白：代码块的缩进要原样转（复审第 1 条）

    # ---------- hub → bot ----------
    async def on_new(self, msg: dict) -> None:
        """hub 里新建了一条消息（Hub.notify_new 调）：转给在线的 bot。"""
        if msg["author_kind"] == "system" or not self.bots:
            return
        from_bot = msg["author_kind"] == "role"
        text = msg["text"]
        if from_bot:
            if text.lstrip().startswith(NOTICE_PREFIXES):
                return
            text = FOOTER.sub("", text).strip()
            if not text:
                return   # 只有尾注
        from .hub import session_key   # hub.py 导入本模块，放这里免得循环导入
        chat = session_key(msg["room_id"])
        room = self.hub.room(msg["room_id"])
        author = self.bots.get(msg["author"]) if from_bot else None
        mentioned = self.mentions(text)
        sends = []
        for b in list(self.bots.values()):
            if from_bot and msg["author"] == b.id:
                continue
            content = self.for_bot(text, b)
            hit = b.id in mentioned or (from_bot and self.name_called(text, b.name))
            if from_bot and not content:
                continue   # 队友只发了个 @：同 Discord 丢掉，不空开一轮（复审第 3 条）
            if from_bot:
                content = f"【{msg['name']}】{content}"
            elif hit and not content:
                content = BARE_MENTION
            frame = {"type": "message", "msg_id": f"hub-{msg['id']}", "chat_id": chat,
                     "chat_type": "group", "user_id": msg["author"], "user_name": msg["name"], "content": content,
                     "reply_ctx": chat, "mentioned": hit, "from_bot": from_bot}
            if room is not None:
                # 「队友状态」里显示频道名（conest core/team.go ChatName）；压成一行，频道名里的换行不能在队友状态里伪造出一行（审查第 3 条）
                frame["chat_name"] = " ".join(room["name"].split())
            if author is not None and author.mention_id:
                frame["user_mention_id"] = author.mention_id   # 认队长派的活，同 Discord 作者 ID（conest cloud-web lead_return.go）
            sends.append(self._send(b.ws, frame))
        await asyncio.gather(*sends)

    async def _send(self, ws: web.WebSocketResponse, frame: dict) -> None:
        try:
            await ws.send_str(json.dumps(frame, ensure_ascii=False))
        except Exception:  # 对方已断，等它的处理协程自己清理
            pass

    # ---------- bot → hub ----------
    def _room(self, d: dict) -> int | None:
        sk = d.get("session_key")
        for raw in (d.get("reply_ctx"), sk.split(":")[1] if isinstance(sk, str) and sk.count(":") >= 1 else None):
            if isinstance(raw, str) and raw.startswith("room-"):
                raw = raw[len("room-"):]
            if isinstance(raw, str) and raw.isascii() and raw.isdigit() and self.hub.room(int(raw)) is not None:
                return int(raw)
        return None

    async def from_bot(self, bot: Bot, d: dict) -> None:
        t = d.get("type")
        if t == "ping":
            await self._send(bot.ws, {"type": "pong"})
        elif t == "reply":
            await self._reply(bot, d)
        elif t in ("typing_start", "typing_stop"):
            room = self._room(d)
            if room is not None:
                await self.hub.set_bot_thinking(room, bot.id, t == "typing_start")
        elif t == "preview_start":
            await self._preview_start(bot, d)
        elif t in ("update_message", "delete_message"):
            h = d.get("preview_handle")
            if not (isinstance(h, str) and h.isascii() and h.isdigit()):
                return
            if t == "delete_message":
                msg = self.hub.bot_delete(int(h), bot.id)
                if msg is not None:
                    await self.hub.broadcast({"type": "deleted", "id": msg["id"], "room_id": msg["room_id"]},
                                             msg["room_id"])
                return
            text, card = self._body(d.get("content"))
            msg = self.hub.bot_edit(int(h), bot.id, text, card, MAX_BOT_CHARS) if text else None
            if msg is not None:
                await self.hub.broadcast({"type": "message", "message": msg}, msg["room_id"])

    def _body(self, content: object) -> tuple[str, str | None]:
        """(存进频道的正文, 卡片 JSON 或 None)。"""
        if not isinstance(content, str):
            return "", None
        c = card_from(content) or subtask_table_from(content)
        return c if c else (self.for_display(content).strip(), None)

    async def _preview_start(self, bot: Bot, d: dict) -> None:
        ref = d.get("ref_id")
        if not isinstance(ref, str):
            return
        from .hub import Conflict   # hub.py 导入本模块，放这里免得循环导入
        room, (text, card) = self._room(d), self._body(d.get("content"))
        handle = ""
        if room is not None and clean(text, MAX_BOT_CHARS):
            try:
                msg, _ = self.hub.create(room, {"author_kind": "role", "author": bot.id, "name": bot.name,
                                                "text": text, "status": "done",
                                                "client_key": self.hub.preview_key(bot.id, ref)}, MAX_BOT_CHARS, card)
                handle = str(msg["id"])
                await self.hub.broadcast({"type": "message", "message": msg}, room)
            except Conflict:   # 频道已归档
                pass
        await self._send(bot.ws, {"type": "preview_ack", "ref_id": ref, "preview_handle": handle})

    async def _reply(self, bot: Bot, d: dict) -> None:
        content = d.get("content")
        room = self._room(d)
        if not isinstance(content, str) or room is None:
            return
        from .hub import Conflict   # hub.py 导入本模块，放这里免得循环导入
        text = self.for_display(content).strip()
        if not clean(text, MAX_BOT_CHARS):
            return
        try:
            # agent=true：cc-connect 标的「会话里写的回复」（core.AgentReplyMarker），补发时它自己不再看一遍
            msg, _ = self.hub.create(room, {"author_kind": "role", "author": bot.id, "name": bot.name,
                                            "text": text, "status": "done"}, MAX_BOT_CHARS,
                                     from_turn=d.get("agent") is True)
        except Conflict:   # 频道刚被归档（rh/hub.py 多频道）：丢掉这条，连接不断
            return
        await self.hub.broadcast({"type": "message", "message": msg}, room)
        await self.hub.notify_new(msg)

    # ---------- 连接 ----------
    async def handle(self, request: web.Request) -> web.StreamResponse:
        h = request.headers.get("Authorization", "")
        token = h[len("Bearer "):] if h.startswith("Bearer ") else request.query.get("token")
        if not self.hub.bot_token_ok(token):
            raise web.HTTPUnauthorized(text="unauthorized")
        ws = web.WebSocketResponse(heartbeat=HEARTBEAT, max_msg_size=MAX_FRAME)
        await ws.prepare(request)
        try:
            first = await ws.receive(timeout=REGISTER_TIMEOUT)
            reg = json.loads(first.data) if first.type == WSMsgType.TEXT else None
        except (asyncio.TimeoutError, ValueError):
            reg = None
        project = reg.get("project") if isinstance(reg, dict) else None
        bot_id = clean(request.query.get("bot", "") or (project if isinstance(project, str) else ""))[:MAX_NAME]
        # bot id 不能和主机角色撞：撞了能改主机角色的消息、成员栏也分不清（审查第 4 条）
        if not isinstance(reg, dict) or reg.get("type") != "register" or not bot_id or bot_id in ("user", "system") \
                or any(m["id"] == bot_id for m in self.hub.members()):
            await ws.send_json({"type": "register_ack", "ok": False, "error": "bad register"})
            await ws.close(code=WS_BAD_REGISTER, message=b"bad register")
            return ws
        member = next((m for m in self.hub.members() if m["id"] == bot_id), None)
        name = clean(request.query.get("name", ""))[:MAX_NAME] or (member["name"] if member else bot_id)
        mention_id = request.query.get("mention_id", "")
        bot = Bot(ws, bot_id, name, mention_id if mention_id.isascii() and mention_id.isdigit() else "")
        old = self.bots.get(bot_id)
        self.bots[bot_id] = bot
        if old is not None:
            asyncio.ensure_future(old.ws.close(code=WS_REPLACED, message=b"replaced by new connection"))
        await ws.send_json({"type": "register_ack", "ok": True, "capabilities": CAPABILITIES,
                            "server": {"name": "role-household-hub"}})
        self.hub.remember_bot(bot_id, name)
        self.hub.bots_online.add(bot_id)
        # 重新连上 = cc-connect 重启或重连，上一轮的 typing_stop 可能丢了：清掉它的思考中（审查第 3 条）
        for room in [r for r, bs in self.hub.bot_thinking.items() if bot_id in bs]:
            await self.hub.set_bot_thinking(room, bot_id, False)
        await self.hub.bots_changed()
        try:
            async for frame in ws:
                if frame.type != WSMsgType.TEXT or self.bots.get(bot_id) is not bot:
                    continue
                try:
                    d = json.loads(frame.data)
                except ValueError:
                    continue
                if isinstance(d, dict):
                    await self.from_bot(bot, d)
        finally:
            if self.bots.get(bot_id) is bot:   # 被同名新连接顶掉的不算下线
                del self.bots[bot_id]
                self.hub.bots_online.discard(bot_id)
                for room in [r for r, bs in self.hub.bot_thinking.items() if bot_id in bs]:
                    await self.hub.set_bot_thinking(room, bot_id, False)
                await self.hub.bots_changed()
        return ws


def attach(app: web.Application, hub) -> CloudWeb:
    cw = CloudWeb(hub)
    hub.listeners.append(cw.on_new)
    app.router.add_get(WS_PATH, cw.handle)

    async def close_bots(app):  # 同 hub.py close_all：不主动断，老进程会被 bot 的连接拖着不退
        for b in list(cw.bots.values()):
            await b.ws.close(code=WSCloseCode.GOING_AWAY, message=b"server shutdown")

    app.on_shutdown.append(close_bots)
    return cw
