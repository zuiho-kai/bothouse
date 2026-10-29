#!/usr/bin/env python3
"""PreToolUse(Bash)：用户最新一条消息只在提问、没有让 agent 去做，就拦下派活、转活和挂定时。
只看命令里有 ws-handoff、ws-forward、board add、bothouse timer add、bothouse cron add 的。
定时任务、别的 bot 触发的轮放行；读不到用户原话或判不准时放行；hook 自己出错时静默放行。
例："修了么""什么进度"→ 拦；"做""可以""帮我改一下"→ 放行；"别改"→ 拦。"""
import json, re, sys

DISPATCH = re.compile(r"\bws-handoff\b|\bws-forward\b|\bboard\s+add\b|\bbothouse['\"]?\s+(timer|cron)\s+add\b")
AUTO = "This request is automated or from another bot"
# 桥在用户原话前拼的标记，取最后一个之后的段落
ANCHORS = ("（最新，回这条）", "（用户这条明确 @ 了你或回复了你", "[Current request and context]")
TAIL = re.compile(r"\n*\(Images also saved locally:.*\Z", re.S)

DO = r"做|改|修|搞|加|删|派|弄|跑|试|处理|安排|上线|发版|重启"
# 先去掉不是叫做的用法：「没说做」「别改」「怎么做的」「修了没」「跑通了吗」
NOT_DO = re.compile(
    r"(没|不|别|不要|没有)(说|让|叫)?(" + DO + r")"
    r"|(怎么|如何|咋)(" + DO + r")"
    r"|(" + DO + r")(好|完|通|掉|成)?(了)?(没有|没|么|吗|嘛|呢)")
DO_WORD = re.compile(DO + r"|帮我|帮忙|(?<![过回出下上进失除])去|马上|赶紧|看一下|看看|查一下|反对")
AFFIRM = re.compile(r"^(可以|行|好|好的|ok|嗯|对|同意|批准|go|上|都做|就这样)[吧啊呀的了。！!～~\s]*$", re.I)
STOP = re.compile(r"^\s*(不要|别|不用|先别|停)")
ASK = re.compile(r"[？?]|吗|么|嘛|呢|什么|怎么|为什么|为啥|是不是|有没有|能不能|会不会|要不要|哪|多少|进度|状态|没$")

REASON = "用户这条只在问，没让做。先回答；要做的话末尾问一句，等用户说做再派。"


def last_prompt(path):
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        c = (e.get("message") or {}).get("content")
        if e.get("type") == "user" and not e.get("isMeta"):
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                t = "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
                if t:
                    return t
    return None


def user_words(t):
    i = max((t.rfind(a) for a in ANCHORS), default=-1)
    if i >= 0:
        t = t[i:].split("\n", 1)[1] if "\n" in t[i:] else ""
    if "[replying to " in t:  # 引用的是我上一条回复
        i = t.index("[replying to ")
        j = t.rfind("]\n", i)
        t = t[:i] + (t[j + 2:] if j >= 0 else "")
    return TAIL.sub("", t).strip()


def only_asking(words):
    if not words:
        return False
    if STOP.search(words):
        return True
    if AFFIRM.match(words):
        return False
    rest = NOT_DO.sub("", words)
    if DO_WORD.search(rest):
        return False
    return bool(ASK.search(words))


def main():
    d = json.load(sys.stdin)
    cmd = (d.get("tool_input") or {}).get("command") or ""
    if not DISPATCH.search(cmd):
        return
    prompt = last_prompt(d.get("transcript_path", ""))
    if not prompt or AUTO in prompt:
        return
    if only_asking(user_words(prompt)):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": REASON}}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
