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
import collections, importlib.util, math, os, re, sys
from pathlib import Path

def _load_scores():
    """Load the one shared forum ranker in a source checkout or a bothouse data directory."""
    configured = os.environ.get("WIKI_GATE_DIR")
    source = Path(__file__).resolve().parents[2] / "gate" / "forum_scores.py"
    path = Path(configured).expanduser() / "forum_scores.py" if configured else source
    if not path.exists():
        path = Path.home() / ".bothouse" / "gate" / "forum_scores.py"
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location("forum_scores", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


forum_scores = _load_scores()

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
    def __init__(self, root=WIKI, scored=False):
        self.root = Path(root)
        self.scored = bool(scored and forum_scores)
        self.lines, self.desc = [], {}
        for rel, txt in _pages(self.root):
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

    def search_pages(self, query, k=TOP):
        """Show the best line per page family, with its count and other matching pages."""
        hits = self.search(query, k=len(self.lines))
        per_page = collections.Counter(rel for rel, _, _ in hits)
        out, where = [], {}
        for rel, ln, text in hits:
            family = self.family(rel)
            if family not in where:
                if len(out) == k:
                    continue
                where[family] = len(out)
                out.append([rel, ln, text, per_page[rel], []])
            elif rel != out[where[family]][0] and rel not in out[where[family]][4]:
                out[where[family]][4].append(rel)
        if self.scored:
            out = forum_scores.rerank(out, self.root)
        return [tuple(row) for row in out]

    def family(self, rel):
        """Return the shortest same-directory page stem that owns this prefix family."""
        if not hasattr(self, "_fam"):
            stems = collections.defaultdict(set)
            for path in self.desc:
                directory, _, name = path.rpartition("/")
                stems[directory].add(name[:-3])
            self._fam = {}
            for path in self.desc:
                directory, _, name = path.rpartition("/")
                stem = name[:-3]
                roots = [candidate for candidate in stems[directory]
                         if stem == candidate or stem.startswith(candidate + "-")]
                base = min(roots, key=len)
                self._fam[path] = f"{directory}/{base}.md" if directory else f"{base}.md"
        return self._fam[rel]

    def candidates(self, text, k=TOP):
        """Return the page families most likely related to a transcript block."""
        return [self.family(rel) for rel, *_ in self.search_pages(text, k)]


def main():
    args, root = sys.argv[1:], WIKI
    if "--root" in args[:-1]:
        i = args.index("--root")
        root, args = Path(args[i + 1]).resolve(), args[:i] + args[i + 2:]
    q = " ".join(args)
    if not q.strip():
        sys.exit("usage: python3 ~/wiki/bin/search.py [--root DIR] <query>")
    idx = Index(root, scored=True)
    hits = idx.search_pages(q)
    if not hits:
        print("(no hits)")
    shown = "~/" + str(root.relative_to(Path.home())) if root.is_relative_to(Path.home()) else str(root)
    for rel, ln, text, count, family in hits:
        tag = forum_scores.label(forum_scores.entry_id(rel, text, root)) if idx.scored else ""
        more = f"；同族另有 {', '.join(Path(page).name for page in family)}" if family else ""
        print(f"{shown}/{rel}:{ln}  {tag}{text.strip()}\n    — {idx.desc[rel]}（本页命中 {count} 行{more}）")

if __name__ == "__main__":
    main()
