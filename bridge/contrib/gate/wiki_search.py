"""wiki 的逐行 BM25 检索（纯词法，不用模型）：给 ctxsvc.py 找每轮相关的 wiki 页。

照搬 llm-wiki 作者本机 ~/wiki/bin/search.py 的分词和打分（公开的 zuiho-kai/llm-wiki 里还没有这个脚本），
只把 wiki 路径改成参数。适用 llm-wiki 的分层：每一级目录都有 README.md 的 *.md 才算 wiki 页。

    python3 wiki_search.py <wiki 目录> <查询>
"""
import collections, math, re, sys
from pathlib import Path

TOP = 10  # 来源：原 search.py，作者回放评测测的是「前 10 行含目标页」
MIN_LINE = 6  # 来源：原 search.py，短于 6 字的行（空行、标题碎片）不进索引
K1, B = 1.2, 0.75  # 来源：原 search.py（BM25 常用默认值）


def toks(text):
    """中文按二字切分；英文取 >=2 字符的词；数字取 >=3 位（端口、编号）。"""
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
        # 每一级目录都要有 README.md：没有的是脚本写的数据目录，不是子域
        if all((root.joinpath(*rel.parts[:i]) / "README.md").exists() for i in range(1, len(rel.parts))):
            yield rel.as_posix(), p.read_text(errors="ignore").split("\n")


class Index:
    def __init__(self, root):
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
        """前 k 行：(相对 wiki 的路径, 行号（从 1 起）, 原文)。"""
        sc = collections.defaultdict(float)
        for t in set(toks(query)):
            for i, c in self.inv.get(t, ()):
                dl = len(self.lines[i][3])
                sc[i] += self.idf[t] * c * (K1 + 1) / (c + K1 * (1 - B + B * dl / self.avg))
        top = sorted(sc.items(), key=lambda x: -x[1])[:k]
        return [self.lines[i][:3] for i, _ in top]


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: python3 wiki_search.py <wiki 目录> <查询>")
    idx = Index(Path(sys.argv[1]).expanduser())
    for rel, ln, text in idx.search(" ".join(sys.argv[2:])) or []:
        print(f"{rel}:{ln}  {text.strip()}\n    — {idx.desc[rel]}")
