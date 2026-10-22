"""Exclusive lock on an open file, Mac / Linux / Windows (fcntl.flock there, msvcrt.locking on Windows); no
third-party package. Held until the file is closed."""
import os, time


def lock(f, wait=True):
    """Lock open file `f` exclusively. wait=False: raise BlockingIOError if another process holds it."""
    if os.name == "nt":
        import msvcrt
        f.flush()
        pos = f.tell()
        f.seek(0)  # msvcrt locks bytes from the current position: always byte 0, whatever the file mode
        try:
            while True:
                try:
                    msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
                    return
                except OSError:
                    if not wait:
                        raise BlockingIOError("locked by another process")
                    time.sleep(0.2)
        finally:
            f.seek(pos)
    else:
        import fcntl
        fcntl.flock(f, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
