#!/usr/bin/env python3
"""每个 sub 角色（bots.json 里列的）的记忆 wiki，和主角色的 ~/wiki 同一份程序（bin/ingest.py）、同样的触发。
每次先 export.py 把她的会话转成转录，再跑她自己的 bin/ingest.py（转发到共享版，WIKI_DIR=她的 wiki）。
Python 写的，Mac / Linux / Windows 同一份（用户 2026-10-22「那mac和window用户呢」；原 sub-wiki.sh 只能在有 sh 的系统跑）。

  sub-wiki.py pending   每 30 分钟（cc-connect cron，见 README）
  sub-wiki.py nightly   周一至周六 03:00（夜间整理 + 反思 dream）
  sub-wiki.py lint      周日 03:00
  sub-wiki.py hook      cc-connect 的 agent.closed 钩子（对应主角色的 SessionEnd hook）：
                        环境变量 CC_HOOK_PROJECT / CC_HOOK_AGENT_SESSION_ID，立刻返回，后台导出并整理那一个会话

夜间各角色并行跑，各用自己的目录、Git 和断点；白天仍按各角色的整理入口运行。
锁和主角色一样：白天（pending、hook）不等锁，夜里（nightly、lint）等锁。
日志：本目录 sub-wiki.log（本脚本）+ 各 wiki 的 .ingest.log（ingest 自己的）。
"""
import glob, os, signal, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()
LOG = HERE / "sub-wiki.log"
PY = os.environ.get("WIKI_PYTHON") or sys.executable
MAIN_MARK = ".bothouse-main"  # setup_wiki.py: a main wiki (the lead's, when bots.json gives her that wiki)
ROLE_PROCESSES = {}  # Nightly children, registered before they may leave the scheduler's process group.
STOPPING = threading.Event()
sys.path.insert(0, str(HERE / "llmwiki"))  # -I omits the script directory
try:
    import budget
except ImportError:
    budget = None



def say(msg):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")


def bots():
    """bots.json（$WIKI_BOTS，默认本目录）→ [(bot, project, wiki 目录)]"""
    runner = budget.run if budget else subprocess.run
    out = runner([PY, "-X", "utf8", "-I", str(HERE / "export.py"), "--list"], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if parts:
            rows.append((parts[0], parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""))
    return rows


def run_one(rows, b, *args):
    # 走她自己的 bin/ingest.py（转发入口）：它确认 ~/wiki/bin 是共享版才转发（review 2026-10-20 sub-parity-code-2 A）
    project, d = next((p, w) for k, p, w in rows if k == b)
    say(f"{b} ingest {' '.join(args)}")
    with open(Path(d) / ".ingest.log", "a") as err:
        # WIKI_DIR = this wiki: a teammate's shim sets it itself, but the lead's main wiki holds the full tool, whose
        # default is ~/wiki (wrong when the main wiki is at $WIKI_DIR; the hook's env has no WIKI_DIR at all)
        # Ingest owns model cleanup/checkpoints. Do not race it with another
        # timeout at this parent; the shell's hard cancellation remains the guard.
        env = dict(os.environ, WIKI_DIR=str(d), MANUALS_ROLE=project,
                   BOTHOUSE_DATA_DIR=(os.environ.get("BOTHOUSE_DATA_DIR") or
                                      os.environ.get("CC_DATA_DIR") or str(HERE.parent)))
        # Wiki jobs use the user's CLI login, like hook_env(); an invoking agent's private home is unrelated.
        env.pop("CODEX_HOME", None)
        if "--nightly" in args:
            env.pop("WIKI_NEWEST_FIRST", None)  # Source: user #852: nightly drains older backlog first.
        cmd = [PY, "-X", "utf8", "-I", str(Path(d) / "bin" / "ingest.py"), *args]
        if "--nightly" in args and os.name != "nt":
            # budget.run may reap orphans in its scheduler group. Each parallel role must own that group.
            # The handshake prevents a child escaping the scheduler before the parent can forward cancellation.
            with subprocess.Popen([PY, "-I", str(SELF), "role-exec", *cmd], stdin=subprocess.PIPE,
                                  stderr=err, env=env) as child:
                ROLE_PROCESSES[b] = child
                try:
                    if not STOPPING.is_set():
                        child.stdin.write(b"run\n")
                        child.stdin.flush()
                    child.stdin.close()
                    rc = child.wait()
                finally:
                    stop_role(child, signal.SIGKILL)  # Also reap any remaining orphan from this role only.
                    ROLE_PROCESSES.pop(b, None)
        else:
            rc = subprocess.run(cmd, stderr=err, env=env).returncode
    if rc:
        say(f"{b} ingest {' '.join(args)} exited {rc}")


def stop_role(child, sig):
    try:
        os.killpg(child.pid, sig)
    except ProcessLookupError:
        if child.poll() is None:  # Handshake child has not made its own group yet.
            try:
                os.kill(child.pid, sig)
            except ProcessLookupError:
                pass


def cancel_roles(sig, _frame):
    STOPPING.set()
    for child in tuple(ROLE_PROCESSES.values()):
        stop_role(child, sig)
    raise SystemExit(128 + sig)


def export(*args):
    with open(LOG, "a") as f:
        runner = budget.run if budget else subprocess.run
        try:
            return runner([PY, "-X", "utf8", "-I", str(HERE / "export.py"), *args], stdout=f, stderr=f).returncode
        except subprocess.TimeoutExpired:
            if not budget or not budget.exhausted():
                raise
            # Parent and exporter share the same deadline. If the parent wins, budget.run has already reaped
            # its child tree. Return the same failure as the child's lock timeout, without throwing into main.
            say("export deadline reached; unread work retained for next run")
            return 1


# 钩子的最小环境：cc-connect 的环境带着 secrets.env 的全部变量，和主角色 ingest.py --hook 一样只留这些
POSIX_KEEP = ("USER", "LOGNAME", "TMPDIR", "LANG")
WIN_KEEP = ("SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA",
            "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "TEMP", "TMP", "USERNAME", "PATH")
PASS = ("WIKI_BOTS", "WIKI_TRANSCRIPTS", "WIKI_PYTHON", "WIKI_STOP_AT", "CC_JOB_DEADLINE", "CC_JOB_DEADLINE_FALLBACK")


def hook_env():
    e = os.environ
    if os.name == "nt":
        env = {k: e[k] for k in WIN_KEEP if k in e}
    else:
        home = e.get("HOME", str(Path.home()))
        env = {"HOME": home, "PATH": f"{home}/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"}  # /usr/local/bin: npm -g claude on Linux
        env.update({k: e[k] for k in POSIX_KEEP if e.get(k)})
        if "USER" not in env:
            import getpass
            env["USER"] = getpass.getuser()
        env.setdefault("LOGNAME", env["USER"])
    if "HOME" in e:
        env.setdefault("HOME", e["HOME"])
    env.update({k: e[k] for k in PASS if e.get(k)})
    return env


def detach(argv, env):
    """Start argv in the background, detached from the hook (its timeout is 10 s by default), and return."""
    kw = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, close_fds=True)
    if os.name == "nt":
        # CREATE_NO_WINDOW, not DETACHED_PROCESS (#1943): a worker with no console makes Windows open a visible
        # one for every console program it starts; a hidden console is inherited by them instead.
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True  # nohup: not killed with the hook's process group
    subprocess.Popen(argv, **kw)


def main(argv):
    mode = argv[1] if len(argv) > 1 else ""
    if mode == "role-exec":
        if not sys.stdin.buffer.readline():
            return 0
        os.setpgrp()
        os.execvpe(argv[2], argv[2:], os.environ)
    if budget:  # 兜底：装了新版调度器才有 CC_JOB_DEADLINE；没传时按这两个任务现有的外层时限自设，见 budget.py
        budget.window(budget.FALLBACK_NIGHT_WINDOW if mode in ("nightly", "lint") else None)
    if budget and budget.stopped():
        say("wiki deadline reached; pending work retained for next run")
        return 0
    if mode in ("pending", "nightly", "lint"):
        rows = bots()
        say(f"start {mode}")
        if export(*(["--no-wait"] if mode == "pending" else [])):
            say("export failed (ingest still runs on what is there)")
        roles = [b for b, _p, d in rows if not (Path(d) / MAIN_MARK).exists()]
        if mode == "nightly" and roles and not (budget and budget.stopped()):
            # Source: user #852 requests all roles concurrently; worker count follows configured role count.
            previous = {sig: signal.signal(sig, cancel_roles) for sig in (signal.SIGTERM, signal.SIGINT)}
            try:
                with ThreadPoolExecutor(max_workers=len(roles)) as pool:
                    futures = [pool.submit(run_one, rows, b, "--nightly") for b in roles]
                    for future in futures:
                        future.result()
            finally:
                for sig, handler in previous.items():
                    signal.signal(sig, handler)
        else:
            for b in roles:
                if budget and budget.stopped():
                    break
                run_one(rows, b, "--" + mode)
        say(f"done {mode}")
        return 0
    if mode == "hook":
        proj = os.environ.get("CC_HOOK_PROJECT", "")
        b = next((k for k, p, _d in bots() if proj and p == proj), "")
        if not b:
            return 0  # 主角色有 Claude Code 自己的 SessionEnd hook；bots.json 外的项目不管
        detach([PY, "-X", "utf8", "-I", str(SELF), "hook-run", b, os.environ.get("CC_HOOK_AGENT_SESSION_ID", "")], hook_env())
        return 0
    if mode == "hook-run":
        b, sid = argv[2], (argv[3] if len(argv) > 3 else "")
        rows = bots()
        say(f"hook {b} agent session {sid or '?'}")
        if export("--no-wait", b):
            say(f"export {b} failed")
        # 导出文件名里带 agent 会话 id（<后 8 位>-<id>.jsonl）；找不到唯一一个就按 --pending 处理所有空闲会话
        tr = os.environ.get("WIKI_TRANSCRIPTS") or str(HERE / "transcripts")
        hits = glob.glob(os.path.join(glob.escape(tr), glob.escape(b), "*", "*" + glob.escape(sid) + "*.jsonl")) if sid else []
        if len(hits) == 1:
            run_one(rows, b, "--session", Path(hits[0]).stem)
        else:
            run_one(rows, b, "--pending")
        return 0
    print("usage: sub-wiki.py pending|nightly|lint|hook", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except subprocess.TimeoutExpired:
        if budget and not budget.exhausted():
            raise
        say("job deadline reached during export; unread work retained for next run")
