#!/usr/bin/env python3
"""PreToolUse(Bash)：`bothouse send --image/--file/--video <文件>` 发成品前的检查，缺一样就拦。
两项检查（只看带附件的 send；纯文字、--tts、--audio 不拦）：
 (a) 看过成品：本轮（最后一条用户消息之后）用 Read 打开过要发的这个文件本身（同一路径），且打开之后文件没再改过。
     Read 打不开的格式（docx/pptx/xlsx/视频/压缩包…）认本轮 Read 过的、文件名含成品主名、比成品新的渲染图/PDF。
     只在认得出会话记录格式时查：Claude Code / Qoder JSONL、DSH（run.py 转成 Claude Code 格式）、Codex rollout
     （顶层 view_image；代码模式下嵌套的 cat/sed 等读文件命令和看图）。Gemini、Grok、Cursor、Kimi 的 PreToolUse 拿不到工具调用记录，这项跳过（stderr 说明）。
 (b) 对过验收单：本角色有开着的验收单（accept.py）时，每个要发的文件（按内容指纹）都要
     `accept check <活名> <文件> "<逐条对照>"…` 对照过某张单子的全部当前条目，或 `accept skip <文件> "<原因>"`。
     单子后来加了条目，旧的对照作废。
另有一项验收门（#1617）：主角色跑 ws-pass（放行，--stitch 预检不算）或 board done <号> 时，桥扣着的那件活的 [report]
正文里写到的本地图片，本会话都要 Read 打开过（打开后没再改）；内容完全相同的截图也拦下，要打回补拍。
由 run.py 在 bash-guard 之前调用（共用 bash-guard 在各家 CLI 的注册），可单独 `run.py off deliver-check` 关掉。
钩子自己出错时放行。"""
import hashlib
import importlib.util
import json
import os
import re
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


def reads_this_turn(path, whole=False):
    """(认得出格式, [(打开的绝对路径, 时间戳)])：本轮成功的 Read / view_image；whole=True 时整个会话。"""
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
    if whole:
        start = 0
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
        elif t == "event_msg":
            # Codex 代码模式（functions.exec 里嵌套 tools.exec_command / tools.view_image）不出顶层
            # view_image 调用，只在 item_completed 里留 CommandExecution（parsed_cmd 标 read）和 ImageView。
            p = e.get("payload") or {}
            it = p.get("item") or {} if p.get("type") == "item_completed" else {}
            if it.get("type") == "ImageView":
                fp = codex_path(it.get("path"), "")
                if fp:
                    uses[it.get("id") or id(it)] = (fp, when)
            elif it.get("type") == "CommandExecution" and it.get("status") == "completed" \
                    and it.get("exit_code") in (0, None):
                cwd = codex_path(it.get("cwd"), "")
                for k, pc in enumerate(it.get("parsed_cmd") or []):
                    if isinstance(pc, dict) and pc.get("type") == "read":
                        fp = codex_path(pc.get("path"), cwd)
                        if fp:
                            uses[(it.get("id") or id(it), k)] = (fp, when)
    return known, [(fp, when) for k, (fp, when) in uses.items() if k not in failed]


def codex_path(v, cwd):
    """Codex 事件里的路径：去掉 file:// 前缀，相对路径按命令的 cwd 补全。"""
    if not isinstance(v, str) or not v:
        return None
    if v.startswith("file://"):
        v = v[len("file://"):]
    if cwd and not os.path.isabs(v):
        v = os.path.join(cwd, v)
    return v


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
            return "先打开 %s 本身看一遍（Read；Codex 用 cat/sed 读全文、看图工具看图）（看的是要发出去的这份，不是中间文件或局部裁图），再发。" % f
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



# ---- 验收放行前看过截图（#1617）----
# 主角色 ws-pass（放行）或 board done（收口）一件工作区交回的活之前，桥扣着的 [report] 正文里写到的本地图片
# 本会话都要用 Read 打开过（打开后没再改）；内容完全相同的截图也报出来，打回补拍。
# 来源：#1609 只核了 PR 状态和测试数就放行，用户一眼看出页面乱；同类错 10-22、10-26、11-14 第三次
# （用户 11-14「我希望你能更加自主，不要老是我给你提醒」）。图片路径的认法照桥 core/team_exit_images.go exitImagePathRe。
IMG_PATH_RE = re.compile(r"(?i)(?:~/|/)[^\s\"'`<>()（）「」，。；：、]*\.(?:png|jpe?g|gif|webp)")
PATH_LEAD = set(" \t\n:：(（「`'\"")


def accept_targets(command):
    """命令里每个 ws-pass（不含 --stitch 预检）/ board done 调用：[(工具, 任务号 0=没写, 交接文件)]。"""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        toks = list(lex)
    except ValueError:
        return []
    out, i = [], 0
    while i < len(toks):
        name = os.path.basename(toks[i])
        if name in ("ws-pass", "board"):
            j, args = i + 1, []
            while j < len(toks) and toks[j] not in SEPS:
                args.append(toks[j])
                j += 1
            if name == "ws-pass" and "--stitch" not in args and not any(a in ("-h", "--help") for a in args):
                nid, notes = 0, ""
                for k, a in enumerate(args[:-1]):
                    if a == "--id" and args[k + 1].lstrip("#").isdigit():
                        nid = int(args[k + 1].lstrip("#"))
                    elif a == "--notes":
                        notes = args[k + 1]
                out.append(("ws-pass", nid, notes))
            elif name == "board" and args[:1] == ["done"] and len(args) > 1 and args[1].lstrip("#").isdigit():
                out.append(("board done", int(args[1].lstrip("#")), ""))
            i = j
            continue
        i += 1
    return out


def data_dir():
    return os.path.expanduser(os.environ.get("CC_DATA_DIR") or os.environ.get("BOTHOUSE_DATA_DIR") or "~/.bothouse")


def held_reports():
    """桥扣着等主角色验收、还没贴出的 [report]（data/team-reports/<项目>.json，Held 且没有 delivered_at）。"""
    proj = os.environ.get("CC_PROJECT") or ""
    d = os.path.join(data_dir(), "team-reports")
    files = [os.path.join(d, proj + ".json")] if proj else []
    if not files and os.path.isdir(d):
        files = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".json")]
    out = []
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                recs = json.load(fh)
        except (OSError, ValueError):
            continue
        for r in (recs.values() if isinstance(recs, dict) else recs or []):
            if isinstance(r, dict) and r.get("held") and not r.get("delivered_at") and r.get("kind", "report") == "report":
                out.append(r)
    return out


def board_ids_for_notes(notes):
    """交接文件在任务板上的编号（where 栏）。"""
    real = os.path.realpath(os.path.expanduser(notes))
    bdir = os.environ.get("BOARD_DIR") or os.path.join(data_dir(), "team")
    ids = set()
    try:
        with open(os.path.join(bdir, "board.jsonl"), encoding="utf-8") as f:
            for line in f:
                try:
                    it = json.loads(line)
                except ValueError:
                    continue
                w = str(it.get("where") or "")
                if w and os.path.realpath(os.path.expanduser(w)) == real and str(it.get("id", "")).isdigit():
                    ids.add(int(it["id"]))
    except OSError:
        pass
    return ids


def report_images(body):
    """正文里写到的本地图片（绝对路径或 ~/），按出现顺序去重；同 reportNamedImages 的认法。"""
    out = []
    for m in IMG_PATH_RE.finditer(body or ""):
        if m.start() > 0 and body[m.start() - 1] not in PATH_LEAD:
            continue  # URL 或长词的一部分
        p = os.path.expanduser(m.group(0))
        if p not in out:
            out.append(p)
    return out


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def accept_problems(targets, reads, cwd):
    """每件要放行的活：挂着的汇报里没看过的截图、内容相同的截图。返回问题行列表。"""
    held, problems, done = held_reports(), [], set()
    sk = os.environ.get("CC_SESSION_KEY") or ""
    chat = sk.split(":", 1)[1] if ":" in sk else sk
    for tool, nid, notes in targets:
        if nid:
            recs = [r for r in held if str(r.get("board")) == str(nid)]
        elif notes:
            ids = board_ids_for_notes(notes)
            recs = [r for r in held if str(r.get("board")).isdigit() and int(r["board"]) in ids]
        else:  # 不写是哪件：本频道挂着的每份都查（几份都挂着时不留后门；用户 11-14 打回）
            recs = [r for r in held if not chat or str(r.get("chat")) == chat]
        for r in recs:
            key = r.get("key") or id(r)
            if key in done:
                continue
            done.add(key)
            imgs = [p for p in report_images(r.get("body")) if os.path.isfile(p)]
            unseen = []
            for p in imgs:
                why = seen_problem(p, reads, cwd)
                if why:
                    unseen.append(p if "又改过" not in why else p + "（看过之后又改过）")
            dup, by = [], {}
            for p in imgs:
                try:
                    by.setdefault(md5_of(p), []).append(p)
                except OSError:
                    pass
            dup = [g for g in by.values() if len(g) > 1]
            tag = "#%s" % r.get("board")
            if unseen:
                problems.append("【没看过截图】%s 的汇报里列了 %d 张图，你这个会话还没打开过 %d 张：\n  %s\n"
                                "逐张用 Read 打开，对着交接的用户原话和验收看界面对不对，再 %s%s。"
                                % (tag, len(imgs), len(unseen), "\n  ".join(unseen), tool,
                                   "" if (nid or notes) else "（没写编号时本频道挂着的每份都查；只放行一件就带 --id）"))
            if dup:
                problems.append("【重复截图】%s 的汇报里这些截图内容完全相同（同一张图换了名字，证明不了它说的不同场景）：\n  %s\n"
                                "用 ws-forward --id %s \"打回：这几张截图是同一张，补拍各自的场景\" 打回补拍。"
                                % (tag, "\n  ".join(" = ".join(g) for g in dup), r.get("board")))
    return problems


def accept_gate(payload, cmd, cwd):
    targets = accept_targets(cmd)
    if not targets:
        return
    if (payload.get("hook_cli") or "") in ("gemini", "grok"):
        return
    known, reads = reads_this_turn(transcript_for(payload), whole=True)
    if not known:
        sys.stderr.write("deliver-check: 认不出会话记录，「验收前看过截图」这项跳过\n")
        return
    problems = accept_problems(targets, reads, cwd)
    if problems:
        deny("验收放行前的检查没过：\n" + "\n".join(problems) + "\n补齐后原样重跑这条命令。")


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    if payload.get("tool_name") != "Bash":
        return
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if "ws-pass" in cmd or "board" in cmd:
        accept_gate(payload, cmd, payload.get("cwd") or os.getcwd())
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
