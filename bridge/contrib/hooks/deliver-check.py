#!/usr/bin/env python3
"""PreToolUse(Bash)：`bothouse send --image/--file/--video <文件>` 发成品前的检查，缺一样就拦。
两项检查（只看带附件的 send；纯文字、--tts、--audio 不拦）：
 (a) 看过成品：本轮（最后一条用户消息之后）用 Read 打开过要发的这个文件本身（同一路径），且打开之后文件没再改过。
     Read 打不开的格式（docx/pptx/xlsx/视频/压缩包…）认本轮 Read 过的、文件名含成品主名、比成品新的渲染图/PDF。
     只在认得出会话记录格式时查：Claude Code / Qoder JSONL、DSH（run.py 转成 Claude Code 格式）、Codex rollout
     （view_image）。Gemini、Grok、Cursor、Kimi 的 PreToolUse 拿不到工具调用记录，这项跳过（stderr 说明）。
 (b) 对过验收单：本角色有开着的验收单（accept.py）时，每个要发的文件（按内容指纹）都要
     `accept check <活名> <文件> "<逐条对照>"…` 对照过某张单子的全部当前条目，或 `accept skip <文件> "<原因>"`。
     单子后来加了条目，旧的对照作废。
由 run.py 在 bash-guard 之前调用（共用 bash-guard 在各家 CLI 的注册），可单独 `run.py off deliver-check` 关掉。
钩子自己出错时放行。"""
import importlib.util
import json
import os
import shlex
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
READABLE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".pdf", ".svg", ".txt", ".md", ".html", ".htm",
            ".csv", ".json", ".py", ".js", ".ts", ".css", ".xml", ".yaml", ".yml", ".log", ".tsv", ".ipynb"}
PREVIEW = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".pdf"}
FLAGS = ("--image", "--file", "--video")
SEPS = {";", "&&", "||", "|", "&", "\n", "(", ")"}


def accept_mod():
    spec = importlib.util.spec_from_file_location("accept_sheet", os.path.join(HERE, "accept.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sent_files(command, cwd):
    """`bothouse send` 命令里 --image/--file/--video 后的文件（绝对路径）。解析不了返回 []。"""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        toks = list(lex)
    except ValueError:
        return []
    out, i = [], 0
    while i < len(toks):
        t = toks[i]
        if os.path.basename(t) == "bothouse" and i + 1 < len(toks) and toks[i + 1] == "send":
            j = i + 2
            while j < len(toks) and toks[j] not in SEPS:
                a = toks[j]
                val = None
                if a in FLAGS and j + 1 < len(toks):
                    val, j = toks[j + 1], j + 1
                elif a.split("=", 1)[0] in FLAGS and "=" in a:
                    val = a.split("=", 1)[1]
                if val:
                    p = os.path.expandvars(os.path.expanduser(val))
                    if "$" not in p:
                        out.append(os.path.normpath(os.path.join(cwd, p)))
                j += 1
            i = j
        i += 1
    return out


def ts(s):
    if not isinstance(s, str) or not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(c.get("text", "") for c in content
                       if isinstance(c, dict) and c.get("type") in ("text", "input_text"))
    return ""


CODEX_INJECTED = ("# AGENTS.md instructions", "<environment_context>", "<user_instructions>", "<permissions instructions>")


def reads_this_turn(path):
    """(认得出格式, [(打开的绝对路径, 时间戳)])：本轮成功的 Read / view_image。"""
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except (OSError, TypeError, ValueError):
        return False, []
    known, start, entries = False, 0, []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            entries.append(e)
    for i, e in enumerate(entries):
        t = e.get("type")
        if t in ("user", "assistant"):
            known = True
        if t == "user" and not e.get("isMeta"):
            c = (e.get("message") or {}).get("content")
            if text_of(c).strip() and not (isinstance(c, list) and any(
                    isinstance(x, dict) and x.get("type") == "tool_result" for x in c)):
                start = i
        elif t == "response_item":
            known = True
            p = e.get("payload") or {}
            if p.get("type") == "message" and p.get("role") == "user":
                txt = text_of(p.get("content"))
                if txt.strip() and not txt.lstrip().startswith(CODEX_INJECTED):
                    start = i
    uses, failed = {}, set()
    for e in entries[start:]:
        t, when = e.get("type"), ts(e.get("timestamp"))
        if t == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Read", "read_image"):
                    inp = c.get("input") or {}
                    fp = inp.get("file_path") or inp.get("path") or inp.get("absolute_path")
                    if isinstance(fp, str) and fp:
                        uses[c.get("id") or id(c)] = (fp, when)
        elif t == "user":
            c = (e.get("message") or {}).get("content")
            for x in c if isinstance(c, list) else []:
                if isinstance(x, dict) and x.get("type") == "tool_result" and x.get("is_error"):
                    failed.add(x.get("tool_use_id"))
        elif t == "response_item":
            p = e.get("payload") or {}
            if p.get("type") in ("function_call", "custom_tool_call") and p.get("name") == "view_image":
                args = p.get("arguments") or p.get("input") or "{}"
                try:
                    args = json.loads(args) if isinstance(args, str) else args
                except ValueError:
                    args = {}
                fp = (args or {}).get("path") if isinstance(args, dict) else None
                if isinstance(fp, str) and fp:
                    uses[p.get("call_id") or id(p)] = (fp, when)
    return known, [(fp, when) for k, (fp, when) in uses.items() if k not in failed]


def transcript_for(payload):
    tp = payload.get("transcript_path") or ""
    aid = payload.get("agent_id")
    atp = payload.get("agent_transcript_path")
    if aid and atp and os.path.isfile(atp):
        return atp
    if aid and tp:
        sub = os.path.join(os.path.dirname(tp), payload.get("session_id") or "", "subagents", "agent-%s.jsonl" % aid)
        if os.path.isfile(sub):
            return sub
    return tp


def seen_problem(f, reads, cwd):
    """None = 看过了；否则返回要补什么。"""
    try:
        mtime = os.path.getmtime(f)
    except OSError:
        return None
    norm = [(os.path.realpath(os.path.join(cwd, os.path.expanduser(p))), w) for p, w in reads]
    real = os.path.realpath(f)
    ext = os.path.splitext(f)[1].lower()
    hits = [w for p, w in norm if p == real]
    if ext in READABLE or not ext:
        if not hits:
            return "先用 Read 打开 %s 本身看一遍（看的是要发出去的这份，不是中间文件或局部裁图），再发。" % f
        if all(w is not None and w < mtime for w in hits):
            return "%s 在你本轮打开看过之后又改过：重新 Read 打开看最新这份，再发。" % f
        return None
    stem = os.path.splitext(os.path.basename(f))[0].lower()
    prev = [w for p, w in norm if os.path.splitext(p)[1].lower() in PREVIEW and stem in os.path.basename(p).lower()]
    if hits or any(w is None or w >= mtime for w in prev):
        return None
    return ("%s 这种格式 Read 打不开：先把它渲染成图或 PDF（文件名里带「%s」），Read 打开看过成品的样子，再发。"
            "渲染要在成品最后一次修改之后。" % (f, stem))


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}, ensure_ascii=False))
    sys.exit(0)


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    if payload.get("tool_name") != "Bash":
        return
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if "bothouse" not in cmd or "send" not in cmd or not any(fl in cmd for fl in FLAGS):
        return
    cwd = payload.get("cwd") or os.getcwd()
    allf = sent_files(cmd, cwd)
    files = [f for f in allf if os.path.isfile(f)]
    problems = []
    cli = payload.get("hook_cli") or ""
    known, reads = (False, [])
    if cli not in ("gemini", "grok"):
        known, reads = reads_this_turn(transcript_for(payload))
    if known:
        for f in allf:
            if not os.path.isfile(f):
                # 和生成它的命令写在同一条里（cp … && bothouse send …）：发之前没人看过它
                problems.append("【没看过成品】%s 现在还不存在：先单独生成好，用 Read 打开看过，再单独发。" % f)
    if not files and not problems:
        return
    if known:
        for f in files:
            p = seen_problem(f, reads, cwd)
            if p:
                problems.append("【没看过成品】" + p)
    else:
        sys.stderr.write("deliver-check: 认不出这家 CLI 的会话记录（%s），「看过成品」这项跳过\n" % (cli or "unknown"))
    acc = accept_mod()
    role = payload.get("bothouse_role") or acc.role_dir(cwd=cwd)
    sheets = acc.open_sheets(role)
    if sheets:
        missing = [f for f in files if not acc.covered(role, f)]
        if missing:
            shown = "\n\n".join(acc.render(d) for d in sheets)
            names = "、".join(d["name"] for d in sheets)
            problems.append(
                "【没对过验收单】这些文件还没逐条对照过：%s\n开着的验收单（%s）：\n%s\n"
                "看着成品逐条对：`accept check <活名> <文件> \"<第1条怎么对上的>\" \"<第2条…>\"`（每条一句，条数要和单子一样）。"
                "对不上的先改成品。这个文件确实不属于任何一张单子：`accept skip <文件> \"<原因>\"`；"
                "活已交完：`accept done <活名>`。" % ("、".join(missing), names, shown))
    if problems:
        deny("发成品前的检查没过（交付前验收）：\n" + "\n".join(problems) +
             "\n补齐后原样重发这条 send。用户新说的要求先 `accept add <活名> \"<原话>\"` 记上。")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # 钩子自己坏了不能挡住发送
        sys.stderr.write("deliver-check: %s: %s, passing\n" % (type(e).__name__, e))
