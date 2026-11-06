#!/usr/bin/env python3
"""Stop：回复对一个现象下了定性结论（不是病、不用管、就是 X 而已、原因是 X），只给了一个解释就收口，
而用户最近几条话里有指向更深原因的线索（从小、一直、反复、伴随症状，或用户自己提了标签、助手直接采纳）→ 拦一次，要求补上游原因再发。
出处：2026-11-07 用户描述从小考试、写代码时「身体和思想分离、像喝醉、觉得太慢」，又早两条说过「记忆力一直很差」；
橘顺着用户提的「心流」说「大概率不是病」「不用管」「就当它是你的专注开关，不用担心」。用户测 ASRS 筛查阳性后说
「你这问题不是第一次了，你复盘一下，修一下」。同类：「这个只是现象，不是核心的原因」（wiki work-process.md:61，复犯 4 次以上）。
两段式（照 check-first-guard）：便宜正则粗筛（只认收口、安抚词；「原因是/是因为」只在用户这轮在修 bug、复盘时才算）
→ 小模型看最近 8 条用户话和回复，「单一解释收口」和「前文有更深线索」两条同时成立才拦。只拦一次（stop_hook_active 放行）；模型超时或出错放行。
没有单独挂进桥的 Stop 名单：由 fix-claim-guard 和 check-first 并行调 check()（线程，耗时取两者最长，不相加）。
拦下和放行都记进 intent-judge.tsv（kind=surface）。"""
import json, os, re, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import intent_judge  # noqa: E402  共用模型、超时和日志

QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`')
FENCE = re.compile(r"```.*?```", re.S)
# 只决定要不要往下看，不决定拦不拦：收口、安抚词（审稿 2026-11-07：「原因是|正常的」太宽，闲聊每条都会多等一次模型）
CLOSE = re.compile(r"不是病|没病|不用管|不用担心|别担心|不碍事|没(什么|啥)?(大)?问题|没事的?|大概率不是|就是.{0,10}(而已|罢了)"
                   r"|只是.{0,10}(而已|罢了)|就当(它|这)?是|占便宜|很多人都(这样|会)")
# 讲原因的句子：只在用户这轮在修 bug、复盘时才往下看（10-14、10-30 那类「修在症状层」）
CAUSE = re.compile(r"原因是|根因是|是因为")
FIX_ASK = re.compile(r"修|bug|报错|错误|出错|坏了|挂了|失败|不对|不行|异常|崩|卡死|卡住|没反应|有问题|fix|复盘", re.I)
RELAY = "[工作区回传]"
N_USER = 8      # 喂给模型的最近用户话条数
USER_CAP = 300  # 每条截多少字（取末尾）
# bothouse 在用户原话前拼的系统块（队友状态、wiki 提示、频道补漏），不是用户写的
SYS_BLOCK = ("（队友状态", "（可能相关的 wiki 页", "（频道里你上次看到之后的消息")

SYSTEM = """你是一个判断器。助手要把一段话发给用户。判断：助手是不是拿到一个能解释现象的说法就收口了，而用户前文给过指向更深原因的线索。
两条都成立才算 shallow：
1. 现象层收口：回复对用户问的某个现象或问题给了定性结论（不是病、不用管、不用担心、就是 X、原因是 X），且只给了一个解释，没列别的可能，也没说怎么区分、去查什么。
2. 前文有更深线索：「用户最近的话」里（不只最后一条）有指向更深原因的线索：从小、一直、每次、反复、长期、又、不是第一次；或相关的其他症状（记性差、注意力、睡眠、情绪等）；或用户自己提了一个标签（「这是不是叫心流」）而助手直接采纳。
只给一个解释、再附一句「只有出现某某情况才去看医生/再查」的兜底，仍算收口：兜底不是别的可能，也没说现在怎么区分。
不算 shallow：闲聊、吐槽、安慰但没给定性的；只汇报做了什么；已列两种以上可能的解释并说了怎么区分，或明确建议现在就去就医、去查来区分的；用户只问名字或定义的；讲别人、外部的事的。
两条都成立 → shallow；否则 pass。拿不准就 pass。
只输出一个 JSON 对象，不要别的字：{"verdict":"shallow|pass","claim":"那句定性的原文，一句（pass 时空）","clue":"被忽略的前文线索原文，一句（pass 时空）"}"""

REASON = ("这句把现象定了性：『{claim}』。再问一层：为什么会持续这样？用户给的线索（{clue}）指向哪些上游原因？"
          "列出来，拿不准的写明要去查/去看医生，再重写整条回复。")
CLUE_DEFAULT = "从小、反复、只在某场景"


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
    t = _text((e.get("message") or {}).get("content")).strip()
    return bool(t) and not t.startswith("Stop hook feedback")


def user_words(t):
    """从拼好的用户消息里取出用户自己说的话：去掉桥的身份块、引用的上一条回复、系统块。"""
    if "（最新，回这条）" in t:
        t = t.rsplit("（最新，回这条）", 1)[1]
    m = list(re.finditer(r"^\[bothouse sender_id=[^\n]*\]\n", t, re.M))
    if m:
        t = t[m[-1].end():]
    if "[replying to " in t:
        i = t.index("[replying to ")
        j = t.rfind("]\n", i)
        t = t[:i] + (t[j + 2:] if j >= 0 else "")
    return "\n\n".join(p for p in t.split("\n\n") if not p.lstrip().startswith(SYS_BLOCK)).strip()


def read(path):
    """(本轮助手文字, 本轮用户原话（未清洗）, 最近 N_USER 条用户话（清洗后，旧→新）)；读不出来返回 None。"""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, TypeError):
        return None
    texts, last, users = [], None, []
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if _real_user(e):
            raw = _text((e.get("message") or {}).get("content"))
            if last is None:
                last = raw
            w = user_words(raw)
            if w:
                users.append(w[-USER_CAP:])
            if len(users) >= N_USER:
                break
            continue
        c = (e.get("message") or {}).get("content")
        if last is None and e.get("type") == "assistant" and isinstance(c, list):
            texts += [b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"]
    return "\n".join(reversed(texts)), last or "", list(reversed(users))


def maybe(reply, last_user):
    text = QUOTED.sub("", FENCE.sub("", reply))
    ls = [l for l in text.splitlines() if not l.lstrip().startswith(">")]
    if any(CLOSE.search(l) for l in ls):
        return True
    return any(CAUSE.search(l) for l in ls) and bool(FIX_ASK.search(user_words(last_user)))


def ask_model(reply, users):
    t0 = time.time()
    res = {"verdict": "pass", "claim": "", "clue": "", "ms": 0, "cost": 0}
    prompt = ("## 用户最近的话（旧→新）\n" + ("\n".join(f"- {u}" for u in users) or "（没有）") +
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
        if j.get("verdict") in ("shallow", "pass"):
            res.update(verdict=j["verdict"], claim=str(j.get("claim", "")), clue=str(j.get("clue", "")))
    except Exception:  # 超时、没装 claude、输出不是 JSON：放行
        pass
    res["ms"] = int((time.time() - t0) * 1000)
    return res


def check(d):
    """Stop 载荷 → 拦下理由（str）或 None。"""
    if d.get("stop_hook_active"):
        return None
    t = read(d.get("transcript_path") or "")
    if t is None:
        return None  # 读不出前文，看不到线索，不误拦
    text, last, users = t
    if RELAY in last:
        return None
    reply = d.get("last_assistant_message") or text
    if not reply or reply.lstrip().startswith("[report]") or not maybe(reply, last):
        return None
    r = ask_model(reply, users)
    verdict = "block" if r["verdict"] == "shallow" else "pass"
    intent_judge._log("surface", verdict, r["ms"], r["cost"], " ".join((r["claim"] or reply.strip()[:60]).split()))
    if verdict != "block":
        return None
    return REASON.format(claim=r["claim"].strip("「」『』"), clue=r["clue"].strip("「」『』") or CLUE_DEFAULT)


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
