# 交接比用户原话多出来的设定：逐条对照「总目标/范围」每一行和用户原话，原话里没有的设定（换角色、加梗、加受众假设、
# 加产品露出、加审核步骤……）拦下，要求删掉或移进「## 我加的（原话没有）」并写理由。conflict-check 用（judge_view）；ws-handoff 2026-11-24 起不再调。
# 用户给了参考（视频、链接、「参考 X 那种」）时，默认做法是「照搬参考，只改用户点名要改的」，偏离参考的每一处都算加的。
# 来源：#1223 追加项，用户 11-08 03:2x「你老是自己想自己的，想一坨屎出来……这个问题不是第一，第二次了……
#   这种自己给自己加狗狗屎思想」；例：用户说照搬大肥鱼爆款，交接写成英文圈爆款、三个脚本先审、用我们自己的角色。
# #1893 11-23：规则表强制写进交接的行（如界面活的「用户视角走查」）以前被判成「自己加的」，来回退三次；现在判官
#   先读总表 [[check]] 的 requires 和交接规则的 need_re，把这些行从要判的正文里拿掉，一行不剩就不调模型。
# 模型：claude -p（无工具、不读设置、不挂 hook），默认 sonnet（ADDED_JUDGE_MODEL 可改）；超时、出错、没装 claude 都放行。
# 命令行：_added_judge.py <交接文件>  → 打一行 JSON（有加的 exit 3，否则 0）。
import json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

MODEL = os.environ.get("ADDED_JUDGE_MODEL", "sonnet")
TIMEOUT = int(os.environ.get("ADDED_JUDGE_TIMEOUT", "90"))
LOG = Path.home() / ".bothouse" / "logs" / "added-judge.tsv"
# 规则表（用户 11-23「这个不是修过么，规则统一管理，怎么还会冲突」）：总表在 ~/wiki/rules/house-rules.toml，
# 每道交接检查在 [[check]] 登记它强制写进交接的行（requires.re）；判官读这里，规则表强制的内容一律不算「加的」。
# 规则表里没登记、但交接规则表 needs_if 要求写的写法，同样放行（规则改了自动跟上，不用抄一份）。
HOUSE_RULES = Path(os.environ.get("HOUSE_RULES") or Path.home() / "wiki" / "rules" / "house-rules.toml")
HANDOFF_RULES = Path(os.environ.get("HANDOFF_RULES") or Path(__file__).with_name("handoff-rules.json"))
HANDOFF_LOCAL = Path(os.environ.get("HANDOFF_RULES_LOCAL")
                     or Path(__file__).with_name("handoff-rules.json").parent.parent / "handoff-rules.local.json")
HANDOFF_STRICT = HANDOFF_RULES.with_name("handoff-rules.strict.json")
OWN = "我加的"          # 节名：「## 我加的（原话没有）」
QUOTE_HEAD = "原话"     # 标题含「原话」的节都算用户原话（用户原话、补充原话……），程序附的「原话出处」除外
JUDGED = ("总目标", "范围")
SKIP_HEAD = re.compile(r"程序|出处")

SYSTEM = """你是交接检查器。产品经理（派活人）把用户的话写成交接交给执行者。用户最恨派活人把自己的想法塞进交接：换角色、加梗、加受众假设、加产品露出、加审核/审稿/先交脚本等步骤、扩范围、改用户点名的做法。
你逐条看「总目标」「范围」的每一行，对照「用户原话」，找出原话里没有、也推不出来的设定。

规则：
1. 只算「设定」：会改变交付什么、做成什么样、给谁看、要不要多走一道流程的决定。纯执行手段（用哪个工具/接口/脚本、文件放哪、怎么渲染、怎么核对、按原话去做的必要步骤、复述原话）不算。
2. 用户给了参考（视频、链接、「参考 X 那种」「照着 X」）：默认做法是照搬参考，只改用户点名要改的。交接里偏离参考的每一处（换主角、换对标来源、换题材/结构、加故事、加梗、改风格）都算加的。
3. 原话里明确说了的、「派活人加的」节里已经列出并写了理由的、或那一行写明出自用户以前定过的话（带 wiki 文件:行 或日期加原话）的，不算。
4. 修这件活路上撞上的误拦、修检查/守卫本身（交接要改的就是某道检查，它又误拦了这件活或同类活；把误拦的检查放宽、关掉、修判定）不算扩范围，是做完这件活的必要步骤（#1527，11-12 22:29 把「顺手修误拦」判成扩范围连拦两次）。
5. 拿不准就不算。宁可漏，不冤枉。

只输出一个 JSON 对象，不要别的字：
{"added":[{"line":"交接里那一行（原样摘一段）","what":"多出来的设定，一句话","why":"原话怎么说的 / 参考是什么样，为什么推不出来"}]}
没有就 {"added":[]}。"""


def _head(l):
    return l.lstrip().startswith("#")


def sections(text, pred):
    out, on = [], False
    for l in text.splitlines():
        if _head(l):
            on = pred(l)
        if on:
            out.append(l)
    return "\n".join(out).strip()


def parts(text):
    """(用户原话, 总目标+范围, 我加的)；交接里没原话或没总目标/范围就返回 None。"""
    quotes = sections(text, lambda h: QUOTE_HEAD in h and not SKIP_HEAD.search(h))
    quotes += "\n" + "\n".join(l for l in text.splitlines() if re.match(r"\s*[-*]?\s*用户原话\s*[:：]", l))
    judged = sections(text, lambda h: any(n in h for n in JUDGED) and not SKIP_HEAD.search(h))
    own = sections(text, lambda h: OWN in h)
    if not quotes.strip() or not judged:
        return None
    return quotes.strip(), judged, own


def _rule_table():
    """总表里交接检查强制要写的行：(名字, 正则)。读不到总表（别的机器）就当没有。
    judge = false 的行（三节标题、「改：」这类通用骨架）不拿掉：那几行里的设定照样要判。"""
    try:
        import tomllib
        cfg = tomllib.loads(HOUSE_RULES.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for c in cfg.get("check", []):
        if c.get("artifact") != "交接":
            continue
        for r in c.get("requires", []):
            if r.get("re") and r.get("judge", True) and c.get("judge", True):
                try:
                    out.append((r.get("name") or c.get("id", "?"), re.compile(r["re"])))
                except re.error:
                    continue
    return out


def _rule_needs():
    """交接规则表里 needs_if 检查要求写的写法（need_re）：规则在 json 里改了，这里自动跟上。"""
    out = []
    for p in (HANDOFF_RULES, HANDOFF_STRICT, HANDOFF_LOCAL):
        try:
            d = json.loads(Path(p).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for c in d.get("checks", []):
            if c.get("type") == "needs_if" and c.get("need_re"):
                try:
                    out.append((c.get("id", "?"), re.compile(c["need_re"])))
                except re.error:
                    continue
    return out


def mandated(judged):
    """从要判的正文里拿掉规则表强制要写的行：返回（剩下的正文, 拿掉的行）。标题行不动。
    用户 11-23：规则表逼着写进去的那一行，在判官看来不能算「我自己加的」。"""
    res = _rule_table() + _rule_needs()
    keep, drop = [], []
    for l in judged.splitlines():
        if l.strip() and not _head(l) and any(rx.search(l) for _, rx in res):
            drop.append(l.strip())
        else:
            keep.append(l)
    return "\n".join(keep).strip(), drop



def _log(verdict, ms, cost, head):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(f"{time.strftime('%F %T')}\t{verdict}\t{ms}\t{cost}\t{head}\n")
    except OSError:
        pass


def judge(text):
    """返回 dict(added=[...], cost, ms, error)；出错时 added 为空（放行），error 写原因。"""
    t0, res = time.time(), {"added": [], "cost": 0, "ms": 0, "error": ""}
    got = parts(text)
    if not got:
        return res
    quotes, judged, own = got
    judged, mandated_lines = mandated(judged)
    if not any(l.strip() and not _head(l) for l in judged.splitlines()):
        # 要判的全是规则表强制要写的行（#1893：界面活 + 用户视角走查行）：没有可比对的东西，不调模型
        res["ms"] = int((time.time() - t0) * 1000)
        _log("pass", res["ms"], 0, text.strip().splitlines()[0][:60] if text.strip() else "")
        return res
    allowed = ("\n\n## 规则表强制写进交接、已从上面删掉的行（不算加的）\n" + "\n".join(mandated_lines)) if mandated_lines else ""
    prompt = (f"## 用户原话\n{quotes}\n\n## 交接的总目标和范围（逐行检查这里）\n{judged}\n\n"
              f"## 派活人加的（原话没有，已写理由）\n{own or '（没有）'}{allowed}")
    try:
        p = subprocess.run(["claude", "-p", "--model", MODEL, "--tools", "", "--setting-sources", "", "--strict-mcp-config",
                            "--no-session-persistence", "--system-prompt", SYSTEM, "--output-format", "json"],
                           input=prompt, capture_output=True, text=True, timeout=TIMEOUT, cwd=tempfile.gettempdir())
        d = json.loads(p.stdout)
        res["cost"] = round(d.get("total_cost_usd") or 0, 5)
        # 退出码非 0、is_error、结果里没有 added 都算出错，不当「没多出设定」记 pass（#1492 P4）
        if p.returncode != 0 or d.get("is_error"):
            raise RuntimeError(f"claude 退出码 {p.returncode}{'，is_error' if d.get('is_error') else ''}")
        txt = (d.get("result") or "").strip()
        j = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
        if not isinstance(j, dict) or not isinstance(j.get("added"), list):
            raise ValueError("结果里没有 added 数组")
        res["added"] = [a for a in j["added"] if isinstance(a, dict) and a.get("what")]
    except Exception as e:  # 超时、没装 claude、输出不是 JSON、模型报错：放行，记 error
        res["error"] = f"{type(e).__name__}: {e}"[:120]
    res["ms"] = int((time.time() - t0) * 1000)
    _log("added" if res["added"] else ("error" if res["error"] else "pass"), res["ms"], res["cost"],
         text.strip().splitlines()[0][:60] if text.strip() else "")
    return res


def message(added):
    items = "\n".join(f"- 「{a.get('line', '').strip()[:80]}」：{a['what']}（{a.get('why', '').strip()}）" for a in added)
    return (f"交接比用户原话多出来 {len(added)} 处设定（原话里没有、也推不出来）：\n{items}\n"
            "每处二选一：删掉；或移进新节「## 我加的（原话没有）」，一条一行写这条设定和理由（交回 report 时它进「我加的」给用户看）。"
            "用户给了参考的，默认照搬参考，只改用户点名要改的。示例：\n## 我加的（原话没有）\n- 字幕只留英文：X 号只做英文读者（wiki x-account-profile.md:14）")


if __name__ == "__main__":
    r = judge(Path(sys.argv[1]).read_text(encoding="utf-8"))
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(3 if r["added"] else 0)
