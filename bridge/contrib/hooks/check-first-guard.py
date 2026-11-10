#!/usr/bin/env python3
"""Stop：回复在说「我们自己系统」的现状（我们有/没有/缺/早就有/没订阅）或建议我们加/学什么，
本轮却没查过现场（读/grep 仓库、wiki、配置、日志、远端）→ 拦一次，要求先查再说。
出处：2026-11-06 用户「你又犯错了」：橘没查桥里早有的证据检查就建议「学别人交差带证据」；
08:5x 只看了一处配置就说隔壁「没订阅」（用户「之前不是订阅了吗」）；用户「你的问题不是第几次，是第几十几百次」。
两段式（照 choice-ask-guard）：便宜正则粗筛 → 小模型看回复和本轮查现场的工具调用，判「有没有断言自家现状/建议加什么，
且本轮查的没覆盖它」→ 是就拦。只看「本轮查没查过」不够：11-06 那条「还有三点值得学」本轮跑过两条命令，查的是别的事。只拦一次（stop_hook_active 放行）；模型超时或出错放行。
没有单独挂进桥的 Stop 名单：由 fix-claim-guard 调 check()，它已挂在所有后端（Claude、Codex、DSH、agy、grok）。
拦下和放行都记进 intent-judge.tsv（kind=check-first），统计复犯用。"""
import json, os, re, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import intent_judge  # noqa: E402  共用模型、超时和日志

QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`')
FENCE = re.compile(r"```.*?```", re.S)
# 只决定要不要往下看，不决定拦不拦
MAYBE = re.compile(
    r"我们|咱们|自家|桥(里|上|那边|这边)?|仓库里|wiki ?里|配置里|隔壁|现成|早就|已经有|还没有|没有(这|那)?(个|条|一)"
    r"|缺(一个|个|少|了)|没订阅|订阅了|值得(学|借鉴|抄)|建议(加|做|上|改|学|补)|(应该|该|可以|不妨)(加|做|补|学|上)(一个|个|一条|条|一层|上)?")
# 查现场的命令：读文件、搜、看配置/日志、上远端
LOOK_CMD = re.compile(r"\b(grep|rg|ls|cat|sed|head|tail|find|ssh|scp|jq|git|gh|diff|wc|awk|less|stat|sqlite3|docker|tree)\b"
                      r"|search\.py|sessions\.py|chanlog|codegraph|bothouse\S* (ctx|board|cron|timer|model|team)|tools\.exec_command")
LOOK_TOOL = re.compile(r"^(Read|Grep|Glob|LS|Agent|Task|read_file|grep|glob|list_dir|view|NotebookRead)$|codegraph|search", re.I)
MAX_LOOKS = 20  # 喂给模型的查现场调用条数（取最后这么多条）
ONLY_OUTSIDE = re.compile(r"^(?:\s*(?:/tmp/\S*|https?://\S*))+\s*$")  # 只碰临时目录或外网，不算查自家

SYSTEM = """你是一个判断器。助手要把一段话发给用户。判断：这段话里有没有对「我们自己的系统」现状的断言或建议，而助手这一轮查过的东西没覆盖它。
「我们自己的系统」= 用户和助手自己的桥/bothouse、仓库代码、wiki、配置、钩子、守卫、角色、服务器、容器、订阅、缓存、已有功能和流程。
算断言：
- 说我们有/没有/缺/早就有/已经做了/没做/只有/没订阅/没开/怎么运作 某样东西；
- 建议我们加/学/改/补某样东西（「值得学」「建议加」「该做个」「我们缺一个」），这隐含「我们现在没有」。
不算：只讲外部项目、别人怎么做，没拿来说我们有没有、该不该加；闲聊、情绪；转述用户刚说的话；
明确说「没核实/还没查/待查」的推测；只汇报自己刚做的动作（「已发出」「已派给某某」「我改了 X」）。
「本轮查过的」列出了这轮的工具调用。断言说的那样东西，要在这些调用里被读过、搜过、看过（目录、文件名、关键词对得上），才算覆盖。
查的是别的事（比如只核了另一件活的配置），断言却讲缓存、报告折叠、证据检查等别的东西 → 没覆盖。
只看回复立论靠的主断言和主建议（结论、推荐、「值得学的几条」这类）；顺带提一句的旁枝、引用本对话前文的、说「规则/CLAUDE.md/人设/手册里写着什么」的（这些规则每轮都在助手上下文里）、讲助手刚交付的活本身的，不算。
判断：有主断言且没覆盖 → unchecked；没有断言，或每条断言都被覆盖 → pass。拿不准就 pass。
只输出一个 JSON 对象，不要别的字：{"verdict":"unchecked|pass","claim":"第一条没覆盖的断言或建议原文，一句（pass 时空）"}"""

REASON = ("先查我们现有的：仓库、wiki、配置，再说。这句在说我们自家现状或建议加东西：「{claim}」，"
          "本轮没查过它说的那样东西（仓库、wiki、配置、日志或远端都没看）。先查（search.py 搜 wiki、grep 仓库、看配置和日志、上远端看），"
          "按查到的改写；查不了就在回复里写明「没核」。")


def _text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _real_user(e):
    """真实用户消息（tool_result 也是 type=user，不算新一轮）。"""
    if e.get("type") != "user" or e.get("isMeta"):
        return False
    c = (e.get("message") or {}).get("content")
    t = _text(c).strip()
    return bool(t) and not t.startswith("Stop hook feedback")


def turn(path):
    """(本轮助手文字, 本轮工具调用列表, 用户这轮原话)；读不出来返回 None。"""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, TypeError):
        return None
    texts, tools, user = [], [], ""
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if _real_user(e):
            user = _text((e.get("message") or {}).get("content"))
            break
        c = (e.get("message") or {}).get("content")
        if e.get("type") == "assistant" and isinstance(c, list):
            for b in c:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    texts.append(b.get("text", ""))
                elif b.get("type") == "tool_use":
                    tools.append(b)
    return "\n".join(reversed(texts)), tools, user


def is_lookup(b):
    name = b.get("name") or ""
    inp = b.get("input") or {}
    if LOOK_TOOL.search(name):
        return True
    cmd = inp.get("command", inp.get("cmd", "")) if isinstance(inp, dict) else inp
    cmd = cmd if isinstance(cmd, str) else json.dumps(cmd, ensure_ascii=False)
    if not LOOK_CMD.search(cmd):
        return False
    paths = re.findall(r"(?:~|/|https?://)\S*", cmd)
    return not paths or not ONLY_OUTSIDE.match(" ".join(paths))


def maybe(text):
    text = QUOTED.sub("", FENCE.sub("", text))
    return any(MAYBE.search(l) for l in text.splitlines() if not l.lstrip().startswith(">"))


def describe(b):
    inp = b.get("input") or {}
    if isinstance(inp, dict):
        v = inp.get("command") or inp.get("cmd") or inp.get("file_path") or inp.get("pattern") or inp.get("query") \
            or inp.get("prompt") or json.dumps(inp, ensure_ascii=False)
    else:
        v = inp
    return f"{b.get('name')}: {str(v)[:300]}"


def ask_model(reply, user, looks):
    t0 = time.time()
    res = {"verdict": "pass", "claim": "", "ms": 0, "cost": 0}
    prompt = (f"## 用户这轮的话（末尾）\n{(user or '（没有）')[-600:]}\n\n"
              f"## 本轮查过的（工具调用）\n" + ("\n".join(f"- {describe(b)}" for b in looks[-MAX_LOOKS:]) or "（一次都没查）") +
              f"\n\n## 要发给用户的回复\n{reply}")
    try:
        p = subprocess.run(
            ["claude", "-p", "--model", intent_judge.MODEL, "--tools", "", "--setting-sources", "", "--strict-mcp-config",
             "--no-session-persistence", "--system-prompt", SYSTEM, "--output-format", "json"],
            input=prompt, capture_output=True, text=True, timeout=intent_judge.TIMEOUT, cwd=tempfile.gettempdir())
        d = json.loads(p.stdout)
        res["cost"] = round(d.get("total_cost_usd") or 0, 5)
        txt = (d.get("result") or "").strip()
        j = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
        if j.get("verdict") in ("unchecked", "pass"):
            res.update(verdict=j["verdict"], claim=str(j.get("claim", "")))
    except Exception:  # 超时、没装 claude、输出不是 JSON：放行
        pass
    res["ms"] = int((time.time() - t0) * 1000)
    return res


def check(d):
    """Stop 载荷 → 拦下理由（str）或 None。"""
    if d.get("stop_hook_active"):
        return None
    t = turn(d.get("transcript_path") or "")
    if t is None:
        return None  # 读不出本轮，分不清查没查，不误拦
    text, tools, user = t
    reply = d.get("last_assistant_message") or text
    if not reply or not maybe(reply):
        return None
    r = ask_model(reply, user, [b for b in tools if is_lookup(b)])
    verdict = "block" if r["verdict"] == "unchecked" else "pass"
    intent_judge._log("check-first", verdict, r["ms"], r["cost"], r["claim"] or reply.strip()[:60])
    if verdict != "block":
        return None
    return (REASON_CHAT if _team_chat() else REASON).format(claim=r["claim"].strip("「」"))


# 团队聊天频道里不现场去查：agentm 11-10 15:18 用户问「性能分析完成了吗」，它按任务板答了一句，被本检查要求「上远端看」，
# 就在聊天频道里起了远端核查（第 8 步、1 分半）。聊天频道只按任务板、交接和工作区回报说，要现场核就交工作区。
REASON_CHAT = ("这是聊天频道，不在这里现场查。这句在说我们自家现状：「{claim}」。按任务板、交接文件和工作区最近回报能对上的就照说，"
               "并写明「据工作区某时回报」；对不上或要上远端、跑命令才能确认的，写「没现场核」，要核就用 ws-forward 交给负责的工作区查。")


def _team_chat():
    """同 bash-guard._team_chat：团队模式下的聊天频道会话；判断不了当不是。"""
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location("drg", os.path.join(HERE, "dispatch-review-guard.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return os.path.isfile(os.path.join(m._data_dir(), "team_workspaces.json")) and not m.in_workspace()
    except Exception:
        return False


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        return
    why = check(d)
    if why:
        print(json.dumps({"decision": "block", "reason": why}, ensure_ascii=False))


if __name__ == "__main__":
    main()
