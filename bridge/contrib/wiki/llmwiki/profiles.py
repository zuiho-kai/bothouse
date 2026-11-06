"""懂你画像，每人一页（board #1160）。

Why (user 2026-11-07): 「现在我们有对每个用户去做人物画像吗，例如还有zzzx，我想把这个做成一个产品能力，因为我们这个之后会
往团队那边扩展」; 11-03 「这个应该默认的呀」. Before this the wiki had one 「懂你」 page (the owner's, rewritten nightly from
his words) and the gate pushed it to every session whoever was talking.

Now each person a bridge has heard has a page, rewritten nightly from that person's own words:

  words   <session record store>/people/<platform>-<sender id>.jsonl, one record per message the person sent, written
          by the bridge (bridge/core/people_said.go; several bots on one machine each write the same message, the
          copies are dropped here: same ts second and text)
  page    <wiki>/<PROFILE_DIR>/profile-<platform>-<sender id>.md, same five sections, line format and 「历史」 as the
          owner's page had (SOP below, moved here from ingest.py profile_pass); a person with few words gets a thin page
  push    the gate's /context pushes the page of whoever sent the turn's message (contrib/gate/ctxsvc.py
          profile_items), nobody else's

  run(repo, lo, hi, ask, log, skip=(), commit=True)   rewrite the page of each person who said something in [lo, hi)
  rewrite(repo, key, name, transcript, citations, ask, log)   one person's page from a transcript of his USER lines
"""
import calendar, json, os, re, time
from pathlib import Path

PROFILE_DIR = "tooling/workflow/workflow/preferences"  # same as the gate's GATE_PROFILE (bridge/core/gate_proc.go)
PAGE = "profile-{key}.md"
PROFILE_LINES = 20  # 方案 11-02 11:30「二十行左右」，用户 11:5x 回「做」
SECTIONS = ("判断标准", "在意什么", "说话和情绪", "审美口味", "生活和兴趣")
LINE = re.compile(r"^- (.+)（(\d\d-\d\d)「(.+?)」）$")
HISTORY = "历史"
MAX_CHARS = 240_000  # one call, as ingest.py MAX_CHARS
KEY = re.compile(r"[A-Za-z0-9._-]{1,120}")
SECRET = re.compile(r"(?i)(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|"
                    r"(?:token|password|passwd|secret|api[_-]?key)\s*[:=]\s*\S+)")

SOP = """你在给一位用户的 AI 个人助手团队写「懂你」画像。这一页只写 {name} 这一个人。助手不是纯干活的工具，是他的个人助手：
要懂他是谁、他怎么判断好坏、他在意什么、他说话的习惯和情绪、他的审美和口味。

输入：A. 上一版画像（P 编号: 行）。B. TRANSCRIPT：{name} 自己说的话（USER 行，带 U 编号和频道、时间），只有他的话。

任务：重写一页画像，约 {n} 行，分这几节（每节 0–6 行；他话少就写少，没依据的节空着，不凑）：
- 判断标准：他怎么判断一件事做得好不好
- 在意什么：他看重的东西、他讨厌的东西
- 说话和情绪：他说话的习惯；他着急、骂人、夸人时分别是什么意思，想要助手怎么回应
- 审美口味：视觉、文案、产品上的口味
- 生活和兴趣：工作以外的他（闲聊里看出来的）

规则：
1. 每行一句「他……，所以……」式的描述：前半是观察，后半是助手该怎么做；≤70 字。
2. 每行要有出处：沿用旧行填 keep（P 编号，原样保留）；新写或改写的行填 id（一个 USER 行的 U 编号）和 quote（从那行逐字摘 ≤24 字）。
   没有原话依据的不写。
3. 证据不能只来自挨骂：他夸过的、他接着往下走的（默认收下）、闲聊里聊的，都要用上。
4. 新证据和旧行冲突或更准 → 写新行替掉它（不填 keep）；同义的合成一行；仍然准的旧行填 keep 保留。
5. 不写隐私（住址、证件、健康、家人、财务账户、密码、真实姓名）和密钥；不写具体项目事实（型号、价格、路径），那是事实类记忆。
6. 写的是「他这个人」，不是规则清单；读起来像一个很熟的人写的。
7. 最要紧的是能预测他的反应：什么情况下他会追问「为什么」、什么会让他不满或发火、什么他会直接收下或夸，
   写进「判断标准」「说话和情绪」两节；反复出现的反应优先于只出现一次的。

只输出 JSON，不要别的文字：
{{"lines": [{{"section": "判断标准|在意什么|说话和情绪|审美口味|生活和兴趣", "text": "...", "keep": "<P 编号或空串>", "id": "<U 编号或空串>", "quote": "..."}}]}}

A. 上一版画像：
{old}

B. TRANSCRIPT：
"""


def store():
    return Path(os.path.expanduser(os.environ.get("AGENT_SESSIONS_DIR") or "~/.local/share/agent-sessions"))


def page_rel(key):
    return f"{PROFILE_DIR}/{PAGE.format(key=key)}"


def _ts(iso):
    try:
        return calendar.timegm(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return None


def own_text(text):
    """The person's own words of a recorded message: a quoted reply the platform put in front is dropped
    ("[replying to X: …*]\\n…", "[回复 X：…] …"), as ingest.py speakers() does."""
    t = text.strip()
    if t.startswith("[replying to"):
        end = re.search(r"\*\]\n", t)
        cut = end.end() if end else t.rfind("]\n") + 2
        t = t[cut:] if cut >= 2 else ""
    t = re.sub(r"^\[回复 [^：:\]]{1,40}[：:][^\]]*\] ?", "", t)
    return re.sub(r"<@!?\d+>\s*", "", t).strip()


def people_words(lo, hi, root=None):
    """{key: (latest name, [(ts, channel, text)])} of every person's messages in [lo, hi), oldest first."""
    out = {}
    d = (root or store()) / "people"
    for f in sorted(d.glob("*.jsonl")) if d.is_dir() else []:
        key = f.stem
        if not KEY.fullmatch(key):
            continue
        seen, rows, name = set(), [], key
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            ts = _ts(r.get("ts") or "")
            text = own_text(str(r.get("text") or ""))
            if ts is None or not (lo <= ts < hi) or not text:
                continue
            if (int(ts), text) in seen:
                continue
            seen.add((int(ts), text))
            name = r.get("speaker") or name
            rows.append((ts, r.get("channel") or "", text))
        if rows:
            out[key] = (name, sorted(rows))
    return out


def transcript_of(rows, citations):
    """USER lines with U ids; citations[U] = (MM-DD, "HH:MM channel", text) as ingest.py said_lines()."""
    lines = []
    for ts, ch, text in rows:
        day, hm = time.strftime("%m-%d", time.localtime(ts)), time.strftime("%H:%M", time.localtime(ts))
        text = SECRET.sub("[REDACTED]", text)
        key = f"U{len(citations) + 1}"
        citations[key] = (day, f"{hm} {ch}", text)
        lines.append(f"USER [{day} {hm}] {key} ({ch}): {text}")
    return "\n".join(lines) + "\n"


def read_page(text):
    """画像页 → (现状行 [(节, 原行)], 历史行)。"""
    cur, hist, part, sec = [], [], None, ""
    for ln in text.split("\n"):
        if ln.startswith("## "):
            part = ln[3:].strip()
        elif ln.startswith("### "):
            sec = ln[4:].strip()
        elif part == "现状" and LINE.match(ln):
            cur.append((sec, ln))
        elif part == HISTORY and ln.startswith("- "):
            hist.append(ln)
    return cur, hist


def _norm(t):
    return re.sub(r"[\s，。,.！!？?、：:「」\"'…~～]+", "", t or "")


def as_list(v):
    return v if isinstance(v, list) else []


def rewrite(repo, key, name, transcript, citations, ask, log, rel=None, sop=None, n=PROFILE_LINES,
            head_lines=None):
    """One person's page from `transcript` (his USER lines). `ask(prompt)` answers JSON. Returns (说明, 写了的文件)
    (说明 "" = not written). A rewrite keeps the old page unless at least half its lines (≥ 1) come back good."""
    rel = rel or page_rel(key)
    page = Path(repo) / rel
    old_text = page.read_text(encoding="utf-8") if page.exists() else ""
    cur, hist = read_page(old_text)
    old = "\n".join(f"P{i}: [{s}] {l[2:]}" for i, (s, l) in enumerate(cur)) or "（暂无，第一次写）"
    head = (sop or SOP).format(n=n, old=old, name=name)
    room = MAX_CHARS - len(head)
    ans = ask(head + (transcript[-room:] if len(transcript) > room else transcript))
    good, seen = [], set()
    for x in as_list(ans.get("lines") if isinstance(ans, dict) else None):
        if not isinstance(x, dict) or str(x.get("section")) not in SECTIONS:
            continue
        sec, keep = str(x["section"]), str(x.get("keep") or "").strip().lstrip("Pp")
        if keep.isdigit() and int(keep) < len(cur):
            line = cur[int(keep)][1]
        else:
            ev = citations.get(str(x.get("id") or "").strip())
            text, q = str(x.get("text") or "").strip().rstrip("。"), str(x.get("quote") or "").strip()
            if q and _norm(q) and (not ev or ev[0] == "?" or _norm(q) not in _norm(ev[2])):
                # 模型常漏填或填错 U 编号（11-04 夜丢了 8 条，id 全空）：按原话逐字回查这个人的行补出处（用户 11-05「改吧」）
                ev = next((e for e in citations.values() if e and e[0] != "?" and _norm(q) in _norm(e[2])), ev)
            if not ev or ev[0] == "?" or not text or not q or len(q) > 40 or _norm(q) not in _norm(ev[2]) \
                    or "（" in text[-3:]:
                log(f"profile {key}: line dropped (no matching quote): {x}")
                continue
            line = f"- {text}（{ev[0]}「{q}」）"
        if line not in seen:
            seen.add(line)
            good.append((sec, line))
    need = min(n // 2, max(1, len(cur) // 2))
    if len(good) < need:
        log(f"profile {key}: only {len(good)} good lines (need {need}), last version kept")
        return "", []
    keep = {l for _, l in good}
    gone = [l for _, l in cur if l not in keep]
    stem = Path(rel).stem
    out = head_lines(stem, name) if head_lines else [
        "---", f"name: {stem}",
        f"description: 懂你：{name} 的画像（判断标准、在意什么、说话和情绪、审美口味、生活和兴趣），每行带原话出处，他发消息时注入",
        "metadata:", f"  scope: 助手对 {name}（{key}）这个人的整体画像，夜间 dream 只从他自己的原话滚动重写",
        "---", f"# 懂你：{name}", ""]
    # 这行不带日期：带日期的话每次重写它都变，wiki 的无损检查（lossless.py）会把旧行当成丢了，整页提交被拒
    # （11-06 夜主人那页就这样没提交上）；哪天重写看 log.md
    out += ["夜间 dream 只从他自己的原话重写，新说法替掉旧说法，旧行原样挪进「历史」；他发消息的会话推「现状」一节。",
            "", "## 现状"]
    for sec in SECTIONS:
        rows = [l for s, l in good if s == sec]
        out += ([f"### {sec}"] + rows) if rows else []
    hist_all = list(dict.fromkeys(gone + hist))
    out += (["", "## " + HISTORY] + hist_all) if hist_all else []
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text("\n".join(out) + "\n", encoding="utf-8")
    files = [rel]
    readme = page.parent / "README.md"
    if readme.exists() and f"({page.name})" not in readme.read_text(encoding="utf-8"):
        readme.write_text(readme.read_text(encoding="utf-8").rstrip("\n") +
                          f"\n- [{stem}]({page.name}) — 懂你：{name[:20]}\n", encoding="utf-8")  # wiki lint: 一行 ≤120 字
        files.append(str(readme.relative_to(repo)))
    return f"{len(good)} lines, {len(gone)} replaced", files


def run(repo, lo, hi, ask, log, skip=(), deadline=None, root=None):
    """Rewrite the page of each person (not in `skip`) who said something in [lo, hi). Returns {key: 说明} and the
    files written (the caller commits them with log.md)."""
    done, files = {}, []
    for key, (name, rows) in people_words(lo, hi, root).items():
        if key in skip:
            continue
        if deadline and time.time() > deadline:
            log("profile: night budget used up, the rest waits for tomorrow")
            break
        cites = {}
        try:
            what, fs = rewrite(repo, key, name, transcript_of(rows, cites), cites, ask, log)
        except Exception as e:  # noqa: BLE001 — one person's failed call does not stop the others
            log(f"profile {key} failed: {type(e).__name__}: {e}")
            continue
        if what:
            done[key] = f"{name}: {what}"
            files += fs
    return done, files
