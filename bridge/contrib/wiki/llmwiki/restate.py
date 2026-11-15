#!/usr/bin/env python3 -I
"""夜里把同一页里「同一件事的新旧说法」合成一条现行说法：整理旧记忆不光追加。
旧行原样挪进同页「## 历史」，不删（wiki 的「Never forget」约定；lossless.py 照查得到），正文只留合出来的那一行。

照抄两处现成做法：
- Letta sleep-time compute（CS329Z 第 7 讲课件第 59 页）：空闲时把记忆块里前后矛盾的说法改写成一条现行说法
  （课件例子：先说喜欢蓝色、后来说更喜欢红色 → 「现在最喜欢红色」）。
- Mem0 的 UPDATE 操作（课件第 63 页，mem0/configs/prompts.py DEFAULT_UPDATE_MEMORY_PROMPT）：同一件事的新信息和旧记忆
  合成一条，「keep the one with more information」；我们不删旧的，挪进历史。
和 invalidate.py 的分工：invalidate 在写入时只判「新行推翻了哪条旧行」并挪走；这里处理已经堆在页上的多条旧行之间互相更新的情况。

  restate.py [--root DIR] [--dry] [--all] [--commit] [PAGE ...]
      PAGE 不给 = lint 页预算报告里的页（lint.check 的 warns，≥ lint.WARN 的页），上次跑过后没改的跳过（--all 不跳）
      --dry 只打印合并样例，不写文件
"""
import hashlib, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import invalidate, lint, lossless  # noqa: E402

WIKI = Path(__file__).resolve().parent.parent
STATE = ".restate.json"  # 页 → 上次跑完时的内容哈希（同 ingest split_pass「unchanged since last split → skip」）
HISTORY = invalidate.HISTORY
TOP = re.compile(r"^[-*+] \S")  # 只合顶格条目；子行跟着父行一起挪（invalidate.block）
DATE = re.compile(r"(?<![\d-])(?:20\d\d-)?(?:1[0-2]|0?[1-9])-(?:[0-2]?\d|3[01])(?![\d-])")
QUOTE = re.compile(r"「([^」]{2,})」")

PROMPT = """你在整理一个 Markdown 知识库的一页。这页是按时间往后追加写的，同一件事常有好几行：先写了一个状态，后来又写了更新、
补充或推翻它的新状态。读的人要从上往下读完才知道「现在到底是什么」。你的活：找出这样的行组，每组合成一条「现行说法」。

只合「同一件事、不同时间的说法」：同一个东西的状态、数字、做法、结论，被后来的行更新、补充或推翻。合完以后，读的人只看这一行
就知道这件事现在怎么样。拿不准就不合。下面这些不合：
- 不同的事件、不同的决定、并列的几条事实（哪怕话题相近）；
- 以「曾以为」「曾选」开头的行（那是专门留着防止旧方案被重提的记录）；
- 意思不同的两条用户原话定案。

现行说法怎么写（照 Mem0 UPDATE：保留信息更多的那个，合进新内容）：
- 以最新的那行为准写现在为真的说法；旧行里仍然为真、新行没再说的要点也带上；已经被推翻的旧说法不写；
- 带上最新的那个日期；用户原话（「」里的）原样保留，不改字；不编行里没有的事实、日期、数字、路径；
- 中文，以「- 」开头，一行不超过 LIMIT 字；一行写不下时，一条顶格行加几条缩进两格的子行「  - 」（wiki 约定：一条一事，长了用子行分组），每行都不超过 LIMIT 字。

输入每页给出正文条目，格式「[编号] (节名) 原文」，子行缩进跟在后面。只用同一节里的行组成一组，每组至少 2 行。
只输出 JSON：{"groups": [{"p": 页号, "lines": [编号, ...], "now": "- 现行说法"}]}；没有可合的就 {"groups": []}。不要改任何文件。
""".replace("LIMIT", str(lint.BODY_LINE))
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["groups"], "properties": {"groups": {
    "type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["p", "lines", "now"],
                               "properties": {"p": {"type": "integer"}, "lines": {"type": "array", "items": {"type": "integer"}},
                                              "now": {"type": "string"}}}}}}


def codex_ask(prompt):
    """同 invalidate.codex_ask，换成本脚本的 schema。"""
    with tempfile.NamedTemporaryFile("w", suffix=".json") as sf, tempfile.NamedTemporaryFile("r", suffix=".txt") as out:
        json.dump(SCHEMA, sf)
        sf.flush()
        r = subprocess.run(["codex", "exec", "-m", os.environ.get("WIKI_CODEX_MODEL", "gpt-6-luna"), "-c", "notify=[]", "--skip-git-repo-check",
                            "-s", "read-only", "--output-schema", sf.name, "-o", out.name, "-"],
                           input=prompt, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"codex 失败：rc={r.returncode} {r.stderr[-400:]}")
        return Path(out.name).read_text(encoding="utf-8")


def claude_ask(prompt, model="sonnet"):
    """claude -p（命令行引擎，同 ingest 的 api-sonnet|sonnet 那一档）；RESTATE_ENGINE=claude:<模型> 选它。"""
    r = subprocess.run(["claude", "-p", "--model", model, prompt], capture_output=True, text=True, cwd=tempfile.gettempdir())
    if r.returncode != 0:
        raise RuntimeError(f"claude 失败：rc={r.returncode} {r.stderr[-400:]}")
    return r.stdout


def default_ask():
    eng = os.environ.get("RESTATE_ENGINE", "claude:sonnet")  # 11-13 试跑：codex luna 一批 3 页 16.7 万字 23 分钟没回，sonnet 一页 20–45 秒
    if eng == "codex":
        return codex_ask
    return lambda pr: claude_ask(pr, eng.partition(":")[2] or "sonnet")


def _groups(text):
    for m in [(text or "").strip()] + re.findall(r"\{[\s\S]*\}", text or ""):
        try:
            v = json.loads(m)
            if isinstance(v, dict) and isinstance(v.get("groups"), list):
                return v["groups"]
        except ValueError:
            pass
    return []


def entries(text):
    """[(行号, 节名, 块行号列表)]：正文里的顶格条目（不含 frontmatter、「## 历史」）。"""
    lines = text.split("\n")
    m = lossless.FRONT.match(text)
    start = m.group(0).count("\n") if m else 0
    out, sec = [], ""
    for i in range(start, len(lines)):
        l = lines[i]
        if l.startswith("## "):
            sec = l[3:].strip()
            continue
        if sec and not sec.startswith(HISTORY) and TOP.match(l):
            out.append((i, sec, invalidate.block(lines, i)))
    return out


def render(p, rel, text):
    lines = text.split("\n")
    rows = [f"[{k}] ({sec}) " + "\n    ".join(lines[j] for j in blk) for k, (_, sec, blk) in enumerate(entries(text))]
    return f"## 页 {p}：{rel}\n" + "\n".join(rows)


def valid(g, ents, lines):
    """模型给的一组能不能用：同节、≥2 行、不碰「曾…」行、一行不超长、日期和用户原话都出自组里原行（不编）。返回原因，"" = 能用。"""
    idx = g.get("lines") or []
    if len(set(idx)) < 2 or any(not isinstance(k, int) or not 0 <= k < len(ents) for k in idx):
        return "编号不对或不到 2 行"
    if len({ents[k][1] for k in idx}) != 1:
        return "跨节"
    src = "\n".join(lines[j] for k in idx for j in ents[k][2])
    if any(invalidate.OVERTURNED.match(lines[ents[k][0]]) for k in idx):
        return "含「曾…」行"
    now = (g.get("now") or "").strip("\n").rstrip()
    rows = now.split("\n")
    if not rows[0].startswith("- ") or any(not r.startswith("  - ") for r in rows[1:]) \
            or any(len(r) > lint.BODY_LINE for r in rows):
        return f"现行说法格式不对或有行超过 {lint.BODY_LINE} 字"
    bad = [d for d in DATE.findall(now) if d not in src]
    if bad:
        return f"日期不在原行里：{bad}"
    bad = [q for q in QUOTE.findall(now) if q not in src]
    if bad:
        return f"原话不在原行里：{bad[0][:30]}"
    return ""


def apply(text, picks):
    """picks = [(组里各条的块行号列表, 现行说法)]：现行说法放在组里最后那条的位置，组里各条（连子行）原样挪进页末「## 历史」。"""
    lines = text.rstrip("\n").split("\n")
    put, gone, moved = {}, set(), []
    for blocks, now in sorted(picks, key=lambda x: min(min(b) for b in x[0])):
        last = max(blocks, key=lambda b: b[0])
        put[last[0]] = now
        for b in sorted(blocks):
            gone |= set(b)
            moved += [lines[j] for j in b]
    rest = []
    for i, l in enumerate(lines):
        if i in put:
            rest.append(put[i])
        elif i not in gone:
            rest.append(l)
    h = next((k for k, l in enumerate(rest) if l.startswith("## " + HISTORY)), None)
    if h is None:
        while rest and not rest[-1].strip():
            rest.pop()
        rest += ["", "## " + HISTORY]
        h = len(rest) - 1
    e = next((k for k in range(h + 1, len(rest)) if rest[k].startswith("## ")), len(rest))
    while e > h + 1 and not rest[e - 1].strip():
        e -= 1
    return "\n".join(rest[:e] + moved + rest[e:]) + "\n"


def body_chars(text):
    """正文字数（不含 frontmatter 和「## 历史」节）：读的人要读的部分。"""
    m = lossless.FRONT.match(text)
    out, hist = 0, False
    for l in text[m.end() if m else 0:].split("\n"):
        if l.startswith("## "):
            hist = l[3:].startswith(HISTORY)
        if not hist:
            out += len(l) + 1
    return out


def budget_pages(root):
    """lint 页预算报告里的页（≥ lint.WARN）。"""
    _, _, warns = lint.check(Path(root))
    return [w.split(":", 1)[0] for w in warns if w.split(":", 1)[0].endswith(".md") and not w.split(":", 1)[0].endswith("README.md")]


def git(root, *a):
    return subprocess.run(["git", "-c", "core.quotepath=off", *a], cwd=root, capture_output=True, text=True)


def run(root=None, pages=None, ask=None, dry=False, skip_same=True, log=print):
    """返回 (改了的页 [(页, 改前正文字数, 改后正文字数, 合了几组)], 样例 [(页, 原行们, 现行说法)], 调模型几次)。"""
    root = Path(root or WIKI)
    ask = ask or default_ask()
    st_path = root / STATE
    st = json.loads(st_path.read_text()) if st_path.exists() else {}
    pages = pages or budget_pages(root)
    todo = []
    for rel in pages:
        p = root / rel
        if not p.is_file():
            continue
        text = p.read_text(encoding="utf-8")
        h = hashlib.sha256(text.encode()).hexdigest()
        if skip_same and st.get(rel) == h:
            continue
        if len(entries(text)) >= 2:
            todo.append((rel, text))
    done, samples, calls = [], [], 0
    while todo:
        batch, size = [], len(PROMPT)
        while todo and not batch:  # 一页一次调用（11-13 试跑：多页拼一批太慢，见 default_ask）
            size += len(todo[0][1])
            batch.append(todo.pop(0))
        calls += 1
        try:
            groups = _groups(ask(PROMPT + "\n\n" + "\n\n".join(render(k, rel, t) for k, (rel, t) in enumerate(batch))))
        except Exception as e:  # 这一批模型失败：跳过，下次再来（同 score_night 坏一批跳一批）
            log(f"restate: batch failed: {type(e).__name__}: {e}")
            continue
        for k, (rel, text) in enumerate(batch):
            ents, lines = entries(text), text.split("\n")
            picks, used = [], set()
            for g in groups:
                if g.get("p") != k:
                    continue
                why = valid(g, ents, lines)
                if not why and used & set(g["lines"]):
                    why = "和别的组重叠"
                if why:
                    log(f"restate {rel}: 不合 {g.get('lines')}：{why}")
                    continue
                used |= set(g["lines"])
                picks.append(([ents[i][2] for i in g["lines"]], g["now"].strip("\n").rstrip()))
                samples.append((rel, [lines[ents[i][0]] for i in sorted(g["lines"])], g["now"].strip("\n").rstrip()))
            new = apply(text, picks) if picks else text
            if picks and not dry:
                (root / rel).write_text(new, encoding="utf-8")
            if picks:
                done.append((rel, body_chars(text), body_chars(new), len(picks)))
            st[rel] = hashlib.sha256(new.encode()).hexdigest()
    if not dry:
        st_path.write_text(json.dumps(st, ensure_ascii=False, indent=0))
    return done, samples, calls


def restate(root=None, pages=None, ask=None, commit=False, label="restate", log=print, skip_same=True):
    """在干净的 git 树上跑 run()；lossless（HEAD 对现在）不过、或 lint 多出新错，整次回滚（同 consolidate.consolidate）。"""
    root = Path(root or WIKI)
    if git(root, "status", "--porcelain", "--untracked-files=normal").stdout.strip():
        return False, "tree not clean; restate runs on a committed tree only", []
    before = set(lint.check(root)[0])
    done, samples, calls = run(root, pages, ask, log=log, skip_same=skip_same)
    if not done:
        return True, f"nothing to do ({calls} call(s))", samples
    miss = lossless.missing(lossless.corpus("HEAD", root), lossless.corpus(None, root))
    new_errs = [e for e in lint.check(root)[0] if e not in before]
    if miss or new_errs:
        git(root, "checkout", "--", *[d[0] for d in done])
        return False, "\n".join(x for x in (lossless.report(miss), "\n".join(new_errs[:lossless.SHOW])) if x), samples
    n = sum(d[3] for d in done)
    summary = f"{len(done)} page(s), {n} group(s): " + ", ".join(f"{d[0]} {d[1]}→{d[2]}" for d in done)
    if commit:
        day = time.strftime("%Y-%m-%d")
        with open(root / "log.md", "a", encoding="utf-8") as f:
            f.write(f"\n## [{day}] restructure | {label}\n" + "".join(
                f"- {d[0]}: 合并新旧说法 {d[3]} 组，正文 {d[1]}→{d[2]} 字，旧行进「## 历史」\n" for d in done))
        git(root, "add", "-A", "--", *[d[0] for d in done], "log.md")
        git(root, "commit", "-qm", f"restructure: {label}")
    return True, summary, samples


def main(argv):
    root = Path(argv[argv.index("--root") + 1]) if "--root" in argv else WIKI
    pages = [a for a in argv if a.endswith(".md") and not a.startswith("-")]
    if "--dry" in argv:
        done, samples, calls = run(root, pages or None, dry=True, skip_same="--all" not in argv)
        ok, summary = True, f"dry: {len(done)} page(s), {calls} call(s): " + ", ".join(f"{d[0]} {d[1]}→{d[2]}" for d in done)
    else:
        ok, summary, samples = restate(root, pages or None, commit="--commit" in argv, skip_same="--all" not in argv)
    for rel, olds, now in samples:
        print(f"\n### {rel}\n" + "\n".join(f"  旧 {o[:200]}" for o in olds) + f"\n  新 {now}")
    print(("OK " if ok else "REVERTED ") + summary)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
