#!/usr/bin/env python3
"""记忆论坛页的数据（bothouse 管理页「记忆论坛」读 gate 的 GET /forum，就是这里的 data()）。

一条记忆 = 一楼回答：一句话标题、赞踩、分数、被推 / 引用次数、来源页、[#编号]。问同一件事的几楼归成一个帖子
（#1177，用户 11-07「一个帖子…下面的回答你可能是错，也可能是对，但是每一个回答他都可以有个权重」）：
归帖记在 wiki 行尾的楼层帖标注（forum_scores.TAG：所属帖子、楼层，一楼那行带标题和描述），编号按去掉标注的行算、旧票不变；
没有归帖表、或某楼不在表里时，这一楼自成一帖。帖子里的楼按同一个 forum_scores 排序，帖子按它最好那楼排。排序、折叠直接用同目录
forum_scores.py（Reddit best / Wilson 下界），不另写算法。推送与投票记录不全量列（用户 11-06 嫌推太多，
forum-decisions 定案），只按条汇总。

照搬自隔壁 vps-arm:/opt/overflow-site/forum.py（#1142 的静态页，用户 11-06 看截图说「这个做成产品」），
数字都沿用那份；路径改成产品的：
- 推送、票：gate 目录（同 memvote.EXP：MEMVOTE_DIR 或本文件所在目录）的 push.jsonl、votes.jsonl
- 页：主 wiki = GATE_WIKI（同 forum_scores.WIKI），「~/」开头的是 HOME 下别的库（角色 wiki）
- 推送时存的原文：<数据目录>/ctx/<哈希>.md（同 ctxsvc.store_dir），页改过也找得回当时那行
"""
import collections, hashlib, json, os, re, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import forum_scores as fs  # noqa: E402

EXP = Path(os.environ.get("MEMVOTE_DIR") or HERE)


def _ctx_dir():
    try:
        import datadir
        return Path(getattr(datadir, "guard", lambda p: p)(datadir.data_dir())) / "ctx"
    except ImportError:
        return None


def _jl(path):
    out = []
    try:
        for ln in path.read_text(encoding="utf-8").splitlines():
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
    except OSError:
        pass
    return out


def epoch(t):
    """记录里的时间是 gate 写的本机时间（ctxsvc.exp_log / memvote 用 time.strftime）→ 秒，网页按看的人的时区显示。"""
    try:
        return int(time.mktime(time.strptime(t, "%Y-%m-%d %H:%M:%S")))
    except (TypeError, ValueError):
        return 0


def _wiki_file(page):
    if page.startswith("~/"):
        return Path.home() / page[2:]
    if os.path.isabs(page):
        return Path(page)
    return fs.WIKI / page


class _Pages:
    """页的行和页头，一次请求内缓存。"""

    def __init__(self):
        self.lines, self.heads = {}, {}

    def get(self, page):
        if page not in self.lines:
            try:
                self.lines[page] = _wiki_file(page).read_text(encoding="utf-8", errors="ignore").splitlines()
            except OSError:
                self.lines[page] = []
        return self.lines[page]

    def head(self, page):
        """(页面标题, 页面描述)：标题取第一个「# 」行，描述取 frontmatter description（沿用 forum.py page_head 的前 40 行）。"""
        if page not in self.heads:
            ls = self.get(page)
            m = re.search(r"^description:\s*(.+)$", "\n".join(ls[:40]), re.M)  # 40 沿用 forum.py page_head
            t = next((x[2:].strip() for x in ls if x.startswith("# ")), "") or Path(page).stem
            self.heads[page] = (t, m.group(1).strip().strip('"') if m else "")
        return self.heads[page]


def _hid(s):
    # 同 forum_scores.entry_id 的行哈希；不走 entry_id，那条每次都解析一遍页路径，几千条推送下逐行调用要几十秒
    return hashlib.sha1(fs.bare(s).encode()).hexdigest()[:10]


def clean(line):
    """wiki 一行 → 读得懂的一句话：去掉列表符、「经验：」等前缀、粗体/代码记号、[[链接]] 方括号（同 ctxsvc._title）。"""
    t = re.sub(r"^[-*\s]+", "", fs.bare(line))
    t = re.sub(r"^(?:经验|用户定|助手定)[：:]\s*", "", t).replace("**", "").replace("`", "")
    return re.sub(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]", r"\1", t)


def is_item(line):
    """同 ctxsvc.is_item：标题行、太短的行不算一条记忆。"""
    s = line.strip()
    try:
        import ctxsvc
        return ctxsvc.is_item(line)
    except Exception:  # noqa: BLE001  ctxsvc 依赖没装全时退回同一条规则
        return bool(s) and not s.startswith("#")


def title_of(line):
    """帖子标题：第一句（到句号、分号为止），去掉句尾的（日期）括注；第一句太长在冒号、逗号处断开，其余进正文。
    长度 60 / 50 / 4 沿用 forum.py title_of（用户 11-06 看过这版标题）。"""
    t = clean(line)
    m = re.match(r"(.+?[。；;！!？?])(?=.)", t)
    head = m.group(1) if m else t
    if len(head) > 60:  # 60 沿用 forum.py title_of
        c = re.match(r"(.{4,50}?)[：:，,]", head)  # 4、50 沿用 forum.py title_of
        head = c.group(1) if c else head[:50]  # 50 沿用 forum.py title_of
    rest = t[len(head):].lstrip("。；;：:，, ")
    head = re.sub(r"\s*[（(][^（）()]*\d{4}-\d\d-\d\d[^（）()]*[）)]\s*$", "", head.rstrip("。；;"))
    return head, rest


def data():
    pages = _Pages()
    ctx = _ctx_dir()

    def stored(h):
        """推送时存的原文：首行「页:行号」，第二行是那条。"""
        if ctx is None:
            return ""
        try:
            ls = (ctx / f"{h}.md").read_text(encoding="utf-8").splitlines()
            return ls[1].strip() if len(ls) > 1 else ""
        except OSError:
            return ""

    texts = {}

    def text_of(cid):
        """编号 页#哈希 → (原文, 页里还在不在)。页里找不到就用推送时存下的原文。"""
        if cid not in texts:
            page, _, h = cid.partition("#")
            now = next((ln.strip() for ln in pages.get(page) if ln.strip() and _hid(ln) == h), "")
            texts[cid] = (now, True) if now else (stored(h), False)
        return texts[cid]

    def ref_id(r):
        """推送记录 refs 两种写法：新版 页:行#哈希；旧版 页:行（按现在那行算哈希）。"""
        m = re.match(r"^(.*?):(\d+)(?:#([0-9a-f]+))?$", r)
        if not m:
            return None
        page, n, h = m.group(1), int(m.group(2)), m.group(3)
        if not h:
            ls = pages.get(page)
            if not (0 < n <= len(ls)) or not ls[n - 1].strip():
                return None
            h = _hid(ls[n - 1])
        return f"{page}#{h}"

    pushes, votes = _jl(EXP / "push.jsonl"), _jl(EXP / "votes.jsonl")
    pushed, last = collections.Counter(), {}
    for p in pushes:
        for r in p.get("refs") or []:
            cid = ref_id(r)
            if cid:
                pushed[cid] += 1
                last[cid] = max(last.get(cid, ""), p.get("t", ""))
    cited = collections.Counter()
    voters = collections.defaultdict(collections.Counter)
    for v in votes:
        cid = v.get("id")
        if not cid:
            continue
        if v.get("by") == "self":
            cited[cid] += 1
        voters[cid]["outcome" if v.get("by") == "outcome" else f"self:{v.get('voter') or ''}"] += 1
        last[cid] = max(last.get(cid, ""), v.get("t", ""))

    ranked = sorted(set(pushed) | set(voters), key=lambda c: (fs.rank_key(c), -pushed[c], c))
    posts = []
    for cid in ranked:
        raw, alive = text_of(cid)
        if raw and not is_item(raw):
            continue  # 标题行等：推送修好前推过的，不当帖子
        page, _, h = cid.partition("#")
        title, rest = title_of(raw) if raw else ("", "")
        u, d = fs.counts(cid)
        pt, pd = pages.head(page)
        posts.append({"id": h, "title": title, "rest": rest, "page": page, "page_title": pt, "page_desc": pd,
                      "ups": u, "downs": d, "score": fs.confidence(u, d), "folded": fs.collapsed(cid),
                      "alive": alive, "pushed": pushed[cid], "cited": cited[cid], "last": epoch(last.get(cid, "")),
                      "voters": [{"who": k, "n": n} for k, n in voters[cid].most_common()]})
    tally = fs.tally()
    return {"threads": threads(posts), "on": (EXP / "push.jsonl").exists() or (EXP / "votes.jsonl").exists(),
            "rounds": len(pushes), "ups": sum(x[0] for x in tally.values()), "downs": sum(x[1] for x in tally.values()),
            "cited": sum(cited.values()), "last_vote": epoch(votes[-1].get("t", "")) if votes else 0,
            "posts": posts}


def _thread_table():
    """wiki 行尾的楼层帖标注（forum_scores.thread_table）→ {楼编号 页#哈希: (帖子编号, 标题, 描述, 楼号)}。"""
    return {f["id"]: (th["tid"], th.get("title", ""), th.get("desc", ""), f.get("floor", 0))
            for th in {id(t): t for t in fs.thread_table().values()}.values() for f in th.get("floors", [])}


def threads(posts):
    """帖子列表：每帖 {tid, title, desc, floors: [楼的 页#哈希…按票排], top, latest, …汇总}；posts 已按 forum_scores 排好，
    帖内保持这个顺序，帖子之间按最好那楼排（posts 里先出现的帖子在前）。每楼（posts 里那条）补上 tid 和楼号 floor
    （按时间的第几楼，一楼最早）。"""
    table = _thread_table()
    out, by = [], {}
    for p in posts:
        cid = f"{p['page']}#{p['id']}"
        tid, title, desc, floor = table.get(cid) or ("p" + _hid(cid), p["title"], "", 1)
        p["tid"], p["floor"] = tid, floor
        if tid not in by:
            by[tid] = {"tid": tid, "title": title or p["title"], "desc": desc, "floors": [], "_p": []}
            out.append(by[tid])
        by[tid]["floors"].append(cid)
        by[tid]["_p"].append(p)
    for th in out:
        fl = th.pop("_p")
        th["top"] = th["floors"][0]  # 最高分那楼
        th["latest"] = f"{(lt := max(fl, key=lambda f: f['floor']))['page']}#{lt['id']}"  # 楼号最大 = 最新一楼
        th["ups"], th["downs"] = sum(f["ups"] for f in fl), sum(f["downs"] for f in fl)
        th["pushed"], th["last"] = sum(f["pushed"] for f in fl), max(f["last"] for f in fl)
        th["alive"] = any(f["alive"] for f in fl)
    return out


if __name__ == "__main__":
    json.dump(data(), sys.stdout, ensure_ascii=False, indent=1)
