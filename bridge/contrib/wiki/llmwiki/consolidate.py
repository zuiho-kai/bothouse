#!/usr/bin/env python3 -I
"""Mechanical wiki consolidation (SOP v2, 2026-10-25). No model: page lines are moved, never rewritten.

  consolidate.py [--root DIR] [--families] [--cross] [--flatten] [--sections] [--commit] [--skip PATH ...]
      --skip PATH: a page (wiki-relative) left exactly as it is — someone's uncommitted edit lives on it: no merge,
      move or relink writes it, and no README it is listed in is rewritten (repeatable)
      no step flag = --cross --families --flatten --families (the one-off pass); nightly runs --families only

Steps:
  families  X.md absorbs X-*.md in the same directory (the slices split_pass cut from one topic), deepest name first,
            while the merged page stays within lint's page budget. Each child's lines go under its section of X.md
            behind a `### 原页 <child>` heading; a top-level bullet already on X.md word for word is kept once.
  cross     two subdomain directories with the same name in different places, every page of both naming that topic
            (e.g. misc/stocks/soxl and refs/markets/soxl), become one: the one more pages link to keeps it; the other's
            parent README keeps a line saying where it went.
  flatten   a subdomain deeper than lint.MAX_DEPTH moves up into its parent (deepest first), when the parent README
            stays within lint.MAX_TOPICS entries. When none can (parents full), the shallowest over-depth subdomain is
            lifted whole, unchanged, one level up as a sibling of its parent (grandparent README must have room), and
            flattening is tried again.
  sections  a page with two `## ` headings of one name (written twice by ingest or a split) keeps the first; the later
            ones' lines join it, in order, verbatim (lint reports such a page).
A dissolved subdomain's README lines join the README it moved into, verbatim; log.md records only 「旧路径 → 新路径」
(it is not searched, so no content line goes there). Links ([[name]] and relative markdown links on pages) are repointed. Before anything is kept, lossless.py (old HEAD vs new tree) and lint.py must
pass, else the tree is reset (the tree must be clean before a run). log.md gets one `restructure | consolidate` entry
listing every 「旧路径 → 新路径」.
"""
import os, posixpath, re, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lint, lossless  # noqa: E402

WIKI = Path(__file__).resolve().parent.parent
SHARED_TOOL = 1  # marker: this consolidate.py takes --root; teammate/ shims refuse a tool without it
LINK = lint.LINK
MDLINK = re.compile(r"(\]\()([^)\s]+)(\))")
HEAD = re.compile(r"## (.+)$")


def git(root, *args):
    return subprocess.run(["git", "-c", "core.quotepath=off", *args], cwd=root, capture_output=True, text=True)


class Run:
    """One consolidation over the wiki at `root`: file moves tracked so links and log.md can be written at the end."""

    def __init__(self, root, frozen=()):
        self.root = Path(root)
        self.frozen = set(frozen)  # --skip: pages no step may write, move or delete
        self.dest = {}    # original path → current path (a merged page → the page that absorbed it)
        self.origin = {}  # current path → original path
        self.log = []     # log.md lines
        self.merged = {}  # child stem → parent stem (for [[links]])

    # ---- bookkeeping
    def frozen_in(self, d):
        """A --skip page is in directory `d` (or below), or is d's README."""
        return any(f.startswith(d + "/") for f in self.frozen)

    def cur(self, rel):
        return self.dest.get(rel, rel)

    def moved(self, old, new):
        o = self.origin.pop(old, old)
        self.origin[new] = o
        for k, v in list(self.dest.items()):
            if v == old:
                self.dest[k] = new
        self.dest[o] = new

    def gone_into(self, old, new):
        """`old` (current path) no longer exists; its content now lives in `new`."""
        o = self.origin.pop(old, old)
        for k, v in list(self.dest.items()):
            if v == old:
                self.dest[k] = new
        self.dest[o] = new

    def text(self, rel):
        return (self.root / rel).read_text()

    def write(self, rel, text):
        (self.root / rel).write_text(text)

    # ---- README entries
    def readme_drop(self, d, target):
        """Remove the entry of `d`/README.md linking `target`; returns the removed line ("" if none)."""
        rel = f"{d}/README.md"
        lines = self.text(rel).split("\n")
        hit = [i for i, l in enumerate(lines) if l.startswith("- [") and LINK.search(l) and LINK.search(l).group(1) == target]
        if not hit:
            return ""
        line = lines.pop(hit[0])
        self.write(rel, "\n".join(lines))
        return line

    def readme_add(self, d, entries):
        rel = f"{d}/README.md"
        self.write(rel, self.text(rel).rstrip("\n") + "\n" + "\n".join(entries) + "\n")

    # ---- families
    def families(self, limit=None):
        n = 0
        for d in lint.tree(self.root):
            n += self.families_in(d, limit)
        return n

    def families_in(self, d, limit=None):
        stems = {p.stem for p in (self.root / d).glob("*.md") if p.name != "README.md"}
        n = 0
        for s in sorted(stems, key=lambda x: (-len(x), x)):  # deepest name first: a child holds its own children
            parents = [m for m in stems if m != s and s.startswith(m + "-")]
            if not parents or s not in stems:
                continue
            p = max(parents, key=len)
            if {f"{d}/{p}.md", f"{d}/{s}.md", f"{d}/README.md"} & self.frozen:
                continue
            merged = merge_pages(self.text(f"{d}/{p}.md"), self.text(f"{d}/{s}.md"), s)
            if not fits(merged, limit):
                continue
            self.write(f"{d}/{p}.md", merged)
            (self.root / d / f"{s}.md").unlink()
            self.gone_into(f"{d}/{s}.md", f"{d}/{p}.md")
            self.merged[s] = p
            self.readme_drop(d, f"{s}.md")  # an index line (not content); the child's description heads its block
            self.log.append(f"- 合并 {d}/{s}.md → {d}/{p}.md")
            stems.discard(s)
            n += 1
        return n

    # ---- duplicate sections
    def sections(self):
        """Every page (not --skip) with a `## ` heading twice gets one section per name (merge_sections)."""
        n = 0
        for d in lint.tree(self.root):
            for p in sorted((self.root / d).glob("*.md")):
                rel = f"{d}/{p.name}"
                if p.name == "README.md" or rel in self.frozen:
                    continue
                t = p.read_text()
                new = merge_sections(t)
                if new != t:
                    p.write_text(new)
                    self.log.append(f"- 合并重复节 {rel}")
                    n += 1
        return n

    # ---- moving a directory's contents
    def move_contents(self, src, dst):
        """Move every entry of directory `src` (README.md aside) into `dst`. Returns False (nothing moved) on a name
        collision."""
        if self.frozen_in(src) or {f"{dst}/README.md", f"{posixpath.dirname(src)}/README.md"} & self.frozen:
            return False  # a --skip page would move, or a README listing one would be rewritten
        names = [p.name for p in (self.root / src).iterdir() if p.name != "README.md"]
        if any((self.root / dst / n).exists() for n in names):
            return False
        for n in names:
            old = self.root / src / n
            files = [f for f in ([old] if old.is_file() else old.rglob("*")) if f.is_file()]
            rels = [f.relative_to(self.root).as_posix() for f in files]
            os.rename(old, self.root / dst / n)
            for r in rels:
                new = dst + "/" + r[len(src) + 1:]
                self.moved(r, new)
                self.log.append(f"- 移动 {r} → {new}")
        return True

    def dissolve(self, src, dst, pointer=None):
        """`src` (a subdomain, contents already moved to `dst`) goes away: its entries and its other content lines
        (verbatim) join dst's README; its entry in its parent README is dropped (or replaced by `pointer`). log.md only
        gets the paths: it is not searched, so no content line may go there."""
        readme = self.text(f"{src}/README.md").split("\n")
        entries = [l for l in readme if l.startswith("- [")]
        notes = [l for l in readme if not l.startswith("- [") and lossless.is_content(f"{src}/README.md", l)]
        self.readme_add(dst, entries + notes)
        (self.root / src / "README.md").unlink()
        self.gone_into(f"{src}/README.md", f"{dst}/README.md")
        parent, name = posixpath.split(src)
        line = self.readme_drop(parent, f"{name}/README.md") if parent else ""
        if line and pointer:
            self.readme_add(parent, [pointer + (" — " + line.split(" — ", 1)[1] if " — " in line else "")])
        try:
            (self.root / src).rmdir()
        except OSError:
            pass

    # ---- flatten
    def flatten(self, max_depth=None):
        max_depth = max_depth or lint.MAX_DEPTH
        n, skipped = 0, set()
        while True:
            deep = [d for d in lint.tree(self.root) if d.count("/") + 1 > max_depth and d not in skipped]
            if not deep:
                return n, sorted(skipped)
            d = max(deep, key=lambda x: (x.count("/"), x))
            parent = posixpath.dirname(d)
            room = lint.MAX_TOPICS - len(lint.entries(self.root / parent / "README.md")) + 1
            if len(lint.entries(self.root / d / "README.md")) > room or not self.move_contents(d, parent):
                skipped.add(d)  # its parent README would go over MAX_TOPICS, or a name collides
                if not [x for x in deep if x not in skipped] and self.lift(max_depth):
                    n, skipped = n + 1, set()  # the lifted tree is shallower: try flattening its children again
                continue
            self.dissolve(d, parent)
            self.log.append(f"- 压平 {d}/ → {parent}/")
            n += 1

    def lift(self, max_depth):
        """No over-depth directory can be flattened (its parent README is full): move the shallowest over-depth one,
        whole and unchanged, up one level as a sibling of its parent. Its entry moves from the parent README to the
        grandparent README verbatim (the relative link `<name>/README.md` stays right). True if one was lifted."""
        deep = sorted((d for d in lint.tree(self.root) if d.count("/") + 1 > max_depth), key=lambda x: (x.count("/"), x))
        for d in deep:
            parent = posixpath.dirname(d)
            gp, name = posixpath.dirname(parent), posixpath.basename(d)
            target = f"{gp}/{name}" if gp else name
            if self.frozen_in(d) or {f"{parent}/README.md", f"{gp}/README.md"} & self.frozen:
                continue  # a --skip page would move, or a README listing one would be rewritten
            if not gp or (self.root / target).exists() or len(lint.entries(self.root / gp / "README.md")) >= lint.MAX_TOPICS:
                continue  # top-level domains are MEMORY.md's business; a name collides; the grandparent is full too
            files = [f for f in (self.root / d).rglob("*") if f.is_file()]
            rels = [f.relative_to(self.root).as_posix() for f in files]
            os.rename(self.root / d, self.root / target)
            for r in rels:
                self.moved(r, target + r[len(d):])
            line = self.readme_drop(parent, f"{name}/README.md")
            if line:
                self.readme_add(gp, [line])
            self.log.append(f"- 上移 {d}/ → {target}/（整个目录，内容不改）")
            return True
        return False

    # ---- cross-directory same topic
    def cross_pairs(self):
        dirs = [d for d in lint.tree(self.root) if "/" in d]
        by = {}
        for d in dirs:
            by.setdefault(posixpath.basename(d), []).append(d)
        out = []
        for name, ds in sorted(by.items()):
            ds = [d for d in ds if not any(o != d and (d.startswith(o + "/") or o.startswith(d + "/")) for o in ds)]
            ok = [d for d in ds if self.about(d, name)]
            if len(ok) > 1:
                out.append((name, ok))
        return out

    def about(self, d, name):
        """Every page of `d` (and below) has `name` as a word of its file name: the directory is that topic."""
        pages = [p for p in (self.root / d).rglob("*.md") if p.name != "README.md"]
        return bool(pages) and all(name in p.stem.split("-") for p in pages)

    def refs(self, d):
        """Links into `d` from pages outside it: [[name]] of its pages plus relative markdown links resolving into it."""
        stems = {p.stem for p in (self.root / d).rglob("*.md") if p.name != "README.md"}
        n = 0
        for p in self.root.rglob("*.md"):
            rel = p.relative_to(self.root).as_posix()
            if rel.startswith(d + "/") or not lossless.wanted(rel) or rel == "log.md":
                continue
            t = p.read_text(errors="ignore")
            n += sum(1 for w in lint.WIKILINK.findall(t) if w.split("|")[0] in stems)
            n += sum(1 for _, tg, _ in MDLINK.findall(t)
                     if posixpath.normpath(posixpath.join(posixpath.dirname(rel), tg.split("#")[0])).startswith(d + "/"))
        return n

    def cross(self):
        n = 0
        for name, ds in self.cross_pairs():
            ranked = sorted(ds, key=lambda d: (-self.refs(d), d.count("/"), d))
            keep = ranked[0]
            for other in ranked[1:]:
                room = lint.MAX_TOPICS - len(lint.entries(self.root / keep / "README.md"))
                if len(lint.entries(self.root / other / "README.md")) > room or not self.move_contents(other, keep):
                    self.log.append(f"- 未合并 {other}/ → {keep}/（{keep}/README.md 放不下或重名）")
                    continue
                self.dissolve(other, keep, pointer=f"- 原子域 {name}/ 已并入 {keep}/")
                self.log.append(f"- 同主题合并 {other}/ → {keep}/（{keep} 被引用更多）")
                n += 1
        return n

    # ---- links
    def relink(self):
        """[[child]] → [[parent]] everywhere; relative markdown links on pages repointed to where their target is now."""
        for p in sorted(self.root.rglob("*.md")):
            rel = p.relative_to(self.root).as_posix()
            if not lossless.wanted(rel) or rel in ("log.md", "MEMORY.md", "CLAUDE.md") or rel in self.frozen:
                continue
            t = p.read_text()
            new = lint.WIKILINK.sub(lambda m: self.wikilink(m.group(1)), t)
            if p.name != "README.md":  # README entries were moved with their targets; pages may have moved too
                new = MDLINK.sub(lambda m: m.group(1) + self.mdlink(rel, m.group(2)) + m.group(3), new)
            if new != t:
                p.write_text(new)

    def wikilink(self, inner):
        name, bar, alias = inner.partition("|")
        seen = set()
        while name in self.merged and name not in seen:
            seen.add(name)
            name = self.merged[name]
        return f"[[{name}{bar}{alias}]]"

    def mdlink(self, rel, target):
        if re.match(r"[a-z]+:|#|/|~", target):
            return target
        path, hash_, anchor = target.partition("#")
        o = self.origin.get(rel, rel)
        src = posixpath.normpath(posixpath.join(posixpath.dirname(o), path))
        if src not in self.dest and o == rel:
            return target
        now = self.dest.get(src, src)
        out = posixpath.relpath(now, posixpath.dirname(rel))
        return out + hash_ + anchor

    def finish(self, label):
        self.relink()
        if self.log:
            with open(self.root / "log.md", "a") as f:
                f.write(f"\n## [{time.strftime('%Y-%m-%d')}] restructure | {label}\n" + "\n".join(self.log) + "\n")


# ---- page merge
def parse(text):
    m = lossless.FRONT.match(text)
    fm = m.group(0) if m else ""
    pre, order, secs, cur = [], [], {}, None
    fence = False
    for l in text[len(fm):].split("\n"):
        h = None if fence else HEAD.match(l)
        if l.lstrip().startswith(("```", "~~~")):
            fence = not fence
        if h:
            key = next((s for s in lint.SECTIONS if h.group(1).startswith(s)), h.group(1))
            if key not in secs:
                order.append(key)
                secs[key] = [l, []]
            elif l.strip() != secs[key][0].strip():  # 「## 现状（10-25）」 after 「## 现状（10-23）」: one section, label kept
                secs[key][1] += ["", "#" + l.strip()]
            cur = key
            continue
        (secs[cur][1] if cur else pre).append(l)
    desc = re.search(r"^description:\s*(.+)$", fm, re.M)
    return fm, pre, order, secs, desc.group(1).strip().strip('"') if desc else ""


def merge_sections(text):
    """`text` with each `## ` heading once: a later heading of the same name (word for word, outside code fences) is
    dropped and its lines join the first one's section, in order. Lines are only moved, never changed."""
    m = lossless.FRONT.match(text)
    fm = m.group(0) if m else ""
    pre, order, secs, cur, fence, n = [], [], {}, None, False, 0
    for l in text[len(fm):].split("\n"):
        h = not fence and l.startswith("## ")
        n += h
        if l.lstrip().startswith(("```", "~~~")):
            fence = not fence
        if h:
            cur = l.rstrip()
            if cur not in secs:
                order.append(cur)
                secs[cur] = []
            elif trim(secs[cur]):
                secs[cur] = trim(secs[cur]) + [""]
            continue
        (secs[cur] if cur else pre).append(l)
    if len(order) == n:
        return text  # no duplicate: untouched
    out = [fm.rstrip("\n")] if fm else []
    out += trim(pre)
    for k in order:
        out += ["", k] + trim(secs[k])
    return "\n".join(out).rstrip("\n") + "\n"


def trim(lines):
    while lines and not lines[0].strip():
        lines = lines[1:]
    while lines and not lines[-1].strip():
        lines = lines[:-1]
    return lines


def dedup(lines, have):
    """Drop a top-level bullet already on the page word for word (only one without indented lines under it, outside
    code fences): the line stays once, so nothing is lost."""
    out, fence = [], False
    for i, l in enumerate(lines):
        if l.lstrip().startswith(("```", "~~~")):
            fence = not fence
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if not fence and l.startswith("- ") and l.strip() in have and not nxt.startswith((" ", "\t")):
            continue
        out.append(l)
    return out


def merge_pages(parent, child, child_name):
    """`parent` text with `child`'s body moved in: per section, the child's lines under `### 原页 <child>`."""
    pfm, ppre, porder, psecs, _ = parse(parent)
    _, cpre, corder, csecs, cdesc = parse(child)
    have = {l.strip() for l in parent.split("\n") if l.strip()}
    blocks = {}
    intro = [l for l in cpre if not l.startswith("# ")]
    first = True
    for key in ["现状"] + [k for k in corder if k != "现状"]:
        lines = trim((intro if key == "现状" else []) + (csecs[key][1] if key in csecs else []))
        lines = trim(dedup(lines, have))
        if not lines:
            continue
        head = csecs[key][0][3:] if key in csecs else key
        suffix = head[len(key):] if head.startswith(key) else ""
        title = f"### 原页 {child_name}{suffix}" + (f"：{cdesc}" if first and cdesc else "")
        first = False
        blocks[key] = [title] + lines
        have |= {l.strip() for l in lines}
    out = [pfm.rstrip("\n")] if pfm else []
    out += trim(ppre)
    order = porder + [k for k in lint.SECTIONS if k in blocks and k not in porder] \
        + [k for k in blocks if k not in porder and k not in lint.SECTIONS]
    for key in order:
        head = psecs[key][0] if key in psecs else f"## {key}"
        body = trim(psecs[key][1]) if key in psecs else []
        out += ["", head] + body
        if key in blocks:
            out += ([""] if body else []) + blocks[key]
    return "\n".join(out).rstrip("\n") + "\n"


def fits(text, limit=None):
    """Default: strictly below lint.SPLIT_AT of the page budget, the line ingest's split_pass splits at (≥); a merge up
    to 100% would be split again the same night and its X-*.md parts merged back next time (merge/split churn)."""
    if limit:
        lines, chars = limit
        return len(text.splitlines()) <= lines and len(text) <= chars
    return (len(text.splitlines()) < lint.PAGE_LINES * lint.SPLIT_AT and
            len(text) < lint.PAGE_CHARS * lint.SPLIT_AT)


# ---- check and keep
def check(root, base="HEAD"):
    """lossless (base vs the tree) and lint; "" when both pass."""
    miss = lossless.missing(lossless.corpus(base, root), lossless.corpus(None, root))
    errs, _, _ = lint.check(Path(root))
    return "\n".join(e for e in (lossless.report(miss), "\n".join(errs[:lossless.SHOW])) if e)


def reset(root):
    git(root, "reset", "-q", "--hard", "HEAD")
    git(root, "clean", "-fdq")


def consolidate(root, steps=("families",), label="consolidate", commit=False, limit=None, skip=()):
    """Run `steps` on the clean git tree at `root`; keep the result only if check() passes. Returns (ok, summary)."""
    root = Path(root)
    if git(root, "status", "--porcelain", "--untracked-files=normal").stdout.strip():
        return False, "tree not clean; consolidate runs on a committed tree only"
    r = Run(root, skip)
    counts = {}
    for s in steps:
        if s == "families":
            counts[s] = counts.get(s, 0) + r.families(limit)
        elif s == "cross":
            counts[s] = r.cross()
        elif s == "sections":
            counts[s] = r.sections()
        elif s == "flatten":
            counts[s], skipped = r.flatten()
            if skipped:
                r.log.append(f"- 未压平（父 README 放不下或重名）：{', '.join(skipped)}")
    if not r.log:
        return True, "nothing to do"
    r.finish(label)
    errs = check(root)
    if errs:
        reset(root)
        return False, errs
    if commit:
        git(root, "add", "-A")
        git(root, "commit", "-qm", f"restructure: {label}")
    return True, ", ".join(f"{k} {v}" for k, v in counts.items())


def main(argv):
    root = WIKI
    if "--root" in argv[:-1]:
        i = argv.index("--root")
        root, argv = Path(argv[i + 1]).resolve(), argv[:i] + argv[i + 2:]
    skip = [argv[i + 1] for i, a in enumerate(argv[:-1]) if a == "--skip"]
    steps = [s[2:] for s in argv if s in ("--families", "--cross", "--flatten", "--sections")] or ["cross", "families", "flatten", "families"]
    ok, summary = consolidate(root, steps, commit="--commit" in argv, skip=skip)
    print(("ok: " if ok else "REVERTED: ") + summary)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
