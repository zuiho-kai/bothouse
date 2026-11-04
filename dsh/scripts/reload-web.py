#!/usr/bin/env -S python3 -I
"""Restart the running `dsh web` host and write its new address back to ~/.bothouse/dsh-web.json.

Why: the management panel decides whether the channels page is up, and signs in with the token, by
reading ~/.bothouse/dsh-web.json (bridge/core/setup_dsh_configure.go dshWebStatePath, then
management_dsh_proxy.go runningDSHWeb). Only the panel's own "open DSH web" ever wrote that file, so
any other restart (a release script, a launchd bootstrap, a hand-started instance) left a dead pid
and an old token behind and the panel answered 503. Every restart path has to write the file back.

The url comes only from `dsh web: <url>` lines printed after this start (the same announcement the
panel scans), so a stale token from a previous run is never reused. The write is atomic (temp file +
rename in the same directory, 0600), so a reader never sees a half-written file.

Usage:
  reload-web.py [--port 49176] [--pid <old pid>] [--state <file>] [--log <file>] [--dry-run]

Verifying without touching the formal host: start a throwaway host on another port with its own
data dir, then run this script with --port/--state/--log pointed at it.
"""
import argparse
import json
import os
import re
import signal
import subprocess
import tempfile
import time
import urllib.request

HOME = os.environ.get('HOME', '')
# 49176: the formal web host's port (HANDOFF 2026-11-05 01:10 "正式web 49176"), so a restart keeps
# the address the panel and its bookmarks already use.
DEFAULT_PORT = 49176
DEFAULT_STATE = os.path.join(HOME, '.bothouse', 'dsh-web.json')
DEFAULT_LOG = os.path.join(HOME, '.bothouse', 'dsh-web.log')
CHANNELS_HASH = '#channels'  # same deep link the bridge appends (setup_dsh_configure.go dshChannelsHash)
ANNOUNCE = re.compile(r'dsh web: (https?://\S+)')
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def command(args):
    return subprocess.check_output(args, text=True, timeout=60).strip()


def listener_pid(port):
    """pid listening on the loopback port, or None. lsof -Fn prints one 'p<pid>' line per process."""
    try:
        out = command(['lsof', '-nP', '-iTCP:%d' % port, '-sTCP:LISTEN', '-Fn'])
    except (subprocess.CalledProcessError, OSError):
        return None
    for line in out.splitlines():
        if line.startswith('p'):
            return int(line[1:])
    return None


def alive(pid):
    """Signal 0 plus a zombie check: a child that exited but has not been reaped yet still answers
    kill(pid, 0), and waiting on it would otherwise burn the whole stop timeout."""
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:
        state = command(['ps', '-p', str(pid), '-o', 'stat='])
    except (subprocess.CalledProcessError, OSError):
        return False
    return not state.startswith('Z')


def wait_gone(pid, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not alive(pid):
            return True
        time.sleep(0.5)
    return False


def process_env(pid):
    """Environment of a live process of this user; `ps eww` prints it after the command line."""
    full = command(['ps', 'eww', '-p', str(pid), '-o', 'command='])
    matches = list(re.finditer(r'(?:^| )([A-Za-z_][A-Za-z_0-9]*)=', full))
    return {m[1]: full[m.end():matches[i + 1].start() if i + 1 < len(matches) else len(full)].strip()
            for i, m in enumerate(matches)}


def is_web_host(pid):
    """Refuse to stop anything that is not `dsh --profile web`: only that process is ours to restart."""
    args = command(['ps', '-p', str(pid), '-o', 'command=']).split()
    if '--profile' not in args:
        return False
    index = args.index('--profile')
    if index + 1 >= len(args) or args[index + 1] != 'web':
        return False
    return any(os.path.basename(a).startswith('dsh') for a in args)


def announce(text):
    """Last `dsh web: <url>` in a chunk of log."""
    found = ANNOUNCE.findall(text)
    return found[-1] if found else None


def write_state(path, state):
    """Atomic replace: a concurrent reader sees the old file or the whole new one."""
    directory = os.path.dirname(path) or '.'
    os.makedirs(directory, mode=0o700, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=directory, prefix='.dsh-web.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(state, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_state(path):
    try:
        with open(path) as stream:
            data = json.load(stream)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def restart(port, old_pid, state_path, log_path, node, dsh, dry_run=False):
    old_pid = old_pid or listener_pid(port)
    if old_pid is None:
        raise SystemExit('reload-web: nothing is listening on port %d' % port)
    if not is_web_host(old_pid):
        raise SystemExit('reload-web: pid %d is not a `dsh --profile web` host; refusing to stop it' % old_pid)
    env = process_env(old_pid)
    if 'PATH' not in env:
        raise SystemExit('reload-web: cannot read the environment of pid %d' % old_pid)
    if dry_run:
        print('reload-web: would restart pid %d on port %d and write %s' % (old_pid, port, state_path))
        return read_state(state_path)

    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, 'a') as log:
        offset = log.tell()  # only announcements after this point belong to the new process
        os.kill(old_pid, signal.SIGTERM)
        if not wait_gone(old_pid):
            raise SystemExit('reload-web: pid %d did not stop' % old_pid)
        # long-running-ok: detached host, same profile/environment/port as the one just stopped.
        process = subprocess.Popen([node, dsh, '--profile', 'web', '--no-open', '--port', str(port)],
                                   cwd=env.get('PWD') or os.path.expanduser('~'), env=env,
                                   stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    # 180s: the budget the previous deploy script gave a cold host start, kept so a slow start is
    # not reported as a failure that would leave the state file on the dead pid.
    deadline = time.monotonic() + 180
    url = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit('reload-web: the new host exited; see %s' % log_path)
        with open(log_path) as stream:
            stream.seek(offset)
            url = announce(stream.read())
        if url is not None:
            break
        time.sleep(0.2)
    if url is None:
        raise SystemExit('reload-web: no "dsh web: <url>" line after this start; see %s' % log_path)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SystemExit('reload-web: the new host exited; see %s' % log_path)
        try:
            with OPENER.open('http://127.0.0.1:%d/' % port, timeout=5) as response:
                if response.status < 500:
                    break
        except Exception as exc:  # 401 means listening but wants a login: good enough to write back
            if getattr(exc, 'code', None) == 401:
                break
        time.sleep(0.5)
    state = {'url': url if url.endswith(CHANNELS_HASH) else url + CHANNELS_HASH,
             'pid': process.pid, 'log': log_path}
    write_state(state_path, state)
    print('reload-web: pid %d -> %d, wrote %s' % (old_pid, process.pid, state_path))
    return state


def main(argv=None):
    parser = argparse.ArgumentParser(description='restart `dsh web` and write back ~/.bothouse/dsh-web.json')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='port the host listens on (default %d)' % DEFAULT_PORT)
    parser.add_argument('--pid', type=int, default=None, help='pid to stop (default: the listener on --port)')
    parser.add_argument('--state', default=DEFAULT_STATE, help='state file the panel reads')
    parser.add_argument('--log', default=DEFAULT_LOG, help='log the host appends to')
    parser.add_argument('--node', default=os.environ.get('DSH_NODE') or '/opt/homebrew/bin/node')
    parser.add_argument('--dsh', default=os.environ.get('DSH_BIN') or '/opt/homebrew/bin/dsh')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    restart(args.port, args.pid, args.state, args.log, args.node, args.dsh, args.dry_run)


if __name__ == '__main__':
    main()
