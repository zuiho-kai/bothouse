"""每轮上下文的长层：cc-connect（maomao 分支）每轮开头 POST /context 来取「可能相关的 wiki 页」。

用 wiki_search.py 的逐行 BM25（纯词法，不用模型）查这条消息，把命中行折成页，列出前几页和命中行。
同一页同一会话只推一次由 cc-connect 管（core/gate.go turnContext）。

wiki 在哪：环境变量 GATE_WIKI（默认 ~/wiki，即 llm-wiki 装在 ~/wiki）；设成空或 off = 不推 wiki 页。
目录不存在也不推（不报错）。wiki 的分层和安装见 zuiho-kai/llm-wiki 和 docs/ccm-and-wiki.md。

POST /context {key, text}  → {wiki: [{path, desc}]}，desc = 页描述 | 行号: 原文 | …（cc-connect 原样拼成「- path — desc」）
"""
import os, re, time
from pathlib import Path

import wiki_search as search

_env = os.environ.get("GATE_WIKI", "~/wiki").strip()
WIKI = None if _env.lower() in ("", "off") else Path(_env).expanduser()
TTL = 300  # 来源：作者本机 ctxsvc.py 沿用的 300 秒重建索引（wiki 改了最迟这么久后查得到）
TOP_PAGES = 3  # 来源：作者本机 ctxsvc.py，每轮推前 3 页（回放评测按前 3 页口径）
DESC_CHARS = 120  # 来源：作者本机 ctxsvc.py 的页描述截断

# 每个角色自己的 wiki（向导建在 <数据目录>/wikis/<project>，bridge/contrib/wiki/rolewiki.py）：先查它，再查共享的 WIKI
SETUP_DIR = Path(os.environ.get("GATE_SETUP_DIR") or Path.home() / ".cc-connect").expanduser()
_idx = {}  # wiki root → (index, built at)


def _index(root=None):
    global _idx
    if not isinstance(_idx, dict):  # tests reset it with None
        _idx = {}
    root = root or WIKI
    idx, at = _idx.get(root, (None, 0.0))
    if idx is None or time.time() - at >= TTL:
        idx = search.Index(root)
        _idx[root] = (idx, time.time())
    return idx


def role_wiki(bot):
    """bot = gate_url 的 ?bot=（项目名）；"" = 主角色，项目名在 gate-team.json 的 lead.project。"""
    if not bot:
        try:
            import json
            bot = json.loads((SETUP_DIR / "gate-team.json").read_text(encoding="utf-8"))["lead"].get("project", "")
        except (OSError, ValueError, KeyError):
            return None
    d = SETUP_DIR / "wikis" / re.sub(r"[^\w.-]+", "-", bot) if bot else None
    return d if d and d.is_dir() else None


# cc-connect 拼在用户原话前的块（各占一段，以空行结束；同 core/handoff.go staleBlocks）
_BLOCKS = re.compile(r"^（(?:队友状态|可能相关的 wiki 页|频道里你上次看到之后的消息)[^\n]*(?:\n.+)*\n*", re.M)


def query(text):
    """只留用户最新那句话：去掉系统块、频道补发的旧消息；[replying to …] 引用保留。"""
    for mark in ("（最新，回这条）", "（最新）"):  # gate.go：补发块/缓冲消息之后的才是这条
        if mark in text:
            text = text.split(mark)[-1]
            break
    return _BLOCKS.sub("", text).strip()


def _shown(rel, root=None):
    """推给 agent 的路径：家目录写成 ~，agent 直接能读。"""
    p = str((root or WIKI) / rel)
    home = str(Path.home())
    return "~" + p[len(home):] if p.startswith(home + os.sep) else p


def match_wiki(text, k=TOP_PAGES, root=None):
    root = root or WIKI
    if root is None or not Path(root).is_dir():
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
    text = req.get("text") or ""
    own = role_wiki(req.get("bot") or "")
    out = match_wiki(text, root=own) if own else []
    seen = {w["path"] for w in out}
    return {"wiki": out + [w for w in match_wiki(text) if w["path"] not in seen]}
