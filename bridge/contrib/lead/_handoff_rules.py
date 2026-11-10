# 交接校验：按 handoff-rules.json（同目录，唯一一份规则）查交接正文。ws-handoff 用它；DSH collab 用同一份规则的
# Node 实现（dsh/collab/handoff-rules.mjs），两边由 test_handoff_rules.py 用同一组 fixture 比对。
# 这里不写任何小节名、正则或报错文案，全在规则文件里；规则文件读不到就报错，不放行。
import json, os, re, shutil, subprocess
from pathlib import Path

RULES = Path(__file__).resolve().parent / "handoff-rules.json"


STRICT = RULES.with_name("handoff-rules.strict.json")
# 本机叠加：<数据目录>/collaboration/handoff-rules.local.json（不进发布包）。{"profile": "strict"} 叠加严格档；
# "checks" 按 id 覆盖或追加；"flags" 给 ws-handoff 的额外关卡（require_short、cli_gate）。
LOCAL = Path(os.environ.get("HANDOFF_RULES_LOCAL") or RULES.parent.parent / "handoff-rules.local.json")


def _read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        raise RuntimeError(f"交接规则文件读不到：{path}（{e}）") from e


def _overlay(rules, extra):
    ids = [c["id"] for c in rules["checks"]]
    for c in extra.get("checks", []):
        if c["id"] in ids:
            rules["checks"][ids.index(c["id"])] = c
        else:
            rules["checks"].append(c)
            ids.append(c["id"])
    return rules


def load(path=RULES, local=None):
    """产品默认规则；path 是默认那份时再叠本机 local（没有就只用默认）。显式给 path（测试）不叠。"""
    rules = _read(path)
    rules.setdefault("flags", {})
    if Path(path) != RULES and local is None:
        return rules
    lp = Path(local) if local else LOCAL
    if not lp.is_file():
        return rules
    loc = _read(lp)
    if loc.get("profile") == "strict":
        _overlay(rules, _read(STRICT))
    _overlay(rules, loc)
    rules["flags"].update(loc.get("flags", {}))
    return rules


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
    if t == "forbid_if":  # 原话节命中 trigger_re（用户要照抄）时，指定几节不许出现 forbid_re（自己发挥）；11-09 用户「让你抄他，你又搞一坨屎创意」第 n 次
        src = text_of([x for seg in _sections(lines, c["trigger_section"], lead) for x in seg])
        dst = [x for n in c["sections"] for seg in _sections(lines, n, lead) for x in seg[1:]]
        if re.search(c["trigger_re"], src):
            hit = [x.strip() for x in dst if re.search(c["forbid_re"], x)]
            return c[key].replace("{hit}", "；".join(hit[:3])) if hit else None
        return None
    if t == "ref_local":  # 参考链接要有落地的本地图/视频（#1223，用户 11-08「整个参考信息全给他」）
        links, have, gone = ref_material(text_of(lines), c, lead)
        if not links:
            return None
        if gone:
            return c["missing_msg"].replace("{items}", "、".join(gone))
        return None if have else c[key].replace("{links}", "、".join(links[:3]))
    raise RuntimeError(f"交接规则文件里有不认识的检查类型：{t}")


def ref_rule(rules=None):
    """ref_local 那条检查（规则文件里没有就 None）。ws-up --direct、ws-pass 用同一条判断交接有没有参考材料。"""
    rules = rules or load()
    return next((c for c in rules["checks"] if c.get("type") == "ref_local"), None)


def ref_material(text, c=None, lead=None):
    """交接里的参考材料：(参考链接, 存在的本地参考图/视频, 写了但不存在的本地参考路径)。
    程序追加的节（标题含 skip_heading_re，如「旧定案（程序搜出）」）不算，那是搜出来的旧材料，不是这件活的参考。"""
    if c is None:
        rules = load()
        c, lead = ref_rule(rules), rules["lead"]
        if c is None:
            return [], [], []
    skip, keep, lines = re.compile(c["skip_heading_re"]), True, []
    for l in text.splitlines():
        if _head(l):
            keep = not skip.search(l)
        if keep:
            lines.append(l)
    link, hint, url = re.compile(c["link_re"]), re.compile(c["hint_re"]), re.compile(c["url_re"])
    links = []
    for l in lines:
        found = [m.group(0) for m in link.finditer(l)]
        if hint.search(l):
            found += [m.group(0) for m in url.finditer(l)]
        links += [u.rstrip(".,;:：，。；") for u in found]
    local, media = re.compile(c["local_re"]), re.compile(c["media_re"], re.I)
    have, gone = [], []
    for l in lines:
        for m in local.finditer(l):
            raw = m.group(0).rstrip(".,;:：，。；")
            p = Path(re.sub(r":[0-9][0-9,-]*$", "", raw)).expanduser()  # figure.js:19-20 这类带行号的
            if p.is_file() and media.search(p.name):
                have.append(str(p))
            elif not p.exists():
                gone.append(raw)
    return list(dict.fromkeys(links)), list(dict.fromkeys(have)), list(dict.fromkeys(gone))


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


def check_all(text, rules=None):
    """所有不合格项（每项一段报错文字），合格返回空列表。ws-handoff 一次列全，免得改一处被拒一次。"""
    rules = rules or load()
    lines, lead = text.splitlines(), rules["lead"]
    return [e for c in rules["checks"] for e in [_check(c, lines, lead)] if e]


# ---- 分档（11-06 用户认可「核事实所有模型都过、核格式只给 DS 类开」）----
# 每条检查的 tier：fact = 程序能拿外面的东西核对（路径存在、原话搜得到、PR 查得到、不引用 /tmp），所有主角色都过；
# format = 只看有没有写、写多长，只在主角色后端是 DS 类时开。带 verify 的 fact 检查再真去核对写的内容。
FACT_MAX = 5  # 一次交活最多核几条事实（用户 11-06「担心需要核查的太多他那边太慢了」，答一次最多五条、问题一次报完）
_DATE = re.compile(r"(?<![0-9])[0-9]{1,2}-[0-9]{2}(?![0-9])")
_QUOTE = re.compile(r"「([^」]{6,})」")
_SAID = re.compile(r"(原话|说|骂|问|嫌|回|讲|道)[^「」]{0,3}$|[0-9]{1,2}-[0-9]{2}(\s*[0-9]{1,2}:[0-9xX]{2})?\s*$")
_PR = re.compile(r"github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([0-9]+)|(?<![A-Za-z])(?:PR|pr|Pr)\s*#?\s*([0-9]+)")


def ds_lead(env=None):
    """主角色后端是不是 DS 类：config.toml 里本项目（CC_PROJECT）的 agent 是 dsh，或模型/参数/模型环境变量里有 deepseek。
    读不到配置时看 CC_AGENT；都没有算不是（只开核事实）。"""
    env = os.environ if env is None else env
    data = Path(env.get("CC_DATA_DIR") or env.get("BOTHOUSE_DATA_DIR") or Path.home() / ".bothouse")
    proj, agent = env.get("CC_PROJECT", ""), {}
    try:
        import tomllib
        with open(data / "config.toml", "rb") as fh:
            agent = next((p.get("agent") or {} for p in tomllib.load(fh).get("projects") or [] if p.get("name") == proj), {})
    except Exception:  # noqa: BLE001  配置读不到就退到 CC_AGENT
        agent = {}
    kind = (agent.get("type") or env.get("CC_AGENT") or "").lower()
    if kind == "dsh" or "deepseek" in kind:
        return True
    o = agent.get("options") or {}
    said = [str(o.get("model") or ""), " ".join(map(str, o.get("args") or []))]
    said += [str(v) for k, v in (o.get("env") or {}).items() if "MODEL" in k.upper() or "BASE_URL" in k.upper()]
    return any("deepseek" in x.lower() for x in said)


def _sec_lines(c, lines, lead):
    return [x for seg in _sections(lines, c["section"], lead, c.get("inline", False)) for x in seg]


def _git_top(d):  # 只写 PR 号时用当前目录所在仓库查
    try:
        r = subprocess.run(["git", "-C", str(d), "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _claims(c, lines, lead):
    """一条 fact 检查要核的东西：[(展示文字, 核对函数)]，核对函数返回 True 对上 / False 对不上 / None 核不了（跳过）。"""
    v, sec, out = c["verify"], _sec_lines(c, lines, lead), []
    kind, far = v["kind"], re.compile(v.get("remote_re") or "(?!)")
    if any(far.search(x) for n in v.get("remote_sections", []) for seg in _sections(lines, n, lead) for x in seg):
        return out  # 活是在别的机器上做的：~/ 路径指那台机器、原话在那边的群里，本机核不了
    if kind == "paths":
        rx = re.compile(c["ref_re"])
        for x in sec:
            if far.search(x):
                continue
            for m in rx.finditer(x):
                raw = m.group(0)
                if "://" in x[max(0, m.start() - 8):m.end()]:
                    continue
                head, _, tail = raw.rpartition(":")
                path = head if head and tail.isdigit() else raw
                if "/" not in path:
                    continue  # 只写了文件名（ws-up:120），核不了
                p = Path(path).expanduser()
                # 只核本机家目录下的路径：相对路径不知道相对哪个仓库、哪个分支；/root、/home/agent 这类常是别的机器；a..b 是省略写法
                top = Path.home() / p.relative_to(Path.home()).parts[0] if Path.home() in p.parents else None
                if top and top.exists() and ".." not in path:  # 家目录下第一层都没有的（~/roles/…）多半是别的机器
                    out.append((raw, lambda p=p: p.exists()))
    elif kind == "quotes":
        for x in sec:
            for m in _QUOTE.finditer(x):
                before = x[:m.start()]
                if not _SAID.search(before[-12:]):
                    continue  # 只核写成某人原话的引号（前面紧挨着日期，或原话、说、骂、问…），术语、标题不核
                dates = _DATE.findall(before) or _DATE.findall(x[m.end():])
                if dates:
                    q = m.group(1)
                    out.append((f"「{q}」", lambda q=q, d=(dates[-1] if _DATE.findall(before) else dates[0]): _said(q, d)))
    elif kind == "prs":
        for x in sec:
            for m in _PR.finditer(x):
                repo, num = (m.group(1), m.group(2)) if m.group(2) else ("", m.group(3))
                out.append((m.group(0), lambda repo=repo, num=num: _gh_pr(repo, num, lines)))
    return out


def _data_dir():
    return Path(os.environ.get("CC_DATA_DIR") or os.environ.get("BOTHOUSE_DATA_DIR") or Path.home() / ".bothouse")


def _norm(t):
    return re.sub(r"[\W_]+", "", t).lower()


_LOG = {}


def _channel_log():
    """频道里收到的原话：桥的事件流 events.jsonl*（type=message，用户和队友的话），加会话记录 sessions/*.json 里的 user 条。
    不收 bot 的工具调用（交接本身就是这么写出来的）。返回 (最早时间 YYYY-MM-DD, [归一化正文])；读不到返回 ("", [])。"""
    if "v" in _LOG:
        return _LOG["v"]
    data, first, texts = _data_dir(), "", []
    for f in sorted(data.glob("events.jsonl*")):
        try:
            with open(f, encoding="utf-8") as fh:
                for ln in fh:
                    if '"message"' not in ln[:200]:
                        continue  # 先粗筛，工具调用那几万行不解析
                    try:
                        e = json.loads(ln)
                    except ValueError:
                        continue
                    if e.get("type") != "message":
                        continue
                    ts = (e.get("time") or "")[:10]
                    first = min(first, ts) if first and ts else (first or ts)
                    texts.append(_norm(e.get("text") or ""))
        except OSError:
            continue
    for f in data.glob("sessions/*_*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for sess in (d.get("sessions") or {}).values():
            for m in sess.get("history") or []:
                if m.get("role") == "user":
                    ts = (m.get("timestamp") or "")[:10]
                    first = min(first, ts) if first and ts else (first or ts)
                    texts.append(_norm(m.get("content") or ""))
    _LOG["v"] = (first, texts)
    return _LOG["v"]


def _said(quote, date):
    """带日期的原话在频道记录里找不找得到：引号里的字按 4 字一组，八成以上落在同一条消息里算找到（容个别错字）。
    原话的日期早于记录最早一天（记录轮转掉了）就核不了，跳过。"""
    import datetime as dt
    first, texts = _channel_log()
    if not texts:
        return None
    now = dt.date.today()
    mo, d = (int(x) for x in date.split("-"))
    try:
        day = dt.date(now.year, mo, d)
    except ValueError:
        return None
    if day > now:
        day = day.replace(year=now.year - 1)
    if day.isoformat() < first:
        return None
    q = _norm(quote)
    grams = {q[i:i + 4] for i in range(max(1, len(q) - 3))}
    need = max(1, int(len(grams) * 0.8 + 0.999))
    return any(sum(g in t for g in grams) >= need for t in texts)


def _gh_pr(repo, num, lines):
    """PR 号用 gh 查：链接带仓库直接查；只写号时在当前目录的仓库查。没 gh、没网络、不在仓库里都跳过不拒。"""
    if not shutil.which("gh"):
        return None
    args = ["gh", "pr", "view", num, "--json", "number"]
    if repo:
        args += ["--repo", repo]
    elif not _git_top(Path.cwd()):
        return None
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode == 0:
        return True
    err = r.stderr.lower()
    return False if ("could not resolve to a pullrequest" in err or "no pull requests found" in err) else None


def verify_facts(text, rules, limit=FACT_MAX):
    """带 verify 的 fact 检查逐条核对写的内容，最多核 limit 条（核不了的不算数），返回每条检查一段报错。"""
    lines, lead, left, errs = text.splitlines(), rules["lead"], limit, []
    for c in rules["checks"]:
        if left <= 0:
            break
        if c.get("tier") != "fact" or "verify" not in c:
            continue
        bad = []
        for shown, ok in _claims(c, lines, lead):
            if left <= 0:
                break
            got = ok()
            if got is None:
                continue
            left -= 1
            if not got:
                bad.append(shown)
        if bad:
            errs.append(c["verify"]["msg"].replace("{items}", "、".join(dict.fromkeys(bad))))
    return errs


def check_tiered(text, rules=None, fmt=None):
    """按档查：fact 检查全开并真核内容；format 检查只在 fmt（默认按主角色后端 ds_lead()）时开。返回所有问题，一次报完。"""
    rules = rules or load()
    fmt = ds_lead() if fmt is None else fmt
    lines, lead = text.splitlines(), rules["lead"]
    # 带 verify 的 fact 检查，「有没有写这一节」本身是格式，也只给 DS 类；强模型只核写了的内容对不对
    picked = [c for c in rules["checks"] if fmt or (c.get("tier", "format") == "fact" and "verify" not in c)]
    errs = [e for c in picked for e in [_check(c, lines, lead)] if e]
    return errs + verify_facts(text, rules)
