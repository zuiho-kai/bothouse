#!/usr/bin/env python3
"""PreToolUse(Edit|Write|MultiEdit)：代码里新加的「名字 = 数字」（上限、阈值、窗口、网格……）必须在同一行或上一行注释写来源，
否则拒绝这次编辑。来源 = 用户原话、数据/实测、SPEC、沿用已有配置；写不出来源就是自己编的，删掉或列出来问用户。
出处：作者记录的同类错误「自定无依据的数字/设定」（2026-10-15 第 4 次：记忆上限 40 条）；
「必须有的数字在代码注释写来源」这条规则只靠自觉没管住，改成 hook。
只查新增行；0、1、-1 和测试文件不查。subagent 的编辑同样经过这里。"""
import json, os, re, sys

CODE = (".py", ".go", ".ts", ".tsx", ".js", ".mjs", ".rs", ".swift", ".yaml", ".yml", ".toml", ".sh")
NUM = r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?"
# x = 40 / x: int = 40 / x := 40 / f(max_mem=40) / "limit": 40 / limit: 40（yaml）；排除 == <= >= !=
ASSIGN = re.compile(r"""(?:^|[\s,({])["']?([A-Za-z_][\w.]*)["']?\s*(?::\s*[\w\[\]., |]+?\s*)?(?::=|(?<![=<>!:])=(?!=)|:)\s*(""" + NUM + r""")\s*(?:[,)}\]#;/]|$)""")
SOURCE = re.compile(r"来源|原话|用户|实测|数据|SPEC|source|沿用", re.I)
TRIVIAL = {"0", "1", "-1", "0.0", "1.0"}
# 运行层/事实常量，不是策略参数：超时、钟点（如开盘 9:30）、端口、缩进
SKIP_KEYS = {"timeout", "hour", "minute", "second", "port", "indent", "max_retries", "maxsplit"}


def added_lines(tool, inp):
    if tool == "Write":
        return inp.get("content", "").splitlines()
    edits = inp.get("edits") if tool == "MultiEdit" else [inp]
    out = []
    for e in edits or []:
        old = set(e.get("old_string", "").splitlines())
        out += [l for l in e.get("new_string", "").splitlines() if l not in old]
    return out


def offenders(lines):
    bad, prev = [], ""
    for line in lines:
        s = line.strip()
        if s and not s.startswith(("#", "//")):
            nums = [m.group(2) for m in ASSIGN.finditer(s) if m.group(2) not in TRIVIAL and m.group(1).split(".")[-1].lower() not in SKIP_KEYS]
            if nums and not SOURCE.search(s) and not SOURCE.search(prev):
                bad.append(s[:120])
        prev = s
    return bad


def main():
    d = json.load(sys.stdin)
    tool, inp = d.get("tool_name", ""), d.get("tool_input") or {}
    path = inp.get("file_path", "")
    name = os.path.basename(path)
    if not path.endswith(CODE) or "test" in name or "/tests/" in path:
        return
    bad = offenders(added_lines(tool, inp))
    if not bad:
        return
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason":
            "新增数字没写来源（规则：用户没要的参数不先做，必须有的数字注释写来源）：\n  " + "\n  ".join(bad) +
            "\n每个数字在同一行或上一行注释写来源：用户原话 / 数据或实测 / SPEC / 沿用已有配置。"
            "写不出来源就是自己定的：删掉这个参数（不设上限/不加门槛），或停下来列给用户问，不许编理由。"}},
        ensure_ascii=False))


if __name__ == "__main__":
    main()
