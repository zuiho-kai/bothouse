#!/usr/bin/env python3
"""PreToolUse：用户最新一条消息只在提问、没有让 agent 去做，就拦下自己动手改：编辑类工具（Edit/Write/MultiEdit/NotebookEdit，Codex 的 apply_patch；run.py 已把别的 CLI 的
   编辑工具名换成这几个）。改 wiki（GATE_WIKI，默认 ~/wiki）、角色 notes/ 和临时目录的放行。
派活、转活、任务板、定时、发消息一律放行（10-30：问进度的话曾挡住提醒工作区）。
用户原话：payload 的 user_prompt（run.py 按 CLI 填：DSH 会话记录、Codex rollout、agy transcript），没有再读 transcript_path（Claude Code / Qoder 格式）。
子 agent（payload 有 agent_id）是已派出的活，放行：它的 transcript_path 指向主会话的最新一句，不能拿来判。
定时任务、别的 bot 触发的轮放行；读不到用户原话或判不准时放行；hook 自己出错时静默放行。
用户在一轮中途插进来的话，Claude Code 不记成 user 行，记成 attachment 行（queued_command）：也算用户最新一句。
链接里的 ? 不算提问：判断前先去掉链接。
例："修了么""什么进度"→ 拦；"做""可以""帮我改一下""你可以给我…吗？我想你开一个…"→ 放行；"别改"→ 拦。"""
import json, os, re, sys

AUTO = "This request is automated or from another bot"
# 桥在用户原话前拼的标记，取最后一个之后的段落
ANCHORS = ("（最新，回这条）", "（用户这条明确 @ 了你或回复了你", "[Current request and context]")
TAIL = re.compile(r"\n*\(Images also saved locally:.*\Z", re.S)

DO = r"做|改|修|搞|加|删|派|弄|跑|试|写|记|存|处理|安排|上线|发版|重启|创建|开|建|干|配|设|装|发"
# 先去掉不是叫做的用法：「没说做」「别改」「怎么做的」「修了没」「跑通了吗」
NOT_DO = re.compile(
    r"(没|不|别|不要|没有)(说|让|叫)?(" + DO + r")"
    r"|(怎么|如何|咋)(" + DO + r")"
    r"|(" + DO + r")(好|完|通|掉|成)?(了)?(没有|没|么|吗|嘛|呢)")
# 客气的请求也算叫做：「你可以给我…吗」「能不能帮我…」「我想你开一个…」（agentm 11-09 实例）
DO_WORD = re.compile(DO + r"|帮我|帮忙|给我|我想你|我想让你|我要你|麻烦你|你可以|能不能帮|(?<![过回出下上进失除])去|马上|赶紧|看一下|看看|查一下|反对")
AFFIRM = re.compile(r"^(可以|行|好|好的|ok|嗯|对|同意|批准|go|上|都做|就这样)[吧啊呀的了。！!～~\s]*$", re.I)
STOP = re.compile(r"^\s*(不要|别|不用|先别|停)")
ASK = re.compile(r"[？?]|吗|么|嘛|呢|什么|怎么|为什么|为啥|是不是|有没有|能不能|会不会|要不要|哪|多少|进度|状态|没$")

# 链接里的 ?token= 不是提问（11-11：一条全是订阅链接的消息被判成只在问）
URL = re.compile(r"https?://[^\s\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+", re.I)

EDIT_REASON = "用户这条只在问，没让做。先回答，不改文件、不跑写操作；要改的话末尾问一句，等用户说做再改。"

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}  # apply_patch: Codex
WIKI = os.path.expanduser(os.environ.get("GATE_WIKI") or "~/wiki").rstrip("/")
DATA = os.path.expanduser(os.environ.get("BOTHOUSE_DATA_DIR") or "~/.bothouse").rstrip("/")
# 放行的位置：wiki（记忆）、角色目录 notes/（方案和交接稿）、临时目录
FREE = re.compile(re.escape(WIKI) + r"(?:/|$)|" + re.escape(DATA) + r"/roles/[^/]+/notes/|^(?:/private)?/tmp/|^/var/folders/")


def edits(d):
    """编辑类工具改的不是 wiki 或临时目录。apply_patch 的路径在 *** Add/Update/Delete File: 行。"""
    tool, inp, cwd = d.get("tool_name"), d.get("tool_input") or {}, d.get("cwd") or ""
    if tool not in EDIT_TOOLS:
        return False
    if not isinstance(inp, dict):
        inp = {"command": inp}
    paths = [inp.get("file_path") or inp.get("notebook_path") or inp.get("path") or ""]
    if tool == "apply_patch":
        text = inp.get("command") or inp.get("patch") or inp.get("input") or ""
        text = "\n".join(map(str, text)) if isinstance(text, list) else str(text)
        paths = re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$", text, re.M)
    paths = [os.path.join(cwd, p) if cwd and not os.path.isabs(p) else p for p in paths]
    return not paths or any(not FREE.search(p) for p in paths)


def last_prompt(path):
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except (OSError, TypeError, ValueError):
        return None
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        # A message the user sent while the turn was running: Claude Code logs it as an attachment line,
        # not as a user line (11-11: 「帮我记录一下…」 was skipped and the message before it was judged).
        a = e.get("attachment")
        if e.get("type") == "attachment" and isinstance(a, dict) and a.get("type") == "queued_command":
            if a.get("commandMode") in (None, "prompt") and isinstance(a.get("prompt"), str) and a["prompt"].strip():
                return a["prompt"]
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
    words = URL.sub(" ", words or "").strip()
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
    if not isinstance(d, dict) or d.get("agent_id"):
        return
    # Dispatching, forwarding, the task board, timers and sends are never stopped: a progress
    # question ("验证怎么样了") must not block reminding a workspace (user 10-30 复盘). Only own edits are.
    reason = EDIT_REASON if edits(d) else None
    if not reason:
        return
    prompt = d.get("user_prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        prompt = last_prompt(d.get("transcript_path") or "")
    if not prompt or AUTO in prompt:
        return
    if only_asking(user_words(prompt)):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason}}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
