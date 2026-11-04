#!/usr/bin/env -S python3 -I
"""Tests for reload-web.py: it must restart only a `dsh --profile web` host and write the new pid and
token back atomically, taking the url only from announcements printed after this start.

A fake `dsh` (this file re-invoked as a script) stands in for the real host, so no DSH install, no
collab database and no real port are involved.
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


@unittest.skipUnless(PS, 'ps is required: reload-web.py checks the process it stops')
class Parsing(unittest.TestCase):
    def test_announce_takes_the_last_line(self):
        text = ('dsh web: http://127.0.0.1:1/?token=OLD#channels\n'
                'noise\ndsh web: http://127.0.0.1:2/?token=NEW\n')
        self.assertEqual(reload_web.announce(text), 'http://127.0.0.1:2/?token=NEW')

    def test_announce_without_a_line(self):
        self.assertIsNone(reload_web.announce('still starting\n'))

    def test_write_state_is_atomic_and_private(self):
        with tempfile.TemporaryDirectory() as home:
            path = os.path.join(home, '.bothouse', 'dsh-web.json')
            reload_web.write_state(path, {'url': 'http://127.0.0.1:1/?token=T#channels', 'pid': 7, 'log': 'l'})
            with open(path) as stream:
                self.assertEqual(json.load(stream)['pid'], 7)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            # no temp file survives next to the state file
            self.assertEqual(sorted(os.listdir(os.path.dirname(path))), ['dsh-web.json'])

    def test_web_host_argument_check(self):
        fake = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)', 'dsh', '--profile', 'desktop'])
        try:
            self.assertFalse(reload_web.is_web_host(fake.pid))
        finally:
            fake.kill()
            fake.wait()


@unittest.skipUnless(PS and LSOF, 'ps/lsof are required: reload-web.py finds and checks the host')
class Restart(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix='reload-web-')
        os.makedirs(os.path.join(self.home, '.bothouse'))
        self.state = os.path.join(self.home, '.bothouse', 'dsh-web.json')
        self.log = os.path.join(self.home, '.bothouse', 'dsh-web.log')
        # a fake host named `dsh`, because reload-web.py refuses anything that is not one
        self.bin = os.path.join(self.home, 'bin')
        os.makedirs(self.bin)
        self.dsh = os.path.join(self.bin, 'dsh')
        shutil.copy(os.path.join(HERE, FAKE), self.dsh)
        self.port = free_port()

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def start_fake(self, port, token='OLD'):
        process = subprocess.Popen([sys.executable, self.dsh, '--profile', 'web',
                                    '--no-open', '--port', str(port), '--token', token],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: (process.kill(), process.wait()))
        self.assertTrue(wait_listening(port), 'fake host did not listen')
        return process

    def test_restart_rewrites_state_with_new_pid_and_token(self):
        old = self.start_fake(self.port, token='OLD')
        with open(self.log, 'a') as stream:
            stream.write('dsh web: http://127.0.0.1:%d/?token=OLD#channels\n' % self.port)  # a previous run
        with open(self.state, 'w') as stream:
            json.dump({'url': 'http://127.0.0.1:%d/?token=OLD#channels' % self.port, 'pid': old.pid, 'log': self.log}, stream)

        state = reload_web.restart(self.port, None, self.state, self.log, sys.executable, self.dsh)
        with open(self.state) as stream:
            disk = json.load(stream)
        self.assertEqual(state, disk)
        self.assertNotEqual(disk['pid'], old.pid)
        self.assertTrue(os.kill(disk['pid'], 0) is None)
        self.assertIn('token=NEW', disk['url'])  # only the line after this start
        self.assertNotIn('token=OLD', disk['url'])
        self.assertTrue(disk['url'].endswith('#channels'))
        self.assertEqual(disk['log'], self.log)
        self.addCleanup(lambda: subprocess.run(['kill', str(disk['pid'])], check=False))
        self.assertFalse(reload_web.alive(old.pid), 'the old host must be gone')

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


if __name__ == '__main__':
    unittest.main(verbosity=2)
