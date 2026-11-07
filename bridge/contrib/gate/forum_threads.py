#!/usr/bin/env python3
"""记忆论坛楼层帖的归帖表 threads.json（#1177）：新内容先找同题帖跟楼，没有才开新帖；手工合帖、挪楼。

表在 gate 目录（forum_scores.threads_path，和 votes.jsonl 同目录），读它的是 forum_scores.thread_of（推送）和 forum_page（网页）。
wiki 行不加标记：加了行内容就变，编号（页#行哈希）和票全对不上。

  python3 forum_threads.py assign [--dry]     # 论坛里还不在表里的条（推过或投过票的）按页一批问模型：跟哪个帖，还是开新帖
  python3 forum_threads.py merge <帖A> <帖B…>  # 帖B… 的楼并进帖A，楼层按日期重排
  python3 forum_threads.py move <页#哈希> <帖|new>  # 一楼挪到别的帖，或单独开新帖（错归时用）

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
    try:
        return json.loads(fs.threads_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": 1, "threads": []}


def save(t):
    p = fs.threads_path()
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".threads-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(t, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, p)  # 推送和网页随时在读：整份换，不写半份


def key(s):
    return "t" + hashlib.sha1(s.encode()).hexdigest()[:10]  # 位数同 forum_scores.entry_id


def date_of(text):
    """楼的日期：行里第一个 年-月-日；只写月日的按今年（同 notes/forum-threads-1177/cluster.py date_of）。"""
    m = re.search(r"20\d\d-\d\d-\d\d", text)
    if m:
        return m.group(0)
    m = re.search(r"(?<![\d#/.-])(1[0-2]|0[1-9])-([0-3]\d)(?![\d-])", text)
    return f"2026-{m.group(1)}-{m.group(2)}" if m else ""  # 年份：wiki 记录全在 2026 年（cluster.py 数据实测）


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
    elif a[0] in ("merge", "move"):
        t = load()
        (merge(t, a[1], a[2:]) if a[0] == "merge" else move(t, a[1], a[2]))
        save(t)
    else:
        sys.exit(__doc__)
