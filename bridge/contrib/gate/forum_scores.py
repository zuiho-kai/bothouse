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
- votes.jsonl（memvote.py 写：voter/id/vote 1|-1|0/by），每个投票人对每条取最后一行 = 现在这一票（改票、撤票即回滚）。
- legacy_votes.json（可选）：{编号: [赞, 踩]}，导入的历史票。
这两个文件和 scores.json 在同一目录：默认本文件所在目录（bothouse 装的 gate 目录），FORUM_SCORES 指向别的 scores.json 时取它旁边的。
条目编号同 ctxsvc.exp_id：页 + 这行内容的 sha1 前 10 位；主 wiki 的页用相对路径，别的库（角色 wiki）用 ~/ 开头的全路径。
分数所有角色、所有频道共用一份。"""
import hashlib, json, math, os
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
    votes, legacy = d / "votes.jsonl", d / "legacy_votes.json"
    stamp = (votes, _mtime(votes), _mtime(legacy))
    if _cache.get("stamp") == stamp:
        return _cache["data"]
    out = {}
    try:
        for k, (u, n) in json.loads(legacy.read_text(encoding="utf-8")).items():
            out[k] = [u, n]
    except (OSError, ValueError):
        pass
    cur = {}
    try:
        for ln in votes.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(ln)
                cur[(r.get("voter"), r.get("id"))] = r.get("vote", 0)
            except ValueError:
                pass
    except OSError:
        pass
    for (_, cid), v in cur.items():
        if v in (1, -1):
            out.setdefault(cid, [0, 0])[0 if v == 1 else 1] += 1
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


def entry_id(rel, line, root=None):
    return f"{page_key(rel, root)}#{hashlib.sha1(line.strip().encode()).hexdigest()[:10]}"


def rerank(hits, root=None):
    """hits = 按相关度排好的 [(页, 行号, 原文, …)]：照 rank_key 稳定重排，低分折叠的沉到最后，一条不删。"""
    return sorted(hits, key=lambda h: rank_key(entry_id(h[0], h[2], root)))
