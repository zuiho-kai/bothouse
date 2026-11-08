#!/usr/bin/env python3
"""记忆论坛 Reflector（2026-11-01 #908，实验版，不合主干）：每轮结束后另起一次便宜模型调用，替这轮的角色给推过的记忆投票，
顺带把这轮回复里摸到的代码位置补进代码地图。挂在 gate 层（读 gate 的 push.jsonl + 桥存的会话记录），五家 CLI 通用，不靠各家 hook。

为什么：当场投票（memvote.py）只靠提示让助手自觉投，11-01 13:00 上线后推了约 100 次，只有橘投了 3 票；
地图回写只靠回复里写「## 地图要补的条目」一节 + Claude Code 的 SubagentStop hook，工作区主会话一轮结束不触发，回复里也从没写过这节。

照抄 ACE（arXiv 2510.04618）：
- §3.1 Reflector：Generator 每轮结束后，Reflector 看这一轮的轨迹，给用到的每条 bullet 标 helpful / harmful / neutral
  （附录 Reflector 提示词的 bullet_tags 输出：[{"id", "tag"}]）；没有标注答案时「leveraging natural execution feedback」——
  这里的执行反馈就是这一轮的回复本身（用户 11-01 03:09 否了工作区轮用「用户下一句」当反馈）。
- 标签 → 票：helpful 赞、harmful 踩、neutral 不投（同 score_night.vote）；记票照 Stack Overflow 规则（memvote.record：一角色一条一票，
  后一轮覆盖前一轮），by=reflector；角色自己当场投过的那条不碰（当场票优先）。

一轮 = push.jsonl 的一条记录（gate 给某角色某频道推了一次）→ 这个角色在这个频道、从推送到下一次推送之间的回复
（桥存的 <data>/sessions/<项目>_*.json history；chanlog 也读它）。这轮还在跑（turn-journal 里有这个频道）就等下次。

  reflector.py            处理新结束的轮（bothouse 静音 cron 每分钟跑一次，加锁不重入）
  reflector.py --dry      只打印将要投的票和地图条目，不写
  reflector.py --since "2026-11-01 13:00"   从这个时间重新起算（只改进度，不删已投的票）
环境：MEMVOTE_DIR（隔离测试时指到副本目录，同 memvote）、CC_DATA_DIR（桥数据目录）、GATE_WIKI、
CODEMAP_DIR、GATE_DEFAULT_BOT、REFLECTOR_MODEL（可选；未设置时用 Codex CLI 配置模型）。
"""
import datetime, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

EXP = Path(os.environ.get("MEMVOTE_DIR") or Path(__file__).resolve().parent)
DATA = Path(os.environ.get("CC_DATA_DIR") or Path.home() / ".bothouse")
HOME = Path.home()
WIKI = Path(os.environ.get("GATE_WIKI", "~/wiki")).expanduser()
PUSH = EXP / "push.jsonl"
STATE = EXP / "reflector-state.json"
LOG = EXP / "reflector.jsonl"  # 每轮一行：谁、投了什么、地图补了什么（或「这轮没有新路径」）
LOCK = EXP / ".reflector.lock"
MAPS = Path(os.environ.get("CODEMAP_DIR") or DATA / "codemaps").expanduser()
MODEL = os.environ.get("REFLECTOR_MODEL", "")
DEFAULT_BOT = os.environ.get("GATE_DEFAULT_BOT", "assistant")
CODEX_SESSIONS = Path(os.environ.get("CODEX_SESSIONS_DIR", HOME / ".codex" / "sessions")).expanduser()
CLAUDE_PROJECTS = Path(os.environ.get("CLAUDE_PROJECTS_DIR", HOME / ".claude" / "projects")).expanduser()
FILL_SCRIPT = Path(os.environ.get("CODEMAP_FILL_SCRIPT") or DATA / "hooks" / "codemap-fill.py").expanduser()
# 推了但这轮没说话：等到同角色同频道下一次推送，或过了一天交给 score_night 夜里兜底（它每天 05:30 跑一次）
GIVE_UP = 24 * 3600
MAX_CHARS = 240_000  # 沿用 score_night.MAX_CHARS（~/wiki/bin/ingest.py）：每次 model 调用的输入上限
PATHLINE = re.compile(r"[\w./~-]+\.(?:go|py|ts|tsx|js|md|sh|toml|json|kicad_\w+|c|h|cpp|swift|rs)(?::\d+)")

sys.path.insert(0, str(Path(__file__).resolve().parent))
import memvote  # noqa: E402  票照 SO 规则记


def _fill_mod():
    spec = importlib.util.spec_from_file_location("codemap_fill", FILL_SCRIPT)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _ts(s):
    """push.jsonl 的本地时间 / 会话记录的 ISO 时间 → epoch。"""
    if "T" in s:
        return datetime.datetime.fromisoformat(s).timestamp()
    return time.mktime(time.strptime(s if s.count(":") == 2 else s + ":00", "%Y-%m-%d %H:%M:%S"))


def _sha(x):
    return hashlib.sha1(x.strip().encode()).hexdigest()[:10]


def resolve(ref):
    """「页:行号#指纹」→ (编号「页#指纹」, 原文)；页可以是主 wiki 相对路径或角色 wiki 的 ~/…（同 memvote.full_id）。"""
    ref, _, h = ref.partition("#")
    rel, _, n = ref.rpartition(":")
    f = HOME / rel[2:] if rel.startswith("~/") else WIKI / rel
    try:
        lines = f.read_text(encoding="utf-8", errors="ignore").split("\n")
    except OSError:
        return None, ""
    if h:
        for ln in lines:
            if _sha(ln) == h:
                return f"{rel}#{h}", ln.strip()
        return f"{rel}#{h}", ""
    try:
        ln = lines[int(n) - 1]
    except (ValueError, IndexError):
        return None, ""
    return f"{rel}#{_sha(ln)}", ln.strip()


_hist = {}


def history(proj):
    """项目的会话记录：{频道 key: [(epoch, 回复原文)]}（只取 assistant）。"""
    if proj in _hist:
        return _hist[proj]
    out = {}
    for f in sorted((DATA / "sessions").glob(f"{proj}_*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        chan = {sid: key for key, ids in (d.get("user_sessions") or {}).items() for sid in ids}
        for sid, s in (d.get("sessions") or {}).items():
            key = chan.get(sid)
            if not key:
                continue
            for m in s.get("history") or []:
                if m.get("role") == "assistant" and m.get("timestamp"):
                    try:
                        out.setdefault(key, []).append((_ts(m["timestamp"]), m.get("content") or ""))
                    except ValueError:
                        pass
    _hist[proj] = out
    return out


def _agent_sessions(proj, key):
    """频道 key 绑过的 (agent_type, agent_session_id)：relay 轮桥不存 history，回复只在各家 CLI 自己的会话记录里。"""
    out = []
    for f in sorted((DATA / "sessions").glob(f"{proj}_*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for sid in (d.get("user_sessions") or {}).get(key) or []:
            s = (d.get("sessions") or {}).get(sid) or {}
            if s.get("agent_session_id"):
                out.append((s.get("agent_type"), s["agent_session_id"]))
    return out


def cli_replies(proj, key):
    """relay 轮的回复：Codex 读 ~/.codex/sessions 的 rollout，Claude Code 读 ~/.claude/projects 的 jsonl；
    别家（DSH、antigravity、acp）的 relay 轮读不到，返回空（日志里记「relay 轮读不到回复」）。"""
    out = []
    for typ, aid in _agent_sessions(proj, key):
        if typ == "codex":
            files = sorted(CODEX_SESSIONS.glob(f"*/*/*/rollout-*-{aid}.jsonl"))
        elif typ == "claudecode":
            files = sorted(CLAUDE_PROJECTS.glob(f"*/{aid}.jsonl"))
        else:
            continue
        for fp in files:
            for ln in fp.read_text(encoding="utf-8", errors="ignore").splitlines():
                try:
                    d = json.loads(ln)
                except ValueError:
                    continue
                m = d.get("payload") if typ == "codex" else d.get("message")
                if not isinstance(m, dict) or m.get("role") != "assistant" or not d.get("timestamp"):
                    continue
                c = m.get("content")
                text = c if isinstance(c, str) else "".join(
                    x.get("text", "") for x in c or [] if isinstance(x, dict) and x.get("type") in ("output_text", "text"))
                if text.strip():
                    out.append((_ts(d["timestamp"].replace("Z", "+00:00")), text))
    return out


def running(proj, key):
    try:
        return any(x.get("session_key") == key for x in json.loads((DATA / "turn-journal" / f"{proj}.json").read_text()))
    except (OSError, ValueError):
        return False


def workspaces():
    try:
        d = json.loads((DATA / "team_workspaces.json").read_text())
    except (OSError, ValueError):
        return set()
    return {"discord:" + w["id"] for ws in (d.get("parents") or {}).values() for w in ws if w.get("id")}


def load_push():
    out = []
    try:
        lines = PUSH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for i, ln in enumerate(lines):
        try:
            r = json.loads(ln)
            r["i"], r["ts"], r["proj"] = i, _ts(r["t"]), r.get("bot") or DEFAULT_BOT
            out.append(r)
        except (ValueError, KeyError):
            pass
    return out


def ready_turns(recs, st, now):
    """返回 (已结束的轮, 新进度)。进度 = 行号 pos（之前全处理过）+ done（pos 之后已处理的行号）。"""
    pos, done = st.get("pos", -1), set(st.get("done", []))
    todo = [r for r in recs if r["i"] > pos and r["i"] not in done]
    nxt = {}
    for r in reversed(recs):  # 同角色同频道的下一次推送
        r["next_ts"] = nxt.get((r["proj"], r["key"]))
        nxt[(r["proj"], r["key"])] = r["ts"]
    turns, finished = [], set()
    for r in todo:
        end = r["next_ts"]
        if end is None and running(r["proj"], r["key"]):
            continue  # 这轮还在跑
        hist = history(r["proj"]).get(r["key"]) or (cli_replies(r["proj"], r["key"]) if r["key"].startswith("relay:") else [])
        replies = [(t, c) for t, c in hist if r["ts"] < t <= (end or now + 1)]
        if not replies:
            if end is not None or now - r["ts"] > GIVE_UP:
                finished.add(r["i"])  # 推了但这轮没说话
            continue
        r["reply"] = "\n\n".join(c for _, c in replies)
        r["items"] = list(dict(x for x in (resolve(f) for f in r.get("refs") or []) if x[0]).items())
        turns.append(r)
        finished.add(r["i"])
    done |= finished
    while pos + 1 in done:
        pos += 1
        done.discard(pos)
    return turns, {"pos": pos, "done": sorted(done)}


def map_list():
    out = []
    for f in sorted(MAPS.glob("*.md")):
        kw = ""
        for ln in f.read_text(encoding="utf-8", errors="ignore").splitlines()[:8]:
            if ln.startswith("keywords:"):
                kw = ln[9:].strip()
        out.append(f"- {f.name}：{kw}")
    return "\n".join(out)


# 照抄 ACE 附录 Reflector 提示词的结构（分析 → bullet_tags），去掉 ground truth 段（无标注时用执行反馈 = 这轮回复本身）；
# 代码地图一段是交接 #908 要的（ACE 的 Curator 把新经验写成新 bullet，这里新经验 = 摸到的代码位置，写进地图）。
PROMPT = """You are an expert analyst. A team of AI assistants (五个角色，在聊天频道和工作区里干活) is given a "playbook" of memory bullets
before each turn (系统推给它的记忆条目). Your job, like the Reflector in ACE (Agentic Context Engineering), is to look at each
turn's trace — the request, the bullets shown, and the assistant's reply (the natural execution feedback; there is no ground truth) —
and tag each bullet:
- "helpful": the reply actually used / followed this bullet (or the bullet clearly applied and was correct), and it helped
  produce the right behaviour.
- "harmful": the bullet's own content is wrong or outdated, and following it led the reply astray (reply shows evidence of this).
  If the reply ignored or violated a bullet that is itself correct, that is the assistant's fault, not the bullet's: tag it
  "neutral", never "harmful" (同 score_night：条目对、助手没照做，不踩条目).
- "neutral": not used, not relevant to this turn, or you cannot tell. When unsure, choose neutral.
  Not used, not mentioned, or the turn failed for other reasons (upload error, timeout) is always "neutral", never "harmful".
  For every "harmful" tag you must fill "wrong": quote the bullet's wrong/outdated claim and say what is true now; no "wrong", no harmful.

Second, code map curation (代码地图): if the reply names concrete code locations (符号 + 文件:行) that an engineer would want to
find again next time, propose map entries "符号或作用 文件:行" for the most fitting map below (只挑这轮回复里明说的位置，文件:行照回复原文抄，
不编造；回复的「## 地图要补的条目」一节里写过的照抄；没有就给空数组). Maps:
{maps}

Output ONLY a JSON array, one object per turn, no other text:
[{{"i": <turn number>, "reasoning": "<one short sentence>", "bullet_tags": [{{"id": "<bullet number>", "tag": "helpful|harmful|neutral", "wrong": "<only for harmful>"}}],
  "map_entries": [{{"map": "<file name>.md", "entry": "<符号或作用> <文件:行>"}}]}}]

"""


def render(n, t):
    refs = "\n".join(f"  {j}: {txt or '（这行已改掉）'}" for j, (_, txt) in enumerate(t["items"]))
    return (f"## turn {n}（角色 {t['proj']}，{t['t']}）\nrequest: {t.get('q', '')}\nbullets:\n{refs or '  （无）'}\n"
            f"reply:\n{t['reply']}")


def batches(ts, head):
    cur, size = [], head
    for t in ts:
        n = len(render(len(cur), t))
        if cur and size + n > MAX_CHARS:
            yield cur
            cur, size = [], head
        cur.append(t)
        size += n
    if cur:
        yield cur


def judge(batch, head):
    prompt = head + "\n\n".join(render(n, t) for n, t in enumerate(batch))
    with tempfile.NamedTemporaryFile("r", suffix=".txt") as out:
        r = subprocess.run(["codex", "exec", *(["-m", MODEL] if MODEL else []), "-c", "notify=[]", "--skip-git-repo-check", "-s", "read-only",
                            "-o", out.name, "-"], input=prompt, capture_output=True, text=True,
                           cwd=tempfile.gettempdir())
        text = Path(out.name).read_text(encoding="utf-8") if r.returncode == 0 else ""
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        raise RuntimeError(f"模型没给出 JSON：rc={r.returncode} {r.stderr[-400:]}")
    return json.loads(m.group(0)), len(prompt)


def apply(t, v, dry, fill, wss):
    tags = {}
    for b in v.get("bullet_tags") or []:
        try:
            tag = b.get("tag")
            if tag == "harmful" and not str(b.get("wrong") or "").strip():
                tag = "neutral"  # 用户 11-03「没用上不算踩」：说不出条目哪句错，就不踩
            tags[t["items"][int(str(b.get("id")).lstrip("#"))][0]] = tag
        except (ValueError, IndexError, TypeError):
            pass
    self_voted = {r.get("id") for r in memvote._recs(memvote.VOTES) if r.get("voter") == t["proj"] and r.get("by") == "self"}
    items = [(cid, {"helpful": 1, "harmful": -1}[tag]) for cid, tag in tags.items()
             if tag in ("helpful", "harmful") and cid not in self_voted]
    votes = [] if dry or not items else memvote.record(t["proj"], items, by="reflector", key=t["key"], agent="reflector")
    # 代码地图：回复里自己写了「## 地图要补的条目」的原样补；模型挑出的条目必须带 文件:行 且那串在回复原文里出现过
    entries = {}
    for e in v.get("map_entries") or []:
        mp, ent = str(e.get("map", "")).strip(), str(e.get("entry", "")).strip()
        pl = PATHLINE.findall(ent)
        if mp.endswith(".md") and pl and all(p in t["reply"] for p in pl):
            entries.setdefault(mp, []).append(ent)
    text = t["reply"] + "".join(f"\n\n## 地图要补的条目（{mp}）\n" + "".join(f"- {x}\n" for x in xs) for mp, xs in entries.items())
    added = [] if dry else fill.fill(text, f"reflector {t['proj']} {t['key'].rpartition(':')[2]}")
    return {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "turn": t["t"], "proj": t["proj"], "key": t["key"],
            "ws": t["key"] in wss, "bullets": len(t["items"]), "tags": tags,
            "votes": [[c, o, n] for c, o, n, _ in votes] if not dry else items,
            "map": [[os.path.basename(p), n] for p, n in added] if not dry else entries,
            "map_note": "" if (added or (dry and entries)) else "这轮没有新路径", "why": str(v.get("reasoning", ""))}


def main(argv):
    dry = "--dry" in argv
    from filelock import lock
    with open(LOCK, "w") as lk:
        try:
            lock(lk, wait=False)
        except OSError:
            return 0  # 上一次还在跑
        recs = load_push()
        st = json.loads(STATE.read_text()) if STATE.exists() else None
        if "--since" in argv:
            since = _ts(argv[argv.index("--since") + 1])
            st = {"pos": max([r["i"] for r in recs if r["ts"] < since], default=-1), "done": []}
        if st is None:  # 第一次跑：从现在起，不回补历史（历史由 score_night 夜里兜底）
            STATE.write_text(json.dumps({"pos": recs[-1]["i"] if recs else -1, "done": []}))
            return 0
        turns, nst = ready_turns(recs, st, time.time())
        fill, wss = _fill_mod(), workspaces()
        work = [t for t in turns if t["items"] or PATHLINE.search(t["reply"]) or "地图要补的条目" in t["reply"]]
        head = PROMPT.format(maps=map_list())
        rows = []
        for batch in batches(work, len(head)):
            try:
                res, size = judge(batch, head)
            except Exception as e:  # 模型失败：这批不推进进度，下次重试
                print(f"{time.strftime('%F %T')} reflector: {e}", file=sys.stderr)
                bad = {t["i"] for t in batch}
                nst["done"] = sorted(set(nst["done"]) - bad)
                nst["pos"] = min([nst["pos"]] + [i - 1 for i in bad])
                continue
            for v in res:
                try:
                    t = batch[int(v["i"])]
                except (KeyError, ValueError, IndexError, TypeError):
                    continue
                row = apply(t, v, dry, fill, wss)
                row["chars"] = size
                rows.append(row)
        for t in turns:  # 不用调模型的轮（没推记忆、回复里也没代码位置）也记一行，工作区轮写明没有新路径
            if t not in work:
                rows.append({"t": time.strftime("%Y-%m-%d %H:%M:%S"), "turn": t["t"], "proj": t["proj"], "key": t["key"],
                             "ws": t["key"] in wss, "bullets": 0, "tags": {}, "votes": [], "map": [],
                             "map_note": "这轮没有新路径", "why": "没推记忆、回复里没有代码位置，不调模型"})
        if dry:
            for r in rows:
                print(json.dumps(r, ensure_ascii=False))
            return 0
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        STATE.write_text(json.dumps(nst))
        if rows:
            print(f"{time.strftime('%F %T')} reflector: {len(rows)} 轮，票 {sum(len(r['votes']) for r in rows)}，"
                  f"地图 +{sum(n for r in rows for _, n in r['map'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
