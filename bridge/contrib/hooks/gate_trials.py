#!/usr/bin/env python3
"""新检查先只记录，量过误拦才拦（#1924；用户 11-23「为什么那么傻逼并行把根也修一下」）。

起因：#1907 的文案检查一上线就直接拦，聊天回复里有「帖子」就整条换成「文案检查没过」，18:55 把配图方案吞了。
「先只记录」以前只写在规矩里，没有程序管。现在由 run.py 统一管：钩子要拦（block / deny / exit 2）或要整条替换回复时，
先问本文件：

- 检查名：钩子输出里的 bothouse_check，没写就是钩子名（run.py <钩子名>）。
- 能拦：名字在登记表 gate-trials.json 的 legacy 里（#1924 之前就在拦的旧钩子，测试冻住这份名单，往后不许加），
  或者它最近一次回放记录达标：回放至少 MIN_REPLAYS 条真实回复，拦错不超过 MAX_WRONG 条且不超过 MAX_RATE。
- 不能拦：只往 LOG 记一行（时间、检查名、动作、会话、原因、回复开头），然后放行。
- 整条替换回复：只有回放达标的检查能做（legacy 不算），替换时原稿附在提示后面，用户总能看到原稿。

回放（拿最近几天角色会话里的真实最终回复去跑一个检查，记几条里拦错几条）：
  gate_trials.py replay <检查名> --hook <钩子脚本> [--days 3] [--limit N] [--texts <文件>]
      列出命中（编号从 0 起）。--texts：.jsonl 一行一个 JSON 字符串；别的后缀整个文件就是一条回复。
  gate_trials.py replay ... --record --wrong 0,2 [--source <说明>]
      把这次回放写进登记表：回放几条、命中几条、拦错几条（--wrong 列的命中编号）。
  gate_trials.py status      每个检查现在是拦还是只记录
回放在临时数据目录里跑，不连桥、不写线上状态。
"""
import glob
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.environ.get("GATE_TRIALS_REGISTRY") or os.path.join(HERE, "gate-trials.json")
LOG = os.path.expanduser(os.environ.get("GATE_TRIALS_LOG") or "~/.bothouse/logs/gate-trials.tsv")
MIN_REPLAYS, MAX_WRONG, MAX_RATE = 30, 1, 0.05  # SPEC：主角色 11-23 19:49 批的方案 A（#1924）
ORIGINAL = "\n\n（下面是被拦的原稿，照发）\n"


def load(path=None):
    try:
        with open(path or REGISTRY, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    d.setdefault("legacy", [])
    d.setdefault("checks", {})
    return d


def measured(name, reg=None):
    """最近一次回放达标没有。"""
    recs = ((reg or load())["checks"].get(name) or {}).get("replays") or []
    if not recs:
        return False
    r = recs[-1]
    n, wrong = int(r.get("replayed") or 0), int(r.get("wrong") or 0)
    return n >= MIN_REPLAYS and wrong <= MAX_WRONG and wrong <= MAX_RATE * n


def may_block(name, reg=None):
    reg = reg or load()
    return name in reg["legacy"] or measured(name, reg)


def may_replace(name, reg=None):
    return measured(name, reg)


def log(name, action, session, why, text):
    clean = lambda s: " ".join(str(s or "").split())
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write("\t".join([time.strftime("%Y-%m-%dT%H:%M:%S%z"), name, action, clean(session),
                               clean(why)[:200], clean(text)[:200]]) + "\n")  # 沿用已有配置：house-checks.tsv 的截断
    except OSError:
        pass


def block_of(rc, stdout, stderr=""):
    """钩子这次答的是不是拦/替换，和原因。返回 (kind, check, why)；kind 为 None 表示没拦。"""
    try:
        d = json.loads(stdout or "{}")
    except ValueError:
        d = {}
    if not isinstance(d, dict):
        d = {}
    hs = d.get("hookSpecificOutput") if isinstance(d.get("hookSpecificOutput"), dict) else {}
    check = d.get("bothouse_check") or ""
    if d.get("bothouse_replace"):
        return "replace", check, d.get("bothouse_replace")
    if d.get("decision") == "block":
        return "block", check, d.get("reason")
    if hs.get("permissionDecision") == "deny":
        return "block", check, hs.get("permissionDecisionReason")
    if rc == 2:  # SPEC：Claude Code 钩子协议 exit 2 = 拦
        return "block", check, stderr
    return None, check, ""


# ---- 回放 ----
def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def session_replies(path):
    """一份 Claude Code 会话记录里，每轮（用户真说话的那条之后）最后一条助手文字。"""
    out, last = [], ""
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return out
    with f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            msg = d.get("message") or {}
            if d.get("type") == "user" and text_of(msg.get("content")).strip():
                if last:
                    out.append(last)
                last = ""
            elif d.get("type") == "assistant":
                t = text_of(msg.get("content"))
                if t.strip():
                    last = t
    if last:
        out.append(last)
    return out


def recent_replies(days, limit):
    cut = time.time() - days * 86400
    files = [p for p in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")) if os.path.getmtime(p) >= cut]
    texts = []
    for p in sorted(files, key=os.path.getmtime, reverse=True):
        texts += [t for t in session_replies(p) if t.strip()]
        if limit and len(texts) >= limit:
            break
    return texts[:limit] if limit else texts


def read_texts(path):
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    if path.endswith(".jsonl"):
        return [json.loads(l) for l in raw.splitlines() if l.strip()]
    return [raw]


def replay_one(hook, text, work):
    tr = os.path.join(work, "t.jsonl")
    with open(tr, "w", encoding="utf-8") as f:
        f.write(json.dumps({"type": "user", "message": {"content": "（回放）"}}, ensure_ascii=False) + "\n")
        f.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}},
                           ensure_ascii=False) + "\n")
    payload = {"hook_event_name": "Stop", "session_id": "replay", "transcript_path": tr, "cwd": work,
               "stop_hook_active": False}
    env = {k: v for k, v in os.environ.items() if not k.startswith("CC_")}
    env.update(CC_DATA_DIR=os.path.join(work, "data"), BOTHOUSE_DATA_DIR=os.path.join(work, "data"),
               HOUSE_CHECKS_LOG=os.path.join(work, "hc.tsv"), GATE_TRIALS_LOG=os.path.join(work, "gt.tsv"))
    p = subprocess.run([sys.executable, "-I", hook], input=json.dumps(payload, ensure_ascii=False),
                       capture_output=True, text=True, env=env, cwd=work)
    return block_of(p.returncode, p.stdout, p.stderr)


def replay(argv):
    import argparse
    ap = argparse.ArgumentParser(prog="gate_trials.py replay")
    ap.add_argument("check")
    ap.add_argument("--hook", required=True)
    ap.add_argument("--days", type=float, default=3)  # SPEC：交接范围「拿最近几天真实回复回放」
    ap.add_argument("--limit", type=int)
    ap.add_argument("--texts")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--wrong", default="")
    ap.add_argument("--source", default="")
    a = ap.parse_args(argv)
    texts = read_texts(a.texts) if a.texts else recent_replies(a.days, a.limit)
    hits = []
    with tempfile.TemporaryDirectory(prefix="gate-replay-") as work:
        for t in texts:
            kind, _, why = replay_one(os.path.abspath(a.hook), t, work)
            if kind:
                hits.append((t, why))
    for i, (t, why) in enumerate(hits):
        print("[%d] %s\n    原因：%s" % (i, " ".join(t.split())[:120], " ".join(str(why).split())[:120]))
    wrong = sorted({int(x) for x in a.wrong.split(",") if x.strip()})
    bad = [w for w in wrong if w >= len(hits)]
    if bad:
        sys.exit("--wrong 里的编号没有对应的命中：%s" % bad)
    print("回放 %d 条，命中 %d 条，标为拦错 %d 条" % (len(texts), len(hits), len(wrong)))
    if a.record:
        reg = load()
        rec = {"date": time.strftime("%Y-%m-%d %H:%M"), "replayed": len(texts), "blocked": len(hits),
               "wrong": len(wrong), "source": a.source or (a.texts or "最近 %g 天会话" % a.days),
               "wrong_samples": [" ".join(hits[w][0].split())[:80] for w in wrong]}
        reg["checks"].setdefault(a.check, {}).setdefault("replays", []).append(rec)
        with open(REGISTRY, "w", encoding="utf-8") as f:
            json.dump(reg, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("已记进 %s；%s 现在%s" % (REGISTRY, a.check, "可以拦" if may_block(a.check, reg) else "只记录"))


def status():
    reg = load()
    for n in sorted(set(reg["legacy"]) | set(reg["checks"])):
        recs = (reg["checks"].get(n) or {}).get("replays") or []
        mode = "拦" if measured(n, reg) else ("拦（旧，没量过）" if n in reg["legacy"] else "只记录")
        extra = "，最近回放 %s 条拦错 %s 条" % (recs[-1]["replayed"], recs[-1]["wrong"]) if recs else ""
        print("%s\t%s%s" % (n, mode, extra))


if __name__ == "__main__":
    if sys.argv[1:2] == ["replay"]:
        replay(sys.argv[2:])
    elif sys.argv[1:2] == ["status"]:
        status()
    else:
        sys.exit(__doc__)
