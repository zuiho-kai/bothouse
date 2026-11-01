"""PreToolUse(Agent/Task)：派子 agent 时按关键词附上代码地图，免得每个子 agent 从头读代码。

地图放地图目录（环境变量 CODEMAP_DIR，默认 bothouse 数据目录下的 codemaps/，即本脚本所在 hooks/ 的上一级），
每张 <名>.md 里一行以 `keywords:` 开头写触发词（逗号分隔）；没有这一行的 .md（如 README.md）不参与选图。
命中就在 prompt 前加一句「先读地图、交付附地图要补的条目」，子 agent 交付后由 codemap-fill.py 把条目补回地图。

选图：先去掉路径和网址再匹配（派活说明常带交接文件路径，路径里的词会让无关的活也附上地图）。
去掉后要命中至少 2 个不同的词才附；keywords 只写了 1 个词的地图命中 1 个即可。prompt 里已写了地图路径的不重复附。
出错一律放行。"""
import json
import os
import re
import sys

PATHISH = re.compile(r"https?://\S+|[\w.@~+-]*(?:/[\w.@~+*-]+)+/?")

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_DIR = os.path.realpath(os.path.expanduser(os.environ.get("CODEMAP_DIR") or os.path.join(os.path.dirname(HERE), "codemaps")))


def maps():
    out = []
    for name in sorted(os.listdir(MAP_DIR)) if os.path.isdir(MAP_DIR) else []:
        if not name.endswith(".md"):
            continue
        path = os.path.join(MAP_DIR, name)
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.startswith("keywords:"):
                    words = [w.strip().lower() for w in line[9:].split(",") if w.strip()]
                    out.append((path, words))
                    break
    return out


def strip_paths(text):
    return PATHISH.sub(" ", text or "")


def pick(prompt):
    low = strip_paths(prompt).lower()
    out = []
    for p, words in maps():
        if p in prompt:
            continue
        n = sum(1 for w in set(words) if w in low)
        if n >= min(2, len(set(words))):
            out.append(p)
    return out


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        return
    if d.get("tool_name") not in ("Agent", "Task"):
        return
    ti = d.get("tool_input") or {}
    key = "message" if d.get("hook_cli") == "codex" and "message" in ti else "prompt"
    prompt = ti.get(key) or ""
    try:
        hits = pick(prompt)
    except OSError:
        return
    if not hits:
        return
    note = "".join(
        f"【代码地图】先读 {p}，按里面的符号直接定位，不要从头摸代码；交付时附一节「## 地图要补的条目（{p}）」，下面每条一行「- 符号 文件:行」（会自动补进地图）。\n" for p in hits
    )
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "updatedInput": {**ti, key: note + prompt},
    }}, ensure_ascii=False))


if __name__ == "__main__":
    main()
