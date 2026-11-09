#!/usr/bin/env python3 -I
"""No-forgetting check (SOP v2, 2026-10-25): every content line of the old wiki must still be in the new wiki, word for
word, on some page. log.md is not a page: search.py does not index it, so a line moved there could not be found —
that is forgetting. A line the writer no longer holds true goes to its own page's 「## 历史」 section, unchanged; log.md
only records 「旧路径 → 新路径」. Exit 1 and list the missing lines.

  lossless.py OLD [NEW]          OLD/NEW: a git revision of the wiki or a directory; NEW defaults to the working tree
  lossless.py --root DIR OLD [NEW]   the wiki at DIR (a teammate's wiki; revisions are read from DIR's git)

Content line: a body line of any *.md below a domain (hidden dirs and bin/ skipped; the root files MEMORY.md, log.md,
CLAUDE.md are not memory pages and count on neither side), stripped. Not content: blank lines, headings
(#…), frontmatter, code fences / table rules / horizontal rules (STRUCTURE), index lines — every line of MEMORY.md and a
README's `- [name](target) — …` entries (ingest rewrites them with the page). Link targets are compared without the
target (`](x)` → `]()`, `[[x]]` → `[[]]`): a page that moved or merged has its links repointed, its words stay.
Whole lines, not substrings: "X 已启用" → "X 已启用的说法有误" must keep the old line somewhere (as ingest's unkept()).
A line the writer no longer holds true goes to its page's 「## 历史」 section, unchanged.
"""
import re, subprocess, sys
from pathlib import Path

WIKI = Path(__file__).resolve().parent.parent
SHARED_TOOL = 1  # marker: this lossless.py takes --root; teammate/ shims refuse a tool without it
SHOW = 20  # 沿用已有配置：ingest.py compress_check / review_check 报错只列 lost[:20]
ROOT_FILES = {"MEMORY.md", "log.md", "CLAUDE.md"}  # wiki-root files, not memory pages
FRONT = re.compile(r"\A---\n.*?\n---\n", re.S)
# the same structural-line test as ingest.py STRUCTURE (headings, fences, table rules, horizontal rules)
STRUCTURE = re.compile(r"\s*(#|```|~~~|\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$|([-*_]\s*){3,}$)")
ENTRY = re.compile(r"\s*- \[[^\]]*\]\([^)]*\)")
MDLINK = re.compile(r"\]\([^)]*\)")
WIKILINK = re.compile(r"\[\[[^\]]*\]\]")
FLOOR_TAG = re.compile(r"\s*<!-- 帖 t[0-9a-f]{10}·\d+楼.*?-->\s*$")  # 论坛楼层帖标注（同 lint.FLOOR_TAG）：元数据，改标题、楼号不算丢内容


def norm(line):
    return WIKILINK.sub("[[]]", MDLINK.sub("]()", FLOOR_TAG.sub("", line).strip()))


def kept_split(line, pages):
    """`line` split into consecutive whole lines of one page (lint.wrap()): equal without bullet markers and spaces."""
    flat = lambda l: re.sub(r"\s+", "", re.sub(r"^(?:[-*+]|\d+[.)])\s+", "", l))
    f = flat(line)
    for ls in pages:
        cuts, text = {0}, ""
        for l in ls:
            text += flat(l)
            cuts.add(len(text))
        i = text.find(f)
        while f and i >= 0:
            if i in cuts and i + len(f) in cuts:
                return True
            i = text.find(f, i + 1)
    return False


def is_content(path, line):
    if not line.strip() or STRUCTURE.match(line):
        return False
    return not (Path(path).name == "README.md" and ENTRY.match(line))


def content(path, text):
    """The normalized content lines of one file (`path` relative to the wiki)."""
    if path in ROOT_FILES:  # search.py indexes none of them
        return []
    return [norm(l) for l in FRONT.sub("", text).splitlines() if is_content(path, l)]


def wanted(rel):
    parts = Path(rel).parts
    return rel.endswith(".md") and parts[0] != "bin" and not any(p.startswith(".") for p in parts)


def corpus(src, root=None):
    """{path: text} of every *.md: `src` is a directory, a git revision of `root`, or None (root's working tree)."""
    root = Path(root or WIKI)
    d = Path(src) if src and Path(src).is_dir() else (root if src is None else None)
    if d is not None:
        return {p.relative_to(d).as_posix(): p.read_text(errors="ignore") for p in d.rglob("*.md")
                if wanted(p.relative_to(d).as_posix())}
    names = [n for n in subprocess.run(["git", "-c", "core.quotepath=off", "ls-tree", "-r", "--name-only", src],
                                       cwd=root, capture_output=True, text=True, check=True).stdout.splitlines() if wanted(n)]
    blob = subprocess.run(["git", "cat-file", "--batch"], cwd=root, capture_output=True, check=True,
                          input="".join(f"{src}:{n}\n" for n in names).encode()).stdout
    out, i = {}, 0
    for n in names:  # --batch: "<sha> blob <size>\n<bytes>\n" per object, in order
        j = blob.index(b"\n", i)
        size = int(blob[i:j].split()[2])
        out[n] = blob[j + 1:j + 1 + size].decode(errors="ignore")
        i = j + 1 + size + 1
    return out


def missing(old, new):
    """[(path, line)] for every content line of `old` ({path: text}) found on no page of `new`. A file whose text is
    unchanged is skipped (its lines are trivially there)."""
    pages = [content(p, t) for p, t in new.items()]
    have = {l for ls in pages for l in ls}
    out = []
    for p, t in old.items():
        if new.get(p) == t:
            continue
        seen = set()
        for l in content(p, t):
            if l not in have and l not in seen:
                seen.add(l)
                if not kept_split(l, pages):
                    out.append((p, l))
    return out


def lost(old_text, new_text, path="page.md"):
    """Content lines of one file's old text missing from its new text, original wording (stripped), in order: what a
    script that rewrites a page must put back (its 「## 历史」 section; never log.md) before writing."""
    have = set(content(path, new_text))
    out, seen = [], set()
    for l in FRONT.sub("", old_text).splitlines():
        n = norm(l)
        if is_content(path, l) and n not in have and n not in seen:
            seen.add(n)
            if not kept_split(n, [content(path, new_text)]):
                out.append(l.strip())
    return out


def report(miss, limit=SHOW):
    """The error text for missing lines ("" when none)."""
    if not miss:
        return ""
    more = f"\n… {len(miss) - limit} more" if len(miss) > limit else ""
    return (f"LOSSLESS: {len(miss)} old line(s) are on no page any more — nothing is forgotten: put each back verbatim "
            "(a line no longer true goes to its page's 「## 历史」 section, unchanged):\n"
            + "\n".join(f"{p}: {l}" for p, l in miss[:limit]) + more)


def main(argv):
    root = WIKI
    if "--root" in argv[:-1]:
        i = argv.index("--root")
        root, argv = Path(argv[i + 1]).resolve(), argv[:i] + argv[i + 2:]
    if not 1 <= len(argv) <= 2:
        sys.exit(__doc__)
    old = corpus(argv[0], root)
    new = corpus(argv[1] if len(argv) == 2 else None, root)
    miss = missing(old, new)
    print(report(miss, limit=len(miss)) or f"lossless ok ({sum(len(content(p, t)) for p, t in old.items())} lines checked)")
    return 1 if miss else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
