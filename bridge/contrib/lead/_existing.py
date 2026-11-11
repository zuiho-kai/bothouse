#!/usr/bin/env python3
"""开工时列出这件活手里现成的东西：上一棒（任务板上做过的同类活：交接、里面写到且还在的脚本和成品）、
现成做法（各家 CLI 的 skills 里对得上的）、定案（交接里程序搜出的旧定案条数）。不靠接活的人自己想起来去搜。
来源：用户 11-10「都做」，同意的方案第 1 条原文：「知道世界现在什么样。开工前程序列出这件活手里现成的东西
（上一棒的脚本、成品、定案），不靠它自己想起来去搜。今天试过让它自己搜，36 件被骂的只提醒到 4 件，不够。」
只做字面匹配，不调模型；出任何错只少这一节，不拦交活。行数有上限：清单列得太长等于没列。
阈值和条数在被骂回放上调过（#1362，~/.bothouse/roles/maomao/notes/indep1362/eval.md）。
命令行：_existing.py <交接文件> ["<任务>"] [--before <ISO 时间>]  → 打出那一节（不改文件）。"""
import math, os, re, sys, time
from datetime import datetime
from pathlib import Path

SECTION = "手里现成的（程序列出）"
# 下面几个值是初定后在被骂回放上实测过的（eval.md：17 件「现成的没用」列到 10 件，平均每件 4 行左右）
MAX_TASKS = 2  # 来源：回放实测 eval.md
MAX_SKILLS = 2  # 来源：回放实测 eval.md
MAX_FILES = 3  # 来源：回放实测 eval.md（上一棒交接里写到的文件，新的在前）
TASK_MIN = 4.0  # 来源：回放实测 eval.md（上一棒最低分）
SKILL_MIN = 3.0  # 来源：回放实测 eval.md（现成做法最低分）
COMMON = 0.15  # 来源：回放实测 eval.md（出现在这么多比例文档里的词不算）
HOME = Path.home()
# 各家 CLI 的 skill 目录（有就读）：Claude Code、Codex、通用 .agents、Gemini
SKILL_DIRS = [HOME / ".claude" / "skills", HOME / ".codex" / "skills", HOME / ".agents" / "skills", HOME / ".gemini" / "skills"]
# 程序自己追加的节（旧定案、原话出处、交回骨架、本节等）不当查询词；其余派活人写的节都算
PROGRAM_SECS = ("程序", "交回骨架", "手里现成的", "必须先出方案", "转交结果")
_CJK = re.compile(r"[一-鿿]+")
_LAT = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}")
_NUM = re.compile(r"#(\d{3,5})")
_PATH = re.compile(r"(?<![\w.:/])(?:~/|/)[\w.~-][^\s`'\"，。；、）)」：*<>|]*")  # 绝对路径和 ~/ 路径；列之前查它在不在
STOP = set("用户 交接 工作区 任务 一下 什么 这个 那个 我们 你们 现在 已经 没有 就是 可以 时候 然后 还是 不是 因为 所以 一个 这件 这次 "
           "主角 角色 做成 改成 做完 交回 开工 汇报 问题 东西 需要 要求 程序 原话 总目 目标 范围 参照 实现 验收 设定 现成 "
           "the and for with from this that into".split())
# 不当「现成的」列：记忆库、派活工具本身、程序附的原话导出、会话记录、系统和装好的程序
SKIP_PATH = re.compile(r"/wiki/|/\.bothouse/collaboration/|CLAUDE\.md$|\.原话\.md$|/notes/handoff-|/\.claude/projects/"
                       r"|^/(Applications|usr|bin|sbin|System|Library|etc|dev|private|opt/homebrew)(/|$)|/\.local/bin/|^/$|^/tmp/?$")


def _sections(text, names):
    out, on = [], False
    for ln in text.splitlines():
        if ln.lstrip().startswith("#"):
            on = any(n in ln for n in names)
            continue
        if on:
            out.append(ln)
    return "\n".join(out)


def _written(text):
    """派活人写的部分：去掉程序追加的节。"""
    out, on = [], True
    for ln in text.splitlines():
        if ln.lstrip().startswith("#"):
            on = not any(n in ln for n in PROGRAM_SECS)
        if on:
            out.append(ln)
    return "\n".join(out)


def terms(text):
    """查询/文档的词：中文两字一组、三个字母以上的英文词（小写）；去掉常用词。"""
    out = set()
    for run in _CJK.findall(text):
        out.update(run[i:i + 2] for i in range(len(run) - 1))
    out.update(w.lower() for w in _LAT.findall(text))
    return {t for t in out if t not in STOP}


def _ts(s):
    try:
        return datetime.fromisoformat(s).timestamp()
    except (TypeError, ValueError):
        return None


def _rec_time(r):
    """记录交回或做完的时刻（秒）；都没有返回 0。"""
    for k in ("returned_at", "review_accepted_at", "bound"):
        t = _ts(r.get(k))
        if t:
            return t
    return 0.0


def _goal_of(where, cache):
    """（交接全文, 标题 + 总目标开头）。"""
    if where not in cache:
        try:
            txt = Path(where).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            txt = ""
        title = next((ln.lstrip("# ").strip() for ln in txt.splitlines() if ln.startswith("# ")), "")
        cache[where] = (txt, title + "\n" + _sections(txt, ("总目标",))[:300])
    return cache[where]


def existing_files(text, self_where=""):
    """交接里写到、现在还在的文件或目录（脚本、成品、工作目录），新的在前，最多 MAX_FILES 个。"""
    seen, out = set(), []
    for raw in _PATH.findall(text):
        p = raw.rstrip(".:,")
        full = os.path.expanduser(p)
        if full in seen or SKIP_PATH.search(full) or full == self_where or "<" in full:
            continue
        seen.add(full)
        try:
            out.append((os.stat(full).st_mtime, p))
        except OSError:
            continue
    out.sort(reverse=True)
    return [p for _, p in out[:MAX_FILES]]


def skill_docs(before=None, dirs=None):
    """[(名字, 描述, SKILL.md 路径)]；before 给了只要那时已有的（按文件创建时间）。"""
    out = []
    for d in dirs or SKILL_DIRS:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*/SKILL.md")):
            try:
                st = f.stat()
                if before and getattr(st, "st_birthtime", st.st_mtime) > before:
                    continue
                head = f.read_text(encoding="utf-8", errors="ignore")[:1500]
            except OSError:
                continue
            m = re.search(r"^description:\s*(.+)$", head, re.M)
            if f.parent.name not in {x[0] for x in out}:  # 同名 skill 装给几家 CLI 时只列一份
                out.append((f.parent.name, (m.group(1).strip() if m else ""), str(f)))
    return out


def _score(q, docs):
    """BM25 式打分：共有词按稀有程度加权，长文档打折；出现在超过 COMMON 比例文档里的词不算。返回 [(分, 共有词数)]。"""
    n = len(docs) or 1
    df = {}
    for d in docs:
        for t in d:
            df[t] = df.get(t, 0) + 1
    avg = sum(len(d) for d in docs) / n or 1
    out = []
    for d in docs:
        shared = [t for t in q & d if df[t] <= max(2, COMMON * n)]
        s = sum(math.log(1 + n / df[t]) for t in shared)
        out.append((s / (0.5 + 0.5 * len(d) / avg), len(shared)))
    return out


def listing(notes, task="", self_where="", before=None, records=None, skill_dirs=None):
    """开工要看的现成东西，一行一样；没有返回 []。before（秒）给了只看那时已有的（回放用）。"""
    q_text = task + "\n" + _written(notes)
    q = terms(q_text)
    cited = set(_NUM.findall(q_text))
    if records is None:
        records = _board_records()
    me = os.path.realpath(self_where) if self_where else ""
    recs = [r for r in records if r.get("where") and os.path.realpath(r["where"]) != me
            and (before is None or 0 < _rec_time(r) < before)]
    cache = {}
    docs = [terms((r.get("what") or "") + " " + (r.get("short") or "") + " " + _goal_of(r["where"], cache)[1]) for r in recs]
    picked = [r for r in recs if str(r.get("id")) in cited]  # 交接里点名的编号直接算上一棒
    ranked = sorted(zip(_score(q, docs), range(len(recs))), key=lambda x: (-x[0][0], -_rec_time(recs[x[1]])))
    for (s, k), i in ranked:
        if len(picked) >= MAX_TASKS:
            break
        if k >= 2 and s >= TASK_MIN and recs[i] not in picked:
            picked.append(recs[i])
    lines = []
    for r in picked[:MAX_TASKS]:
        files = existing_files(_goal_of(r["where"], cache)[0], os.path.realpath(r["where"]))
        when = r.get("done_at") or r.get("at") or ""
        state = r.get("status") or ""
        line = (f"- 上一棒 #{r.get('id')}「{r.get('short') or (r.get('what') or '')[:16]}」"
                f"（{'，'.join(x for x in (state, when) if x)}）：交接 {r['where']}")
        if files:
            line += "；里面写到、现在还在：" + "、".join(files)
        lines.append(line)
    sk = skill_docs(before, skill_dirs)
    sdocs = [terms(name.replace("-", " ") + " " + desc) for name, desc, _ in sk]
    for (s, k), i in sorted(zip(_score(q, sdocs), range(len(sk))), key=lambda x: -x[0][0])[:MAX_SKILLS]:
        if k >= 2 and s >= SKILL_MIN:
            name, desc, path = sk[i]
            lines.append(f"- 现成做法 {name}：{desc[:60]}（{path}）")
    dec = [ln for ln in _sections(notes, ("旧定案",)).splitlines() if ln.strip().startswith("-") and "没搜到" not in ln]
    if dec:
        lines.append(f"- 定案：交接里「旧定案（程序搜出）」节 {len(dec)} 条，开工前读")
    if not lines:
        return []
    return ["开工先看这些现成的（程序按任务名和原话找的），能用就接着用，不要从头重做："] + lines


# ---- 主角色提方案前（#1436，用户 11-11「感觉你对我们整个系统这个边界能力，还有它稀有功能不清晰，都说一开始就说没有记忆」）----
# 主角色在聊天频道要加东西、改机制时，同一份清单也给它：系统自带的能力（`bothouse about`「能做什么」节，产品说明本身）
# + 做过的同类活和现成做法（同 listing）。只在用户这句是在要方案、要加或改机制时列（PROPOSAL），平时不列。
PROPOSAL = re.compile(r"架构|机制|方案|怎么搞|怎么弄|怎么设计|设计一|加个|加一个|新做|新增|做一套|搞一套|重构|改革|改造|下一代|能力边界|有没有现成")
ABOUT_TTL = 3600  # 产品说明随发版才变，一小时重读一次够
_about = [0.0, []]


def about_caps(cmd=None):
    """`bothouse about`「能做什么」节 → ["能力名：一句话", …]（粗体标题 + 第一句）；跑不了返回 []。"""
    import subprocess  # noqa: PLC0415
    if time.time() - _about[0] < ABOUT_TTL and _about[1]:
        return _about[1]
    exe = (cmd or os.environ.get("BOTHOUSE_CTX_CMD") or "bothouse ctx").split()[0]
    try:
        out = subprocess.run([exe, "about"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    body = _sections(out, ("能做什么",))
    caps = []
    for ln in body.splitlines():
        m = re.match(r"^- \*\*(.+?)\*\*[：:]\s*(.+)$", ln.strip())
        if m:
            caps.append(f"{m.group(1)}：{m.group(2)}")
    _about[:] = [time.time(), caps]
    return caps


def proposal_listing(text, records=None, cmd=None):
    """用户这句在要方案、要加或改机制 → 提方案前要看的现成东西（系统自带能力 + 做过的同类活 + 现成做法），一行一样；否则 []。"""
    if not PROPOSAL.search(text or ""):
        return []
    rows = [f"- 系统自带：{c}" for c in about_caps(cmd)]
    rows += [r for r in listing("", text, records=records)[1:] if not r.startswith("- 定案：")]
    if not rows:
        return []
    return ["你要加东西、改机制：先对一遍系统里现成有的（下面是自带能力和做过的同类活），提方案只写现成的哪样不够、差在哪；"
            "别把现成的说成要新做"] + rows


def _board_records():
    """任务板上做完的和进行中的活（../gate/board.py）。读不到返回 []。"""
    try:
        import board  # noqa: PLC0415  ws-handoff 已把 gate 目录放进 sys.path
        return list(board.done_records()) + list(board.items())
    except Exception:  # noqa: BLE001
        return []


def append_to(path, task=""):
    """给交接追加本节（已有就不加，返回已有的行），返回列出的行；没有可列的或出错返回 []。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
        if f"## {SECTION}" in text:
            return [ln for ln in _sections(text, (SECTION,)).splitlines() if ln.strip()]
        rows = listing(text, task, self_where=path)
        if not rows:
            return []
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(("" if text.endswith("\n") else "\n") + f"\n## {SECTION}\n" + "\n".join(rows) + "\n")
        return rows
    except Exception:  # noqa: BLE001
        return []


if __name__ == "__main__":
    sys.path.insert(0, os.environ.get("GATE_DIR") or str(Path(__file__).resolve().parent.parent / "gate"))
    args = sys.argv[1:]
    before = None
    if "--before" in args:
        i = args.index("--before")
        before = _ts(args[i + 1])
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)
    t0 = time.time()
    rows = listing(Path(args[0]).read_text(encoding="utf-8"), args[1] if len(args) > 1 else "", args[0], before)
    print("\n".join(rows) or "（没有可列的）")
    print(f"（{time.time() - t0:.1f} 秒）", file=sys.stderr)
