# #1943 读材料的活交回要逐条写内容：交接「用户原话」里有 2 个及以上链接/BV 号时，
# 交回草稿要有「材料逐条：」一块，每行「- <来源名>：<讲了什么、和我们什么关系>」，行数不少于链接数。
# 用户 11-24「那你告诉他们在看什么东西啊？」「怎么避免以后再出现这种问题」；#1929 交回只报过程、内容全留在笔记里。
import re
from pathlib import Path

URL = re.compile(r"https?://[^\s」）)>\]]+")
BV = re.compile(r"BV[0-9A-Za-z]{10}")
HEAD = re.compile(r"^\s*材料逐条\s*[:：]?\s*$")
ITEM = re.compile(r"^\s*(?:[-*]|\d+[.、)）])\s*([^:：\n]{1,40})[:：]\s*(.+)$")
MIN_BODY = 20  # 「- 知乎：看了」这类空行不算


def quotes(notes_text):
    """标题含「原话」的节（程序附的「原话出处」除外）拼起来。"""
    out, keep = [], False
    for line in notes_text.splitlines():
        if line.startswith("## "):
            keep = "原话" in line and "原话出处" not in line
            continue
        if keep:
            out.append(line)
    return "\n".join(out)


def sources(text):
    """去重后的来源：BV 号按号算一次（链接里带 BV 的不另算），其余链接各算一个。"""
    seen = set(BV.findall(text))
    for u in URL.findall(text):
        if not BV.search(u):
            seen.add(u.rstrip("。，,."))
    return sorted(seen)


def items(report_text):
    """「材料逐条：」下面连续的条目行（空行或下一个「xx：」标题行结束）。"""
    rows, inside = [], False
    for line in report_text.splitlines():
        if HEAD.match(line):
            inside = True
            continue
        if not inside:
            continue
        m = ITEM.match(line)
        if m:
            if len(m.group(2).strip()) >= MIN_BODY:
                rows.append(m.group(1).strip())
            continue
        if line.strip():
            break
    return rows


def report_block(notes_path, draft_path):
    try:
        notes = Path(notes_path).read_text(encoding="utf-8")
        draft = Path(draft_path).read_text(encoding="utf-8")
    except OSError:
        return ""
    src = sources(quotes(notes))
    if len(src) < 2:
        return ""
    got = items(draft)
    if len(got) >= len(src):
        return ""
    return (f"这是读材料的活：交接用户原话里有 {len(src)} 个链接/BV 号（{'、'.join(src)}），"
            f"交回只写了 {len(got)} 条内容。在细节里加一块「材料逐条：」，下面每个来源一行"
            f"「- <来源名>：<讲了什么、和我们什么关系>」（每条至少 {MIN_BODY} 字），不少于 {len(src)} 行再交。"
            "这块放行时会原样贴进聊天频道正文给用户看（不进子话题），写成用户直接能读的话。只写「看完了、写了拆解」不算。")
