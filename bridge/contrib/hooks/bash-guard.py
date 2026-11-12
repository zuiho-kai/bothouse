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
9. 仅 DSH，聊天频道主会话（不在工作区、不是子 agent、不是外出或定时轮）：真人派来的这一轮已执行 CHAT_STEPS_MAX 步工具，
   还没跑过 ws-handoff / ws-up / bothouse send|progress|task，再来只读查询就拦：先在群里回一句，大活写交接交工作区或 @ 队友。
   出处：用户 2026-11-05 看隔壁 DSH 主角色接三项需求后闷头翻 9 分钟不回话（「他妈现在搞7分钟」「出现什么问题你就去修它…变成我们的产品能力」）。
8. 仅 DSH 提速（本轮的工具调用来自 dsh-cc-compat.py 加的 dsh_turn）：同一轮第二次轮询同一对象拦；
   一串只读查询里第 4 个「一步只跑一条只读查询」的步拦（合并过的步放行），本轮重复的只读命令拦；
   前台联网长命令（git clone/fetch/pull、npm/pip/brew install）拦，改后台。子 agent 会话和外出轮豁免。
10. 不拦只改：Claude Code 子 agent（非 long-task）前台 Bash 的 timeout 超过 290 秒时压到 290 秒，跑不完自动转后台。
11. 报预计时间、挂定时（ws-*、later、board、bothouse progress/send/relay/timer/task）长于 15 分钟没写实测依据或外部等待 → 拦（eta_guard.py）。
12. 不拦只改：主会话（非 DSH、非子 agent）前台的远程、装包下载、CI、编译测试命令 timeout 超过 5 分钟时压到 290 秒。
13. 团队聊天频道不发测试：命令要往名单里的频道发东西就拦。名单 <钩子目录>/team-chat-channels.txt（或 HOOK_TEAM_CHANNELS），没有就不查。
14. 合并前真实入口验证：gh pr merge、GitCode 合并类接口先问 merge-gate guard；没装 merge-gate 不查。
15. 不拦只改：测试命令输出接 | tail/head/cut/sed/tee 时自动加 set -o pipefail；接 grep 的只提示。
6 补：for … sleep … break … done、caffeinate -w 也算前台干等；perl alarm 包着的命令照里面的命令查。
"""
import ast, json, os, re, shlex, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan_gate  # noqa: E402  要方案未批时拦开做（用户 2026-10-28）
import eta_guard  # noqa: E402  预计/定时长于 15 分钟要实测依据（用户 2026-10-26、2026-11-01）

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
# 绕过上一条的两种（作者 11-03 复盘，慢命令 13 条 84 分钟）：for i in $(seq 1 38); do kill -0 …||break; sleep 8; done，
# 以及 caffeinate -w <pid> 前台等进程结束。for 循环只在带 break 时算轮询（for … sleep 限速不算）。
POLL_FOR = re.compile(r"\bfor\b.*?\bdo\b(?=.*?\bsleep\b)(?=.*?\bbreak\b).*?\bdone\b", re.S)
# 两种包法都看里面的命令：perl -e 'alarm shift; exec @ARGV' <秒> <命令…>，perl -e 'alarm <秒>; exec @ARGV' <命令…>
PERL_ALARM = re.compile(r"perl\s+-e\s+(['\"])\s*alarm\s+(?:shift|\d+)\s*;\s*exec\s+@ARGV\s*;?\s*\1(?:\s+\d+)?\s+")
# 循环里用解释器睡（python3 -c 'import time;time.sleep(20)'）也算 sleep：去引号前先换成 sleep，否则 for…break 轮询漏拦
INLINE_SLEEP = re.compile(r"\b(?:python[\d.]*|perl|ruby|node(?:js)?)\s+-(?:c|e|-eval)\s+(['\"])(?:\\.|(?!\1).)*?\bsleep\b(?:\\.|(?!\1).)*?\1", re.S)
def interpreter_poll(program, source):
    """Inspect executable inline code, never shell-quoted data or string constants."""
    if re.fullmatch(r"python[\d.]*", program):
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return False
        for loop in ast.walk(tree):
            if not isinstance(loop, (ast.While, ast.For, ast.AsyncFor, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                continue
            if any(isinstance(n, ast.Call) and
                   ((isinstance(n.func, ast.Attribute) and n.func.attr == "sleep") or
                    (isinstance(n.func, ast.Name) and n.func.id == "sleep")) for n in ast.walk(loop)):
                return True
        return False
    # Preserve executable shell sleep passed to Node's execSync, then mask
    # ordinary strings/comments before looking for Ruby/Perl/JS loop syntax.
    source = re.sub(r"\bexecSync\(\s*(['\"])sleep\s+\d+\1\s*\)", "sleep()", source)
    source = re.sub(r"(['\"`])(?:\\.|(?!\1).)*?\1|/\*.*?\*/|//[^\n]*|\#[^\n]*", " ", source, flags=re.S)
    if program in ("node", "nodejs") and re.search(r"\bsetInterval\s*\(", source):
        return True
    return bool(re.search(r"\bsleep\b", source) and
                re.search(r"\b(?:while|until|for|loop)\b", source))


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
    if not d.get("agent_id") or d.get("agent_type") == SUB_CAP_AGENT or inp.get("run_in_background"):
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
    cmd = PERL_ALARM.sub("", cmd)  # perl -e 'alarm shift; exec @ARGV' <秒> <命令…>：看被包的命令
    # shlex keeps the interpreter's quoted source in a single argument.
    try:
        lexer = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()\n")
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        words = list(lexer)
    except ValueError:
        words = []
    commands = [[]]
    for word in words:
        if word in (";", "&&", "||", "|", "\n"):
            commands.append([])
        else:
            commands[-1].append(word)
    for args in commands:
        while args and (re.match(r"^\w+=", args[0]) or args[0] in ("sudo", "env", "time", "command", "exec", "do", "then")):
            args.pop(0)
        if not args:
            continue
        program = args[0].rsplit("/", 1)[-1]
        if not re.fullmatch(r"python[\d.]*|perl|ruby|node|nodejs", program):
            continue
        for j in range(1, len(args) - 1):
            if args[j] in ("-c", "-e", "--eval"):
                if interpreter_poll(program, args[j + 1]):
                    deny(WAIT_MSG + "\n被拦：解释器中的轮询等待循环。")
                break
    # Shell loops cannot be inferred from text quoted as an argument.
    shell = re.sub(r"(['\"])(?:\\.|(?!\1).)*?\1", " ", INLINE_SLEEP.sub(" sleep ", cmd), flags=re.S)
    if POLL_LOOP.search(shell):
        deny(WAIT_MSG + "\n被拦：until/while … sleep … done 轮询循环。")
    if POLL_FOR.search(shell):
        deny(WAIT_MSG + "\n被拦：for … sleep … break … done 轮询循环。")
    for t in commands:
        seg = shlex.join(t)
        if not t:
            continue
        prog = t[0].rsplit("/", 1)[-1]
        if prog == "gh" and (t[1:3] == ["run", "watch"] or any(a == "--watch" or a.startswith("--watch=") for a in t)):
            deny(WAIT_MSG + f"\n被拦的片段：{seg.strip()[:200]}")
        if prog == "caffeinate" and "-w" in t:
            deny(WAIT_MSG + f"\n被拦：caffeinate -w 前台等进程结束。被拦的片段：{seg.strip()[:200]}")
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
CHAT_STEPS_MAX = 8  # 隔壁实录：串行双查询每步约 12 秒，8 步约 1.5–2 分钟；规矩「预计超过 10 分钟交工作区」
# 跑过这些就算已回话或已交出：交工作区、工作区推进度、发群消息/进度卡、派任务
CHAT_HANDED = re.compile(r"(?:^|[\s/;&|(])(?:ws-handoff|ws-up|ws-forward)\b|\bbothouse\s+(?:send|progress|task)\b")
CHAT_MSG = ("这是聊天频道，真人派来的这一轮你已经跑了 {n} 步工具，群里还没听到一句话。按团队规矩："
            "预计超过 10 分钟或要改代码、跑命令的活，现在就写交接（用户原话、总目标、范围）跑 `ws-handoff <交接文件> \"<任务>\"` 交工作区，"
            "或 @ 合适的队友派出去，然后结束本轮、在群里一句话说清派给了谁；小活就别再查了，直接回答。"
            "（规则 9；用户 2026-11-05「他妈现在搞7分钟」）")
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

SERIAL_MSG = ("（照常执行，只是提醒）这一轮已经有 {n} 步各只跑了一条只读查询，每多一步就要多等一次模型开口（中位约 7.5 秒）。"
              "接下来能合并就合成一步：一条命令里用 echo === 分段（例：`cat a.md; echo ===; git log -3; echo ===; gh pr view 5`），"
              "或者在一条回复里并行调多个工具；下一条要用这条的结果、合不了的，照常一步一步查。"
              "（规则：一串只读查询里第 4 个单条查询的步起提醒，不拦；拦了换不来少走步，只多等一轮，用户 2026-11-12 #1514 定改提醒）")
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


def _in_workspace():
    """同 dispatch-review-guard.in_workspace（工作区频道记在 team_workspaces.json）。"""
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location(
            "drg", os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch-review-guard.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m.in_workspace()
    except Exception:
        return True  # 判断不了就当工作区，不拦


def check_chat_turn(cmd, turn, done):
    """规则 9：聊天频道里真人派的这一轮，执行满 CHAT_STEPS_MAX 步还没交出、没回话，只读查询拦下。"""
    if turn.get("auto"):
        return
    steps = [s for s in turn.get("steps") or [] if any(not c.get("denied") for c in s)]
    if len(steps) < CHAT_STEPS_MAX:
        return
    if any(c.get("name") == "bash" and CHAT_HANDED.search(c.get("command") or "") for c in done):
        return
    if _in_workspace():
        return
    deny(CHAT_MSG.format(n=len(steps)) + f"\n被拦的命令：{cmd.strip()[:200]}")


def check_speed(cmd, turn, cid):
    """规则 8a 的 gh run 轮询、8b 的串行只读和重复命令。串行只读不拦，返回要附在结果后的提醒（没有返回 None）。"""
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
    check_chat_turn(cmd, turn, done)
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
        return SERIAL_MSG.format(n=n)




# ---- 规则 13：团队聊天频道不发测试（用户 2026-10-29「你不要污染我的团队服务器的常规频道啊」）----
# 频道 id 一行一个（# 后是注释），文件 <钩子目录>/team-chat-channels.txt，或环境变量 HOOK_TEAM_CHANNELS 指的文件；没有这个文件不查。
TEAM_CH_FILE = os.path.expanduser(os.environ.get("HOOK_TEAM_CHANNELS") or os.path.join(HERE, "team-chat-channels.txt"))


def check_team_channels(cmd):
    try:
        ids = [l.split("#")[0].strip() for l in open(TEAM_CH_FILE, encoding="utf-8")]
    except OSError:
        return
    ids = [i for i in ids if i]
    if not re.search(r"\b(timer|cron)\s+add\b|\b(bothouse|cc-connect)\s+(send|relay)\b|\bPOST\b|\bDELETE\b|messages", cmd):
        return
    hit = [i for i in ids if i in cmd]
    if hit and not re.search(r"\bDELETE\b", cmd):
        deny("这条命令要往团队服务器的聊天频道发东西（" + "、".join(hit) + "）。测试、验收、回归一律放工作区频道或临时测试频道，"
             f"不发聊天频道（名单 {TEAM_CH_FILE}）。没有放行标记：要往这些频道发东西，让那里的角色自己在频道里回话，或者先问用户。")


# ---- 规则 14：合并前真实入口验证（作者 10-30 复盘第 4 条，用户「1-5都改」）----
# gh pr merge、GitCode 合并类接口：PR 当前提交要在 merge-gate 登记过真实入口的截图或日志。判定全在 merge-gate guard 里；
# 找不到 merge-gate（没装团队工具）不查。
MERGE_CMD = re.compile(r"\bgh\s+pr\s+merge\b|api\.gitcode\.com/api/v5/repos/")


def _merge_gate():
    data = os.path.expanduser(os.environ.get("BOTHOUSE_DATA_DIR") or os.environ.get("GATE_SETUP_DIR") or "~/.bothouse")
    p = os.environ.get("HOOK_MERGE_GATE") or os.path.join(data, "collaboration", "lead", "merge-gate")
    return p if os.path.exists(p) else ""


def check_merge(cmd, cwd):
    gate = MERGE_CMD.search(cmd) and _merge_gate()
    if not gate:
        return
    try:
        r = subprocess.run([gate, "guard", "--cmd", cmd] + (["--cwd", cwd] if cwd else []),
                           capture_output=True, text=True, timeout=40)
    except subprocess.TimeoutExpired:
        deny("合并前要核对真实入口验证，merge-gate 40 秒没查完（多半是 GitCode/GitHub 接口慢）。稍后重试，查不到就不合。")
    if r.returncode:
        deny((r.stdout.strip() or r.stderr.strip()[-400:] or "merge-gate 拒绝") + f"\n被拦的命令：{cmd.strip()[:200]}")


# ---- 规则 15：测试命令输出接 | tail/head/cut/sed/tee 时管道吞退出码（作者 11-02 复盘：`go test … | tail` 实际 2 个失败没看出来）----
# 自动在前面加 `set -o pipefail;`（tail/head 自己总是 0，加了后退出码就是测试的）；接 grep 的只提示。
TESTCMD = re.compile(r"\b(go\s+test|pytest|python3?\s+(-I\s+)?-m\s+(pytest|unittest)|(npm|pnpm|yarn)\s+(run\s+)?test|cargo\s+test|make\s+test|npx\s+(vitest|jest)|vitest\s+run|node\s+(\S+\s+)*--test|python3?\s+(-I\s+)?\S*test_\S+\.py)\b")
TESTPIPE = re.compile(r"\|\s*(tail|head|cut|sed|tee)\b")
TESTGREP = re.compile(r"\|\s*grep\b")
TEST_MSG = ("这条测试命令的输出接了管道，退出码会被吞（有过 2 个失败被 tail 盖住）。已自动加 `set -o pipefail;`，"
            "看退出码判断成败，不看 tail 出来的那几行。要过滤输出就把完整输出写进日志文件，另存退出码。")


def pipefail_fix(inp):
    cmd = inp.get("command", "")
    if not TESTCMD.search(cmd) or re.search(r"pipefail|pipestatus|PIPESTATUS|testrun", cmd):
        return None, None
    if TESTPIPE.search(cmd):
        return dict(inp, command="set -o pipefail; " + cmd), TEST_MSG
    if TESTGREP.search(cmd):
        return None, ("测试输出接了 grep：管道退出码是 grep 的，不是测试的，不能据此说测试过了。"
                      "把完整输出写进日志文件、另存退出码，再 grep 日志。")
    return None, None


# ---- 规则 12：主会话前台长命令（作者 11-05 复盘：超 5 分钟的 7 条前台命令全是主会话远程安装、远程核查，自己设了 timeout 600000）----
# 非 DSH、非子 agent（子 agent 归规则 10）的前台 Bash，timeout 超过 5 分钟且命令（去掉 heredoc 正文）是远程、装包下载、CI、
# 编译测试这几类的，把 timeout 压到 290 秒（跑不完 Claude Code 自动转后台，主会话立刻拿回控制权）。不硬拦：回放 11-05 全天，
# 这几类 110 条里真超 5 分钟的只有 7 条，硬拦多数是白重试。
LONG_FG_MS = 300000  # 从发出到拿到结果超过 5 分钟算慢命令（作者 11-05 复盘）
LONG_KIND = re.compile(r"(^|[\s;&|(\"'])(ssh|scp|rsync|npm|pnpm|yarn|pip3?|brew|curl|wget|pget|"
                       r"git\s+(clone|fetch|pull|push)|gh\s+run|docker\s+(pull|push|build)|\S*deploy\S*\.sh|"
                       r"(\S*/)?go\s+(test|install|build|clean)|(\S*/)?uv\s+cache|"
                       r"npx\s+(vitest|jest|playwright)|vitest|jest|node\s+(\S+\s+)*--test|pytest|cargo\s+test|make\s+(test|check|e2e))\b")
# perl alarm 自己给了超过 5 分钟的秒数，就是预期要跑那么久
LONG_ALARM = re.compile(r"perl\s+-e\s+(['\"])alarm[^'\"]*\1\s+(\d+)\s")
LONG_FG_MSG = ("这条前台命令设了超过 5 分钟的 timeout，又是安装、下载、CI、编译测试或远程操作，timeout 已压到 290 秒，跑不完会自动转后台。"
               "下次一开始就后台起（run_in_background=true，套超时、输出写日志），结束这一轮，交回 pid 和日志路径，完成后看退出码；"
               "编译、安装、验收拆成几条分开起。")


def main_cap(inp, d):
    """规则 12：返回压到 SUB_CAP_MS 的新 tool_input；不归这条返回 None。"""
    if d.get("dsh") or d.get("agent_id") or inp.get("run_in_background"):
        return None
    if (inp.get("timeout") or 0) <= LONG_FG_MS:
        return None
    body = HEREDOC.sub("", inp.get("command", ""))
    # 几条 perl alarm 串着跑按总和算
    if not LONG_KIND.search(body) and sum(int(m.group(2)) for m in LONG_ALARM.finditer(body)) <= LONG_FG_MS // 1000:
        return None
    return dict(inp, timeout=SUB_CAP_MS)


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
    eta = eta_guard.check_shell(cmd)
    if eta:
        deny(eta)
    check_team_channels(cmd)
    check_merge(cmd, d.get("cwd"))
    serial_note = None
    if (d.get("tool_input") or {}).get("run_in_background"):
        check_background(cmd)
    else:
        check_wait(cmd, busy, bool(d.get("dsh")))
        if d.get("dsh"):
            check_network(cmd)
        if turn:
            serial_note = check_speed(cmd, turn, d.get("tool_use_id"))
    for seg in segments(cmd):
        t = toks(seg)
        if t and t[0] == "pkill" and any(re.match(r"^-[a-zA-Z]*f", a) for a in t[1:]):
            deny("不要用 pkill -f：它会匹配到执行本命令的 wrapper shell，把自己杀掉。"
                 "改用 pid 文件，或 `kill $(pgrep -f '[x]yz')`（方括号让 pattern 不匹配自身）。")
        if RESTART.search(seg):
            deny("不要直接 launchctl/kill 正在跑的桥：会把这轮回复和同桥的 bot 一起杀掉。"
                 "改用 `safe-restart \"原因\" \"重启后接着做的事|无\"`（等本轮回复发出再重启）或 `bothouse daemon restart`。")
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
    fixed, test_msg = pipefail_fix(inp)
    mcap = main_cap(fixed or inp, d)
    capped = sub_cap(fixed or inp, d) or mcap or fixed
    if capped:  # 规则 10/12：只改 timeout；规则 15：测试管道加 pipefail。命令照常执行（别的规则已在上面查过）
        cap_msg = LONG_FG_MSG if mcap else SUB_CAP_MSG
        msg = "\n".join(m for m in ((cap_msg if capped.get("timeout") != inp.get("timeout") else None), test_msg, serial_note) if m)
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                                 "updatedInput": capped, "additionalContext": msg}},
                         ensure_ascii=False))
        sys.exit(0)
    notes = [test_msg]
    if wiki_cat_pages(cmd, d.get("cwd")) >= WIKI_CAT_MIN:
        notes.append("这条命令整页 cat 了多页 wiki（照常执行，只是提醒）。下次先 `grep -rn <关键词> <wiki 目录>`（装了 llm-wiki 就用它的 "
                     "`bin/search.py <关键词>`）拿 路径:行号，再 `sed -n '<起>,<止>p' <页>` 只读命中段，不整页 cat 多页。")
    notes.append(serial_note)
    if any(notes):
        hint("\n".join(m for m in notes if m))

if __name__ == "__main__":
    main()
