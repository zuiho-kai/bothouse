#!/usr/bin/env -S python3 -I
"""SubagentStop / Stop：把子 agent 回报（或主会话这一轮的最后回复；工作区交回走 ws-up --report 的草稿文件，由 ws-up 调本脚本 --source）里「## 地图要补的条目（<地图路径>）」一节的条目追加到代码地图末尾
（codemap-inject.py 派活时要求子 agent 交付附这一节）。

用法：
  codemap-fill.py                           hook（run.py 调用；stdin 是 hook JSON，带 hook_event_name）
  codemap-fill.py --hook                    同上
  codemap-fill.py --source <来源> [文件|-]   手动：从文件或 stdin 读回报正文
规则：
  - 只认地图路径落在地图目录（CODEMAP_DIR，默认 bothouse 数据目录下的 codemaps/，同 codemap-inject.py）下、已存在的 .md，其余跳过。
  - 「无…」「本次…」开头的不算条目，跳过。
  - 条目与地图里已有的「- 」行（空白归一后）相同就不再写。
  - 同符号同文件的旧条目直接换成新的（行号跟着更新），不留两条。
  - 新条目插在地图里同目录最深的那组条目后面；一条同目录的都没有，放进末尾「## 待归类」节。
  - 不再按日期追加「## 自动补」节（11-27：按日期追加把地图堆到 2750 行，大半重复和过时）。
  - 任何错误只写 stderr，退出码 0，不挡回报。
"""
import json
import os
import re
import sys

HEAD = re.compile(r"^#{1,6}\s*地图要补的条目\s*[（(]\s*`?([^`）)]+?)`?\s*[）)]\s*$")
BULLET = re.compile(r"^[-*]\s+(.*\S)\s*$")
# 「无（本次没碰代码）」这类不是条目：不过滤会把地图塞满空话，每个子 agent 读地图都要读一遍
NONE = re.compile(r"^[（(]?\s*(无|没有|本次|这次|本任务)")


HERE = os.path.dirname(os.path.abspath(__file__))


def map_dir():
    return os.path.realpath(os.path.expanduser(os.environ.get("CODEMAP_DIR") or os.path.join(os.path.dirname(HERE), "codemaps")))


def norm(s):
    return " ".join(s.split())


def extract(text):
    """返回 [(地图路径原文, [条目...])]，同一路径多节合并。"""
    out, cur = {}, None
    for line in (text or "").splitlines():
        m = HEAD.match(line.strip())
        if m:
            cur = out.setdefault(m.group(1).strip(), [])
            continue
        if cur is None:
            continue
        if line.lstrip().startswith("#"):
            cur = None
            continue
        b = BULLET.match(line)
        if b:
            cur.append(b.group(1))
        elif line.strip() and line[:1] in " \t" and cur:
            cur[-1] += " " + line.strip()  # 缩进续行并入上一条
        elif line.strip():
            cur = None  # 非条目正文，节结束
    return [(k, v) for k, v in out.items() if v]


def resolve(raw):
    """地图路径落在地图目录下且存在才返回绝对路径。"""
    p = os.path.expanduser(raw.strip())
    if not os.path.isabs(p):
        p = os.path.join(map_dir(), p)
    p = os.path.realpath(p)
    root = map_dir()
    if not p.endswith(".md") or os.path.dirname(p) != root or not os.path.isfile(p):
        return None
    return p


PATH_TOK = re.compile(r"^[`(（]*((?:~/|/)?(?:[\w.\-]+/)*[\w.\-]+?(?:\.\w+|(?=:\d)))(?::\d+(?:-\d+)?)?[`)）,，]*$")
OTHER = "## 待归类（codemap-fill 找不到同目录的条目时放这里，整理地图时挪走）"


def entry_key(item):
    """「符号 文件:行 说明」→ (符号, 文件)；找不到文件返回 None。"""
    toks = item.split()
    for i, t in enumerate(toks):
        m = PATH_TOK.match(t)
        if m and ("/" in m.group(1) or "." in m.group(1)):
            return (" ".join(toks[:i]).strip("`"), m.group(1))
    return None


def place(lines, item):
    """同符号同文件的条目换成新的（行号跟着更新）；否则插在同目录最深的那组条目后面；都没有放进待归类节。"""
    key = entry_key(item)
    best, best_at = 0, -1
    for i, line in enumerate(lines):
        b = BULLET.match(line)
        if not b:
            continue
        if norm(b.group(1)) == norm(item):
            return False
        k = entry_key(b.group(1))
        if not key or not k:
            continue
        if k == key:
            lines[i] = f"- {item}"
            return True
        a, c = key[1].split("/")[:-1], k[1].split("/")[:-1]
        n = 0
        while n < min(len(a), len(c)) and a[n] == c[n]:
            n += 1
        if n == len(a) == len(c):
            n += 1  # 同一个文件夹里的同文件、同目录优先
        if n and n >= best:
            best, best_at = n, i
    if best_at >= 0:
        lines.insert(best_at + 1, f"- {item}")
        return True
    if OTHER not in lines:
        while lines and not lines[-1].strip():
            lines.pop()
        lines += ["", OTHER]
    lines.insert(len(lines) if lines[-1] == OTHER else lines.index(OTHER) + 1, f"- {item}")
    return True


def fill(text, source):
    """返回 [(地图, 改动条数)]；跳过的路径写 stderr。条目按路径归到地图里对应的模块段，不按日期追加新节。"""
    done = []
    for raw, items in extract(text):
        path = resolve(raw)
        if not path:
            print(f"codemap-fill: 跳过（不在 {map_dir()} 下或不存在）：{raw}", file=sys.stderr)
            continue
        with open(path, encoding="utf-8") as f:
            body = f.read()
        lines = body.splitlines()
        n = 0
        for it in items:
            it = " ".join(it.split())
            if not it or NONE.match(it):
                continue
            n += place(lines, it)
        if not n:
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        done.append((path, n))
    return done


def transcript_last_text(path):
    last = ""
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            for line in f:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("type") != "assistant":
                    continue
                c = (d.get("message") or {}).get("content")
                if isinstance(c, str):
                    t = c
                else:
                    t = "".join(x.get("text", "") for x in c or [] if isinstance(x, dict) and x.get("type") == "text")
                if t.strip():
                    last = t
    except OSError:
        pass
    return last


def hook_text(d):
    """SubagentStop：优先 last_assistant_message，没有就读子 agent transcript 最后一段文字。
    Stop（主会话一轮结束，工作区交回 [report] 那轮）：last_assistant_message（Claude Code、Codex），
    gemini_response（run.py 从 Gemini AfterAgent 的 prompt_response 填），都没有就读 transcript_path 最后一段文字
    （Grok、DSH 的 transcript 由 run.py 转成 Claude Code 格式）。"""
    t = d.get("last_assistant_message") or ""
    if d.get("hook_event_name") == "Stop":
        t = t or d.get("gemini_response") or ""
        if not t and d.get("transcript_path"):
            t = transcript_last_text(d["transcript_path"])
        return t, "主会话 " + (d.get("session_id") or "")[:8]
    if not t and d.get("hook_event_name") == "PostToolUse":
        response = d.get("tool_response")
        if isinstance(response, dict):
            response = response.get("llmContent") or response.get("output") or response.get("content") or ""
        if isinstance(response, list):
            response = "\n".join(part.get("text", "") for part in response if isinstance(part, dict))
        t = response if isinstance(response, str) else ""
    if not t and d.get("agent_transcript_path"):
        t = transcript_last_text(d["agent_transcript_path"])
    src = "子 agent " + " ".join(x for x in (d.get("agent_type") or "", (d.get("agent_id") or "")[:8]) if x)
    return t, src.strip()


def main(argv):
    try:
        if "--hook" in argv or not argv:
            raw = sys.stdin.read()
            try:
                d = json.loads(raw)
            except ValueError:
                d = None
            if isinstance(d, dict) and ("hook_event_name" in d or "--hook" in argv):
                if d.get("hook_event_name", "SubagentStop") not in ("SubagentStop", "PostToolUse", "Stop"):
                    return
                text, source = hook_text(d)
            else:
                text, source = raw, ""
        else:
            source = argv[argv.index("--source") + 1] if "--source" in argv else ""
            rest = [a for i, a in enumerate(argv) if a != "--source" and (i == 0 or argv[i - 1] != "--source")]
            src = rest[0] if rest else "-"
            text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
        for path, n in fill(text, source):
            print(f"codemap-fill: {path} +{n} 条", file=sys.stderr)
    except Exception as e:  # 不挡回报
        print(f"codemap-fill: 出错 {e}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])
