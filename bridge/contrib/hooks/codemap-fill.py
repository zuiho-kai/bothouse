#!/usr/bin/env -S python3 -I
"""SubagentStop：把子 agent 回报里「## 地图要补的条目（<地图路径>）」一节的条目追加到代码地图末尾
（codemap-inject.py 派活时要求子 agent 交付附这一节）。

用法：
  codemap-fill.py                           hook（run.py 调用；stdin 是 hook JSON，带 hook_event_name）
  codemap-fill.py --hook                    同上
  codemap-fill.py --source <来源> [文件|-]   手动：从文件或 stdin 读回报正文
规则：
  - 只认地图路径落在地图目录（CODEMAP_DIR，默认 bothouse 数据目录下的 codemaps/，同 codemap-inject.py）下、已存在的 .md，其余跳过。
  - 「无…」「本次…」开头的不算条目，跳过。
  - 条目与地图里已有的「- 」行（空白归一后）相同就不再写；全被去掉就不加节。
  - 追加一节「## 自动补（YYYY-MM-DD，<来源>）」。
  - 任何错误只写 stderr，退出码 0，不挡回报。
"""
import datetime
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


def fill(text, source, today=None):
    """返回 [(地图, 新增条数)]；跳过的路径写 stderr。"""
    today = today or datetime.date.today().isoformat()
    done = []
    for raw, items in extract(text):
        path = resolve(raw)
        if not path:
            print(f"codemap-fill: 跳过（不在 {map_dir()} 下或不存在）：{raw}", file=sys.stderr)
            continue
        with open(path, encoding="utf-8") as f:
            body = f.read()
        seen = {norm(b.group(1)) for b in map(BULLET.match, body.splitlines()) if b}
        new = []
        for it in items:
            k = norm(it)
            if NONE.match(k):
                continue
            if k and k not in seen:
                seen.add(k)
                new.append(it.strip())
        if not new:
            continue
        sep = "" if body.endswith("\n\n") else ("\n" if body.endswith("\n") else "\n\n")
        src = norm(source or "未知来源").replace("）", ")")
        block = f"{sep}## 自动补（{today}，{src}）\n" + "".join(f"- {x}\n" for x in new)
        with open(path, "a", encoding="utf-8") as f:
            f.write(block)
        done.append((path, len(new)))
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
    """SubagentStop：优先 last_assistant_message，没有就读子 agent transcript 最后一段文字。"""
    t = d.get("last_assistant_message") or ""
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
                if d.get("hook_event_name", "SubagentStop") != "SubagentStop":
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
