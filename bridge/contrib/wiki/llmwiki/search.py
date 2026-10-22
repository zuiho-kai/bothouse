#!/usr/bin/env python3 -I
"""One-shot fact search over every topic page of ~/wiki, line by line (BM25, lexical only, no model).

  python3 ~/wiki/bin/search.py <query>
  python3 ~/wiki/bin/search.py --root DIR <query>   search the wiki at DIR (a teammate's bin/search.py does this)

Prints the top lines as `path:line  text` plus that page's description. Hits come from any domain or
subdomain in one call, so finding a fact does not walk MEMORY.md → README → page.
Indexed: every page under a directory that has README.md (domains, subdomains at any depth).
Skipped: MEMORY.md / log.md / CLAUDE.md at the root, README.md, hidden dirs, bin/, frontmatter, and data
dirs without README.md (e.g. refs/media/, written by a script).
Tokenizer and scoring are the same as /tmp/wiki-retrieval-eval/bm25.py (report.md, 2026-10-18).
"""
import collections, math, re, sys
from pathlib import Path

WIKI = Path.home() / "wiki"
SHARED_TOOL = 1  # marker: this search.py takes --root; teammate/ shims refuse a tool without it
TOP = 10  # 来源：report.md 测的是「前 10 行含目标页」（46%），所以输出前 10 行
MIN_LINE = 6  # 沿用 report 的 bm25.py：短于 6 字的行（空行、标题碎片）不进索引
K1, B = 1.2, 0.75  # 沿用 report 的 bm25.py（BM25 常用默认值）


def toks(text):
    """中文按二字切分；英文取 >=2 字符的词；数字取 >=3 位（端口、IP 段、编号）。同 bm25.py。"""
    text = text.lower()
    out = []
    for s in re.findall(r"[一-鿿]+", text):
        out += [s[i:i + 2] for i in range(len(s) - 1)]
    out += re.findall(r"[a-z][a-z0-9_.\-]{1,}|\d{3,}", text)
    return out


def _pages(root):
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root)
        if len(rel.parts) < 2 or p.name == "README.md" or rel.parts[0] == "bin" \
                or any(x.startswith(".") for x in rel.parts):
            continue
        # 每一级目录都要有 README.md：没有的是脚本写的数据目录（如 refs/media/），不是子域
        if all((root.joinpath(*rel.parts[:i]) / "README.md").exists() for i in range(1, len(rel.parts))):
            yield rel.as_posix(), p.read_text(errors="ignore").split("\n")


class Index:
    def __init__(self, root=WIKI):
        self.lines, self.desc = [], {}
        for rel, txt in _pages(Path(root)):
            start = 0
            if txt and txt[0] == "---":
                for j in range(1, len(txt)):
                    if txt[j] == "---":
                        start = j + 1
                        break
            m = re.search(r"^description:\s*(.+)$", "\n".join(txt[:start]), re.M)
            self.desc[rel] = m.group(1).strip().strip('"') if m else ""
            for k in range(start, len(txt)):
                if len(txt[k].strip()) >= MIN_LINE:
                    self.lines.append((rel, k + 1, txt[k], toks(txt[k])))
        n = max(len(self.lines), 1)
        self.avg = sum(len(l[3]) for l in self.lines) / n or 1
        df = collections.Counter(t for l in self.lines for t in set(l[3]))
        self.idf = {t: math.log(1 + (n - c + .5) / (c + .5)) for t, c in df.items()}
        self.inv = collections.defaultdict(list)
        for i, l in enumerate(self.lines):
            for t, c in collections.Counter(l[3]).items():
                self.inv[t].append((i, c))

    def search(self, query, k=TOP):
        """Top k lines as (path relative to the wiki, 1-based line number, line text)."""
        sc = collections.defaultdict(float)
        for t in set(toks(query)):
            for i, c in self.inv.get(t, ()):
                dl = len(self.lines[i][3])
                sc[i] += self.idf[t] * c * (K1 + 1) / (c + K1 * (1 - B + B * dl / self.avg))
        top = sorted(sc.items(), key=lambda x: -x[1])[:k]
        return [self.lines[i][:3] for i, _ in top]


def main():
    args, root = sys.argv[1:], WIKI
    if "--root" in args[:-1]:
        i = args.index("--root")
        root, args = Path(args[i + 1]).resolve(), args[:i] + args[i + 2:]
    q = " ".join(args)
    if not q.strip():
        sys.exit("usage: python3 ~/wiki/bin/search.py [--root DIR] <query>")
    idx = Index(root)
    hits = idx.search(q)
    if not hits:
        print("(no hits)")
    shown = "~/" + str(root.relative_to(Path.home())) if root.is_relative_to(Path.home()) else str(root)
    for rel, ln, text in hits:
        print(f"{shown}/{rel}:{ln}  {text.strip()}\n    — {idx.desc[rel]}")

if __name__ == "__main__":
    main()
