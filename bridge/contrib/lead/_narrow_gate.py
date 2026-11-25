"""交活时拦住没有用户原话撑着的缩范围句（#1999）。

起因：11-25 #1996 橘的交接范围写「改：无（本活只评，不改稿）」，用户原话里没有「只评」「不改」；工作区照着只评不改，
主角色照交接放行关单，用户「我让你自己根据意见迭代，你没迭代，直接停了」。用户批了「交活工具拦住任务说明里没有用户原话
撑着的"只评、不改"这类话」。

认法：主角色手写的行（标题带「原话」「程序」的节、交回骨架、代码块之外）里出现缩范围的说法，就要在用户原话节里找到同一个
说法，或这行用「」引的原话本身在用户原话节里、引号里就有这个说法；都没有就退回。「不改：某某」这种列出不碰哪块的行不查：
它划的是改动边界，不是把用户要的结果砍掉。
"""
import re

# 缩范围的说法。「改：无」单列：它本身没有可在原话里对的字，原话里有任何一种缩范围的说法才算有撑腰。
NARROW = re.compile(
    r"只(?:评|看看|查|问|列|报|测|审|收集|汇总|出方案|给方案|做方案|要方案|写方案|调研)(?!.{0,1}(?:完|好|到))"
    r"|(?:不|别|先别|先不|不要|不用|不必)(?:迭代|往下做|改稿|动手|返工)"
    r"|先不(?:做|改)"
    r"|停在(?:这|此|评|方案)|到此为止"
)
# 「改：无代码改动」只说不碰代码（调研、拆解类），不算砍结果；「改：无（只评）」才算
SCOPE_NONE = re.compile(r"^\s*[-*]?\s*改\s*[:：]\s*无(?!\s*(?:代码|仓库|程序))")
# 前面带否定的是在反着说（「不要只评不改」）
NEGATED = re.compile(r"(?:不要|不能|不许|别|不是|不再|并非|而不是)\s*$")
# 只出方案这类：本机守则 R-act「只问为什么、说先给方案或看看的，只查、回答、出方案」，原话里有这些就有撑腰
PLAN = re.compile(r"方案|调研|动手")
PLAN_USER = re.compile(r"方案|思考|想一下|想想|看看|看一下|学一下|为什么|先别|别做|调研|研究")
# 根因链、现象描述（「现象→为什么」）讲的是程序原来怎么做，不是给工作区划范围
ANALYSIS = re.compile(r"→|现象|为什么|根因")
# 带时刻的追加记录（到点重试、兜底检查、「11-24 15:48 主角色的话」）是后来程序或看门写的，不是交活时的范围
STAMPED = re.compile(r"^\s*[-*]?\s*(?:20\d\d-)?\d\d-\d\d \d\d:\d\d")
# 删东西、发到外面、花钱先问用户是硬规矩 R-ask，「先只报、不删」这类有撑腰
ASK_RULE = re.compile(r"删|发到外面|对外发|花钱|真钱|ws-up --ask")
# 引号里的是引别人的话或旧文，不是这句在下指令
QUOTED = re.compile(r"「[^」]*」|“[^”]*”|\"[^\"]*\"")
SKIP_LINE = re.compile(r"^\s*[-*]?\s*不改\s*[:：]")  # 「不改：X」划边界，不查
QUOTE = re.compile(r"「([^」]+)」")


def _user_text(text):
    """用户原话：标题带「原话」的节（不含「原话出处」这种程序附的节）的全部文字。"""
    out, on = [], False
    for l in text.splitlines():
        m = re.match(r"\s*(#+)\s*(.*)$", l)
        if m and not re.match(r"\s*#\d", l):
            t = m.group(2)
            on = "原话" in t and "程序" not in t and "主角色" not in t
            continue
        if on:
            out.append(l)
    return re.sub(r"\s+", "", "\n".join(out))


def _lead_lines(text):
    """主角色手写的行：(行号, 行)。跳过用户原话节、程序附的节、交回骨架和代码块。"""
    on, fence = True, False
    for i, l in enumerate(text.splitlines(), 1):
        if l.lstrip().startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        m = re.match(r"\s*(#+)\s*(.*)$", l)
        if m and not re.match(r"\s*#\d", l):
            t = m.group(2)
            on = not (("原话" in t and "主角色" not in t) or "程序" in t or t.startswith(("交回骨架", "旧定案", "模型")))
            continue
        if on and "程序附" not in l:
            yield i, l


def problems(text):
    """没撑腰的缩范围句 [(行号, 行, 说法)]；都有撑腰返回 []。"""
    user = _user_text(text)
    user_narrow = bool(NARROW.search(user))
    bad = []
    for i, l in _lead_lines(text):
        if SKIP_LINE.match(l):
            continue
        if ANALYSIS.search(l) or STAMPED.match(l) or ASK_RULE.search(l):
            continue
        quoted = [q for q in QUOTE.findall(l) if re.sub(r"\s+", "", q) in user]
        if SCOPE_NONE.match(l) and not user_narrow:
            bad.append((i, l.strip(), "改：无"))
            continue
        bare = QUOTED.sub(lambda m: "　" * len(m.group(0)), l)
        for m in NARROW.finditer(bare):
            w = m.group(0)
            if NEGATED.search(bare[:m.start()][-6:]):
                continue
            if w in user or any(w in q for q in quoted) or (PLAN.search(w) and PLAN_USER.search(user)):
                continue
            bad.append((i, l.strip(), w))
            break
    return bad


def check(text):
    """有没撑腰的缩范围句返回报错文字，没有返回 None。"""
    bad = problems(text)
    if not bad:
        return None
    rows = "\n".join(f"  第 {i} 行「{w}」：{l[:120]}" for i, l, w in bad[:8])
    return ("交接里有缩小用户要的范围的话，用户原话里找不到对应的话（#1999：11-25 交接写「只评，不改稿」，"
            "用户要的是根据意见迭代，工作区照交接停了）：\n" + rows +
            "\n改法二选一：用户真这么说过，就把那句原话原样补进「用户原话」节（或在这行用「」引出原话）；"
            "没说过就删掉这句，做到哪由工作区照用户原话定。")
