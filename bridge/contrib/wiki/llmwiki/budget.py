"""Use the scheduler's existing deadline without detaching model descendants."""
import os
import signal
import subprocess
import time

# 来源：bridge/core/hooks.go 的子进程 WaitDelay；同样预留两秒回收并保存本轮状态。
CLEANUP_TIMEOUT = 2
# 来源：沿用角色 wiki 白天定时任务现有的外层时限（crons/jobs.json 的 d7720660/06b19985/300007ef，timeout_mins=90）。
FALLBACK_WINDOW = 90 * 60
# 来源：沿用夜间两个任务现有的默认时限（jobs.json 的 daf7d694/cf68c6a3 没有 timeout_mins，即 bridge/core/cron.go
# defaultCronJobTimeout 的 30 分钟）。
FALLBACK_NIGHT_WINDOW = 30 * 60

_fallback_end = None  # this run's own end (epoch), only when the scheduler passed no deadline
# window() writes the same value here as into CC_JOB_DEADLINE. A deadline that equals it came from the fallback, not
# the scheduler, so nothing says this run owns its process group: run() then only bounds time and never sweeps the
# group (PR #1594 审查 D — a hand-run ingest or a pre-#1467 bridge shares the group with unrelated processes).
FALLBACK_ENV = "CC_JOB_DEADLINE_FALLBACK"


def window(seconds=None):
    """Arm a fallback ceiling for a run the scheduler gave no deadline: the bridge installed before #1562 passes no
    CC_JOB_DEADLINE (the two role runs of 11-10 had only WIKI_DIR/WIKI_BOTS/WIKI_NEWEST_FIRST and ran 4h+), so such a
    run would otherwise go on forever. The value is written back as CC_JOB_DEADLINE, so the child ingest and every
    model call share this one window. Presence counts: an unlimited job is told "", which stays unlimited — only a
    missing variable falls back. WIKI_STOP_AT keeps its own soft-stop meaning and may end the run sooner."""
    global _fallback_end
    if os.environ.get("CC_JOB_DEADLINE") is not None:
        return None  # the scheduler answered, even with "" (this job has no limit): leave it unlimited
    if _fallback_end is None:
        _fallback_end = time.time() + (seconds or FALLBACK_WINDOW)
    os.environ["CC_JOB_DEADLINE"] = os.environ[FALLBACK_ENV] = f"{_fallback_end:.3f}"
    return _fallback_end


def scheduler_deadline():
    """True when CC_JOB_DEADLINE came from the scheduler, which starts each job in its own process group."""
    deadline = os.environ.get("CC_JOB_DEADLINE")
    return bool(deadline) and os.environ.get(FALLBACK_ENV) != deadline


def remaining():
    deadline = os.environ.get("CC_JOB_DEADLINE")
    return float(deadline) - time.time() - CLEANUP_TIMEOUT if deadline else None


def stopped():
    left = remaining()
    stop_at = os.environ.get("WIKI_STOP_AT")
    return (left is not None and left <= 0) or (bool(stop_at) and time.time() >= float(stop_at))


def exhausted():
    left = remaining()
    return left is not None and left <= 0


def processes():
    rows = subprocess.check_output(["ps", "-axo", "pid=,ppid=,pgid="], text=True,
                                   timeout=CLEANUP_TIMEOUT).splitlines()
    return [tuple(map(int, row.split())) for row in rows]


def run(cmd, **kw):
    """subprocess.run with a shared budget and tree cleanup before returning a timeout."""
    timeout = kw.pop("timeout", None)
    left = remaining()
    if left is not None:
        if left <= 0:
            raise subprocess.TimeoutExpired(cmd, 0)
        timeout = min(timeout, left) if timeout is not None else left
    data = kw.pop("input", None)
    if data is not None:
        kw["stdin"] = subprocess.PIPE
    if kw.pop("capture_output", False):
        kw["stdout"] = kw["stderr"] = subprocess.PIPE
    # Scheduled wiki jobs have their own group and run models serially. Snapshot
    # its existing members so an early-exiting model cannot hide an orphan by
    # reparenting it; the shell, orchestrator and existing processes stay protected.
    # Only a scheduler deadline proves the group is the job's own; the fallback window only bounds time.
    group = os.getpgrp() if os.name != "nt" and scheduler_deadline() else None
    before = {pid for pid, _, pgid in processes() if pgid == group} if group is not None else set()
    left = remaining()
    if left is not None:
        if left <= 0:
            raise subprocess.TimeoutExpired(cmd, 0)
        timeout = min(timeout, left) if timeout is not None else left
    # Stay in the cron shell's group: its hard cancellation must still reach us.
    with subprocess.Popen(cmd, **kw) as proc:
        try:
            stdout, stderr = proc.communicate(data, timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                                   capture_output=True, timeout=CLEANUP_TIMEOUT)
                else:
                    # Enumerate before killing the parent and losing its ownership chain.
                    rows = processes()
                    children = {}
                    for pid, parent, _ in rows:
                        children.setdefault(parent, []).append(pid)
                    owned = [proc.pid]
                    for pid in owned:
                        owned.extend(children.get(pid, []))
                    owned.extend(pid for pid, _, pgid in rows if pgid == group and pid not in before and pid not in owned)
                    for pid in reversed(owned):
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            except (OSError, subprocess.SubprocessError):
                # The scheduler still owns the group if tree enumeration fails.
                pass
            finally:
                if proc.poll() is None:
                    proc.kill()
            try:
                proc.communicate(timeout=CLEANUP_TIMEOUT)
            except subprocess.TimeoutExpired:
                # Popen closes pipes on exit; do not wait on an uncollected child's EOF.
                pass
            raise
        return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)
