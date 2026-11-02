#!/usr/bin/env python3
"""交活时搜「旧定案」：按交接的「用户原话」「总目标」抽关键词，搜 wiki（~/wiki/bin/search.py）和历史会话
（resume-session 的 sessions.py 索引 + ~/wiki/bin/sessionlog），再由小模型只留用户定过 / 否过的句子（带来源）。
ws-handoff 交活时把结果追加成交接的「旧定案（程序搜出）」节；看门（drift-check）拿它和原话对照查跑偏。
搜不到、超时、没装 claude 都只写「旧定案：没搜到」，不拦交活。
来源：10-31 交接跑偏实验（3 案，只有「原话 + 程序搜出的旧定案」那组两件都命中；只看交接两件都没中）。
命令行：_recall.py <交接文件>  → 打出要追加的那一节（不改文件）。"""
import json, os, re, runpy, subprocess, sys, tempfile, time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path

channel_records = runpy.run_path(str(Path(__file__).with_name("chanlog")))["records"]

HOME = Path.home()
WIKI_BIN = Path(os.environ.get("WIKI_BIN") or HOME / "wiki" / "bin")
SESSIONS = Path(os.environ.get("RECALL_SESSIONS") or HOME / ".claude" / "skills" / "resume-session" / "sessions.py")
MODEL = os.environ.get("RECALL_MODEL", "haiku")  # 沿用 ../hooks/intent_judge.py 的小模型
SEARCH_BUDGET = 20  # 秒；交接规矩原话「搜索超 20 秒跳过」
MODEL_TIMEOUT = 20  # 秒；沿用 ../hooks/intent_judge.py TIMEOUT
MAX_LINES = 15  # 交接范围原话「限 15 行内」
MAX_SNIPPETS = 100  # 实测 11-01：100 条片段 haiku 14 秒读完（case3）；200 条在 case2 超过 MODEL_TIMEOUT 20 秒，什么都没挑出
SNIP_BEFORE, SNIP_AFTER = 40, 80  # 沿用 sessions.py cmd_search 的 match 片段（前 40 字、后 80 字）
SECTION = "旧定案（程序搜出）"
NONE_LINE = "旧定案：没搜到"
LOG = HOME / ".bothouse" / "logs" / "recall.tsv"


def section(text, *names):
    """交接里标题含 names 之一的那些节的正文（# 开头的标题行之间）。"""
    out, on = [], False
    for l in text.splitlines():
        if l.lstrip().startswith("#"):
            on = any(n in l for n in names)
            continue
        if on:
            out.append(l)
    return "\n".join(out).strip()


def claude(system, prompt):
    """claude -p 小模型，无工具、不读设置；返回（结果文字, 花费美元）；出错返回（"", 0）。同 ../hooks/intent_judge.py。"""
    try:
        p = subprocess.run(
            ["claude", "-p", "--model", MODEL, "--tools", "", "--setting-sources", "", "--strict-mcp-config",
             "--no-session-persistence", "--system-prompt", system, "--output-format", "json"],
            input=prompt, capture_output=True, text=True, timeout=MODEL_TIMEOUT, cwd=tempfile.gettempdir())
        d = json.loads(p.stdout)
        return (d.get("result") or "").strip(), round(d.get("total_cost_usd") or 0, 5)
    except (OSError, ValueError, subprocess.SubprocessError):
        return "", 0


def parse_json(txt):
    m = re.search(r"[\[{].*[\]}]", txt or "", re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except ValueError:
        return None


KW_SYSTEM = ("从一份交活说明里抽几个搜索关键词（最多五个），用来在用户以前的聊天记录和笔记里找他对同一件事定过或否过的话。"
             "选这件活特有的名词（产品名、功能名、东西名、用户自己的说法），不要「用户」「交接」「工作区」「修」这类通用词。"
             "每个都原样取自文中、要短。只输出 JSON 数组，如 [\"L站\",\"图多字少\"]。")

PICK_SYSTEM = """你从一堆搜索片段里挑出「用户本人以前定过或否过」的事，交给执行者参考，免得他照转述做跑偏。
只留：用户的原话里明确定下、选定、否决、纠正过的做法（或笔记里写明「用户定/用户否/用户要/用户说」的记录），并且和这件活有关。
片段大多是助手（橘）和队友（龙娘、鲸鱼娘、彩虹猫、grok娘）说的话，不是用户的；只有片段写明「用户…」「原话」，或明显是人在 @ 机器人下指令时，才算用户说的。拿不准是谁说的就不要。
频道检索中带「【队友原话：名字】」的片段例外：保留和本任务有关的明确批评、否决和改法，输出必须写「队友意见（名字）」并保留来源，不是用户定案，不得冒充用户拍板。
不要：未标明作者的助手主意、计划和对别人的要求；只是陈述现状、进度、事故的；和这件活无关的；已在「本次用户原话」里的重复。
每条一行：先写定了什么（一句短话，尽量带用户原话引号），再写「——来源」，来源照片段给的原样抄（wiki 路径:行号，或 会话id 时间）。
最多 15 条，按和这件活的相关程度排。没有就输出空数组。只输出 JSON 数组（字符串），不要别的字。"""


def keywords(notes):
    quote, goal = section(notes, "用户原话"), section(notes, "总目标")
    txt, _ = claude(KW_SYSTEM, f"## 用户原话\n{quote}\n\n## 总目标\n{goal}")
    kws = parse_json(txt)
    kws = [str(k).strip() for k in kws if str(k).strip()] if isinstance(kws, list) else []
    if not kws:  # 模型不可用：取原话里「」引起来的词
        kws = re.findall(r"「([^「」\s]{2,8})」", quote + goal)
    return list(dict.fromkeys(kws))[:5]  # 五个：同 KW_SYSTEM


def wiki_hits(kw):
    try:
        out = subprocess.run([sys.executable, "-I", str(WIKI_BIN / "search.py"), kw], capture_output=True, text=True,
                             timeout=SEARCH_BUDGET).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [(m.group(1), m.group(2)) for m in re.finditer(r"^(~?/\S+\.md:\d+)\s+(.*)$", out, re.M)]


def session_ids(kw):
    """sessions.py search 命中的全部会话 id（它按最近排、默认只给前几个，旧定案多在更早的会话里，所以不设上限）。"""
    try:
        out = subprocess.run([sys.executable, "-I", str(SESSIONS), "search", "--limit", str(sys.maxsize >> 32), kw],
                             capture_output=True,
                             text=True, timeout=SEARCH_BUDGET).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [(sid, kw) for sid in re.findall(r"^(\S{8,})\s+\d\d-\d\d \d\d:\d\d", out, re.M)]


# 进来的消息里不是人说的行：任务板行（｜分列）、桥和定时任务的提示、角色转发、注入的系统块
NOISE = ("｜", "📋", "⏰", "📬", "📤", "--seq", "[Public", "[Task", "[Bridge", "[Request", "Claude橘", "【橘】",
         "你是工作区", "接手一整块大活", "交接 /", "notes/")


def session_snips(pairs, before):
    """（会话, 关键词）命中会话里 before 之前、进来的消息（用户和队友说的），含关键词、不像系统噪音的行的片段。"""
    sys.path.insert(0, str(WIKI_BIN))
    try:
        import sessionlog  # noqa: E402
    except ImportError:
        return []
    want = {}
    for sid, kw in pairs:
        want.setdefault(sid, set()).add(kw)
    out = []
    for s in sessionlog.sessions():
        if s.id not in want:
            continue
        try:
            recs, _ = sessionlog.read(s.path, 0)
        except (OSError, ValueError):
            continue
        for r in recs:
            if r.get("kind") != "message" or r.get("dir") != "in":
                continue
            ts = str(r.get("ts") or "")
            if ts and ts > before:
                continue
            for line in (r.get("text") or "").splitlines():
                if any(n in line for n in NOISE):
                    continue
                for kw in want[s.id]:
                    i = line.find(kw)
                    if i >= 0:
                        out.append((f"会话 {s.id[:8]} {ts[:16].replace('T', ' ')}",
                                    " ".join(line[max(0, i - SNIP_BEFORE): i + len(kw) + SNIP_AFTER].split())))
                        break
    return out


def parse_stamp(value):
    # Go RFC3339Nano has variable fractional precision; Python 3.9 accepts six digits.
    value = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], value)
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def channel_hits(kws, before):
    """Reuse chanlog's channel transcript parser; exclude ambiguous user/system blocks."""
    cutoff = parse_stamp(before)
    out = []
    for ts, speaker, text, where, src in channel_records():
        if speaker == "用户/系统" or not ts:
            continue
        try:
            stamp = parse_stamp(ts)
        except ValueError:
            continue
        if stamp > cutoff:
            continue
        label = "用户原话" if speaker.startswith("用户:") else "队友原话"
        for line in text.splitlines():
            if any(noise in line for noise in NOISE):
                continue
            for kw in kws:
                i = line.lower().find(kw.lower())
                if i >= 0:
                    snippet = " ".join(line[max(0, i-SNIP_BEFORE):i+len(kw)+SNIP_AFTER].split())
                    out.append((f"频道 {speaker} @{where} {src} {ts}", f"【{label}：{speaker}】{snippet}"))
                    break
    return out


DECIDED = re.compile(r"用户(定|要|说|否|嫌|点名|改)|原话|不要|别再|就这样|定了|改成|不用|先不|以后")


def gather(kws, before):
    """wiki、会话和频道命中的片段 [(来源, 正文)]；整段最多 SEARCH_BUDGET 秒，超时的那路跳过。"""
    t0 = time.time()
    pool = ThreadPoolExecutor(max_workers=2 * len(kws) + 2)
    wf = [pool.submit(wiki_hits, k) for k in kws]
    sf = [pool.submit(session_ids, k) for k in kws]
    cf = pool.submit(channel_hits, kws, before)
    wait(wf + sf + [cf], timeout=SEARCH_BUDGET)
    snips = [h for f in wf if f.done() for h in f.result()]
    if cf.done():
        snips += cf.result()
    pairs = [p for f in sf if f.done() for p in f.result()]
    left = SEARCH_BUDGET - (time.time() - t0)
    if pairs and left > 0:
        f = pool.submit(session_snips, pairs, before)
        wait([f], timeout=left)
        if f.done():
            snips += f.result()
    pool.shutdown(wait=False, cancel_futures=True)
    seen, out = set(), []
    for src, body in snips:
        if body not in seen:
            seen.add(body)
            out.append((src, body))
    # 先给小模型最像用户定案的：命中关键词多、带定案说法、来自 wiki（整理过的）
    out.sort(key=lambda x: -(sum(k in x[1] for k in kws) + 2 * bool(DECIDED.search(x[1])) + (".md:" in x[0])))
    return out[:MAX_SNIPPETS]


def _log(n_kw, n_snip, n_out, ms, cost, title):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}\t{n_kw}\t{n_snip}\t{n_out}\t{ms}\t{cost}\t{title}\n")
    except OSError:
        pass


def old_decisions(notes, before=None):
    """返回旧定案行（每行带来源）；没搜到返回 []。before：ISO 时间（UTC），只看这之前的会话消息（默认现在）。"""
    t0 = time.time()
    before = before or time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    title = (notes.splitlines() or [""])[0].lstrip("# ")
    kws = keywords(notes)
    snips = gather(kws, before) if kws else []
    rows, cost = [], 0
    if snips:
        task = f"## 本次用户原话\n{section(notes, '用户原话')}\n\n## 总目标\n{section(notes, '总目标')}"
        body = "\n".join(f"[{src}] {txt}" for src, txt in snips)
        txt, cost = claude(PICK_SYSTEM, f"{task}\n\n## 搜索片段（来源在方括号里）\n{body}")
        got = parse_json(txt)
        rows = [str(x).strip() for x in got if str(x).strip()][:MAX_LINES] if isinstance(got, list) else []
    _log(len(kws), len(snips), len(rows), int((time.time() - t0) * 1000), cost, title)
    return rows


def render(rows):
    lines = [f"## {SECTION}", "（交活时程序按原话和总目标搜 wiki、历史会话和频道原话，区分用户定案与具名队友意见；队友意见不等于用户拍板，和交接冲突时以用户原话为准，"
             "拿不准先问聊天频道的主角色，不直接问用户）"]
    lines += [f"- {r.lstrip('-* ')}" for r in rows] if rows else [f"- {NONE_LINE}"]
    return "\n".join(lines) + "\n"


def append_to(path):
    """给交接文件追加「旧定案（程序搜出）」节（已有就不再加），返回追加的文字。出任何错都只返回 None，不拦交活。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
        if SECTION in text:
            return None
        block = render(old_decisions(text))
        with open(path, "a", encoding="utf-8") as f:
            f.write(("" if text.endswith("\n") else "\n") + "\n" + block)
        return block
    except Exception as e:  # noqa: BLE001  搜旧定案只是附加，不能让交活失败
        print(f"ws-handoff: 搜旧定案出错，跳过（{type(e).__name__}: {e}）", file=sys.stderr)
        return None


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法：_recall.py <交接文件>")
    print(render(old_decisions(Path(sys.argv[1]).read_text(encoding="utf-8"))))
