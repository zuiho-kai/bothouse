"""工作区提问（ws-up --ask）的固定格式：问题 / 背景 / 选项与推荐 / 自验，自验放最后。

提问原文只存一份（任务板目录 asks/<任务编号>.md，board.ask_save），任务板行只留短标题和去向；
任务帖、团队板、给主角色的提示、转给用户的话都读这一份，不各自截字。
ws-up 用 parse 检查并排成固定顺序，ws-forward --ask-user 用 to_user 拼转给用户的那条。
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


def to_user(short, kind, text, post=""):
    """主角色转给用户的那条：整份原文原样带上，不摘要。"""
    foot = "-# 直接回这条就行，我转回工作区" + (f"；任务帖 {post}" if post else "")
    return f"❓ 要你定（{kind}）· {short}\n{text.strip()}\n{foot}"
