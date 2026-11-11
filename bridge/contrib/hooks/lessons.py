"""Portable terminal lesson reminders from the author's recurrence-table reader."""
import os, re
from pathlib import Path
from datetime import date, timedelta
# Set by wiki-context after loading the same packaged wiki lookup used by the gate.
WIKI = None
search = None
query = lambda text: text

LESSONS_GLOB = "rule-candidates-recurrence*.md"
LESSONS_K = 3  # 第一轮推几条：沿用 match_wiki 的 k=3 推页条数（审稿 retro-loop-unified (e)）
# 试行一周起点：用户同意的方案「先试一周」（2026-10-22，用户「可以，按这个方案做，守卫先摘下来」）
TRIAL_START = (date.fromisoformat(os.environ["HOOK_LESSONS_TRIAL_START"])
               if os.environ.get("HOOK_LESSONS_TRIAL_START") else None)
TRIAL_DAYS = 7  # 来源：用户同意的方案「先试一周」
ASKED = Path(__file__).resolve().parent / "state" / "lessons-asked"  # 最后一次做「每天一次」检查的日期（审稿第 4 处：只多存一个日期戳）
# 纠正关键词（我加的设定，用户没给词表；正例取自教训表原话，反例取自 resume-session 索引，见交付里的命中率）
CORRECTION = re.compile(
    r"^\W*(不是[，,。！!\s]|不对|不要$|别再)|[，,？?]\s*不是|不是(说|应该|之前|让你|都)|不是[^。？?，,]{0,12}了[吗么]|不是不要|不让你"
    r"|你为什么|为什么(要我|还|才|敢)|怎么还|还没动|看不懂|没看懂|说人话|太长了|你到底|到底看没看"
    r"|你.{0,6}(狗屎|傻逼|煞笔|一坨屎)|日你妈|不符合预期|我是说|我说(的)?(是|只是)|犯过|又犯|又错|你干嘛|细枝末节|太狭窄"
    r"|怎么验收|这叫对齐|先跟我对齐|先暂停")
# 页上原话的写法：MM-DD sid8「原话」；同一行后面的 sid8「…」沿用前一个日期，一个 sid8 后可跟几句「…」
_QUOTE = re.compile(r"(\d\d-\d\d)(?=\s)|\b([0-9a-f]{8})(?=[：:]?「)|「([^」]*)」")
_COUNT = re.compile(r"(\d+) 次")


def _lessons_pages(root):
    """教训表主页和它拆出的子页（#1447）：ingest 的 split_pass 把主页挪进同名目录 <名>/<名>.md、
    条目搬进旁边的子页后，只读主页会一条都读不到。主页在前，子页按文件名。"""
    found = sorted(p for p in Path(root).glob("**/" + LESSONS_GLOB)
                   if not any(x.startswith(".") for x in p.relative_to(root).parts))
    if not found:
        return []
    main = found[0]
    sub = main.parent if main.parent.name == main.stem else main.with_suffix("")
    subs = (sorted(p for p in sub.glob("**/*.md")
                   if p != main and not any(x.startswith(".") for x in p.relative_to(sub).parts))
            if sub.is_dir() else [])
    return [main] + subs


def lessons(root=None):
    """教训表里的条目：「关键事实」下带「N 次」的顶层 bullet（连同它的子 bullet）。
    返回 [{rule, n, quotes:[(MM-DD, sid8, 原话)], open, text}]，按页面顺序（主页在前，子页按名）。"""
    if root is None and WIKI is None:
        return []
    pages = _lessons_pages(root or WIKI)
    if not pages:
        return []
    out = []
    for page in pages:
        out.extend(_lessons_in(page))
    return [e for e in out if e["quotes"]]  # 没有原话的是说明行（如计次口径），不是规则条目


def _lessons_in(page):
    out, cur, sec = [], None, ""
    for line in page.read_text(errors="ignore").split("\n"):
        if line.startswith("## "):
            sec, cur = line[3:].strip(), None
            continue
        if not sec.startswith("关键事实"):
            continue
        if line.startswith("- "):
            m = _COUNT.search(line)
            cur = None
            if m:
                head = line[2:m.start()].rstrip("：:，, ").removesuffix("新增").removesuffix("复犯").removesuffix("相关").rstrip("：:，, ")
                cur = {"rule": head.replace("`", ""), "n": int(m.group(1)), "quotes": [], "open": False, "text": ""}
                out.append(cur)
        if cur is not None and line.strip():
            cur["text"] += line.strip() + "\n"
            md = sid = None
            for m in _QUOTE.finditer(line):
                if m.group(1):
                    md, sid = m.group(1), None
                elif m.group(2):
                    sid = m.group(2)
                elif sid and md:  # 规则名的「…」前面没有 sid8，不算原话
                    cur["quotes"].append((md, sid, m.group(3)))
            cur["open"] = cur["open"] or "未答复" in line
    return out


def _one(e):
    q = max(e["quotes"], key=lambda x: x[0]) if e["quotes"] else None  # 最近一句原话
    return f"{e['rule']}（{e['n']} 次）" + (f"：{q[0]} 用户「{q[2]}」" if q else "")


# Claude Code 自己注入、也走 UserPromptSubmit 的非用户 prompt（形态取自 ~/.claude/projects 下真实 jsonl 和 api-request-blob：
# 后台任务完成通知 <task-notification>（外面可能包 <system-reminder>[SYSTEM NOTIFICATION - NOT USER INPUT]）、
# 斜杠命令回放 <command-name>/<command-message>、本地命令 <local-command-*>、Stop hook 打回、压缩后的续会话摘要）
_NOT_USER_HEAD = ("<task-notification>", "<command-name>", "<command-message>", "<local-command-",
                  "Stop hook feedback", "This session is being continued from a previous conversation")
_NOT_USER_ANY = ("[SYSTEM NOTIFICATION - NOT USER INPUT]", "<task-notification>")


def _system_prompt(text):
    """这条 prompt 是不是 Claude Code 注入的（不是用户本人打的字）。只看开头：用户贴一段带这些标记的文字仍算用户的话。"""
    head = re.sub(r"^\s*(<system-reminder>\s*)?", "", text[:300])
    return head.startswith(_NOT_USER_HEAD) or any(m in text[:300] for m in _NOT_USER_ANY)


def _user_said(text, bridge):
    if bridge or _system_prompt(text) or "不是用户消息" in text[:200]:
        return []
    return [text.strip()] if text.strip() else []


def _best(entries, text):
    """和这句纠正词面最接近的一条（search.py 同一套切词；没有共同词就不附）。"""
    q = set(search.toks(text)) - set(search.toks("不是为什么怎么你这个"))  # 纠正口头词人人都有，不拿来对规则
    sc = [(len(q & set(search.toks(e["text"]))), -i) for i, e in enumerate(entries)]
    best = max(sc, default=(0, 0))
    return entries[-best[1]] if best[0] else None


def _trial_report(entries, today):
    """试行前后各一周，教训表原话（MM-DD sid8「…」）的条数。用页上现有记录，不另存基线。"""
    end = TRIAL_START + timedelta(days=TRIAL_DAYS)
    before_from = TRIAL_START - timedelta(days=TRIAL_DAYS)
    seen, n_before, n_after = set(), 0, 0
    for e in entries:
        for md, sid, q in e["quotes"]:
            if (md, sid, q) in seen:
                continue
            seen.add((md, sid, q))
            d = date(TRIAL_START.year, int(md[:2]), int(md[3:]))
            n_before += before_from <= d < TRIAL_START
            n_after += TRIAL_START <= d < end
    return (f"教训表试行满一周（{TRIAL_START:%m-%d} 起）：试行前一周记了 {n_before} 句复犯原话，试行这一周 {n_after} 句。"
            "在汇报的「要你做的」一段里顺带报一次这个对比。")


def lessons_items(text, first_turn, state=None, root=None, bridge=False, today=None):
    """要附加的段落 [(标题, 正文)]：
    1) first_turn：次数最多的 LESSONS_K 条，每条一句规则加一句原话；
    2) 用户本人这句是纠正：先认规则、查本会话犯没犯过、犯过先认错（规则：同一类错误再犯时
       先认错并对照上次改了什么），能对上的那条附上；
    3) 每天第一句用户本人的话：表里有「未答复」就让助手在「要你做的」问一句；试行满一周那天顺带报一次复犯对比。"""
    entries = lessons(root)
    said = _user_said(query(text), bridge) if entries else []
    if not said:
        return []
    out = []
    if first_turn:
        top = sorted(entries, key=lambda e: -e["n"])[:LESSONS_K]  # sorted 稳定：同次数按页面顺序
        out.append(("教训表", "本会话先记住这几条反复犯过的规则：" + "；".join(_one(e) for e in top)))
    said_text = "\n".join(said)
    if CORRECTION.search(said_text):
        hit = _best(entries, said_text)
        out.append(("纠正提示", "用户这句像是在纠正你。先认出犯的是哪条规则，查本会话是否犯过同类；犯过就先认错，"
                    "并对照上次改了什么（规则：同一类错误再犯时先认错并对照上次改了什么）。"
                    + (f"教训表里可能对上的一条：{_one(hit)}" if hit else "")))
    today = today or date.today()
    state = Path(state or ASKED)
    try:
        prev = state.read_text().strip()
    except OSError:
        prev = ""
    if prev != today.isoformat():
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(today.isoformat())
        ask = [e for e in entries if e["open"]]
        lines = []
        if ask:
            lines.append("教训表里有用户还没答复的改法建议，在这次汇报的「要你做的」一段问用户一句要不要改："
                         + "；".join(e["rule"] for e in ask))
        end = TRIAL_START + timedelta(days=TRIAL_DAYS) if TRIAL_START else None
        if end and (prev or "0000") < end.isoformat() <= today.isoformat():  # 满一周后的第一天检查：只报这一次
            lines.append(_trial_report(entries, today))
        if lines:
            out.append(("教训表每日一问 " + today.isoformat(), "。".join(lines)))
    return out


def lessons_context(text, first_turn, state=None, root=None):
    """终端 hook 用：要附加的文字，没有就空串。教训表读坏了返回空串，不挡推页。"""
    try:
        return "\n".join(f"（{t}）{b}" for t, b in lessons_items(text, first_turn, state, root))
    except Exception:
        return ""

