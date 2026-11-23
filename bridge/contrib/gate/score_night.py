#!/usr/bin/env python3
"""记忆论坛夜间结算：只认外部信号（bothouse 每晚定时跑一次，core/setup_wiki.go AddForumCronJob）。

  用没用上 = 角色自报引用（memvote.py 的 by=self 行，照 ACE 官方代码 Generator 自报 bullet_ids，ace/logger.py）。
  有没有用 = 外部信号：被引用的那一轮，用户下一句不是纠正 → 这条记一次成功；是纠正 → 记一次失败
            （MemOS mem_feedback：用户纠正带着那轮 retrieved_memory_ids，https://memos-docs.openmem.net/open_source/modules/mem_feedback/）。
            成功/失败记成 by=outcome 的赞/踩（memvote.outcome），交给现有 Wilson 排序和 reddit 折叠阈值（同目录 forum_scores.py）。
  过时   = 用户纠正的那一轮，用户那句纠正和那轮推过的条目走写入时冲突检测（主 wiki 的 bin/invalidate.py，照 Graphiti），
            被推翻的旧行原样挪进同页「## 历史」并提交 wiki。主 wiki 没有 bin/invalidate.py（不是这套 llmwiki）就跳过这步。
模型只判「next 是不是纠正」（只看 q、next 两句，CORRECT_PROMPT + --output-schema），不评判条目。
每一轮 = 用户那句话（所有角色、所有频道和工作区）+ 同频道用户下一句。还没有下一句的轮留到下次跑。
事情本身失败（11-07 用户「可以」）= 也记成失败，不等用户开口；都读机械记录，不让模型评判：
  rework 活被退回返工（<任务板目录>/board-done.jsonl rework>0：那件活所在会话、开活到最后交回之间的轮）；
  blocked 被守卫拦下（Claude 会话记录里的「Stop hook feedback」和工具调用前后钩子报的 hook error）；
  cmd_fail 命令跑失败（Claude「Exit code 非 0」、Codex「Process exited with code 非 0」；退出码 1 又没输出的不算，多是 grep 没搜到）。
  五家读法（11-07 补齐 Codex 的被拦、agy 和 DSH 的被拦与命令失败）：
    Claude  ~/.claude/projects/<数据目录/roles 编码>-*/*.jsonl：「Stop hook feedback」、「PreToolUse:… hook error」、「Exit code N」
    Codex   ~/.codex/sessions：用户行 <hook_prompt hook_run_id="stop:…>、「Command blocked by PreToolUse hook」、「Process exited with code N」
    agy     ~/.gemini/antigravity-cli/brain/<会话>/.system_generated/logs/transcript_full.jsonl：
            「Stop hook blocked termination」、「denied by pre-tool hook」、「(The command|Command) exited with code N.」
    DSH     ~/.dsh/sessions/*/<会话>/session.v4.jsonl.zstd（多帧 zstd，用 node 跑同目录 dshcat.js 解）：
            hook/result decision=deny/block、工具结果末尾「[exit code: N]」
    只有对话快照、没有工具和钩子事件的角色（如 grok），只认用户纠正和返工。
  会话记录按每条用户消息头里的 platform/chat_id 落到频道；agy、DSH 的提示多数不带头，按桥会话表
  <数据目录>/sessions/*.json（user_sessions → agent_session_id/past_agent_session_ids）落到频道；再按时间落到那一轮。
  一轮有几种信号都只记一次失败。
当晚统计追加 nightly.jsonl；每轮的判断追加 tags.jsonl（离线回放用，signals 记失败来自哪几种信号）。

  score_night.py [--dry]      处理上次跑过之后的记录；--dry 只打印不写
  score_night.py --replay F   从头判全部历史，写到 F，不动票和进度
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path

EXP = Path(__file__).resolve().parent  # bothouse 装的 gate 目录（<数据目录>/gate，ctxsvc 把推送记录写在这）
DATA = Path(os.environ.get("MEMVOTE_DIR") or EXP)  # 隔离测试时指到副本目录（同 memvote.py）
PUSH = DATA / "push.jsonl"
VOTES = DATA / "votes.jsonl"
STATE = DATA / "score-state.json"
NIGHT = DATA / "nightly.jsonl"
TAGS = DATA / "tags.jsonl"
WIKI = Path(os.environ.get("GATE_WIKI") or "~/wiki").expanduser()  # 同 memvote.py；隔离测试指到 wiki 副本
MAX_CHARS = 240_000  # 沿用 wiki 的 bin/ingest.py MAX_CHARS：每次 model 调用的输入上限
MODEL = os.environ.get("WIKI_CODEX_MODEL", "")
DEFAULT_BOT = os.environ.get("GATE_DEFAULT_BOT", "assistant")
HOME = Path.home()


def _data_dir():
    """数据目录（BOTHOUSE_DATA_DIR / CC_DATA_DIR，默认 ~/.bothouse），用时才取：测试守卫在 datadir.guard 里。"""
    sys.path.insert(0, str(EXP))
    import datadir
    return datadir.data_dir()


def claude_logs():
    """角色目录下跑的 Claude 会话目录。Claude 把项目路径里非字母数字都换成 -：<数据目录>/roles/<角色> → -Users-me--bothouse-roles-<角色>。"""
    env = [Path(x) for x in os.environ.get("SCORE_CLAUDE_LOGS", "").split(os.pathsep) if x]
    if env:
        return env
    return sorted((HOME / ".claude/projects").glob(re.sub(r"[^A-Za-z0-9]", "-", str(_data_dir() / "roles")) + "-*"))


CODEX_LOGS = Path(os.environ.get("SCORE_CODEX_LOGS") or HOME / ".codex/sessions")
AGY_LOGS = Path(os.environ.get("SCORE_AGY_LOGS") or HOME / ".gemini/antigravity-cli/brain")
DSH_LOGS = Path(os.environ.get("SCORE_DSH_LOGS") or HOME / ".dsh/sessions")
NODE = os.environ.get("SCORE_NODE") or shutil.which("node") or "node"


WS_START = "你是工作区频道里的主角色"  # ws-handoff 叫醒工作区的开头（同 ctxsvc._NOT_USER）
sys.path.insert(0, str(EXP))
import memvote  # 引用（by=self）和成功/失败（by=outcome）都记在 votes.jsonl

_FLOOR_TAG = re.compile(r"\s*<!-- 帖 t[0-9a-f]{10}·\d+楼.*?-->\s*$")  # 楼层帖标注（#1177，同 forum_scores.TAG）：算编号、显示时去掉


def _bare(s):
    return _FLOOR_TAG.sub("", s).strip()


if (WIKI / "bin" / "invalidate.py").is_file():
    sys.path.insert(0, str(WIKI / "bin"))
    import invalidate  # 写入时冲突检测（照 Graphiti），被推翻的旧行挪进同页「## 历史」
else:
    invalidate = None


def _chat_of(task):
    """工作区那件活交回到哪个聊天频道（任务板条目的 chat），找不到就 None。"""
    try:
        sys.path.insert(0, str(EXP))
        import board
        for it in board.items():
            if it.get("id") == task:
                return it.get("chat")
    except Exception:
        return None
    return None


def turns(since):
    """一轮 = 一条用户消息或一次工作区开工（五个角色、所有聊天频道和工作区都算）。
    同一频道同一句话各角色都推了：合成一轮、推过的条取并集（一句话不该让同一条被投好几票）。
    反馈 = 同频道用户下一句；工作区开工轮 = 同会话下一条（对它的回复），没有就取交回的聊天频道里用户下一句。"""
    recs = []
    try:
        lines = PUSH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for ln in lines:
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        r["ts"] = time.mktime(time.strptime(r["t"], "%Y-%m-%d %H:%M:%S"))
        r["ws"] = r.get("q", "").startswith(WS_START)
        if r.get("user") or r["ws"]:
            recs.append(r)
    by = {}
    for r in recs:
        by.setdefault(r["key"], []).append(r)
    merged = {}
    for key, rs in by.items():
        users = [r for r in rs if r.get("user")]
        for a in rs:
            if a["ts"] <= since:
                continue
            if a["ws"]:
                b = next((r for r in rs if r["ts"] > a["ts"]), None)
                chat = None if b else _chat_of(a.get("task"))
                if chat:
                    b = next((r for r in by.get(chat, []) if r.get("user") and r["ts"] > a["ts"]), None)
            else:
                b = next((r for r in users if r["ts"] > a["ts"] and r["q"] != a["q"]), None)
            if b is None:  # 还没有下一句，留到下次
                continue
            m = merged.setdefault((key, a["q"]), {"key": key, "t": a["t"], "ts": a["ts"], "task": a.get("task"),
                                                   "q": a["q"], "next": b["q"], "bots": [], "refs": []})
            m["bots"].append(a.get("bot") or DEFAULT_BOT)
            m["refs"] += a.get("refs") or []
            m["end"] = max(m.get("end", 0), b["ts"])
    out = list(merged.values())
    for t in out:
        t["refs"] = list(dict.fromkeys(t["refs"]))
    return sorted(out, key=lambda x: x["ts"])


HEAD = re.compile(r"platform=(\w+) chat_id=([^\s\]]+)")  # 桥给每条用户消息加的头（[bothouse sender_id=… platform=… chat_id=…]）
EXIT = re.compile(r"Process exited with code (-?\d+)")
AGY_EXIT = re.compile(r"(?:^|completed with result:\n)Created At:[^\n]*\n(?:Completed At:[^\n]*\n)?\s*"
                      r"(?:The command|Command) exited with code (-?\d+)\.(.*)", re.S)
DSH_EXIT = re.compile(r"\[exit code: (-?\d+)\]\s*$")


def _fail_out(code, out):
    """退出码非 0 才算；退出码 1 又没输出（grep 没搜到、test 为假）不算。"""
    return code not in ("0", None) and not (code == "1" and not out.strip())


def agent_keys():
    """桥会话表：各家 CLI 自己的会话 id → 频道（platform:chat_id）。"""
    m = {}
    sessions = Path(os.environ["SCORE_SESSIONS"]) if os.environ.get("SCORE_SESSIONS") else _data_dir() / "sessions"
    for f in sessions.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        ss = d.get("sessions") or {}
        for key, sids in (d.get("user_sessions") or {}).items():
            for sid in sids or []:
                s = ss.get(sid) or {}
                for a in [s.get("agent_session_id")] + list(s.get("past_agent_session_ids") or []):
                    if a:
                        m[a] = key
    return m


def agy_events(since, amap):
    """彩虹猫（agy）transcript_full.jsonl 里的失败事件。"""
    out = []
    for f in AGY_LOGS.glob("*/.system_generated/logs/transcript_full.jsonl"):
        try:
            if f.stat().st_mtime < since:
                continue
            fh = open(f, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        key = amap.get(f.parts[-4])
        with fh:
            for ln in fh:
                if not ("chat_id=" in ln or "exited with code" in ln or "Stop hook blocked" in ln
                        or "denied by pre-tool hook" in ln):
                    continue
                try:
                    r = json.loads(ln)
                except ValueError:
                    continue
                c = r.get("content") if isinstance(r.get("content"), str) else ""
                ty = r.get("type")
                if ty == "USER_INPUT":
                    h = HEAD.search(c)
                    if h:
                        key = f"{h.group(1)}:{h.group(2)}"
                    continue
                ts = _iso(r.get("created_at"))
                if not key or ts is None or ty not in ("GENERIC", "SYSTEM_MESSAGE"):
                    continue
                if "Stop hook blocked termination" in c or (r.get("status") == "ERROR" and "denied by pre-tool hook" in c):
                    out.append((key, ts, "blocked", "agy"))
                    continue
                m = AGY_EXIT.search(c[:4000])
                if m:
                    o = re.split(r"\nLog: file:|</SYSTEM_MESSAGE>", m.group(2))[0]
                    o = re.sub(r"^\s*(?:Command output|Output):", "", o.strip())
                    if _fail_out(m.group(1), o):
                        out.append((key, ts, "cmd_fail", "agy"))
    return out


def dsh_events(since, amap):
    """鲸鱼娘（DSH）session.v4.jsonl.zstd 里的失败事件；node 跑 dshcat.js 解多帧 zstd。"""
    fs = [str(f) for f in DSH_LOGS.glob("*/*/session.v4.jsonl.zstd") if f.stat().st_mtime >= since]
    if not fs:
        return []
    try:
        raw = subprocess.run([NODE, str(EXP / "dshcat.js"), *fs], capture_output=True, text=True, timeout=600).stdout
    except (OSError, subprocess.SubprocessError) as e:
        print(f"DSH 会话没解出来：{e}", file=sys.stderr)
        return []
    out, keys = [], {}
    for ln in raw.splitlines():
        f, _, j = ln.partition("\t")
        if not ("chat_id=" in j or '"hook/result"' in j or "[exit code:" in j):
            continue
        try:
            r = json.loads(j)
        except ValueError:
            continue
        d, ty = r.get("data") or {}, r.get("type")
        if f not in keys:
            keys[f] = amap.get(Path(f).parent.name)
        if ty == "user/message":
            h = HEAD.search(_text(d.get("content")))
            if h:
                keys[f] = f"{h.group(1)}:{h.group(2)}"
            continue
        key, ts = keys[f], (r.get("time") or 0) / 1000 or None
        if not key or ts is None:
            continue
        if ty == "hook/result" and d.get("decision") in ("deny", "block"):
            out.append((key, ts, "blocked", "dsh"))
        elif ty == "tool/result":
            t = _text((d.get("message") or {}).get("content"))
            m = DSH_EXIT.search(t)
            if m and _fail_out(m.group(1), t[:m.start()]):
                out.append((key, ts, "cmd_fail", "dsh"))
    return out


def _iso(x):
    """ISO 时间（带 Z 或 +09:00）→ 秒。"""
    from datetime import datetime
    try:
        return datetime.fromisoformat(x.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError, TypeError):
        return None


def _text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(b.get("text") or "" for b in c if isinstance(b, dict))
    return ""


def err_kind(t):
    """Claude 一条出错的工具结果算哪种信号：守卫钩子拦下 → blocked；命令退出码非 0 → cmd_fail；
    退出码 1 且没有输出（grep 没搜到、test 为假）、找不到文件、被打断这些不算。"""
    if re.match(r"(PreToolUse|PostToolUse):\w+ hook error", t):
        return "blocked"
    m = re.match(r"Exit code (\d+)\n?(.*)", t, re.S)
    if m and m.group(1) != "0" and not (m.group(1) == "1" and not m.group(2).strip()):
        return "cmd_fail"
    return None


def log_events(since):
    """会话记录里的失败事件 [(频道, 秒, 种类)]。只扫 since 之后改过的文件，只解析含关键字的行。"""
    out = []
    files = [f for d in claude_logs() for f in d.glob("*.jsonl")] + [(f, "codex") for f in CODEX_LOGS.rglob("*.jsonl")]
    for f in files:
        f, kind = (f if isinstance(f, tuple) else (f, "claude"))
        try:
            if f.stat().st_mtime < since:
                continue
            fh = open(f, encoding="utf-8", errors="ignore")
        except OSError:
            continue
        key, uses = None, {}
        with fh:
            for ln in fh:
                if not ("chat_id=" in ln or "Stop hook feedback" in ln or '"is_error":true' in ln
                        or "Process exited with code" in ln or "hook_prompt" in ln or "Command blocked by" in ln):
                    continue
                try:
                    r = json.loads(ln)
                except ValueError:
                    continue
                ts = _iso(r.get("timestamp"))
                if kind == "claude":
                    m = r.get("message") or {}
                    if r.get("type") != "user" or m.get("role") != "user":
                        continue
                    c = m.get("content")
                    t = _text(c)
                    h = HEAD.search(t)  # 只看文字块：工具输出里出现的 chat_id 不算
                    if h:
                        key = f"{h.group(1)}:{h.group(2)}"
                    if not key or ts is None:
                        continue
                    if isinstance(c, str) and c.startswith("Stop hook feedback"):
                        out.append((key, ts, "blocked", "claude"))
                    for b in c if isinstance(c, list) else []:
                        if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"):
                            k = err_kind(_text(b.get("content")) if isinstance(b.get("content"), list) else str(b.get("content") or ""))
                            if k:
                                out.append((key, ts, k, "claude"))
                else:
                    p = r.get("payload") or {}
                    if p.get("type") == "message" and p.get("role") == "user":
                        t = _text(p.get("content")) if isinstance(p.get("content"), list) else ""
                        h = HEAD.search(t)
                        if h:
                            key = f"{h.group(1)}:{h.group(2)}"
                        elif t.startswith('<hook_prompt hook_run_id="stop:') and key and ts is not None:
                            out.append((key, ts, "blocked", "codex"))  # Stop 钩子拦下、要求重写
                    elif p.get("type") == "function_call_output" and key and ts is not None:
                        o = p.get("output") if isinstance(p.get("output"), str) else ""
                        if o.startswith("Command blocked by PreToolUse hook"):
                            out.append((key, ts, "blocked", "codex"))
                            continue
                        e = EXIT.search(o)
                        if e and _fail_out(e.group(1), o.split("Output:", 1)[-1]):
                            out.append((key, ts, "cmd_fail", "codex"))
    amap = agent_keys()
    return out + agy_events(since, amap) + dsh_events(since, amap)


def _board_done():
    """做完的活记在任务板目录的 board-done.jsonl（同 board.py；SCORE_BOARD_DONE 可指到副本）。"""
    if os.environ.get("SCORE_BOARD_DONE"):
        return Path(os.environ["SCORE_BOARD_DONE"])
    import board
    return board.DIR / "board-done.jsonl"


def rework_spans():
    """返工的活 [(会话, 开活秒, 最后交回秒)]：board done 记的 rework>0；会话取工作区（ws_was），没有就取 sk。"""
    out = []
    for r in memvote._recs(_board_done()):
        if not (r.get("rework") or 0) > 0:
            continue
        key = r.get("ws_was") or r.get("sk")
        a = r.get("at")
        try:
            start = time.mktime(time.strptime(f"{time.strftime('%Y')}-{a}", "%Y-%m-%d %H:%M")) if a else None
        except ValueError:
            start = None
        start = min(x for x in (start, _iso(r.get("bound"))) if x is not None) if (start or _iso(r.get("bound"))) else None
        end = _iso(r.get("returned_at")) or _iso(r.get("review_accepted_at"))  # 交回后工作区就放给别的活了
        if key and start and end and end > start:
            out.append((key, start, end))
    return out


def mark_signals(ts):
    """给每轮挂上 signals（rework / blocked / cmd_fail，去重后排序）。"""
    if not ts:
        return
    lo = min(t["ts"] for t in ts) - 86400
    ev, sp = log_events(lo), rework_spans()
    for t in ts:
        hit = [(k, src) for key, x, k, src in ev if key == t["key"] and t["ts"] <= x < t["end"]]
        sig = {k for k, _ in hit}
        if any(key == t["key"] and a <= t["ts"] <= b for key, a, b in sp):
            sig.add("rework")
        t["signals"] = sorted(sig)
        t["signal_src"] = sorted({f"{src}:{k}" for k, src in hit} | ({"board:rework"} if "rework" in sig else set()))


def _hash(line):
    return hashlib.sha1(_bare(line).encode()).hexdigest()[:10]  # 和 ctxsvc.exp_id 同算法


def resolve(ref):
    """push.jsonl 里的「页:行号#指纹」→ (稳定编号「页#指纹」, 这行原文)。
    先按指纹在页里找（白天改页挪了行也找得到）；旧记录没有指纹，就取现在那一行（近似）。"""
    ref, _, h = ref.partition("#")
    rel, _, n = ref.rpartition(":")
    try:
        lines = (WIKI / rel).read_text(encoding="utf-8", errors="ignore").split("\n")
    except OSError:
        return None, ""
    if h:
        for ln in lines:
            if _hash(ln) == h:
                return f"{rel}#{h}", ln.strip()[:200]
        return f"{rel}#{h}", ""  # 这行已被改掉：照样认这条，但看不到原文
    try:
        ln = lines[int(n) - 1]
    except (ValueError, IndexError):
        return None, ""
    return f"{rel}#{_hash(ln)}", ln.strip()[:200]


CORRECT_PROMPT = """下面是若干「轮」：用户对助手说的一句话（q）、同一频道用户的下一句（next）。把 next 当作这一轮的反馈。逐轮判断：
- corrected：next 是不是用户在纠正助手（助手跑偏、做了没要的、违背以前定过的、该做没做、又问了已经定过的）。
  只是补充信息、换话题、表扬、闲聊都不算。
- repeat：如果是纠正，这件事是不是用户以前已经纠正过（这批前面的轮里纠正过，或 next 里说「又」「第二次」「说过了」）；不是纠正填 false。
每轮交回一个对象 {"i": 轮号, "corrected": bool, "repeat": bool}，放进 {"turns": [...]}。

"""

CORRECT_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["turns"], "properties": {"turns": {
    "type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["i", "corrected", "repeat"],
                               "properties": {"i": {"type": "integer"}, "corrected": {"type": "boolean"},
                                              "repeat": {"type": "boolean"}}}}}}
def render_qn(i, t):
    return f"## 轮 {i}（{t['t']}）\nq: {t['q']}\nnext: {t['next']}"


def batches(ts, prompt, fmt):
    cur, size = [], len(prompt)
    for t in ts:
        n = len(fmt(len(cur), t))
        if cur and size + n > MAX_CHARS:
            yield cur
            cur, size = [], len(prompt)
        cur.append(t)
        size += n
    if cur:
        yield cur


CALLS = [0]  # 本次跑调了几次模型（打印用）


def judge(batch, prompt, fmt, schema):
    """一批交 codex；--output-schema 固定输出格式（codex exec --help：Path to a JSON Schema file describing the
    model's final response shape）。返回 turns 列表。"""
    text = prompt + "\n\n".join(fmt(i, t) for i, t in enumerate(batch))
    CALLS[0] += 1
    with tempfile.NamedTemporaryFile("w", suffix=".json") as sf, tempfile.NamedTemporaryFile("r", suffix=".txt") as out:
        json.dump(schema, sf)
        sf.flush()
        r = subprocess.run(["codex", "exec", *(["-m", MODEL] if MODEL else []), "-c", "notify=[]", "--skip-git-repo-check",
                            "-s", "read-only", "--output-schema", sf.name, "-o", out.name, "-"],
                           input=text, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"codex 失败：rc={r.returncode} {r.stderr[-400:]}")
        return json.loads(Path(out.name).read_text(encoding="utf-8"))["turns"]


def cites():
    """角色自报的引用：[(会话, 时间, 编号, 票)]（votes.jsonl 里 by=self 的行）。"""
    out = []
    for r in memvote._recs(VOTES):
        if r.get("by") == "self":
            try:
                out.append((r.get("key"), time.mktime(time.strptime(r["t"], "%Y-%m-%d %H:%M:%S")), r.get("id"), r.get("vote")))
            except (KeyError, TypeError, ValueError):
                pass
    return out


def cited(t, cs):
    """这一轮里角色报了用到（+）的条：同会话、在这轮开始到用户下一句之间；同一条按最后一次报的算（x 撤回就不算）。"""
    last = {}
    for key, ts, cid, v in sorted(cs, key=lambda c: c[1]):
        if key == t["key"] and t["ts"] <= ts < t["end"]:
            last[cid] = v
    return [cid for cid, v in last.items() if v == 1]


def own_words(text):
    """用户那句话去掉开头的 [replying to …] 引用（引用的是助手的话，不是用户的事实；格式见 ctxsvc.query 的注释）。"""
    if text.startswith("[replying to ") and "]\n" in text:
        return text.split("]\n", 1)[1]
    return text


def full_line(ref):
    """push.jsonl 的「页:行号#指纹」→ (页, 现在这一行的原文)，找不到原文给空串。"""
    cid, _ = resolve(ref)
    if not cid:
        return None, ""
    rel, _, h = cid.rpartition("#")
    if rel.startswith("~"):
        return rel, ""
    try:
        for ln in (WIKI / rel).read_text(encoding="utf-8", errors="ignore").split("\n"):
            if _hash(ln) == h:
                return rel, ln
    except OSError:
        pass
    return rel, ""


def tag_turns(ts, log=None):
    """全部轮判 corrected/repeat（只看 q、next）。每轮出一行；log 给了就写进去。"""
    for t in ts:
        t["corrected"] = t["repeat"] = False
    for batch in batches(ts, CORRECT_PROMPT, render_qn):
        for v in judge(batch, CORRECT_PROMPT, render_qn, CORRECT_SCHEMA):
            if 0 <= v["i"] < len(batch):
                batch[v["i"]]["corrected"] = v["corrected"]
                batch[v["i"]]["repeat"] = v["corrected"] and v["repeat"]
    mark_signals(ts)
    cs = cites()
    for t in ts:
        row = {"t": t["t"], "key": t["key"], "bots": t.get("bots"), "q": t["q"][:200], "next": t["next"][:200],
               "corrected": t["corrected"], "repeat": t["repeat"], "signals": t.get("signals", []),
               "signal_src": t.get("signal_src", []), "cited": cited(t, cs)}
        if log:
            log.write(json.dumps(row, ensure_ascii=False) + "\n")
        row["_t"] = t
        yield row


def main(dry=False, replay=None):
    if replay:
        with open(replay, "w", encoding="utf-8") as fh:
            n = sum(1 for _ in tag_turns(turns(0), fh))
        print(f"判了 {n} 轮 → {replay}")
        return
    st = json.loads(STATE.read_text()) if STATE.exists() else {"since": 0}
    ts = turns(st["since"])
    stat = {"night": time.strftime("%Y-%m-%d %H:%M"), "turns": len(ts), "corrected": 0, "repeat": 0, "cited_turns": 0,
            "success": 0, "failure": 0, "history": 0, "by_day": {},
            "signals": {"rework": 0, "blocked": 0, "cmd_fail": 0}, "signal_only_failure": 0}
    t0 = time.time()
    outs, fixes = [], []  # [(会话, 轮时间, [(编号, ±1)])]、[(用户纠正, [(页, 原行)])]
    with open(TAGS if not dry else "/dev/null", "a", encoding="utf-8") as log:
        for row in tag_turns(ts, log):
            d = stat["by_day"].setdefault(row["t"][:10], {"turns": 0, "corrected": 0, "repeat": 0})
            d["turns"] += 1
            if row["corrected"]:
                stat["corrected"] += 1
                d["corrected"] += 1
                if row["repeat"]:
                    stat["repeat"] += 1
                    d["repeat"] += 1
                refs = [x for x in (full_line(r) for r in row["_t"]["refs"]) if x[0] and x[1]]
                if refs:
                    fixes.append((own_words(row["_t"]["next"]), list(dict.fromkeys(refs))))
            for k in row["signals"]:
                stat["signals"][k] += 1
            if row["cited"]:
                v = -1 if row["corrected"] or row["signals"] else 1  # 纠正、返工、被拦、命令失败：一轮只记一次失败
                if v < 0 and not row["corrected"]:
                    stat["signal_only_failure"] += len(row["cited"])
                outs.append((row["key"], row["t"], [(cid, v) for cid in row["cited"]]))
                stat["cited_turns"] += 1
                stat["failure" if v < 0 else "success"] += len(row["cited"])
    n, c, moved, pages = invalidate.run_lines(fixes, root=WIKI, dry=dry) if invalidate and fixes else (0, 0, [], [])
    CALLS[0] += c
    stat["history"] = n
    if pages and not dry:
        subprocess.run(["git", "add", "--", *pages], cwd=WIKI, check=True)
        subprocess.run(["git", "commit", "-qm", "记忆论坛：用户纠正推翻的条目挪进历史（score_night，照 Graphiti）",
                        "--", *pages], cwd=WIKI, check=True)
    stat["moved"] = [{"page": r, "line": l.strip()[:200], "by": f[:200]} for r, l, f in moved]
    print(json.dumps(stat, ensure_ascii=False))
    print(f"调模型 {CALLS[0]} 次，耗时 {time.time() - t0:.0f} 秒", file=sys.stderr)
    if dry:
        return
    for key, t, items in outs:
        memvote.outcome(items, key=key, turn=t)
    with open(NIGHT, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(stat, ensure_ascii=False) + "\n")
    if ts:
        STATE.write_text(json.dumps({"since": max(t["ts"] for t in ts)}))


if __name__ == "__main__":
    main(dry="--dry" in sys.argv, replay=sys.argv[sys.argv.index("--replay") + 1] if "--replay" in sys.argv else None)
