#!/usr/bin/env python3
"""Artifact acceptance sheets: record requirements and check the current file before delivery.

  python3 accept.py add   <task> "<requirement>" ["<requirement>" ...]
  python3 accept.py show  <task>
  python3 accept.py list
  python3 accept.py check <task> <file> "<evidence for item 1>" "<evidence for item 2>" ...
  python3 accept.py skip  <file> "<reason this file is unrelated to open sheets>"
  python3 accept.py done  <task>

Sheets live in <role>/notes/accept. Select a role with --role <dir>, the current
CC_PROJECT, or the nearest role directory. deliver-check.py consumes these sheets.
"""
import hashlib
import json
import os
import sys
import tempfile
import time

SKIPS = ".skips.json"


def now():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def role_dir(explicit=None, cwd=None):
    if explicit:
        return os.path.abspath(os.path.expanduser(explicit))
    proj = os.environ.get("CC_PROJECT")
    if proj:
        d = os.path.join(os.path.expanduser("~/.bothouse/roles"), proj)
        if os.path.isdir(d):
            return d
    d = os.path.abspath(cwd or os.getcwd())
    probe = d
    while True:
        if os.path.isfile(os.path.join(probe, ".claude", "settings.json")) or os.path.isdir(os.path.join(probe, "notes")):
            return probe
        up = os.path.dirname(probe)
        if up == probe:
            return d
        probe = up


def sheet_dir(role):
    return os.path.join(role, "notes", "accept")


def safe(name):
    name = name.strip().replace("/", "／").replace("\\", "＼")
    return name.lstrip(".") or "_"


def sheet_path(role, name):
    return os.path.join(sheet_dir(role), safe(name) + ".json")


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def save(path, d):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    d["updated"] = now()
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(path))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def open_sheets(role):
    """开着（没 accept done）且有条目的单子。"""
    out = []
    try:
        names = sorted(os.listdir(sheet_dir(role)))
    except OSError:
        return out
    for n in names:
        if not n.endswith(".json") or n.startswith("."):
            continue
        p = os.path.join(sheet_dir(role), n)
        d = load(p)
        if not d or d.get("closed") or not d.get("items"):
            continue
        d["_path"] = p
        out.append(d)
    return out


def covered(role, file_path, digest=None):
    """file_path（当前内容）已对照过某张开着的单子的全部条目，或登记过不属于任何单子：返回说明；否则 None。"""
    digest = digest or sha(file_path)
    for d in open_sheets(role):
        n = len(d["items"])
        for c in reversed(d.get("checks") or []):
            if c.get("sha256") == digest and c.get("items") == n:
                return "已对照验收单「%s」全部 %d 条" % (d["name"], n)
    for s in (load(os.path.join(sheet_dir(role), SKIPS)) or {}).get("skips") or []:
        if s.get("sha256") == digest:
            return "已登记不属于任何验收单：" + s.get("reason", "")
    return None


def render(d):
    lines = ["验收单「%s」（%d 条，建于 %s）" % (d["name"], len(d["items"]), d.get("created", ""))]
    for it in d["items"]:
        lines.append("  %d. %s   （%s 记）" % (it["n"], it["text"], it.get("added", "")))
    checks = d.get("checks") or []
    if checks:
        c = checks[-1]
        lines.append("  最近一次对照：%s  %s（当时 %d 条）" % (c.get("time"), c.get("file"), c.get("items", 0)))
    if d.get("closed"):
        lines.append("  已关单：" + d["closed"])
    return "\n".join(lines)


def die(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(1)


def main(argv):
    role = None
    if "--role" in argv:
        i = argv.index("--role")
        if i + 1 >= len(argv):
            die("--role 后面要跟角色目录")
        role = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    role = role_dir(role)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    if cmd == "list":
        ss = open_sheets(role)
        if not ss:
            print("没有开着的验收单（%s）" % sheet_dir(role))
        for d in ss:
            print(render(d))
        return
    if cmd == "skip":
        if len(args) < 2 or not " ".join(args[1:]).strip():
            die('用法：accept skip <成品文件> "<为什么不属于任何验收单>"')
        f = os.path.abspath(os.path.expanduser(args[0]))
        if not os.path.isfile(f):
            die("找不到文件：" + f)
        p = os.path.join(sheet_dir(role), SKIPS)
        d = load(p) or {"name": SKIPS, "skips": []}
        d.setdefault("skips", []).append({"file": f, "sha256": sha(f), "reason": " ".join(args[1:]).strip(), "time": now()})
        save(p, d)
        print("已登记：%s 不属于任何验收单" % f)
        return
    if not args or not args[0].strip():
        die("要写活名：accept %s <活名> ..." % cmd)
    name, rest = args[0].strip(), args[1:]
    p = sheet_path(role, name)
    d = load(p)
    if cmd == "add":
        texts = [t.strip() for t in rest if t.strip()]
        if not texts:
            die('用法：accept add <活名> "<用户原话>"')
        if not d:
            d = {"name": name, "created": now(), "closed": None, "items": [], "checks": []}
        if d.get("closed"):
            d["closed"] = None  # 关了又来新要求：重新打开
        for t in texts:
            d["items"].append({"n": len(d["items"]) + 1, "text": t, "added": now()})
        save(p, d)
        print(render(d))
        return
    if not d:
        die("没有这张验收单：%s（先 accept add %s \"<用户原话>\"）" % (name, name))
    if cmd == "show":
        print(render(d))
        return
    if cmd == "done":
        d["closed"] = now()
        save(p, d)
        print("已关单：" + name)
        return
    if cmd == "check":
        if not rest:
            die('用法：accept check <活名> <成品文件> "<第1条怎么对上的>" ...')
        f = os.path.abspath(os.path.expanduser(rest[0]))
        if not os.path.isfile(f):
            die("找不到成品文件：" + f)
        notes = [t.strip() for t in rest[1:]]
        n = len(d["items"])
        if len(notes) != n or not all(notes):
            die(render(d) + "\n\n要逐条对照：这张单子有 %d 条，你写了 %d 句（空的不算）。每条一句，按顺序写看成品时它怎么对上的；"
                "对不上就先改成品，不要写「对」。" % (n, len([x for x in notes if x])))
        d.setdefault("checks", []).append({"time": now(), "file": f, "sha256": sha(f), "items": n,
                                           "notes": {str(i + 1): t for i, t in enumerate(notes)}})
        save(p, d)
        print(render(d))
        print("\n逐条对照已记下：")
        for it, t in zip(d["items"], notes):
            print("  %d. %s\n     → %s" % (it["n"], it["text"], t))
        return
    die("不认识的子命令：%s（add/show/list/check/skip/done）" % cmd)


if __name__ == "__main__":
    main(sys.argv[1:])
