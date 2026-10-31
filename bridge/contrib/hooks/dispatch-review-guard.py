#!/usr/bin/env python3
"""PreToolUse(Agent|Edit|Write|MultiEdit|NotebookEdit)：新行动开工前必须经 subagent 审。
出处：作者 2026-10-16「我看你这两个行动都没审批过」「你这违规怎么避免」；同类违规 5 次以上，文字规则管不住，改成 hook。
方案经审稿 subagent 审过（同日）。
1. Agent：prompt 以【审稿】开头 = 派审稿，必须带逐字引用的用户原话（「」或“”或""），放行；
   带【免审:调研|小改动|一次性脚本|代码审查】的放行（2026-10-17：审稿太费额度，这几类不审）；
   其余派活必须带【已审:<审稿目录下的文件>】，文件存在且含「审稿结论」，每份只能用一次（审后再改要再审）。
   审稿目录：环境变量 HOOK_REVIEWS_DIR，默认 ~/.claude/reviews。
2. 主会话（hook 输入里没有 agent_id）直接 Edit/Write 代码：拒绝，具体任务派给 subagent。
   放行 ~/.claude、/tmp、/private/tmp、wiki 目录（GATE_WIKI，默认 ~/wiki，同 bothouse 的 gate），
   以及环境变量 HOOK_FREE_DIRS 里列的目录（用系统路径分隔符隔开）。
   文档先用 Bash 跑 `python3 <本目录>/doc-ok.py <文件>` 登记，本会话内该文件放行（2026-10-19「直接加上文档，就能免hook」）。
   提示词、SPEC、agent 定义不算文档。subagent 的编辑不拦。
3. 可选：环境变量 HOOK_RESEARCHER_DIRS 列出的工作目录（用系统路径分隔符隔开）里，【免审:调研】开头的派活必须是
   subagent_type "researcher" 或 model 含 "sonnet"，否则拒绝（作者 2026-10-17「开销太大了」：调研用便宜的模型）。
   审稿和代码审查不受限。不设就不查（这条依赖该目录下定义了 researcher 子 agent）。
已知局限：主会话用 Bash 改文件拦不住；主会话伪造审稿文件拦不住。"""
import json, os, re, sys

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import plan_gate  # noqa: E402  要方案未批时拦开做（用户 2026-10-28）
NOTES_DIR = os.path.join(os.getcwd(), "notes")  # 写方案、交接稿不拦
REVIEWS = os.path.expanduser(os.environ.get("HOOK_REVIEWS_DIR") or os.path.join(HOME, ".claude", "reviews"))
USED = os.path.join(REVIEWS, ".used")
DOCS = os.path.join(REVIEWS, ".docs")
_wiki = os.environ.get("GATE_WIKI", "~/wiki").strip()  # 同 bridge/contrib/gate/ctxsvc.py
FREE_DIRS = [os.path.join(HOME, ".claude"), "/tmp", "/private/tmp"] + \
    ([os.path.expanduser(_wiki)] if _wiki.lower() not in ("", "off") else []) + \
    [os.path.expanduser(x) for x in os.environ.get("HOOK_FREE_DIRS", "").split(os.pathsep) if x.strip()]
RESEARCH_DIRS = [os.path.expanduser(x) for x in os.environ.get("HOOK_RESEARCHER_DIRS", "").split(os.pathsep) if x.strip()]
QUOTE = re.compile(r"「[^」]{4,}」|“[^”]{4,}”|\"[^\"]{4,}\"")


def deny(msg):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": msg}}, ensure_ascii=False))
    sys.exit(0)


def check_agent(prompt):
    head = prompt.lstrip()
    if head.startswith("【审稿】"):
        if not QUOTE.search(prompt):
            deny("派审稿必须逐字引用用户原话（「」或“”），不给自己的转述。")
        return
    # 用户 2026-10-17：审稿太费额度，调研、小改动、一次性脚本不审；代码审查：用户 2026-10-17「代码审查也改回 opus」
    if re.search(r"【免审:(调研|小改动|一次性脚本|代码审查)】", prompt):
        return
    m = re.search(r"【已审:([^】]+)】", prompt)
    if not m:
        deny(f"新行动没审。三种写法任选其一：\n"
             "1. 调研、小改动、一次性脚本、代码审查：prompt 开头写【免审:调研】【免审:小改动】【免审:一次性脚本】【免审:代码审查】之一；\n"
             f"2. 派审稿：prompt 以【审稿】开头，逐字引用用户原话，结论写到 {REVIEWS}/<名>.md（含「审稿结论」）；\n"
             "3. 审过的活：prompt 里写【已审:<该审稿文件路径>】，一份只用一次。")
    path = os.path.realpath(os.path.expanduser(m.group(1).strip()))
    if not path.startswith(os.path.realpath(REVIEWS) + os.sep) or not os.path.isfile(path):
        deny(f"【已审】指向的文件不在 {REVIEWS} 或不存在：{path}")
    if "审稿结论" not in open(path, encoding="utf-8", errors="ignore").read():
        deny(f"审稿文件里没有「审稿结论」：{path}")
    used = set(open(USED).read().split("\n")) if os.path.exists(USED) else set()
    if path in used:
        deny(f"这份审稿已经用过一次：{path}。审后再改或新行动要再审。")
    os.makedirs(REVIEWS, exist_ok=True)
    with open(USED, "a") as f:
        f.write(path + "\n")


def check_bot_model(cwd, inp):
    cwd = os.path.realpath(os.path.expanduser(cwd or ""))
    if not any(cwd == b or cwd.startswith(b + os.sep) for b in map(os.path.realpath, RESEARCH_DIRS)):
        return
    if not (inp.get("prompt") or "").lstrip().startswith("【免审:调研】"):
        return
    if inp.get("subagent_type") == "researcher" or "sonnet" in str(inp.get("model") or "").lower():
        return
    deny('这个工作目录派调研要用便宜的模型：Agent 传 subagent_type: "researcher"（审稿、代码审查、写代码用默认 general-purpose）。')

def doc_tagged(session, path):
    """主会话先跑 `doc-ok <文件>` 登记过（同一会话、同一文件）才放行。"""
    try:
        return f"{session}\t{path}" in open(DOCS, encoding="utf-8").read().split("\n")
    except Exception:
        return False


SMALL_EDIT_LINES = 10


def _data_dir():
    return os.path.expanduser(os.environ.get("BOTHOUSE_DATA_DIR") or os.environ.get("GATE_SETUP_DIR")
                              or os.path.join(HOME, ".bothouse"))


def in_workspace():
    """工作区就是干活的地方：工作区会话直接改代码，不再开子任务、不再问授权。
    作者 2026-10-28「复杂长程任务，就交回给那个工作区啊……这种我不都已经授权过了吗？为什么还要…问我」。
    工作区：bothouse 记在 <数据目录>/team_workspaces.json 里的频道（parents 的工作区或 handoffs 的键）。"""
    chan = os.environ.get("CC_SESSION_KEY", "").split(":")[-1]
    if len(os.environ.get("CC_SESSION_KEY", "").split(":")) >= 3:
        chan = os.environ["CC_SESSION_KEY"].split(":")[1]
    if not chan:
        return False
    try:
        st = json.load(open(os.path.join(_data_dir(), "team_workspaces.json"), encoding="utf-8"))
    except Exception:
        return False
    ids = {w.get("id") for ws in (st.get("parents") or {}).values() for w in (ws or []) if isinstance(w, dict)}
    ids |= {k.split(":")[1] if ":" in k else k for k in (st.get("handoffs") or {})}
    return chan in ids


def small_edit(tool, inp):
    """聊天频道主会话：几行的小改直接改（作者同日「主命令如果简单的话，就直接可以直接改」）。"""
    if tool == "Edit":
        edits = [inp]
    elif tool == "MultiEdit":
        edits = inp.get("edits") or []
    else:
        return False
    n = sum(max(len((e.get("old_string") or "").splitlines()), len((e.get("new_string") or "").splitlines()))
            * (len(edits) if e.get("replace_all") else 1) for e in edits)
    return 0 < n <= SMALL_EDIT_LINES


def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return
    tool, inp = d.get("tool_name", ""), d.get("tool_input", {}) or {}
    if not d.get("agent_id") and tool in ("Agent", "Task", "Edit", "Write", "MultiEdit", "NotebookEdit"):
        p = os.path.realpath(os.path.expanduser(inp.get("file_path") or inp.get("notebook_path") or ""))
        free = p and any(p == x or p.startswith(os.path.realpath(x) + os.sep) for x in FREE_DIRS + [NOTES_DIR])
        if not free:
            asked = plan_gate.pending(d.get("transcript_path"))
            if asked:
                deny(plan_gate.message(asked))
    if tool in ("Agent", "Task"):
        check_bot_model(d.get("cwd", ""), inp)
        check_agent(inp.get("prompt", ""))
    elif tool in ("Edit", "Write", "MultiEdit", "NotebookEdit") and not d.get("agent_id"):
        p = os.path.realpath(os.path.expanduser(inp.get("file_path") or inp.get("notebook_path") or ""))
        # notes/ 是方案和交接稿（ws-handoff 必需），按会话 cwd 算，不是代码改动
        notes = os.path.join(d.get("cwd") or os.getcwd(), "notes")
        if p and not any(p == x or p.startswith(os.path.realpath(x) + os.sep) for x in FREE_DIRS + [NOTES_DIR, notes]) \
                and not doc_tagged(d.get("session_id"), p) \
                and not in_workspace() and not small_edit(tool, inp):
            deny(f"聊天频道主会话只直接改 {SMALL_EDIT_LINES} 行以内的小改（人设里的 hook 规则「分工」）：{p}。"
                 f"大改交工作区（ws-handoff），工作区里直接改；或派给 subagent（小改动在派活 prompt 开头写【免审:小改动】）；"
                 f"若是文档，先跑 `python3 {HERE}/doc-ok.py <文件>` 登记。")


if __name__ == "__main__":
    main()
