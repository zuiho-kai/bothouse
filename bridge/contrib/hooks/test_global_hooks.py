#!/usr/bin/env python3
"""The global install (core/global_hooks.go, "setup hooks on --global"): run.py --cc-global passes in a bothouse
role's session (CC_PROJECT) and in a project whose settings already run the role's copy of the hook, and runs the
hook otherwise; ingest.py's terminal_sessions() leaves out the roles' project dirs.
User 2026-11-02 「要，向导加个全局安装选项」「守门的也做成可选全局安装」.
Run: python3 -I contrib/hooks/test_global_hooks.py"""
import json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LLMWIKI = HERE.parent / "wiki" / "llmwiki"
fails = []


def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else ": " + detail))
    if not ok:
        fails.append(name)


def hooks_dir(tmp):
    """The hook scripts with a probe hook named wiki-context that prints what it saw."""
    d = tmp / "hooks"
    d.mkdir()
    for f in HERE.glob("*.py"):  # run.py imports its neighbours (dshlog.py, …)
        shutil.copy(f, d / f.name)
    (d / "wiki-context.py").write_text(
        "import os, sys\nsys.stdin.read()\nprint('RAN wiki=' + os.environ.get('GATE_WIKI', ''))\n")
    return d


def run(hooks, project, env=None, extra=()):
    e = {k: v for k, v in os.environ.items() if k not in ("CC_PROJECT", "CLAUDE_PROJECT_DIR", "GATE_WIKI", "WIKI_DIR")}
    e.update(env or {})
    cmd = [sys.executable, "-I", str(hooks / "run.py"), "--conest-hook", "--cc-global", "--role", str(project.parent / ".claude-user"), *extra, "wiki-context"]
    payload = {"hook_event_name": "UserPromptSubmit", "session_id": "s1", "cwd": str(project), "prompt": "hello"}
    p = subprocess.run(cmd, input=json.dumps(payload), capture_output=True, text=True, env=e, cwd=str(project), timeout=30)
    return p.stdout.strip()


def project_with(tmp, name, command):
    d = tmp / name
    (d / ".claude").mkdir(parents=True)
    hooks = {"UserPromptSubmit": [{"hooks": [{"type": "command", "command": command}]}]}
    (d / ".claude" / "settings.json").write_text(json.dumps({"hooks": hooks}))
    return d


def test_run_once():
    tmp = Path(tempfile.mkdtemp())
    hooks = hooks_dir(tmp)
    plain = tmp / "plain"
    plain.mkdir()
    check("runs where nothing else does", run(hooks, plain) == "RAN wiki=", run(hooks, plain))
    check("--wiki reaches the hook as GATE_WIKI", run(hooks, plain, extra=("--wiki", "/w")) == "RAN wiki=/w")
    check("passes in a bothouse role (CC_PROJECT)", run(hooks, plain, {"CC_PROJECT": "juzi"}) == "")
    role = project_with(tmp, "role", "[ -f '/x/hooks/run.py' ] || exit 0; 'python3' -I '/x/hooks/run.py' --conest-hook wiki-context")
    check("passes where the project runs the role's copy", run(hooks, role) == "")
    check("CLAUDE_PROJECT_DIR wins over cwd", run(hooks, plain, {"CLAUDE_PROJECT_DIR": str(role)}) == "")
    other = project_with(tmp, "other", "'python3' -I '/x/hooks/run.py' --conest-hook bash-guard")
    check("another hook in the project does not count", run(hooks, other) == "RAN wiki=")
    glob = project_with(tmp, "glob", "'python3' -I '/x/hooks/run.py' --conest-hook --cc-global --role '/h/.claude' wiki-context")
    check("a global copy in project settings does not count", run(hooks, glob) == "RAN wiki=")
    shutil.rmtree(tmp)


def test_terminal_sessions():
    tmp = Path(tempfile.mkdtemp())
    wiki, projects = tmp / "wiki", tmp / "claude" / "projects"
    wiki.mkdir()
    role, bot, mine = tmp / "role", tmp / "bot", tmp / "mine"
    for d in (role, bot, mine):
        slug = "".join(c if c.isalnum() else "-" for c in str(d))
        (projects / slug).mkdir(parents=True)
        (projects / slug / (d.name + "-sid.jsonl")).write_text("{}\n")
    (tmp / "bots.json").write_text(json.dumps({"b": {"workdir": str(bot)}}))
    code = ("import sys, json; sys.path.insert(0, sys.argv[1]); import ingest; "
            "print(json.dumps(sorted(ingest.terminal_sessions())))")
    env = dict(os.environ, WIKI_DIR=str(wiki))

    def sessions():
        p = subprocess.run([sys.executable, "-I", "-c", code, str(LLMWIKI)], capture_output=True, text=True, env=env, timeout=60)
        return json.loads(p.stdout or "null") if p.returncode == 0 else p.stderr[-400:]

    check("no terminal file: no terminal sessions", sessions() == [], str(sessions()))
    (wiki / ".bothouse-terminal.json").write_text(json.dumps(
        {"projects": str(projects), "bots": str(tmp / "bots.json"), "skip": [str(role)]}))
    got = sessions()
    check("terminal sessions leave out roles and bots", got == ["mine-sid"], str(got))
    shutil.rmtree(tmp)


if __name__ == "__main__":
    test_run_once()
    test_terminal_sessions()
    if fails:
        sys.exit("FAILED: " + ", ".join(fails))
    print("all ok")
