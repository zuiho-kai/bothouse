#!/usr/bin/env python3
"""Stop：本轮回复说"修完/已修复"，但本轮没列受影响入口表 → 拦下一次，要求先列全再报。
出处：作者记录的同类错误「修 bug 先列全所有路径」（2026-10-14 第 2 次，用户要求做成 hook）。
入口表 = 本轮助手文字里一行表头，含「入口」和「修复/核对」两列（如 入口 | 是否经过修复 | 核对结果）；只有一处入口也列一行。
只拦一次（stop_hook_active 时放行），避免死循环。
只在修 bug 的轮次检查：用户这轮原话里没有修/报错/失败这类词就放行（2026-10-15 用户问"为什么慢、谁负责"，回复里讲经过的"修完再跑"被误拦两次，补的表还顶掉了答案）。"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util  # noqa: E402


def _check_first():
    """check-first-guard.py（先查再说，2026-11-06）：文件名带连字符，按路径载入；缺文件或载入出错就跳过。"""
    try:
        spec = importlib.util.spec_from_file_location("check_first_guard", os.path.join(os.path.dirname(os.path.abspath(__file__)), "check-first-guard.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m
    except Exception:
        return None

CLAIM = re.compile(r"修完|修好|修复了|已修复|修复完成|全部修复")
NEG = re.compile(r"[没未不等待才]")
# 引号、书名号、反引号里的词是在引用，不是宣称（2026-10-15 用户要求：引用「修好了」被误拦两次）
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`')
FIX_ASK = re.compile(r"修|bug|报错|错误|出错|坏了|挂了|失败|不对|不行|异常|崩|卡死|卡住|没反应|有问题|fix", re.I)
# bothouse 在用户原话前拼的系统块（队友状态、wiki 提示、频道补漏），不是用户写的
SYS_BLOCK = ("（队友状态", "（可能相关的 wiki 页", "（频道里你上次看到之后的消息")
HEADER = re.compile(r"^(?=.*\|)(?=.*入口)(?=.*(修复|核对)).*$", re.M)

# 2026-10-23 误拦 3 次（用户要求「改成不拦」）：只有"我已修完"才算宣称，下面三种不算。
# 1) 后面接将来/条件：「修好以后发新版时……」「修完再跑」「修完后」
LATER = re.compile(r"\s*(以后|之后|后|再|才)")
# 2) 同一分句里是将来/条件：「要等……修完」「还没……修好」「等到……修好」
#    （单字"不/没"只看前 2 字，见 NEG；整分句里查会把「空间不够那一处也已经修完」这种真宣称放走）
WHEN = re.compile(r"以后|之后|要等|等到|还没|尚未|待会")
# 3) 讲别人做的：「发现已经有人先修好了」「龙娘说她修完了」「子 agent 修好了」
#    橘自己报「也已经并行修完、推上去了」主语是自己，仍要拦。
OTHER = re.compile(r"有人|别人|他人|她|队友|工作区|龙娘|鲸鱼娘|彩虹猫|子\s*agent|subagent|sub\b", re.I)
CLAUSE_END = re.compile(r"[，,。.；;！!？?\n|：:]")
CAN = re.compile(r"(能|可以|可)[^已经，,。.；;！!？?\n|：:]{0,2}$")  # 「能修完」「可以马上修好」是能力，不是声称修完
RELAY = "[工作区回传]"  # 桥转来的工作区交回：转述别人修的，不是自己修的

def is_claim(text, m):
    if NEG.search(text[max(0, m.start() - 2):m.start()]):  # "还没有修完""等修完再测"
        return False
    if LATER.match(text, m.end()):
        return False
    if CAN.search(text[max(0, m.start() - 4):m.start()]):
        return False
    head = text[:m.start()]
    ends = list(CLAUSE_END.finditer(head))
    clause = head[ends[-1].end():] if ends else head
    return not (WHEN.search(clause) or OTHER.search(clause))

def claims(text):
    text = QUOTED.sub("", text)
    return any(is_claim(text, m) for m in CLAIM.finditer(text))

def user_words(t):
    """从拼好的用户消息里取出用户自己说的话。"""
    if "（最新，回这条）" in t:
        t = t.rsplit("（最新，回这条）", 1)[1]
    if "[replying to " in t:  # 引用的是我上一条回复，里面的"修"不算
        i = t.index("[replying to ")
        j = t.rfind("]\n", i)
        t = t[:i] + (t[j + 2:] if j >= 0 else "")
    return "\n\n".join(p for p in t.split("\n\n") if not p.lstrip().startswith(SYS_BLOCK))

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

def turn_text(path):
    """最后一条真实用户提问之后，所有助手 text 块拼起来。"""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return ""
    out = []
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        msg = e.get("message") or {}
        c = msg.get("content")
        if e.get("type") == "user" and not e.get("isMeta"):
            # tool_result 也是 type=user，不算新一轮
            if isinstance(c, str) or (isinstance(c, list) and any(b.get("type") == "text" for b in c if isinstance(b, dict))):
                break
        if e.get("type") == "assistant" and isinstance(c, list):
            out += [b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"]
    return "\n".join(reversed(out))

# 2026-10-25 用户批准（原话「都做」）：本机脚本、单文件小改动有测试就直接生效，不列入口表。
# 本轮只改了 1 个文件、改动不到 50 行、没有合并/推送/重启/发版 → 放行。统计不出来就照拦。
SMALL_MAX_LINES = 50
SHIP = re.compile(r"gh\s+pr\s+merge|git\s+push|safe-restart|gh\s+release|\b(npm|pnpm|yarn)\s+publish|bh-deploy|bothouse\s+daemon\s+restart")
SED_I = re.compile(r"\bsed\s+(?:-[a-zA-Z]*\s+)*-i(?:\s*''|\s*\"\"|\S*)?\s+.*?(\S+)\s*(?:$|[;&|])", re.M)
REDIR = re.compile(r"(?<![0-9&>])>>?\s*([^\s;&|<>()]+)")

def _ignored(path):
    path = path.strip("'\"")
    return (not path or path.startswith(("&", "/dev/", "/tmp/", "/private/tmp/", "$TMPDIR", "${TMPDIR"))
            or "/notes/" in path or path.startswith("notes/"))

def _nlines(t):
    return len(t.splitlines()) if t else 0

def small_change(path):
    """本轮是否小改动（0 或 1 个文件，2026-10-25 起 0 文件的纯调研轮也放行）。解析出错返回 False（照拦）。"""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
        blocks = []
        for line in reversed(lines):
            e = json.loads(line)
            c = (e.get("message") or {}).get("content")
            if e.get("type") == "user" and not e.get("isMeta"):
                if isinstance(c, str) or (isinstance(c, list) and any(b.get("type") == "text" for b in c if isinstance(b, dict))):
                    break
            if e.get("type") == "assistant" and isinstance(c, list):
                blocks += [b for b in c if isinstance(b, dict) and b.get("type") == "tool_use"]
        # 本轮一次工具都没调（或记录是别的 CLI 的原生格式，看不到工具调用）：没法说它改得小，照拦
        if not blocks:
            return False
        files, total = set(), 0
        for b in blocks:
            name, inp = b.get("name"), b.get("input") or {}
            if name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
                fp = inp.get("file_path") or inp.get("notebook_path")
                if not fp:
                    return False
                if _ignored(fp):
                    continue
                files.add(fp)
                if name == "Edit":
                    total += max(_nlines(inp["new_string"]), _nlines(inp["old_string"]))
                elif name == "Write":
                    total += _nlines(inp["content"])
                elif name == "MultiEdit":
                    total += sum(max(_nlines(x["new_string"]), _nlines(x["old_string"])) for x in inp["edits"])
                else:
                    total += _nlines(inp.get("new_source", ""))
            elif name == "apply_patch":  # Codex 的改文件工具：这里不数它的行数，照拦
                return False
            elif name == "Bash":
                cmd = inp["command"]
                if SHIP.search(cmd):
                    return False
                for m in list(SED_I.finditer(cmd)) + list(REDIR.finditer(cmd)):
                    if not _ignored(m.group(1)):
                        files.add(m.group(1).strip("'\""))
        return len(files) <= 1 and total < SMALL_MAX_LINES
    except Exception:
        return False

def main():
    d = json.load(sys.stdin)
    if d.get("stop_hook_active"):
        return
    reply = d.get("last_assistant_message") or turn_text(d.get("transcript_path", ""))
    cf = _check_first()
    why = cf.check(d) if cf else None
    if why:
        print(json.dumps({"decision": "block", "reason": why}, ensure_ascii=False))
        return
    prompt = last_prompt(d.get("transcript_path", ""))
    if prompt is not None and RELAY in prompt:
        return
    if prompt is not None and not FIX_ASK.search(user_words(prompt)):
        return
    last = d.get("last_assistant_message") or ""
    if not claims(last if last else turn_text(d.get("transcript_path", ""))):
        return
    if small_change(d.get("transcript_path", "")):
        return
    text = turn_text(d.get("transcript_path", "")) + "\n" + last
    if HEADER.search(text):
        return
    print(json.dumps({"decision": "block", "reason":
        "你说修完了，但本轮没列受影响入口表（规则：修 bug 先列全所有路径）。"
        "先枚举所有受影响入口（如所有发送/调用路径），列成「入口 | 是否经过修复 | 核对结果」表，逐条核完；"
        "缺口放第一句。只有一处入口也列一行，写明为什么没有别的入口。"}, ensure_ascii=False))

if __name__ == "__main__":
    main()
