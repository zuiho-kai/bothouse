#!/usr/bin/env python3
"""预计时间闸门：报预计时间、挂等待/定时器长于 15 分钟，却没写实测依据或在等外部什么 → 拦下，按实测重定。

出处：用户 2026-10-26「这个问题已经多次复发了，你修一下」（当时只拦跨天、4 小时以后，半小时、一小时漏掉）；
2026-11-01「经常给我定个半小时，一个小时等待，其实真实只要5分钟，空转了很久，这个我就让你拦截，重新再定时间」。

被两处调用（都是所有 CLI 共用的钩子，经 run.py 适配各家协议）：
1. bash-guard.py（PreToolUse Bash）：check_command —— ws-forward/ws-handoff/ws-up/later/board add|update、
   bothouse|cc-connect progress/send/relay/timer/task 的参数原文，ws-handoff 还查交接文件里的工期段；
   timer add --delay/--at、later <编号> <延时> 的定时本身也算。
2. fix-claim-guard.py（Stop）：check —— 本轮最后一条回复。

放行：同句写了「按实测」/「实测」算式，或写明在等外部（等你/等 CI/下载/训练/发布…）；
讲已经发生的事（花了/用了/实际/耗时…）、节奏（每 10 分钟）、引号里的原话不算预计。
CLI：stdin 读文本，命中打印理由并 exit 1；--hits 逐句列出会被拦的（回放误拦用）。
"""
import os
import re
import shlex
import sys
from datetime import datetime, timedelta

LIMIT_MIN = 15  # 主角色 2026-11-01 交接定：「长于 15 分钟必须带按实测算式或写明在等外部什么」，用户可改

QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|《[^》\n]*》|`[^`\n]*`')
SPLIT = re.compile(r"[。！？；!?;\n]|(?<!\d)\.(?=\s)")
# 依据或外部等待：同句出现就放行（沿用旧 eta_guard 的 ALLOW，加上额度/限流/审核这类外部原因）
ALLOW = re.compile(r"按实测|(?<![没无未不])(?<!没有)实测|等你|等用户|你回|你点头|你确认|你拍板|等对方|等外部|CI|下载|训练|发布时间|高峰|"
                   r"已排在|预约|额度|限流|冷却|重置|审核|排队|上游|官方|流水线|上几次|以往|发布|投稿|回收|播放|出货|发货|快递|到货|物流|"
                   r"有效|过期|等的是|原话|用户是否|看门|watchdog|自动叫|会通知|通知我|"
                   r"measured|waiting (?:for|on) (?:you|CI|the user|upstream|download)|download|training", re.I)
# 讲过去的事、规则阈值、节奏：不是在报预计
PAST = re.compile(r"花了|用了|耗时|实际|跑了|做了|等了|空转了|已经|之前|前的|以前|上次|当时|刚才|超时|上限|阈值|"
                  r"花在|发了|挂了|已挂|近\s*\d|最近|过去|拦|每\s*\S{0,4}(?:分钟|小时)|以上的|以下的|超过|不到|took|spent|elapsed|ago|every", re.I)
DAY = re.compile(r"明天|明早|明晚|明日|后天|下周|tomorrow|next week", re.I)
NUM = r"\d+(?:\.\d+)?|[零一二两三四五六七八九十]{1,3}"
CN = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
CLOCK = re.compile(r"(早上|上午|中午|下午|晚上|傍晚|凌晨)?\s*(?<![\d:：])(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*"
                   r"(?:[:：](\d{2})|(点半)|点)\s*(?:前(?!后)|之前|以前|左右|能好|能完|交|做完|弄完)")
PM = ("下午", "晚上", "傍晚")
# 时长：半小时、一个半小时、30–40 分钟、1.5 小时、两个钟头、半天、about 40 minutes
DUR = re.compile(
    r"(?P<half>半)\s*(?:个\s*)?(?:小时|钟头)"
    r"|(?P<n1>" + NUM + r")\s*(?:个)?\s*(?P<h1>半)?\s*(?:个\s*)?(?:(?:[-–—~～到至]|to)\s*(?P<n2>" + NUM + r")\s*(?:个\s*)?)?"
    r"(?P<u>小时|钟头|分钟|分(?!之|[\d钟])|hours?|hrs?|minutes?|mins?\b)"
    r"|(?P<halfday>半天|一整天|一下午|一上午|一晚上)", re.I)
# 时长同句有这些词才算在报预计/等待（「这段 40 分钟的录像」不算）
CUE = re.compile(r"大约|大概|约|预计|估计|左右|以内|之内|还要|还得|还需|需要|再过|等|挂|后|跑完|做完|搞定|"
                 r"渲染|编译|完成|回来|才能|能好|about|around|roughly|~|\bin\b|takes?|need|wait|until|ETA", re.I)

REASON = ("你报了「{what}」（「{s}」），长于 {lim} 分钟却没写依据。实际几分钟就完的活报半小时、一小时会空转。"
          "按同类活的实测重定：同句写「按实测：N 块 × M 分钟 ÷ P 并行 ≈ X 分钟」；"
          "真在等外部，同句写明等什么（等你确认/等 CI/等下载…）。拿不准就先跑一块量出来再报。")
# 理由里的时长都放在「」里：模型原样转贴理由时不会再被自己拦


def _num(s):
    if not s:
        return 0.0
    if re.fullmatch(r"\d+(?:\.\d+)?", s):
        return float(s)
    if s == "十":
        return 10
    if s.startswith("十"):
        return 10 + CN.get(s[1:], 0)
    if "十" in s:
        a, _, b = s.partition("十")
        return CN.get(a, 0) * 10 + (CN.get(b, 0) if b else 0)
    return CN.get(s, 0)


def _minutes(m):
    if m.group("half"):
        return 30
    if m.group("halfday"):
        return 240  # 半天按 4 小时：沿用旧 eta_guard 的 LIMIT_H = 4，只用来判是否过阈值
    n = max(_num(m.group("n1")), _num(m.group("n2")))
    if m.group("h1"):
        n += 0.5
    u = m.group("u").lower()
    return n * 60 if u.startswith(("小", "钟", "h")) else n


def _hours_until(m, now):
    period, h = m.group(1), int(_num(m.group(2)))
    mi = int(m.group(3)) if m.group(3) else (30 if m.group(4) else 0)
    if not (0 <= h <= 24 and 0 <= mi < 60):
        return None
    if period in PM and h < 12:
        cands = [h + 12]
    elif period == "中午" and h < 11:
        cands = [h + 12]
    elif period or h >= 12:
        cands = [h]
    else:
        cands = [h, h + 12]
    best = None
    for hh in cands:
        t = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(hours=hh, minutes=mi)
        while t <= now:
            t += timedelta(days=1)
        d = (t - now).total_seconds() / 3600
        best = d if best is None else min(best, d)
    return best


def _fmt(mins):
    return f"{mins / 60:g} 小时" if mins >= 60 else f"{mins:g} 分钟"


def hits(text, now=None, limit=None):
    """[(说法, 句子)]：每个没依据、超过阈值的预计。"""
    now = now or datetime.now()
    limit = LIMIT_MIN if limit is None else limit
    out = []
    for s in SPLIT.split(QUOTED.sub("", text or "")):
        s = s.strip()
        if not s or ALLOW.search(s) or PAST.search(s):
            continue
        if DAY.search(s):
            out.append(("跨天的时间", s))
            continue
        hit = None
        for m in CLOCK.finditer(s):
            d = _hours_until(m, now)
            if d is not None and d * 60 > limit:
                hit = f"{d:.1f} 小时后的时间点"
                break
        if not hit and CUE.search(s):
            for m in DUR.finditer(s):
                mins = _minutes(m)
                if mins > limit:
                    hit = "约 " + _fmt(mins)
                    break
        if hit:
            out.append((hit, s))
    return out


def check(text, now=None, limit=None):
    """返回拦截理由或 None。"""
    limit = LIMIT_MIN if limit is None else limit
    h = hits(text, now, limit)
    return REASON.format(what=h[0][0], s=h[0][1][:60], lim=limit) if h else None


# ---- 命令行（bash-guard 用） ----
TEXT_CMDS = {"ws-forward", "ws-handoff", "ws-up", "later", "board"}
BRIDGE = {"bothouse", "cc-connect"}
BRIDGE_SUBS = {"progress", "send", "relay", "timer", "task"}
DELAY = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$")
# 交接文件里这些节是转述、出处和规矩，不是这次报的工期
SKIP_SECTIONS = re.compile(r"用户原话|原话出处|旧定案|已查过|相关改动|规矩|参照实现|总部判断")


def _delay_min(s):
    m = DELAY.match((s or "").strip())
    if not m or not any(m.groups()):
        return None
    h, mi, se = (int(x or 0) for x in m.groups())
    return h * 60 + mi + se / 60


def _at_min(s, now):
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return (datetime.strptime(s.strip(), fmt) - now).total_seconds() / 60
        except ValueError:
            pass
    return None


def handoff_text(path):
    """交接文件里报工期的那几节（总目标、范围、进度…）。读不到返回空。"""
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return ""
    keep, out = True, []
    for line in raw.splitlines():
        if line.startswith("#"):
            keep = not SKIP_SECTIONS.search(line)
            continue
        if keep:
            out.append(line)
    return "\n".join(out)


def _flag(t, name):
    if name in t:
        i = t.index(name)
        return t[i + 1] if i + 1 < len(t) else ""
    for a in t:
        if a.startswith(name + "="):
            return a.split("=", 1)[1]
    return None


def commands(cmd):
    """整条 shell 命令切成一段段 argv：引号里的换行、分号不切（多行消息常整段放在引号里）。"""
    lx = shlex.shlex(cmd, posix=True, punctuation_chars=";&|\n")
    lx.whitespace = " \t\r"
    lx.whitespace_split = True
    out, cur = [], []
    try:
        for tok in lx:
            if tok and set(tok) <= set(";&|\n"):
                if cur:
                    out.append(cur)
                cur = []
            else:
                cur.append(tok)
    except ValueError:  # 引号没配对：退回按行粗切
        return [ln.replace('"', " ").replace("'", " ").split() for ln in re.split(r"[;\n|&]", cmd)]
    if cur:
        out.append(cur)
    return out


def check_shell(cmd, now=None, limit=None):
    """整条 Bash 命令：逐段查，返回第一个拦截理由或 None。"""
    for t in commands(cmd or ""):
        r = check_command(t, now, limit)
        if r:
            return r
    return None


def check_command(seg, now=None, limit=None):
    """一段命令（字符串或 argv 列表）。返回拦截理由或 None。"""
    now = now or datetime.now()
    limit = LIMIT_MIN if limit is None else limit
    if isinstance(seg, list):
        t, seg = list(seg), " ".join(seg)
    else:
        try:
            t = shlex.split(seg)
        except ValueError:
            t = seg.replace('"', " ").replace("'", " ").split()
    while t and re.match(r"^\w+=", t[0]):  # 前缀环境变量
        t = t[1:]
    if t and os.path.basename(t[0]) in ("python3", "python", "sh", "bash"):
        t = [a for a in t[1:] if not a.startswith("-")]
    if not t:
        return None
    head = os.path.basename(t[0])
    args = t[1:]
    if head in BRIDGE:
        sub = next((a for a in args if not a.startswith("-")), "")
        if sub not in BRIDGE_SUBS:
            return None
    elif head not in TEXT_CMDS:
        return None
    if head == "board" and not (args and args[0] in ("add", "update")):
        return None
    text = "\n".join(a for a in args if not a.startswith("-"))
    # 定时本身：timer add --delay / --at，later <编号> <延时>
    mins = None
    if head in BRIDGE and "timer" in args and "add" in args:
        d = _flag(args, "--delay")
        mins = _delay_min(d) if d else None
        at = _flag(args, "--at")
        if at:
            mins = _at_min(at, now)
    elif head == "later" and len(args) >= 2:
        mins = _delay_min(args[1])
    if mins is not None and mins > limit:
        why = "\n".join(filter(None, [_flag(args, "--prompt"), _flag(args, "--desc"), _flag(args, "--message"),
                                      args[2] if head == "later" and len(args) > 2 else ""]))
        if not ALLOW.search(QUOTED.sub("", why)):
            return REASON.format(what=f"{_fmt(mins)} 后的定时", s=seg.strip()[:80], lim=limit)
    if head == "ws-handoff" and args:
        text += "\n" + handoff_text(args[0])
    return check(text, now, limit)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--hits"]:
        for what, s in hits(sys.stdin.read()):
            print(f"{what}\t{s[:120]}")
        sys.exit(0)
    r = check(sys.stdin.read())
    if r:
        print(r)
        sys.exit(1)
