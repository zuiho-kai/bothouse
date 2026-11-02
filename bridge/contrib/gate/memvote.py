#!/usr/bin/env python3
"""记忆论坛当场投票：助手用到哪条推送的记忆，当轮就投。

照抄两处，不自创：
- 什么时候投：ACE（arXiv 2510.04618）Generator 回答时报出用到的 bullet_ids。五家 CLI（Claude Code、Codex、
  Gemini/antigravity、grok/acp、DSH）都有 shell，所以报编号用这条命令，不改各家回复格式。
- 怎么记票：Stack Overflow 投票规则（https://stackoverflow.com/help/privileges/vote-up 、vote-down；
  https://meta.stackexchange.com/q/7237 「How does reputation work」：一人一帖一票，可改投、可撤回，撤回后分数复原）。
  一个角色（CC_PROJECT）= 一个账号；同一条再投同向是空操作，改投反向按差值记，撤回把这票清零。

  memvote.py +编号 -编号 x编号 …   编号 = 推送行尾 [#编号]；+ 用到且对，- 内容错了/过时，x 撤回我的票

记录格式（forum_scores.py 读同一份）：votes.jsonl 每行一次动作
  {"t", "voter": 角色, "id": "页#指纹", "vote": 1|-1|0, "by": "self"|"night", "key": 会话, "agent": CLI}
  某角色对某条的当前票 = 它对这条的最后一行；0 = 撤回。分数 scores.json 只按「新票 - 旧票」增减，历史分数原样保留。
"""
import fcntl, hashlib, json, os, re, sys, time
from pathlib import Path

EXP = Path(os.environ.get("MEMVOTE_DIR") or Path(__file__).resolve().parent)  # 隔离测试时指到副本目录
SCORES = EXP / "scores.json"
VOTES = EXP / "votes.jsonl"
PUSH = EXP / "push.jsonl"
LOCK = EXP / ".scores.lock"
HOME = Path.home()
WIKI = Path(os.environ.get("GATE_WIKI") or "~/wiki").expanduser()
try:
    from datadir import data_dir
    ROLES = data_dir() / "roles"  # 角色 wiki 在 <角色目录>/wiki（同 ctxsvc.role_wiki 的默认）
except ImportError:
    ROLES = HOME / ".bothouse/roles"
INIT = 2  # 沿用 ctxsvc.EXP_INIT（ExpeL §4.2「initial importance count of two」）
ARG = re.compile(r"^([+=x-])#?([0-9a-f]{10})$")  # 编号长度沿用 ctxsvc.exp_id 的 sha1[:10]
SIGN = {"+": 1, "-": -1, "x": 0, "=": 0}  # x 撤回（= 在 zsh 里会被展开，只在加引号时可用）


def _recs(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for ln in lines:
        try:
            yield json.loads(ln)
        except ValueError:
            pass


def _sha(x):
    return hashlib.sha1(x.strip().encode()).hexdigest()[:10]


def full_id(h, scores):
    """短编号 → 分数表的键「页#指纹」（主 wiki 写相对路径，角色 wiki 写 ~/…，同 forum_scores.page_key）：
    先看推送记录和已有分数，再扫主 wiki 和各角色 wiki。"""
    for r in reversed(list(_recs(PUSH))):
        for ref in r.get("refs") or []:
            if ref.endswith("#" + h):
                return ref.partition("#")[0].rpartition(":")[0] + "#" + h
    for k in scores:
        if k.endswith("#" + h):
            return k
    for root in [WIKI] + sorted(ROLES.glob("*/wiki")):
        for f in root.rglob("*.md"):
            try:
                if any(_sha(x) == h for x in f.read_text(encoding="utf-8", errors="ignore").split("\n")):
                    rel = f.relative_to(WIKI).as_posix() if root == WIKI else "~/" + f.relative_to(HOME).as_posix()
                    return f"{rel}#{h}"
            except OSError:
                pass
    return None


def current(voter, cid):
    v = 0
    for r in _recs(VOTES):
        if r.get("voter") == voter and r.get("id") == cid:
            v = r.get("vote", 0)
    return v


def record(voter, items, by="self", key="", agent=""):
    """items = [(编号「页#指纹」, 1|-1|0)]，按 SO 规则落票：返回 [(编号, 旧票, 新票, 分数)]；旧票等于新票的不记。"""
    out, recs = [], []
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(LOCK, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        scores = json.loads(SCORES.read_text()) if SCORES.exists() else {}
        cur = {}
        for r in _recs(VOTES):
            if r.get("voter") == voter:
                cur[r.get("id")] = r.get("vote", 0)
        for cid, v in items:
            old = cur.get(cid, 0)
            if v != old:
                scores[cid] = scores.get(cid, INIT) + v - old
                cur[cid] = v
                recs.append({"t": now, "voter": voter, "id": cid, "vote": v, "by": by, "key": key, "agent": agent})
            out.append((cid, old, v, scores.get(cid, INIT)))
        if recs:
            tmp = SCORES.with_suffix(".vote.tmp")
            tmp.write_text(json.dumps(scores, ensure_ascii=False, indent=0))
            tmp.replace(SCORES)
            with open(VOTES, "a", encoding="utf-8") as fh:
                fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in recs)
    return out


def main(args):
    voter = os.environ.get("CC_PROJECT") or "terminal"  # 终端会话没有 CC_PROJECT，算一个账号
    want, bad = [], []
    for a in args:
        m = ARG.match(a.strip())
        (want.append((SIGN[m.group(1)], m.group(2))) if m else bad.append(a))
    if bad or not want:
        print(f"用法：memvote.py +编号（赞） -编号（踩） x编号（撤回）…；编号是推送行尾 [#…] 里那串；看不懂的：{' '.join(bad) or '无'}")
        return 2
    sc = json.loads(SCORES.read_text()) if SCORES.exists() else {}
    items, miss = [], []
    for v, h in want:
        cid = full_id(h, sc)
        (items.append((cid, v)) if cid else miss.append(h))
    word = {1: "赞", -1: "踩", 0: "无票"}
    lines = [f"#{h} 找不到这条（编号抄错了？）" for h in miss]
    for cid, old, new, s in record(voter, items, key=os.environ.get("CC_SESSION_KEY", ""),
                                   agent=os.environ.get("CC_AGENT", "")):
        h = cid.rpartition("#")[2]
        lines.append(f"#{h} 已是{word[new]}，没变（分数 {s}）" if old == new else f"#{h} {word[old]} → {word[new]}，分数 {s}")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
