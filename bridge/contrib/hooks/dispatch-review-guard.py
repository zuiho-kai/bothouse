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
import datetime, json, os, re, subprocess, sys

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


# 派审稿先量改动：不到 30 行、又不碰高风险路径的小改动不派审，用脚本验（作者 2026-11-04 加）
REVIEW_TASK = re.compile(r"审|复核|二审|\breview\b", re.IGNORECASE)
PR_NUMBER = re.compile(r"\bPR\s*#?\s*(\d+)\b|\bpull request\s*#?\s*(\d+)\b|/pull/(\d+)\b", re.IGNORECASE)
GITHUB_PR_URL = re.compile(r"https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/pull/(\d+)", re.IGNORECASE)
REPO_AND_PR = re.compile(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\s*(?:#|PR\s*#?)\s*(\d+)\b", re.IGNORECASE)
BRANCH_NAME = re.compile(r"(?:分支(?:名)?|branch(?:\s+name)?)\s*[:：=]?\s*[`\"']?([A-Za-z0-9][A-Za-z0-9._/-]*)", re.IGNORECASE)
RISKY_PATH = re.compile(
    r"(?:^|/)(?:bridge|dsh|deploy(?:ment)?|release|production|prod|online|live|infra|billing|payment|pricing|budget|cost|spend|finance|financial|money|expenses?)(?:/|$)"
    r"|(?:^|/)(?:线上|真钱|花钱|费用)(?:/|$)"
    r"|(?:^|/)\.github/workflows(?:/|$)", re.IGNORECASE)
REVIEW_SIZE_LOG = os.path.join(REVIEWS, "dispatch-review-size.log")  # 查不到改动量的派审记在这里
REVIEW_SIZE_LIMIT = 30


def deny(msg):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                             "permissionDecisionReason": msg}}, ensure_ascii=False))
    sys.exit(0)


def review_target(text):
    url = GITHUB_PR_URL.search(text)
    repo_match = REPO_AND_PR.search(text)
    repo = f"{url.group(1)}/{url.group(2)}" if url else (repo_match.group(1) if repo_match else None)
    if url:
        return {"kind": "pr", "value": url.group(3), "repo": repo}
    pr = PR_NUMBER.search(text)
    if pr:
        number = next(group for group in pr.groups() if group)
        return {"kind": "pr", "value": number, "repo": repo}
    branch = BRANCH_NAME.search(text)
    if branch:
        return {"kind": "branch", "value": branch.group(1).rstrip(".,;:，。；：`\"'"), "repo": None}
    return None


def _gh_json(args, cwd, timeout):
    try:
        result = subprocess.run(["gh", *args], cwd=cwd or None, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            return None
        return json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def _change_record(additions, deletions, files):
    if not isinstance(additions, int) or not isinstance(deletions, int):
        return None
    paths = [f["path"] for f in files if isinstance(f, dict) and isinstance(f.get("path"), str)] if isinstance(files, list) else []
    if not paths:
        return None
    return {"lines": additions + deletions, "paths": paths}


def _pr_change_record_from_data(data):
    if not isinstance(data, dict):
        return None
    files = data.get("files")
    changed_files = data.get("changedFiles")
    if isinstance(changed_files, int) and isinstance(files, list) and len(files) < changed_files:
        return None
    return _change_record(data.get("additions"), data.get("deletions"), files)


def _pr_change_record(number, repo, cwd):
    args = ["pr", "view", str(number)]
    if repo:
        args += ["--repo", repo]
    data = _gh_json([*args, "--json", "additions,deletions,changedFiles,files"], cwd, 1.5)
    return _pr_change_record_from_data(data)


def _branch_pr_record(branch, repo, cwd):
    args = ["pr", "list", "--head", branch, "--state", "all", "--limit", "10"]
    if repo:
        args += ["--repo", repo]
    rows = _gh_json([*args, "--json", "headRefName,additions,deletions,changedFiles,files"], cwd, 1.2)
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and row.get("headRefName") == branch:
                record = _pr_change_record_from_data(row)
                if record:
                    return record
    return None


def _git_branch_record(branch, cwd):
    def git(args):
        try:
            result = subprocess.run(["git", *args], cwd=cwd or None, capture_output=True, text=True, timeout=0.35)
            return result.stdout.strip() if result.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None

    target = next((ref for ref in (branch, f"origin/{branch}") if git(["rev-parse", "--verify", f"{ref}^{{commit}}"])), None)
    if not target:
        return None
    bases = ["refs/remotes/origin/HEAD", "origin/main", "origin/develop", "main", "develop"]
    base = next((ref for ref in bases if git(["rev-parse", "--verify", f"{ref}^{{commit}}"])), None)
    if not base:
        return None
    output = git(["diff", "--numstat", f"{base}...{target}"])
    if output is None or not output:
        return None
    total = 0
    paths = []
    for line in output.splitlines():
        fields = line.split("\t")
        if len(fields) < 3 or not fields[0].isdigit() or not fields[1].isdigit():
            return None
        total += int(fields[0]) + int(fields[1])
        paths.append("\t".join(fields[2:]))
    return {"lines": total, "paths": paths} if paths else None


def get_review_diff(target, cwd):
    if target["kind"] == "pr":
        return _pr_change_record(target["value"], target.get("repo"), cwd)
    return _branch_pr_record(target["value"], target.get("repo"), cwd) or _git_branch_record(target["value"], cwd)


def log_unavailable_review_diff(target):
    label = f"{target['kind']}:{target['value']}"
    label = re.sub(r"[^A-Za-z0-9_.:/-]", "_", label)[:160]
    line = f"{datetime.datetime.now().astimezone().isoformat(timespec='seconds')} diff_unavailable target={label}\n"
    try:
        os.makedirs(os.path.dirname(REVIEW_SIZE_LOG), exist_ok=True)
        with open(REVIEW_SIZE_LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass


def review_size_denial(description, prompt, cwd):
    text = f"{description or ''}\n{prompt or ''}"
    if not REVIEW_TASK.search(text):
        return None
    target = review_target(text)
    if not target:
        return None
    change = get_review_diff(target, cwd)
    if not change or not change.get("paths"):
        log_unavailable_review_diff(target)
        return None
    if change["lines"] < REVIEW_SIZE_LIMIT and not any(RISKY_PATH.search(path) for path in change["paths"]):
        return "小改动用脚本验"
    return None


# 子 agent 不干等：用户 2026-10-22「下次这种等检查的直接finish回来…超过5分钟就是0缓存重写了」，
# 2026-10-28 复犯后「不符合预期，超过5分钟缓存」（派活写了「用后台命令盯 .ingest.log，等下一轮 ingest 真跑」）。
# 只认明确的“盯/等后续/监视直到”；引号里的引用先去掉，「不干等」「不要等」「等待由我查」不拦。宁可少拦。
QUOTED = re.compile(r"「[^」]*」|“[^”]*”")
WAIT_TASK = re.compile(
    r"(?<![不别])盯"                                   # 用后台命令盯、盯 xxx.log
    r"|下一轮.{0,12}(?:真跑|开始|跑完|之?后)"           # 等下一轮 ingest 真跑、下一轮开始后贴日志
    r"|(?<![不别要干])等.{0,6}(?:跑完|结束|完成)(?:再|后)"  # 等它跑完再报
    r"|监视.{0,20}直到")                                # 监视…直到


def check_agent(prompt, description="", cwd=""):
    if WAIT_TASK.search(QUOTED.sub("", prompt or "")):
        deny("子 agent 不干等：只让它把命令后台跑起来就交付（附 run id/日志路径），等待由主会话查；或依赖已有告警。")
    size_reason = review_size_denial(description, prompt, cwd)
    if size_reason:
        deny(size_reason)
    head = re.sub(r"^(?:【代码地图】[^\n]*\n)+", "", prompt.lstrip())
    if head.startswith("【审稿】"):
        if not QUOTE.search(prompt):
            deny("派审稿必须逐字引用用户原话（「」或“”），不给自己的转述。")
        return
    # 用户 2026-10-17：审稿太费额度，调研、小改动、一次性脚本不审；代码审查：用户 2026-10-17「代码审查也改回 opus」
    if re.search(r"【免审:(调研|小改动|一次性脚本|代码审查)】", prompt):
        return
    m = re.search(r"【已审:([^】]+)】", prompt)
    if not m:
        return
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
    # DSH 会删名字带 KEY 的环境变量，退回桥另传的 CC_SESSION（同 ws-up、d10）
    key = os.environ.get("CC_SESSION_KEY") or os.environ.get("CC_SESSION", "")
    chan = key.split(":")[-1]
    if len(key.split(":")) >= 3:
        chan = key.split(":")[1]
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


def check_call(d):
    tool, inp = d.get("tool_name", ""), d.get("tool_input", {}) or {}
    if not d.get("agent_id") and tool in ("Agent", "Task", "Edit", "Write", "MultiEdit", "NotebookEdit"):
        p = os.path.realpath(os.path.expanduser(inp.get("file_path") or inp.get("notebook_path") or ""))
        free = p and any(p == x or p.startswith(os.path.realpath(x) + os.sep) for x in FREE_DIRS + [NOTES_DIR, os.path.join(d.get("cwd") or os.getcwd(), "notes")])
        if not free:
            asked = plan_gate.pending(d.get("transcript_path"))
            if asked:
                deny(plan_gate.message(asked))
    if tool in ("Agent", "Task"):
        check_bot_model(d.get("cwd", ""), inp)
        check_agent(inp.get("prompt") or inp.get("message") or "", inp.get("description") or "", d.get("cwd") or "")
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


def main():
    try:
        d = json.load(sys.stdin)
    except ValueError:
        return
    if d.get("tool_name") != "apply_patch":
        check_call(d)
        return
    # Same per-file mapping as the OpenCode adapter (agent_hooks_opencode.go).
    inp = d.get("tool_input") or {}
    patch = inp.get("command") or inp.get("patch") or inp.get("input") or ""
    chunks = re.split(r"^\*\*\* (Add|Update|Delete) File: (.+)\n", patch, flags=re.M)
    for i in range(1, len(chunks), 3):
        kind, path, body = chunks[i:i + 3]
        path = os.path.join(d.get("cwd") or os.getcwd(), path)
        old = "\n".join(line[1:] for line in body.splitlines() if line.startswith("-"))
        new = "\n".join(line[1:] for line in body.splitlines() if line.startswith("+"))
        check_call(dict(d, tool_name="Edit" if kind == "Update" else "Write",
                        tool_input={"file_path": path, "old_string": old, "new_string": new}))
        moved = re.search(r"^\*\*\* Move to: (.+)$", body, re.M)
        if moved:
            check_call(dict(d, tool_name="Write", tool_input={
                "file_path": os.path.join(d.get("cwd") or os.getcwd(), moved.group(1))}))


if __name__ == "__main__":
    main()
