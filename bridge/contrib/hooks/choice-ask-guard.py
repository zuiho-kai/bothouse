#!/usr/bin/env python3
"""Stop：回复里给用户出了选择题/拍板题（「要不要」「你定」「选哪个」「方案一/二」「A 还是 B？」），
却没先写自己的答案 → 拦下一次，要求先自己推：能推出来就自己定、照做；推不出才问，并附答案、依据、为何不能自己定。
出处：2026-10-31 一小时内两次拿常识题问用户（底座喇叭、窝开缺口），10-30 把缺口清单机械转给用户；
「只问方向和花钱」写在规则里拦不住（3 次），用户要求修根因：问用户的出口加检查。
放行：带「我的答案」「依据」「为何不能自己定」三项；引号/代码里的词；引用行（> 开头）；没有问句。
只拦一次（stop_hook_active 时放行），避免死循环。"""
import json, re, sys

# 引号、书名号、反引号里的词是在引用，不是在问（同 fix-claim-guard）
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`')
FENCE = re.compile(r"```.*?```", re.S)
# 让用户做选择的说法
CHOICE = re.compile(
    r"要不要|需不需要|用不用|你定|您定|你来定|你决定|请你定|你拍板|请拍板|等你拍|你选|选哪|哪个好|哪种好|哪一个|"
    r"方案\s*[一二三四ABCD1-4]|选项\s*[一二三四ABCD1-4]|"
    r"还是[^，,。；;\n]{0,30}[？?]|"
    r"(要|需要|让)我[^，,。；;\n]{0,30}(吗|么)[？?]?")
# 句子要是问句或明确交给用户定，才算出题
ASKING = re.compile(r"[？?]|你定|您定|你来定|你决定|请你定|拍板|你选")
SENT = re.compile(r"[^。！!？?\n]*[。！!？?]?")
ANSWER = ("我的答案", "依据", "为何不能自己定")

REASON = ("你要给用户出选择题，但没先写自己的答案（规则：只问方向和超预算花钱）。"
          "先自己推：照用户以前定过的话、产品用途和常识，能推出来就自己定、照做，删掉这个问题，汇报写「我决定 X，因为 Y」。"
          "会推翻或改动用户以前定过的东西（哪怕看着是常识）不算常识题，必须问，不能自己改。"
          "确实是方向（用户没选过的路线）、改用户定过的事或超预算花钱才问，问题前写三项："
          "我的答案：…；依据：…；为何不能自己定：方向/改用户定过的/花钱（说明是哪一种）。")


def choice_questions(text):
    """回复里给用户的选择题句子。"""
    text = QUOTED.sub("", FENCE.sub("", text))
    lines = [l for l in text.splitlines() if not l.lstrip().startswith(">")]
    out = []
    for line in lines:
        for s in SENT.findall(line):
            if s.strip() and CHOICE.search(s) and ASKING.search(s):
                out.append(s.strip())
    return out


def answered(text):
    return all(k in text for k in ANSWER)


def last_text(path):
    """transcript 里最后一条助手 text（last_assistant_message 缺失时用）。"""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return ""
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        c = (e.get("message") or {}).get("content")
        if e.get("type") == "user" and not e.get("isMeta"):
            if isinstance(c, str) or (isinstance(c, list) and any(b.get("type") == "text" for b in c if isinstance(b, dict))):
                return ""
        if e.get("type") == "assistant" and isinstance(c, list):
            t = "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
            if t.strip():
                return t
    return ""


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        return
    if d.get("stop_hook_active"):
        return
    text = d.get("last_assistant_message") or last_text(d.get("transcript_path", ""))
    qs = choice_questions(text)
    if not qs or answered(text):
        return
    print(json.dumps({"decision": "block", "reason": REASON + " 被拦的句子：" + qs[0][:80]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
