#!/usr/bin/env python3
"""PreToolUse(Bash)：拦下反复犯过的命令。规则来自作者自己的 wiki 记录，每条附原因。
1. 没走代理的下载：大文件走本机代理 + 分段并发（pget）。只在设了环境变量 HOOK_PROXY（如 http://127.0.0.1:7890）时检查，
   没设就不管下载（没有代理的机器上这条没有意义）。
   放行：pget、已带代理（-x/--proxy/*_proxy=/proxy_on）、目标全是本机/局域网/Tailscale、`# direct-ok`。
2. pkill -f：会匹配到执行本命令的 wrapper shell，把自己杀掉。
3. macOS 上 go build -o 覆盖 bothouse 二进制：签名变回 ad-hoc，TCC（屏幕录制、辅助功能等）授权失效。
4. 后台命令（run_in_background）看不到进度或没有超时：输出接 | tail/| head 会到结束才吐字；没套超时卡死也无人知。
   常驻服务加 `# long-running-ok` 放行。
5. 只提示不拦：一条命令整页 cat wiki 下 2 页以上 .md（含 for 循环 cat、*.md 通配）。wiki 目录同 bothouse 的 gate：
   环境变量 GATE_WIKI，默认 ~/wiki；设成 off 或目录不存在就不提示。作者的慢例是一次 cat 十几页。
   提示走 PreToolUse 的 additionalContext，命令照常执行。
6. 前台干等：gh run watch、gh … --watch、前台 sleep ≥60 秒、until/while … sleep … done 轮询循环（等完成通知，
   不要占着前台；超过 5 分钟缓存全部重写）。run_in_background=true 的不拦，单个 sleep <60 秒不拦。
   perl/python 里的 while … sleep 循环同样拦。
   DSH：载荷带 dsh_busy（本会话还有子 agent/后台任务在跑）时 job_output wait=true 也拦；DSH 的前台 sleep 一律拦。
8. 仅 DSH 提速（本轮的工具调用来自 dsh-cc-compat.py 加的 dsh_turn）：同一轮第二次轮询同一对象拦；
   一串只读查询里第 4 个「一步只跑一条只读查询」的步拦（合并过的步放行），本轮重复的只读命令拦；
   前台联网长命令（git clone/fetch/pull、npm/pip/brew install）拦，改后台。子 agent 会话和外出轮豁免。
10. 不拦只改：Claude Code 子 agent（非 long-task）前台 Bash 的 timeout 超过 290 秒时压到 290 秒，跑不完自动转后台。"""
import json, os, re, shlex, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan_gate  # noqa: E402  要方案未批时拦开做（用户 2026-10-28）

PROXY_URL = os.environ.get("HOOK_PROXY", "").strip()  # 例：http://127.0.0.1:7890；空 = 不查下载
_wiki = os.environ.get("GATE_WIKI", "~/wiki").strip()  # 同 bridge/contrib/gate/ctxsvc.py
WIKI = None if _wiki.lower() in ("", "off") else os.path.realpath(os.path.expanduser(_wiki))

PROXY = re.compile(r"(^|\s)(-x|--proxy|--socks5\S*)(\s|=)|\b(https?|all)_proxy=|\b(HTTPS?|ALL)_PROXY=|\bproxy_on\b")
LOCAL = re.compile(r"^(https?://)?(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|[^/]*\.local\b|[^/]*\.ts\.net\b|\[?::1)")

# 直接停/杀桥（launchd 服务 com.bothouse.* 或 bothouse / cc-connect 进程）：只拦改状态的动词，list/print 放行
RESTART = re.compile(r"\blaunchctl\s+(?:kickstart|stop|bootout|unload|kill|remove)\b[^\n;|&]*(?:com\.bothouse|cc-connect)"
                     r"|\b(?:kill|pkill|killall)\b[^\n;|&]*\b(?:bothouse|cc-connect)\b")


def segments(cmd):
    return [s for s in re.split(r"\|\||&&|[;\n|]", cmd) if s.strip()]

def toks(seg):
    try:
        return shlex.split(seg, comments=True)
    except ValueError:
        return seg.split()

def is_download(seg):
    t = toks(seg)
    # 跳过前置的 VAR=val / sudo / env / time
    while t and (re.match(r"^\w+=", t[0]) or t[0] in ("sudo", "env", "time", "command", "exec")):
        t = t[1:]
    if not t:
        return False
    prog = t[0].rsplit("/", 1)[-1]
    args = t[1:]
    if prog in ("wget", "aria2c", "axel"):
        return True
    if prog in ("hf", "huggingface-cli") and "download" in args:
        return True
    if prog == "curl":
        if any(a in ("-I", "--head") for a in args):
            return False
        for a in args:
            if a in ("--output", "--remote-name", "--remote-name-all") or a.startswith("--output="):
                return True
            if re.match(r"^-[A-Za-z]*[oO]", a) and not a.startswith("--"):
                return True
        return ">" in seg  # curl ... > file
    return False

def urls(seg):
    return re.findall(r"https?://[^\s'\"]+", seg)

def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason}}, ensure_ascii=False))
    sys.exit(0)

TIMEOUT = re.compile(r"(^|[\s;&|(])(g?timeout\s|perl\s+-e\s+['\"]alarm)")
TAILPIPE = re.compile(r"\|\s*(tail|head)\b")

# ws-forward 里表示「改方向」的说法：纠正、叫停、改做法、用户嫌不对
FWD_CHANGE = re.compile(r"纠正|改方向|方向不符|不符合|跑偏|跑完(就|再)|停掉|停下|叫停|别再|不再|改法|改成|改用|换成|一坨屎")

def check_background(cmd):
    if "# long-running-ok" in cmd:
        return
    if TAILPIPE.search(cmd):
        deny("后台命令不要接 | tail / | head：结束前看不到任何输出，卡死也发现不了。"
             "改成 `python -u ... > 日志 2>&1`，用 Monitor 或定期看日志是否增长。")
    if not TIMEOUT.search(cmd):
        deny("后台命令没套超时（后台任务要能感知卡死）。"
             "套 `timeout <秒数> <命令…>`；macOS 默认没有 coreutils timeout，用 `perl -e 'alarm shift; exec @ARGV' <秒数> <命令…>`，秒数取预期耗时×3（它只杀直接子进程，别包 sh -c）；"
             "常驻服务（dev server、守护进程）在命令末尾加 `# long-running-ok`。")

WIKI_REF = re.compile(r"(~|\$HOME|\$\{HOME\}|/Users/[^/\s]+|/home/[^/\s]+)/wiki\b")
WIKI_CAT_MIN = 2  # 用户原话（派活）：「整页 cat ~/wiki 下 2 页以上 .md」


def wiki_cat_pages(cmd, cwd):
    """整页 cat 的 wiki .md 个数；通配（*.md）或 for 循环里 cat 记作 WIKI_CAT_MIN。不在 wiki 下返回 0。"""
    if not WIKI or not os.path.isdir(WIKI):
        return 0
    in_wiki = bool(WIKI_REF.search(cmd)) or WIKI in cmd or os.path.realpath(cwd or "").startswith(WIKI)
    if not in_wiki:
        return 0
    n = 0
    for seg in segments(cmd):
        t = toks(seg)
        if t and t[0] == "do":
            t = t[1:]
        if not t or t[0].rsplit("/", 1)[-1] != "cat":
            continue
        mds = [a for a in t[1:] if not a.startswith("-") and a.endswith(".md")]
        loop = re.search(r"\b(for|while)\b", cmd) and any("$" in a for a in t[1:])
        if loop or any("*" in a or "?" in a for a in mds) or any(a.startswith("$") and not a.endswith(".md") for a in t[1:]):
            return WIKI_CAT_MIN  # 通配 / 循环变量：一次就是多页
        n += len(mds)
    return n


def hint(text):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": text}},
                     ensure_ascii=False))
    sys.exit(0)


SLEEP_MIN = 60  # 派活原话：前台 sleep N（N≥60）拦，单个短 sleep（<60）不拦
WAIT_MSG = ("别前台干等：把命令放后台/推完就交付，附 run id 或日志路径，回头再查"
            "（用户 2026-10-22「超过5分钟就是0缓存重写了」）。")
HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?^\s*\2\s*$", re.S | re.M)
POLL_LOOP = re.compile(r"\b(until|while)\b.*?\bdo\b.*?\bsleep\b.*?\bdone\b", re.S)
# the same loop written inside perl/python: perl -e 'while(1){…sleep 5}', python -c 'while …: time.sleep(10)'
POLL_INLINE = re.compile(r"\bwhile\s*[(\s].*?[{:].*?\bsleep\b", re.S)

# 规则 10：子 agent 的提示缓存只有 5 分钟，前台等更久整段上下文要重写。前台 Bash 的 timeout 超过 SUB_CAP_MS 时
# 不拦，压到 SUB_CAP_MS（updatedInput）：跑不完 Claude Code 自动转后台，子 agent 立刻拿回控制权。
# 回放（作者机器 2127 条子 agent 前台命令）：约百条设了 >5 分钟 timeout，多数几秒就完，硬拦每条多一步，所以只压不拦。
# 主会话、long-task 子 agent（1 小时缓存，见 agents/long-task.*.md）、DSH、后台命令不管。
SUB_CAP_MS = 290000  # 5 分钟缓存留 10 秒给模型开口
SUB_CAP_AGENT = "long-task"
SUB_CAP_MSG = ("这条命令的 timeout 被压到 290 秒（子 agent 提示缓存只有 5 分钟，前台等更久整段上下文要重写）。"
               "跑不完会自动转后台：转后台后别 sleep/轮询等它，交付收工，交付里写输出文件路径和下一步，"
               "结果出来再由派活方接手；预计要等 5–60 分钟的活应派 long-task 子 agent。")


def sub_cap(inp, d):
    """子 agent（非 long-task）的前台 Bash timeout 超过 SUB_CAP_MS 时，返回压过的新 tool_input；否则 None。"""
    if not d.get("agent_id") or d.get("agent_type") == SUB_CAP_AGENT or d.get("dsh") or inp.get("run_in_background"):
        return None
    try:
        if float(inp.get("timeout") or 0) <= SUB_CAP_MS:
            return None
    except (TypeError, ValueError):
        return None
    return dict(inp, timeout=SUB_CAP_MS)


def sleep_secs(arg):
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([smhd]?)", arg)
    return float(m.group(1)) * {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)] if m else 0


BUSY_MSG = ("本会话还有东西在跑：{items}。DSH 会在它们跑完时通知你，别 sleep/轮询干等："
            "先结束这一轮（回复里说派了什么、等什么），完成通知到了再接着汇报"
            "（用户 2026-10-22「sub遇到等待就回来」「超过5分钟就是0缓存重写了」）。")


DSH_SLEEP_MSG = ("别前台 sleep 干等：要等的东西放后台（run_in_background=true），结束这一轮（回复里说在等什么），"
                 "完成通知到了再接着（用户 2026-10-22「为什么他这么慢…你看到底怎么搞」）。")


def check_wait(cmd, busy=None, dsh=False):
    """前台干等：gh run watch / gh … --watch / sleep ≥60 / until|while … sleep … done。
    DSH（dsh=True）任何前台 sleep 都拦；busy（本会话在跑的子 agent/后台任务）非空时提示里列出在跑的东西。"""
    cmd = HEREDOC.sub("", cmd)  # heredoc 正文是写进文件的内容，不是要执行的命令
    if POLL_LOOP.search(cmd):
        deny(WAIT_MSG + "\n被拦：until/while … sleep … done 轮询循环。")
    if POLL_INLINE.search(cmd):
        deny(WAIT_MSG + "\n被拦：perl/python 里的 while … sleep 轮询循环。")
    for seg in segments(cmd):
        t = toks(seg)
        while t and (re.match(r"^\w+=", t[0]) or t[0] in ("sudo", "env", "time", "command", "exec", "do", "then")):
            t = t[1:]
        if not t:
            continue
        prog = t[0].rsplit("/", 1)[-1]
        if prog == "gh" and (t[1:3] == ["run", "watch"] or any(a == "--watch" or a.startswith("--watch=") for a in t)):
            deny(WAIT_MSG + f"\n被拦的片段：{seg.strip()[:200]}")
        if prog == "sleep" and busy:
            deny(BUSY_MSG.format(items="、".join(busy)) + f"\n被拦的片段：{seg.strip()[:200]}")
        if prog == "sleep" and dsh:
            deny(DSH_SLEEP_MSG + f"\n被拦的片段：{seg.strip()[:200]}")
        if prog == "sleep" and sum(sleep_secs(a) for a in t[1:]) >= SLEEP_MIN:
            deny(WAIT_MSG + f"\n被拦的片段：{seg.strip()[:200]}")


# ---- 规则 8：仅 DSH 提速（出处见文件头第 8 条）----
SERIAL_MAX = 3  # 作者记录，用户 2026-10-22『这个你自己搞就行了』：连续 3 步单步只读查询之后，第 4 步起拦

# 只读程序：只往终端输出，不改文件、不改远端（sed/find/curl/git/gh 等另外按参数判断）
RO_PROGS = {
    "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "ag", "wc", "file", "stat", "du", "df", "tree",
    "jq", "yq", "sort", "uniq", "cut", "tr", "column", "nl", "less", "more", "diff", "cmp", "comm", "paste",
    "basename", "dirname", "realpath", "readlink", "which", "whereis", "type", "ps", "pgrep", "lsof", "uname",
    "whoami", "id", "hostname", "printenv", "test", "[", "md5", "shasum", "sha256sum", "xxd", "od", "strings",
    "zcat", "zstdcat", "tac", "rev", "fold", "seq", "netstat", "ifconfig", "scutil", "sw_vers", "sysctl", "uptime",
}
# 不算一段查询的（分段用的 echo ===、cd 之类）
NEUTRAL_PROGS = {"cd", "echo", "printf", "true", "false", ":", "export", "unset", "set", "pwd", "date",
                 "done", "fi", "esac", "}", "{"}
RO_TOOLS = {"read", "grep", "glob"}  # DSH 自己的只读工具：一步只调它一个也算单步查询
LOOP_PROGS = {"for", "while", "until", "select", "case"}
PREFIX = {"env", "time", "command", "nice", "exec", "sudo", "do", "then", "else", "elif", "if", "!"}
RO_GIT = {"log", "show", "status", "diff", "rev-parse", "ls-files", "ls-tree", "blame", "grep", "describe",
          "reflog", "shortlog", "cat-file", "merge-base", "rev-list", "whatchanged", "show-ref", "for-each-ref"}
RO_GH_VERBS = {"view", "list", "status", "checks", "diff"}
NET = {"git": {"clone", "fetch", "pull"}, "npm": {"install", "i", "ci", "add"}, "pnpm": {"install", "i", "add"},
       "yarn": {"install", "add"}, "pip": {"install"}, "pip3": {"install"}, "brew": {"install", "upgrade"}}
# gh run 里带值的参数：值不算位置参数（run id）
GH_RUN_VALUE = {"-R", "--repo", "-b", "--branch", "-w", "--workflow", "-L", "--limit", "--json", "-q", "--jq",
                "-t", "--template", "-j", "--job", "-u", "--user", "-e", "--event", "-s", "--status", "-c",
                "--commit", "--created", "-a", "--attempt", "-i", "--interval"}
GH_RUN_KEEP = {"-R", "--repo", "-b", "--branch", "-w", "--workflow", "-j", "--job", "-a", "--attempt"}

SERIAL_MSG = ("这一轮已经有 {n} 步各只跑了一条只读查询，每多一步就要多等一次模型开口（中位约 7.5 秒）。"
              "把接下来要查的合成一步：一条命令里用 echo === 分段（例：`cat a.md; echo ===; git log -3; echo ===; gh pr view 5`），"
              "或者在一条回复里并行调多个工具。"
              "（规则：一串只读查询里第 4 个单条查询的步起拦，跑过改东西的命令才重新计数；用户 2026-10-22「为什么他这么慢…你看到底怎么搞」）")
DUP_MSG = ("这条命令本轮已经跑过，之后没有改过任何东西，结果不会变：直接用上次的输出。"
           "（用户 2026-10-22「为什么他这么慢…你看到底怎么搞」）")
POLL_MSG = ("本轮第二次查同一个对象（{key}），这是在轮询。别前台反复查：要等就后台起任务（run_in_background=true），"
            "结束这一轮（回复里说在等什么），完成通知到了再接着（用户 2026-10-22「为什么他这么慢…你看到底怎么搞」）。")
NET_MSG = ("联网长命令不要前台跑（git clone/fetch/pull、npm/pip/brew install 之类，前台卡过 180–240 秒）："
           "改成后台（run_in_background=true，按后台规则套 perl alarm 超时、输出写日志），结束这一轮，等完成通知"
           "（用户 2026-10-22「为什么他这么慢…你看到底怎么搞」）。")


def pipelines(cmd, allow_write_redirect=False):
    """命令拆成 [[argv, …], …]：外层按 ; && || & 换行 括号分，内层按 | 分。
    有写文件的重定向（> 文件，/dev/null 和 2>&1 除外）或引号不配对返回 None。"""
    try:
        lex = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        words = list(lex)
    except ValueError:
        return None
    out, pl, argv = [], [], []
    i = 0
    while i < len(words):
        w = words[i]
        if w and all(c in "();<>|&" for c in w):
            if ">" in w:
                tgt = words[i + 1] if i + 1 < len(words) else ""
                if not allow_write_redirect and tgt != "/dev/null" and not (w.endswith("&") and tgt.isdigit()):
                    return None
                if argv and argv[-1].isdigit():
                    argv.pop()  # 2>/dev/null 的 2
                i += 2
                continue
            if "<" in w:
                i += 2
                continue
            if argv:
                pl.append(argv)
                argv = []
            if w != "|" and pl:
                out.append(pl)
                pl = []
            i += 1
            continue
        argv.append(w)
        i += 1
    if argv:
        pl.append(argv)
    if pl:
        out.append(pl)
    return out


def strip_prefix(t):
    while t and (re.match(r"^\w+=", t[0]) or t[0] in PREFIX):
        t = t[1:]
    return t


def git_args(a):
    while a and a[0] in ("-C", "-c", "--no-pager", "-P", "--git-dir", "--work-tree"):
        a = a[2:] if a[0] in ("-C", "-c", "--git-dir", "--work-tree") else a[1:]
    return a


def argv_kind(t):
    """'ro' 只读查询、'neutral' 不算查询、'loop' 循环头；不是只读返回 None。"""
    t = strip_prefix(t)
    if not t:
        return "neutral"
    prog, a = t[0].rsplit("/", 1)[-1], t[1:]
    if prog in NEUTRAL_PROGS:
        return "neutral"
    if prog in LOOP_PROGS:
        return "loop"
    if prog in RO_PROGS:
        return "ro"
    if prog == "sed":
        return None if any(x.startswith("-i") or x.startswith("--in-place") for x in a) else "ro"
    if prog == "find":
        return None if any(x in ("-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fls") for x in a) else "ro"
    if prog == "awk":
        return None if any("system(" in x for x in a) else "ro"
    if prog == "curl":
        bad = any(x.startswith(("-d", "--data", "-F", "--form", "-T", "--upload", "-o", "--output", "-O", "--remote"))
                  for x in a)
        xi = [j for j, x in enumerate(a) if x in ("-X", "--request")]
        method = a[xi[-1] + 1].upper() if xi and xi[-1] + 1 < len(a) else "GET"
        return None if bad or method not in ("GET", "HEAD") else "ro"
    if prog == "git":
        g = git_args(a)
        sub, rest = (g[0], g[1:]) if g else ("", [])
        if sub in RO_GIT:
            return "ro"
        if sub == "branch" or sub == "tag":
            return "ro" if all(x.startswith("-") and x not in ("-d", "-D", "-m", "-M", "-f", "--delete") for x in rest) else None
        if sub == "remote":
            return "ro" if not rest or rest[0] in ("-v", "show", "get-url") else None
        if sub in ("stash", "worktree"):
            return "ro" if rest[:1] == ["list"] else None
        if sub == "config":
            return "ro" if any(x in ("--get", "--get-all", "--get-regexp", "--list", "-l") for x in rest) else None
        return None
    if prog == "gh":
        if a[:1] == ["api"]:
            if any(x in ("-f", "-F", "--field", "--raw-field", "--input") or x.startswith(("--field=", "--raw-field="))
                   for x in a):
                return None
            xi = [j for j, x in enumerate(a) if x in ("-X", "--method")]
            return "ro" if not xi or (xi[-1] + 1 < len(a) and a[xi[-1] + 1].upper() == "GET") else None
        if a[:1] in (["search"], ["status"]) or a[:2] == ["auth", "status"]:
            return "ro"
        return "ro" if len(a) >= 2 and a[1] in RO_GH_VERBS else None
    if prog == "launchctl":
        return "ro" if a[:1] in (["list"], ["print"]) else None
    return None


def ro_queries(cmd):
    """只读命令里有几段查询（一条管道算一段，cd/echo === 之类不算，循环里查算 2 段）；不是只读返回 None。"""
    pls = pipelines(cmd)
    if not pls:
        return None
    n, loop = 0, False
    for pl in pls:
        kinds = [argv_kind(t) for t in pl]
        if None in kinds:
            return None
        loop = loop or "loop" in kinds
        n += "ro" in kinds
    if n == 0:
        return None  # neutral-only commands (e.g. echo separators) are not queries
    return max(n, 2) if loop and n else max(n, 1)


def norm(cmd):
    return " ".join(cmd.split())


def poll_keys(cmd):
    """gh run view/list/watch 查的对象：子命令 + run id + 仓库/分支/工作流/job/--log 这类决定看什么的参数。"""
    keys = set()
    for pl in pipelines(cmd) or []:
        for t in pl:
            t = strip_prefix(t)
            if len(t) < 3 or t[0].rsplit("/", 1)[-1] != "gh" or t[1] != "run" or t[2] not in ("view", "list", "watch"):
                continue
            parts, rest, i = [t[2]], t[3:], 0
            while i < len(rest):
                x = rest[i]
                f = x.split("=", 1)[0]
                if f in GH_RUN_VALUE:
                    val = x.split("=", 1)[1] if "=" in x else (rest[i + 1] if i + 1 < len(rest) else "")
                    if f in GH_RUN_KEEP:
                        parts.append(f"{f.lstrip('-')[:1]}={val}")
                    i += 1 if "=" in x else 2
                    continue
                if x in ("--log", "--log-failed") or not x.startswith("-"):
                    parts.append(x)
                i += 1
            keys.add("gh run " + " ".join(parts))
    return keys


def split_turn(turn, cid):
    """本轮在当前调用之前的步，和当前调用所在那一步（找不到当前调用 = 新的一步、只有它一个）。"""
    for k, step in enumerate(turn.get("steps") or []):
        if any(c.get("id") == cid for c in step):
            return turn["steps"][:k], step
    return list(turn.get("steps") or []), None


def executed(steps):
    return [c for step in steps for c in step if not c.get("denied")]


def check_job_poll(job_id, turn, cid):
    prior, cur = split_turn(turn, cid)
    # Without the current call in the transcript, its position relative to
    # earlier calls is unknown. Session-derived rules must fail open.
    if cur is None:
        return
    if job_id and any(c.get("name") == "job_output" and c.get("wait") and c.get("job_id") == job_id
                      for c in executed(prior)):
        deny(POLL_MSG.format(key=f"job_output {job_id}"))


def check_network(cmd):
    # Redirecting command output does not make a foreground network operation
    # asynchronous; ignore the destination while identifying executables.
    for pl in pipelines(cmd, allow_write_redirect=True) or []:
        for t in pl:
            t = strip_prefix(t)
            if not t:
                continue
            prog = t[0].rsplit("/", 1)[-1]
            a = git_args(t[1:]) if prog == "git" else t[1:]
            if prog in NET and a and a[0] in NET[prog]:
                deny(NET_MSG + f"\n被拦的片段：{' '.join(t)[:200]}")


def check_speed(cmd, turn, cid):
    """规则 8a 的 gh run 轮询、8b 的串行只读和重复命令。"""
    prior, cur = split_turn(turn, cid)
    # If the compatibility reader could not locate this invocation, do not
    # guess which calls are prior to it (or count the current call as history).
    if cur is None:
        return
    done = executed(prior)
    keys = poll_keys(cmd)
    for c in done:
        hit = keys & poll_keys(c.get("command") or "") if c.get("name") == "bash" else set()
        if hit:
            deny(POLL_MSG.format(key=sorted(hit)[0]))
    if turn.get("sub") or turn.get("outing"):
        return
    q = ro_queries(cmd)
    if q is None:
        return
    for c in reversed(done):  # 重复：上次跑同一条只读命令之后，没跑过非只读的调用
        if c.get("name") in RO_TOOLS:
            continue
        if c.get("name") != "bash" or ro_queries(c.get("command") or "") is None:
            break
        if norm(c["command"]) == norm(cmd):
            deny(DUP_MSG + f"\n被拦的命令：{cmd.strip()[:200]}")
    if q >= 2 or (cur and len(cur) >= 2):
        return  # 已经合并：一条命令里多段查询，或这一步并行调了多个工具
    n = 0
    for step in reversed(prior):
        if all(c.get("denied") for c in step):
            continue  # 被拦的步没执行，不算也不打断
        live = [c for c in step if not c.get("denied")]
        q = [None if c.get("bg") else 1 if c.get("name") in RO_TOOLS else
             ro_queries(c.get("command") or "") if c.get("name") == "bash" else None for c in live]
        if None in q:
            break  # 有非只读的调用（改文件、跑脚本、后台任务、等任务…）：连续查询到此为止
        if len(live) == 1 and q == [1]:
            n += 1  # 单步单条查询才计数；合并过的步（并行多个调用 / 一条命令多段）不计数也不打断
    if n >= SERIAL_MAX:
        deny(SERIAL_MSG.format(n=n) + f"\n被拦的命令：{cmd.strip()[:200]}")




def main():
    d = json.load(sys.stdin)
    inp = d.get("tool_input") or {}
    busy = d.get("dsh_busy")
    turn = d.get("dsh_turn") if d.get("dsh") else None
    if d.get("tool_name") == "job_output":
        if inp.get("wait") is True and busy:
            deny(BUSY_MSG.format(items="、".join(busy)) + "\n被拦：job_output wait=true。不带 wait 读一次当前输出可以。")
        if turn and inp.get("wait") is True:
            check_job_poll(str(inp.get("job_id") or ""), turn, d.get("tool_use_id"))
        return
    cmd = inp.get("command", "")
    if not d.get("agent_id") and plan_gate.bash_blocked(cmd):
        asked = plan_gate.pending(d.get("transcript_path"))
        if asked:
            deny(plan_gate.message(asked))
    if (d.get("tool_input") or {}).get("run_in_background"):
        check_background(cmd)
    else:
        check_wait(cmd, busy, bool(d.get("dsh")))
        if d.get("dsh"):
            check_network(cmd)
        if turn:
            check_speed(cmd, turn, d.get("tool_use_id"))
    for seg in segments(cmd):
        t = toks(seg)
        if t and t[0] == "pkill" and any(re.match(r"^-[a-zA-Z]*f", a) for a in t[1:]):
            deny("不要用 pkill -f：它会匹配到执行本命令的 wrapper shell，把自己杀掉。"
                 "改用 pid 文件，或 `kill $(pgrep -f '[x]yz')`（方括号让 pattern 不匹配自身）。")
        if "# restart-ok" not in cmd and RESTART.search(seg):
            deny("不要直接 launchctl/kill 正在跑的桥：会把这轮回复和同桥的 bot 一起杀掉。"
                 "改用 `safe-restart \"原因\" \"重启后接着做的事|无\"`（等本轮回复发出再重启）或 `bothouse daemon restart`；"
                 "杀的是测试用的隔离实例就在命令末尾加 `# restart-ok`。")
        if sys.platform == "darwin" and "# tcc-ok" not in cmd and t[:2] == ["go", "build"] and re.search(r"-o\s+\S*bothouse", seg):
            deny("不要直接 go build -o 覆盖正在用的 bothouse：macOS 上签名会变回 ad-hoc，TCC 授权失效。"
                 "编到别的路径，再用原来的证书 codesign 后替换；确实要覆盖就在命令末尾加 `# tcc-ok`。")
        if any(x.endswith("ws-forward") for x in t[:1]) and "--interrupt" not in t and "# queue-ok" not in cmd \
                and FWD_CHANGE.search(seg):
            deny("这条 ws-forward 是在改工作区的方向（纠正、叫停、改做法），却没加 --interrupt：话会排到工作区这一轮跑完才到，"
                 "错的那部分会接着跑完。改方向一律加 --interrupt 当场插进去，也不要写「跑完再停」。"
                 "确实只是补充信息、不改做法，就在命令末尾加 `# queue-ok`。\n被拦的片段：" + seg.strip()[:200])
    direct_ok = not PROXY_URL or "# direct-ok" in cmd or PROXY.search(cmd)
    for seg in ([] if direct_ok else segments(cmd)):
        if not is_download(seg):
            continue
        us = urls(seg)
        if us and all(LOCAL.match(u) for u in us):
            continue
        reason = (
            f"下载命令没走代理（本机设了 HOOK_PROXY={PROXY_URL}：大文件走代理 + 分段并发）。"
            f"大文件用分段下载工具（如 pget）；小文件给 curl 加 `-x {PROXY_URL}`；"
            f"hf/wget 前加 `https_proxy={PROXY_URL}`。确需直连，在命令末尾加 `# direct-ok`。"
            f"\n被拦的片段：{seg.strip()[:200]}"
        )
        deny(reason)
    capped = sub_cap(inp, d)
    if capped:  # 规则 10：只改 timeout，命令照常执行（别的规则已在上面查过）
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                                 "updatedInput": capped, "additionalContext": SUB_CAP_MSG}},
                         ensure_ascii=False))
        sys.exit(0)
    if wiki_cat_pages(cmd, d.get("cwd")) >= WIKI_CAT_MIN:
        hint("这条命令整页 cat 了多页 wiki（照常执行，只是提醒）。下次先 `grep -rn <关键词> <wiki 目录>`（装了 llm-wiki 就用它的 "
             "`bin/search.py <关键词>`）拿 路径:行号，再 `sed -n '<起>,<止>p' <页>` 只读命中段，不整页 cat 多页。")

if __name__ == "__main__":
    main()
