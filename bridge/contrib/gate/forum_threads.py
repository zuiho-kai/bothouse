#!/usr/bin/env python3
"""记忆论坛楼层帖（#1177）：新内容先找同题帖跟楼，没有才开新帖；手工合帖、挪楼。

归帖就写在 wiki 行尾（forum_scores.TAG：<!-- 帖 t编号·N楼 -->，一楼那行另带 题「…」 述「…」），不另存表
（用户 11-07 定「存储仍用 wiki 页，只给行标帖子和楼层」）。编号、票按去掉标注后的行算，所以加标注不动旧票。
读它的是 forum_scores.thread_of（推送）和 forum_page（网页）。改了主 wiki 就提交。

  python3 forum_threads.py assign [--dry]     # 论坛里还不在表里的条（推过或投过票的）按页一批问模型：跟哪个帖，还是开新帖
  python3 forum_threads.py merge <帖A> <帖B…>  # 帖B… 的楼并进帖A，楼层按日期重排
  python3 forum_threads.py move <页#哈希> <帖|new>  # 一楼挪到别的帖，或单独开新帖（错归时用）
  python3 forum_threads.py import <旧 threads.json>  # 把旧版归帖表一次写进 wiki 行尾
  python3 forum_threads.py regroup <计划.json> [--limit N] [--page 页…]  # 按页把同一对象的帖并成一帖、起「[版块] 对象」标题，只出计划
  python3 forum_threads.py regroup-apply <计划.json>  # 照计划并帖、换标题，写回 wiki

用户原话（11-07）：「我可以不断的在上面加新回答，就可以减少我们的那个条目跟就是我们的那个帖子的数量」。
"""
import collections, hashlib, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import forum_scores as fs  # noqa: E402
import wiki_search  # noqa: E402

MODEL = os.environ.get("FORUM_THREADS_MODEL", "sonnet")  # 沿用第一次归帖（notes/forum-threads-1177/cluster.py MODEL）
BASE = os.environ.get("FORUM_THREADS_BASE", "")  # 设了就走这个 OpenAI 兼容口（本机 magpie 号池跑 DS，不花钱：用户 11-25「用ds去做，不要钱」）
ASK_TIMEOUT = 600  # 一批最多等 10 分钟：接口挂住时不让夜间任务一直不退（#1891 agentm 上旧网关挂住实测）
CANDS = wiki_search.TOP  # 每条给模型看的候选帖数：沿用 wiki_search 前 TOP 行

# 归帖照 NGA 集中贴（用户 11-24「标题应该是一个功能，一个项目，一个模块」「标题应该类似知乎nga论坛的样子」）：
# NGA 标题「[集中贴,另开锁删]12.0 至暗之夜 ROLL职业专用」「[心得] 12.1.5…攻略」——方括号版块 + 对象，同一对象只一帖、另开的并回。
STYLE = """标题写成「[版块] 对象」：版块是它属于的项目或大功能，对象是具体的功能、模块、版本或角色名。
只写名词，不写问句，不带结论，不写「现在/是否/怎么/每轮有啥」这类话（结论在楼里，会变；标题不变）。
例：「[bothouse 发版] v0.1.43」「[注入] 小日子页」「[记忆论坛] 票和评分」「[外出定时] 龙娘「想想瑞凤」」。"""

PROMPT = """记忆论坛照 NGA 集中贴：一个帖讲一个功能 / 项目 / 模块，下面每楼是关于它的一条说法（新说法、更正、补充都跟在同一帖，
新的会把旧的顶下去）。一个对象只开一帖。
下面每条新记忆后面列了几个候选帖（同页的帖排在前面）。新记忆讲的对象候选帖里已经有了，就跟那帖（thread 填它的序号），
哪怕问的角度不同；候选帖里没有这个对象，才开新帖：thread 填 null，并给新帖起标题和一句描述（这帖管什么，不写结论）。
""" + STYLE + """
同一批里几条新记忆讲同一个对象、又没有候选帖可跟的，给它们填同一个新标题。
只输出 JSON：{{"assign":[{{"item":<新记忆序号>,"thread":<候选帖序号或 null>,"title":"<thread 为 null 时填>","desc":"<同上>"}}]}}

{items}"""

REGROUP = """记忆论坛要照 NGA 集中贴重新归帖：一个帖讲一个功能 / 项目 / 模块，同一对象的说法都在同一帖的楼里。
下面是 wiki 页「{page}」上现有的帖（一题一问的旧标题，后面是几楼）。把讲同一个对象的帖分成一组并成一帖，给每组起新标题和一句描述。
""" + STYLE + """
每个帖都要出现在且只出现在一组里；讲的对象确实不同的各自一组。
只输出 JSON：{{"groups":[{{"threads":[<帖序号>…],"title":"<新标题>","desc":"<这帖管什么>"}}]}}

{items}"""


def load():
    return {"version": 2, "threads": fs.scan()}


def _clean(x):
    return re.sub(r"\s+", " ", (x or "").replace("-->", "->")).strip()


def title_for(th, line):
    """帖子标题写回前重算（#1187）：从一楼原文截出来的标题（是原文开头一段，不是模型起的问句）按 forum_page.title_of 重截，
    这样括号、引号、网址、时间里不会断开；模型起的标题原样留。"""
    import forum_page
    title = th.get("title") or ""
    text = forum_page.clean(line).strip() if line else ""
    if title and text.startswith(title.rstrip("。；;：:，, ")) and not (title.endswith(("？", "?")) and forum_page._paired(title)):
        return forum_page.title_of(line)[0] or title
    return title


def tag_of(th, f, line=""):
    t = f" <!-- 帖 {th['tid']}·{f['floor']}楼"
    if f["floor"] == 1 and (th.get("title") or th.get("desc")):
        t += f" 题「{_clean(title_for(th, line))}」" + (f" 述「{_clean(th['desc'])}」" if th.get("desc") else "")
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
            want[f["id"]] = (th, f)
    # #1263（11-09）：06:00 这里给 108 页加了标注，提交被 pre-commit 无损检查拒（拒的是别人留在同页的未提交改动），
    # check=False 没吭声，108 页改动一直留在主 wiki，wiki 整理的结果合不回去、卡了 101 个会话。
    # 现在：主 wiki 里有别人未提交改动的页这次不标（下次再标）；提交被拒就把本次写的页原样换回，主 wiki 不留半成品。
    dirty = set()
    if (fs.WIKI / ".git").exists():
        d = subprocess.run(["git", "-C", str(fs.WIKI), "-c", "core.quotepath=off", "diff", "--name-only", "HEAD"],
                           capture_output=True, text=True)
        dirty = set(d.stdout.splitlines())
    changed, held = [], []
    for r, p, page, lines in pages:
        if r == fs.WIKI and p.relative_to(r).as_posix() in dirty:
            held.append(p.relative_to(r).as_posix())
            continue
        out = []
        for line in lines:
            b = fs.bare(line)
            if not b:
                out.append(line)
                continue
            body = fs.TAG.sub("", line)
            tag = want.get(f"{page}#{hashlib.sha1(b.encode()).hexdigest()[:10]}", "")
            if tag:
                tag = tag_of(*tag, line)  # 一楼的标题按这行原文重算（title_for）
            out.append(body + tag if (tag or fs.TAG.search(line)) else line)
        if out != lines:
            fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".ft-", suffix=".md")
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write("\n".join(out))
            os.replace(tmp, p)  # 整页换，推送和网页不读到半页
            changed.append((r, p, "\n".join(lines), "\n".join(out)))
    if held:
        print(f"skip {len(held)} page(s) with someone's uncommitted edits in the main wiki (tagged next run): "
              + ", ".join(held[:10]), file=sys.stderr)
    main = [(p, old, new) for r, p, old, new in changed if r == fs.WIKI]
    if main and (fs.WIKI / ".git").exists():
        names = [p.relative_to(fs.WIKI).as_posix() for p, _, _ in main]
        subprocess.run(["git", "-C", str(fs.WIKI), "add", "--", *names], check=False)
        c = subprocess.run(["git", "-C", str(fs.WIKI), "commit", "-q", "-m", f"forum: 楼层帖标注 {len(main)} 页（#1177 forum_threads）",
                            "--", *names], capture_output=True, text=True)
        if c.returncode:
            undone = 0
            for p, old, new in main:
                if p.read_text(encoding="utf-8") == new:  # 只换回本次写的，写后又被人改过的不动
                    p.write_text(old, encoding="utf-8")
                    undone += 1
            subprocess.run(["git", "-C", str(fs.WIKI), "reset", "-q", "--", *names], check=False)
            print(f"COMMIT REFUSED, {undone}/{len(main)} main-wiki page(s) put back as they were: "
                  + (c.stderr or c.stdout).strip()[-600:], file=sys.stderr)
            main = []
    fs._tcache.clear()
    print(json.dumps({"pages_changed": len(changed), "main_wiki": len(main), "held": len(held)}, ensure_ascii=False), file=sys.stderr)


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
    if BASE:
        import urllib.error
        import urllib.request
        body = {"model": MODEL, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": "你只输出 JSON。"}, {"role": "user", "content": prompt}]}
        if os.environ.get("FORUM_THREADS_EFFORT"):  # DS 默认想很久（一页 4–5 分钟），批量归帖压低
            body["reasoning_effort"] = os.environ["FORUM_THREADS_EFFORT"]
        req = urllib.request.Request(BASE.rstrip("/") + "/chat/completions", headers={"Content-Type": "application/json"},
                                     data=json.dumps(body).encode())
        for n in range(6):  # 号池 key 按分钟限次数（429，约 1 分钟恢复）：等一分钟再试，不当失败（#1978 全量 8 并发撞满 125 页）
            try:
                with urllib.request.urlopen(req, timeout=ASK_TIMEOUT) as r:
                    txt = json.load(r)["choices"][0]["message"]["content"]
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or n == 5:
                    raise
                time.sleep(65)
            except TimeoutError as e:
                raise subprocess.TimeoutExpired("ask", ASK_TIMEOUT) from e
        return json.loads(re.search(r"\{.*\}", txt, re.S).group(0)), 0.0
    r = subprocess.run([os.environ.get("CLAUDE_BIN", "claude"), "-p", "--model", MODEL, "--output-format", "json", "--tools", "",
                        "--system-prompt", "你只输出 JSON。", "--setting-sources", ""],
                       input=prompt, capture_output=True, text=True, cwd=tempfile.gettempdir(), timeout=ASK_TIMEOUT)
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
            pg = cid.partition("#")[0]  # 同页的帖排前面（页 = 版块，同一对象多半在同页，#1978）
            best = sorted(range(len(cands)), key=lambda j: (pg not in cands[j].get("pages", ()),
                                                            -len(g & sig[j]) / (len(sig[j]) ** .5 or 1)))[:CANDS]
            menu.append(best)
            lines = "\n".join(f"  {n}. {cands[j]['title']} —— {cands[j].get('desc', '')}" for n, j in enumerate(best, 1))
            blocks.append(f"新记忆 {i}：{text[cid]}\n候选帖：\n{lines}")
        try:
            res, c = ask(PROMPT.format(items="\n\n".join(blocks)))
        except subprocess.TimeoutExpired:  # 接口挂住：后面各批也会挂，停下，已归的照写，剩下的下次再来
            print("TIMEOUT", chunk[0], file=sys.stderr)
            break
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


def regroup(out, limit=0, only=None):
    """一次性重新归帖（#1978）：每页一批，把同页讲同一对象的帖并成一帖、换成「[版块] 对象」标题。
    只写计划到 out（不改 wiki）；看过再 regroup-apply。limit = 只跑前几页（试跑），only = 只跑这些页。
    每跑完一页就落盘，out 里已有的页跳过（中断后重跑接着来）；FORUM_THREADS_JOBS 页并发。"""
    import forum_page
    from concurrent.futures import ThreadPoolExecutor, as_completed
    posts = {f"{p['page']}#{p['id']}": p for p in forum_page.data()["posts"]}
    t = load()
    by_page = collections.defaultdict(list)
    for th in t["threads"]:
        if th["floors"]:
            by_page[th["floors"][0]["id"].partition("#")[0]].append(th)  # 帖归一楼所在的页
    pages = sorted(by_page, key=lambda pg: -len(by_page[pg]))
    if only:
        pages = [pg for pg in pages if pg in only]
    if limit:
        pages = pages[:limit]
    plan = json.loads(Path(out).read_text(encoding="utf-8")) if Path(out).exists() else []
    done = {g["page"] for g in plan}
    todo = [pg for pg in pages if pg not in done]

    def one(pg):
        ths = by_page[pg]
        items = "\n".join(f"{i}. {th.get('title') or ''} —— {th.get('desc') or ''}（{len(th['floors'])} 楼："
                          + "；".join((posts.get(f["id"]) or {}).get("title", "")[:40] for f in th["floors"][:3]) + "）"
                          for i, th in enumerate(ths, 1))
        res, c = ask(REGROUP.format(page=pg, items=items))
        got, seen = [], set()
        for g in res.get("groups", []):
            nums = [i for i in g.get("threads", []) if isinstance(i, int) and 1 <= i <= len(ths) and i not in seen]
            seen.update(nums)
            if nums and g.get("title"):
                got.append({"page": pg, "tids": [ths[i - 1]["tid"] for i in nums], "title": g["title"],
                            "desc": g.get("desc") or "", "old": [ths[i - 1].get("title", "") for i in nums]})
        return got, c

    cost, fail = 0.0, 0
    with ThreadPoolExecutor(int(os.environ.get("FORUM_THREADS_JOBS") or 1)) as ex:
        futs = {ex.submit(one, pg): pg for pg in todo}
        for fu in as_completed(futs):
            try:
                got, c = fu.result()
            except Exception as e:  # noqa: BLE001  这页失败就跳过，重跑时补
                fail += 1
                print("FAIL", futs[fu], type(e).__name__, e, file=sys.stderr)
                continue
            cost += c
            plan += got
            tmp = Path(str(out) + ".tmp")
            tmp.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, out)
            print("page", len({g["page"] for g in plan}), futs[fu], len(by_page[futs[fu]]), "->", len(got), flush=True)
    print(json.dumps({"pages": len(pages), "done": len({g["page"] for g in plan} & set(pages)), "fail": fail,
                      "groups": len(plan), "cost": round(cost, 3)}, ensure_ascii=False))


def regroup_apply(src):
    """照 regroup 的计划并帖、换标题，写回 wiki（save 只改有变化的页，主 wiki 提交，原行一字不动，只换行尾标注）。"""
    plan = json.loads(Path(src).read_text(encoding="utf-8"))
    t = load()
    by = {th["tid"]: th for th in t["threads"]}
    n = 0
    for g in plan:
        ids = [x for x in g["tids"] if x in by]
        if not ids:
            continue
        if len(ids) > 1:
            merge(t, ids[0], ids[1:])
            for x in ids[1:]:
                by.pop(x, None)
        by[ids[0]]["title"], by[ids[0]]["desc"] = g["title"], g["desc"]
        n += 1
    save(t)
    print(json.dumps({"groups_applied": n, "threads_after": len(t["threads"])}, ensure_ascii=False))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "assign":
        assign(dry="--dry" in a)
    elif a[0] == "regroup":  # regroup <计划.json> [--limit N] [--page 页…]
        lim = int(a[a.index("--limit") + 1]) if "--limit" in a else 0
        only = a[a.index("--page") + 1:] if "--page" in a else None
        regroup(a[1], lim, only)
    elif a[0] == "regroup-apply":
        regroup_apply(a[1])
    elif a[0] == "import":
        old = json.loads(Path(a[1]).read_text(encoding="utf-8"))
        save({"threads": old["threads"]})
    elif a[0] in ("merge", "move"):
        t = load()
        (merge(t, a[1], a[2:]) if a[0] == "merge" else move(t, a[1], a[2]))
        save(t)
    else:
        sys.exit(__doc__)
