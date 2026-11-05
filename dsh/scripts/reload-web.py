#!/usr/bin/env -S python3 -I
"""Restart the running `dsh web` host and write its new address back to ~/.bothouse/dsh-web.json.

Why: the management panel decides whether the channels page is up, and signs in with the token, by
reading ~/.bothouse/dsh-web.json (bridge/core/setup_dsh_configure.go dshWebStatePath, then
management_dsh_proxy.go runningDSHWeb). Only the panel's own "open DSH web" ever wrote that file, so
any other restart (a release script, a launchd bootstrap, a hand-started instance) left a dead pid
and an old token behind and the panel answered 503. Every restart path has to write the file back.

Two facts about the real host shape the code below:

- It is usually managed by launchd with KeepAlive|RunAtLoad. SIGTERM then makes launchd respawn the
  host on the same port within a second, so a script that spawns its own child loses the race with
  EADDRINUSE and writes nothing. When the listener is the launchd job's pid we therefore restart
  through `launchctl kickstart -k` and take the new pid from `launchctl print`.
- The announcement carries the public url (`--public-url`), e.g. https://host.ts.net/?token=…, while
  the panel proxy uses the url's host as its http target. Writing that host back turns the 503 into a
  502. Only the token is taken from the announcement; the host is always http://127.0.0.1:<port>.

The url is taken only from `dsh web: <url>` lines appended after this restart began (byte offset
recorded first), and it is written only after three cross-checks pass: the announcement's port is the
port we restarted, its pid is the pid we started (or launchd reports), and its token answers
`GET /?token=…` with a 303. A foreign or mismatched announcement fails the run instead of being
written. The write itself is atomic (temp file + rename in the same directory, 0600) and the previous
state file is backed up first.

Usage:
  reload-web.py [--port 49176] [--pid <old pid>] [--state <file>] [--log <file>]
                [--launchd-label local.bothouse.dsh-web] [--dry-run]

Verifying without touching the formal host: start a throwaway host on another port with its own
data dir, then run this script with --port/--state/--log pointed at it. Tests inject a fake
`launchctl` with --launchctl to cover the supervised path without a real launchd job.
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOME = os.environ.get('HOME', '')
# 49176: the formal web host's port (HANDOFF 2026-11-05 01:10 "正式web 49176"), so a restart keeps
# the address the panel and its bookmarks already use.
DEFAULT_PORT = 49176
DEFAULT_STATE = os.path.join(HOME, '.bothouse', 'dsh-web.json')
DEFAULT_LOG = os.path.join(HOME, '.bothouse', 'dsh-web.log')
# local.bothouse.dsh-web: the launchd job the deploy script bootstraps for the formal host
# (plist ~/Library/LaunchAgents/local.bothouse.dsh-web.plist, reap 2026-11-05 launches it).
DEFAULT_LABEL = 'local.bothouse.dsh-web'
CHANNELS_HASH = '#channels'  # same deep link the bridge appends (setup_dsh_configure.go dshChannelsHash)
ANNOUNCE = re.compile(r'dsh web: (https?://\S+)')
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def command(args):
    """Run a read-only probe command; a missing/failing tool becomes one readable line, not a traceback."""
    try:
        return subprocess.check_output(args, text=True, timeout=60).strip()
    except (subprocess.CalledProcessError, OSError) as exc:
        raise SystemExit('reload-web: %s failed (%s); cannot inspect the running host' % (args[0], exc))


def listener_pid(port):
    """pid listening on the loopback port, or None. lsof -Fn prints one 'p<pid>' line per process."""
    try:
        out = subprocess.check_output(['lsof', '-nP', '-iTCP:%d' % port, '-sTCP:LISTEN', '-Fn'],
                                      text=True, timeout=60).strip()
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
        state = subprocess.check_output(['ps', '-p', str(pid), '-o', 'stat='], text=True, timeout=60).strip()
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


def process_cwd(pid):
    """Actual working directory of pid. `ps eww` carries the shell's exported working directory, which
    goes stale as soon as the process or its parent changes directory; the kernel's cwd is the truth."""
    try:
        out = subprocess.check_output(['lsof', '-a', '-p', str(pid), '-d', 'cwd', '-Fn'],
                                      text=True, timeout=60).strip()
    except (subprocess.CalledProcessError, OSError):
        return None
    for line in out.splitlines():
        if line.startswith('n'):
            return line[1:]
    return None


def process_argv(pid):
    """Full argv of pid, so a restart keeps the flags the host was started with (--public-url,
    --trusted-host, …) instead of silently dropping them."""
    argv = command(['ps', '-p', str(pid), '-o', 'command=']).split()
    if not argv:
        raise SystemExit('reload-web: cannot read the command line of pid %d' % pid)
    return argv


def is_web_host(pid):
    """Refuse to stop anything that is not `dsh --profile web`: only that process is ours to restart."""
    args = process_argv(pid)
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


def launchd_info(label, launchctl='launchctl'):
    """What launchd knows about the job, or None when it is not a loaded launchd job. The fields read
    here are the ones `launchctl print` prints for a LaunchAgent: state/pid/arguments/working dir."""
    target = 'gui/%d/%s' % (os.getuid(), label)
    try:
        out = subprocess.check_output([launchctl, 'print', target], text=True, timeout=60,
                                      stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, OSError):
        return None
    info = {'target': target, 'pid': None, 'argv': [], 'cwd': None, 'log': None}
    lines = out.splitlines()
    in_argv = False
    for line in lines:
        stripped = line.strip()
        if in_argv:
            if stripped == '}':
                in_argv = False
            else:
                info['argv'].append(stripped)
            continue
        if stripped.startswith('arguments = {'):
            in_argv = True
        elif stripped.startswith('pid = '):
            try:
                info['pid'] = int(stripped[len('pid = '):])
            except ValueError:
                info['pid'] = None
        elif stripped.startswith('working directory = '):
            info['cwd'] = stripped[len('working directory = '):]
        elif stripped.startswith('stdout path = '):
            info['log'] = stripped[len('stdout path = '):]
    return info


def kickstart(info, launchctl='launchctl'):
    """Restart a launchd-supervised host in place and return the pid launchd reports afterwards."""
    try:
        subprocess.run([launchctl, 'kickstart', '-k', info['target']], check=True, timeout=60,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, OSError) as exc:
        raise SystemExit('reload-web: launchctl kickstart -k %s failed (%s)' % (info['target'], exc))
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        current = launchd_info(info['target'].split('/', 2)[2], launchctl)
        if current and current['pid'] and current['pid'] != info['pid']:
            return current['pid']
        time.sleep(0.2)
    raise SystemExit('reload-web: launchd did not report a new pid for %s' % info['target'])


def state_url(port, token):
    """Always loopback: the panel proxy hard-codes http and uses the url host as its target."""
    return 'http://127.0.0.1:%d/?%s%s' % (port, urllib.parse.urlencode({'token': token}), CHANNELS_HASH)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Keep the 303 the host answers with; following it would hide the status we check."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


PROBE = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect)
SIGN_IN = 303  # the status `dsh web` answers on its own token; anything else is not a usable state


def probe_token(port, token, timeout=10):
    """True only when the host answers GET /?token=… with the 303 it uses for its own token. 401 means
    the host is up but the token belongs to another instance, and 200 means it did not take the
    token at all; neither may ever be written to the state file."""
    request = urllib.request.Request('http://127.0.0.1:%d/?%s' % (port, urllib.parse.urlencode({'token': token})))
    try:
        with PROBE.open(request, timeout=timeout) as response:
            return response.status == SIGN_IN
    except urllib.error.HTTPError as exc:
        return exc.code == SIGN_IN
    except Exception:
        return False


def wait_token(port, token, timeout=60):
    """The host prints its address before it listens, so the sign-in check is retried briefly."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if probe_token(port, token):
            return True
        time.sleep(0.5)
    return False


def backup_state(path):
    """Keep the file this run replaces, so a wrong write can be compared and restored by hand."""
    if not os.path.exists(path):
        return None
    stamp = time.strftime('%Y%m%d-%H%M%S')
    copy = '%s.bak-%s' % (path, stamp)
    shutil.copy2(path, copy)
    os.chmod(copy, 0o600)
    return copy


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


def restart(port, old_pid, state_path, log_path, node, dsh, dry_run=False,
            label=DEFAULT_LABEL, launchctl='launchctl', argv=None, timeout=180):
    old_pid = old_pid or listener_pid(port)
    if old_pid is None:
        raise SystemExit('reload-web: nothing is listening on port %d' % port)
    old_argv = argv or process_argv(old_pid)
    if not is_web_host(old_pid):
        raise SystemExit('reload-web: pid %d is not a `dsh --profile web` host; refusing to stop it' % old_pid)
    supervised = launchd_info(label, launchctl)
    if supervised and supervised['pid'] != old_pid:
        supervised = None  # the job is loaded but something else holds the port: treat it as a plain host
    if supervised and supervised.get('log'):
        # launchd sends the host's stdout to the plist's path, which is where its announcement lands;
        # record that file in the state so whoever reads the state next scans the right log. The file
        # may not exist yet, so it is created 0600 below like any other.
        log_path = supervised['log']
    env = process_env(old_pid)
    if 'PATH' not in env:
        raise SystemExit('reload-web: cannot read the environment of pid %d' % old_pid)
    # A plain host is restarted in the directory it ran in: `dsh` stores its state and the collab
    # plugin resolves rooms/skills relative to it. Read the kernel cwd now, while the old process
    # still exists (lsof finds nothing once it is gone); the exported PWD can be stale after a cd.
    # launchd hosts get the plist's WorkingDirectory from launchd itself.
    cwd = None if supervised else process_cwd(old_pid)
    if not supervised and cwd is None:
        raise SystemExit('reload-web: cannot read the working directory of pid %d' % old_pid)
    if dry_run:
        kind = 'launchd job %s' % label if supervised else 'pid %d' % old_pid
        print('reload-web: would restart %s on port %d and write %s' % (kind, port, state_path))
        return read_state(state_path)

    os.makedirs(os.path.dirname(state_path), exist_ok=True)
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    if not os.path.exists(log_path):
        # 0600 from the first byte: the launch token is printed into this file
        os.close(os.open(log_path, os.O_CREAT | os.O_WRONLY, 0o600))
    with open(log_path, 'a') as log:
        offset = log.tell()  # only announcements after this point belong to the new process
    if supervised:
        new_pid = kickstart(supervised, launchctl)
        process = None
    else:
        os.kill(old_pid, signal.SIGTERM)
        if not wait_gone(old_pid):
            raise SystemExit('reload-web: pid %d did not stop' % old_pid)
        # long-running-ok: detached host, same argv/environment/port as the one just stopped.
        # EOF-BOUNDARY: the announcement of this start lands in the same log, after the offset above.
        with open(log_path, 'a') as host_log:
            process = subprocess.Popen([node, dsh] + old_argv[2:], cwd=cwd, env=env,
                                       stdout=host_log, stderr=host_log,
                                       stdin=subprocess.DEVNULL, start_new_session=True)
            new_pid = process.pid
            host_log.write('reload-web: restarted pid %d as %d\n' % (old_pid, new_pid))
            host_log.flush()
    # 180s: the budget the previous deploy script gave a cold host start, kept so a slow start is
    # not reported as a failure that would leave the state file on the dead pid. Tests pass a
    # shorter one so a silent host fails the run quickly.
    deadline = time.monotonic() + timeout
    url = None
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise SystemExit('reload-web: the new host exited; see %s' % log_path)
        with open(log_path) as stream:
            stream.seek(offset)
            url = announce(stream.read())
        if url is not None:
            break
        time.sleep(0.2)
    if url is None:
        raise SystemExit('reload-web: no "dsh web: <url>" line after this start; see %s' % log_path)
    parsed = urllib.parse.urlparse(url)
    token = urllib.parse.parse_qs(parsed.query).get('token', [''])[0]
    announced_port = parsed.port
    if not token:
        raise SystemExit('reload-web: the announcement has no token: %s' % url)
    if announced_port not in (None, port):
        raise SystemExit('reload-web: announcement is for port %s, not the port %d we restarted'
                         % (announced_port, port))
    if not wait_token(port, token):
        raise SystemExit('reload-web: the announced token does not sign in on 127.0.0.1:%d; '
                         'refusing to write another instance\'s token' % port)
    if supervised:
        current = launchd_info(label, launchctl)
        if current and current['pid']:
            new_pid = current['pid']
    # The pid that answers on the port must be the one this run started (or launchd reports): an
    # older instance that never really stopped would otherwise keep the port and its own token.
    holder = listener_pid(port)
    if holder != new_pid:
        raise SystemExit('reload-web: port %d is held by pid %s, not the pid %s this run started; '
                         'refusing to write its token' % (port, holder, new_pid))
    state = {'url': state_url(port, token), 'pid': new_pid, 'log': log_path}
    backup = backup_state(state_path)
    write_state(state_path, state)
    print('reload-web: pid %s -> %d, wrote %s%s' % (old_pid, new_pid, state_path,
                                                   ' (backup %s)' % backup if backup else ''))
    return state


def main(argv=None):
    parser = argparse.ArgumentParser(description='restart `dsh web` and write back ~/.bothouse/dsh-web.json')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='port the host listens on (default %d)' % DEFAULT_PORT)
    parser.add_argument('--pid', type=int, default=None, help='pid to stop (default: the listener on --port)')
    parser.add_argument('--state', default=DEFAULT_STATE, help='state file the panel reads')
    parser.add_argument('--log', default=DEFAULT_LOG, help='log the host appends to')
    parser.add_argument('--launchd-label', default=DEFAULT_LABEL, help='launchd job that supervises the host')
    parser.add_argument('--launchctl', default='launchctl', help='launchctl binary (tests inject a fake)')
    parser.add_argument('--node', default=os.environ.get('DSH_NODE') or '/opt/homebrew/bin/node')
    parser.add_argument('--dsh', default=os.environ.get('DSH_BIN') or '/opt/homebrew/bin/dsh')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    restart(args.port, args.pid, args.state, args.log, args.node, args.dsh, args.dry_run,
            args.launchd_label, args.launchctl)


if __name__ == '__main__':
    main()