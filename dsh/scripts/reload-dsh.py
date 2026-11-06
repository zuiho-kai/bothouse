#!/usr/bin/env -S python3 -I
"""Release cutover entry: reload the formal `dsh web` (and the desktop app) after a release is in place.

`reload-dsh.py web` hands the restart to reload-web.py, which is the single owner of "restart the host
and write ~/.bothouse/dsh-web.json back" (#1020). This file lives in the repository so that every
release built from this source carries the wiring: before, each release directory had its own hand
written reload-dsh.py, which restarted the host and wrote a private observation json but never wrote the
state file, so the panel answered 503 until someone rewrote the state by hand
(HANDOFF 2026-11-05 02:33, 03:07, 04:04 — three times in one night).

The same file works in both layouts it is installed into:

  dsh/scripts/reload-dsh.py            (in the source tree, next to reload-web.py)
  <release>/reload-dsh.py              (copied to the release root, scripts under source/dsh/scripts/)

Usage:
  reload-dsh.py web [--port 49176] [--state <file>] [--log <file>] [--dry-run]
                    # every argument is passed to reload-web.py unchanged
  reload-dsh.py desktop             # quit and reopen the desktop app, record both pids
  reload-dsh.py snapshot            # no-op, kept so the existing checklists still run

`snapshot` is accepted and does nothing on purpose. The entry it replaces used it to record the old
host's argv/env/cwd so that `web` could restart it by hand; reload-web.py now reads those itself,
before stopping the host. The release checklists on this machine are written as
`snapshot -> web -> desktop`, so the step stays as a friendly no-op rather than failing step one.

`web` returns reload-web.py's exit code unchanged, so a restart that could not prove the new token
fails here instead of leaving the panel on a dead pid.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# /Applications/...: the app the old release entries quit and reopened, unchanged here.
APP = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
# The release checklist reads this file to confirm the desktop app was relaunched; the entry this one
# replaces wrote it next to itself, and so does this one.
DESKTOP_STATE = os.path.join(HERE, 'dsh-desktop-reload.json')


def reload_web_script():
    """reload-web.py from the layout this entry was installed into, or a readable failure.

    Both layouts are checked rather than one, because the release wiring copies this file to the
    release root while it puts reload-web.py under source/dsh/scripts/; looking only next to this file
    would make a correctly wired release report "built without PR #1020".
    """
    looked = [os.path.join(HERE, 'reload-web.py'),
              os.path.join(HERE, 'source', 'dsh', 'scripts', 'reload-web.py'),
              os.path.join(HERE, 'dsh', 'scripts', 'reload-web.py')]
    for path in looked:
        if os.path.isfile(path):
            return path
    raise SystemExit(
        'reload-dsh: reload-web.py is not in this release; looked in %s. The release was built '
        'without PR #1020, so the panel state file would not be written. Build from a source that '
        'contains dsh/scripts/reload-web.py, or install the reviewed copy first.' % ', '.join(looked))


def web(argv):
    """Restart the host through reload-web.py and return its exit code unchanged."""
    return subprocess.run([sys.executable, '-I', reload_web_script()] + list(argv)).returncode


def alive(pid):
    return subprocess.run(['ps', '-p', str(pid)], capture_output=True).returncode == 0


def desktop():
    """Quit the desktop app if it runs, reopen it, and write old/new pid where the checklist reads it."""
    out = subprocess.run(['pgrep', '-f', '^' + APP + '$'],
                         capture_output=True, text=True).stdout.split()
    old = int(out[0]) if out else None
    if old:
        subprocess.check_output(['osascript', '-e', 'tell application "DeepSeek Harness" to quit'],
                                text=True, timeout=60)
        deadline = time.monotonic() + 60  # 60s: the entry this one replaces waited the same
        while alive(old) and time.monotonic() < deadline:
            time.sleep(1)
        if alive(old):
            raise SystemExit('reload-dsh: the desktop app did not quit (pid %d)' % old)
    subprocess.check_output(['open', '-a', '/Applications/DeepSeek Harness.app'], text=True, timeout=60)
    deadline = time.monotonic() + 180  # 180s: same window the entry this one replaces allowed
    while time.monotonic() < deadline:
        out = subprocess.run(['pgrep', '-f', '^' + APP + '$'],
                             capture_output=True, text=True).stdout.split()
        if out:
            with open(DESKTOP_STATE, 'w') as stream:
                json.dump({'old_pid': old, 'new_pid': int(out[0])}, stream)
            print('reload-dsh: desktop %s -> %s, wrote %s' % (old, out[0], DESKTOP_STATE))
            return 0
        time.sleep(1)
    raise SystemExit('reload-dsh: the desktop app did not start')


def snapshot():
    """Accepted for the checklists that still list it; the work happens inside reload-web.py."""
    print('reload-dsh: snapshot is not needed any more — reload-web.py records the old host argv, '
          'environment and cwd itself before stopping it; nothing to do')
    return 0


def main(argv):
    if not argv or argv[0] not in ('snapshot', 'web', 'desktop'):
        raise SystemExit(__doc__.strip())
    if argv[0] == 'snapshot':
        return snapshot()
    if argv[0] == 'desktop':
        return desktop()
    return web(argv[1:])


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
