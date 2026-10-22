#!/usr/bin/env python3 -I
"""Structural checks for the wiki (budgets from CLAUDE.md). Prints violations; exit 1 if any.

  lint.py          check
  lint.py --stats  also print sizes per layer
  lint.py --warn   print only soft warnings (≥ WARN of a budget: split early, in the weekly LINT pass)
  lint.py --root DIR   check the wiki at DIR (a teammate's wiki: its bin/lint.py runs this file this way)
"""
import re, sys
from pathlib import Path

WIKI = Path(__file__).resolve().parent.parent
SHARED_TOOL = 1  # marker: this lint.py takes --root; teammate/ shims refuse a tool without it
MAX_DOMAINS, INDEX_LINE = 8, 80
MAX_TOPICS, README_LINE = 15, 120
PAGE_LINES, PAGE_CHARS = 60, 4000
WARN = 0.8
BODY_LINE = 300  # one bullet = one fact; longer lines dodge PAGE_LINES and are unreadable
SECTIONS = ("现状", "关键事实", "决策与踩坑", "待办")
# verification bookkeeping that leaked onto a page instead of fixing the fact
META = re.compile(r"不声称|未见用户确认|不记作现行|（用户告知）|\(用户告知\)|本会话中")
# 待办 holds tasks the user agreed to; an unanswered proposal goes to log.md only (user 2026-10-16 「可以的」 to the
# fix plan; 323 待办 had 132 such lines). dream's candidates (「dream 建议，用户未答复」) are its page's job: kept.
UNANSWERED = re.compile(r"未答复")  # 「已提议，用户未答复」「橘提议，用户未答复」「：未答复」「鲸鱼娘未答复」
SPECIAL = {"misc"}
LINK = re.compile(r"\]\(([^)]+)\)")
WIKILINK = re.compile(r"\[\[([^\]]+)\]\]")


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

    dirs = {p.name for p in W.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name != "bin"}
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
            if n_lines > PAGE_LINES or n_chars > PAGE_CHARS:
                errs.append(f"{d}/{name}: {n_lines} lines / {n_chars} chars > {PAGE_LINES}/{PAGE_CHARS}; split into subtopics or compress")
            # not elif: an over-budget page is ≥ WARN too, so --warn lists it and ingest's split_pass picks it up
            if max(n_lines / PAGE_LINES, n_chars / PAGE_CHARS) >= WARN:
                warns.append(f"{d}/{name}: {n_lines}/{PAGE_LINES} lines, {n_chars}/{PAGE_CHARS} chars; split into subtopics")
            if "## 相关会话" in text:
                errs.append(f"{d}/{name}: session lists belong in log.md, not on topic pages")
            body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
            heads = re.findall(r"^## (.+)$", body, re.M)
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
                if len(l) > BODY_LINE:
                    errs.append(f"{d}/{name}: body line {i} is {len(l)} chars > {BODY_LINE}; split into bullets or move detail to log.md")
                if META.search(l):
                    errs.append(f"{d}/{name}: body line {i} has verification bookkeeping ('{META.search(l).group()}'); state the fact or drop it")
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
    stray = [p.name for p in W.glob("*.md") if p.name not in {"MEMORY.md", "CLAUDE.md", "log.md"}]
    for p in stray:
        errs.append(f"{p}: top-level page; move it into a domain")
    return errs, stats, warns


if __name__ == "__main__":
    root = Path(sys.argv[sys.argv.index("--root") + 1]).resolve() if "--root" in sys.argv[:-1] else None
    errs, stats, warns = check(root)
    if "--warn" in sys.argv:
        print("\n".join(warns))
        sys.exit(0)
    if "--stats" in sys.argv:
        print("\n".join(stats))
    print("\n".join(errs) if errs else "lint ok")
    sys.exit(1 if errs else 0)
