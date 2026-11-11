"""每轮上下文的长层：bothouse 每轮开头 POST /context 来取「可能相关的 wiki 页」。

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
import collections, hashlib, json, math, os, re, threading, time
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

_FLOOR_TAG = re.compile(r"\s*<!-- 帖 t[0-9a-f]{10}·\d+楼.*?-->\s*$")  # 楼层帖标注（#1177，同 forum_scores.TAG）：算编号、显示时去掉


def _bare(s):
    return _FLOOR_TAG.sub("", s).strip()



_env = os.environ.get("GATE_WIKI", "~/wiki").strip()
WIKI = None if _env.lower() in ("", "off") else Path(_env).expanduser()
TTL = 300  # 来源：作者本机 ctxsvc.py 沿用的 300 秒重建索引（wiki 改了最迟这么久后查得到）
TOP_PAGES = 3  # 来源：作者本机 ctxsvc.py，每轮推前 3 页（回放评测按前 3 页口径）
DESC_CHARS = 40  # 页描述只当标题用（作者 11-02：推送只给标题和编号，细节 agent 自己按行号读），原 120
TITLE_CHARS = 0  # 已停用：每条给整行 + [#编号]（11-03 起不截断）
# 每轮推的 wiki 命中条数上限（主 wiki + 角色 wiki + 经验合计，去重之后算）。来源：用户 11-06 看论坛页
# 「说推几条而已嘛」：隔壁工作区每次新会话第一轮推 15~26 条（主 wiki 前 10 行 + 角色 wiki 前 10 行 + 定案 8 行）。
TURN_ROWS = 5
ITEM_MIN = 6  # 去掉前缀后短于这么多字的行不当一条推（「## 现状」「- 见上」这类）


def is_item(line):
    """这行能不能当一条记忆推：标题行（# 开头）和去掉前缀后太短的不算（用户 11-06：推送里混着「# 多用户隔离…」标题行）。"""
    s = line.strip()
    return bool(s) and not s.startswith("#") and len(_title(s)) >= ITEM_MIN


def _title(line):
    """一行 wiki 原文 → 短标题：去掉「- 」「经验：」等前缀，不截断。"""
    t = re.sub(r"^[-*\s]+", "", _bare(line))
    t = re.sub(r"^(?:经验|用户定|助手定)[：:]\s*", "", t).replace("**", "").replace("`", "")
    return t  # 不截断：截 24 字时定案正文会被截没（11-03 实测：立绘那条只剩日期和前半句）

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


# 查询带前两轮作者的话：开工那句常没有话题词（「这个你修一下」），话题在前两轮里。
# 作者 11-03 用 17 条真实案例离线对照：这轮 + 前两轮拼起来，命中 3→10，不用模型。
PREV_TURNS = 2  # 来源：上面的离线对照（取前 2 轮 10/17，只取 1 轮 6/17）
_prev = {}  # 会话 key → 最近几句作者的话（已清洗），旧在前；进程内，重启清空


def with_prev(q, prev):
    """这轮 + 前 PREV_TURNS 轮作者的话（新在前），空格拼起来当查询。和这轮一样的不重复拼。"""
    return " ".join([q] + [p for p in prev if p and p != q][:PREV_TURNS]).strip()


def turn_query(text, key=""):
    """检索用的查询：作者的话 → 拼上同一 key 前两轮作者的话，并记下这句；不是作者的话（派活、系统消息）只用这句。
    同一 key 几个角色都会来问同一句：和最近一条相同就不重复记。"""
    q = query(text)
    if not key or not exp_is_user(text):
        return q
    seen = _prev.setdefault(key, collections.deque(maxlen=PREV_TURNS + 1))  # 多留一条：别的角色已记下这轮时，去掉它仍剩前两轮
    out = with_prev(q, list(reversed(seen)))
    if not seen or seen[-1] != q:
        seen.append(q)
    return out


# ---- 开工那一轮按活本身匹配（#1436，用户 11-11「不是说推过的不会再推了……为什么还有这问题」）----
# 开工提示（ws-handoff 叫醒语）大半是固定的工作区规矩，拿它整段去搜，每次开工都命中同一批规矩行（11-08 起 244 次开工，
# 最常见 5 条占全部推送 56%）。开工那一轮改用：提示里的任务那句 + 它点名的交接文件的标题、「用户原话」「总目标」两节；
# 交接没有这两节就用交接开头。提示里已经写着的规矩（行的词大半出现在提示的套话里）这一轮不占推送名额，票和分不动。
_KICK_TASK = re.compile(r"(?:从主频道接手一整块大活|工作区接手)[：:]\s*(.+?)(?:。\s*先读交接|\n|$)")
_KICK_FILE = re.compile(r"先读交接\s*((?:~|/)[^\s`'\"（）()「」]*?\.md)")
KICK_SECTIONS = ("用户原话", "总目标")
KICK_CHARS = 1500  # 交接里取的字数：用户原话 + 总目标一般 600–1200 字，再长就是转述了
KICK_DUP = 0.7  # 一行的词有这么多出现在开工套话里，就算「提示里已经带着」（离线 #1436 回放定，见 notes/memfix1436）


def _kick_file(q):
    m = _KICK_FILE.search(q)
    f = Path(m.group(1)).expanduser() if m else None
    return f if f and f.is_file() else None


def kickoff_query(text):
    """开工那一轮（提示点名了存在的交接文件）→ 检索用的查询：任务那句 + 交接的标题、用户原话、总目标；不是开工返回 None。"""
    q = query(text)
    f = _kick_file(q)
    if f is None:
        return None
    m = _KICK_TASK.search(q)
    parts = [m.group(1).strip()] if m else []
    try:
        body = f.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        body = ""
    t = re.search(r"^# (.+)$", body, re.M)
    if t:
        parts.append(t.group(1).strip())
    secs = [s.group(1).strip() for h in KICK_SECTIONS
            for s in [re.search(rf"^## {h}[^\n]*\n(.*?)(?=^## |\Z)", body, re.S | re.M)] if s]
    parts += secs or [body[:KICK_CHARS]]
    return "\n".join(parts)[:KICK_CHARS * 2]


def kickoff_boiler(text):
    """开工提示里的套话：提示去掉任务那句。用来认「提示里已经带着的规矩」。"""
    q = query(text)
    m = _KICK_TASK.search(q)
    return q.replace(m.group(1), " ") if m else q


def in_prompt(line, boiler_toks):
    """这行的词大半已经出现在开工套话里 → 提示里已经带着，这一轮不推。"""
    t = set(search.toks(_title(line)))
    return bool(t) and len(t & boiler_toks) / len(t) >= KICK_DUP


def _same(a, b):
    """两个目录是不是同一个库（按真实路径：bots.json 里主角色的 wiki 可以直接指向主 wiki，或经软链接）。"""
    return b is not None and os.path.realpath(a) == os.path.realpath(b)


def _shown(rel, root=None):
    """推给 agent 的路径：家目录写成 ~，agent 直接能读。"""
    p = ((root or WIKI) / rel).as_posix()
    home = Path.home().as_posix()
    return "~" + p[len(home):] if p.startswith(home + "/") else p


def match_wiki(text, k=TOP_PAGES, root=None, skip=None):
    """root 不给 = 主 wiki（hooks/wiki-context.py 终端会话就这样调）。skip = 开工套话的词：提示里已经带着的行不占名额。"""
    root = root or WIKI
    if root is None or not root.is_dir():
        return []
    idx = _index(root)
    pages = {}
    if skip:  # 多取一些，跳掉的行由后面的补上（名额不放宽）
        hits = [h for h in idx.search(query(text), k=search.TOP * 3) if is_item(h[2]) and not in_prompt(h[2], skip)][:search.TOP]
    else:
        hits = [h for h in idx.search(query(text)) if is_item(h[2])]  # 前 10 行，去掉标题行
    if FORUM:  # 记忆论坛：低分折叠沉底不隐藏，按 reddit confidence 稳定重排（forum_scores.py）；角色 wiki 同一份
        hits = FORUM.rerank(hits, None if _same(root, WIKI) else root)
    shown_th = set()
    for rel, ln, line in hits:  # 按首次出现排页
        th = _thread(rel, line, root)
        if th and th["tid"] in shown_th:
            continue  # 同一帖的别的楼已经推过标题和最高分楼
        if rel not in pages:
            if len(pages) == k:
                continue
            pages[rel] = {"head": idx.desc.get(rel, "")[:DESC_CHARS], "sep": " | ", "rows": []}
        if th:
            shown_th.add(th["tid"])
            rows = _thread_rows(th, rel, root)
            if rows:
                pages[rel]["rows"] += rows
                continue
        fold = FORUM.label(FORUM.entry_id(rel, line, None if _same(root, WIKI) else root)) if FORUM else ""
        pages[rel]["rows"].append(_row(rel, line, f"{ln}: {fold}{_title(line)}{exp_tag(rel, line)}", root=root, ln=ln))  # 只给标题+编号，细节自己按行号读；角色 wiki 的条也能投（编号只看这行内容）
    return [_render(dict(it, path=_shown(rel, root))) for rel, it in pages.items()]


def _thread(rel, line, root):
    """命中行所在的楼层帖（#1177）；只有一楼、或没装归帖表（forum_scores 旧版）时 None，照旧推这一行。"""
    if not FORUM or not hasattr(FORUM, "thread_of"):
        return None
    th = FORUM.thread_of(FORUM.entry_id(rel, line, None if _same(root, WIKI) else root))
    return th if th and len(th.get("floors", [])) > 1 else None


def _floor_line(cid):
    """楼编号 页#哈希 → (页文件, 行号, 原文)；页里已没有这行返回 None（挪进历史、改写过的楼不推）。"""
    page, _, h = cid.partition("#")
    f = Path.home() / page[2:] if page.startswith("~/") else Path(page) if os.path.isabs(page) else WIKI / page
    try:
        lines = f.read_text(encoding="utf-8", errors="ignore").split("\n")
    except OSError:
        return None
    for n, x in enumerate(lines, 1):
        if x.strip() and hashlib.sha1(_bare(x).encode()).hexdigest()[:10] == h:
            return f, n, x
    return None


def _thread_rows(th, rel, root):
    """楼层帖推「标题 + 最高分楼」；最新一楼不是最高分那楼、说法也不一样时两楼都推（用户 11-07 定的方案）。
    别的页上的楼写出页路径，编号照旧是那楼自己的 [#编号]，投票记到那一楼。"""
    floors = {f["id"]: f for f in th["floors"]}
    found = [(f, _floor_line(f["id"])) for f in FORUM.floors_ranked(th)]
    found = [(f, x) for f, x in found if x and is_item(x[2])]
    if not found:
        return []
    top = found[0]
    latest = max(found, key=lambda t: t[0].get("floor", 0))
    here = ((root or WIKI) / rel).resolve()
    out = []
    for tag, (f, (file, n, line)) in [("最高分楼", top)] + ([("最新楼", latest)] if latest[0] is not top[0] and _title(latest[1][2]) != _title(top[1][2]) else []):
        where = f"{n}" if file.resolve() == here else f"{_shown(file.as_posix(), Path('/'))}:{n}"
        u, d = FORUM.counts(f["id"])
        head = f"【帖·{len(floors)}楼】{th.get('title') or ''} " if tag == "最高分楼" else ""
        fold = FORUM.label(f["id"])
        out.append(_row(file.as_posix(), line, f"{where}: {head}{tag}（{f.get('floor', 0)}楼 赞{u} 踩{d}）：{fold}{_title(line)}{exp_tag(rel, line)}",
                        root=Path("/"), ln=n))
    return out


def context(req):
    # 主角色切换过就附上主/次身份段（lead.py）。cc-connect 按 path 每个会话只推一次，path 里带切换时间，
    # 所以每次切换后每个角色的下一轮各收到一次（only_new 按 path+desc 整块去重）（用户 2026-10-21「这个我预期可以一句话去换」）
    bot = req.get("bot") or ""
    who = lead.identity(bot) if lead else None
    pb = lead.playbook(bot) if lead else None  # 当主的才有：主角色工作手册（lead.playbook）
    dm = lead.dept_manager(bot, ws_task(req.get("key") or "")) if lead else None  # 工作区里有活才有：部门经理做法
    text = req.get("text") or ""
    kq = kickoff_query(text)  # 开工那一轮：拿活本身（任务那句 + 交接的用户原话、总目标）去搜，不拿开工套话
    skip = set(search.toks(kickoff_boiler(text))) if kq else None  # 提示里已经带着的规矩这一轮不占名额
    tq = kq or turn_query(text, req.get("key") or "")  # 推页和经验用：这轮 + 前两轮作者的话（定案块仍只看这轮，它要判开工）
    own = role_wiki(bot) if WIKI is not None else None  # GATE_WIKI=off/空 = 什么 wiki 都不推，角色 wiki 也不查
    mine = match_wiki(tq, root=own, skip=skip) if own and not _same(own, WIKI) else []  # 同一个库（真实路径）只查一次
    if WIKI is None:
        return only_new({"wiki": [x for x in (who, pb, dm) if x] + board_items(req.get("key") or "")}, req)
    roots = [WIKI] + ([own] if own and not _same(own, WIKI) else [])
    key = req.get("key") or ""
    dec = decision_items(text, key)
    out = {"wiki": [x for x in (who, pb, dm) if x] + memory_caps(roots, own) + standing_items(roots) + profile_items(roots, req.get("sender")) + board_items(key)
           + proposal_items(text, bot, key)
           + with_lessons(match_wiki(tq, skip=skip), tq, skip) + mine + dec}  # 主 wiki 在前；经验并进 wiki 推荐，按话题命中才出
    if MEMVOTE.exists() and any(EXP_TAG.search(w.get("desc", "")) for w in out["wiki"]):
        out["wiki"].append(VOTE_ITEM)  # 固定 path：每个会话只推一次（gate.go turnContext 按 path 去重）
    out = only_new(out, req)  # 推过的条不再推（同一会话代号内）
    try:
        exp_log(key, bot, text, out["wiki"], tq, ep=str(req.get("epoch") or ""))
    except Exception:
        pass
    return out


# ---- 记忆能力说明（这套系统开着哪些记忆功能）----
# 角色被问「llm wiki / 记忆论坛开了吗」时要答对、能现场演示（用户 11-05「记忆论坛口径要对齐，别人问别说没有」）。
# 按这台机器实际开着的功能现生成，不写进人设：升级后 gate 脚本随桥更新，老用户不用重跑向导也带上。
# path 带内容指纹：功能没变一个会话只推一次。
FORUM_NIGHT = os.environ.get("GATE_FORUM_NIGHT", "").strip() == "1"  # 桥看到「记忆论坛夜间结算」定时才设（core/gate_proc.go）


def _search_cmd(root):
    """同 core/rolewiki.go leadWikiSection：共用版 search.py（SHARED_TOOL）默认查 ~/wiki，要带 --root。"""
    cmd = f"python3 -X utf8 -I {_shown('bin/search.py', root)} "
    if "\nSHARED_TOOL = 1" in _read(root / "bin" / "search.py"):
        cmd += f"--root {_shown('.', root).removesuffix('/.')} "
    return cmd + "<关键词>"


def memory_caps(roots, own):
    rows = []
    for root in roots:
        if not (root / "bin" / "search.py").exists():
            continue
        what = "你自己的记忆 wiki" if own and _same(root, own) else "主 wiki（团队共用）"
        rows.append(f"- {what}（llm wiki）：{_shown('.', root).removesuffix('/.')}。会话和日记定时整理进去，夜里做一次反思；"
                    f"查：`{_search_cmd(root)}`")
    if not rows:
        return []
    rows.append("- 每轮记忆推送：桥每轮按话题从 wiki 推相关页、定案和经验，只给标题和行尾 [#编号]，正文按页路径和行号读")
    if MEMVOTE.exists():
        night = "；每天 05:30 夜间结算：看引用那轮用户下一句是不是纠正，记成败" if FORUM_NIGHT else ""
        rows.append(f"- 记忆论坛：推送的定案、经验条行尾带 10 位编号，用到哪条就 `python3 {_shown(MEMVOTE, Path('/'))} +编号` 记引用（页面和卡片的 8 位编号是取正文用的，不投）{night}；"
                    "按 Reddit best 排序，低分条折叠沉底、不删" + ("" if FORUM else "（排序模块没装，这项未生效）"))
    if PROFILE and any((roots[0] / PROFILE).glob(PROFILE_PAGE.format(key="*"))):
        rows.append(f"- 懂你画像：每人一页（{_shown(PROFILE, roots[0])}/{PROFILE_PAGE.format(key='<平台>-<账号 id>')}），"
                    "夜里从各人原话重写；谁发这条消息就推谁那页，一个会话推一次")
    body = "\n".join(rows)
    tag = hashlib.sha1(body.encode()).hexdigest()[:6]
    return [{"path": f"【记忆能力 {tag}】", "desc": (
        "这套系统开着下面这些记忆功能。有人问 llm wiki、记忆论坛、长期记忆开没开，按这里答「开了，测试中」，"
        "说清是什么，需要时现场跑查询命令给他看；不说没有。没列出的才是没开。\n" + body)}]


# ---- 已定的方向和做法（llm-wiki 页的「关键事实」「决策与踩坑」两段）----
# 只推命中行时，开工那句话的字面常和旧定案对不上，agent 就重新探索、做出偏离定案的东西。
# 离线对比（作者 wiki，16 个「定过又重来」的真实案例）：现推 3 页命中行 5/16；前 3 页决策段各取最相关 8 行
# + 全库决策段前 10 行 11/16，约 2400 字。所以按话题再附一块定案。
DEC_HEADS = ("决策", "关键事实", "decision", "key fact")  # 页模板的段名（中英）
DEC_PER_PAGE = 8  # 来源：上面的离线对比，各页 8 行
DEC_TOP = 10  # 来源：同上，全库决策段前 10 行（= wiki_search.TOP）
DEC_LINE = 100  # 每行截断字数：整块压在 3000 字内（作者定的每轮增量上限）
DEC_ROWS = 3  # 只给标题+编号，最多这么多条；原 8，11-06 用户嫌一轮推太多（同 TURN_ROWS）
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
    kq = kickoff_query(text)  # 开工那一轮：活本身，不拿开工套话（#1436）；别的派活照旧读点名的交接
    q = kq or _task_text(text)
    skip = set(search.toks(kickoff_boiler(text))) if kq else None
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
    out = [h for h in out if is_item(h[2]) and not (skip and in_prompt(h[2], skip))]  # 段内的 ### 小标题不当定案；提示里已经带着的规矩不占名额
    out = FORUM.rerank(out) if FORUM else out  # 低分折叠沉底，不移除（forum_scores.py）
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
    by, size, rows = {}, 0, {}
    for rel, ln, line in hits:  # 按页折叠：页路径只写一次（路径常有 80 字，逐行写占掉一半）
        fold = FORUM.label(FORUM.entry_id(rel, line)) if FORUM else ""
        row = f"  {ln}: {fold}{_title(line)}{exp_tag(rel, line)}"
        size += len(row) + 1 + (0 if rel in by else len(rel) + 1)
        if size > DEC_BLOCK or sum(map(len, by.values())) >= DEC_ROWS:  # hits 按相关度排，超了就丢后面的
            break
        by.setdefault(rel, []).append(row)
        rows.setdefault(rel, []).append(_row(rel, line, row, rel, ln=ln))
    body = "\n".join(f"{rel}\n" + "\n".join(v) for rel, v in by.items())
    if _dec_used.get(key, 0) + len(body) > DEC_KEY_CHARS:
        return []
    _dec_used[key] = _dec_used.get(key, 0) + len(body)
    return [_render({"path": f"【已定的方向和做法 {tag}】", "sep": "\n",
                     "head": f"定过的方向和坑，只列标题（路径相对 {_shown('.').removesuffix('/.')}，按行号读细节），照做别重新探索",
                     "rows": [r for rel in by for r in rows[rel]]})]


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


# ---- 懂你画像：每人一页（#1160，用户 11-07「现在我们有对每个用户去做人物画像吗，例如还有zzzx，我想把这个做成一个产品能力」）----
# 页 = <主 wiki>/<GATE_PROFILE 目录>/profile-<平台>-<账号 id>.md（夜间 dream 从这个人自己的原话重写，llmwiki/ingest.py
# profiles_pass）；推「## 现状」一节。sender 是桥带来的这条消息的发送人（core/gate.go turnContext，personKey）：
# 只推他自己那页，没有就不推，不拿别人的顶上（cron、定时、队友 bot 的轮次没有 sender）。path 带人和内容指纹：
# 一个会话里同一个人的同一版只推一次，换人说话推那人的。
PROFILE_PAGE = "profile-{key}.md"
_SENDER = re.compile(r"[A-Za-z0-9._-]{1,120}")


def profile_items(roots, sender):
    sender = (sender or "").strip()
    if not roots or not PROFILE or not _SENDER.fullmatch(sender):
        return []
    rel = f"{PROFILE}/{PROFILE_PAGE.format(key=sender)}"
    text = _read(roots[0] / rel)
    m = re.search(r"^## 现状\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not m or not m.group(1).strip():
        return []
    body = m.group(1).strip()
    name = re.search(r"^# 懂你：(.+)$", text, re.M)
    who = name.group(1).strip() if name else sender
    return [{"path": f"【懂你 {who} {hashlib.sha1(body.encode()).hexdigest()[:6]}】",
             "desc": f"{who} 的画像（夜间从他自己的原话重写，{_shown(rel, roots[0])}）：这条消息是他发的，照这些懂他，"
                     "说话做事贴他的判断和口味\n" + body}]


def _read(f):
    try:
        return f.read_text(encoding="utf-8")
    except OSError:
        return ""


# ---- 经验（教训表里按本轮话题命中的条，并进 wiki 推荐）----
# 经验 = 教训表「关键事实」里「- 经验：」开头的行（缩进的「- MM-DD …」一条是踩一次坑）；没有教训表就不推。
# 排序：论坛票（forum_scores.rank_key，低分折叠沉底）→ 踩坑次数 → 最近一次。
# 懂你画像目录（相对主 wiki）；空 = 不推画像。旧值是一页 .md（#1160 前只有一页）就取它所在的目录
PROFILE = os.environ.get("GATE_PROFILE", "").strip().rstrip("/")
PROFILE = PROFILE.rsplit("/", 1)[0] if PROFILE.endswith(".md") else PROFILE
LESSON_NAME = "rule-candidates-recurrence.md"
LESSON_HEAD = "- 经验："
LESSON_TOP = 3
_lesson_rel = {}


def lessons(root=None):
    """[(rel, 行号, 原行, 踩坑次数, 最近 MM-DD)]，按推送顺序排好。"""
    root = root or WIKI
    if root is None:
        return []
    rel = _lesson_rel.get(root)
    if rel is None or not (root / rel).exists():
        hits = sorted(p for p in root.glob("**/" + LESSON_NAME) if not any(x.startswith(".") for x in p.relative_to(root).parts))
        rel = _lesson_rel[root] = hits[0].relative_to(root).as_posix() if hits else ""
    if not rel:
        return []
    out, lines = [], _read(root / rel).split("\n")
    for n, ln in enumerate(lines, 1):
        if not ln.startswith(LESSON_HEAD):
            continue
        ev = []
        for x in lines[n:]:
            if not x.startswith("  "):
                break
            if (d := re.match(r"\s+- (\d\d-\d\d) ", x)):
                ev.append(d.group(1))
        out.append((rel, n, ln, len(ev), max(ev, default="")))
    out.sort(key=lambda x: x[4], reverse=True)  # 稳定排序：先按最近，再按次数，最后按论坛分（主键）
    out.sort(key=lambda x: -x[3])
    out.sort(key=lambda x: FORUM.rank_key(FORUM.entry_id(x[0], x[2])) if FORUM else (False, 0))
    return [x for x in out if exp_alive(x[0], x[2])]


LESSON_MIN_TOKENS = 2  # 命中门槛：和这句话至少共享 2 个词（离线试：闲聊 0 个，「嘉立创下单参数」2 个、「交板子前查什么」4 个）


def lesson_hits(text, skip=None):
    """按这轮话题挑经验：不固定取论坛分最高前三，
    和这句话共享词够多才算命中，命中的按共享词 idf 和排，再按论坛分（lessons() 的顺序）取前 LESSON_TOP。"""
    if WIKI is None:
        return []
    q = set(search.toks(query(text)))
    if not q:
        return []
    idf = _index(WIKI).idf
    hits = []
    for i, e in enumerate(lessons()):
        if skip and in_prompt(e[2], skip):
            continue
        sh = q & set(search.toks(e[2]))
        if len(sh) >= LESSON_MIN_TOKENS:
            hits.append((-sum(idf.get(t, 0) for t in sh), i, e))
    return [e for _, _, e in sorted(hits)[:LESSON_TOP]]


def with_lessons(pages, text, skip=None):
    """命中的经验并进 wiki 推荐：同一页就接在那页后面，否则作为一页附上（只给标题+编号，同推页格式 | 行号: 标题 [#编号]）。"""
    try:
        hits = lesson_hits(text, skip)
    except Exception:  # 教训表读坏了不挡推页
        return pages
    for rel, n, ln, k, d in hits:
        path, row = _shown(rel), f"{n}: {_title(ln)}{exp_tag(rel, ln)}"
        page = next((p for p in pages if p["path"] == path), None)
        if page is None:
            pages.append(_render({"path": path, "head": "教训表（经验）", "sep": " | ", "rows": [_row(rel, ln, row, ln=n)]}))
        elif f"| {n}: " not in page["desc"]:
            page["rows"].append(_row(rel, ln, row, ln=n))
            _render(page)
    return pages


def _existing_mod():
    """开工清单程序（~/.bothouse/collaboration/lead/_existing.py，ws-handoff 交活时用的同一份）；没装就 None。"""
    import importlib.util
    here = Path(__file__).resolve().parent
    for f in (EXP.parent / "collaboration/lead/_existing.py", here.parent / "collaboration/lead/_existing.py",
              here.parent / "lead/_existing.py", Path.home() / ".bothouse/collaboration/lead/_existing.py"):
        if f.exists():
            try:
                spec = importlib.util.spec_from_file_location("_existing", f)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                return mod if hasattr(mod, "proposal_listing") else None
            except Exception:  # 读坏了不挡推页
                return None
    return None


def proposal_items(text, bot="", key=""):
    """主角色在聊天频道、用户这句在要方案或要加/改机制（#1436，用户 11-11「对我们整个系统这个边界能力……不清晰」）：
    附「手里现成的」——系统自带能力和做过的同类活（_existing.proposal_listing），平时不附；工作区里不附（开工时交接已带）。
    每行一个编号，同一会话推过的行 PUSH_GAP 轮内不重推；不算 wiki 命中条数。"""
    if EXISTING is None or not exp_is_user(text) or ws_task(key) is not None:
        return []
    if lead is not None and lead.member(bot) != lead.current():
        return []
    try:
        rows = EXISTING.proposal_listing(query(text))
    except Exception:  # 清单出错只少这一块
        return []
    if not rows:
        return []
    return [_render({"path": "【手里现成的（提方案前）】", "head": rows[0], "sep": "\n",
                     "rows": [{"id": "txt:" + hashlib.sha1(r.encode()).hexdigest()[:16], "text": r, "group": ""} for r in rows[1:]]})]


def ws_task(key=""):
    """会话 key 所在频道是工作区、任务板上有绑在这里且没暂停的活 → 最早那件的编号，否则 None。"""
    chat = ":".join(str(key or "").split(":", 2)[:2])
    if board is None or ":" not in chat or not board._path("board.jsonl").exists():
        return None
    try:
        ids = [i["id"] for i in board.items() if i.get("ws") == chat and not i.get("paused") and not i.get("backlog")]
    except Exception:  # 板子读坏了不挡推页
        return None
    return min(ids) if ids else None


def board_items(key=""):
    """任务板附上（board.py）：只列本会话频道的条目和等用户的条目，别处的只计数（用户 2026-10-28「工作区的任务板
    又长又臭」，方案第 4 条）；全表用 board 命令看。path 带内容指纹：cc-connect 同一 path 每个会话只推一次
    （gate.go turnContext），所以板子不变不重复推，一变每个 bot 下一轮各收到一次新板（用户 2026-10-22「他应该能看到为什么从开始找」）。"""
    if board is None or not board._path("board.jsonl").exists():  # 没用过任务板就不附（板子清空后文件还在，照推「没有进行中的事」）
        return []
    try:
        its = board.items()
    except Exception:  # 板子读坏了不挡推页
        return []
    shown = [i for i in its if (board.in_chat(i, key) or board.waits_user(i)) and not i.get("backlog")]
    rest = [i for i in its if i not in shown and not i.get("backlog")]
    ls = [board.fmt(i) for i in shown]
    run = sum(1 for i in rest if not i.get("paused"))
    if rest:
        ls.append(f"别处还有 {run} 件在做、{len(rest) - run} 件暂停（全表跑 board）")
    back = sum(1 for i in its if i.get("backlog"))
    if back:  # 待办不占每轮上下文，只报个数（用户 2026-11-05「任务板怎么还有一堆任务」）
        ls.append(f"另有 {back} 件待办（board backlog 看，不着急）")
    body = "\n".join(ls) or "现在没有进行中的事"
    tag = hashlib.sha1(body.encode()).hexdigest()[:6]
    return [{"path": f"【任务板 {tag}】", "desc": "本频道的事和等用户的事（接手前先看这里；增改结束用 board 命令）\n" + body}]


# ---- 记忆论坛（推送的条带编号，agent 用 memvote.py 投票；照 ExpeL §4.2 / ACE §3.1）----
# 推过的条目记 push.jsonl（页:行号#内容指纹），memvote 按它认短编号；重要度到 0 的经验条不再推。
MEMVOTE = Path(__file__).resolve().parent / "memvote.py"  # 投票命令；gate 目录里装了才提示投票
EXP = Path(os.environ.get("MEMVOTE_DIR") or MEMVOTE.parent)  # 推送记录、分数、票的目录（同 memvote.EXP）
SCORES = Path(os.environ.get("FORUM_SCORES") or EXP / "scores.json").expanduser()  # 隔离测试可换副本；同 forum_scores.path()
_NOT_USER = re.compile(r"^(?:\[[^\]\n]+ → [^\]\n]+\]|【|\[(?:report|ask)\]|[⏰📬🔁✅❌⚠️]|你是工作区频道里的主角色)")
_sc, _sc_at = {}, 0.0


def exp_scores():
    global _sc, _sc_at
    try:
        m = SCORES.stat().st_mtime
    except OSError:
        return {}
    if m != _sc_at:
        try:
            _sc, _sc_at = json.loads(SCORES.read_text(encoding="utf-8")), m
        except (OSError, ValueError):
            return _sc
    return _sc


def _forum():
    """记忆论坛排序：同目录 forum_scores.py（gate 目录和终端 hook 目录都装了）；没有就不重排。"""
    try:
        import forum_scores
    except ImportError:
        return None
    return forum_scores


FORUM = _forum()
EXISTING = _existing_mod()
EXP_INIT = 2  # ExpeL §4.2「initial importance count of two」


def exp_id(rel, line):
    """条目的稳定编号 = 页 + 这行内容的指纹（ACE §3.1 每条有 unique identifier）；页改了行号也不串分。"""
    return f"{rel}#{hashlib.sha1(_bare(line).encode()).hexdigest()[:10]}"


def _row(rel, line, text, group="", root=None, ln=0):
    """推送的一条：id 就是行尾 [#编号]（同 exp_tag），group 是定案块里它上面那行页路径。
    给了行号就把这条的原文（这行加它下面缩进的续行）按编号存进正文库，`bothouse ctx <编号>` 取得到。"""
    h = exp_id(rel, line).rpartition("#")[2]
    if ln:
        stash(h, lambda: _entry_body(rel, line, root, ln))
    return {"id": "#" + h, "text": text, "group": group}


def _entry_body(rel, line, root, ln):
    """wiki 一条的正文：出处「页:行号」、这行、它下面缩进的续行（踩坑记录等），到下一条为止。"""
    out = [f"{_shown(rel, root)}:{ln}", line.rstrip()]
    try:
        rest = ((root or WIKI) / rel).read_text(encoding="utf-8", errors="ignore").split("\n")[int(ln):]
    except (OSError, ValueError, TypeError):
        rest = []
    for x in rest:
        if not x.startswith((" ", "\t")) or sum(map(len, out)) > ENTRY_CHARS:
            break
        out.append(x.rstrip())
    return "\n".join(out)


def _render(it):
    """desc 由 head + rows 拼出（桥按 id 滤掉塞过的 rows 后用同一规则重拼，core/turnctx_dedup.go renderRows）：
    head 非空打头；每行前若 group 变了先写 group；各段用 sep 连。"""
    parts, last = ([it["head"]] if it.get("head") else []), ""
    for r in it["rows"]:
        if r.get("group") and r["group"] != last:
            parts.append(r["group"])
            last = r["group"]
        parts.append(r["text"])
    it["desc"] = it["sep"].join(parts)
    return it


# ---- 推过的不再推：「推什么」和「推过没有」都在这里管（用户 11-03：两件事拆在两个程序里是根因）----
# 按（会话 key, 角色 bot, 会话代号 epoch）记推过的条目编号。epoch 由调用方给，/new、换会话、压缩后换一个新值
# （桥：core/gate.go turnEpoch；DSH：gate-context.mjs；终端 hook：session_id + 压缩次数）。不带 epoch 的旧调用方照旧全给。
# 同页的新编号照推，旧编号不重推；页下条目全推过就整页不推。没有编号的块（身份、手册、常驻做法、任务板、投票提示）
# 整块一个 id（path+desc 的哈希），内容变了才重推。只记在内存：推送服务重启后每个会话最多重推一轮。
PUSH_GAP = 20  # 推过的条隔 20 轮内不再推，超过就重推（作者 11-03 定）
PUSHED_KEEP = 4000  # 最多记这么多个（会话, 代号）；按最近使用淘汰
_pushed, _pushed_lock = collections.OrderedDict(), threading.Lock()


def _rows_of(w):
    if "rows" in w:
        return w
    h = hashlib.sha1((w.get("path", "") + "\0" + w.get("desc", "")).encode()).hexdigest()[:16]
    return dict(w, head="", sep="\n", rows=[{"id": "txt:" + h, "text": w.get("desc", ""), "group": ""}])


# ---- 目录 + 按需取正文（用户 11-04「做」：所有塞进去的材料只给「标题加一句话加编号」，正文 AI 要用时按编号取；
# 内容变了只补变的那几行，不整块重推。通用：不按任务、按角色裁，所有块走同一条路）----
# 整块正文的条（身份、手册、常驻做法、画像、任务板、投票提示……，没有 rows 的）一律折成一行目录：标题 — 一句话 [#编号]，
# 正文按编号存进 <数据目录>/ctx/<编号>.md，`bothouse ctx <编号>` 取（桥的旧会话交接也存这里，core/ctxstore.go）。
# wiki 命中行本来就是「一句话 + [#编号]」，照旧；原文同样存进正文库（_row）。
CTX_CMD = os.environ.get("BOTHOUSE_CTX_CMD") or "bothouse ctx"  # 取正文的命令；桥拉起 gate 时传它自己的可执行文件
INLINE_CHARS = 200  # 正文不超过这么多字就原样给（折成目录也省不了几个字）
BRIEF_CHARS = 120  # 一句话的上限
ENTRY_CHARS = 2000  # wiki 一条连续行存进正文库的上限
DIFF_SHARE = 0.5  # 变了的行超过这个比例就当整块重写：只给新目录行，不逐行补
STORE_KEEP_DAYS = 14  # 正文库里多久没再写的文件清掉
HOWTO = {"path": "【取正文】", "desc": f"下面的材料只给标题和 [#编号]；要正文跑 `{CTX_CMD} <编号>`（一次可写多个），用到再取"}


def store_dir():
    """正文库目录：<数据目录>/ctx（同 core/ctxstore.go ctxStoreDir）；datadir 没装（终端 hook 只装了 ctxsvc）就 None。"""
    try:
        import datadir
    except ImportError:
        return None
    return Path(getattr(datadir, "guard", lambda p: p)(datadir.data_dir())) / "ctx"  # 旧 datadir 没有 guard


_pruned = [0.0]


def stash(cid, body):
    """编号 cid 的正文写进正文库（body 可以是函数，库里已有就不调）。写坏了不挡推送。"""
    d = store_dir()
    if d is None:
        return
    f = d / f"{cid}.md"
    try:
        if f.exists():
            os.utime(f)
            return
        d.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(body() if callable(body) else body, encoding="utf-8")
        os.replace(tmp, f)
        if time.time() - _pruned[0] > 3600:
            _pruned[0] = time.time()
            old = time.time() - STORE_KEEP_DAYS * 86400
            for x in d.glob("*.md"):
                if x.stat().st_mtime < old:
                    x.unlink(missing_ok=True)
    except OSError:
        pass


def _doc_name(path):
    """块的稳定名字：path 去掉末尾的内容指纹（「【任务板 4bb6e8】」→「【任务板】」），内容变了还认得是同一块。"""
    return re.sub(r"\s+[0-9a-f]{6}】$", "】", path)


def brief(desc):
    """一块正文的一句话：有两个以上小标题（## / ###）就列小标题，否则取第一行正文；超长截断（全文按编号取）。"""
    rows = [x.strip() for x in desc.split("\n") if x.strip()]
    heads = [re.sub(r"^#+\s*", "", x) for x in rows if re.match(r"^#{2,3}\s", x)]
    s = "；".join(heads) if len(heads) >= 2 else next((x for x in rows if not x.startswith("#")), "")
    s = s if len(s) <= BRIEF_CHARS else s[:BRIEF_CHARS] + "…"
    return f"{s}（全文 {len(rows)} 行）"


def _line_id(x):
    return "L" + hashlib.sha1(_bare(x).encode()).hexdigest()[:12]


# 懂你画像不折（#1318）：它要管这一轮怎么说话，折成标题角色不会去取（11-10 隔离实测：新手阿博问「什么是数据库索引」，
# 只收到「【懂你 阿博】— 全文 9 行」，回了一句话，和只要结论的阿丽一样）。一页约 20 行，同一版一个会话只推一次（only_new）。
PROFILE_HEAD = "【懂你 "
# 任务板也不折（#1372）：它是本频道在做什么、做到哪的现状，折成「本频道的事和等用户的事（全文 4 行）」角色不会去取。
# 11-10 agentm：用户问「性能分析完成了吗」「GPU 任务挂上去了吗」，板上 #41 写着「已启动 GPU3/6」，主角色看不到，
# 在频道里跑 4–8 步登服务器重查，答「还不能确认」。板子只列本频道和等用户的条目，别处只计数，本来就短。
NO_FOLD_HEADS = (PROFILE_HEAD, "【任务板 ")


def as_doc(w):
    """整块正文的条 → 目录条（带 doc/name/cid，only_new 用来逐行比对）；有 rows 的、短的原样返回。"""
    desc = w.get("desc", "")
    if "rows" in w or len(desc) <= INLINE_CHARS or str(w.get("path", "")).startswith(NO_FOLD_HEADS):
        return w
    cid = hashlib.sha1((w.get("path", "") + "\0" + desc).encode()).hexdigest()[:8]
    stash(cid, lambda: f"{w.get('path', '')}\n{desc}\n")
    return {"path": w.get("path", ""), "desc": f"{brief(desc)} [#{cid}]", "doc": desc,
            "name": _doc_name(w.get("path", "")), "cid": cid}


def _doc_diff(w, before):
    """块 w 比上次推的（before = 行编号列表）变了哪些行 → 一条「有变动」，只列新增/改了的行和删了的行；变太多给目录行。"""
    rows = [x for x in w["doc"].split("\n") if x.strip()]
    old = set(before)
    add = [x for x in rows if _line_id(x) not in old]
    now = {_line_id(x) for x in rows}
    gone = len(old - now)
    if not add and not gone:
        return None
    if len(add) + gone > DIFF_SHARE * max(len(rows), 1):
        return {"path": w["path"], "desc": "整块改过，" + w["desc"]}
    head = f"只列改了的 {len(add)} 行" + (f"、删了 {gone} 行" if gone else "") + f"，全文 [#{w['cid']}]"
    return {"path": w["name"][:-1] + " 有变动】", "desc": "\n".join([head] + add)}


def _hit_page(w):
    """wiki 命中页（主 wiki、角色 wiki、经验）：path 是页路径，不是「【…】」块；TURN_ROWS 只数这些。"""
    return "rows" in w and not str(w.get("path", "")).startswith("【")


def _cap(w, rows, left):
    """命中页的新条按 TURN_ROWS 剩余额度截断（hits 按相关度排，丢后面的）。"""
    return rows[:max(left, 0)] if _hit_page(w) else rows


def only_new(out, req):
    items = [as_doc(w) for w in out.get("wiki", [])]
    if any("cid" in w for w in items):  # 有折成目录的块才说怎么取（wiki 命中行带页路径和行号，照旧能按行号读）
        items.insert(0, HOWTO)
    epoch = str(req.get("epoch") or "")
    if not epoch:
        plain, left = [], TURN_ROWS
        for w in items:
            if _hit_page(w):
                rows = _cap(w, w["rows"], left)
                left -= len(rows)
                if not rows:
                    continue
                w = _render(dict(w, rows=rows)) if rows != w["rows"] else w
            plain.append(_plain(w))
        return dict(out, wiki=plain)
    k = (req.get("key") or "", req.get("bot") or "", epoch)
    keep = []
    with _pushed_lock:
        seen = _pushed.get(k)
        if seen is None:
            seen = _pushed[k] = {}  # 条目编号 → 上次推的轮次；"#" 记本会话轮次；"doc:<名>" → 上次推的那块的行编号
            while len(_pushed) > PUSHED_KEEP:
                _pushed.popitem(last=False)
        _pushed.move_to_end(k)
        n = seen["#"] = seen.get("#", 0) + 1
        left = TURN_ROWS
        for w in items:
            if "doc" in w:
                dk, ck = "doc:" + w["name"], "cat:" + w["name"]
                lines = [_line_id(x) for x in w["doc"].split("\n") if x.strip()]
                before = seen.get(dk)
                seen[dk] = lines
                if before is None or n - seen.get(ck, n) >= PUSH_GAP:
                    seen[ck] = n
                    keep.append(_plain(w))
                elif (d := _doc_diff(w, before)) is not None:
                    seen[ck] = n
                    keep.append(d)
                continue
            hit, w = _hit_page(w), _rows_of(w)
            rows = [r for r in w["rows"] if seen.get(r["id"]) is None or n - seen[r["id"]] >= PUSH_GAP]
            if hit:
                rows = rows[:max(left, 0)]  # 超额的不记推过，下一轮还能推
                left -= len(rows)
            for r in rows:
                seen[r["id"]] = n
            if rows:
                keep.append(_render(dict(w, rows=rows)) if rows != w["rows"] else w)
    if [w.get("path") for w in keep] == [HOWTO["path"]]:  # 只剩怎么取：这轮没有要推的
        keep = []
    return dict(out, wiki=keep)


def _plain(w):
    """目录条推出去只留 path/desc（doc 正文不出 gate）。"""
    return {"path": w["path"], "desc": w["desc"]} if "doc" in w else w


def only_new_file(items, key, epoch, state_dir):
    """终端 hook 用（每轮一个新进程，内存记不住）：同 only_new，推过的编号存 state_dir/<key>.json，代号变了清空。"""
    f = Path(state_dir) / (str(key).replace("/", "_").replace("\\", "_") + ".json")
    try:
        st = json.loads(f.read_text())
        if not isinstance(st, dict):
            st = {}
    except (OSError, ValueError):
        st = {}
    k = (str(key), "", str(epoch))
    with _pushed_lock:
        ids = st.get("ids", {}) if st.get("epoch") == str(epoch) else {}
        _pushed[k] = dict(ids) if isinstance(ids, dict) else {}  # 旧格式（编号列表）不认，重推一轮
    out = only_new({"wiki": items}, {"key": str(key), "bot": "", "epoch": str(epoch)})["wiki"]
    with _pushed_lock:
        ids = _pushed.pop(k, {})
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"epoch": str(epoch), "ids": ids}))
    return out


def transcript_epoch(sid, transcript):
    """终端会话代号：session_id（/clear 会换）+ 会话记录里压缩摘要的条数（压缩后变）。"""
    n = 0
    try:
        with open(transcript, "rb") as fh:
            n = fh.read().count(b'"isCompactSummary":true')
    except (OSError, TypeError):
        pass
    return f"{sid}:{n}"


def exp_tag(rel, line):
    """推送行尾的条目编号（ACE §3.1 bullet id）：助手用到哪条就按它当场投票（memvote.py）。"""
    return f" [#{exp_id(rel, line).rpartition('#')[2]}]"


EXP_TAG = re.compile(r" \[#([0-9a-f]{10})\]")
# 照抄 ACE Generator（arXiv 2510.04618 附录提示词）：「Pay attention to common mistakes listed in the playbook and avoid
# them」，回答时报出「bullet_ids … relevant, helpful」。五家 CLI 都有 shell，所以报编号用命令，不改各家回复格式。
VOTE_ITEM = {"path": "【记忆投票（每轮必做）】", "desc": (
    f"回复前给真正用到的定案、经验条投票：做对了 `python3 {_shown(MEMVOTE, Path('/'))} +编号`，错了或过时 `-编号`（只投行尾 10 位 [#编号]；页面和卡片行尾的 8 位编号是取正文用的，不投）。\n"
    "推给你的记忆只给标题和行尾 [#编号]，正文用取正文的命令取，或按页路径和行号读。编号所有角色、所有频道共用一份分数。开工前照这些条做，特别是写着踩过的坑，避开它。"
    "投票是这一轮任务的一部分：回复发出前，先用 shell 给你真正用到的条投票，再回复——"
    f"照它做对了 `python3 {_shown(MEMVOTE, Path('/'))} +编号`；内容错了或过时、照它做会错 `… -编号`；"
    "投错了改投反向即可，撤回用 `… x编号`；没用到的不投。一次可写多个编号，每人每条只算一票")}


def exp_alive(rel, line, root=None):
    """root 是别的库（角色 wiki）时，编号里的页写成推送路径（~/…），同 _refs 记推送、forum_scores.page_key。"""
    if root is not None and WIKI is not None and not _same(root, WIKI):
        rel = _shown(rel, root)
    return exp_scores().get(exp_id(rel, line), EXP_INIT) > 0


def exp_is_user(text):
    q = query(text)
    return bool(q) and not _NOT_USER.search(q) and "（定时任务" not in text


def exp_task(key):
    """这个频道当前在做的那件活：本频道的、没暂停、不是测试活，取最近交出/绑定的一件。"""
    if board is None or not key:
        return None
    its = [i for i in board.items() if board.in_chat(i, key) and not i.get("paused") and not i.get("backlog") and not board.is_test(i.get("what"))]
    return max(its, key=lambda i: (i.get("bound") or "", i.get("id") or 0), default=None)


def _refs(items):
    """推出去的条目 → ["相对主 wiki 的页:行号", …]（命中行和定案块里的行）。"""
    base = _shown(".").removesuffix("/.") + "/"
    out = []
    for w in items:
        p, d = w.get("path", ""), w.get("desc", "")
        if p.startswith("【"):
            if "定案" not in p and "已定的方向" not in p and "经验" not in p:
                continue
            rel = None
            for ln in d.split("\n")[1:]:
                m = re.match(r"\s+(\d+):", ln)
                if m and rel:
                    out.append(_ref_id(rel, m.group(1)))
                elif ln and not ln.startswith(" "):
                    rel = ln.strip()
        else:
            rel = p[len(base):] if p.startswith(base) else p
            out += [_ref_id(rel, n) for n in re.findall(r"\| (\d+): ", d)]
    return out


def _ref_id(rel, n):
    """推送时就记下这行内容的指纹：「页:行号#指纹」，晚上打分按指纹认条，不怕白天改页挪了行。"""
    try:
        line = (WIKI / rel).read_text(encoding="utf-8", errors="ignore").split("\n")[int(n) - 1]
    except (OSError, ValueError, IndexError, TypeError):
        return f"{rel}:{n}"
    return f"{rel}:{n}#{exp_id(rel, line).rpartition('#')[2]}"


def exp_log(key, bot, text, items, tq="", ep=""):
    it = exp_task(key) if not bot else None
    rec = {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "key": key, "bot": bot, "user": exp_is_user(text),
           "task": it.get("id") if it else None, "q": query(text)[:600], "refs": _refs(items)}
    if ep:
        rec["ep"] = ep  # 会话代号（only_new）：同一代号内 refs 不重复
    if tq and tq != rec["q"]:
        rec["qx"] = tq[:1200]  # 实际检索用的查询（带了前两轮），夜间打分仍按 q 认这轮
    with open(EXP / "push.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
