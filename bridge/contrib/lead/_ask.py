"""工作区提问（ws-up --ask）的固定格式：问题 / 背景 / 选项与推荐 / 自验，自验放最后。

提问原文只存一份（任务板目录 asks/<任务编号>.md，board.ask_save），任务板行只留短标题和去向；
任务帖、团队板、给主角色的提示、转给用户的话都读这一份，不各自截字。
ws-up 用 parse 检查并排成固定顺序，ws-forward --ask-user 用 to_user 拼转给用户的那条。
转给用户的是主角色改写的大白话（plain_problems 检查），不是工作区原文；桥内部问题（internal）不转用户。
用户 11-20「怎么你们两个傻逼都不说人话，根本看不懂」「以后规避这种问题」（#1827）。
"""
import re

ORDER = ("问题", "背景", "选项与推荐", "自验")
# 行首的节名（前面可带 #、-、*、> 和【】）；「选项」「推荐」分开写的并进「选项与推荐」
_HEAD = re.compile(r"^[\s#>*\-]*[【\[]?\s*(问题|背景|选项与推荐|选项|推荐|自验)\s*[】\]]?\s*[:：]\s*(.*)$")
KINDS = ("方向", "花钱", "成品", "权限")  # 团队规矩：只有这四类转给用户，其余主角色定
EXAMPLE = ("问题：<一句话，要定什么>\n背景：<为什么卡在这、和用户原话的关系>\n"
           "选项与推荐：\n- A …\n- B …\n推荐：A，因为…\n自验：<证据：命令输出或截图路径；没有写无>")


def parse(text):
    """返回 (各节正文 dict, 问题清单)。第一个节名之前的话并进背景。"""
    sec = {k: [] for k in ORDER}
    lead, cur, has_rec = [], None, False
    for ln in str(text).splitlines():
        m = _HEAD.match(ln)
        if not m:
            (sec[cur] if cur else lead).append(ln.rstrip())
            continue
        name, rest = m.group(1), m.group(2).strip()
        if name == "推荐":
            has_rec = True
            cur, rest = "选项与推荐", f"推荐：{rest}"
        else:
            cur = "选项与推荐" if name == "选项" else name
        if rest:
            sec[cur].append(rest)
    out = {k: "\n".join(v).strip() for k, v in sec.items()}
    if "\n".join(lead).strip():
        out["背景"] = ("\n".join(lead).strip() + "\n" + out["背景"]).strip()
    problems = []
    if not out["问题"]:
        problems.append("缺「问题：」（一句话写清要定什么）")
    if not (has_rec or "推荐" in out["选项与推荐"]):
        problems.append("缺「推荐」（在「选项与推荐：」里写明推荐哪个、为什么）")
    return out, problems


def render(sec):
    """固定顺序的整份原文：问题、背景、选项与推荐、自验；空的节不写。"""
    out = []
    for k in ORDER:
        body = (sec.get(k) or "").strip()
        if body:
            out.append(f"{k}：{body}" if "\n" not in body else f"{k}：\n{body}")
    return "\n".join(out)


def title(sec):
    """短标题：「问题」的第一行，原样不截（整份原文另存）。"""
    return " ".join(((sec.get("问题") or "").splitlines() or [""])[0].split())


# 桥内部问题：任务状态转不过去、交回被桥拒。这类主角色自己处理（恢复任务状态再让工作区交回），不问用户。
_INTERNAL = re.compile(r"transition not allowed|workspace exit|team task|被桥拒|交回状态|任务状态|可交回")


def internal(text):
    """提问是桥内部问题时返回命中的那句，否则空串。"""
    m = _INTERNAL.search(str(text))
    return m.group(0) if m else ""


PLAIN_MAX = 300  # 转给用户的话最多这么多字
PLAIN_LINE_MAX = 60  # 每行最多这么多字（用户 11-23 要拆分）
# 内部状态词：用户看不懂，出现一个就拒
_STATE_WORDS = ("paused", "failed", "transition", "session", "acp", "workspace", "handoff", "board", "timer", "cron",
                "report", "exit", "token", "hook", "stderr", "stdout", "error", "json", "pid", "allowed", "dispatched",
                "returned", "status", "commit", "merge", "branch", "log")
_PLAIN_CHECKS = (
    (re.compile(r"`"), "代码"),
    (re.compile(r"(?:~|\.{0,2})/[\w.\-]+|[\w\-]+\.(?:md|py|go|json|toml|log|sh|txt|jsonl|yml|yaml|js|mjs|ts)\b"), "路径或文件名"),
    (re.compile(r"\b[A-Za-z]+(?:[_\-][A-Za-z0-9]+)+\b|\b[a-z]+[A-Z]\w*\b"), "代码里的名字"),
    (re.compile(r"[A-Za-z]{2,}\s+[A-Za-z]{2,}"), "英文句子或报错"),
    (re.compile(r"→|->"), "状态箭头"),
)


def plain_problems(text):
    """主角色转给用户的大白话有哪些不合格：带代码、路径、英文报错、内部状态词，超字数，或没写推荐。合格返回空列表。"""
    t = str(text).strip()
    out = []
    if not t:
        return ["没写要转给用户的话"]
    if len(t) > PLAIN_MAX:
        out.append(f"太长（{len(t)} 字，最多 {PLAIN_MAX} 字）")
    for rx, what in _PLAIN_CHECKS:
        m = rx.search(t)
        if m:
            out.append(f"带{what}「{m.group(0).strip()}」")
    words = [w for w in re.findall(r"[A-Za-z]+", t) if w.lower() in _STATE_WORDS]
    if words:
        out.append(f"带内部状态词「{'、'.join(dict.fromkeys(words))}」")
    if "推荐" not in t:
        out.append("没写推荐哪个")
    # 用户 11-23「你能不能拆分，一坨看不懂，之后也要拆分」：一行一件事，选项各占一行
    lines = [l for l in t.splitlines() if l.strip()]
    if len(lines) < 3:
        out.append("没拆分（写成几行：卡在哪一行，每个做法各一行，推荐一行）")
    long = [l for l in lines if len(l.strip()) > PLAIN_LINE_MAX]
    if long:
        out.append(f"有一行太长（{len(long[0].strip())} 字，每行最多 {PLAIN_LINE_MAX} 字，一行只说一件事）")
    return out


def to_user(short, kind, text, post=""):
    """主角色转给用户的那条：她改写、过了 plain_problems 的大白话。"""
    foot = "-# 直接回这条就行，我转回工作区" + (f"；任务帖 {post}" if post else "")
    return f"❓ 要你定（{kind}）· {short}\n{text.strip()}\n{foot}"
