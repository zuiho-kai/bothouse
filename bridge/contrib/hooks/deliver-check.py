#!/usr/bin/env python3
"""PreToolUse(Bash)：`bothouse send --image/--file/--video <文件>` 发成品前的检查，缺一样就拦。
四项检查（只看带附件或 -m/--message 正文的 send；--tts、--audio、--stdin、不带参数的纯文字不拦）：
 (a) 看过成品：本轮（最后一条用户消息之后）用 Read 打开过要发的这个文件本身（同一路径），且打开之后文件没再改过。
     Read 打不开的格式（docx/pptx/xlsx/视频/压缩包…）认本轮 Read 过的、文件名含成品主名、比成品新的渲染图/PDF。
     只在认得出会话记录格式时查：Claude Code / Qoder JSONL、DSH（run.py 转成 Claude Code 格式）、Codex rollout
     （顶层 view_image；代码模式下嵌套的 cat/sed 等读文件命令和看图）。Gemini、Grok、Cursor、Kimi 的 PreToolUse 拿不到工具调用记录，这项跳过（stderr 说明）。
 (b) 对过验收单：本角色有开着的验收单（accept.py）时，每个要发的文件（按内容指纹）都要
     `accept check <活名> <文件> "<逐条对照>"…` 对照过某张单子的全部当前条目，或 `accept skip <文件> "<原因>"`。
     单子后来加了条目，旧的对照作废。
 (c) 对照件（#1904，用户 11-23 认可「交之前，由一个只拿到你原话和原件的新人，把成品和原件并排比一遍，写出最大的三处差别，
     跟成品一起交给你」）：要发的文件是登记过的成品（任务板目录 deliver/<编号>.json 的 product，board stage 登记）时，
     有原件或用户认可过的样 → 要有和现在这份文件指纹一致的对照件（board compare <编号>，干净模型写的三处差别），
     而且三处差别原样带在这条 send 的话里；没有原件也没有认可样 → 话里要有一句问话。没登记的文件不管。
     判断在 gate/deliver.py 的 exit_check（ws-pass 放行也调它）；找不到 deliver.py（旧安装）这项跳过。
 (d) 文案摆过对标原句（#1907）：要发的文本稿（.md/.markdown/.txt、README）或 -m/--message 正文，只要标题、加粗行、
     标签行像对外文案（简介、README、首屏、宣传语、标语、标题、帖子、文案、卖点、bio/tagline/slogan/profile/pitch），
     没有标题/加粗/标签的整段文字里带简介、宣传稿、宣传语、标题、帖子这类词也算；
     或本身就有一节「## 对标原文」，就必须有那一节：至少三条别人的原句、原样照抄、每条带链接或本地出处，
     出处写本地文件时该文件里要真有这句原句（链接出处只按形式看，不上网核），
     我们的每句文案（我们：/中文：/英文：/→ 开头的行）后面标「照：第 N 条」。没摆就拦。
     聊天回复正文也查：run.py 在 Stop 时先于 choice-ask-guard 调本脚本，回复里有文案稿没摆原句就 block（桥撤回已流出的草稿、
     不拼回回复里）；同一轮第二次还没补原句就换成一句「文案检查没过，草稿没发出」，原文不出频道。没覆盖：--stdin、位置参数正文。
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


def strip_heredocs(command):
    """去掉 heredoc 正文（`<<'EOF' … EOF`）：那是数据，不是要执行的命令。
    交回/汇报里会原样引用一条 send 命令当例子，按正文解析会把它当成真在发送。"""
    out, marker = [], None
    for line in command.splitlines():
        if marker is not None:
            if line.strip() == marker:
                marker = None
            continue
        m = re.search(r"<<-?\s*(['\"]?)([A-Za-z_][\w.-]*)\1", line)
        if m:
            marker = m.group(2)
        out.append(line)
    return "\n".join(out)


def sent_texts(command):
    """`bothouse send -m/--message <正文>` 的正文。解析不了返回 []。"""
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
                if a in ("-m", "--message") and j + 1 < len(toks):
                    out.append(toks[j + 1])
                    j += 2
                    continue
                if a.startswith("--message="):
                    out.append(a.split("=", 1)[1])
                j += 1
            i = j
        i += 1
    return out


# ---- 对外文案稿：发之前先摆出对标原句（#1907）----
# 用户 11-23 15:29 列的修法、15:39 回「2修」定下；11-08、11-22、11-23 第三次。橘写简介时把对标原句抽成「规律」
# 再自己写，原句丢了，写回自编场景和数字；片子发前有检查，文案没有。
COPY_EXT = {".md", ".markdown", ".txt"}
# 认文案稿的词（#1907 ③）：标题、加粗行里含这些词，或「<前缀>词<后缀>：」开头的标签行。
# 中文词按子串认；英文词按整词认（about、bio 这类短词子串会误中）。
COPY_WORDS = ("简介", "readme", "首屏", "宣传语", "宣传文案", "标语", "口号", "标题", "副标题", "帖子", "推文", "发帖",
              "文案", "卖点", "导语", "一句话介绍", "介绍语", "仓库介绍", "项目介绍", "封面字")
COPY_EN = re.compile(r"(?i)\b(?:readme|bio|tagline|slogan|profile|pitch|headline|description|about|tweet)\b")
MD_HEADING = re.compile(r"(?m)^\s{0,3}#{1,6}\s+(.+?)\s*$")
BOLD_LINE = re.compile(r"(?m)^\s*\*\*([^*\n]+)\*\*\s*[:：]?\s*$")
_LABEL_WORDS = "|".join(sorted(COPY_WORDS + ("README", "slogan", "tagline", "bio", "description", "About", "headline", "tweet"),
                                key=len, reverse=True))
COPY_LABEL = re.compile(r"(?mi)^\s*(?:[-*>]\s*|\d+[.)]\s*)?\*{0,2}[^\n:：*`]{0,12}?(?:%s)[^\n:：*`]{0,10}\*{0,2}\s*[:：]"
                        % _LABEL_WORDS)
REF_HEAD = re.compile(r"(?m)^\s{0,3}(#{1,6})\s*对标原文\s*$")
REF_ENTRY = re.compile(r"(?m)^\s*(?:[-*>]\s+|\d+[.)]\s*|第\s*\d+\s*条)")
SOURCE = re.compile(r"https?://\S+|(?:~\s*/|/)[^\s）)」』,，。；;]*|\b[\w.-]+\.(?:md|markdown|txt)\b")
TAG = re.compile(r"照\s*[:：]\s*第?\s*(\d+)\s*条")
# 我们的文案行：我们：/中文：/英文：/简介：… 开头，或 → 开头（照原文改的那句）
OUR_LINE = re.compile(r"(?m)^\s*(?:[-*>]\s*|\d+[.)]\s*)?(?:我们|我们的文案|中文版?|英文版?|简介|标题|正文|帖子|README)\s*[:：]"
                      r"|^\s*→")


def _copy_word(h):
    return any(w in h.lower() for w in COPY_WORDS) or COPY_EN.search(h)


# 散文段（#1907 用户 11-23 16:31 ③）：没有标题、加粗、标签的整段文字里出现这些词也算文案稿。
PROSE_WORDS = ("简介", "宣传稿", "宣传语", "宣传文案", "标题", "帖子", "推文", "标语", "口号")
PROSE_EN = re.compile(r"(?i)\b(?:readme|tagline|slogan)\b")
CODE_SPAN = re.compile(r"(?s)```.*?```|`[^`\n]*`")
PATHISH = re.compile(r"(?:~|\.{0,2})?/[^\s）)」』,，。；;]*|\b[\w.-]+\.(?:md|markdown|txt|py|go|json)\b")


def copy_prose(text):
    """含文案词的散文段（代码块、反引号、路径和文件名里的词不算）：返回那段开头，否则 None。"""
    for para in re.split(r"\n\s*\n", CODE_SPAN.sub(" ", text)):
        bare = PATHISH.sub(" ", para)
        if any(w in bare for w in PROSE_WORDS) or PROSE_EN.search(bare):
            return para.strip().splitlines()[0][:40] if para.strip() else None
    return None


def copy_like(text):
    """像对外文案稿时返回命中的那处标题/标签/段落，否则 None。"""
    for m in MD_HEADING.finditer(text):
        if _copy_word(m.group(1)):
            return m.group(1).strip()
    for m in BOLD_LINE.finditer(text):
        if _copy_word(m.group(1)):
            return m.group(1).strip()
    m = COPY_LABEL.search(text)
    return m.group(0).strip() if m else None  # 散文段不再算文案稿（误拦太多，用户 11-23 要干掉）


def ref_section(text):
    """「## 对标原文」那一节（到同级或更高级标题为止）；没有返回 None。"""
    m = REF_HEAD.search(text)
    if not m:
        return None
    level = len(m.group(1))
    body = text[m.end():]
    stop = len(body)
    for h in re.finditer(r"(?m)^\s{0,3}(#{1,6})\s", body):
        if len(h.group(1)) <= level:
            stop = h.start()
            break
    return body[:stop]


def ref_entry_parts(line):
    """一条「原句 … 出处 …」→ (原句, 出处)；出处是 SOURCE 认出的那截，原句是它前面的文字。"""
    m = REF_ENTRY.match(line)
    src = SOURCE.search(line)
    nxt = src.start() if src else len(line)
    quote = re.split(r"(?i)\s*(?:出处|来源|链接|source)\s*[:：]", line[m.end() if m else 0:nxt], maxsplit=1)[0]
    quote = re.sub(r"(?i)^\s*(?:原句|原文|quote)\s*[:：]\s*", "", quote.strip())
    quote = quote.strip(" \t\"'“”‘’「」『』`*:：-—")
    return quote, (src.group(0).strip() if src else "")


def ref_source_problem(n, quote, src, base=""):
    """本地文件出处要核对：原句必须能在那个文件里原样找到（#1907 打回②）；链接出处不上网核。"""
    if not quote:
        return "第 %d 条没写原句（写成「- 原句：<照抄别人的原话> 出处：<链接或本地文件路径>」）。" % n
    if src.startswith(("http://", "https://")):
        return None
    p = os.path.expanduser(src)
    if not os.path.isabs(p):
        p = os.path.join(base or os.getcwd(), p)
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return "第 %d 条出处的本地文件打不开：%s（路径写对了吗）" % (n, src)
    if re.sub(r"\s+", "", quote) not in re.sub(r"\s+", "", content):
        return ("第 %d 条原句在出处文件里找不到原样的一句：%s —— 原句要照抄别人真实写过的话，"
                "不能自己编一句再配个出处" % (n, src))
    return None


def copy_gate_why(text, what, base=""):
    """要补什么；None = 可以发。"""
    hit = copy_like(text)
    sec = ref_section(text)
    if sec is None:
        if hit is None:
            return None
        return ("【文案没摆对标原句】%s 是对外文案稿（%s）。发之前先在稿子里加一节：\n"
                "## 对标原文\n"
                "1. 原句：<别人的原句，原样照抄> 出处：<链接或本地文件路径>\n"
                "2. …\n3. …\n"
                "至少三条；我们的每句文案后面标「照：第 N 条」，指向上面对应的那条。"
                "出处写本地文件时，原句要能在那个文件里原样找到。" % (what, hit))
    problems = []
    entries = [l for l in sec.splitlines() if REF_ENTRY.match(l) and SOURCE.search(l)]
    if len(entries) < 3:
        problems.append("「对标原文」里带出处的原句只有 %d 条，至少要 3 条；每条写成一行："
                        "「- 原句：<照抄别人的原话> 出处：<链接或本地文件路径>」。" % len(entries))
    for i, line in enumerate(entries, 1):
        bad = ref_source_problem(i, *ref_entry_parts(line), base=base)
        if bad:
            problems.append(bad)
    tags = [int(m.group(1)) for m in TAG.finditer(text)]
    if not tags:
        problems.append("我们的文案一句都没标「照：第 N 条」：每句后面标上它是照第几条原句写的。")
    bad = sorted({t for t in tags if t < 1 or t > len(entries)})
    if bad:
        problems.append("有「照：第 %s 条」指不到上面的原句（现在只有 %d 条）。"
                        % ("、".join(map(str, bad)), len(entries)))
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not OUR_LINE.search(line) or TAG.search(line):
            continue
        if i + 1 < len(lines) and TAG.search(lines[i + 1]):
            continue
        problems.append("这句我们的文案没标照哪条原句：%s" % line.strip()[:60])
    if problems:
        return "【文案没摆对标原句】%s：\n  %s" % (what, "\n  ".join(problems))
    return None


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


def last_reply(payload):
    """Stop：这轮要发出去的回复正文（CLI 给了 last_assistant_message 就用它，否则读会话记录最后一条助手文字）。"""
    t = payload.get("last_assistant_message")
    if isinstance(t, str) and t.strip():
        return t
    text = ""
    try:
        with open(transcript_for(payload) or "", encoding="utf-8") as f:
            for line in f:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("type") == "assistant":
                    t = text_of((d.get("message") or {}).get("content"))
                    if t.strip():
                        text = t
    except (OSError, TypeError):
        return ""
    return text


COPY_REPLACE = "文案检查没过，草稿没发出。"
def _copy_state(sid, value=None):
    """这个会话的上一次拦是不是文案检查拦的（value=None 只读；True/False 写）。"""
    COPY_STATE = os.path.join(data_dir(), "hooks-state", "copy-gate.json")
    try:
        with open(COPY_STATE, encoding="utf-8") as f:
            st = json.load(f)
    except (OSError, ValueError):
        st = {}
    if value is None:
        return bool(st.get(sid))
    if value:
        st[sid] = True
    else:
        st.pop(sid, None)
    try:
        os.makedirs(os.path.dirname(COPY_STATE), exist_ok=True)
        with open(COPY_STATE, "w", encoding="utf-8") as f:
            json.dump(st, f)
    except OSError:
        pass
    return bool(value)


def reply_gate(payload):
    """(d) 管到聊天回复（#1907）：回复里有文案稿却没摆对标原句就拦回让它补（桥把草稿从频道撤回、不再拼回去）；
    拦过一次还没补上，不再拦（免得来回卡死），这条回复由桥换成一句「文案检查没过，草稿没发出」，原文不出去。"""
    sid = str(payload.get("session_id") or "")
    text = last_reply(payload)
    why = copy_gate_why(text, "这条回复", payload.get("cwd") or os.getcwd())
    again = bool(payload.get("stop_hook_active")) and _copy_state(sid)
    if not why:
        _copy_state(sid, False)
        return
    if again:
        _copy_state(sid, False)
        print(json.dumps({"bothouse_replace": COPY_REPLACE, "draft": text}, ensure_ascii=False))
        return
    _copy_state(sid, True)
    print(json.dumps({"decision": "block", "reason": "发出前的文案检查没过（草稿已从频道撤回）：\n" + why +
                      "\n把对标原文那节和逐句「照：第 N 条」补进回复，重发一遍完整回复。补不出原句就只回一句「%s」：" 
                      "再发一次没补的原文，桥会把它换成这句话，原文不会发出去。" % COPY_REPLACE}, ensure_ascii=False))

# ---- 对照件（#1904）----
def send_message(command):
    """`bothouse send` 跟着附件发的话：-m/--message 的内容；没写 -m（话是位置参数或 --stdin 喂的）就拿整条命令当话看。"""
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        toks = list(lex)
    except ValueError:
        return command
    out = [toks[i + 1] for i, t in enumerate(toks[:-1]) if t in ("-m", "--message")]
    out += [t.split("=", 1)[1] for t in toks if t.startswith(("--message=", "-m="))]
    return "\n".join(out) if out else command


def deliver_mod():
    """gate/deliver.py（交付记录和对照件判断）：GATE_DIR、仓库里的 ../gate、数据目录下装的 collaboration/gate、runtime/gate，
    哪个有就用哪个；都没有返回 None。"""
    dirs = [os.environ.get("GATE_DIR") or "", os.path.join(os.path.dirname(HERE), "gate"),
            os.path.join(data_dir(), "collaboration", "gate"), os.path.join(data_dir(), "collaboration", "runtime", "gate")]
    for d in dirs:
        if d and os.path.isfile(os.path.join(d, "deliver.py")):
            sys.path.insert(0, d)
            import deliver
            return deliver
    return None


def compare_problems(files, msg):
    """要发的文件里登记过的成品：缺对照件、三处差别没带在话里、没原件没认可样又没问话，各出一条。"""
    mod = deliver_mod()
    if mod is None:
        return []
    problems, passed = mod.exit_check(files, msg)
    for one in passed:
        if not mod.carried(msg, one["compare"]):
            problems.append("【差别没带上】#%s 的成品 %s 已有对照件，把下面这段原样写进这条 send 的 -m，跟成品一起交给用户：\n%s"
                            % (one["id"], one["file"], one["text"]))
    return problems


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    if payload.get("hook_event_name") == "Stop":
        # 聊天回复不再过文案检查（用户 11-23「这个什么傻逼东西能把他干掉」）：只要提到「帖子」「标题」就被当成文案稿拦下换掉。
        return
    if payload.get("tool_name") != "Bash":
        return
    cmd = strip_heredocs((payload.get("tool_input") or {}).get("command") or "")
    if "ws-pass" in cmd or "board" in cmd:
        accept_gate(payload, cmd, payload.get("cwd") or os.getcwd())
    if "bothouse" not in cmd or "send" not in cmd:
        return
    if not any(fl in cmd for fl in FLAGS) and not re.search(r"(?:^|\s)(?:-m|--message)(?:\s|=|$)", cmd):
        return
    cwd = payload.get("cwd") or os.getcwd()
    allf = sent_files(cmd, cwd)
    files = [f for f in allf if os.path.isfile(f)]
    problems = []
    # 对外文案稿：稿里没摆对标原句就拦（#1907）
    for f in files:
        if os.path.splitext(f)[1].lower() not in COPY_EXT and \
                not os.path.basename(f).lower().startswith("readme"):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                text = fh.read()
        except (OSError, UnicodeDecodeError):
            continue
        why = copy_gate_why(text, f, cwd)
        if why:
            problems.append(why)
    for text in sent_texts(cmd):
        why = copy_gate_why(text, "要发的这段文字", cwd)
        if why:
            problems.append(why)
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
    try:
        problems += compare_problems(files, send_message(cmd))
    except BaseException as e:  # 对照件这项自己坏了（记录读不了、gate 脚本载不了）不挡别的检查，也不挡发送
        sys.stderr.write("deliver-check: 对照件这项跳过（%s: %s）\n" % (type(e).__name__, e))
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
