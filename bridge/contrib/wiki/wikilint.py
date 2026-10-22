"""Structural checks for a role wiki. Ported from zuiho-kai/llm-wiki bin/lint.py (MIT, commit 51452dc) with the wiki
directory as a parameter. check(wiki, lang) -> (errors, warnings)."""
import re
from pathlib import Path

MAX_DOMAINS, INDEX_LINE = 8, 80  # 沿用 llm-wiki lint.py 预算（CLAUDE.md 分层表）
MAX_TOPICS, README_LINE = 15, 120  # 沿用 llm-wiki lint.py 预算
PAGE_LINES, PAGE_CHARS = 60, 4000  # 沿用 llm-wiki lint.py 预算
WARN = 0.8  # 沿用 llm-wiki lint.py
BODY_LINE = 300  # 沿用 llm-wiki lint.py（一条 bullet 一个事实）
LANGUAGES = {
    "zh": {"sections": ("现状", "关键事实", "决策与踩坑", "待办"),
           "meta": re.compile(r"不声称|未见用户确认|不记作现行|（用户告知）|\(用户告知\)|本会话中")},
    "en": {"sections": ("Current state", "Key facts", "Decisions & pitfalls", "Open items"),
           "meta": re.compile(r"not claiming|does not claim|not confirmed by the user|in this session", re.I)},
}
TOP_FILES = {"MEMORY.md", "CLAUDE.md", "log.md"}
LINK = re.compile(r"\]\(([^)]+)\)")


def _read(p):
    return Path(p).read_text(encoding="utf-8")


def entries(path):
    return [l for l in _read(path).splitlines() if l.startswith("- [")]


def frontmatter(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    return dict(re.findall(r"^[ \t]*(\w+):[ \t]*(.+)$", m.group(1), re.M)) if m else None


def check(wiki, lang="zh"):
    wiki = Path(wiki)
    sections, meta = LANGUAGES[lang]["sections"], LANGUAGES[lang]["meta"]
    errs, warns = [], []
    index = wiki / "MEMORY.md"
    if not index.exists():
        return ["MEMORY.md missing"], []
    lines = _read(index).splitlines()
    doms = entries(index)
    if len(lines) != len(doms):
        errs.append(f"MEMORY.md: only domain entry lines allowed ({len(lines) - len(doms)} other lines)")
    linked = {LINK.search(l).group(1).split("/")[0] for l in doms if LINK.search(l)}
    if len(linked - {"misc"}) > MAX_DOMAINS:
        errs.append(f"MEMORY.md: more than {MAX_DOMAINS} domains")
    errs += [f"MEMORY.md: line over {INDEX_LINE} chars: {l[:50]}" for l in doms if len(l) > INDEX_LINE]
    dirs = {p.name for p in wiki.iterdir() if p.is_dir() and not p.name.startswith(".")}
    errs += [f"{d}/: domain not listed in MEMORY.md" for d in sorted(dirs - linked)]
    for d in sorted(linked):
        readme = wiki / d / "README.md"
        if not readme.exists():
            errs.append(f"{d}/README.md missing")
            continue
        tops = entries(readme)
        if len(tops) > MAX_TOPICS:
            errs.append(f"{d}/README.md: {len(tops)} topics > {MAX_TOPICS}")
        errs += [f"{d}/README.md: line over {README_LINE} chars: {l[:50]}" for l in tops if len(l) > README_LINE]
        listed = {LINK.search(l).group(1) for l in tops if LINK.search(l)}
        pages = {p.name for p in (wiki / d).glob("*.md") if p.name != "README.md"}
        errs += [f"{d}/{p}: orphan page, not listed in {d}/README.md" for p in sorted(pages - listed)]
        errs += [f"{d}/README.md: links missing page {p}" for p in sorted(listed - pages)]
        for name in sorted(pages):
            text = _read(wiki / d / name)
            n_lines, n_chars = len(text.splitlines()), len(text)
            fm = frontmatter(text)
            if not fm or not {"name", "description", "scope"} <= fm.keys():
                errs.append(f"{d}/{name}: frontmatter needs name, description, scope")
            if n_lines > PAGE_LINES or n_chars > PAGE_CHARS:
                errs.append(f"{d}/{name}: {n_lines} lines / {n_chars} chars > {PAGE_LINES}/{PAGE_CHARS}; split or compress")
            elif max(n_lines / PAGE_LINES, n_chars / PAGE_CHARS) >= WARN:
                warns.append(f"{d}/{name}: near budget")
            body = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)
            for h in re.findall(r"^## (.+)$", body, re.M):
                if not h.startswith(sections):
                    errs.append(f"{d}/{name}: section '## {h}' not in {'/'.join(sections)}")
            for i, l in enumerate(body.splitlines(), 1):
                if len(l) > BODY_LINE:
                    errs.append(f"{d}/{name}: body line {i} over {BODY_LINE} chars")
                if meta.search(l):
                    errs.append(f"{d}/{name}: body line {i} has bookkeeping ('{meta.search(l).group()}')")
    errs += [f"{p.name}: top-level page" for p in wiki.glob("*.md") if p.name not in TOP_FILES]
    return errs, warns
