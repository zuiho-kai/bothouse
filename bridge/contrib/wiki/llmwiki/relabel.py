#!/usr/bin/env python3
"""Retag existing wiki lines with the four credibility classes (#1486).

Only two things change: a credibility marker at the end of a line — （推论）/（推测） — or a line that is plainly
superseded moved verbatim into its page's 「## 历史」. No other character of any line is touched.
Each page comes back through a mechanical check: stripping the marker must give the old line character for character,
and a moved line must appear verbatim in the history section; a page that fails either is not written.

Numbers: 4 workers, 3s..60s backoff, 4 retries, 300s request timeout — the wiki's ingest hits a per-minute request cap;
15 lines per call and max_tokens 6000 — measured: a whole page in one call spends 6k reasoning tokens and gets cut off,
15 lines spend about 1.3k and take about 11s.

  relabel.py --root ~/wiki --stats
  relabel.py --root ~/wiki --api-url https://host/v1/chat/completions --api-key KEY --model NAME
  relabel.py --root ~/wiki --limit 3 --dry-run
Environment instead of flags: RELABEL_API_URL, RELABEL_API_KEY, RELABEL_MODEL.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

WIKI = Path(os.environ.get("RELABEL_ROOT", "~/wiki")).expanduser().resolve()
OUT = Path(os.environ.get("RELABEL_OUT", str(WIKI.parent / (WIKI.name + ".relabel")))).expanduser()
API_URL = os.environ.get("RELABEL_API_URL", "")
API_KEY = os.environ.get("RELABEL_API_KEY", "")
MODEL = os.environ.get("RELABEL_MODEL", "")
# 4 workers: see the module docstring (measured)
WORKERS = int(os.environ.get("RELABEL_WORKERS", "4"))
# 15 lines per call, max_tokens: measured, see the module docstring
MAXTOK = 6000
# retries: see the module docstring
RETRIES = 4
CHUNK = 15

ROOT_FILES = {"MEMORY.md", "log.md", "CLAUDE.md"}
FRONT = re.compile(r"\A---\n.*?\n---\n", re.S)
STRUCTURE = re.compile(r"\s*(#|```|~~~|\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$|([-*_]\s*){3,}$)")
ENTRY = re.compile(r"\s*- \[[^\]]*\]\([^)]*\)")
FENCE = re.compile(r"^\s*(```|~~~)")
MARK = re.compile(r"(?:[。．.]\s*)?[（(](?:推论|推断|判断|推测|未核|未验证)[）)]\s*[。．.]?\s*$")
HIST = re.compile(r"^##\s*历史\s*$")
HEAD = re.compile(r"^##\s+")
USER_START = re.compile(r"^\s*[-*+]\s*(用户|用户原话|用户说|用户定|用户否|用户要)")
ALLOWED = {"推论", "推测"}

SYSTEM = """你在给一份长期记忆 wiki 的旧行补标可信度，只做补标，不改原文一个字。
默认不标。只标你有把握的行。
以下一律算事实，不标：
- 用户原话、用户定/否/要、约定、分活、规矩、流程、SOP、常驻做法（哪怕写成「A 负责 B」这种判断句）
- 亲眼核过的命令输出、数据、数字、有出处的结论
- 事故记录、发生了什么、谁做了什么
推论（行尾加「（推论）」）：写的人自己下的判断、归因、评价、预测、计划性结论，不是用户说的、也没有出处。
推测（行尾加「（推测）」）：明说没核过、听说、估计、大概、可能、疑似、效果未验证。
过时（整行挪进本页「## 历史」）：只认两种——行里自己写了被推翻（曾以为/已废弃/不再），或同页后文明确写着改成什么。
拿不准、四种都像、只是叙述或索引 → 不动。已经带标记的行不动。
只输出一个 JSON 对象，不要解释：
{"tag": {"<行号>": "推论"|"推测"}, "move": [<行号>...]}
行号是每行开头方括号里的数字；没有要动的行就输出 {"tag":{},"move":[]}。"""


def provider(args):
    if args.api_url and args.api_key:
        return args.api_url, args.api_key
    if API_URL and API_KEY:
        return API_URL, API_KEY
    raise SystemExit("set --api-url/--api-key (or RELABEL_API_URL/RELABEL_API_KEY) to an OpenAI-compatible endpoint")


def chat(url, key, messages, model=MODEL):
    body = json.dumps({"model": model, "messages": messages, "max_tokens": MAXTOK,
                       "temperature": 0}).encode()
    last = ""
    for i in range(RETRIES):
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + key})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:  # 300 秒：plan 第六节
                j = json.load(r)
            return j["choices"][0]["message"].get("content") or "", j.get("usage") or {}
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
            time.sleep(min(60, 3 * 2 ** i))  # 60、3 秒：plan 第六节退避
    raise RuntimeError(last)


def pages(root):
    for p in sorted(root.rglob("*.md")):
        rel = p.relative_to(root).as_posix()
        if rel in ROOT_FILES or p.name == "README.md":
            continue
        if rel.startswith("bin/") or any(x.startswith(".") for x in Path(rel).parts):
            continue
        yield p, rel


def is_content(path, line):
    if not line.strip() or STRUCTURE.match(line):
        return False
    return not (Path(path).name == "README.md" and ENTRY.match(line))


def body_of(text):
    """(lines, prefix) — lines after frontmatter; prefix is the frontmatter text to write back unchanged."""
    m = FRONT.match(text)
    if not m:
        return text.split("\n"), ""
    return text[m.end():].split("\n"), text[:m.end()]


def parse(text):
    """[(idx, line, section)] for content lines that may be tagged; idx = index in the body line list."""
    lines, _ = body_of(text)
    out, section, fence = [], "", False
    for i, l in enumerate(lines):
        if FENCE.match(l):
            fence = not fence
            continue
        if HEAD.match(l):
            section = l.strip()
            continue
        if fence or not is_content("page.md", l):
            continue
        if HIST.match(section):
            continue
        out.append((i, l, section))
    return out


def pending(text):
    return [(i, l, s) for i, l, s in parse(text) if not MARK.search(l) and not USER_START.match(l)]


def stats(root):
    n_pages = n_lines = n_chars = n_tagged = n_hist = 0
    for p, rel in pages(root):
        t = p.read_text(errors="ignore")
        n_pages += 1
        n_lines += len(parse(t))
        n_chars += sum(len(l) for _, l, _ in parse(t))
        n_tagged += sum(1 for _, l, _ in parse(t) if MARK.search(l))
        lines, _ = body_of(t)
        section = ""
        for l in lines:
            if HEAD.match(l):
                section = l.strip()
            elif HIST.match(section) and is_content(rel, l):
                n_hist += 1
    print(json.dumps({"pages": n_pages, "content_lines": n_lines, "chars": n_chars,
                      "already_tagged": n_tagged, "history_lines": n_hist,
                      "pending": n_lines - n_tagged}, ensure_ascii=False))


PROMPT_HEAD = """下面是一页记忆 wiki 的正文，每行前面方括号里是行号，## 开头的是分节。
按规则给需要补标的行出 JSON（只列要动的行，事实行不要列）。

页：{rel}

"""


def page_prompt(rel, text):
    lines, _ = body_of(text)
    numbered = "\n".join(f"[{i}] {l}" for i, l in enumerate(lines) if l.strip())
    return PROMPT_HEAD.format(rel=rel) + numbered


def parse_json(s):
    s = (s or "").strip()
    s = re.sub(r"\A```[a-z]*\n?|\n?```\Z", "", s).strip()
    try:
        return json.loads(s)
    except Exception:  # noqa: BLE001
        m = re.search(r"\{.*\}", s, re.S)
        if m:
            return json.loads(m.group(0))
        raise


COMMENT = re.compile(r"\s*(<!--.*?-->)\s*$")


def add_mark(line, typ):
    """行尾补「（推论）」；行尾有楼层/帖子注释时放注释前面，注释保持在行尾（lossless/lint 认它）。"""
    m = COMMENT.search(line)
    if m:
        return line[:m.start()] + f"（{typ}） " + m.group(1)
    return line + f"（{typ}）"


def apply_page(text, tags, moves):
    """(new_text, applied, problems). Tags {idx: type}; moves [idx]. Verifies mechanically."""
    lines, prefix = body_of(text)
    problems, applied = [], {"tag": 0, "move": 0}
    content = {i: l for i, l, _ in parse(text)}
    for i, typ in tags.items():
        if i not in content:
            problems.append(f"tag {i}: not a content line")
        elif typ not in ALLOWED:
            problems.append(f"tag {i}: bad type {typ}")
        elif MARK.search(lines[i]):
            problems.append(f"tag {i}: already tagged")
    for i in moves:
        if i not in content:
            problems.append(f"move {i}: not a content line")
    if problems:
        return text, applied, problems

    moved = set(moves)
    new = []
    for i, l in enumerate(lines):
        if i in moved:
            continue
        if i in tags:
            new.append(add_mark(l, tags[i]))
            if MARK.sub("", new[-1]) != MARK.sub("", l):
                problems.append(f"tag {i}: wording changed")
        else:
            new.append(l)

    if moves:
        hist_start = next((k for k, l in enumerate(new) if HIST.match(l)), None)
        block = [lines[i] for i in sorted(moves)]
        if hist_start is None:
            while new and not new[-1].strip():
                new.pop()
            new += ["", "## 历史"] + block + [""]
        else:
            end = next((k for k in range(hist_start + 1, len(new)) if HEAD.match(new[k])), len(new))
            while end > hist_start + 1 and not new[end - 1].strip():
                end -= 1
            new[end:end] = block
    newtext = prefix + "\n".join(new)
    if moves:
        hist = newtext[newtext.index("## 历史"):]
        for i in sorted(moves):
            if lines[i] not in hist.split("\n"):
                problems.append(f"move {i}: not verbatim in history")
    if problems:
        return text, applied, problems
    applied["tag"] = len(tags)
    applied["move"] = len(moves)
    return newtext, applied, []


def check_page(text, orig):
    """Every line removed from the old body must still exist — tagged in place or verbatim elsewhere."""
    old = body_of(orig)[0]
    new = body_of(text)[0]
    newset = set(new)
    stripped = {MARK.sub("", l) for l in new}
    return [l for l in old if l.strip() and l not in newset and MARK.sub("", l) not in stripped]


def result_path(rel):
    h = hashlib.sha1(rel.encode()).hexdigest()[:16]  # 16 位：防撞名
    return OUT / "results" / f"{h}.json"


def classify(url, key, rel, text, todo):
    """Chunked: 只让模型判这一小段行号，推理量小、不会截断。"""
    tags, moves, usage = {}, [], {}
    idx = {i for i, _, _ in todo}
    for k in range(0, len(todo), CHUNK):
        chunk = todo[k:k + CHUNK]
        nums = "、".join(str(i) for i, _, _ in chunk)
        prompt = page_prompt(rel, text) + f"\n\n只判这些行号：{nums}（别的行一律不要列）。"
        out, u = chat(url, key, [{"role": "system", "content": SYSTEM},
                                 {"role": "user", "content": prompt}])
        j = parse_json(out)
        tags.update({int(a): b for a, b in (j.get("tag") or {}).items() if int(a) in idx})
        moves += [int(x) for x in (j.get("move") or []) if int(x) in idx]
        for kk, vv in (u or {}).items():
            if isinstance(vv, int):
                usage[kk] = usage.get(kk, 0) + vv
    return tags, sorted(set(moves)), usage


def process(args, p, rel, url, key):
    rp = result_path(rel)
    text = p.read_text(errors="ignore")
    todo = pending(text)
    rec = {"rel": rel, "pending": len(todo), "tag": {}, "move": [], "usage": {}, "skip": ""}
    if not todo:
        rec["skip"] = "no pending lines"
    elif rp.exists():
        rec = json.loads(rp.read_text())
    else:
        try:
            tags, moves, usage = classify(url, key, rel, text, todo)
            rec.update({"tag": tags, "move": moves, "usage": usage, "raw_ok": True})
        except Exception as e:  # noqa: BLE001
            rec["skip"] = f"model failed: {e}"
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps(rec, ensure_ascii=False))
    if args.dry_run or rec["skip"]:
        return rec
    new, applied, problems = apply_page(text, {int(k): v for k, v in rec["tag"].items()}, rec["move"])
    if problems:
        rec["problems"] = problems
        rp.write_text(json.dumps(rec, ensure_ascii=False))
        return rec
    miss = check_page(new, text)
    if miss:
        rec["problems"] = [f"lost: {l[:60]}" for l in miss[:5]]  # 5 条：报错看头几条
        rp.write_text(json.dumps(rec, ensure_ascii=False))
        return rec
    if new != text:
        p.write_text(new)
    rec["applied"] = applied
    rp.write_text(json.dumps(rec, ensure_ascii=False))
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(WIKI))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--pages", default="")
    ap.add_argument("--workers", type=int, default=WORKERS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stats", action="store_true")
    global MODEL
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--api-url", default="")
    ap.add_argument("--api-key", default="")
    a = ap.parse_args()
    MODEL = a.model
    root = Path(a.root).resolve()
    out = Path(a.out).resolve()
    globals()["OUT"] = out
    if a.stats:
        return stats(root)
    url, key = provider(a)
    todo = list(pages(root))
    if a.pages:
        want = {x.strip() for x in a.pages.split(",") if x.strip()}
        todo = [(p, r) for p, r in todo if r in want]
    if a.limit:
        todo = todo[:a.limit]
    lock = threading.Lock()
    done = [0]
    t0 = time.time()

    def run(item):
        p, rel = item
        rec = process(a, p, rel, url, key)
        with lock:
            done[0] += 1
            if done[0] % 20 == 0:  # 20 页一次进度
                print(f"{done[0]}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
        return rec

    if a.workers <= 1:
        recs = [run(x) for x in todo]
    else:
        with ThreadPoolExecutor(a.workers) as ex:
            recs = list(ex.map(run, todo))
    tags = sum(int(r.get("applied", {}).get("tag", 0)) for r in recs)
    moves = sum(int(r.get("applied", {}).get("move", 0)) for r in recs)
    probs = [r for r in recs if r.get("problems")]
    skipped = [r for r in recs if r.get("skip")]
    ptok = sum((r.get("usage") or {}).get("prompt_tokens", 0) for r in recs)
    ctok = sum((r.get("usage") or {}).get("completion_tokens", 0) for r in recs)
    print(json.dumps({"pages": len(recs), "tagged": tags, "moved": moves,
                      "problems": len(probs), "skipped": len(skipped),
                      "prompt_tokens": ptok, "completion_tokens": ctok,
                      "seconds": round(time.time() - t0)}, ensure_ascii=False))
    if probs:
        for r in probs[:10]:  # 10 条：报错看头几条
            print("PROBLEM", r["rel"], r["problems"][:2], file=sys.stderr)
    if skipped:
        for r in skipped[:10]:  # 10 条：同上
            print("SKIP", r["rel"], r["skip"], file=sys.stderr)
    return 0 if not probs else 1


if __name__ == "__main__":
    sys.exit(main())
