#!/usr/bin/env -S python3 -I
"""同一份产物上的检查互查冲突：一道检查逼着写的那一行，另一道检查会不会把它判死。
用法：rule-conflicts.py [--judge] [--json] [--rules <house-rules.toml>]

总表 ~/wiki/rules/house-rules.toml 的 [[check]] 里，每条强制写内容的检查带 requires（name、re、sample）；
这里把每条 sample 放进一份最小的合格交接，逐条跑该产物上的其它检查，报出「C 逼着写 X，D 判成错」的组合。
新增或改检查时必跑（#1893；用户 11-23「规则统一管理，怎么还会冲突」）。

--judge：把「多出来的设定」判官（要调模型、花钱）也算进互相喂的检查里，默认不算。
只读，不改任何文件；本机没有总表时打一句说明、exit 0。
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

HOUSE_RULES = Path(os.environ.get("HOUSE_RULES") or Path.home() / "wiki" / "rules" / "house-rules.toml")

# 最小合格交接：产品默认三节 + 一行「改」+ 参照实现。各道检查的 sample 放进指定节里（默认范围）。
BASE = ("# 交接：冲突样例\n"
        "## 用户原话\n- [11-23] 用户：「把导出的表格改好」\n"
        "## 总目标\n把导出的表格改好。\n"
        "## 范围\n- 改：导出的表格\n- 不改：别的导出\n"
        "## 参照实现\n- 无（新建）\n")


def registry(path=HOUSE_RULES):
    """总表里 artifact = 交接 且带 requires 的检查：[(id, where, overlay, [(name, sample)])]。"""
    try:
        import tomllib
    except ImportError:  # py3.10 及更早：读不了就不查
        return []
    try:
        cfg = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for c in cfg.get("check", []):
        if c.get("artifact") != "交接":
            continue
        items = []
        for r in c.get("requires", []):
            s = r.get("sample")
            if r.get("judge", True) and s:
                items.append((r.get("name", "?"), [s] if isinstance(s, str) else list(s),
                              r.get("quote"), r.get("goal")))
        if items:
            out.append((c.get("id", "?"), c.get("file", ""), bool(c.get("overlay")), items))
    return out


def _add(text, section, lines_in):
    """把 sample 的几行放进指定的节（没这节就加在末尾）。"""
    out, on, done = [], False, False
    for l in text.splitlines():
        if l.lstrip().startswith("#") and on and not done:
            out += lines_in
            done = True
        out.append(l)
        if l.lstrip().startswith("#") and section in l:
            on, done = True, done  # 进到这一节，下一次遇到标题前插
    if not done:
        out += lines_in
    return "\n".join(out) + "\n"


def _with(text, quote=None, goal=None):
    """样例带了自己的用户原话时，整份样例按那句原话重写（原话、总目标、范围都换成这件事）；
    不然判官只好拿样例的「改：」行跟表格的原话对，报出来的都是样例自己的事，不是两检查打架。"""
    if not quote:
        return text
    return ("# 交接：冲突样例\n## 用户原话\n- [11-23] 用户：「" + quote + "」\n"
            "## 总目标\n" + (goal or quote) + "\n## 范围\n- 不改：无\n## 参照实现\n- 无（新建）\n")


def run(path=HOUSE_RULES, judge=False):
    """返回 (条目数, [冲突])；每条冲突：{from, sample, to, err}。"""
    import _handoff_rules as R
    rules = R.load()
    lead, checks = rules.get("lead", ""), rules["checks"]
    base_errs = {c["id"]: R._check(c, BASE.splitlines(), lead) for c in checks}
    rows = registry(path)
    conflicts = []
    for cid, where, overlay, items in rows:
        for name, sample, quote, goal in items:
            text = _add(_with(BASE, quote, goal), "范围", sample)
            lines = text.splitlines()
            own = next((c for c in checks if c["id"] == cid), None)
            if own is not None and R._check(own, lines, lead):
                conflicts.append({"from": cid, "sample": sample, "to": cid,
                                  "err": f"自己的样例也过不了：{R._check(own, lines, lead).splitlines()[0]}"})
            for c in checks:
                if c["id"] == cid:
                    continue
                err = R._check(c, lines, lead)
                if err and not base_errs.get(c["id"]):
                    conflicts.append({"from": cid, "sample": sample, "to": c["id"],
                                      "err": err.splitlines()[0][:160]})
            if judge:
                import _added_judge
                r = _added_judge.judge(text)
                for a in r["added"]:
                    conflicts.append({"from": cid, "sample": sample, "to": "added_judge",
                                      "err": f"{a.get('what', '')}（{a.get('why', '')}）"[:160]})
    return len(rows), conflicts


def main(argv):
    path = HOUSE_RULES
    if "--rules" in argv:
        path = Path(argv[argv.index("--rules") + 1])
    n, conflicts = run(path, judge="--judge" in argv)
    if "--json" in argv:
        print(json.dumps({"registered": n, "conflicts": conflicts}, ensure_ascii=False, indent=1))
        return 1 if conflicts else 0
    if not n:
        print(f"没有可互查的登记（{path} 里没有 artifact = 交接 的 [[check]] 带 requires.sample）")
        return 0
    print(f"{n} 道交接检查互相喂样例：{len(conflicts)} 组冲突")
    for c in conflicts:
        print(f"- {c['from']} 逼着写「{' / '.join(c['sample'])}」，{c['to']} 判成错：{c['err']}")
    if conflicts:
        print("处理：把互相否定的那两处改成不打架（放宽判死的检查、或把强制行改成判官认得的登记），再跑一遍。")
    return 1 if conflicts else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
