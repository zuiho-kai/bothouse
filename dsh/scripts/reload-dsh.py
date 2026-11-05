#!/usr/bin/env -S python3 -I
"""Release cutover entry: reload the formal `dsh web` (and the desktop app) after a release is in place.

`reload-dsh.py web` hands the restart to reload-web.py in this same directory, which is the single
owner of "restart the host and write ~/.bothouse/dsh-web.json back" (#1020). Keeping the entry here
means every release built from this source carries the wiring: before, each release directory had its
own hand-written reload-dsh.py, which restarted the host and wrote a private observation json but never
wrote the state file, so the panel answered 503 until someone rewrote the state by hand
(HANDOFF 2026-11-05 02:33, 03:07, 04:04 — three times in one night).

Usage:
  reload-dsh.py web [--port 49176] [--state <file>] [--log <file>] [--dry-run]
                    # every other argument is passed to reload-web.py unchanged
  reload-dsh.py desktop             # quit and reopen the desktop app (unchanged from the old entry)

The deployment side only needs one line: run this script with `web`, and let its exit code fail the
release when the state file was not written.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# /Applications/...: the app the old release entries quit and reopened, unchanged here.
APP = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'


def web(argv):
    """Restart the host through reload-web.py and return its exit code unchanged."""
    script = os.path.join(HERE, 'reload-web.py')
    if not os.path.exists(script):
        raise SystemExit('reload-dsh: %s is missing; this release was built without PR #1020, so the '
                         'panel state file would not be written — deploy a release that contains it'
                         % script)
    return subprocess.run([sys.executable, '-I', script] + list(argv)).returncode


def alive(pid):
    return subprocess.run(['ps', '-p', str(pid)], capture_output=True).returncode == 0


def desktop():
    """Quit the desktop app if it runs, reopen it, and print the new pid. Carried over unchanged."""
    out = subprocess.run(['pgrep', '-f', '^' + APP + '$'],
                         capture_output=True, text=True).stdout.split()
    old = int(out[0]) if out else None
    if old:
        subprocess.check_output(['osascript', '-e', 'tell application "DeepSeek Harness" to quit'],
                                text=True, timeout=60)
        deadline = time.monotonic() + 60
        while alive(old) and time.monotonic() < deadline:
            time.sleep(1)
        if alive(old):
            raise SystemExit('reload-dsh: the desktop app did not quit (pid %d)' % old)
    subprocess.check_output(['open', '-a', '/Applications/DeepSeek Harness.app'], text=True, timeout=60)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        out = subprocess.run(['pgrep', '-f', '^' + APP + '$'],
                             capture_output=True, text=True).stdout.split()
        if out:
            print(json.dumps({'old_pid': old, 'new_pid': int(out[0])}))
            return 0
        time.sleep(1)
    raise SystemExit('reload-dsh: the desktop app did not start')


def main(argv):
    if not argv or argv[0] not in ('web', 'desktop'):
        raise SystemExit(__doc__.strip())
    if argv[0] == 'desktop':
        return desktop()
    return web(argv[1:])


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
