#!/usr/bin/env python3
"""Stop：回真人的最终回复太长、带 markdown 表格或加粗小标题 → 拦回一次，要求改短重写。
出处：用户 2026-11-05「段落太长了」、11-06「为什么他的一大堆长篇大论」、11-05「一些规则该搞该搞的就搞啊，然后就变成我们的产品能力」。
人设里写「短段落、不用表格」管不住便宜模型，所以做成检查。

放行：stop_hook_active（只拦一次）、子 agent（agent_id）、定时任务和别的 bot 触发的轮（桥拼的标记）、读不到回复。
定时/别的 bot 触发的轮，回复要贴到真人看的聊天频道时（桥拼 HUMAN 标记），照查（#1109：定时验收轮在真人频道发了两千字拒答）。
[report]/[ask] 开头的回复（工作区交回、提问）按团队规矩另算：只查贴到聊天频道的头几行（「细节」那行之前）。

门槛：hooks 目录下 reply-length-guard.json（和本脚本同目录，可不建），只有一个字段 max_chars，默认见 MAX_CHARS。
数的是去掉空白、链接和代码块后的字数；0 = 不查长度（表格和加粗标题照查）。"""
import json, os, re, sys

# 来源：#1105 交接范围「超过约 600 字……门槛做成配置项」（主角色按用户「段落太长了」定的默认值）
MAX_CHARS = 600
CONF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reply-length-guard.json")

AUTO = "This request is automated or from another bot"
TIMER = "（定时任务，回这条）"
RELAY = "[工作区回传]"
HUMAN = "[Bridge: this reply is posted in a chat channel people read]"  # 和桥 core/agent_identity.go humanChatMark 一致

TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", re.M)
# 一整行开头是加粗的短标签（**结论** / **结论：** / **结论**：…），或 markdown 标题行
BOLD_HEAD = re.compile(r"^\s*(?:[-*]\s+)?(?:\*\*|__)[^*_\n]{1,24}(?:\*\*|__)\s*(?:[:：]|$)|^\s{0,3}#{1,6}\s+\S", re.M)
FENCE = re.compile(r"```.*?```", re.S)
URL = re.compile(r"https?://\S+")
DETAIL = re.compile(r"^\s*(细节|details?)\s*[:：]", re.M | re.I)
HEAD_TAG = re.compile(r"^\s*\[(report|ask)\]", re.I)


def max_chars():
    try:
        with open(CONF, encoding="utf-8") as f:
            v = json.load(f).get("max_chars")
        if isinstance(v, int) and v >= 0:
            return v
    except (OSError, ValueError, AttributeError):
        pass
    return MAX_CHARS


def entries(path):
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, TypeError, ValueError):
        return []
    out = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            out.append(e)
    return out


def is_prompt(e):
    """真实用户消息（tool_result 也是 type=user，不算）。"""
    if e.get("type") != "user" or e.get("isMeta"):
        return False
    c = (e.get("message") or {}).get("content")
    return isinstance(c, str) or (isinstance(c, list) and any(
        isinstance(b, dict) and b.get("type") == "text" for b in c))


def prompt_text(e):
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str):
        return c
    return "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")


def last_turn(path):
    """(最后一条用户消息, 之后助手的最后一段文字)。"""
    prompt, reply = None, ""
    for e in reversed(entries(path)):
        if is_prompt(e):
            prompt = prompt_text(e)
            break
        c = (e.get("message") or {}).get("content")
        if not reply and e.get("type") == "assistant" and isinstance(c, list):
            reply = "\n".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()
    return prompt, reply


def problems(text, limit):
    out = []
    body = FENCE.sub("", text)
    n = len(re.sub(r"\s", "", URL.sub("", body)))
    if limit and n > limit:
        out.append(f"约 {n} 字，超过 {limit} 字")
    if TABLE_SEP.search(body):
        out.append("用了表格")
    if BOLD_HEAD.search(body):
        out.append("用了加粗小标题或 # 标题")
    return out


def check(reply, prompt, limit):
    """要拦就返回理由，放行返回 None。"""
    if not reply or not reply.strip():
        return None
    if HEAD_TAG.match(reply):
        m = DETAIL.search(reply)
        head = reply[:m.start()] if m else "\n".join(reply.strip().splitlines()[:4])
        bad = problems(head, limit)
        if not bad:
            return None
        return ("[report]/[ask] 贴到聊天频道的头几行" + "、".join(bad) +
                "。头几行改成对真人说的大白话短句，不用表格和加粗标题；细节放到「细节：」之后。")
    if prompt is not None and HUMAN not in prompt and (AUTO in prompt or TIMER in prompt or RELAY in prompt):
        return None
    bad = problems(reply, limit)
    if not bad:
        return None
    cap = f"总共不超过 {limit} 字；" if limit else ""
    return ("这条回复要发给真人，" + "、".join(bad) + "。重写成短的再发：先说结论，最多三段大白话，"
            "不用表格、加粗小标题和代码，" + cap + "细节写进文档或等对方追问。")


def main():
    d = json.load(sys.stdin)
    if not isinstance(d, dict) or d.get("stop_hook_active") or d.get("agent_id"):
        return
    prompt, turn_reply = last_turn(d.get("transcript_path") or "")
    reply = d.get("last_assistant_message") or turn_reply
    up = d.get("user_prompt")
    if isinstance(up, str) and up.strip():
        prompt = up
    reason = check(reply, prompt, max_chars())
    if reason:
        print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
