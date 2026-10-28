"""用户要的是方案、还没拍板时，拦住「开做」的动作（派活、转工作区、改代码、提交、合并、重启）。

起因（用户 2026-10-28 22:0x）：「我都说了给你要方案，我都没决定，你就开始做了……这个犯了很多次了，这个自己修一下」。
同类错多次（10-26「你先研究一下，你先别做」、10-25 首版方案被叫停），按规则改成检查，不再加字。

判定：从会话记录里按顺序取人类发的消息正文（桥块里「这条明确 @ 了你」标记之后、去掉引用行），
每条里最后出现的是「要方案」类词就记成待批，最后出现的是「做吧」类词（或整条就是「做」「可以」）就记成已批；
两类都没有的消息不改状态。待批时 bash-guard / dispatch-review-guard 调 blocked() 拦。
"""
import json, re

PLAN = re.compile(r"给个?方案|要方案|出个?方案|先给|先别(改|做|动)|别(动手|开工)|先不(改|做)|先讨论|先研究|只研究|纯研究|先想想|先说说")
GO = re.compile(r"去做|开始做|可以做|就这么做|做吧|改吧|干吧|上吧|动手吧|开工|按(这个|方案)|照(这个|方案)|"
                r"修一下|改一下|搞一下|弄一下|处理一下|直接(改|做|修)|合到|发版|出版本")
GO_WHOLE = re.compile(r"^\s*(做|干|改|上|修|可以|行|好|好的|同意|ok|OK|就这样|照这个来|没问题)\s*[吧啊。！!，,]*\s*$")
MARK = "（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）"
HUMAN = "This request is from a human."


def _text(c):
    if isinstance(c, list):
        return "".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return c if isinstance(c, str) else ""


def human_messages(transcript_path):
    out = []
    try:
        f = open(transcript_path, encoding="utf-8")
    except (OSError, TypeError):
        return out
    with f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("type") != "user":
                continue
            c = _text((d.get("message") or {}).get("content"))
            if HUMAN not in c or MARK not in c:
                continue
            body = c.rsplit(MARK, 1)[1].lstrip("\n")
            if body.startswith("[replying to"):
                body = body.split("]\n", 1)[1] if "]\n" in body else ""
            out.append(body.strip())
    return out


def _last(rx, s):
    return max((m.end() for m in rx.finditer(s)), default=-1)


def pending(transcript_path):
    """待批时返回那条要方案的原话，否则 None。"""
    asked = None
    for msg in human_messages(transcript_path):
        if GO_WHOLE.match(msg):
            asked = None
            continue
        p, g = _last(PLAN, msg), _last(GO, msg)
        if p > g:
            asked = msg
        elif g > p:
            asked = None
    return asked


ACT = re.compile(r"(^|[\s/;&|])(ws-handoff|safe-restart|codesign)\b|gh\s+pr\s+(create|merge)|git\s+(commit|push|cherry-pick)|make\s+build")
FORWARD = re.compile(r"(^|[\s/;&|])ws-forward\b")
STOPWORDS = re.compile(r"停|撤回|暂停|别做|不做|回退")


def bash_blocked(cmd):
    if ACT.search(cmd):
        return True
    return bool(FORWARD.search(cmd)) and not STOPWORDS.search(cmd)


def message(asked):
    return ("用户要的是方案，还没拍板（原话：「" + asked[:80] + "」）。这一轮只给方案、不派活、不转工作区、"
            "不改代码、不提交合并、不重启；等用户回「做」「可以」这类话再动手。要叫停已派出去的活，ws-forward 正文写「停/撤回」可以放行。")
