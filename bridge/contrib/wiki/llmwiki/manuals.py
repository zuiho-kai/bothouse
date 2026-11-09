#!/usr/bin/env python3 -I
"""manuals: 夜里把「同一套操作在两个以上会话里各自从头摸索」的事起草成按需读的手册（skill）。

用户 11-01：「工作区那边经常重复干活……他得重新去摸索……一些操作手册，一些东西他都没有」；「我希望他按需查询」。
dream() 跑完规则候选和今日反思后调 run()（ingest.py）；也能单独跑：

  manuals.py [--since 'YYYY-MM-DD HH:MM'] [--until …] [--dry]   --dry 只列候选不调模型不写

照抄，不自创：
- 找重复：ExpeL（Zhao et al. 2023, arXiv 2308.10144）§4.1 跨多条轨迹对比提炼经验；这里先用程序把每个会话里
  「连着几步在找东西」（find/which/mdfind/ls 通配/grep -r/Glob/Grep）的那段切出来，找的对象（文件名、命令名、
  关键词）在两个以上会话里出现就算同一套操作被重复摸索，交模型判断。
- 起草：Voyager（Wang et al. 2023, arXiv 2305.16291）§2.3 skill library——技能入库时由模型写一段描述，检索只看
  描述；对应这里 SKILL.md 的 frontmatter 只有 name + description（常驻一行），正文按需读（Anthropic Agent Skills
  的 progressive disclosure，同 ~/work/tools/hw/jlc/SKILL.md 人工范本）。
- 已有手册先补充：ACE（arXiv 2510.04618）§3.1 incremental delta update——Curator 只出 ADD 增量，补充先写成正文
  末尾一节「## 补充（日期，自动）」。但只追加不收拢，一晚就把 hw-python-env 补了 8 段重复的（11-02）；用户 11-02
  「不可能每次都手动合并重复段和去掉临时文件夹，你给他做好」→ 每轮收尾 tidy()：自动起草的手册里有「补充」节、
  或系统临时目录（/tmp、/private/tmp）的路径不在「坑」里的，交模型合成一份「起步/坑/出处」，程序校验（frontmatter
  原样、旧出处会话 id 一个不少、没有补充节、临时路径只在坑里、不比旧文长），不过就保留原文、记日志、明晚再来。
  单独跑：manuals.py --tidy [名字…]（不给名字 = 全部自动手册）。
- 好不好用：不另建打分。每份新手册在 wiki 索引页（INDEX）记一行，行即记忆论坛的一帖（ctxsvc.exp_id = 页 + 行
  指纹），搜到推送、用的人投票、低分沉底都走现成论坛；这一行以后不改，改了指纹就丢票。
"""
import argparse, json, os, re, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sessionlog  # noqa: E402

HOME = Path.home()
SKILLS = Path(os.environ.get("MANUALS_SKILLS", HOME / ".agents/skills"))  # Codex、DSH 按需扫这里
# Claude Code 只扫 ~/.claude/skills：每份手册在这里放一个软链（同人工收的 jlc-order）
LINKS = [Path(p) for p in os.environ.get("MANUALS_LINKS", str(HOME / ".claude/skills")).split(os.pathsep) if p]
WIKI = Path(os.environ.get("MANUALS_WIKI", HOME / "wiki"))
# 人工维护的代码地图（工作区开工按任务附上）：用户/橘定过的现状在这里，和会话里的旧做法冲突时以它为准
MAPS = Path(os.environ.get("MANUALS_MAPS", HOME / "work/codemaps"))
INDEX = "tooling/agent-tools/wiki/auto-manuals.md"  # 论坛帖子所在页（相对 WIKI）
STATE = Path(os.environ.get("MANUALS_STATE", HOME / ".local/state/wiki-manuals.json"))
MODEL = os.environ.get("MANUALS_MODEL", "sonnet")  # 沿用 ingest.py MODELS["claude"] 默认
FIRST = 86400  # 首晚只看最近一天，沿用 ingest.py dream()（time.time() - 86400）
MAX_CHARS = 240_000  # 一次调用的上下文上限，沿用 ingest.py MAX_CHARS
MIN_SESSIONS = 2  # 交接总目标原话「同一套操作在 2 个以上会话里各自从头摸索」
# 连着几步在找才算摸索：交接两例实测，找 go 连着 3 步、找嘉立创上一棒脚本连着 6 步；一步就找到不算
MIN_STEPS = 2
# 系统临时目录：重启就丢，里面的路径不能当可用环境或步骤写进手册（用户 11-02）；~/x/tmp 这类家目录下的不算
TMP = re.compile(r"(?<![\w~.$/-])/(?:private/)?tmp(?:/|\b)")
WARN = re.compile(r"重启(?:就|会)?丢|会丢|失效|找不到|别用|不要用|不要依赖|别依赖|不可靠|临时目录")
TIDY_TRIES = 2  # 合并校验不过，带上没过的原因再让模型改一次；还不过就留原文

SEARCH = re.compile(r"(?:^|[;&|(]\s*|\s)(find|mdfind|which|whereis|locate|command -v|type -a|ls -d|ls -la?d?|rg -l|grep -r\w*|grep -\w*r\w*)\b"
                    r"|\bls\s[^;|&]*(?:\*|2>/dev/null)")
# 摸一个本机服务或工具怎么用（嘉立创那类：curl 本机调试口、读别人留下的脚本、看 --help），同样算在找
PROBE = re.compile(r"curl\s[^|;&]*(?:127\.0\.0\.1|localhost):\d+|\s--help\b|(?:^|[;&|]\s*|\s)(?:cat|head)\s+[^|;&]*\.(?:mjs|js|sh|py)\b")
# 这些是读 wiki、会话、任务板的固定动作，不是「摸索怎么做一件事」
SKIP_CMD = re.compile(r"wiki/bin/search\.py|sessions\.py|bothouse' progress|bothouse progress|/board\b|memvote\.py")
NAME_ARG = re.compile(r"-i?name\s+['\"]?([^'\"\s)]+)")
GENERIC = {"jsonl", "json", "md", "py", "txt", "log", "png", "jpg", "tmp", "head", "tail", "dev", "null", "users",
           "bin", "src", "the", "and", "for", "type", "name", "maxdepth", "newer", "newermt", "mmin", "print", "exec",
           "true", "false", "echo", "grep", "find", "ls", "cat", "sed", "awk", "wc", "sort", "uniq", "xargs", "private",
           "claude", "projects", "bothouse", "roles", "notes", "local", "share", "usr", "opt", "homebrew",
           "library", "applications", "contents", "macos", "home", "work", "code", "tools", "path", "export", "cd"}


def log(msg):
    print(time.strftime("%F %T"), "manuals:", msg, file=sys.stderr, flush=True)


def is_search(tool, text):
    if tool in ("Glob", "Grep"):
        return True
    t = text or ""
    return tool == "Bash" and bool(SEARCH.search(t) or PROBE.search(t)) and not SKIP_CMD.search(t)


def targets(tool, text):
    """一条找东西的命令在找什么：-name 的参数、which/mdfind 的对象、路径里的通配段、grep -r 的词。小写、去通配。"""
    t = text or ""
    out = set(NAME_ARG.findall(t))
    for m in re.finditer(r"\b(?:which|whereis|command -v|type -a|mdfind(?: -name)?)\s+['\"]?([\w.+-]+)", t):
        out.add(m.group(1))
    for m in re.finditer(r"[\w./~-]*\*[\w.*-]*", t):  # /usr/local/go*  ~/sdk/go*；*.go、*.py 这种按扩展名筛不算在找什么
        seg = m.group(0).rsplit("/", 1)[-1]
        if not re.fullmatch(r"\*\.[\w*]+", seg):
            out.add(seg)
    for m in re.finditer(r"grep\s+-\w*[rR]\w*\s+(?:-\w+\s+)*['\"]([^'\"]+)['\"]", t):
        out |= set(re.split(r"\\\||\|", m.group(1)))
    out |= {f"port-{p}" for p in re.findall(r"(?:127\.0\.0\.1|localhost):(\d+)", t)}
    out |= set(re.findall(r"(?:cat|head)\s+(?:-\w+\s+)*(?:[^\s|;&]*/)?([\w.-]+\.(?:mjs|js|sh|py))\b", t))
    out |= set(re.findall(r"([\w.-]+)\s+--help\b", t))
    for m in re.finditer(r"(?:^|[;&|]\s*)ls\s+(?:-\w+\s+)*([^|;&>]+)", t):  # ls 看的目录：/tmp/jlccdp → jlccdp
        out |= {a.rstrip("/").rsplit("/", 1)[-1] for a in m.group(1).split() if not a.startswith("-") and "*" not in a}
    if tool in ("Glob", "Grep") and t.split():
        out.add(t.split()[0])
    norm = set()
    for x in out:
        x = re.sub(r"\*.*$", "", x.strip("*'\"/").lower()).strip(".-_")
        if x and not x.isdigit() and x not in GENERIC and "$" not in x and "\\" not in x and not re.fullmatch(r"\W+", x) and len(x) > 1:
            norm.add(x)
    return norm


def records(path, lo, hi):
    """一个会话文件里 [lo, hi) 的工具调用：[(行号, 时间, tool, text)]。"""
    out = []
    with open(path, errors="ignore") as f:
        for n, line in enumerate(f, 1):
            if '"tool"' not in line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("kind") != "tool" or not d.get("ts"):
                continue
            t = time.mktime(time.strptime(d["ts"][:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
            if lo <= t < hi:
                out.append((n, t, d.get("tool") or "", d.get("text") or ""))
    return out


def episodes(calls):
    """连着在找东西的那几段（MIN_STEPS 步以上），每段带上找到以后第一步用上它的（段后第一条提到所找对象、自己不是在找的命令）。"""
    runs, cur = [], []
    for i, (_, _, tool, text) in enumerate(calls):
        if is_search(tool, text):
            cur.append(i)
        else:
            if cur:
                runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    out = []
    for k, idx in enumerate(r for r in runs if len(r) >= MIN_STEPS):
        tg = set()
        for i in idx:
            tg |= targets(calls[i][2], calls[i][3])
        if not tg:
            continue
        got = []
        for c in calls[idx[-1] + 1:]:
            if is_search(c[2], c[3]):
                break
            if any(x in c[3].lower() for x in tg):
                got = [c]
                break
        out.append({"targets": tg, "calls": [calls[i] for i in idx] + got, "line": calls[idx[0]][0], "t": calls[idx[0]][1]})
    return out


def candidates(files, lo, new_from, hi):
    """一个被 MIN_SESSIONS 个以上会话找过的对象一类：[{sessions: {sid: [(path, episode)…]}, targets}]，会话多的在前。
    一个对象出现过的段全都已被前面某类包含，就并进那一类（同一次摸索里顺带找的别名，如 go 与 goroot）。
    至少一段摸索在 new_from 之后（上次跑完后新出现的），否则上次已经看过。"""
    eps = [(sid, p, e) for sid, p in files.items() for e in episodes(records(p, lo, hi))]
    where = {}
    for k, (sid, _, e) in enumerate(eps):
        for x in e["targets"]:
            where.setdefault(x, set()).add(k)
    sess = lambda ks: {eps[k][0] for k in ks}
    order = sorted((x for x, ks in where.items() if len(sess(ks)) >= MIN_SESSIONS),
                   key=lambda x: (-len(sess(where[x])), -len(where[x]), x))
    groups = []
    for x in order:
        host = next((g for g in groups if where[x] <= g["eps"]), None)
        if host:
            host["targets"].add(x)
        else:
            groups.append({"targets": {x}, "eps": set(where[x])})
    out = []
    for g in groups:
        ss = {}
        for k in sorted(g["eps"]):
            sid, p, e = eps[k]
            ss.setdefault(sid, []).append((p, e))
        if any(eps[k][2]["t"] >= new_from for k in g["eps"]):
            out.append({"sessions": ss, "targets": g["targets"]})
    return out


def existing():
    """已有手册：{name: (description, SKILL.md 路径)}，SKILLS 和各 LINKS 目录都看（人工收的也算）。"""
    out = {}
    for d in [SKILLS, *LINKS]:
        for f in (sorted(d.glob("*/SKILL.md")) if d.is_dir() else ()):
            head = f.read_text(errors="ignore")
            name = re.search(r"^name:\s*(.+)$", head, re.M)
            desc = re.search(r"^description:\s*(.+)$", head, re.M)
            if name and name.group(1).strip() not in out:
                out[name.group(1).strip()] = ((desc.group(1).strip() if desc else ""), f)
    return out


def maps():
    """人工维护的代码地图全文（「已记的现状」）：会话里摸到的可能是被统一掉的旧路径（11-01 试跑：go 起草成了 ~/sdk/go，
    地图已定 ~/.local/bin/go；只附命中对象的行时，别的组起草的编译手册仍写回旧路径，所以整份附上）。"""
    return "\n\n".join(f"=== {f}\n{f.read_text(errors='ignore')}" for f in sorted(MAPS.glob("*.md"))) if MAPS.is_dir() else ""


def evidence(g, room):
    parts, used = [], 0
    for sid, eps in g["sessions"].items():
        for p, e in eps:
            lines = [f"=== 会话 {p}（第 {e['line']} 行起，{time.strftime('%m-%d %H:%M', time.localtime(e['t']))}）"]
            lines += [f"[{n}] {tool}: {text[:sessionlog.TOOL_CHARS]}" for n, _, tool, text in e["calls"]]
            s = "\n".join(lines)
            if used + len(s) > room:
                return "\n\n".join(parts)
            parts.append(s)
            used += len(s)
    return "\n\n".join(parts)


PROMPT = """你在给一组 AI 编码助手维护「操作手册」（skill）。下面是程序从不同会话里切出来的几组操作。每组里的每段，开头是助手连着几步在找东西或摸一个工具怎么用（找编译器、找 Python 环境、找上一棒留下的脚本、摸浏览器调试口……），最后一条是它找到以后第一步用上的。同一组的几段来自不同会话、找的是同一类东西，说明同一套操作被各自从头摸索了。

逐组判断这是不是一套值得写成手册、下次照着做就不用再摸索的操作。只回一个 JSON 对象 {{"groups": [每组一项]}}，不要别的字。每项带 "id"（组号），再加下面三种之一：

- 不值得（碰巧找同名文件、一次性查找、没找到结果、只是在读某个项目自己的代码、找的是变量名）：{{"id": 组号, "skip": "一句理由"}}
- 下面的已有手册已经管这件事：只补它没写的新路径、新坑：{{"id": 组号, "append": "<已有手册 name>", "add": "补充的 markdown，只写已有手册里没有的，每条带出处 会话文件:行"}}；没有新东西就 skip 写「已有手册 <name> 已覆盖」
- 值得新写：{{"id": 组号, "name": "小写英文短横线名", "description": "一行：做什么 + 什么时候用（带用户会说的中文说法和关键词）", "body": "markdown 正文"}}

append 只能填上面「已有手册」里的 name，或本次回答里你另一组新写的 name；要补的手册还不存在，就在这一组新写。几组说的是同一件事，就只在其中一组新写，其余组 append 到这个新名字（同一次回答里新写的也算已有手册）。
下面「已记的现状」是人工维护的代码地图：手册里的路径、命令、版本一律以它为准，会话里和它冲突的旧做法写进「坑」（标明已被统一掉）；地图已经把这件事写全的，skip 写「代码地图已覆盖」。
正文照人工范本的写法：开头一句直接给答案（一个命令或一处路径）；「## 起步」写最短能用的步骤，路径、命令写全；「## 坑」写这几段里踩过的（找错的地方、没用的路径）；「## 出处」每条一行 会话文件:行。只写这几段里真出现过的路径和命令，不编。
系统临时目录（/tmp、/private/tmp）里的东西重启就丢：不要写进开头一句和「起步」，也不要当成现成可用的环境；值得提醒的只在「坑」里写一句「X 在临时目录，重启会丢，别用」。

已记的现状（代码地图）：
{maps}

已有手册（name：description）：
{existing}

{evidence}
"""


def ask(prompt):
    """一次纯文本调用（不给工具），回模型的 JSON。引擎同 ingest.py claude()：claude -p，走订阅额度。"""
    cmd = ["claude", "-p", "--model", MODEL, "--no-session-persistence", "--strict-mcp-config", "--tools", "",
           "--output-format", "json"]
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, env={**os.environ, "WIKI_INGEST": "1"})
    try:
        res = json.loads(r.stdout).get("result", "")
    except ValueError:
        raise RuntimeError((r.stdout or r.stderr)[-300:])
    i = res.find("{")
    if i < 0:
        raise ValueError(f"no JSON: {res[:200]}")
    return json.JSONDecoder().raw_decode(res[i:])[0]


def write_new(ans, day, g):
    name = re.sub(r"-+", "-", re.sub(r"[^a-z0-9-]", "", ans["name"].lower().replace("_", "-"))).strip("-")
    if not name:
        raise ValueError("empty name")
    d = SKILLS / name
    if d.exists():
        raise ValueError(f"{name} exists")
    desc = " ".join(ans["description"].split())
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {desc}\n---\n" + ans["body"].strip() +
                                f"\n\n<!-- 夜里自动起草 {day}（~/wiki/bin/manuals.py），找的对象：{', '.join(sorted(g['targets']))} -->\n")
    for l in LINKS:
        if l.is_dir() and not (l / name).exists():
            (l / name).symlink_to(d)
    return name, desc, d / "SKILL.md"


def write_append(ans, day, have):
    name = ans["append"]
    if name not in have:
        raise ValueError(f"no manual {name}")
    f = have[name][1].resolve()
    # 临时目录里的路径只留「别用」那种提醒（收尾合并时归进坑），当成可用路径写的整行不要
    add = "\n".join(l for l in ans["add"].strip().splitlines() if not TMP.search(l) or WARN.search(l)).strip()
    if not add:
        raise ValueError("append only had temp-dir paths")
    f.write_text(f.read_text().rstrip() + f"\n\n## 补充（{day}，自动）\n" + add + "\n")
    return name


def split_doc(text):
    """SKILL.md → (frontmatter 原文含两条 ---, 正文, 末尾的程序注释行)。"""
    m = re.match(r"---\n.*?\n---\n", text, re.S)
    head = m.group(0) if m else ""
    body = text[len(head):]
    notes = re.findall(r"^<!-- 夜里自动起草.*?-->$", body, re.M)
    for n in notes:
        body = body.replace(n, "")
    return head, body.strip(), notes


def sections(body):
    """[(标题, 行列表)]，开头那段标题为空。"""
    out = [("", [])]
    for l in body.splitlines():
        if l.startswith("## "):
            out.append((l[3:].strip(), []))
        else:
            out[-1][1].append(l)
    return out


def session_ids(text):
    """出处里的会话 id：完整 uuid 和单写的 8 位前缀都按前 8 位算（合并时可写短）。"""
    return set(re.findall(r"(?<![0-9a-f])([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", text)) | \
        set(re.findall(r"(?<![0-9a-f-])([0-9a-f]{8})(?![0-9a-f-])", "\n".join(
            "\n".join(ls) for t, ls in sections(text) if "出处" in t)))


def bad_tmp(body):
    """临时目录路径出现在「坑」以外、或在坑里却没说别用的行。"""
    return [l.strip() for t, ls in sections(body) for l in ls if TMP.search(l) and not ("坑" in t and WARN.search(l))]


def needs_tidy(text):
    _, body, _ = split_doc(text)
    return bool(re.search(r"^## 补充", body, re.M)) or bool(bad_tmp(body))


def check_tidy(old, new_body):
    """合并结果不过的原因列表（空 = 过）。"""
    _, ob, _ = split_doc(old)
    why = []
    if re.search(r"^## 补充", new_body, re.M):
        why.append("还有「## 补充」节")
    heads = [t for t, _ in sections(new_body)[1:]]
    for h in ("起步", "坑", "出处"):
        if not any(h in t for t in heads):
            why.append(f"缺「## {h}」节")
    if re.match(r"---\n", new_body):
        why.append("正文里又写了 frontmatter")
    lost = session_ids(ob) - session_ids(new_body)
    if lost:
        why.append("出处丢了会话 " + ", ".join(sorted(lost)))
    bt = bad_tmp(new_body)
    if bt:
        why.append("临时目录路径写在坑以外或没说别用：" + " / ".join(x[:80] for x in bt[:3]))
    if len(new_body) > len(ob):
        why.append(f"比原文长（{len(new_body)} > {len(ob)} 字）")
    return why


TIDY_PROMPT = """下面是一份给 AI 编码助手看的操作手册（skill）正文。它是夜里自动起草的，之后几晚又在末尾追加了几段「## 补充」，内容和正文、彼此之间有重复。请把它整理成一份干净的手册，只回 JSON {{"body": "整理后的 markdown 正文"}}，不要别的字。

要求：
- 结构只有四块：开头一句直接给答案（一个命令或一处路径）；「## 起步」最短能用的步骤，路径、命令写全；「## 坑」踩过的、别再试的；「## 出处」。不要再有「## 补充」节，也不要写 frontmatter（--- 那段我会原样放回）。
- 补充里的新东西归进起步或坑；重复的合成一条；前后矛盾的以写得更新、更具体的为准。
- 系统临时目录（/tmp、/private/tmp）里的路径重启就丢：不能出现在开头一句和「起步」，不能当成现成可用的；值得提醒的只在「坑」里写成一句「X 在临时目录，重启会丢，别用」。起步里要写证据或日志文件的，换成不在临时目录的位置（如 ~/.bothouse/roles/<role>/notes/runs/）。
- 原文里出现的每个会话 id（文件名里 8 位十六进制开头的那串）都要留在「出处」里，一条出处一行「会话 id 前 8 位或文件名:行」，同一会话的几行可以并成一行。
- 只用原文里有的路径和命令，不编新的。整理后要比原文短。
{retry}
原文：
{body}
"""


def tidy(f, day):
    """一份手册合成一份「起步/坑/出处」：校验过才写（旧文留 SKILL.md.bak-时间），不过保留原文。返回 True=改写了。"""
    old = f.read_text()
    head, body, notes = split_doc(old)
    retry = ""
    for _ in range(TIDY_TRIES):
        ans = ask(TIDY_PROMPT.format(body=body, retry=retry))
        nb = (ans.get("body") or "").strip()
        why = check_tidy(old, nb)
        if not why:
            bak = f.with_name(f"SKILL.md.bak-{time.strftime('%Y%m%d-%H%M%S')}")
            bak.write_text(old)
            note = (notes[0] if notes else f"<!-- 夜里自动起草（~/wiki/bin/manuals.py） -->")
            f.write_text(head + nb + f"\n\n{note}\n<!-- 自动合并 {day}，旧文 {bak.name} -->\n")
            return True
        retry = "上一次整理没通过程序检查，原因：" + "；".join(why) + "。这次改掉。\n"
    log(f"tidy {f.parent.name} kept original: " + "；".join(why))
    return False


def auto_names():
    """夜里自动起草的手册名（INDEX 页每份一行）；人工收的（jlc-order、pebrel-runtime 等）不在里面，不碰。"""
    page = WIKI / INDEX
    return re.findall(r"^- 手册 ([a-z0-9-]+)（", page.read_text(), re.M) if page.exists() else []


def tidy_all(day, names=None, deadline=None):
    """收尾：自动手册里有补充节或临时路径不在坑里的，逐份合并。返回 [(动作, 名字)]。"""
    out = []
    for n in names or auto_names():
        f = SKILLS / n / "SKILL.md"
        if not f.exists() or not needs_tidy(f.read_text()):
            continue
        if deadline and time.time() > deadline:
            log("night budget used up, tidy of the rest waits for tomorrow")
            break
        try:
            out.append(("tidy" if tidy(f, day) else "tidy-kept", n))
        except Exception as e:  # noqa: BLE001 — 这份明晚再合
            log(f"tidy {n} FAILED: {type(e).__name__}: {e}")
            out.append(("tidy-kept", n))
        log(f"{out[-1][0]} {n}")
    return out


def register(rows, day):
    """新手册在 INDEX 页各记一行（论坛的一帖）。页不存在就建；只追加，旧行不动。提交只带这一页。"""
    page = WIKI / INDEX
    if not page.exists():
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text("---\nname: auto-manuals\ndescription: 夜里自动起草的操作手册（skill）目录：一行一份，正文在 "
                        "~/.agents/skills/<名>/SKILL.md，按需读；好不好用靠记忆论坛投票\nmetadata:\n  scope: 只记自动起草的"
                        "手册各一行（名、做什么、正文路径、起草日期）；人工收的手册和规则不记这里\n---\n"
                        "# 自动起草的操作手册\n## 关键事实\n")
    text = page.read_text().rstrip("\n") + "\n"
    for name, desc, path in rows:
        shown = "~/" + str(path.relative_to(HOME)) if path.is_relative_to(HOME) else str(path)
        text += f"- 手册 {name}（{day} 夜里起草）：{desc}；正文 {shown}，用到才读\n"
    page.write_text(text)
    if (WIKI / ".git").exists() and not os.environ.get("MANUALS_NO_COMMIT"):
        subprocess.run(["git", "-C", str(WIKI), "add", INDEX], capture_output=True)
        r = subprocess.run(["git", "-C", str(WIKI), "commit", "-m", f"manuals: {day} 起草 {len(rows)} 份手册", "--", INDEX],
                           capture_output=True, text=True)
        log("index commit " + ("ok" if r.returncode == 0 else f"FAILED {(r.stderr or r.stdout)[-200:]}"))


def run(since=None, until=None, dry=False, deadline=None):
    """返回 [(动作, 名字或理由)]。since 不给 = 上次跑到的地方（首次：一天前）。"""
    hi = until or time.time()
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    new_from = since or st.get("at") or hi - FIRST
    lo = new_from - FIRST  # 今晚新摸索的那次，和前一天里另一次配成一对也算重复
    files = {s.id: s.path for s in sessionlog.sessions(None, hosts=True)
             if s.path.stat().st_mtime >= lo and not str(s.path).startswith(("/tmp", "/private/tmp"))}
    gs = candidates(files, lo, new_from, hi)
    log(f"{len(files)} sessions, {len(gs)} repeated-search groups")
    if dry:
        for g in gs:
            print(len(g["sessions"]), "sessions |", ", ".join(sorted(g["targets"])))
            for eps in g["sessions"].values():
                print("   ", f"{eps[0][0]}:{eps[0][1]['line']}")
        return []
    have, day, done, rows = existing(), time.strftime("%Y-%m-%d", time.localtime(hi)), [], []
    seen = set(st.get("groups", []))
    todo = [(("|".join(sorted(g["targets"]))), g) for g in gs]
    todo = [(k, g) for k, g in todo if k not in seen]
    mp = maps() or "（无）"
    while todo:
        if deadline and time.time() > deadline:
            log("night budget used up, the rest waits for tomorrow")
            break
        ex = "\n".join(f"- {n}：{d}" for n, (d, _) in have.items()) or "（无）"
        room = MAX_CHARS - len(PROMPT.format(maps=mp, existing=ex, evidence=""))
        batch, parts = [], []
        for k, g in todo:  # 一批塞到上下文上限为止（同 ingest.py batches_of）；单组过大的只截它自己
            e = f"## 组 {len(batch)}：找的对象 {', '.join(sorted(g['targets']))}\n" + evidence(g, room)
            if batch and sum(map(len, parts)) + len(e) > room:
                break
            batch.append((k, g))
            parts.append(e)
        todo = todo[len(batch):]
        try:
            res = ask(PROMPT.format(maps=mp, existing=ex, evidence="\n\n".join(parts)))
            answers = res.get("groups") or []
        except Exception as e:  # noqa: BLE001 — 这一批明晚再试
            log(f"batch of {len(batch)} FAILED: {type(e).__name__}: {e}")
            continue
        # 新写的先落，再落 append（同一次回答里 append 到新名字）
        for ans in sorted(answers, key=lambda x: "append" in x):
            try:
                k, g = batch[int(ans["id"])]
                if "skip" in ans:
                    done.append(("skip", f"{k} — {ans['skip']}"))
                elif "append" in ans:
                    done.append(("append", f"{write_append(ans, day, have)} ← {k}"))
                else:
                    name, desc, path = write_new(ans, day, g)
                    have[name] = (desc, path)
                    rows.append((name, desc, path))
                    done.append(("new", f"{name} ← {k}"))
                seen.add(k)
                log(f"{done[-1][0]} {done[-1][1]}")
            except Exception as e:  # noqa: BLE001 — 一组落不下不拦别的组，这组明晚再试
                log(f"group answer {str(ans)[:120]} FAILED: {type(e).__name__}: {e}")
    if rows:
        register(rows, day)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"at": hi, "groups": sorted(seen)}, ensure_ascii=False))
    done += tidy_all(day, deadline=deadline)  # 收尾：补充合进正文、临时路径清掉（用户 11-02）
    return done


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--tidy", nargs="*", metavar="NAME", help="只做收尾合并（不给名字 = 全部自动手册）")
    a = ap.parse_args()
    ts = lambda s: time.mktime(time.strptime(s, "%Y-%m-%d %H:%M")) if s else None
    if a.tidy is not None:
        for act, what in tidy_all(time.strftime("%Y-%m-%d"), a.tidy or None):
            print(act, what)
        sys.exit(0)
    for act, what in run(ts(a.since), ts(a.until), a.dry):
        print(act, what)
