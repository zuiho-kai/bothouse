#!/usr/bin/env python3
"""Stop：本轮最终回复里许了"往后的事"，本轮却没有兑现它的东西 → 拦下一次。
出处：用户 2026-10-18 原话"我是看到说你ds挂了，你没感知在哪浪费时间，然后实验跑了一坨屎"
（两次说"01:18 / 02:49 我回来看"都没真正叫醒，晾了两小时）；全局规则（用户 2026-10-17 定）
"回复里写了'下一步/先做'的事，同一轮就派出去"；审稿三条；代码审查 2026-10-18。
三类承诺和各自认的回执：
  带时间（HH:MM 回来看 / X 分钟后、过 X 分钟再看 / 明早看 / 到时我来看 / 大约 22:15 跑完、结果出来就发你）→ 只认会按时叫醒的：
      bothouse timer/cron add、ScheduleWakeup、CronCreate；outing-next（作者自用脚本，不在本仓库，没有就不会匹配）
      只在 outing-tick 真会叫的频道和钟点里算（见 outing_fire）。
      后台 Bash、后台 Agent 不算：挂在会话上，bothouse 一重启就没了（审稿第 1 条）。
      只有绝对钟点（HH:MM、X 点 Y 分）可以靠前几轮的定时器：要算得出那个定时器的响铃时间，并且在"现在"和承诺的钟点之间。
      "我定了/设了/已安排 01:18 回来看"这类自称设好了的话，不走过去时、例行任务的豁免，必须真有回执。
  等结果（结果出来再告诉你 / 跑完再说 / 等它回来我再…）→ 上面那些，或本轮的后台 Bash / 后台 Agent / Monitor / SendMessage，
      或本轮、上一轮启动、还没收到完成通知的后台任务（跑完会自动叫醒）。
  下一步（下一步我去改 X / 我先做 X / 马上派人）→ 本轮派出去的东西：Agent、SendMessage、后台或脱离会话的 Bash
      （nohup、setsid、bothouse …，另加环境变量 HOOK_DETACHED_CMDS 列的命令）、回复里 @ 队友，或定时器。普通前台 Bash 不算：轮次结束它也结束了，没人接着做。
不算承诺：建议句和问句、转述别人的话、讲过去的事、表格行、标题行、引号里的话。
回复里写了"不跟进/不再看 + 原因"的放行（审稿第 2 条）。
只拦一次（stop_hook_active 时放行），写法照 fix-claim-guard.py；hook 自己出错时静默放行。"""
import json, os, re, sys
from datetime import datetime, timedelta

# 引号、书名号、反引号、代码块里的是引用，不是承诺（沿用 fix-claim-guard.py 的 QUOTED）
CODE_BLOCK = re.compile(r"```.*?```", re.S)
QUOTED = re.compile(r'"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|‘[^’\n]*’|`[^`\n]*`')
SENT_SPLIT = re.compile(r"(?<=[？?])|[。！!\n；;]")  # 问号留在句尾，好认出问句

# ---- 时间 ----
CN = r"[零一二两三四五六七八九十]"
NUM = r"[一两二三四五六七八九十半\d]+"
# 绝对钟点：01:18、14 点 35 分、两点三十五分、六点左右；"第 3 点"是序号，不是钟点
ABS = (r"(?<!第)(?<!第 )(?:(\d{1,2})[:：](\d{2})|(\d{1,2})\s*点\s*(?:(半)|(\d{1,2})\s*分)?|(" + CN + r"{1,3})点(?:(半)|(" + CN + r"{1,3})分)?)")
ABS_RX = re.compile(ABS)
TIME = (r"(?:" + ABS + r"(?:\s*(?:左右|前后))?"
        r"|" + NUM + r"\s*(?:个)?\s*(?:分钟|小时|min|h)\s*(?:后|以后|之后)"
        r"|(?:过|等)\s*" + NUM + r"\s*(?:个)?\s*(?:分钟|小时)"  # "过 40 分钟回来看""等 40 分钟我再看"（代码审查第 5 条）
        r"|明[早天晚]|明儿|今晚|今天晚上|明天早上|周[一二三四五六日天]凌晨|到时候?)")
TIME_RX = re.compile(TIME)
# 回来跟进的动作
FOLLOW = (r"(?:回来|再看|再查|去看|来看|看一?[下眼]|看看|看进度|看结果|看重测|看日志|看情况|查看|检查|复查|汇报|报告|告诉你|通知你|同步|跟进|验收"
          r"|收结果|收尾|回你|再说|贴给你|发给你|报给你|确认|看)")
# 时间和动作之间要有"我"（"01:18 我回来看""我 12 点 55 分看一眼"），或者紧挨着（"01:18 回来看"）；
# 没有主语、隔得远的多是在讲别的事（"今早 04:00 的任务说明里…""龙娘那份不是 13:01 同步的"）。
# 中间不跨逗号（只许紧跟时间的一个逗号）："14:05 就跑完了，可我换会话以后漏了汇报"是在讲过去。
# "X 分钟内有结果"是结果的预计时间，算"等结果"那类。
NC = r"[^。！？\n，,]"
TIMED = re.compile(
    r"我" + NC + r"{0,4}?" + TIME + r"[，, ]?" + NC + r"{0,10}?" + FOLLOW +
    r"|" + TIME + r"[，, ]?" + NC + r"{0,10}?我" + NC + r"{0,12}?" + FOLLOW +
    r"|" + TIME + r"\s*(?:再|就|会)?\s*(?:回来看|回来查|再看|再查|去看|来看|看一?[下眼]|看看)")
# 讲已有的例行任务，不是新承诺（"14:00 照常出来""每天 01:00 检查一次"）；"每天"只在修饰钟点时算（代码审查第 8 条）
SCHEDULE = re.compile(r"照常|每(?:天|晚|早|周[一二三四五六日天]?)\s*(?:" + ABS + r"|凌晨|早上|晚上)|每小时|每半小时|定时任务")
# 自称已经设好了叫醒（"我定了 01:18 回来看""timer 已设好：14:30 我回来看"）：不走过去时、例行任务的豁免（代码审查第 4 条）
SET_CLAIM = re.compile(r"定了|设了|设好|定好|订了|订好|已安排|安排了|安排好|已设|timer|定时器|提醒|闹钟")

# ---- 等结果 ----
# 等……再/就 + 动作；跑完/出来/修完 + (后) + (我…)(再/就/会) + 动作（"做完告诉你""改完我复核""结果回来我用一两句话告诉你"）
# "说"后面跟"一句/两句"是在补充话，不是汇报（"做完了，我再说一句"）
WAIT_VERB = r"(?:告诉你|汇报|报告|通知你|同步|发你|发给你|发上来|发到|贴|回你|跟你说|看|查|说(?!一句|两句|几句|明|一下)|验收|收|报|决定|合并|接着|复核|核对|汇总|派)"
WAIT = re.compile(
    r"等[^。！？\n，,]{1,20}?(?:了|后|之后|以后)?[，, ]?我?(?:再|就)" + WAIT_VERB +
    # 触发词后不接"了"："做完了，…""跑完了"是已经完了
    r"|(?:出来|跑完|做完|写完|审完|测完|修完|改完|验完|核完|查完|弄完|装完|完成|结束|回来|回音|出结果|有结果|有回音|落地|交付"
    r"|(?:验|看|核|测|试)过(?:之后|以后|后))(?:后|之后|以后)?[，, ]?"
    # 有"我"时中间可隔几个字；没"我"时要有"再/就"（"结果出来再一起告诉你"），否则"多出来的失败分析值得看一眼"也会算
    r"(?:我" + NC + r"{0,8}?(?:再|就|会)?|" + NC + r"{0,6}?(?:再|就)" + NC + r"{0,3}?|(?:再|就|会)?)(?:先)?" + WAIT_VERB)

# ---- 下一步 ----
NEXT_VERB = r"(?:做|改|派|跑|写|修|查|让|找|开|补|加|测一下|测试|实测|重测|重跑|接|审|拆|部署|上线|合并|发|重启|搬|迁)"
# 中间不跨逗号："现在就同步，审查一旦挑出问题…"是在讲道理
NEXT = re.compile(r"(?:下一步|接下来|我先|我马上|马上|我这就|这就|现在就|我去|我接着|我会去|我待会|我等下)[^。！？\n，,]{0,6}?" + NEXT_VERB)

# ---- 不算承诺的 ----
# 五段式的「【接下来】」是段名，本身不算承诺；段里的内容照常按句判断
SECTION = re.compile(r"【[^】\n]{1,6}】")
# 建议、提问、交给用户定
PROPOSAL = re.compile(r"要是|否则|我可以|就可以|也可以|的话|你想|你要的话|要不要|如果你|你点头|你同意|你确认|你说一声|你来定|由你定|你定吧|你决定吧|看你|等你|你要是|需要的话|愿意的话|建议|可以吗|行吗|好吗|是否|吗$|[?？]")
QUESTION = re.compile(r"吗$|[?？]|要不要|是否")
# 转述别人的话（"龙娘说：…""子 agent 汇报：…""你…就行"）（代码审查第 7 条）
# 队友名字：仓库预设人设（bridge/core/persona_presets.go）里的几个，加上环境变量 HOOK_TEAMMATES（用 | 隔开）
_MATES = "|".join(re.escape(x.strip()) for x in ("橘|龙娘|鲸鱼娘|彩虹猫|" + os.environ.get("HOOK_TEAMMATES", "")).split("|") if x.strip())
REPORTED = re.compile(r"(?:" + _MATES + r"|子 ?agent|agent|审查员?|审稿人?|她|他|它|对方|用户)(?:说|汇报|报告|回复|回|写|建议|提到)(?:了|的)?\s*[：:]|(?:汇报|报告|原话|回复)\s*[：:]|你" + NC + r"{0,20}?就行")
# 讲过去的事（"昨晚说 02:49 回来看""上次…""出事时，我…"）（代码审查第 7 条）
RETRO = re.compile(r"昨晚|昨天|前天|上次|那次|那会|当时|那时|才回来|岔开|晾了|(?<![到同及准按临])时[，,]")
# 过去时：已经做过的不是承诺（"我 10 点看过了"）。只看承诺那几个字前 4 字到后 3 字：
# "我已经派人去测…六点左右来看结果"前半句的"已经"不影响后半句的承诺
PAST = re.compile(r"过了|看过(?![再后之以])|查过(?![再后之以])|已经|已|刚才|刚刚|刚|(?:发|做|改|派|跑|写|修|查|定|排|说|约|测|加|补)了")
# 推到以后、现在不做的，是决定不做，不是承诺回来（"这个不急，等十一月再定""等真有用户喊着要再说"）
DEFER = re.compile(r"不急|现在不|先不做|暂不|等以后|将来|比较稳|更稳|等真有|等真的|再定"
                   # 等别人开口（点头、批准、回复）：对方说话时我自然会被叫醒，不用定时器
                   r"|点头|同意|批准|回复|答复|拍板|想聊|你定")
# 段落整行是标题（"**接下来怎么做**""## 下一步"）或表格行，不是句子
HEADING = re.compile(r"^\s*(?:#+\s.*|[-*]?\s*\*\*[^*]+\*\*[：:]?|\|.*)\s*$")
# 前 2 字有否定的不算（照 fix-claim-guard.py 的 NEG 窗口）："不会再看""没法回来"
NEG = re.compile(r"[没未不别无]")
# 明说不跟进 + 原因：放行（审稿第 2 条）
OPT_OUT = re.compile(r"(?:不跟进|不再跟进|不再看|不回来看|不再回来|不盯了|不再盯|不追了)[^。\n]{0,40}?(?:原因|因为)|(?:原因|因为)[^。\n]{0,40}?(?:不跟进|不再跟进|不再看|不回来看|不再回来|不盯了|不再盯|不追了)")
# 回复里 @ 队友 = 在群里派活（bothouse：把 <@id> 写进回复就会 @ 到她）
MENTION = re.compile(r"<@\d+>")

# ---- 回执 ----
# 只认在命令位置上的 bothouse（行首、; && | ( 之后），echo/printf 里的字面命令不算（代码审查第 8 条）
CMD_POS = r"(?:^|[;&|(\n]|\$\()\s*(?:[\w./~-]*/)?"
WAKE_CMD = re.compile(CMD_POS + r"(?:bothouse|cc-connect)(?:-\w+)?\s+(?:timer|cron)\s+add\b", re.M)
TIMER_DELAY = re.compile(CMD_POS + r"(?:bothouse|cc-connect)(?:-\w+)?\s+timer\s+add\b[^\n]*?--delay[= ]\s*(\d+)\s*([smhd])", re.M)
TIMER_AT = re.compile(CMD_POS + r"(?:bothouse|cc-connect)(?:-\w+)?\s+timer\s+add\b[^\n]*?--at[= ]\s*[\"']?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)", re.M)
UNIT_S = {"s": 1, "m": 60, "h": 3600, "d": 86400}  # 秒/分/时/天换算成秒；单位写法来源：bothouse timer add --help（30m、2h）
WAKE_TOOLS = {"ScheduleWakeup", "CronCreate"}
OUTING = re.compile(CMD_POS + r"outing-next\s+(?:(\d+)m\b|(\d{1,2}):(\d{2})\b)", re.M)
_DATA = os.path.expanduser("~/.bothouse")
if not os.path.exists(_DATA) and os.path.isdir(os.path.expanduser("~/.cc-connect")):
    _DATA = os.path.expanduser("~/.cc-connect")
JOBS = os.path.join(_DATA, "crons", "jobs.json")
# 脱离会话、轮次结束后还在干活的 Bash
# 作者自己的后台派活命令（如 gpt、dsx）写进 HOOK_DETACHED_CMDS，用 | 隔开
_EXTRA = "".join(r"|\b" + re.escape(x.strip()) + r"\s" for x in os.environ.get("HOOK_DETACHED_CMDS", "").split("|") if x.strip())
DETACHED_CMD = re.compile(r"\bnohup\b|\bsetsid\b|&\s*(?:disown)?\s*$|bothouse\s|launchctl\s|systemd-run\s" + _EXTRA, re.M)
# 后台任务的 id（Bash 后台、超时转后台、后台 Agent）和完成通知里的 id。前台 Agent 的结果里也有 agentId，所以只认 "Async agent launched" 后面那个
BG_ID = re.compile(r"(?:running in background with ID: |moved to the background \(ID: |Async agent launched.{0,300}?agentId: )([A-Za-z0-9]+)", re.S)
DONE_ID = re.compile(r"<task-id>([A-Za-z0-9]+)</task-id>")


def is_prompt(e):
    """真实用户消息（含 task-notification、定时器唤醒）；tool_result 也是 type=user，不算新一轮；压缩摘要不算（代码审查第 6 条）。"""
    if e.get("type") != "user" or e.get("isMeta") or e.get("isCompactSummary") or e.get("isVisibleInTranscriptOnly"):
        return False
    c = (e.get("message") or {}).get("content")
    return isinstance(c, str) or (isinstance(c, list) and any(isinstance(b, dict) and b.get("type") == "text" for b in c))


def turns(entries):
    """把会话切成轮：[(开头那条用户消息, 本轮条目列表)]。"""
    out, cur, head = [], [], None
    for e in entries:
        if e.get("isSidechain"):
            continue
        if is_prompt(e):
            if head is not None or cur:
                out.append((head, cur))
            head, cur = e, []
        else:
            cur.append(e)
    if head is not None or cur:
        out.append((head, cur))
    return out


def analyze(entries):
    """返回 (最终回复文字, tool_use 列表, 出错的 tool_use_id 集合)。最终回复 = 最后一个 tool_use 之后的助手文字。"""
    tools, errs, final = [], set(), []
    for e in entries:
        c = (e.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if e.get("type") == "assistant" and b.get("type") == "tool_use":
                tools.append(dict(b, _ts=e.get("timestamp")))
                final = []
            elif e.get("type") == "assistant" and b.get("type") == "text":
                final.append(b.get("text", ""))
            elif b.get("type") == "tool_result" and b.get("is_error"):
                errs.add(b.get("tool_use_id"))
    return "\n".join(final), tools, errs


def parse_ts(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone() if ts else datetime.now().astimezone()
    except (ValueError, AttributeError):
        return datetime.now().astimezone()


def ctx_env():
    """(项目, 频道 id)：bothouse 给会话设的 CC_PROJECT、CC_SESSION_KEY（outing-next 也按它们找频道）。"""
    return os.environ.get("CC_PROJECT", ""), os.environ.get("CC_SESSION_KEY", "").rpartition(":")[2]


def tick_hours(project, channel):
    """outing-tick 会在哪些钟点叫这个频道：读 jobs.json 里启用的 outing-tick 任务（参数：bot 频道 接着任务 整点任务 [--own-state]）。
    晚上那套（整点任务传 "-" 且不是 --own-state）要等 dinner-done 才叫，吃没吃完事先不知道，不认（代码审查第 2 条）。"""
    hours = set()
    try:
        jobs = json.load(open(JOBS, encoding="utf-8"))
    except (OSError, ValueError):
        return hours
    jobs = jobs if isinstance(jobs, list) else jobs.get("jobs", [])
    for j in jobs if isinstance(jobs, list) else []:
        args = (j.get("exec") or "").split()
        if not j.get("enabled") or len(args) < 5 or not args[0].endswith("outing-tick"):
            continue
        own = "--own-state" in args[5:]
        if args[1] != project or args[2] != channel or (args[4] == "-" and not own):
            continue
        m = re.match(r"\S+\s+(\d+)(?:-(\d+))?\s", j.get("cron_expr") or "")
        if m:
            hours |= set(range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1))
    return hours


def outing_fire(cmd, ts, ctx):
    """outing-next 定的醒来时间；outing-tick 不会在那时叫这个频道就返回 None。算法照作者的 outing-next 脚本。"""
    m = OUTING.search(cmd)
    if not m or not ctx or not ctx[1]:
        return None
    now = parse_ts(ts)
    if m.group(1):
        t = now + timedelta(minutes=int(m.group(1)))
    else:
        t = now.replace(hour=int(m.group(2)), minute=int(m.group(3)), second=0, microsecond=0)
        if t <= now:  # outing-next：晚上说「09:00」是明早
            t += timedelta(days=1)
    return t if t.hour in tick_hours(*ctx) else None


def fire_times(t, ctx):
    """一个工具调用会在什么时候叫醒（算得出的才返回）。"""
    name, inp, now = t.get("name"), t.get("input") or {}, parse_ts(t.get("_ts"))
    out = []
    if name == "ScheduleWakeup" and str(inp.get("delaySeconds", "")).isdigit():
        out.append(now + timedelta(seconds=int(inp["delaySeconds"])))
    if name == "Bash":
        cmd = inp.get("command", "")
        for n, u in TIMER_DELAY.findall(cmd):
            out.append(now + timedelta(seconds=int(n) * UNIT_S[u]))
        for at in TIMER_AT.findall(cmd):
            try:
                out.append(datetime.fromisoformat(at.replace("Z", "+00:00").replace(" ", "T")).astimezone())
            except ValueError:
                pass
        f = outing_fire(cmd, t.get("_ts"), ctx)
        if f:
            out.append(f)
    return out


def receipts(tools, errs, ctx=None):
    """本轮有哪几种回执：wake（按时叫醒）、bg（跑完叫醒）、dispatch（派出去）。"""
    have = set()
    for t in tools:
        if t.get("id") in errs:
            continue
        name, inp = t.get("name"), t.get("input") or {}
        if name in WAKE_TOOLS:
            have |= {"wake", "bg", "dispatch"}
        elif name == "Bash":
            cmd = inp.get("command", "")
            if WAKE_CMD.search(cmd) or outing_fire(cmd, t.get("_ts"), ctx):
                have |= {"wake", "bg", "dispatch"}
            if inp.get("run_in_background"):
                have |= {"bg", "dispatch"}
            elif DETACHED_CMD.search(cmd):
                have.add("dispatch")
        elif name == "Agent":
            have.add("dispatch")
            # Agent 默认后台跑（工具说明："Subagents run in the background by default"）
            if inp.get("run_in_background") is not False:
                have.add("bg")
        elif name == "Monitor":
            have.add("bg")
        elif name == "SendMessage":
            # 给后台 agent 发消息会让它接着在后台跑，跑完同样会叫醒
            have |= {"dispatch", "bg"}
    return have


def paragraphs(text):
    """[[句子…]…]：按段分，段内按句分。"""
    text = CODE_BLOCK.sub("", text)
    text = QUOTED.sub("", text)
    text = SECTION.sub("", text)
    out = []
    for para in text.split("\n"):
        if HEADING.match(para):
            continue
        ss = [s.strip() for s in SENT_SPLIT.split(para) if s.strip()]
        if ss:
            out.append(ss)
    return out


def classify(s):
    """timed / timed_claim（自称设好了叫醒）/ wait / next / None。"""
    if REPORTED.search(s) or RETRO.search(s):
        return None
    for kind, rx in (("timed", TIMED), ("wait", WAIT), ("next", NEXT)):
        m = rx.search(s)
        if not m or NEG.search(s[max(0, m.start() - 2):m.start()]):
            continue
        if kind != "next" and SET_CLAIM.search(s) and TIME_RX.search(s):
            return "timed_claim"
        if PAST.search(s[max(0, m.start() - 4):m.end() + 3]) or s[m.end():m.end() + 1] in ("过", "了"):  # 窗口 4/3 字：覆盖"我定了一小时后""看过了"，见 PAST 注释
            continue
        if kind in ("timed", "wait") and SCHEDULE.search(s):
            continue
        if kind == "wait" and DEFER.search(s):
            continue
        # 等结果的话里报了钟点（"大约 22:15 跑完，结果出来我就发给你"），就是带时间的承诺，要按时叫醒（审稿第 1 条）
        if kind == "wait":
            t = TIME_RX.search(s)
            if t and PAST.search(s[max(0, t.start() - 4):t.end() + 3]):
                continue
            # "赶在 01:00 之前"是截止时间，不是醒来时间
            if t and not re.match(r"\s*(?:之前|以前|前)", s[t.end():]):
                return "timed"
        if kind == "next" and NEG.search(m.group(0)):  # "我先不跑""我先别动"
            continue
        return kind
    return None


def promises(text):
    """[(类别, 句子)]。"""
    out = []
    for ss in paragraphs(text):
        for s in ss:
            if PROPOSAL.search(s):
                # 问句之后同一段里的话都是在讲这个提议（"要我跑一遍吗？跑完我再告诉你"）
                if QUESTION.search(s):
                    break
                continue
            kind = classify(s)
            if kind:
                out.append((kind, s))
    return out


CN_DIGIT = dict(zip("零一二两三四五六七八九", (0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9)))  # 汉字数字本身的值


def cn_int(x):
    """两/十五/二十三 → 整数。"""
    if "十" in x:
        a, _, b = x.partition("十")
        return (CN_DIGIT.get(a, 1) if a else 1) * 10 + (CN_DIGIT.get(b, 0) if b else 0)
    return CN_DIGIT.get(x, 0)


def clock_targets(s, now):
    """句子里的绝对钟点 → 现在之后最近的那个时刻（"01:18""两点三十五分"）。小于 12 的钟点按上午/下午取最近一个。"""
    out = []
    for g in ABS_RX.findall(s):
        if g[0]:
            h, mi = int(g[0]), int(g[1])
        elif g[2]:
            h, mi = int(g[2]), 30 if g[3] else int(g[4] or 0)  # 半 = 30 分
        else:
            h, mi = cn_int(g[5]), 30 if g[6] else (cn_int(g[7]) if g[7] else 0)  # 半 = 30 分
        if h > 23 or mi > 59:
            continue
        cands = []
        for hh in ({h, h + 12} if h < 12 else {h}):  # 12 小时制换 24 小时制
            for day in (0, 1):
                c = now.replace(hour=hh, minute=mi, second=0, microsecond=0) + timedelta(days=day)
                if c + timedelta(minutes=1) > now:
                    cands.append(c)
        if cands:
            out.append(min(cands))
    return out


NEED = {"timed": "wake", "timed_claim": "wake", "wait": "bg", "next": "dispatch"}


def judge(text, tools, errs=(), prior_fires=(), pending_bg=False, now=None, ctx=None):
    """返回没兑现的 [(类别, 句子)]；空列表 = 放行。
    prior_fires：本会话前几轮的定时器算得出的响铃时刻。只给绝对钟点用：有一个在"现在"到承诺钟点（含那一分钟）之间响，
      就算这轮已有回执（代码审查第 3 条：相对时间"30 分钟后""明早"不豁免）。
    pending_bg：本轮或上一轮启动、还没收到完成通知的后台任务（跑完会叫醒），算"等结果"的回执。"""
    if not text or OPT_OUT.search(QUOTED.sub("", text)):
        return []
    now = now or datetime.now().astimezone()
    have = receipts(tools, set(errs), ctx)
    if MENTION.search(text):
        have.add("dispatch")
    if pending_bg:
        have.add("bg")
    miss = []
    for k, s in promises(text):
        if NEED[k] in have:
            continue
        if k in ("timed", "timed_claim"):
            targets = clock_targets(s, now)
            if targets and any(now <= f < t + timedelta(minutes=1) for t in targets for f in prior_fires):
                continue
        miss.append(("timed" if k == "timed_claim" else k, s))
    return miss


def done_ids(entries):
    """完成通知里的任务 id：用户消息里的 <task-notification>，以及一轮中途到达、记成 attachment/queued_command 的（代码审查第 1 条）。"""
    out = set()
    for e in entries:
        if e.get("type") == "user":
            c = (e.get("message") or {}).get("content")
            out |= set(DONE_ID.findall(c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)))
        elif e.get("type") == "attachment":
            a = e.get("attachment") or {}
            if a.get("type") == "queued_command":
                p = a.get("prompt")
                out |= set(DONE_ID.findall(p if isinstance(p, str) else json.dumps(p, ensure_ascii=False)))
    return out


def launched_ids(entries):
    out = set()
    for e in entries:
        c = (e.get("message") or {}).get("content")
        if e.get("type") == "user" and isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    bc = b.get("content")
                    out |= set(BG_ID.findall(bc if isinstance(bc, str) else json.dumps(bc, ensure_ascii=False)))
    return out


def context(ts, ctx=None):
    """最后一轮的 (prior_fires, pending_bg)。ts = turns() 的结果。
    pending_bg 只看本轮和上一轮启动的后台任务：更早启动、一直没等到完成通知的，多半是 bothouse 重启时被杀了
    （transcript 里看不出来），拿它当回执就会重演"说了回来却没人叫醒"，所以不算。"""
    fires = []
    for head, ents in ts[:-1]:
        _, tools, errs = analyze(ents)
        for t in tools:
            if t.get("id") not in errs:
                fires += fire_times(t, ctx)
    allents = [e for h, es in ts for e in ([h] if h else []) + es]
    recent = [e for h, es in ts[-2:] for e in es]
    pending = launched_ids(recent) - done_ids(allents)
    return fires, bool(pending)


def reason(missing):
    lines = []
    for k, s in missing:
        if k == "timed":
            lines.append(f"「{s}」带时间，但本轮没设会按时叫醒你的定时器（后台 Bash/Agent 挂在会话上，重启就没了，不算）。")
        elif k == "wait":
            lines.append(f"「{s}」要等结果，但没有跑完会叫醒你的东西（定时器、本轮或上一轮启动还没完成的后台 Bash/Agent）。")
        else:
            lines.append(f"「{s}」说了下一步要做，但本轮没派出去（Agent、SendMessage、nohup/后台命令、@ 队友、定时器都没有）。")
    return ("承诺没有回执（用户 2026-10-18：说了会回来看就要真的回来看；2026-10-17 规则：写了下一步的事同一轮就派出去）。\n"
            + "\n".join(lines) +
            "\n现在补上：带时间的设定时器，例如 bothouse timer add --delay 30m --prompt \"回来看 X 的结果并汇报\""
            "（终端会话用 ScheduleWakeup）；下一步的事现在就做，或当轮派给 subagent/队友。"
            "确实不打算跟进的，必须在回复里明说「这件事不跟进，原因是 Y」。")


def main():
    d = json.load(sys.stdin)
    if d.get("stop_hook_active"):
        return
    entries = []
    try:
        for l in open(d.get("transcript_path", ""), encoding="utf-8"):
            try:
                e = json.loads(l)
            except ValueError:
                continue
            if isinstance(e, dict):
                entries.append(e)
    except OSError:
        pass
    ts = turns(entries)
    ctx = ctx_env()
    text, tools, errs = analyze(ts[-1][1]) if ts else ("", [], set())
    fires, pending = context(ts, ctx) if ts else ([], False)
    last = d.get("last_assistant_message")
    if isinstance(last, str) and last:
        text = last
    missing = judge(text, tools, errs, fires, pending, None, ctx)
    if missing:
        print(json.dumps({"decision": "block", "reason": reason(missing)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # hook 自己出错不能卡住回复：静默放行（代码审查第 7 条）
        pass
    sys.exit(0)
