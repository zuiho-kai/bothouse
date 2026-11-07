#!/usr/bin/env python3
"""记忆论坛楼层帖（#1177）：新内容先找同题帖跟楼，没有才开新帖；手工合帖、挪楼。

归帖就写在 wiki 行尾（forum_scores.TAG：<!-- 帖 t编号·N楼 -->，一楼那行另带 题「…」 述「…」），不另存表
（用户 11-07 定「存储仍用 wiki 页，只给行标帖子和楼层」）。编号、票按去掉标注后的行算，所以加标注不动旧票。
读它的是 forum_scores.thread_of（推送）和 forum_page（网页）。改了主 wiki 就提交。

  python3 forum_threads.py assign [--dry]     # 论坛里还不在表里的条（推过或投过票的）按页一批问模型：跟哪个帖，还是开新帖
  python3 forum_threads.py merge <帖A> <帖B…>  # 帖B… 的楼并进帖A，楼层按日期重排
  python3 forum_threads.py move <页#哈希> <帖|new>  # 一楼挪到别的帖，或单独开新帖（错归时用）
  python3 forum_threads.py import <旧 threads.json>  # 把旧版归帖表一次写进 wiki 行尾

用户原话（11-07）：「我可以不断的在上面加新回答，就可以减少我们的那个条目跟就是我们的那个帖子的数量」。
"""
import collections, hashlib, json, os, re, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import forum_scores as fs  # noqa: E402
import wiki_search  # noqa: E402

MODEL = os.environ.get("FORUM_THREADS_MODEL", "sonnet")  # 沿用第一次归帖（notes/forum-threads-1177/cluster.py MODEL）
CANDS = wiki_search.TOP  # 每条给模型看的候选帖数：沿用 wiki_search 前 TOP 行

PROMPT = """记忆论坛里一个帖子问一件事，下面多楼是对这件事的不同回答（新说法、更正、补充都跟在同一帖）。
下面每条新记忆后面列了几个候选帖。新记忆问的是候选帖里同一件事的，就跟那帖（thread 填它的序号）；
只是话题相近、问的不是同一件事的，不要硬跟：thread 填 null，并给新帖一个简短的问题式标题（以「？」结尾）和一句描述（讨论什么，不写结论）。
同一批里几条新记忆问的是同一件事、又没有候选帖可跟的，给它们填同一个新标题。
只输出 JSON：{{"assign":[{{"item":<新记忆序号>,"thread":<候选帖序号或 null>,"title":"<thread 为 null 时填>","desc":"<同上>"}}]}}

{items}"""


def load():
    return {"version": 2, "threads": fs.scan()}


def _clean(x):
    return re.sub(r"\s+", " ", (x or "").replace("-->", "->")).strip()


def tag_of(th, f):
    t = f" <!-- 帖 {th['tid']}·{f['floor']}楼"
    if f["floor"] == 1 and (th.get("title") or th.get("desc")):
        t += f" 题「{_clean(th.get('title'))}」" + (f" 述「{_clean(th['desc'])}」" if th.get("desc") else "")
    return t + " -->"


def save(t):
    """把归帖写回 wiki 行尾：表里的楼加（或换）标注，不在表里的去掉标注；只改有变化的页，主 wiki 的改动提交。"""
    pages = []
    for r, p in fs.md_files():
        try:
            pages.append((r, p, fs.page_key(p.relative_to(r).as_posix(), r), p.read_text(encoding="utf-8").split("\n")))
        except (OSError, UnicodeDecodeError):
            continue
    live = {f"{pg}#{hashlib.sha1(fs.bare(x).encode()).hexdigest()[:10]}" for _, _, pg, ls in pages for x in ls if x.strip()}
    want = {}
    for th in t["threads"]:  # 页里已没有的楼（改写过、挪走的行）不留；剩下的按原顺序重排楼号，标题跟着一楼走
        fl = [dict(f) for f in sorted(th["floors"], key=lambda f: f.get("floor", 0)) if f["id"] in live]
        for n, f in enumerate(fl, 1):
            f["floor"] = n
            want[f["id"]] = tag_of(th, f)
    changed = []
    for r, p, page, lines in pages:
        out = []
        for line in lines:
            b = fs.bare(line)
            if not b:
                out.append(line)
                continue
            body = fs.TAG.sub("", line)
            tag = want.get(f"{page}#{hashlib.sha1(b.encode()).hexdigest()[:10]}", "")
            out.append(body + tag if (tag or fs.TAG.search(line)) else line)
        if out != lines:
            fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".ft-", suffix=".md")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write("\n".join(out))
            os.replace(tmp, p)  # 整页换，推送和网页不读到半页
            changed.append((r, p))
    main = [p.relative_to(fs.WIKI).as_posix() for r, p in changed if r == fs.WIKI]
    if main and (fs.WIKI / ".git").exists():
        subprocess.run(["git", "-C", str(fs.WIKI), "add", "--", *main], check=False)
        subprocess.run(["git", "-C", str(fs.WIKI), "commit", "-q", "-m", f"forum: 楼层帖标注 {len(main)} 页（#1177 forum_threads）", "--", *main],
                       check=False)
    fs._tcache.clear()
    print(json.dumps({"pages_changed": len(changed), "main_wiki": len(main)}, ensure_ascii=False), file=sys.stderr)


def key(s):
    return "t" + hashlib.sha1(s.encode()).hexdigest()[:10]  # 位数同 forum_scores.entry_id


date_of = fs.date_of


def pages_of(th):
    return sorted({f["id"].partition("#")[0] for f in th["floors"]})


def renumber(th):
    """楼层按时间：最早的是一楼，没日期的排最后（"~" 比数字大）。"""
    th["floors"].sort(key=lambda f: (f.get("date") or "~", f.get("floor", 0)))
    for n, f in enumerate(th["floors"], 1):
        f["floor"] = n
    th["pages"] = pages_of(th)


def merge(t, into, others):
    by = {th["tid"]: th for th in t["threads"]}
    for o in others:
        by[into]["floors"] += by[o]["floors"]
        t["threads"].remove(by[o])
    renumber(by[into])


def move(t, cid, to):
    by = {th["tid"]: th for th in t["threads"]}
    src = next(th for th in t["threads"] if any(f["id"] == cid for f in th["floors"]))
    f = next(f for f in src["floors"] if f["id"] == cid)
    src["floors"].remove(f)
    if src["floors"]:
        renumber(src)
    else:
        t["threads"].remove(src)
    if to == "new":
        dst = {"tid": key(cid), "title": "", "desc": "", "floors": []}
        t["threads"].append(dst)
    else:
        dst = by[to]
    dst["floors"].append(f)
    renumber(dst)


def grams(s):
    s = re.sub(r"\s+", "", s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def ask(prompt):
    r = subprocess.run([os.environ.get("CLAUDE_BIN", "claude"), "-p", "--model", MODEL, "--output-format", "json", "--tools", "",
                        "--system-prompt", "你只输出 JSON。", "--setting-sources", ""],
                       input=prompt, capture_output=True, text=True, cwd=tempfile.gettempdir())
    j = json.loads(r.stdout)
    m = re.search(r"\{.*\}", j.get("result", ""), re.S)
    return json.loads(m.group(0)), j.get("total_cost_usd", 0)


def assign(dry=False):
    import forum_page
    posts = {f"{p['page']}#{p['id']}": p for p in forum_page.data()["posts"]}
    t = load()
    have = {f["id"] for th in t["threads"] for f in th["floors"]}
    new = [cid for cid, p in posts.items() if cid not in have and (p["title"] or p["rest"])]
    text = {cid: (p["title"] + "。" + p["rest"]).strip("。") for cid, p in posts.items()}
    cands = [th for th in t["threads"] if th.get("title")]
    sig = [grams(th["title"] + th.get("desc", "") + "".join(posts[f["id"]]["title"] for f in th["floors"] if f["id"] in posts))
           for th in cands]  # 帖子的字面：标题 + 描述 + 各楼标题
    by_page = collections.defaultdict(list)
    for cid in new:
        by_page[cid.partition("#")[0]].append(cid)  # 按页一批，同 cluster.py 第一次归帖
    joined = opened = 0
    cost = 0.0
    for chunk in by_page.values():
        menu, blocks = [], []
        for i, cid in enumerate(chunk, 1):
            g = grams(text[cid])
            best = sorted(range(len(cands)), key=lambda j: -len(g & sig[j]) / (len(sig[j]) ** .5 or 1))[:CANDS]
            menu.append(best)
            lines = "\n".join(f"  {n}. {cands[j]['title']} —— {cands[j].get('desc', '')}" for n, j in enumerate(best, 1))
            blocks.append(f"新记忆 {i}：{text[cid]}\n候选帖：\n{lines}")
        try:
            res, c = ask(PROMPT.format(items="\n\n".join(blocks)))
        except Exception as e:  # noqa: BLE001  这批失败就留到下次，不写半份
            print("FAIL", chunk[0], e, file=sys.stderr)
            continue
        cost += c
        done, fresh = set(), {}
        for a in res.get("assign", []):
            i, n = a.get("item"), a.get("thread")
            if not isinstance(i, int) or not 1 <= i <= len(chunk) or i in done:
                continue
            done.add(i)
            cid = chunk[i - 1]
            if isinstance(n, int) and 1 <= n <= len(menu[i - 1]):
                th = cands[menu[i - 1][n - 1]]
                joined += 1
            elif (a.get("title") or "") in fresh:
                th = fresh[a["title"]]
                joined += 1
            else:
                th = {"tid": key(cid), "title": a.get("title") or posts[cid]["title"], "desc": a.get("desc") or "", "floors": []}
                t["threads"].append(th)
                cands.append(th)
                sig.append(grams(th["title"] + th["desc"] + posts[cid]["title"]))
                fresh[th["title"]] = th
                opened += 1
            nxt = max((f["floor"] for f in th["floors"]), default=0) + 1  # 新说法跟在最后一楼
            th["floors"].append({"floor": nxt, "id": cid, "date": date_of(text[cid])})
            th["pages"] = pages_of(th)
    if not dry:
        save(t)
    print(json.dumps({"new": len(new), "joined": joined, "opened": opened, "cost": round(cost, 3), "dry": dry}, ensure_ascii=False))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "assign":
        assign(dry="--dry" in a)
    elif a[0] == "import":
        old = json.loads(Path(a[1]).read_text(encoding="utf-8"))
        save({"threads": old["threads"]})
    elif a[0] in ("merge", "move"):
        t = load()
        (merge(t, a[1], a[2:]) if a[0] == "merge" else move(t, a[1], a[2]))
        save(t)
    else:
        sys.exit(__doc__)
