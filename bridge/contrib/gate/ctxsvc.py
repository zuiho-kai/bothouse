"""每轮上下文的长层：cc-connect（maomao 分支）每轮开头 POST /context 来取「可能相关的 wiki 页」。

用 wiki_search.py 的逐行 BM25（纯词法，不用模型）查这条消息，把命中行折成页，列出前几页和命中行。
同一页同一会话只推一次由 cc-connect 管（core/gate.go turnContext）。

wiki 在哪：环境变量 GATE_WIKI（默认 ~/wiki，即 llm-wiki 装在 ~/wiki）；设成空或 off = 不推 wiki 页（主 wiki 和角色 wiki 都不查）。
目录不存在也不推（不报错）。wiki 的分层和安装见 zuiho-kai/llm-wiki 和 docs/ccm-and-wiki.md。
bothouse 起的 gate 由 core/gate_proc.go 传 GATE_WIKI（FindWiki 的主 wiki）和 GATE_WIKI_BOTS（向导写的 bots.json）。

角色 wiki（req 的 bot = gate_url 的 ?bot=<project> = bots.json 的键）：主 wiki 和她自己的角色 wiki 各查前 3 页，
主 wiki 排前，别的角色的不查（同作者本机 ctxsvc.py：两个索引分开查，不合成一个排序，免得主 wiki 的页被挤掉）。
lead 也带 ?bot=，也查她自己的；bot 为空或不在 bots.json 里只查主 wiki。

POST /context {key, text, bot}  → {wiki: [{path, desc}]}，desc = 页描述 | 行号: 原文 | …（cc-connect 原样拼成「- path — desc」）
"""
import collections, hashlib, json, math, os, re, time
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
    if bot and bot.startswith("dsh:"):  # DSH 成员：/context 带 dsh:<id>，bots.json 键是裸 id（core/setup_dsh_wiki.go）
        bot = bot[4:]
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
    w, wd = e.get("wiki"), e.get("workdir")
    if not w and wd:
        w = Path(wd) / "wiki" if isinstance(wd, str) else None
    elif w and not isinstance(w, str):  # 手改坏了（数字、列表）：跳过角色 wiki，主 wiki 照查
        w = None
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
    own = role_wiki(bot) if WIKI is not None else None  # GATE_WIKI=off/空 = 什么 wiki 都不推，角色 wiki 也不查
    mine = match_wiki(text, root=own) if own and not _same(own, WIKI) else []  # 同一个库（真实路径）只查一次
    if WIKI is None:
        return {"wiki": [x for x in (who, pb) if x] + board_items()}
    roots = [WIKI] + ([own] if own and not _same(own, WIKI) else [])
    return {"wiki": [x for x in (who, pb) if x] + standing_items(roots) + board_items() + match_wiki(text) + mine
            + decision_items(text, req.get("key") or "")}  # 主 wiki 在前


# ---- 已定的方向和做法（llm-wiki 页的「关键事实」「决策与踩坑」两段）----
# 只推命中行时，开工那句话的字面常和旧定案对不上，agent 就重新探索、做出偏离定案的东西。
# 离线对比（作者 wiki，16 个「定过又重来」的真实案例）：现推 3 页命中行 5/16；前 3 页决策段各取最相关 8 行
# + 全库决策段前 10 行 11/16，约 2400 字。所以按话题再附一块定案。
DEC_HEADS = ("决策", "关键事实", "decision", "key fact")  # 页模板的段名（中英）
DEC_PER_PAGE = 8  # 来源：上面的离线对比，各页 8 行
DEC_TOP = 10  # 来源：同上，全库决策段前 10 行（= wiki_search.TOP）
DEC_LINE = 100  # 每行截断字数：整块压在 3000 字内（作者定的每轮增量上限）
_dec, _dec_of = {}, {}
_MD = re.compile(r"(?:~|/)[^\s`'\"（）()「」]*?\.md")  # 交接文件（ws-handoff 叫醒语里写着它的路径）


def _decisions(root):
    """root 的定案行：一个和 Index 同格式的子索引，只含「关键事实」「决策与踩坑」段里的行。随主索引一起重建。"""
    idx = _index(root)
    if _dec_of.get(root) is idx:
        return _dec[root]
    keep = set()
    for rel in idx.desc:
        on = False
        try:
            lines = (root / rel).read_text(encoding="utf-8", errors="ignore").split("\n")
        except OSError:
            continue
        for n, x in enumerate(lines, 1):
            if x.startswith("## "):
                on = any(h in x.lower() for h in DEC_HEADS)
            elif on:
                keep.add((rel, n))
    d = search.Index.__new__(search.Index)
    d.desc, d.lines = idx.desc, [l for l in idx.lines if (l[0], l[1]) in keep]
    d.decay = [1.0] * len(d.lines)  # 定案行算重要，不按日期降分
    n = max(len(d.lines), 1)
    d.avg = sum(len(l[3]) for l in d.lines) / n or 1
    df = collections.Counter(t for l in d.lines for t in set(l[3]))
    d.idf = {t: math.log(1 + (n - c + .5) / (c + .5)) for t, c in df.items()}
    d.inv = collections.defaultdict(list)
    for i, l in enumerate(d.lines):
        for t, c in collections.Counter(l[3]).items():
            d.inv[t].append((i, c))
    _dec[root], _dec_of[root] = d, idx
    return d


def _task_text(text):
    """查定案用的话：这条消息，加上它点名的交接文件（ws-handoff 叫醒时只写「读 …/notes/x.md」，活写在文件里）。"""
    q = query(text)
    for m in dict.fromkeys(_MD.findall(q)):
        try:
            q += "\n" + Path(m).expanduser().read_text(encoding="utf-8", errors="ignore")[:4000]  # 交接文件前 4000 字够用
        except OSError:
            pass
    return q


def decisions(text, root=None):
    """(这次的话题页, 定案行 [(rel, 行号, 原文)])：前 3 页的定案段各取最相关 DEC_PER_PAGE 行，再并上全库定案段前 DEC_TOP 行。"""
    root = root or WIKI
    if root is None or not root.is_dir():
        return [], []
    q = _task_text(text)
    idx, d = _index(root), _decisions(root)
    pages = []
    for rel, _, _ in idx.search(q):
        if rel not in pages and len(pages) < TOP_PAGES:
            pages.append(rel)
    per = collections.Counter()
    out = []
    for rel, ln, line in d.search(q, k=len(d.lines)):  # 全排序后按页取，只取话题页的
        if rel in pages and per[rel] < DEC_PER_PAGE:
            per[rel] += 1
            out.append((rel, ln, line))
    for hit in d.search(q):
        if hit not in out:
            out.append(hit)
    return pages, out


# 只在开工那一轮推：每轮都推的话，聊天里话题页轮轮不同，路径指纹去重不生效，10 轮真实消息累计约 2.1 万字。
# 开工 = 消息点名了存在的交接文件（ws-handoff 叫醒语「先读交接 …/notes/x.md」），或是派活（relay 的「[甲 → 乙] …」、
# 带派活/接手/开工/交接字样）。
_START = re.compile(r"^\[[^\]\n]+ → [^\]\n]+\]|派活|派给|接手|开工|交接")
DEC_BLOCK = 2600  # 单块上限：加上块头约 2.8k，守住作者定的单轮 3000 字
DEC_KEY_CHARS = 6000  # 每个会话 key 累计上限：约两次开工的量；交接文件那轮算新活，清零重计
_dec_used = {}


def _handoff_named(q):
    return any(Path(m).expanduser().is_file() for m in _MD.findall(q))


def is_start(text):
    """这条消息是不是开工、交活或派活的那一轮。"""
    q = query(text)
    return _handoff_named(q) or bool(_START.search(q))


def decision_items(text, key=""):
    """开工那一轮按话题附一块定案（is_start）；同一 key 累计不超过 DEC_KEY_CHARS。
    path 带话题页的指纹：同一话题一个会话只推一次（gate.go turnContext）。"""
    try:
        if not is_start(text):
            return []
        if _handoff_named(query(text)):
            _dec_used[key] = 0
        pages, hits = decisions(text)
    except Exception:  # 读坏了不挡推页
        return []
    if not hits:
        return []
    tag = hashlib.sha1("\n".join(sorted(pages)).encode()).hexdigest()[:6]
    by, size = {}, 0
    for rel, ln, line in hits:  # 按页折叠：页路径只写一次（路径常有 80 字，逐行写占掉一半）
        row = f"  {ln}: {line.strip().removeprefix('- ')[:DEC_LINE]}"
        size += len(row) + 1 + (0 if rel in by else len(rel) + 1)
        if size > DEC_BLOCK:  # hits 按相关度排，超了就丢后面的
            break
        by.setdefault(rel, []).append(row)
    body = "\n".join(f"{rel}\n" + "\n".join(v) for rel, v in by.items())
    if _dec_used.get(key, 0) + len(body) > DEC_KEY_CHARS:
        return []
    _dec_used[key] = _dec_used.get(key, 0) + len(body)
    return [{"path": f"【已定的方向和做法 {tag}】",
             "desc": f"以前定过的方向、流程和踩过的坑（路径相对 {_shown('.').removesuffix('/.')}，要细节按行号读）。"
                     "开工、交活、派活前先对照：照着做，别重新探索；交给队友或工作区时，把相关的几条写进交接\n" + body}]


# ---- 常驻做法短块（<wiki>/STANDING.md）----
# 跨话题的固定做法（用什么工具、谁来做、怎么跑），按话题检索拉不到（离线对比漏的 5 条里 4 条是这类），
# 所以写成一个短块，每个会话都带。块由 agent 自己维护；每轮校验，坏了当场让它修。
STANDING = "STANDING.md"
STANDING_LINES = 20  # 最多几条：短块要每会话常带，按约 1500 字封顶倒推（每条约 70 字）
STANDING_CHARS = 1500
STANDING_HOW = ("每个会话都带的跨话题固定做法（工具、谁来做、怎么跑），照做。这块由你维护：用户定了跨话题的做法就加一行，"
                f"过时就删；改 {{path}}，每条一行、以「- 」开头，最多 {STANDING_LINES} 条、{STANDING_CHARS} 字；话题内的定案写进话题页，不写这里")


def standing_check(body):
    """短块哪里坏了（空串 = 没坏）。"""
    rows = [x for x in body.split("\n") if x.strip() and not x.startswith("#")]
    bad = [x for x in rows if not x.startswith("- ")]
    if bad:
        return f"有 {len(bad)} 行不是「- 」开头的一条做法（如「{bad[0][:30]}」）"
    if len(rows) > STANDING_LINES:
        return f"{len(rows)} 条，超过 {STANDING_LINES} 条"
    if len(body) > STANDING_CHARS:
        return f"{len(body)} 字，超过 {STANDING_CHARS} 字"
    return ""


def standing_items(roots):
    """各 wiki 根下的 STANDING.md（没有就不附）。path 带内容指纹：不变一个会话只推一次，改了下一轮重推；
    坏了就推一条「当场修」，修好后指纹变了照常推新块。"""
    out = []
    for root in roots:
        f = root / STANDING
        try:
            body = f.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        shown = _shown(STANDING, root)
        tag = hashlib.sha1(body.encode()).hexdigest()[:6]
        bad = standing_check(body)
        if bad:
            out.append({"path": f"【常驻做法坏了 {tag}】",
                        "desc": f"{shown} {bad}。先当场修好它（{STANDING_HOW.format(path=shown)}），再做这轮的事"})
            continue
        if body:
            out.append({"path": f"【常驻做法 {tag}】", "desc": STANDING_HOW.format(path=shown) + "\n" + body})
    return out


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
