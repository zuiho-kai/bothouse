"""每轮上下文的长层：cc-connect（maomao 分支）每轮开头 POST /context 来取「可能相关的 wiki 页」。

用 wiki_search.py 的逐行 BM25（纯词法，不用模型）查这条消息，把命中行折成页，列出前几页和命中行。
同一页同一会话只推一次由 cc-connect 管（core/gate.go turnContext）。

wiki 在哪：环境变量 GATE_WIKI（默认 ~/wiki，即 llm-wiki 装在 ~/wiki）；设成空或 off = 不推 wiki 页。
目录不存在也不推（不报错）。wiki 的分层和安装见 zuiho-kai/llm-wiki 和 docs/ccm-and-wiki.md。
bothouse 起的 gate 由 core/gate_proc.go 传 GATE_WIKI（FindWiki 的主 wiki）和 GATE_WIKI_BOTS（向导写的 bots.json）。

角色 wiki（req 的 bot = gate_url 的 ?bot=<project> = bots.json 的键）：主 wiki 和她自己的角色 wiki 各查前 3 页，
主 wiki 排前，别的角色的不查（同作者本机 ctxsvc.py：两个索引分开查，不合成一个排序，免得主 wiki 的页被挤掉）。
lead 也带 ?bot=，也查她自己的；bot 为空或不在 bots.json 里只查主 wiki。

POST /context {key, text, bot}  → {wiki: [{path, desc}]}，desc = 页描述 | 行号: 原文 | …（cc-connect 原样拼成「- path — desc」）
"""
import hashlib, json, os, re, time
from pathlib import Path

try:
    import lead  # 主角色切换（gate 目录里有）；hooks/wiki-context.py 只装了 ctxsvc + wiki_search，没有就不附身份段
except ImportError:
    lead = None
try:
    import board  # 任务板（gate 目录里有）；同上，没装就不附
except ImportError:
    board = None
import wiki_search as search

_env = os.environ.get("GATE_WIKI", "~/wiki").strip()
WIKI = None if _env.lower() in ("", "off") else Path(_env).expanduser()
TTL = 300  # 来源：作者本机 ctxsvc.py 沿用的 300 秒重建索引（wiki 改了最迟这么久后查得到）
TOP_PAGES = 3  # 来源：作者本机 ctxsvc.py，每轮推前 3 页（回放评测按前 3 页口径）
DESC_CHARS = 120  # 来源：作者本机 ctxsvc.py 的页描述截断

_bots_env = os.environ.get("GATE_WIKI_BOTS", "").strip()
BOTS = Path(_bots_env).expanduser() if _bots_env else None  # bots.json（core/rolewiki.go addRole 写）；没有 = 只查主 wiki

_idx, _idx_at = {}, {}  # 每个根各自缓存：两个 bot 交替来问不互相冲掉索引


def _index(root=None):
    root = root or WIKI
    if root not in _idx or time.time() - _idx_at.get(root, 0.0) >= TTL:
        _idx[root], _idx_at[root] = search.Index(root), time.time()
    return _idx[root]


_bots, _bots_at, _bots_src = {}, 0.0, None


def role_wiki(bot):
    """bot 自己的角色 wiki 目录（bots.json 的 "wiki"，默认 <workdir>/wiki，同 contrib/wiki/setup_wiki.py），没有就 None。
    bots.json 随 TTL 重读：向导加了角色，不重启 gate 也查得到。"""
    global _bots, _bots_at, _bots_src
    if not bot or BOTS is None:
        return None
    if _bots_src != BOTS or time.time() - _bots_at >= TTL:
        try:
            _bots = json.loads(BOTS.read_text(encoding="utf-8"))
        except (OSError, ValueError):  # 没有或读坏了：只查主 wiki
            _bots = {}
        _bots_at, _bots_src = time.time(), BOTS
    e = _bots.get(bot) if isinstance(_bots, dict) else None
    if not isinstance(e, dict):
        return None
    w = e.get("wiki") or (Path(e["workdir"]) / "wiki" if e.get("workdir") else None)
    return Path(w).expanduser() if w else None


# cc-connect 拼在用户原话前的块（各占一段，以空行结束；同 core/handoff.go staleBlocks）
_BLOCKS = re.compile(r"^（(?:队友状态|可能相关的 wiki 页|频道里你上次看到之后的消息)[^\n]*(?:\n.+)*\n*", re.M)


def query(text):
    """只留用户最新那句话：去掉系统块、频道补发的旧消息；[replying to …] 引用保留。"""
    for mark in ("（最新，回这条）", "（最新）"):  # gate.go：补发块/缓冲消息之后的才是这条
        if mark in text:
            text = text.split(mark)[-1]
            break
    return _BLOCKS.sub("", text).strip()


def _same(a, b):
    """两个目录是不是同一个库（按真实路径：bots.json 里主角色的 wiki 可以直接指向主 wiki，或经软链接）。"""
    return b is not None and os.path.realpath(a) == os.path.realpath(b)


def _shown(rel, root=None):
    """推给 agent 的路径：家目录写成 ~，agent 直接能读。"""
    p = ((root or WIKI) / rel).as_posix()
    home = Path.home().as_posix()
    return "~" + p[len(home):] if p.startswith(home + "/") else p


def match_wiki(text, k=TOP_PAGES, root=None):
    """root 不给 = 主 wiki（hooks/wiki-context.py 终端会话就这样调）。"""
    root = root or WIKI
    if root is None or not root.is_dir():
        return []
    idx = _index(root)
    pages = {}
    for rel, ln, line in idx.search(query(text)):  # 前 10 行，按首次出现排页
        if rel not in pages:
            if len(pages) == k:
                continue
            pages[rel] = [idx.desc.get(rel, "")[:DESC_CHARS]]
        pages[rel].append(f"{ln}: {line.strip()}")
    return [{"path": _shown(rel, root), "desc": " | ".join(parts)} for rel, parts in pages.items()]


def context(req):
    # 主角色切换过就附上主/次身份段（lead.py）。cc-connect 按 path 每个会话只推一次，path 里带切换时间，
    # 所以每次切换后每个角色的下一轮各收到一次（用户 2026-10-21「这个我预期可以一句话去换」）
    bot = req.get("bot") or ""
    who = lead.identity(bot) if lead else None
    pb = lead.playbook(bot) if lead else None  # 当主的才有：主角色工作手册（lead.playbook）
    text = req.get("text") or ""
    own = role_wiki(bot)
    mine = match_wiki(text, root=own) if own and not _same(own, WIKI) else []  # 同一个库（真实路径）只查一次
    return {"wiki": [x for x in (who, pb) if x] + board_items() + match_wiki(text) + mine}  # 主 wiki 在前


def board_items():
    """任务板整张附上（board.py）。path 带内容指纹：cc-connect 同一 path 每个会话只推一次（gate.go turnContext），
    所以板子不变不重复推，一变每个 bot 下一轮各收到一次新板（用户 2026-10-22「他应该能看到为什么从开始找」）。"""
    if board is None or not board._path("board.jsonl").exists():  # 没用过任务板就不附（板子清空后文件还在，照推「没有进行中的事」）
        return []
    try:
        ls = board.lines()
    except Exception:  # 板子读坏了不挡推页
        return []
    body = "\n".join(ls) or "现在没有进行中的事"
    tag = hashlib.sha1(body.encode()).hexdigest()[:6]
    return [{"path": f"【任务板 {tag}】", "desc": "谁手上有哪件事、做在哪（接手前先看这里；增改结束用 board 命令）\n" + body}]
