#!/usr/bin/env python3
"""聊天频道讨论原文的导出：ws-handoff 交活时附全文（append_source），续派（ws-handoff --resume）和转话（ws-forward）
时只追加上次导出之后新说的（append_new），转给工作区的话先列用户新原话、主角色写的那句标「只作参考」（relay_text）。
来源：用户 11-21「把我们原文给他，让他自己判断」、11-23「原话转发我们这段聊天记录就行，不要加任何东西」；11-24 批的改法
「交工作区就把整段讨论原样给，我不写目标、范围、词义和做法」「你后面再纠正时，只把你的新原话追加给工作区，我的话照样只作参考」。
11-24 回放后再改：讨论原文里主角色的话只留她问用户的问句，她每条的全文另存 <交接>.主角色的话.md（见 _LEAD_ASK 上面的说明）。
导出出任何错都只是少这一段，不拦交活、不拦转话。"""
import json, os, re
from pathlib import Path

import _handoff_rules

_QUOTE_SEC = next(c for c in _handoff_rules.load()["checks"] if c["id"] == "sections")["names"][0]  # 原话节的节名，从规则读
LEAD_SAYS = "主角色的话（只作参考）"
_LEAD_WHO = "主角色（只作参考）"  # 主角色说的话的署名：.主角色的话.md 和 11-24 前导出的 .原话.md 里用
# 11-24 回放：主角色一条里先提议做法再问两个问题，用户只答了问题，工作区把提议写成「做完」。标「只作参考」挡不住，
# 因为用户没反对，模型当成默认同意。所以讨论原文里主角色的话只留她问用户的问句（看得懂用户在答什么），
# 全文另存 <交接>.主角色的话.md，用户的话明显指着她某条说时才去查。用户和队友的话不动。
_LEAD_ASK = "主角色（程序只留了她问用户的问句）"
_LEAD_CUT = "（她这条其余是提议和说明，程序没放进来）"
_LEAD_NONE = "（她这条没有问用户的问句，是提议或说明，程序没放进来）"
_LEAD_NOTE = "# 这些是她自己的提议、打算和说明，不是用户定的。用户明说同意的那部分才算定；用户只答了她的问句、没提到的部分不算同意。\n\n"
_SENT_END = re.compile(r"(?:[。！？]|[!?.](?=\s|$)(?<!\d\.))+[”」』）)]*")  # 句子到哪结束；「1. 」这种编号不算

SOURCE = "原话出处（程序附）"
_STAMP = re.compile(r"(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d)([\dxX])")


def _window_start(text):
    """时间窗起点：用户原话那节里最早的「MM-DD HH:MM」（10:2x 按 10:20）往前 10 分钟；没有或早于 3 天前，取交活前 3 小时。
    原话节找法和交活检查、交回骨架同一个（_handoff_rules._sections，几级标题都认）：原先只认「## 用户原话」，
    写成「# 用户原话」的交接时间窗一律退成交活前 3 小时，11-25 停活通知那件因此漏了用户 01:08「通过更多状态去管理」（#2089）。"""
    import datetime as dt
    now = dt.datetime.now().astimezone()
    body = "\n".join(l for seg in _handoff_rules._sections(text.splitlines(), _QUOTE_SEC, _handoff_rules.load().get("lead", ""))
                     for l in seg)
    got = []
    for m in _STAMP.finditer(body):
        mo, d, h, t, u = m.groups()
        try:
            got.append(now.replace(month=int(mo), day=int(d), hour=int(h), minute=int(t) * 10 + (0 if u in "xX" else int(u)),
                                   second=0, microsecond=0))
        except ValueError:
            continue
    got = [g for g in got if now - dt.timedelta(days=3) <= g <= now]
    return (min(got) - dt.timedelta(minutes=10)) if got else now - dt.timedelta(hours=3)


_HDR = re.compile(r'\[bothouse sender_id=(\S+) sender_name="([^"]*)"')
_CTX_HEAD = "（频道里你上次看到之后的消息"
_CTX_LINE = re.compile(r"^\[(\d{1,2}):(\d{2})，[^\]\n]*\] ([^:\n]+?): ", re.M)
_INSERTED = re.compile(r"^\[回复 ([^：\]]+)：(.*)\] ↪ 已插入$", re.S)
_LATEST = re.compile(r"（最新，回这条）\n(?:（用户这条[^\n]*）\n)?")
_REPLYING = re.compile(r"^\[replying to [^\]]*\]\n", re.S)
_SYS_TAIL = re.compile(r"\n\n\[系统定时消息[^\n]*$", re.S)
_BOT_SENDERS = {"timer", "handoff", "relay", "system"}


def _split_bridge(body, when):
    """桥包好的一条用户消息拆成频道里的每句话：[(时刻, 谁, 原文)]。谁 = None 表示最新那条（桥的记录里不带名字）。
    没 @ 到主角色的话在「频道里你上次看到之后的消息」那段（行头「[时:分，…] 名字: 」），主角色做事时插进来的在
    「[回复 名字：原文] ↪ 已插入」，最新一条在「（最新，回这条）」之后。没有这些包装就返回 []（由调用方原样留一条）。"""
    import datetime as dt
    out = []
    lm = _LATEST.search(body)
    ctx_at = body.find(_CTX_HEAD)
    if ctx_at >= 0:
        ctx = body[ctx_at:lm.start() if lm and lm.start() > ctx_at else len(body)]
        ctx = ctx.split("\n", 1)[1] if "\n" in ctx else ""
        hits = list(_CTX_LINE.finditer(ctx))
        for i, h in enumerate(hits):
            seg = ctx[h.end():hits[i + 1].start() if i + 1 < len(hits) else len(ctx)].split("\n\n（", 1)[0].strip()
            who = h.group(3).strip()
            try:
                t = when.replace(hour=int(h.group(1)), minute=int(h.group(2)), second=0, microsecond=0)
            except ValueError:
                t = when
            if t > when:
                t -= dt.timedelta(days=1)
            if who.startswith("Claude橘") or "你这个账号" in who:
                im = _INSERTED.match(seg)
                if im:
                    out.append((t, im.group(1), im.group(2).strip()))
                continue  # 主角色自己账号发的（定时任务输出等），不是讨论
            out.append((t, who, seg))
    if lm:
        out.append((when, None, _REPLYING.sub("", _SYS_TAIL.sub("", body[lm.end():])).strip()))
    return out


def _jsonl_text(content):
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def _transcript_names(agent_ids, start):
    """主角色的 Claude 会话记录（~/.claude/projects/*/<id>.jsonl）里，每条最新消息的原文 → 发言人（sender_name）。
    桥的记录里最新那条不带名字，靠这里补；不是 Claude 的主角色找不到就只写「用户」。"""
    import datetime as dt
    names = {}
    for aid in dict.fromkeys(agent_ids):
        for f in sorted(Path.home().glob(f".claude/projects/*/{aid}.jsonl")):
            for line in open(f, encoding="utf-8"):
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                if o.get("type") != "user" or not o.get("timestamp"):
                    continue
                text = _jsonl_text((o.get("message") or {}).get("content"))
                m = _HDR.search(text)
                if not m or m.group(1) in _BOT_SENDERS:
                    continue
                when = dt.datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00")).astimezone()
                if when < start:
                    continue
                for _, who, t in _split_bridge(text[m.end():], when):
                    if who is None and t:
                        names.setdefault(t, m.group(2))
    return names


def _discussion(msgs, agent_ids, start):
    """桥的记录 [(时刻 iso, role, content)] → 讨论原文 [(时刻 iso, 谁, 原文)]：用户消息拆成每句并标发言人，
    主角色的话标「只作参考」，同一句只留一次；同一分钟里按出现先后（频道旧消息只记到分钟）。"""
    import datetime as dt
    try:
        names = _transcript_names(agent_ids, start)
    except Exception:  # noqa: BLE001  补名字失败不影响导出
        names = {}
    out, seen = [], set()

    def add(ts, who, text):
        if text and (who, text) not in seen:
            seen.add((who, text))
            out.append((ts, len(out), who, text))

    for ts, role, c in msgs:
        if role == "assistant":
            if c.strip().upper() != "NO_REPLY":  # 没发出去的不算讨论
                add(ts, _LEAD_WHO, re.sub(r"\n*NO_REPLY\s*$", "", c.strip(), flags=re.I))
            continue
        system = "[系统定时消息，不是用户发的" in c and not _LATEST.search(c)  # 定时任务、工作区交回：只留它前面那段频道旧消息
        try:
            when = dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone()
        except ValueError:
            when = None
        parts = _split_bridge(c, when) if when else []
        if not parts:
            if not system:
                add(ts, "用户和队友", c.strip())
            continue
        for t, who, text in parts:
            if t >= start:
                add(t.isoformat(), who or names.get(text, "用户"), text)
    out.sort(key=lambda x: (x[0][:16], x[1]))
    return [(ts, who, text) for ts, _, who, text in out]

def dump_path(path):
    """交接文件 → 它的讨论原文文件（<交接>.原话.md）。"""
    return Path(path).with_suffix("").as_posix() + ".原话.md"


def lead_path(path):
    """交接文件 → 主角色每条话的全文（<交接>.主角色的话.md）。"""
    return Path(path).with_suffix("").as_posix() + ".主角色的话.md"


def _history(chat, project, start):
    """桥的会话记录里这个聊天频道 start 之后的消息 → (讨论原文 [(时刻 iso, 谁, 原文)], 主角色的 agent 会话 id)。
    记录在 sessions/<项目>_*.json 旁的 .history/<会话 id>.jsonl（core/session_history.go），旧桥内嵌在 json 的 history 也读。"""
    data = Path(os.environ.get("CC_DATA_DIR") or Path.home() / ".bothouse")
    msgs, agent_ids = [], []
    for f in sorted((data / "sessions").glob(f"{project}_*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        sids = (d.get("user_sessions") or {}).get(chat) or []
        for sid in sids:
            s = (d.get("sessions") or {}).get(sid) or {}
            if s.get("agent_session_id"):
                agent_ids.append(s["agent_session_id"])
            name = "".join(c if c.isascii() and (c.isalnum() or c in "-_") else "_" for c in sid) or "_"
            hist = list(s.get("history") or [])
            hf = f.parent / (f.name.removesuffix(".json") + ".history") / (name + ".jsonl")  # core/session_history.go
            if hf.is_file():
                for ln in hf.read_text(encoding="utf-8").splitlines():
                    try:
                        hist.append(json.loads(ln))
                    except ValueError:
                        continue
            for m in hist:
                if not isinstance(m, dict):
                    continue
                ts = m.get("timestamp") or ""
                if ts and ts >= start.isoformat():
                    msgs.append((ts, m.get("role") or "?", m.get("content") or ""))
    msgs.sort(key=lambda m: m[0])  # 只按时间；同一时刻保持记录里的先后（不按 role 字母排）
    return _discussion(msgs, agent_ids, start), agent_ids


def _entries(msgs):
    return "".join(f"### {ts[5:16].replace('T', ' ')} {who}\n{c}\n\n" for ts, who, c in msgs)


def _lead_asks(text):
    """主角色一条话里问用户的问句：以问号结尾的句子，按原来的行留；代码块里的不看。没有就返回空串。"""
    keep, fence = [], False
    for line in (text or "").splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        at, hit = 0, []
        for m in _SENT_END.finditer(line):
            sent, at = line[at:m.end()], m.end()
            if "？" in m.group(0) or "?" in m.group(0):
                hit.append(sent)
        if hit:
            keep.append("".join(hit).strip())
    return "\n".join(keep)


def _lead_out(msgs):
    """讨论 [(时刻, 谁, 原文)] 拆成两份：给工作区看的（主角色的话只留问句，别人的话原样）和主角色每条的全文。"""
    shown, full = [], []
    for ts, who, c in msgs:
        if who != _LEAD_WHO:
            shown.append((ts, who, c))
            continue
        full.append((ts, who, c))
        asks = _lead_asks(c)
        shown.append((ts, _LEAD_ASK, _LEAD_NONE if not asks else asks if _norm(asks) == _norm(c) else asks + "\n" + _LEAD_CUT))
    return shown, full


def _write_dump(path, chat, start, msgs):
    """写 <交接>.原话.md（主角色的话只留问句）和 <交接>.主角色的话.md（她每条全文）。返回 (.原话.md 路径, 条数)。
    .原话.md 第二行的说明会随开工提示整份附上，工作区先读到它。"""
    shown, full = _lead_out(msgs)
    dump = dump_path(path)
    with open(dump, "w", encoding="utf-8") as fh:
        fh.write(f"# 聊天频道 {chat} 讨论原文（{start:%m-%d %H:%M} 到交活，{len(shown)} 条）\n"
                 "# 程序从桥的会话记录导出，按时间。每条标了是谁说的。用户的话全文原样，是准绳；队友的话是意见。"
                 "主角色的话只留了她问用户的问句，方便看懂用户在答什么；她的提议、打算和说明没放进来，"
                 "用户没明说同意的做法都不算定了，用户答了她的问句不等于同意她别的话。"
                 f"用户的话明显指着她某条说（「做」「可以」「就这个」）时，才去 {lead_path(path)} 查那一条全文。"
                 "交接里没有主角色的概括，做什么照用户原话自己判断。\n\n" + _entries(shown))
    with open(lead_path(path), "w", encoding="utf-8") as fh:
        fh.write(f"# 聊天频道 {chat} 里主角色说的每条话全文（{start:%m-%d %H:%M} 到交活，{len(full)} 条，程序导出）\n"
                 + _LEAD_NOTE + _entries(full))
    return dump, len(shown)


def append_source(path, chat, project=None):
    """给交接追加「原话出处」节：聊天频道 id、交活人的会话记录、时间窗，并把时间窗里这个聊天频道的原始对话
    （来自桥的会话记录，见 _history）导出到 <交接>.原话.md：用户和队友的话按时间原样，主角色的话只留问句，她的全文另存
    <交接>.主角色的话.md（_write_dump）。
    已有就不再加；出任何错只返回 None，不拦交活。来源：用户 11-01「工作区…他也可以看我们的会话原话啊，解决人类之间这种传递有损的问题」；
    11-21「你把整个讨论内容给他」「我是说之后给工作区都要这样做」（此前只读内嵌 history，桥挪到 .history/ 后导出一直是 0 条）。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
        if SOURCE in text or ":" not in (chat or ""):
            return None
        project = project or os.environ.get("CC_PROJECT", "")
        start = _window_start(text)
        msgs, agent_ids = _history(chat, project, start)
        dump, _ = _write_dump(path, chat, start, msgs)
        tr = ""
        if agent_ids:
            hits = sorted(Path.home().glob(f".claude/projects/*/{agent_ids[-1]}.jsonl"))
            tr = str(hits[0]) if hits else ""
        lines = [f"## {SOURCE}",
                 f"（交活时程序附：做什么照这里的原始对话定，用户的话是准绳；交接里「{LEAD_SAYS}」那节是主角色自己的理解，和原话冲突时信原话）",
                 f"- 聊天频道：{chat}",
                 f"- 时间窗：{start:%m-%d %H:%M} 到交活",
                 f"- 讨论原文：{dump}（{len(msgs)} 条，按时间；用户的话全文原样，主角色的话只留了她问用户的问句）",
                 f"- 主角色的话全文：{lead_path(path)}（她的提议和说明，用户没明说同意的不算定；用户的话明显指着她某条说时才查）",
                 f"- 读原话：sed -n '1,400p' '{dump}'"]
        if tr:
            lines.append(f"- 主角色交活时的会话记录：{tr}")
        lines.append(f"- 时间窗外再找：{Path(__file__).resolve().parent / 'chanlog'} <关键词> --since {start:%m-%d} --full")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(("" if text.endswith("\n") else "\n") + "\n" + "\n".join(lines) + "\n")
        return dump
    except Exception:  # noqa: BLE001
        return None


# 讨论原文里哪些条是用户说的：不是主角色、不是队友 bot（名字带「（bot）」）、不是没拆开的整段（「用户和队友」，
# 分不清谁说的），也不是整句括号的系统占位（如「（附了 1 个图片/文件…）」）。
_NOT_USER = ("主角色", "（bot）", "（你这个账号", "用户和队友")
_PLACEHOLDER = re.compile(r"[（(][^\n]*[）)]")
_ENTRY = re.compile(r"### (\d\d-\d\d \d\d:\d\d) (.+)")


def is_user(who, text):
    return not any(k in who for k in _NOT_USER) and bool(text.strip()) and not _PLACEHOLDER.fullmatch(text.strip())


def read_dump(dump):
    """<交接>.原话.md → [(「MM-DD HH:MM」, 谁, 原文)]；读不到返回 []。"""
    try:
        lines = Path(dump).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out, cur = [], None
    for ln in lines:
        m = _ENTRY.fullmatch(ln)
        if m or ln.startswith("# 追加："):
            if cur:
                out.append((cur[0], cur[1], "\n".join(cur[2]).strip()))
            cur = (m.group(1), m.group(2), []) if m else None
        elif cur:
            cur[2].append(ln)
    if cur:
        out.append((cur[0], cur[1], "\n".join(cur[2]).strip()))
    return out


def _norm(t):
    return re.sub(r"\s+", "", t)


def user_words(path):
    """这件活里用户说过的每句话 [(时刻或 ""，原文)]：讨论原文里用户的每条消息，并上交接「用户原话」节里讨论原文没有的条目
    （更早说的、时间窗外的）。交回骨架按它逐条列（ws-handoff append_skeleton）。"""
    out, seen = [], []
    for when, who, text in read_dump(dump_path(path)):
        if is_user(who, text) and _norm(text) not in seen:
            seen.append(_norm(text))
            out.append((when, text))
    try:
        notes = Path(path).read_text(encoding="utf-8")
    except OSError:
        return out
    lead = _handoff_rules.load().get("lead", "")
    for seg in _handoff_rules._sections(notes.splitlines(), _QUOTE_SEC, lead):
        for ln in seg[1:]:
            item = ln.strip().lstrip(lead).strip()
            if not item:
                continue
            said = [_norm(q) for q in re.findall(r"「([^」]+)」", item)] or [_norm(item)]
            if all(any(q in s or s in q for s in seen) for q in said):
                continue  # 讨论原文里已有这句
            seen.append(_norm(item))
            out.append(("", item))
    return out


def append_new(path, chat, project=None):
    """续派、转话时：聊天频道里上次导出之后新说的话追加进 <交接>.原话.md，返回其中用户说的 [(「MM-DD HH:MM」, 谁, 原文)]。
    上次导出到哪 = 原话文件的修改时间；没有原话文件（旧交接、当时没导成）就不导。出任何错返回 []，不拦续派和转话。
    主角色的新话照样只留问句进 .原话.md，全文追加到 <交接>.主角色的话.md。"""
    try:
        import datetime as dt
        dump = Path(dump_path(path))
        if not dump.is_file() or ":" not in (chat or ""):
            return []
        start = dt.datetime.fromtimestamp(dump.stat().st_mtime).astimezone()
        msgs, _ = _history(chat, project or os.environ.get("CC_PROJECT", ""), start)
        mine = Path(lead_path(path))
        old = {(who, _norm(text)) for _, who, text in read_dump(dump) + read_dump(mine)}  # 主角色的话按全文对，全文在她那份里
        msgs = [m for m in msgs if (m[1], _norm(m[2])) not in old]
        if not msgs:
            return []
        msgs, full = _lead_out(msgs)
        if full:
            head = "" if mine.is_file() else f"# 聊天频道 {chat} 里主角色说的每条话全文（程序导出）\n" + _LEAD_NOTE  # 改法前交的旧交接没有这份
            with open(mine, "a", encoding="utf-8") as fh:
                fh.write(head + _entries(full))
        with open(dump, "a", encoding="utf-8") as fh:
            fh.write(f"# 追加：{start:%m-%d %H:%M} 之后聊天频道里新说的（{len(msgs)} 条，程序导出；主角色的话照样只留问句）\n\n" + _entries(msgs))
        return [(ts[5:16].replace("T", " "), who, text) for ts, who, text in msgs if is_user(who, text)]
    except Exception:  # noqa: BLE001
        return []


# 桥原样转来的用户原话（core/reply_task.go replyForwardPrefix、replyAnswerPrefix）：不是主角色的转述，不标「只作参考」
BRIDGE_RAW = ("打断：按新要求做。用户在聊天频道回复这件活：", "用户在聊天频道答复了这件活的提问（原话）：")


def relay_text(fresh, said):
    """转给工作区的一段话：先列聊天频道里用户新说的原话（append_new 的结果，是准绳），主角色写的那句标「只作参考」排后面。
    said 是桥原样转来的用户原话（BRIDGE_RAW）时照原样，不标参考，也不把同一句再列一遍。"""
    said = (said or "").strip()
    raw = said.startswith(BRIDGE_RAW)
    rows = [f"- {when} {who}：「{text}」" for when, who, text in fresh if not (raw and _norm(text) in _norm(said))]
    out = []
    if rows:
        out.append("用户新原话（程序从聊天频道原样导出，是准绳）：\n" + "\n".join(rows))
    if said:
        out.append(said if raw else f"{LEAD_SAYS}：{said}")
    return "\n".join(out)
