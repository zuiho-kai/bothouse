#!/usr/bin/env python3
"""Stop：回复里有要用户拍板的问题时，交小模型对照「产品意图卡」和用户最近的话判断（intent_judge.py）：
能推出答案的拦回并给出答案；能撤回的事拦回让它自己做（11-10）；与用户定过的冲突的拦回并指出哪条；真是方向/花钱/对外/删除才放行。
回复里让用户放文件、跑命令、改设置的（「要你做的」或「请把……」那几行），先经桥的同一份规则（bothouse report check --self-route）拦回让它换路。
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
MAYBE_ASK = re.compile(r"[？?]|你定|您定|拍板|选哪|方案|选项|要不要|你选|要你(做|定)的[】：:]?[\t 　]*(?!没有|无|[】：:\t 　])")
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
    if r["verdict"] == "reversible":
        return (f"这事能撤回，按用户 11-10 定的规矩自己做，不问用户：「{r['question']}」→ {r['answer']}（{r['basis'].rstrip('。')}）。"
                "沙盒、测试、能撤回的直接干；只有真钱、发到外面、删东西、换方向才问他。删掉这个问题，自己做完再报结果。"
                "要是判断器漏了什么（这步其实撤不回），就照常发问，写明为什么撤不回。")
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
    if not text:
        return
    # 让用户放文件、跑命令、改设置：程序打回让它换路，不调模型（用户 11-10「你自己搞，你忘了我跟你说的事情了么」）
    why = intent_judge.self_route(QUOTED.sub("", FENCE.sub("", text)))
    if why:
        print(json.dumps({"decision": "block", "reason": why}, ensure_ascii=False))
        return
    if not maybe_asking(text):
        return
    r = intent_judge.judge(text, users, kind="reply")
    if r["verdict"] in ("reversible", "conflict"):
        print(json.dumps({"decision": "block", "reason": reason(r)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
