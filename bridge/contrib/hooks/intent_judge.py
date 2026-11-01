#!/usr/bin/env python3
"""该自己定还是该问：小模型对照「产品意图卡」和用户最近原话，判断一段草稿（要发给用户的问题，或要交给工作区的交接）。
三选一：self = 按用户定过的话能推出答案，不该问（附答案和依据）；conflict = 与用户定过的冲突（附哪条和合定案的做法）；
pass = 真是方向/花钱，或与定案无关，放行。超时、出错、没装 claude 一律 pass，不卡回复、不卡交接。
来源：用户 2026-10-31「这个太笨了……我不想什么事情都要我说，你自己思考」「有没有更好的办法，更智能的办法」——
关键词拦截只认字面、推不出答案，换成带意图卡的模型判断。
调用方：choice-ask-guard.py（Stop，发问出口）、../lead/ws-handoff（交接出口）。

意图卡：本文件同目录 intent-cards.txt 一行一个路径（# 开头是注释，~ 可用）；没有这个文件就只看用户原话。
模型：Haiku（claude -p，无工具、不读设置、不挂 hook）；每次延迟和花费记到 ~/.bothouse/logs/intent-judge.tsv。
命令行：intent_judge.py --file <交接文件>  → 打一行 JSON 结果（pass 时 exit 0，否则 exit 3）。"""
import json, os, subprocess, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CARDS = HERE / "intent-cards.txt"
LOG = Path.home() / ".bothouse" / "logs" / "intent-judge.tsv"
MODEL = os.environ.get("INTENT_JUDGE_MODEL", "haiku")
TIMEOUT = 20  # 秒；Stop hook 总超时 30 秒（settings.json 现值），留余量

SYSTEM = """你是一个判断器。助手（产品经理）准备把一段话发给用户，或把一份交接交给执行者。你判断这里面要用户拍板的事，助手是不是本该自己定。
用户最讨厌两件事：一是拿按他以前的话或常识就能推出答案的事来问他（他说「我不想什么事情都要我说，你自己思考」）；二是做法和他已经定过的事冲突。

判断步骤：
1. 找出草稿里交给用户拍板的问题、选项，或者交接里定下的做法。只是陈述、反问自己、引用别人的话、问队友的，不算。
2. 对照「产品意图卡」和「用户最近的话」：
   - 草稿把问题交给用户，而按卡上的原则、用户原话或明显常识能推出答案 → self（哪怕选项里有一个和定案相反，只要合定案的那个就在选项里，也算 self）。
   - 草稿自己推荐的做法、交接里定下的做法违背卡上某条或用户原话（哪怕用户没直接说过这个问题），或者合定案的做法根本不在草稿里 → conflict。
   - 卡上没写的事不算冲突：卡只列用户定过的，没列的不等于被否定。
   - 卡和原话都推不出来、用户没选过的路线（方向），或要花用户的钱、要用户本人动手/看成品才能定 → pass。
   - 草稿里没有要用户拍板的事 → pass。
3. 拿不准就 pass。不要因为问题看起来重要就 pass；看能不能推出来。

只输出一个 JSON 对象，不要别的字：
{"verdict":"self|conflict|pass","question":"被判断的那个问题或做法，一句话","answer":"你推出的答案或合定案的做法（pass 时空）","basis":"依据：卡上哪条或用户哪天哪句原话（pass 时写为什么放行）"}"""


def load_cards():
    out = []
    try:
        lines = CARDS.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for l in lines:
        l = l.strip()
        if not l or l.startswith("#"):
            continue
        p = Path(os.path.expanduser(l))
        try:
            out.append(f"### {p.stem}\n" + p.read_text(encoding="utf-8"))
        except OSError:
            continue
    return "\n\n".join(out)


def _log(kind, verdict, ms, cost, q):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}\t{kind}\t{verdict}\t{ms}\t{cost}\t{q[:60]}\n")
    except OSError:
        pass


def judge(draft, user_msgs=(), kind="reply"):
    """返回 dict(verdict, question, answer, basis, ms, cost)；出任何错都返回 verdict=pass。"""
    cards = load_cards()
    prompt = (f"## 产品意图卡\n{cards or '（没有）'}\n\n"
              f"## 用户最近的话（旧→新）\n" + ("\n".join(f"- {m}" for m in user_msgs) or "（没有）") +
              f"\n\n## 草稿（{'要发给用户的回复' if kind == 'reply' else '要交给执行者的交接'}）\n{draft}")
    t0 = time.time()
    res = {"verdict": "pass", "question": "", "answer": "", "basis": "", "ms": 0, "cost": 0}
    try:
        p = subprocess.run(
            ["claude", "-p", "--model", MODEL, "--tools", "", "--setting-sources", "", "--strict-mcp-config",
             "--no-session-persistence", "--system-prompt", SYSTEM, "--output-format", "json"],
            input=prompt, capture_output=True, text=True, timeout=TIMEOUT, cwd=tempfile.gettempdir())
        d = json.loads(p.stdout)
        res["cost"] = round(d.get("total_cost_usd") or 0, 5)
        txt = (d.get("result") or "").strip()
        j = json.loads(txt[txt.find("{"):txt.rfind("}") + 1])
        if j.get("verdict") in ("self", "conflict", "pass"):
            res.update({k: str(j.get(k, "")) for k in ("verdict", "question", "answer", "basis")})
    except Exception as e:  # 超时、没装 claude、输出不是 JSON：放行
        res["basis"] = f"判断器出错，放行：{type(e).__name__}"
    res["ms"] = int((time.time() - t0) * 1000)
    _log(kind, res["verdict"], res["ms"], res["cost"], res["question"] or draft.strip()[:60])
    return res


def main(argv):
    if argv[:1] != ["--file"] or len(argv) != 2:
        sys.exit("用法：intent_judge.py --file <交接文件>")
    r = judge(Path(argv[1]).read_text(encoding="utf-8"), kind="handoff")
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0 if r["verdict"] == "pass" else 3)


if __name__ == "__main__":
    main(sys.argv[1:])
