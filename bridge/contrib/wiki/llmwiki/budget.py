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
    # Stay in the cron shell's group: its hard cancellation must still reach us.
    with subprocess.Popen(cmd, **kw) as proc:
        try:
            stdout, stderr = proc.communicate(data, timeout=timeout)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                               capture_output=True, timeout=CLEANUP_TIMEOUT)
            else:
                # Enumerate while the model parent is still alive. Killing it first
                # reparents children, losing the ownership chain needed for cleanup.
                rows = subprocess.check_output(["ps", "-axo", "pid=,ppid="], text=True,
                                               timeout=CLEANUP_TIMEOUT).splitlines()
                children = {}
                for row in rows:
                    pid, parent = map(int, row.split())
                    children.setdefault(parent, []).append(pid)
                owned = [proc.pid]
                for pid in owned:
                    owned.extend(children.get(pid, []))
                for pid in reversed(owned):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            if proc.poll() is None:
                proc.kill()
            proc.communicate(timeout=CLEANUP_TIMEOUT)
            raise
        return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)
