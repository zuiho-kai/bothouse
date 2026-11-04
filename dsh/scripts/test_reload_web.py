#!/usr/bin/env -S python3 -I
"""Tests for reload-web.py: it must restart only a `dsh --profile web` host and write the new pid and
token back atomically, taking the url only from announcements printed after this start, always with
a loopback host, and never writing a token that does not sign in.

A fake `dsh` (test-fake-dsh.py) stands in for the real host — it announces like the real one (honouring
--public-url) and answers 303 on its own token — and a fake `launchctl` stands in for a KeepAlive job,
so no DSH install, no collab database and no real launchd job are involved.
Run: python3 -I dsh/scripts/test_reload_web.py
"""
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'reload-web.py')
FAKE = 'test-fake-dsh.py'

PS = shutil.which('ps')
LSOF = shutil.which('lsof')

# A fake launchctl: `print` reports the pid stored in FAKE_LAUNCHD_PID_FILE, and `kickstart -k` really
# restarts that process from FAKE_LAUNCHD_ARGV the way a KeepAlive job does (stop it, then start it
# again with the plist's argv, working directory and log), so the script sees a genuine handover.
FAKE_LAUNCHCTL = '''#!/usr/bin/env -S python3 -I
import os, signal, subprocess, sys, time
pid_file = os.environ['FAKE_LAUNCHD_PID_FILE']
argv = os.environ['FAKE_LAUNCHD_ARGV'].split('\\n')
command = [a for a in sys.argv[1:] if not a.startswith('gui/')]


def pid():
    with open(pid_file) as stream:
        return int(stream.read().strip())


def gone(target):
    try:
        state = subprocess.check_output(['ps', '-p', str(target), '-o', 'stat='], text=True).strip()
    except subprocess.CalledProcessError:
        return True
    return state.startswith('Z')


if command and command[0] == 'print':
    print('path = /tmp/fake.plist')
    print('state = running')
    print('arguments = {')
    for arg in argv:
        print('\\t' + arg)
    print('}')
    print('working directory = ' + os.environ['FAKE_LAUNCHD_CWD'])
    print('stdout path = ' + os.environ['FAKE_LAUNCHD_LOG'])
    print('pid = %d' % pid())
    raise SystemExit(0)
if command and command[0] == 'kickstart':
    old = pid()
    os.kill(old, signal.SIGTERM)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline and not gone(old):
        time.sleep(0.05)
    with open(os.environ['FAKE_LAUNCHD_LOG'], 'a') as log:
        child = subprocess.Popen(argv, cwd=os.environ['FAKE_LAUNCHD_CWD'], stdout=log, stderr=log,
                                 stdin=subprocess.DEVNULL)
    with open(pid_file, 'w') as stream:
        stream.write(str(child.pid))
    raise SystemExit(0)
raise SystemExit(1)
'''


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reload_web = load('reload_web', SCRIPT)


def wait_listening(port, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                return True
        time.sleep(0.1)
    return False


def read(path):
    with open(path) as stream:
        return stream.read().strip()


class Parsing(unittest.TestCase):
    def test_announce_takes_the_last_line(self):
        text = ('dsh web: http://127.0.0.1:1/?token=OLD#channels\n'
                'noise\ndsh web: http://127.0.0.1:2/?token=NEW\n')
        self.assertEqual(reload_web.announce(text), 'http://127.0.0.1:2/?token=NEW')

    def test_announce_without_a_line(self):
        self.assertIsNone(reload_web.announce('still starting\n'))

    def test_public_url_announcement_is_normalised_to_loopback(self):
        # the formal plist passes --public-url, so the announcement is the public host
        url = reload_web.announce('dsh web: https://host.ts.net/?token=T\n')
        self.assertIsNotNone(url)
        state = reload_web.state_url(49176, 'T')
        self.assertEqual(state, 'http://127.0.0.1:49176/?token=T#channels')
        self.assertNotIn('host.ts.net', state)
        self.assertTrue(state.endswith('#channels'))

    def test_write_state_is_atomic_and_private(self):
        with tempfile.TemporaryDirectory() as home:
            path = os.path.join(home, '.bothouse', 'dsh-web.json')
            reload_web.write_state(path, {'url': 'http://127.0.0.1:1/?token=T#channels', 'pid': 7, 'log': 'l'})
            with open(path) as stream:
                self.assertEqual(json.load(stream)['pid'], 7)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            # no temp file survives next to the state file
            self.assertEqual(sorted(os.listdir(os.path.dirname(path))), ['dsh-web.json'])

    def test_backup_keeps_the_previous_file(self):
        with tempfile.TemporaryDirectory() as home:
            path = os.path.join(home, 'dsh-web.json')
            with open(path, 'w') as stream:
                stream.write('{"pid": 1}')
            copy = reload_web.backup_state(path)
            self.assertTrue(copy and os.path.exists(copy))
            self.assertEqual(os.stat(copy).st_mode & 0o777, 0o600)
            with open(copy) as stream:
                self.assertEqual(json.load(stream)['pid'], 1)
            self.assertIsNone(reload_web.backup_state(os.path.join(home, 'missing.json')))

    def test_launchd_print_parses_pid_argv_and_working_directory(self):
        with tempfile.TemporaryDirectory() as home:
            fake = os.path.join(home, 'launchctl')
            with open(fake, 'w') as stream:
                stream.write(FAKE_LAUNCHCTL)
            os.chmod(fake, 0o755)
            pid_file = os.path.join(home, 'pid')
            with open(pid_file, 'w') as stream:
                stream.write('4242')
            env = {'FAKE_LAUNCHD_PID_FILE': pid_file,
                   'FAKE_LAUNCHD_ARGV': '/x/node\n/x/dsh\n--profile\nweb',
                   'FAKE_LAUNCHD_CWD': '/w', 'FAKE_LAUNCHD_LOG': '/l'}
            old = dict(os.environ)
            os.environ.update(env)
            try:
                info = reload_web.launchd_info('local.test', fake)
            finally:
                os.environ.clear()
                os.environ.update(old)
            self.assertEqual(info['pid'], 4242)
            self.assertEqual(info['argv'][-2:], ['--profile', 'web'])
            self.assertEqual(info['cwd'], '/w')
            self.assertEqual(info['log'], '/l')

    def test_missing_job_is_not_supervised(self):
        self.assertIsNone(reload_web.launchd_info('local.none', '/nonexistent/launchctl'))

    def test_missing_tool_gives_one_readable_line(self):
        with self.assertRaises(SystemExit) as caught:
            reload_web.command(['/nonexistent/tool-xyz'])
        self.assertIn('/nonexistent/tool-xyz', str(caught.exception))
        self.assertNotIsInstance(caught.exception, subprocess.CalledProcessError)


@unittest.skipUnless(PS and LSOF, 'ps/lsof are required: reload-web.py finds and checks the host')
class Restart(unittest.TestCase):
    """A host that is not supervised: the script stops it and starts its own child with the same
    argv, environment and working directory."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix='reload-web-')
        os.makedirs(os.path.join(self.home, '.bothouse'))
        self.state = os.path.join(self.home, '.bothouse', 'dsh-web.json')
        self.log = os.path.join(self.home, '.bothouse', 'dsh-web.log')
        self.tokens = os.path.join(self.home, 'tokens')
        # a fake host named `dsh`, because reload-web.py refuses anything that is not one
        self.bin = os.path.join(self.home, 'bin')
        os.makedirs(self.bin)
        self.dsh = os.path.join(self.bin, 'dsh')
        shutil.copy(os.path.join(HERE, FAKE), self.dsh)
        self.port = free_port()

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def start_fake(self, port, extra=()):
        # FAKE_DSH_TOKEN_FILE: every start hands out a new token, like the real host, even though the
        # restarted process inherits the same argv and environment
        env = dict(os.environ, FAKE_DSH_TOKEN_FILE=self.tokens)
        process = subprocess.Popen([sys.executable, self.dsh, '--profile', 'web',
                                    '--no-open', '--port', str(port)] + list(extra),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        self.addCleanup(lambda: (process.kill(), process.wait()))
        self.assertTrue(wait_listening(port), 'fake host did not listen')
        self.assertTrue(read(self.tokens), 'fake host did not mint a token')
        return process

    def restart(self, **kwargs):
        return reload_web.restart(self.port, None, self.state, self.log, sys.executable, self.dsh, **kwargs)

    def test_restart_rewrites_state_with_new_pid_and_token(self):
        old = self.start_fake(self.port)
        old_token = read(self.tokens)
        with open(self.log, 'a') as stream:
            stream.write('dsh web: http://127.0.0.1:%d/?token=STALE#channels\n' % self.port)  # a previous run
        with open(self.state, 'w') as stream:
            json.dump({'url': 'http://127.0.0.1:%d/?token=STALE#channels' % self.port,
                       'pid': old.pid, 'log': self.log}, stream)

        state = self.restart()
        with open(self.state) as stream:
            disk = json.load(stream)
        self.assertEqual(state, disk)
        self.assertNotEqual(disk['pid'], old.pid)
        self.assertIsNone(os.kill(disk['pid'], 0))
        new_token = read(self.tokens)
        self.assertNotEqual(new_token, old_token)
        # only what the new process printed after this start, never the stale line before it
        self.assertEqual(disk['url'], 'http://127.0.0.1:%d/?token=%s#channels' % (self.port, new_token))
        self.assertEqual(disk['log'], self.log)
        self.addCleanup(lambda: subprocess.run(['kill', str(disk['pid'])], check=False))
        self.assertFalse(reload_web.alive(old.pid), 'the old host must be gone')

    def test_restart_keeps_the_flags_of_the_old_host(self):
        # --public-url/--trusted-host must survive the restart, or the host's own fence changes
        self.start_fake(self.port, extra=('--public-url', 'https://host.ts.net/',
                                          '--trusted-host', 'host.ts.net'))
        state = self.restart()
        self.assertEqual(state['url'], 'http://127.0.0.1:%d/?token=%s#channels' % (self.port, read(self.tokens)))
        argv = reload_web.process_argv(state['pid'])
        self.assertIn('--public-url', argv)
        self.assertIn('https://host.ts.net/', argv)
        self.assertIn('--trusted-host', argv)
        self.addCleanup(lambda: subprocess.run(['kill', str(state['pid'])], check=False))

    def test_public_url_announcement_still_writes_loopback(self):
        # the case that used to turn the panel's 503 into a 502: the host announces its tailnet url
        self.start_fake(self.port, extra=('--public-url', 'https://host.ts.net/',))
        state = self.restart()
        self.assertEqual(state['url'], 'http://127.0.0.1:%d/?token=%s#channels' % (self.port, read(self.tokens)))
        self.assertNotIn('ts.net', state['url'])

    def test_refuses_an_announcement_whose_token_does_not_sign_in(self):
        # a host that announces a token it does not accept must not get that token written
        self.start_fake(self.port, extra=('--announce-token', 'WRONG'))
        with self.assertRaises(SystemExit) as caught:
            self.restart(timeout=15)
        self.assertIn('does not sign in', str(caught.exception))
        self.assertFalse(os.path.exists(self.state))

    def test_refuses_an_announcement_for_another_port(self):
        self.start_fake(self.port, extra=('--announce-port', '9'))
        with self.assertRaises(SystemExit) as caught:
            self.restart(timeout=15)
        self.assertIn('not the port', str(caught.exception))
        self.assertFalse(os.path.exists(self.state))

    def test_refuses_a_host_that_never_announces(self):
        self.start_fake(self.port, extra=('--silent',))
        with self.assertRaises(SystemExit) as caught:
            self.restart(timeout=5)
        self.assertIn('no "dsh web:', str(caught.exception))
        self.assertFalse(os.path.exists(self.state))

    def test_refuses_a_port_nobody_listens_on(self):
        result = subprocess.run([sys.executable, '-I', SCRIPT, '--port', str(self.port), '--state', self.state,
                                 '--log', self.log], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 1)
        self.assertIn('nothing is listening', result.stderr)
        self.assertFalse(os.path.exists(self.state))

    def test_dry_run_stops_nothing(self):
        old = self.start_fake(self.port)
        result = subprocess.run([sys.executable, '-I', SCRIPT, '--port', str(self.port), '--state', self.state,
                                 '--log', self.log, '--dsh', self.dsh, '--node', sys.executable,
                                 '--dry-run'], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('would restart', result.stdout)
        self.assertTrue(reload_web.alive(old.pid))
        self.assertFalse(os.path.exists(self.state))


@unittest.skipUnless(PS and LSOF, 'ps/lsof are required: reload-web.py finds and checks the host')
class Supervised(unittest.TestCase):
    """A launchd job with KeepAlive|RunAtLoad: SIGTERM alone would make the job respawn the host while
    this script also spawns one, so the script must restart the job through `launchctl kickstart -k`
    and take the announced address from the plist's log, not from a file this script opened."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix='reload-web-launchd-')
        os.makedirs(os.path.join(self.home, '.bothouse'))
        self.state = os.path.join(self.home, '.bothouse', 'dsh-web.json')
        self.other_log = os.path.join(self.home, '.bothouse', 'dsh-web.log')  # what --log says
        self.log = os.path.join(self.home, 'launchd-dsh-web.log')  # what the plist says
        self.tokens = os.path.join(self.home, 'tokens')
        self.bin = os.path.join(self.home, 'bin')
        os.makedirs(self.bin)
        self.dsh = os.path.join(self.bin, 'dsh')
        shutil.copy(os.path.join(HERE, FAKE), self.dsh)
        self.launchctl = os.path.join(self.bin, 'launchctl')
        with open(self.launchctl, 'w') as stream:
            stream.write(FAKE_LAUNCHCTL)
        os.chmod(self.launchctl, 0o755)
        self.pid_file = os.path.join(self.home, 'job-pid')
        self.port = free_port()
        self.argv = [sys.executable, self.dsh, '--profile', 'web', '--no-open', '--port', str(self.port),
                     '--public-url', 'https://host.ts.net/', '--trusted-host', 'host.ts.net']
        # the job runs the fake host exactly like the plist runs the real one: same argv, cwd, stdout log
        env = dict(os.environ, FAKE_DSH_TOKEN_FILE=self.tokens)
        self.log_stream = open(self.log, 'a')
        self.addCleanup(self.log_stream.close)
        self.job = subprocess.Popen(self.argv, cwd=self.home, stdout=self.log_stream,
                                    stderr=subprocess.STDOUT, env=env)
        self.addCleanup(lambda: (self.job.kill(), self.job.wait()))
        with open(self.pid_file, 'w') as stream:
            stream.write(str(self.job.pid))
        self.assertTrue(wait_listening(self.port), 'job host did not listen')
        self.env = {'FAKE_LAUNCHD_PID_FILE': self.pid_file,
                    'FAKE_LAUNCHD_ARGV': '\n'.join(self.argv),
                    'FAKE_LAUNCHD_CWD': self.home, 'FAKE_LAUNCHD_LOG': self.log,
                    # the respawned host must mint its own token, as the real one does
                    'FAKE_DSH_TOKEN_FILE': self.tokens}

    def tearDown(self):
        # the successor launched by the fake launchctl is not our child: stop it before the temp dir goes
        try:
            successor = read(self.pid_file)
        except OSError:
            successor = ''
        if successor:
            subprocess.run(['kill', successor], check=False)
        shutil.rmtree(self.home, ignore_errors=True)

    def restart(self, **kwargs):
        old = dict(os.environ)
        os.environ.update(self.env)
        try:
            return reload_web.restart(self.port, None, self.state, self.other_log, sys.executable, self.dsh,
                                      False, 'local.test', self.launchctl, **kwargs)
        finally:
            os.environ.clear()
            os.environ.update(old)

    def test_kickstart_path_writes_state_from_the_plist_log(self):
        old_token = read(self.tokens)
        state = self.restart()
        with open(self.state) as stream:
            disk = json.load(stream)
        self.assertEqual(state, disk)
        # the pid is the one launchd reports for the respawned job, not one this script spawned
        self.assertEqual(disk['pid'], int(read(self.pid_file)))
        self.assertNotEqual(disk['pid'], self.job.pid)
        # loopback is rebuilt from the announcement's token, never the tailnet host of --public-url
        new_token = read(self.tokens)
        self.assertNotEqual(new_token, old_token)
        self.assertEqual(disk['url'], 'http://127.0.0.1:%d/?token=%s#channels' % (self.port, new_token))
        self.assertNotIn('ts.net', disk['url'])
        # the host appended its announcement to the plist log, so that is the log the state records
        self.assertEqual(disk['log'], self.log)
        self.assertIn('dsh web:', read(self.log))

    def test_kickstart_that_never_announces_writes_nothing(self):
        old = dict(os.environ)
        os.environ.update(self.env)
        os.environ['FAKE_DSH_SILENT'] = '1'
        try:
            with self.assertRaises(SystemExit) as caught:
                reload_web.restart(self.port, None, self.state, self.other_log, sys.executable, self.dsh,
                                   False, 'local.test', self.launchctl, timeout=5)
        finally:
            os.environ.pop('FAKE_DSH_SILENT', None)
            os.environ.clear()
            os.environ.update(old)
        self.assertIn('no "dsh web:', str(caught.exception))
        self.assertFalse(os.path.exists(self.state), 'no state may be written when the handover is unproven')


if __name__ == '__main__':
    unittest.main(verbosity=2)