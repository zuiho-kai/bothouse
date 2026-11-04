"""Blocking advisory lock for gate files shared by multiple processes."""
from contextlib import contextmanager
import errno
import os
import time

if os.name == "nt":
    import msvcrt
else:
    import fcntl


@contextmanager
def exclusive(path):
    # Do not truncate the lock file: on Windows another process may hold byte 0.
    with open(path, "a+b") as lock:
        if os.name == "nt":
            lock.seek(0)
            while True:
                try:
                    # LK_LOCK stops retrying after ten seconds; match flock's
                    # blocking behavior with nonblocking attempts instead.
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as exc:
                    if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                        raise
                    time.sleep(0.05)
        else:
            fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)
