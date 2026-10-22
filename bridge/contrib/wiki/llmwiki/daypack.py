#!/usr/bin/env python3 -I
"""daypack: the day's objective record, made by script (no model), that dream's 今日反思 reads.

Why (user 2026-10-21): 「我需要他能主动和被动迭代，包括dream本身不应该只是检测 而是反思今天情况」 — dream reads the user's
words only; this adds what the day's work itself shows:
  - cost per session (sub-agents included) at API price, and cache rewrites after the cache expired;
  - the slowest commands (Bash tool_use → tool_result);
  - sentences in which the assistant said it would do something (「接下来/之后/我去」), verbatim — the model judges.
The cost algorithm is the author's usage_by_session.py's (that script now imports usage_calls/per_session
from here, so there is one copy).

  daypack.py [HOURS]       print the pack for the last HOURS (default 24) without the 「答应了的事」 part
"""
import collections, glob, json, os, re, sys, time
from datetime import datetime
from pathlib import Path

CC = Path.home() / ".claude" / "projects"
# 来源：Opus 5.5 API 价/百万 token（wiki claude-context-costs 2026-10-17，沿用 usage_by_session.py；Fable 价未知按同价）
PRICE = dict(i=4, o=20, r=.2, w5=5, w1=8)
# Usage does not report a cache miss's cause. Count *suspected* expiry rewrites, respecting the most recently
# advertised TTL; a 1h task must not be treated as expired after 5m. This is a diagnostic estimate, not billing data.
EXPIRED_GAP = 300
# 来源：作者本机人设 CLAUDE.md「干活」原话「预计超过约 5 分钟的命令要 nohup/后台跑」——超过就该查为什么慢
SLOW = 300
TOP = 20  # 来源：沿用 usage_by_session.py 打印的前 20 个会话
PROMISE = re.compile(r"接下来|之后|我去")  # the words the approved plan names (dream-reflect.md step 1)
CMD_CHARS = 300  # 来源：沿用 sessionlog.TOOL_CHARS（ingest.py extract() 与 export.py 截工具调用为 300）


def ts_of(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def usage_calls(start, end=None, root=CC):
    """Every API call with usage in [start, end) in the Claude Code logs under `root`, one per (message id, request id)
    — the last line of each: streaming writes the message several times and only the last carries the full output
    (usage_by_session.py: the first version read the first and missed output). Dicts: proj, sid, sub, file, t, model, u."""
    last = {}
    for f in glob.glob(str(root / "*" / "**" / "*.jsonl"), recursive=True):
        if os.path.getmtime(f) < start:
            continue
        proj, sub = f.split(str(root) + "/")[1].split("/")[0], "/subagents/" in f
        for line in open(f, errors="ignore"):
            if '"usage"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get("message") if isinstance(d, dict) else None
            if not isinstance(m, dict) or not m.get("usage") or not d.get("timestamp"):
                continue
            t = ts_of(d["timestamp"])
            if t < start or (end and t >= end):
                continue
            last[(m.get("id"), d.get("requestId"))] = dict(proj=proj, sid=d.get("sessionId", "?"), sub=sub, file=f, t=t,
                                                          model=m.get("model", "?"), u=m["usage"])
    return list(last.values())


def written(u):
    """(5m, 1h) cache write tokens of one call's usage."""
    cc = u.get("cache_creation") or {}
    if not cc:
        return u.get("cache_creation_input_tokens", 0), 0
    return cc.get("ephemeral_5m_input_tokens", 0), cc.get("ephemeral_1h_input_tokens", 0)


def call_cost(u):
    """(total, cache write, cache read, output) in dollars of one call's usage."""
    w5, w1 = written(u)
    write = (w5 * PRICE["w5"] + w1 * PRICE["w1"]) / 1e6
    read = u.get("cache_read_input_tokens", 0) * PRICE["r"] / 1e6
    out = u.get("output_tokens", 0) * PRICE["o"] / 1e6
    return u.get("input_tokens", 0) * PRICE["i"] / 1e6 + write + read + out, write, read, out


def per_session(calls):
    """{(proj, sid): Counter(cost, sub, main, calls, write, read, out, maxctx, rewrites, rewrite_cost, first, last)}.
    A session includes its sub-agents (their files carry the parent's sessionId)."""
    S = collections.defaultdict(collections.Counter)
    prev = {}  # file → (previous call time, most recently advertised TTL)
    for c in sorted(calls, key=lambda c: c["t"]):
        u, s = c["u"], S[(c["proj"], c["sid"])]
        cost, write, read, out = call_cost(u)
        s["cost"] += cost
        s["sub" if c["sub"] else "main"] += cost
        s["calls"] += 1
        s["write"] += write
        s["read"] += read
        s["out"] += out
        w = sum(written(u))
        s["maxctx"] = max(s["maxctx"], u.get("cache_read_input_tokens", 0) + w + u.get("input_tokens", 0))
        previous = prev.get(c["file"])
        if previous and c["t"] - previous[0] > previous[1] and w > u.get("cache_read_input_tokens", 0):
            s["rewrites"] += 1
            s["rewrite_cost"] += write
        w5, w1 = written(u)
        ttl = 3600 if w1 else EXPIRED_GAP if w5 else previous[1] if previous else EXPIRED_GAP
        prev[c["file"]] = (c["t"], ttl)
        s["first"] = min(s["first"] or c["t"], c["t"])
        s["last"] = max(s["last"], c["t"])
    return S


def slow_commands(start, end=None, root=CC, over=SLOW):
    """Bash calls sent in [start, end) that took longer than `over` seconds from tool_use to tool_result, slowest
    first: (seconds, sid, sub-agent?, command)."""
    out = []
    for f in glob.glob(str(root / "*" / "**" / "*.jsonl"), recursive=True):
        if os.path.getmtime(f) < start:
            continue
        sent = {}
        for line in open(f, errors="ignore"):
            if '"tool_use"' not in line and '"tool_result"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get("message") if isinstance(d, dict) else None
            content = m.get("content") if isinstance(m, dict) else None
            if not d.get("timestamp") or not isinstance(content, list):
                continue
            t = ts_of(d["timestamp"])
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name") == "Bash":
                    sent[b.get("id")] = (t, (b.get("input") or {}).get("command") or "", d.get("sessionId", "?"))
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in sent:
                    t0, cmd, sid = sent.pop(b["tool_use_id"])
                    if t0 >= start and (not end or t0 < end) and t - t0 > over:
                        out.append((t - t0, sid, "/subagents/" in f, cmd))
    return sorted(out, reverse=True)


def totals(S, slow):
    """The day's figures the next day compares against (ingest keeps them in its state db)."""
    return {"cost": sum(v["cost"] for v in S.values()), "sub": sum(v["sub"] for v in S.values()),
            "write": sum(v["write"] for v in S.values()), "rewrites": sum(v["rewrites"] for v in S.values()),
            "rewrite_cost": sum(v["rewrite_cost"] for v in S.values()),
            "slow": len(slow), "slow_min": sum(s for s, *_ in slow) / 60}


def hm(t):
    return datetime.fromtimestamp(t).strftime("%m-%d %H:%M")


def one_line(s, n=CMD_CHARS):
    s = " ".join(s.split())
    return s if len(s) <= n else s[:n] + "…"


def cost_part(S, slow):
    T = totals(S, slow)
    lines = ["## 开销（按 Opus 5.5 API 价折算；订阅不按 token 收费，只看相对占比；算法同 usage_by_session.py）",
             f"- 合计 ${T['cost']:.1f}，其中子 agent ${T['sub']:.1f}；写缓存 ${T['write']:.1f}，"
             f"读缓存 ${sum(v['read'] for v in S.values()):.1f}，输出 ${sum(v['out'] for v in S.values()):.1f}；会话 {len(S)} 个",
             f"- 疑似缓存过期重写 {T['rewrites']} 次，写入 ${T['rewrite_cost']:.1f}（同一会话文件两次调用间隔超过最近记录的 "
             "5m/1h TTL，且这次写入多于读取；日志不能证明重写原因）",
             f"会话（按开销前 {TOP} 个）："]
    for (proj, sid), v in sorted(S.items(), key=lambda x: -x[1]["cost"])[:TOP]:
        lines.append(f"- {sid[:8]} ${v['cost']:.1f}（子 agent ${v['sub']:.1f}）调用 {v['calls']} 次，最大上下文 "
                     f"{v['maxctx'] // 1000}k，写缓存 ${v['write']:.1f}，疑似过期重写 {v['rewrites']} 次 ${v['rewrite_cost']:.1f}，"
                     f"{hm(v['first'])}~{hm(v['last'])[6:]}，{proj[-28:]}")
    lines.append(f"## 慢命令（Bash 从发出到拿到结果超过 5 分钟：共 {T['slow']} 条，合计 {T['slow_min']:.0f} 分钟）")
    for secs, sid, sub, cmd in slow:
        lines.append(f"- {secs / 60:.1f} 分钟 {sid[:8]} {'子 agent' if sub else '主会话'}：`{one_line(cmd)}`")
    if not slow:
        lines.append("- 无")
    return lines, T


def promise_part(sessions, reply_chars):
    """sessions: [(sid, title, replies)] with replies [(time, text)] in time order. Each sentence of a reply holding
    PROMISE words, verbatim, and how many replies followed. Include the next reply as well as the final one:
    a completed delivery followed by unrelated chat must not be mistaken for an unkept promise."""
    lines = ["## 承诺候选（含「接下来/之后/我去」的原句；不是未完成清单）",
             "只摘下一条和最后一条回复，中间回复可能省略；不能仅因摘录里没有结果就判定没做，证据不足写无法判断。"]
    for sid, title, replies in sessions:
        hits = []
        for i, (t, text) in enumerate(replies):
            for s in re.split(r"(?<=[。！？!?\n])", text):
                s = one_line(s.strip())
                if s and PROMISE.search(s) and s not in (h[1] for h in hits):
                    hits.append((t, s, len(replies) - 1 - i, i))
        if not hits:
            continue
        lines.append(f"=== SESSION {sid[:8]} | {title or '-'}")
        for t, s, n, i in hits:
            lines.append(f"- [{hm(t)}]『{s}』（此后本会话还有 {n} 条回复）")
            if n:
                t1, text = replies[i + 1]
                cut = text if not reply_chars or len(text) <= reply_chars else text[:reply_chars] + "…"
                lines.append(f"  下一条回复 [{hm(t1)}]：{' '.join(cut.split())}")
        t, text = replies[-1]
        cut = text if not reply_chars or len(text) <= reply_chars else text[:reply_chars] + "…"
        lines.append(f"  本会话当天最后一条回复 [{hm(t)}]：{' '.join(cut.split())}")
    if len(lines) == 1:
        lines.append("- 无")
    return lines


def compare_part(prev, now, prev_fixes):
    """Yesterday's figures against today's, and the a-class fixes the last reflection wrote (did they work?)."""
    lines = ["## 昨日对照"]
    if prev and now and prev["totals"].get("runtime") == now.get("runtime") == "codex":
        p = prev["totals"]
        lines += [f"- Codex input {p['input_tokens']} → {now['input_tokens']}；"
                  f"cached input {p['cached_input_tokens']} → {now['cached_input_tokens']}；"
                  f"output {p['output_tokens']} → {now['output_tokens']}",
                  f"- 超过 5 分钟命令 {p['slow']} → {now['slow']}；"
                  f"轮询等待 {p['wait_seconds']:.1f} → {now['wait_seconds']:.1f} 秒"]
    elif prev and now and not prev["totals"].get("runtime") and not now.get("runtime"):
        p = prev["totals"]
        lines = [f"## 昨日对照（上一次反思 {prev['day']} 的数据包 → 今天）",
                 f"- 合计 ${p['cost']:.1f} → ${now['cost']:.1f}；子 agent ${p['sub']:.1f} → ${now['sub']:.1f}；"
                 f"写缓存 ${p['write']:.1f} → ${now['write']:.1f}",
                 f"- 疑似缓存过期重写 {p['rewrites']} 次 ${p['rewrite_cost']:.1f} → {now['rewrites']} 次 ${now['rewrite_cost']:.1f}",
                 f"- 超过 5 分钟的命令 {p['slow']} 条 {p['slow_min']:.0f} 分钟 → {now['slow']} 条 {now['slow_min']:.0f} 分钟"]
    elif not prev:
        lines.append("- 无（没有上一次反思的数据包）")
    else:
        lines.append("- 无可比指标（缺记录或运行时口径不同）")
    lines.append("全日总量受任务数量和类型影响，不能仅凭涨跌判断某项改法生效。旧数据包的缓存口径也可能不同。")
    lines.append("上一次反思写的 a 类改法（反思页上一段）：")
    return lines + ([f"- {f}" for f in prev_fixes] or ["- 无"])


def build(start, end, sessions=(), root=CC, prev=None, prev_fixes=(), usage=True, reply_chars=None, codex_root=None):
    """(pack text, totals or None) for [start, end). usage False: read only the selected sessions' native Codex
    measurements when available; never show 橘's Claude Code figures for another wiki.
    reply_chars: ingest passes DREAM_REPLY_CHARS (dream's cut of an assistant reply); None = uncut."""
    head = [f"=== 当天数据包（脚本生成，{hm(start)} ~ {hm(end)}）==="]
    T = None
    if usage:
        cost, T = cost_part(per_session(usage_calls(start, end, root)), slow_commands(start, end, root))
    else:
        import codex_daypack
        cost, T = codex_daypack.part(start, end, sessions, **({"root": codex_root} if codex_root else {}))
    body = head + cost + promise_part(sessions, reply_chars) + compare_part(prev, T, prev_fixes)
    return "\n".join(body) + "\n", T


if __name__ == "__main__":
    h = float(sys.argv[1]) if len(sys.argv) > 1 else 24
    now = time.time()
    print(build(now - h * 3600, now)[0])
