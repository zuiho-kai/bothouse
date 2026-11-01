#!/usr/bin/env python3
"""Stop：回复里有要用户拍板的问题时，交小模型对照「产品意图卡」和用户最近的话判断（intent_judge.py）：
能推出答案的拦回并给出答案；与用户定过的冲突的拦回并指出哪条；真是方向/花钱才放行。不靠关键词定输赢。
出处：2026-10-31 一小时内两次拿常识题问用户（底座喇叭、窝开缺口），又擅自挪了用户定过的触摸铜片；
旧版正则拦截只认字面（把「你定过的东西」当成在问），用户「这个太笨了……你自己思考」「有没有更好的办法，更智能的办法」。
触发：回复里有问号或「你定/拍板/选哪/方案/选项/要不要」才调模型（没有就不花钱）；引号、代码、引用行里的不算。
只拦一次（stop_hook_active 时放行）；模型超时或出错放行。"""
import json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import intent_judge  # noqa: E402

# 引号、书名号、反引号里的词是在引用，不是在问（同 fix-claim-guard）
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`')
FENCE = re.compile(r"```.*?```", re.S)
# 只用来决定要不要调模型，不决定拦不拦
MAYBE_ASK = re.compile(r"[？?]|你定|您定|拍板|选哪|方案|选项|要不要|你选")
USER_MSGS = 10  # 交接「范围」定：最近 10 条用户消息
TAIL = 600  # 每条用户消息取末尾这么多字：桥把系统块放前面、用户原话放最后（实看 10-31 会话记录）


def maybe_asking(text):
    text = QUOTED.sub("", FENCE.sub("", text))
    return any(MAYBE_ASK.search(l) for l in text.splitlines() if not l.lstrip().startswith(">"))


def _text(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""


def read_transcript(path):
    """(最后一条助手文字, 最近 USER_MSGS 条用户消息)。"""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, TypeError):
        return "", []
    last, users = "", []
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        c = (e.get("message") or {}).get("content")
        if e.get("type") == "assistant" and not last and not users:
            last = _text(c).strip()
        if e.get("type") == "user" and not e.get("isMeta"):
            t = _text(c).strip()
            if t and not t.startswith("Stop hook feedback"):
                users.append(t[-TAIL:])
                if len(users) >= USER_MSGS:
                    break
    return last, list(reversed(users))


def reason(r):
    if r["verdict"] == "self":
        return (f"这个问题按用户定过的话能推出来，不该问用户：「{r['question']}」→ {r['answer']}（{r['basis'].rstrip('。')}）。"
                "删掉这个问题，照这个答案定、照做，回复写「我决定 X，因为 Y」。"
                "要是判断器不知道某个事实、它推错了，就照常发问，但写明它漏了什么。")
    return (f"这条和用户定过的冲突：「{r['question']}」违背 {r['basis'].rstrip('。')}。合定案的做法：{r['answer']}。"
            "按定案改，不要拿冲突的选项去问用户；确实要推翻定案，才问用户，并引用那条原话。")


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        return
    if d.get("stop_hook_active"):
        return
    last, users = read_transcript(d.get("transcript_path"))
    text = d.get("last_assistant_message") or last
    if not text or not maybe_asking(text):
        return
    r = intent_judge.judge(text, users, kind="reply")
    if r["verdict"] in ("self", "conflict"):
        print(json.dumps({"decision": "block", "reason": reason(r)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
