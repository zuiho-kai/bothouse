#!/usr/bin/env python3
"""PreToolUse（所有工具）：工作区一轮的步数和时长上限。到上限后只放行「收尾」的调用（写交接、推半成品分支、
ws-up 上报、board、bothouse report/send/progress/session），其余一律拦下，提示写进度和卡点、交回，不再查新证据。

出处：用户 2026-11-05「出现什么问题你就去修它…变成我们的产品能力」、11-06「这怎么那么痛苦啊？那别同类怎么搞的？」。
隔壁 #11 现状盘点一轮 42 分钟、221 次工具（容器 events.jsonl，11-05 15:47Z）。
门槛不拍脑袋：按会话记录统计的本机工作区轮 p95 定（见 MAX_STEPS 注释）。同类 OpenManus / DSH SuperAgent
都设硬步数上限、超限熔断。

计数：复用 #1102 的同一套轮计数（规则 9 本身已在 #1172 撤掉，计数字段留着）——
- DSH：run.py / dsh-cc-compat.py 加的 dsh_turn（turn_calls：一步 = 一条 assistant/message，started = turn/start 的时间）；
- 其他 CLI（Claude Code、Codex 经 codex-compat、Grok）：transcript_path（Claude Code 格式），从最后一条真人/桥消息算起，
  一步 = 一条 assistant 消息（同 message.id 的并行调用算一步）。
读不到记录 = 放行（同 bash-guard：会话推出来的规则一律 fail open）。

只管工作区（同 dispatch-review-guard.in_workspace：team_workspaces.json 里的频道）；子 agent（agent_id）不管，
它们另有上下文和时长上限。定时/交接/验收轮一律不豁免（用户 11-06 定）：工作区的活本来就是这些轮带进来的；验收重活也该在工作区跑。

上限：hooks 目录下 ws-cap.json（和本脚本同目录，可不建），字段 max_steps、max_minutes，默认见 MAX_STEPS、MAX_MINUTES；
任一项写 0 = 不限这一项。
"""
import importlib.util, json, os, re, sys, time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CONF = os.path.join(HERE, "ws-cap.json")
# 门槛按统计定（用户 11-06 02:0x「按统计定门槛 81 步/20 分钟并合入」）：本机橘工作区轮 10-30 至 11-06 共 84 轮，
# 步数 p50/p90/p95 = 13/70/81，时长 p95 = 19.8 分钟；取 p95，先到先拦。对照隔壁工作区轮 n=24 的 p95 是 214 步、69 分钟。
# 一步 = 模型发出一次工具调用（同 message.id 的并行调用算一步）。统计脚本与逐轮明细在 #1112 / PR #1171 说明里。
MAX_STEPS, MAX_MINUTES = 81, 20

# 到上限后还放行的命令：收尾用的。程序名 → 允许的子命令（None = 都放行）
FINISH_PROGS = {"ws-up": None, "board": None, "echo": None, "printf": None, "date": None, "cd": None, "pwd": None,
                "true": None, ":": None, "git": {"add", "commit", "push", "stash", "status", "diff"}}
FINISH_SUBS = {"report", "send", "progress", "session", "board", "task"}  # bothouse / cc-connect 的子命令
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "edit", "write", "str_replace_editor"}

MSG = ("工作区这一轮已经跑了 {what}，到了一轮的上限（{limit}）。别再查新证据、别再开新改动，现在收尾：\n"
       "一、改到一半的代码先 git commit 并推到你的分支（半成品也推）。\n"
       "二、在交接文件末尾「## 进度」节追加一行：`- <时间> 本轮到上限：做完了…；卡在…；下一轮从…接`。\n"
       "三、活做完了就照交回骨架交 [report]；没做完就跑 `ws-up --notes <交接文件> \"【到上限】做完…；卡在…；下一轮从…接\"`"
       "（不带 --ask），交给聊天频道的主角色决定续一轮还是换思路，然后结束本轮。\n"
       "（工作区一轮上限；用户 2026-11-06「那别同类怎么搞的」，同类框架都设硬步数上限）")


def limits():
    steps, minutes = MAX_STEPS, MAX_MINUTES
    try:
        with open(CONF, encoding="utf-8") as f:
            c = json.load(f)
        if isinstance(c.get("max_steps"), int) and c["max_steps"] >= 0:
            steps = c["max_steps"]
        if isinstance(c.get("max_minutes"), (int, float)) and c["max_minutes"] >= 0:
            minutes = c["max_minutes"]
    except (OSError, ValueError, AttributeError):
        pass
    return steps, minutes


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _ms(ts):
    if isinstance(ts, (int, float)):
        return int(ts)
    if isinstance(ts, str) and ts:
        try:
            return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None
    return None


def _is_prompt(e):
    """一轮的起点：真人或桥发来的消息（tool_result、isMeta 的注入不算）。"""
    if e.get("type") != "user" or e.get("isMeta"):
        return False
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str):
        return bool(c.strip())
    if not isinstance(c, list):
        return False
    if any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
        return False
    return any(isinstance(x, dict) and x.get("type") == "text" and (x.get("text") or "").strip() for x in c)


def transcript_turn(path):
    """Claude Code 格式记录的当前轮：{"steps": [[call…]…], "started": 毫秒或 None}；读不到返回 None。"""
    try:
        with open(path or "", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except (OSError, TypeError, ValueError):
        return None
    ents = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            ents.append(e)
    start = None
    for i in range(len(ents) - 1, -1, -1):
        if _is_prompt(ents[i]):
            start = i
            break
    if start is None:
        return None
    steps, by_id = [], {}
    for e in ents[start + 1:]:
        if e.get("type") != "assistant":
            continue
        m = e.get("message") or {}
        calls = [{"id": x.get("id"), "name": x.get("name")} for x in m.get("content") or []
                 if isinstance(x, dict) and x.get("type") == "tool_use"]
        if not calls:
            continue
        mid = m.get("id")
        if mid and mid in by_id:
            by_id[mid].extend(calls)  # Claude Code 把一步里并行的调用拆成几行，同一个 message.id
            continue
        steps.append(calls)
        if mid:
            by_id[mid] = calls
    return {"steps": steps, "started": _ms(ents[start].get("timestamp"))}


def finishing(d):
    tool, inp = d.get("tool_name") or "", d.get("tool_input") or {}
    if tool in EDIT_TOOLS:
        p = str(inp.get("file_path") or inp.get("path") or "")
        return "/notes/" in p.replace(os.sep, "/")  # 写交接文件（角色目录 notes/）
    if tool.lower() != "bash":
        return False
    bg = _load("bash_guard", "bash-guard.py")
    segs = bg.segments(str(inp.get("command") or ""))
    if not segs:
        return False
    for seg in segs:
        t = bg.toks(seg)
        while t and (re.match(r"^\w+=", t[0]) or t[0] in bg.PREFIX):
            t = t[1:]
        if not t:
            continue
        prog, args = t[0].rsplit("/", 1)[-1], t[1:]
        if prog in ("bothouse", "cc-connect"):
            if args[:1] and args[0] in FINISH_SUBS:
                continue
            return False
        if prog not in FINISH_PROGS:
            return False
        subs = FINISH_PROGS[prog]
        if subs is not None:
            a = bg.git_args(args) if prog == "git" else args
            if not a or a[0] not in subs:
                return False
    return True


def check(d, now_ms=None):
    """返回拦下的理由，放行返回 None。"""
    if d.get("hook_event_name", "PreToolUse") != "PreToolUse" or d.get("agent_id"):
        return None
    turn = d.get("dsh_turn") if d.get("dsh") else transcript_turn(d.get("transcript_path"))
    if not turn:
        return None
    max_steps, max_minutes = limits()
    steps = [s for s in turn.get("steps") or [] if any(not c.get("denied") for c in s)]
    started = turn.get("started")
    mins = ((now_ms or time.time() * 1000) - started) / 60000 if started else 0
    over_steps = max_steps and len(steps) >= max_steps
    over_time = max_minutes and mins >= max_minutes
    if not (over_steps or over_time):
        return None
    if finishing(d):
        return None
    if not _load("drg", "dispatch-review-guard.py").in_workspace():
        return None
    what = f"{len(steps)} 步、{mins:.0f} 分钟"
    limit = "、".join(x for x in (f"{max_steps} 步" if max_steps else "", f"{max_minutes} 分钟" if max_minutes else "") if x)
    return MSG.format(what=what, limit=limit)


def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return
    try:
        reason = check(d)
    except Exception:
        return  # 判断出错一律放行
    if reason:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                                 "permissionDecisionReason": reason}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
