#!/usr/bin/env python3 -I
"""Structural checks for the wiki (budgets from CLAUDE.md). Prints violations; exit 1 if any.

  lint.py          check
  lint.py --stats  also print sizes per layer
  lint.py --warn   print only soft warnings (≥ WARN of a budget: split early, in the weekly LINT pass)
  lint.py --wrap   first split every body line over BODY_LINE in place, verbatim (wrap()), then check
  lint.py --root DIR   check the wiki at DIR (a teammate's wiki: its bin/lint.py runs this file this way)
"""
import os, re, sys
from pathlib import Path

WIKI = Path(os.environ.get("WIKI_DIR") or Path(__file__).absolute().parent.parent)  # ingest.py sets WIKI_DIR; run alone: the wiki whose bin/ holds this (a link there counts)
SHARED_TOOL = 1  # marker: this lint.py takes --root; teammate/ shims refuse a tool without it
MAX_DOMAINS, INDEX_LINE = 8, 80
MAX_TOPICS, README_LINE = 15, 120
# 族合并后页的 P90 143 行/12486 字 ÷ 拆分线 0.9（SOP v2，2026-10-25 试跑 /tmp/sop-scratch/measure.py）：合并完不会马上又被拆
PAGE_LINES, PAGE_CHARS = 159, 13874
# 整理前各目录深度的页数 1:7 2:104 3:176 4:86 5:52 6:9 7:7 8:37 9:18，5 层内占 86%（SOP v2，2026-10-25）
MAX_DEPTH = 5
WARN = 0.8
# a page this full (lines or chars) is split by ingest's split_pass; family merges stay below it (SOP v2 2026-10-25 relay
# A2: 「每周整理的拆分线从 0.8 改成 0.9，避免合并后的页又被拆」)
SPLIT_AT = 0.9
FLOOR_TAG = re.compile(r"\s*<!-- 帖 t[0-9a-f]{10}·\d+楼.*?-->\s*$")  # forum thread/floor tag (#1177, forum_scores.TAG): not counted, never split
BODY_LINE = 300  # one bullet = one fact; longer lines dodge PAGE_LINES and are unreadable
SECTIONS = ("现状", "关键事实", "决策与踩坑", "待办", "历史")  # 历史 optional: superseded lines kept verbatim (SOP v2)
# verification bookkeeping that leaked onto a page instead of fixing the fact
META = re.compile(r"不声称|未见用户确认|不记作现行|（用户告知）|\(用户告知\)|本会话中")
# provenance tag: ｜源：亲验 · <text>  ｜源：转述 · <name>  ｜源：原话 · <date>
_PROV_VALID_VALUES = {"亲验", "转述", "原话"}
PROV_TAG = re.compile(r"｜源：([^·\n]+?)(?:\s*·\s*(.+?))?(?=\s*(?:｜|$))")
# 待办 holds tasks the user agreed to; an unanswered proposal goes to log.md only (user 2026-10-16 「可以的」 to the
# fix plan; 323 待办 had 132 such lines). dream's candidates (「dream 建议，用户未答复」) are its page's job: kept.
UNANSWERED = re.compile(r"未答复")  # 「已提议，用户未答复」「橘提议，用户未答复」「：未答复」「鲸鱼娘未答复」
SPECIAL = {"misc"}
LINK = re.compile(r"\]\(([^)]+)\)")
WIKILINK = re.compile(r"\[\[([^\]]+)\]\]")
FLOOR_TAG = re.compile(r"\s*<!-- 帖 t[0-9a-f]{10}·\d+楼.*?-->\s*$")
FENCE = re.compile(r"\s*(```|~~~)")


def wrap(line):
    """Split a long line at punctuation, preserving every character and its order."""
    tag = FLOOR_TAG.search(line)
    if tag:
        return [piece + tag.group(0) if i == 0 else piece
                for i, piece in enumerate(wrap(line[:tag.start()]))]
    if len(line) <= BODY_LINE:
        return [line]
    indent = re.match(r"\s*", line)[0] + "  "
    width = BODY_LINE - len(indent) - 2
    line = line.replace("dream 建议，用户未答复", "dream 建议\0用户未答复")
    pieces = re.split(r"(?<=[；。])", line)
    if max(map(len, pieces)) > width:
        pieces = re.split(r"(?<=[；。，、])", line)
    pieces = [part[i:i + width] for part in pieces for i in range(0, len(part), width)]
    out, current = [], ""
    for part in pieces:
        if current and len(current) + len(part) > width:
            out.append(current)
            current = ""
        current += part
    out.append(current)
    out = [part.replace("\0", "，") for part in out]
    return [out[0].rstrip()] + [f"{indent}- {part.strip()}" for part in out[1:] if part.strip()]


def wrap_text(text):
    """Wrap long body lines while leaving frontmatter, headings, tables and code blocks intact."""
    fm = re.match(r"\A---\n.*?\n---\n", text, re.S)
    head, body = (fm.group(), text[fm.end():]) if fm else ("", text)
    out, code = [], False
    for line in body.split("\n"):
        if FENCE.match(line):
            code = not code
        out += [line] if code or FENCE.match(line) or line.startswith(("#", "|")) else wrap(line)
    return head + "\n".join(out)


def wrap_pages(root=None):
    """Wrap long body lines in the pages lint checks; return changed relative paths."""
    wiki = root or WIKI
    changed = []
    for domain in tree(wiki):
        for path in sorted((wiki / domain).glob("*.md")):
            if path.name == "README.md":
                continue
            try:
                text = path.read_text()
            except (OSError, UnicodeError):
                continue
            wrapped = wrap_text(text)
            if wrapped != text:
                path.write_text(wrapped)
                changed.append(path.relative_to(wiki).as_posix())
    return changed


def entries(path):
    return [l for l in path.read_text().splitlines() if l.startswith("- [")]


def frontmatter(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    return dict(re.findall(r"^[ \t]*(\w+):[ \t]*(.+)$", m.group(1), re.M)) if m else None


def subdomains(d, root=None):
    """The subdomains a domain README lists: entries linking `<sub>/README.md` (one level down)."""
    readme = (root or WIKI) / d / "README.md"
    tops = entries(readme) if readme.exists() else []
    return [t[:-len("/README.md")] for t in (LINK.search(l).group(1) for l in tops if LINK.search(l))
            if t.endswith("/README.md") and "/" not in t[:-len("/README.md")]]


def tree(root=None):
    """Every domain directory lint walks, relative to the wiki: MEMORY.md's domains, then the subdomains their
    READMEs list, at any depth (a full domain is split into subdomains; budgets hold per README)."""
    root = root or WIKI
    index = root / "MEMORY.md"
    todo = sorted({LINK.search(l).group(1).split("/")[0] for l in entries(index) if LINK.search(l)}) if index.exists() else []
    out = []
    while todo:
        d = todo.pop(0)
        if (root / d / "README.md").exists():
            out.append(d)
            todo[:0] = [f"{d}/{s}" for s in subdomains(d, root) if (root / d / s / "README.md").exists()]
    return out


def wrap(line):
    """A line over BODY_LINE as itself plus sub-bullets, cut at 「；。」, then 「，、」, then hard. Every character stays, in
    order: lossless.kept_split() accepts the pieces as the old line (2026-10-28: models splitting old lines by hand
    reworded them, the no-forgetting check called them lost and reverted three batches in a row)."""
    tag = FLOOR_TAG.search(line)
    if tag:  # the floor tag (#1177) stays on the head line: split off alone it tags an empty bullet (218 such, 11-07)
        return [x + tag.group(0) if i == 0 else x for i, x in enumerate(wrap(line[:tag.start()]))]
    if len(line) <= BODY_LINE:
        return [line]
    indent = re.match(r"\s*", line)[0] + "  "
    width = BODY_LINE - len(indent) - 2
    # the 「dream 建议，用户未答复」 marker stays whole: on a continuation line alone 「未答复」 trips the 待办 rule
    line = line.replace("dream 建议，用户未答复", "dream 建议\0用户未答复")
    pieces = re.split(r"(?<=[；。])", line)
    if max(map(len, pieces)) > width:
        pieces = re.split(r"(?<=[；。，、])", line)
    pieces = [x[i:i + width] for x in pieces for i in range(0, len(x), width)]
    out, cur = [], ""
    for piece in pieces:
        if cur and len(cur) + len(piece) > width:
            out.append(cur)
            cur = ""
        cur += piece
    out.append(cur)
    out = [x.replace("\0", "，") for x in out]
    return [out[0].rstrip()] + [f"{indent}- {x.strip()}" for x in out[1:] if x.strip()]


FENCE = re.compile(r"\s*(```|~~~)")


def wrap_text(text):
    """`text` with each body line over BODY_LINE wrapped; frontmatter, headings and code blocks untouched."""
    fm = re.match(r"\A---\n.*?\n---\n", text, re.S)
    head, body = (fm.group(), text[fm.end():]) if fm else ("", text)
    out, code = [], False
    for l in body.split("\n"):
        if FENCE.match(l):
            code = not code
        out += [l] if code or FENCE.match(l) or l.startswith(("#", "|")) else wrap(l)  # a table row stays one line
    return head + "\n".join(out)


def wrap_pages(root=None):
    """Wrap the over-long body lines of the pages check() reads (tree()'s domains, not their README) in place; returns
    the pages changed. A catalog directory without a README (refs/media) is data, not pages: left as written."""
    W = root or WIKI
    changed = []
    for p in sorted(p for d in tree(W) for p in (W / d).glob("*.md") if p.name != "README.md"):
        rel = p.relative_to(W)
        try:
            text = p.read_text()
        except UnicodeDecodeError:  # not a page anyone can read: left for check() / the merge checks to reject
            continue
        new = wrap_text(text)
        if new != text:
            p.write_text(new)
            changed.append(rel.as_posix())
    return changed


def check(root=None):
    W = root or WIKI
    errs, stats, warns = [], [], []
    links, names, where = set(), set(), {}
    index = W / "MEMORY.md"
    lines = index.read_text().splitlines()
    doms = entries(index)
    if len(lines) != len(doms):
        errs.append(f"MEMORY.md: only domain entry lines allowed ({len(lines) - len(doms)} other lines)")
    linked = {LINK.search(l).group(1).split("/")[0] for l in doms if LINK.search(l)}
    if len(linked - SPECIAL) > MAX_DOMAINS:
        errs.append(f"MEMORY.md: {len(linked - SPECIAL)} domains > {MAX_DOMAINS}; merge domains")
    for l in doms:
        if len(l) > INDEX_LINE:
            errs.append(f"MEMORY.md: line over {INDEX_LINE} chars ({len(l)}): {l[:50]}…")
    stats.append(f"L0 MEMORY.md: {len(doms)} domains, {len(index.read_text())} chars")

    dirs = {p.name for p in W.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name not in ("bin", "schema", "rules")}  # schema/: the llm-wiki template's spec; rules/：家规源（rules.py）
    for d in sorted(dirs - linked):
        errs.append(f"{d}/: domain not listed in MEMORY.md")
    todo = sorted(linked)
    while todo:  # domains, then the subdomains each README lists (any depth); same budgets on every README
        d = todo.pop(0)
        readme = W / d / "README.md"
        if not readme.exists():
            errs.append(f"{d}/README.md missing")
            continue
        tops = entries(readme)
        # soft: consolidate.py --flatten moves it up, but skips (and logs) one whose parent README has no room
        if d.count("/") + 1 > MAX_DEPTH:
            warns.append(f"{d}/: depth {d.count('/') + 1} > {MAX_DEPTH}; move it up into its parent (consolidate.py --flatten)")
        if len(tops) > MAX_TOPICS:
            errs.append(f"{d}/README.md: {len(tops)} topics > {MAX_TOPICS}; split the domain")
        if MAX_TOPICS * WARN <= len(tops) <= MAX_TOPICS:
            warns.append(f"{d}/README.md: {len(tops)}/{MAX_TOPICS} topics; consider splitting the domain")
        for l in tops:
            if len(l) > README_LINE:
                errs.append(f"{d}/README.md: line over {README_LINE} chars ({len(l)}): {l[:50]}…")
        subs = set(subdomains(d, W))
        listed = {LINK.search(l).group(1) for l in tops if LINK.search(l)} - {f"{s}/README.md" for s in subs}
        # a directory with a README.md is a subdomain; one without (e.g. refs/media, a script-written catalog) is data
        subdirs = {p.name for p in (W / d).iterdir() if p.is_dir() and (p / "README.md").exists()}
        for s in sorted(subdirs - subs):
            errs.append(f"{d}/{s}/: subdomain not listed in {d}/README.md")
        for s in sorted(subs - subdirs):
            errs.append(f"{d}/README.md: links missing subdomain {s}/README.md")
        todo[:0] = [f"{d}/{s}" for s in sorted(subs & subdirs)]
        pages = {p.name for p in (W / d).glob("*.md") if p.name != "README.md"}
        names.update(n[:-3] for n in pages)
        for n in pages:
            where.setdefault(n, []).append(f"{d}/{n}")
        for p in sorted(pages - listed):
            errs.append(f"{d}/{p}: orphan page, not listed in {d}/README.md")
        for p in sorted(listed - pages):
            errs.append(f"{d}/README.md: links missing page {p}")
        for name in sorted(pages):
            text = (W / d / name).read_text()
            n_lines, n_chars = len(text.splitlines()), len(text)
            fm = frontmatter(text)
            if not fm or not {"name", "description", "scope"} <= fm.keys():
                errs.append(f"{d}/{name}: frontmatter needs name, description, scope")
            # over budget is a warning, never an error (SOP v2 不遗忘: pages only grow): an error would reject the write
            # that crossed the budget and every retry of it; --warn lists the page and ingest's split_pass splits it
            if max(n_lines / PAGE_LINES, n_chars / PAGE_CHARS) >= WARN:
                over = " (over budget)" if n_lines > PAGE_LINES or n_chars > PAGE_CHARS else ""
                warns.append(f"{d}/{name}: {n_lines}/{PAGE_LINES} lines, {n_chars}/{PAGE_CHARS} chars{over}; split into "
                             "subtopics in its own subdirectory (keep every line)")
            if "## 相关会话" in text:
                errs.append(f"{d}/{name}: session lists belong in log.md, not on topic pages")
            body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
            heads = re.findall(r"^## (.+)$", body, re.M)
            for h in sorted({h.rstrip() for h in heads if heads.count(h) > 1}):
                errs.append(f"{d}/{name}: section '## {h}' appears more than once; merge into one (consolidate.py --sections)")
            for h in heads:
                if not h.startswith(SECTIONS):
                    errs.append(f"{d}/{name}: section '## {h}' not in {'/'.join(SECTIONS)}; fold it into one of them")
            if not heads and len(body.splitlines()) > 8:
                errs.append(f"{d}/{name}: no ## sections; use {'/'.join(SECTIONS)}")
            sec = None
            for i, l in enumerate(body.splitlines(), 1):
                if l.startswith("## "):
                    sec = l[3:]
                if sec and sec.startswith("待办") and UNANSWERED.search(l) and "dream 建议" not in l:
                    errs.append(f"{d}/{name}: body line {i} is an unanswered proposal in 待办; 待办 only holds tasks the "
                                "user agreed to — move it to the log.md entry ('- 未答复提议：…') and drop it here")
                if len(FLOOR_TAG.sub("", l)) > BODY_LINE:
                    errs.append(f"{d}/{name}: body line {i} is {len(FLOOR_TAG.sub('', l))} chars > {BODY_LINE}; run `python3 bin/lint.py --wrap` "
                                "(splits it verbatim) — never split or reword an old line by hand")
                if META.search(l) and not l.rstrip().endswith(tuple(["｜源：亲验", "｜源：转述", "｜源：原话"])) and "｜源：" not in l:
                    errs.append(f"{d}/{name}: body line {i} has verification bookkeeping ('{META.search(l).group()}'); state the fact or drop it")
                for m in PROV_TAG.finditer(l):
                    val, detail = m.group(1).strip(), (m.group(2) or "").strip()
                    if val not in _PROV_VALID_VALUES:
                        errs.append(f"{d}/{name}: body line {i} has unknown provenance value '｜源：{val}'; must be 亲验/转述/原话")
                    elif val == "转述" and not detail:
                        errs.append(f"{d}/{name}: body line {i} has '｜源：转述' without a name after ' · '")
            links.update((f"{d}/{name}", n) for n in WIKILINK.findall(body))
            stats.append(f"L2 {d}/{name}: {n_lines} lines, {n_chars} chars")
        stats.append(f"L1 {d}/README.md: {len(tops)} topics")
    # [[name]] resolves by file name at any depth: two pages with one name make it ambiguous (CLAUDE.md is not a page)
    for n, ps in sorted(where.items()):
        if len(ps) > 1 and n != "CLAUDE.md":
            errs.append(f"{', '.join(ps)}: one file name in {len(ps)} directories, [[{n[:-3]}]] is ambiguous; rename all but one")
    for src, n in sorted(links):
        if n not in names:
            warns.append(f"{src}: [[{n}]] has no page yet")
    # STANDING.md：bothouse gate 每个会话附上的常驻做法短块（contrib/gate/ctxsvc.py standing_items），和 MEMORY.md 一样放根目录
    stray = [p.name for p in W.glob("*.md") if p.name not in {"MEMORY.md", "CLAUDE.md", "log.md", "STANDING.md"}]
    for p in stray:
        errs.append(f"{p}: top-level page; move it into a domain")
    return errs, stats, warns


if __name__ == "__main__":
    root = Path(sys.argv[sys.argv.index("--root") + 1]).resolve() if "--root" in sys.argv[:-1] else None
    if "--wrap" in sys.argv:
        print("\n".join(wrap_pages(root)) or "no long lines")
    errs, stats, warns = check(root)
    if root is None and (WIKI / "rules/house-rules.toml").exists():  # 家规各处块和规则源一致（bin/rules.py check）
        r = __import__("subprocess").run([sys.executable, "-I", str(WIKI / "bin/rules.py"), "check"], capture_output=True, text=True)
        if r.returncode:
            errs += r.stdout.splitlines()
    if "--warn" in sys.argv:
        print("\n".join(warns))
        sys.exit(0)
    if "--stats" in sys.argv:
        print("\n".join(stats))
    print("\n".join(errs) if errs else "lint ok")
    sys.exit(1 if errs else 0)
