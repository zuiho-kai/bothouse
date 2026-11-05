#!/usr/bin/env python3 -I
"""写入时的过时检测（用户 11-03「做」）：新写进 wiki 的事实和同页旧事实比对，被新事实推翻的旧行原样挪进同页「## 历史」，
不删（wiki 的「Never forget」约定；bin/lossless.py 照样查得到）。

照抄 Graphiti（Zep，arXiv 2501.13956 §2.2 「Temporal Extraction and Edge Invalidation」）：新 edge 和相关旧 edge 交给模型，
判出「新事实与之不能同时为真」的旧 edge 标作废（t_invalid），不删。提示词抄自 graphiti_core/prompts/dedupe_edges.py
resolve_edge（github.com/getzep/graphiti 提交 7e0342a4）的 contradiction 部分，原文英文照搬；去掉了 duplicate 部分（我们不合并重复行）。
调用流程同 graphiti_core/utils/maintenance/edge_operations.py resolve_extracted_edges：候选 = 新事实相关的旧事实
（Graphiti 取同两端节点的 edge + 检索；这里取同一页的旧行），模型交回 contradicted_facts 编号。

挂在两条现成链路上：
- ingest.py 每个 model pass 验收前（_one_pass.accept）：这一轮新写的行 vs 同页旧行；ask = 这一轮自己的引擎。
- gate 的 score_night.py（bothouse 装在 <数据目录>/gate）：用户纠正的那一轮，用户那句纠正 vs 那轮推过的条目。

  invalidate.py [--root DIR] [--dry]     对 DIR（默认本 wiki）工作区相对 HEAD 的改动跑一遍；--dry 只打印
"""
import shutil, json, os, re, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lossless

WIKI = Path(__file__).resolve().parent.parent
HISTORY = "历史"  # 同 ingest.HISTORY / lint.SECTIONS
MAX_CHARS = 240_000  # 沿用 ingest.py MAX_CHARS：每次模型调用的输入上限
BULLET = re.compile(r"^(\s*)[-*+] \S")
OVERTURNED = re.compile(r"^\s*[-*+] 曾")  # 「曾以为/曾选 X → 因 Y 改为 Z」本身就是推翻记录，按 wiki 约定「Keep overturned decisions」留在决策与踩坑，不当候选
SKIP = {"README.md"}  # 目录索引不是事实页（lossless.ROOT_FILES 另外排除 MEMORY.md、log.md、CLAUDE.md）

# 原文照搬 graphiti_core/prompts/dedupe_edges.py:48-49、56-59、85-97、104-110（只删了 duplicate 相关的句子），
# 输入格式改成多页多条：每页 EXISTING FACTS 编号从 0 起，NEW FACTS 也从 0 起，按页交回。
EXAMPLE = (
    "<EXAMPLE>\n"
    # 来源 graphiti dedupe_edges.py:104-106 原文
    'EXISTING FACT: idx=1, "Alice works at Acme Corp as a software engineer"\n'
    'NEW FACT: "Alice works at Acme Corp as a senior engineer"\n'
    "Result: contradicted_facts=[1] (same relationship but updated title — contradiction)\n\n"
    # 来源 graphiti dedupe_edges.py:108-110 原文
    'EXISTING FACT: idx=2, "Bob ran 5 miles on Tuesday"\n'
    'NEW FACT: "Bob ran 3 miles on Wednesday"\n'
    "Result: contradicted_facts=[] (different events on different days — not a contradiction)\n"
    "</EXAMPLE>\n")
PROMPT = """You are a fact deduplication assistant. NEVER mark facts as contradicted unless the new fact explicitly makes the old fact false.

Only mark a fact as contradicted when the NEW FACT and the existing fact cannot both be true.
Do NOT treat additional activity, progress, status, or project-update facts as contradictions of role,
ownership, responsibility, membership, or assignment facts. A person doing work on a project is
compatible with that person remaining responsible for, owning, leading, or being the DRI for the project.

CONTRADICTION DETECTION:
   - Determine which facts the NEW FACT directly contradicts from EXISTING FACTS.
   - A contradiction requires explicit evidence that the old fact stopped being true or was replaced,
     such as clear termination, replacement, transfer, or mutually exclusive current-state language.
   - Do NOT infer contradiction from recency alone, episode dates, meeting dates, weekly snapshots,
     section headings such as "updates" or "status changes", or a new event involving the same entities.
   - Do NOT mark a role/ownership/responsibility/assignment fact as contradicted merely because the
     NEW FACT describes work performed, updates shipped, documents created, progress made, blockers,
     next steps, or collaboration involving the same person and project.
   - Return all contradicted idx values in contradicted_facts.
   - If no contradictions, return an empty list for contradicted_facts.

""" + EXAMPLE + """
Below are one or more GROUPS. Each group has EXISTING FACTS (idx from 0) and NEW FACTS (n from 0). For every NEW FACT,
return the idx values of the EXISTING FACTS of its own group that it contradicts.
Answer only with JSON: {"results": [{"g": group, "n": new fact, "contradicted_facts": [idx, ...]}]}. Do not edit any file.
"""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["results"], "properties": {"results": {
    "type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["g", "n", "contradicted_facts"],
                               "properties": {"g": {"type": "integer"}, "n": {"type": "integer"},
                                              "contradicted_facts": {"type": "array", "items": {"type": "integer"}}}}}}}


def night_ask(prompt):
    """独立调用（score_night、命令行）：用户给这个 wiki 配的每晚模型（config.json night_engine，ingest.answer），
    不在这里挑 CLI。WIKI_DIR = 哪个 wiki 的配置（score_night 设成 GATE_WIKI，--root 设成那个目录）。"""
    import ingest  # 同目录；ingest 也 import 本文件，所以在用到时才导入
    return ingest.answer(prompt, label="invalidate")


def _json(text):
    """模型回答里的 JSON（ingest 的引擎没有 --output-schema，答案可能夹在文字里）。"""
    for m in [(text or "").strip()] + re.findall(r"\{[\s\S]*\}", text or ""):
        try:
            v = json.loads(m)
            if isinstance(v, dict) and isinstance(v.get("results"), list):
                return v["results"]
        except ValueError:
            pass
    return []


def render(g, old, new):
    ex = "\n".join(f'idx={i}, "{t.strip()}"' for i, t in enumerate(old))
    nw = "\n".join(f'n={j}, "{t.strip()}"' for j, t in enumerate(new))
    return f"## GROUP {g}\n<EXISTING FACTS>\n{ex}\n</EXISTING FACTS>\n<NEW FACTS>\n{nw}\n</NEW FACTS>"


def judge(groups, ask=None):
    """groups = [(旧行列表, 新事实列表)] → (每组被推翻的旧行编号集合, 调模型几次)。按 MAX_CHARS 分批，一批一次调用。"""
    ask = ask or night_ask
    hit = [set() for _ in groups]
    calls = 0
    idx = [i for i, (o, n) in enumerate(groups) if o and n]
    while idx:
        batch, size = [], len(PROMPT)
        while idx and (not batch or size + len(render(0, *groups[idx[0]])) <= MAX_CHARS):
            size += len(render(0, *groups[idx[0]]))
            batch.append(idx.pop(0))
        text = PROMPT + "\n\n" + "\n\n".join(render(g, *groups[i]) for g, i in enumerate(batch))
        calls += 1
        for v in _json(ask(text)):
            try:
                i = batch[int(v["g"])]
                hit[i] |= {int(x) for x in v["contradicted_facts"] if 0 <= int(x) < len(groups[i][0])}
            except (KeyError, ValueError, TypeError, IndexError):
                pass
    return hit, calls


def body(text):
    """[(行号, 行)]：页面正文里的条目行（不含 frontmatter、标题、「## 历史」节）。"""
    out, sec, lines = [], "", text.split("\n")
    m = lossless.FRONT.match(text)
    start = m.group(0).count("\n") if m else 0
    for i, l in enumerate(lines[start:], start):
        if l.startswith("## "):
            sec = l[3:]
            continue
        if not sec.startswith(HISTORY) and BULLET.match(l):
            out.append((i, l))
    return out


def block(lines, i):
    """第 i 行和它下面缩进更深的子行（一起挪，结构不断）。"""
    ind = len(lines[i]) - len(lines[i].lstrip())
    j = i + 1
    while j < len(lines) and lines[j].strip() and len(lines[j]) - len(lines[j].lstrip()) > ind:
        j += 1
    return list(range(i, j))


def to_history(text, olds):
    """把 olds（原文行）连同子行原样挪到页末「## 历史」（没有就建），首行顶格。返回 (新文本, 挪了几行)。"""
    lines = text.rstrip("\n").split("\n")
    keep = set(olds)
    take = []
    for i, l in body("\n".join(lines)):
        if l in keep and not any(i in b for b in take):
            take.append(block(lines, i))
    if not take:
        return text, 0
    gone = {i for b in take for i in b}
    moved = []
    for b in take:
        ind = len(lines[b[0]]) - len(lines[b[0]].lstrip())
        moved += [lines[i][ind:] if not lines[i][:ind].strip() else lines[i] for i in b]
    rest = [l for i, l in enumerate(lines) if i not in gone]
    h = next((k for k, l in enumerate(rest) if l.startswith("## " + HISTORY)), None)
    if h is None:
        while rest and not rest[-1].strip():
            rest.pop()
        rest += ["", "## " + HISTORY]
        h = len(rest) - 1
    e = next((k for k in range(h + 1, len(rest)) if rest[k].startswith("## ")), len(rest))
    while e > h + 1 and not rest[e - 1].strip():
        e -= 1
    return "\n".join(rest[:e] + moved + rest[e:]) + "\n", len(moved)


def git(root, *a):
    return subprocess.run(["git", "-c", "core.quotepath=off", *a], cwd=root, capture_output=True, text=True).stdout


def changed(root, head="HEAD"):
    """工作区相对 head 改过、新加的事实页。"""
    names = git(root, "diff", "--name-only", head).splitlines() + git(root, "ls-files", "--others", "--exclude-standard").splitlines()
    return sorted({n for n in names if lossless.wanted(n) and Path(n).name not in SKIP and n not in lossless.ROOT_FILES
                   and (Path(root) / n).is_file()})


def run(root=None, head="HEAD", ask=None, dry=False, log=print):
    """这次改动里新写的行（整库 head 里都没有的）vs 同页 head 里就有、现在还在正文的旧行；被推翻的挪进同页「## 历史」。
    返回 (挪了几行, 调模型几次, [(页, 旧行, 同组新行)])。"""
    root = Path(root or WIKI)
    pages = changed(root, head)
    if not pages:
        return 0, 0, []
    seen = {lossless.norm(l) for t in lossless.corpus(head, root).values() for l in t.splitlines()}
    groups, meta = [], []
    for rel in pages:
        now = (root / rel).read_text(encoding="utf-8", errors="ignore")
        was = {l.strip() for l in git(root, "show", f"{head}:{rel}").splitlines()}
        rows = [l for _, l in body(now)]
        new = [l for l in rows if lossless.norm(l) not in seen]
        old = [l for l in rows if l.strip() in was and not OVERTURNED.match(l)]
        if new and old:
            groups.append((old, new))
            meta.append(rel)
    hit, calls = judge(groups, ask)
    moved, pairs = 0, []
    for rel, (old, new), h in zip(meta, groups, hit):
        if not h:
            continue
        olds = [old[i] for i in sorted(h)]
        pairs += [(rel, o.strip(), " / ".join(n.strip() for n in new)) for o in olds]
        if dry:
            continue
        p = root / rel
        text, n = to_history(p.read_text(encoding="utf-8"), olds)
        p.write_text(text, encoding="utf-8")
        moved += n
    for rel, o, n in pairs:
        log(f"invalidate {rel}: 「{o[:120]}」→ 历史（新：{n[:120]}）")
    return moved, calls, pairs


def run_lines(fixes, root=None, ask=None, dry=False):
    """score_night 的纠正轮：fixes = [(用户那句纠正, [(页, 原行)])]（那轮推过的条目），全部轮合成一批问（judge 按
    MAX_CHARS 分批）。被推翻的挪进各自页的「## 历史」；角色 wiki（~/…）不在这个库，不动。
    返回 (挪了几行, 调模型几次, [(页, 旧行, 推翻它的那句)], 改了的页)。"""
    root = Path(root or WIKI)
    fixes = [(f, [(r, l) for r, l in refs if l.strip() and not OVERTURNED.match(l)]) for f, refs in fixes if f.strip()]
    fixes = [(f, refs) for f, refs in fixes if refs]
    hit, calls = judge([([l for _, l in refs], [f]) for f, refs in fixes], ask)
    out = [(refs[i][0], refs[i][1], f) for (f, refs), h in zip(fixes, hit) for i in sorted(h)]
    moved, pages = 0, []
    for rel in dict.fromkeys(r for r, _, _ in out):
        p = root / rel
        if dry or rel.startswith("~") or not p.is_file():
            continue
        whole = {l.strip(): l for l in p.read_text(encoding="utf-8").split("\n")}
        olds = list(dict.fromkeys(whole[l.strip()] for r, l, _ in out if r == rel and l.strip() in whole))
        text, n = to_history(p.read_text(encoding="utf-8"), olds)
        if n:
            p.write_text(text, encoding="utf-8")
            moved += n
            pages.append(rel)
    return moved, calls, out, pages


if __name__ == "__main__":
    a = sys.argv[1:]
    root = a[a.index("--root") + 1] if "--root" in a else None
    if root:
        os.environ["WIKI_DIR"] = str(Path(root).resolve())  # night_ask 读这个 wiki 的每晚模型
    m, c, _ = run(root, dry="--dry" in a)
    print(f"调模型 {c} 次，挪进历史 {m} 行")
