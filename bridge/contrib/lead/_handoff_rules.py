# 交接校验：按 handoff-rules.json（同目录，唯一一份规则）查交接正文。ws-handoff 用它；DSH collab 用同一份规则的
# Node 实现（dsh/collab/handoff-rules.mjs），两边由 test_handoff_rules.py 用同一组 fixture 比对。
# 这里不写任何小节名、正则或报错文案，全在规则文件里；规则文件读不到就报错，不放行。
import json, re
from pathlib import Path

RULES = Path(__file__).resolve().parent / "handoff-rules.json"


def load(path=RULES):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        raise RuntimeError(f"交接规则文件读不到：{path}（{e}）") from e


def _head(line):
    return line.lstrip().startswith("#")


def _sections(lines, name, lead, inline=False):
    """每一处「name」节：标题含 name（inline 时还有去掉 lead 后以 name 开头的行）起，到下一个标题前，含起始行。"""
    out = []
    for i, l in enumerate(lines):
        if not ((_head(l) and name in l) or (inline and l.lstrip(lead).startswith(name))):
            continue
        seg = [l]
        for x in lines[i + 1:]:
            if _head(x):
                break
            seg.append(x)
        out.append(seg)
    return out


def _missing(c, names):
    return c["msg"].replace("{missing}", c.get("sep", "、").join(c.get("item", "{}").replace("{}", n) for n in names))


def _check(c, lines, lead, key="msg"):
    t = c["type"]
    if t == "headings":
        miss = [n for n in c["names"] if not any(_head(l) and n in l for l in lines)]
        return _missing(c, miss) if miss else None
    if t == "ref":
        none, ref, path = re.compile(c["none_re"]), re.compile(c["ref_re"]), re.compile(c["path_re"])
        for seg in _sections(lines, c["section"], lead, c.get("inline", False)):
            if any(none.search(x) for x in seg):
                return None
            if any(path.search(m.group(0).rsplit(":", 1)[0]) for x in seg for m in ref.finditer(x)):
                return None
        return c[key]
    if t == "kinds":
        rx = re.compile(c["line_re"])
        found = [m.group(1) for seg in _sections(lines, c["section"], lead) for x in seg[1:]
                 for m in [rx.search(x.lstrip(lead))] if m]
        got = set(found)
        mx = c.get("max")  # 某一种行超过上限就拆开派（10-30 三个子 agent 因一件管 10 多项停半路）
        if mx and found.count(mx["kind"]) > mx["n"]:
            return mx["msg"].replace("{n}", str(found.count(mx["kind"])))
        miss = [k for k in c["need"] if k not in got]
        return _missing(c, miss) if miss else None
    if t == "values":
        rx, ok, alt = re.compile(c["line_re"]), re.compile(c["ok_re"]), re.compile(c["or_re"])
        vals = [m.group(1).strip() for seg in _sections(lines, c["section"], lead) for x in seg[1:]
                for m in [rx.search(x.lstrip(lead))] if m]
        if not vals:
            return c["msg"]
        if any(not ok.search(v) and not alt.search(v) for v in vals):
            return c["bad_msg"]
        return None
    if t == "heading_needs_field":
        if not any(_head(l) and any(h in l for h in c["headings"]) for l in lines):
            return None
        rx = re.compile("^" + re.escape(c["field"]) + r"\s*[:：]\s*\S")
        return None if any(rx.search(l.lstrip(lead)) for l in lines) else c[key]
    if t == "art_ref":
        trig = re.compile(c["trigger_re"])
        if not any(trig.search(x) for s in c["trigger_sections"] for seg in _sections(lines, s, lead) for x in seg):
            return None
        code = re.compile(c["code_line_re"])
        if any(code.search(x.lstrip(lead)) for seg in _sections(lines, c["code_section"], lead) for x in seg[1:]):
            return None  # 范围「改」的是代码文件：改出图相关代码的活，不是出图活
        img = re.compile(c["image_re"])
        refs = {m.group(0) for seg in _sections(lines, c["section"], lead, c.get("inline", False)) for x in seg
                for m in img.finditer(x)}
        if len(refs) < c["min"]:
            return c["msg"].replace("{min}", str(c["min"])).replace("{n}", str(len(refs)))
        if re.search(c["original_re"], text_of(lines)) and not re.search(c["sample_re"], text_of(lines)):
            return c["original_msg"]
        return None
    if t == "section_needs_table":  # 某节正文命中触发词和对象时，另一节要有 N 行对照和必备项（11-01 范本只抄了骨架）
        body = "\n".join(x for s in _sections(lines, c["trigger_section"], lead) for x in s[1:])
        if not (re.search(c["trigger_re"], body) and re.search(c["object_re"], body)):
            return None
        row = re.compile(c["row_re"])
        for seg in _sections(lines, c["section"], lead):
            text = "\n".join(seg[1:])
            if (sum(bool(row.search(x.lstrip(lead))) for x in seg[1:]) >= c["rows"]
                    and all(re.search(r, text) for r in c["need_res"])):
                return None
        return c[key]
    if t == "forbid":  # 整份交接里不许出现的写法（11-01 工作区找上一棒的 /tmp 脚本找不到）
        rx = re.compile(c["re"])
        return c[key] if any(rx.search(x) for x in lines) else None
    if t == "needs_if":  # 正文命中 trigger_re 时，正文还要命中 need_re（浏览器活要写标签页 id）
        text = text_of(lines)
        return c[key] if re.search(c["trigger_re"], text) and not re.search(c["need_re"], text) else None
    raise RuntimeError(f"交接规则文件里有不认识的检查类型：{t}")


def text_of(lines):
    return "\n".join(lines)


def check(text, rules=None):
    """交接正文不合格时返回报错文字（含要补什么和示例），合格返回 None。"""
    rules = rules or load()
    lines, lead = text.splitlines(), rules["lead"]
    for c in rules["checks"]:
        err = _check(c, lines, lead)
        if err:
            return err
    return None
