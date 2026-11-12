# 交接比用户原话多出来的设定：逐条对照「总目标/范围」每一行和用户原话，原话里没有的设定（换角色、加梗、加受众假设、
# 加产品露出、加审核步骤……）拦下，要求删掉或移进「## 我加的（原话没有）」并写理由。ws-handoff 用（added_gate）。
# 用户给了参考（视频、链接、「参考 X 那种」）时，默认做法是「照搬参考，只改用户点名要改的」，偏离参考的每一处都算加的。
# 来源：#1223 追加项，用户 11-08 03:2x「你老是自己想自己的，想一坨屎出来……这个问题不是第一，第二次了……
#   这种自己给自己加狗狗屎思想」；例：用户说照搬大肥鱼爆款，交接写成英文圈爆款、三个脚本先审、用我们自己的角色。
# 模型：claude -p（无工具、不读设置、不挂 hook），默认 sonnet（ADDED_JUDGE_MODEL 可改）；超时、出错、没装 claude 都放行。
# 命令行：_added_judge.py <交接文件>  → 打一行 JSON（有加的 exit 3，否则 0）。
import json, os, re, subprocess, sys, tempfile, time
from pathlib import Path

MODEL = os.environ.get("ADDED_JUDGE_MODEL", "sonnet")
TIMEOUT = int(os.environ.get("ADDED_JUDGE_TIMEOUT", "90"))
LOG = Path.home() / ".bothouse" / "logs" / "added-judge.tsv"
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
4. 拿不准就不算。宁可漏，不冤枉。

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
    prompt = (f"## 用户原话\n{quotes}\n\n## 交接的总目标和范围（逐行检查这里）\n{judged}\n\n"
              f"## 派活人加的（原话没有，已写理由）\n{own or '（没有）'}")
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
