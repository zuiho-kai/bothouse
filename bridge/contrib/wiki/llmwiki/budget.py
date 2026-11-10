"""Use the scheduler's existing deadline without detaching model descendants."""
import os
import signal
import subprocess
import time

# 来源：bridge/core/hooks.go 的子进程 WaitDelay；同样预留两秒回收并保存本轮状态。
CLEANUP_TIMEOUT = 2


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
    group = os.getpgrp() if os.name != "nt" and os.environ.get("CC_JOB_DEADLINE") else None
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
