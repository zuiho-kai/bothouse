#!/usr/bin/env python3
"""记忆论坛的排序：所有读入口共用一份（gate 推送 ctxsvc、search.py、终端 wiki-context hook、角色 wiki 的 search.py --root）。
低分条沉底、折叠，不隐藏；手动搜一定搜得到。写票不在这里，在同目录 memvote.py。

照抄的来源（不自创；2026-11-01 从 github.com/reddit-archive/reddit master 下载核对行号）：
- 排序 = Reddit 评论默认的 confidence（best）排序：r2/r2/lib/db/_sorts.pyx:70-85 `_confidence(ups, downs)`，
  Wilson 下界，80% 置信，n 为零返回零。
- 新条自带 1 个赞：r2/r2/models/link.py:1374 `Comment(_ups=1, …)`（作者自投）。
- 折叠 = r2/r2/models/link.py:1808 `elif item.score < min_score: item.collapsed = True`（「comment score below
  threshold」），score 为赞减踩（来源 r2/r2/lib/db/thing.py:681 `_score`），默认阈值来源 r2/r2/models/account.py:87
  pref_min_comment_score。折叠只收起正文，条目照样在列表里（沉底），点开（读原页那一行）就能看。
- 改票、撤票照 Stack Overflow，由 memvote.py 实现；这里只读它的记录。

票从哪来（赞、踩分开数，Wilson 要两个数）：
- 只认外部信号：votes.jsonl 里 by=outcome 的行（score_night.py 写：被引用那轮用户下一句不是纠正 +1、是纠正 -1，
  照 MemOS mem_feedback），逐行累加成赞、踩，交给下面同一个 Wilson 排序和折叠阈值。
- 角色自报的 by=self 只是「引用」记录（照 ACE Generator 自报 bullet_ids），不算赞；模型代投（night、legacy_votes.json
  等）不再算票。
votes.jsonl 和 scores.json 在同一目录：默认本文件所在目录（bothouse 装的 gate 目录），FORUM_SCORES 指向别的 scores.json 时取它旁边的。
条目编号同 ctxsvc.exp_id：页 + 这行内容的 sha1 前 10 位；主 wiki 的页用相对路径，别的库（角色 wiki）用 ~/ 开头的全路径。
分数所有角色、所有频道共用一份。"""
import hashlib, json, math, os, re
from pathlib import Path

HOME = Path.home()
WIKI = Path(os.environ.get("GATE_WIKI") or "~/wiki").expanduser()  # 主 wiki，同 ctxsvc.WIKI
SELF_UPS = 1  # 来源 reddit link.py:1374 _ups=1
MIN_SCORE = -4  # 来源 reddit account.py:87 pref_min_comment_score
Z = 1.281551565545  # 来源 reddit _sorts.pyx:78（80% confidence）
_cache = {}


def path():
    """分数表：gate 目录的 scores.json（memvote 写在那）。终端 hook 装的这份在 <数据目录>/hooks，读旁边 gate/ 的同一份。"""
    if os.environ.get("FORUM_SCORES"):
        return Path(os.environ["FORUM_SCORES"]).expanduser()
    here = Path(__file__).resolve().parent
    return (here.parent / "gate" if here.name == "hooks" else here) / "scores.json"


def _mtime(p):
    try:
        return p.stat().st_mtime
    except OSError:
        return None


def tally():
    """{编号: [赞, 踩]}（真投的票，不含自带的那个赞）。两份文件按修改时间重读。"""
    d = path().parent
    votes = d / "votes.jsonl"
    stamp = (votes, _mtime(votes))
    if _cache.get("stamp") == stamp:
        return _cache["data"]
    out = {}  # 只认外部信号（by=outcome）；角色自报（by=self）是引用，模型代投（night、legacy）不算票
    try:
        for ln in votes.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(ln)
            except ValueError:
                continue
            if r.get("by") == "outcome" and r.get("vote") in (1, -1):  # 一行一次成功/失败，累加
                out.setdefault(r.get("id"), [0, 0])[0 if r["vote"] == 1 else 1] += 1
    except OSError:
        pass
    _cache.update(stamp=stamp, data=out)
    return out


def confidence(ups, downs):
    """来源 reddit r2/r2/lib/db/_sorts.pyx:70-85，原样照抄。"""
    n = ups + downs
    if n == 0:
        return 0
    z = Z
    p = float(ups) / n
    left = p + 1 / (2 * n) * z * z
    right = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    under = 1 + 1 / n * z * z
    return (left - right) / under


def counts(cid):
    """(赞, 踩)，赞里含新条自带的那个（reddit link.py:1374）。"""
    u, d = tally().get(cid, (0, 0))
    return u + SELF_UPS, d


def collapsed(cid):
    u, d = counts(cid)
    return u - d < MIN_SCORE  # 来源 reddit link.py:1808


def rank_key(cid):
    """排序键：没折叠的在前，再按 confidence 从高到低（reddit 评论 best 排序）。sorted 是稳定的，同分保持相关度原序。"""
    return (collapsed(cid), -confidence(*counts(cid)))


def label(cid):
    """折叠条的标注（推送、搜索结果里显示）；没折叠的返回空串。"""
    u, d = counts(cid)
    return f"【低分·已折叠 赞{u} 踩{d}】" if collapsed(cid) else ""


def page_key(rel, root=None):
    """页在分数表里的写法：主 wiki 下的写相对路径，其他库写 ~/…"""
    full = Path(os.path.realpath((Path(root) if root else WIKI) / rel))
    main = Path(os.path.realpath(WIKI))
    if full.is_relative_to(main):
        return full.relative_to(main).as_posix()
    h = Path(os.path.realpath(HOME))
    return "~/" + full.relative_to(h).as_posix() if full.is_relative_to(h) else full.as_posix()


# 楼层帖标注（#1177，用户 11-07 定「存储仍用 wiki 页，只给行标帖子和楼层」）：行尾 <!-- 帖 t编号·N楼 题「…」 述「…」 -->，
# 题、述只写在一楼那行。编号、票按去掉标注后的行算，加标注不动旧编号和旧票。
TAG = re.compile(r"\s*<!-- 帖 (t[0-9a-f]{10})·(\d+)楼(?: 题「(.*?)」(?= 述「| -->))?(?: 述「(.*?)」(?= -->))? -->\s*$")  # 题、述里可以有「」


def bare(line):
    return TAG.sub("", line).strip()


def entry_id(rel, line, root=None):
    return f"{page_key(rel, root)}#{hashlib.sha1(bare(line).encode()).hexdigest()[:10]}"


def rerank(hits, root=None):
    """hits = 按相关度排好的 [(页, 行号, 原文, …)]：照 rank_key 稳定重排，低分折叠的沉到最后，一条不删。"""
    return sorted(hits, key=lambda h: rank_key(entry_id(h[0], h[2], root)))


# ---- 楼层帖（#1177，用户 11-07「一个帖子…下面的回答你可能是错，也可能是对，但是每一个回答他都可以有个权重」）----
# 归帖就记在 wiki 行尾（TAG）：主 wiki 和各角色 wiki 的 .md 里带标注的行就是楼，同一个 t编号 的是同一帖。
# 不在帖里的条自成一帖。
_tcache = {}
RESCAN = 30  # 秒：推送每轮都查帖子，30 秒内不重扫文件（wiki 一天改几十次，晚 30 秒无妨）


def roots():
    """有楼的库：主 wiki + 各角色 wiki（~/.bothouse/roles/*/wiki，同 forum_page 里出现过的 ~/ 页）。"""
    return [WIKI] + sorted((HOME / ".bothouse" / "roles").glob("*/wiki"))


def md_files():
    for r in roots():
        for f in sorted(r.rglob("*.md")):
            if not any(x.startswith(".") for x in f.relative_to(r).parts):
                yield r, f


def date_of(text):
    """楼的日期：行里第一个 年-月-日；只写月日的按今年（同 notes/forum-threads-1177/cluster.py date_of）。"""
    m = re.search(r"20\d\d-\d\d-\d\d", text)
    if m:
        return m.group(0)
    m = re.search(r"(?<![\d#/.-])(1[0-2]|0[1-9])-([0-3]\d)(?![\d-])", text)
    return f"2026-{m.group(1)}-{m.group(2)}" if m else ""  # 年份：wiki 记录全在 2026 年（cluster.py 数据实测）


def scan():
    """读各库 wiki 行尾的标注 → [帖子 {tid, title, desc, floors: [{floor, id: 页#哈希, date}], pages}]，楼按楼号排。"""
    by = {}
    for r, f in md_files():
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "<!-- 帖 " not in text:
            continue
        page = None
        for line in text.split("\n"):
            m = TAG.search(line)
            if not m:
                continue
            page = page or page_key(f.relative_to(r).as_posix(), r)
            cid = f"{page}#{hashlib.sha1(bare(line).encode()).hexdigest()[:10]}"
            th = by.setdefault(m.group(1), {"tid": m.group(1), "title": "", "desc": "", "floors": []})
            if m.group(3):
                th["title"], th["desc"] = m.group(3), m.group(4) or ""
            if all(x["id"] != cid for x in th["floors"]):
                th["floors"].append({"floor": int(m.group(2)), "id": cid, "date": date_of(bare(line))})
    for th in by.values():
        th["floors"].sort(key=lambda x: x["floor"])
        th["pages"] = sorted({x["id"].partition("#")[0] for x in th["floors"]})
    return list(by.values())


def thread_table():
    """{楼编号: 帖子}，30 秒内用缓存。"""
    import time
    if time.time() - _tcache.get("at", 0) > RESCAN:
        _tcache.update(at=time.time(), data={x["id"]: th for th in scan() for x in th["floors"]})
    return _tcache["data"]


def thread_of(cid):
    """这条所在的帖子（只有一楼的也返回）；没标注返回 None。"""
    return thread_table().get(cid)


def floors_ranked(th):
    """帖内各楼按票排：同 rank_key（折叠的沉底，Wilson 下界高的在前）；同分时新楼在前（旧说法可能已过时）。"""
    return sorted(th.get("floors", []), key=lambda f: (rank_key(f["id"]), -f.get("floor", 0)))
