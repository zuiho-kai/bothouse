#!/usr/bin/env -S python3 -I
"""Tests for reload-dsh.py: the release entry must hand the restart to reload-web.py, pass its
arguments through unchanged, fail loudly when the release was built without that script, and never
swallow a non-zero exit (a release that cannot write ~/.bothouse/dsh-web.json must fail, not pass).

No real host and no real port are involved: reload-web.py is replaced by a stub in a temp directory.
Run: python3 -I dsh/scripts/test_reload_dsh.py
"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'reload-dsh.py')

STUB = '''#!/usr/bin/env -S python3 -I
import json, sys
print(json.dumps(sys.argv[1:]))
sys.exit(int(open(__file__ + '.exit').read()) if __import__('os').path.exists(__file__ + '.exit') else 0)
'''


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reload_dsh = load('reload_dsh', SCRIPT)


class Release(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='reload-dsh-')
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.script = os.path.join(self.dir, 'reload-dsh.py')
        shutil.copy(SCRIPT, self.script)
        self.web = os.path.join(self.dir, 'reload-web.py')

    def run_script(self, args):
        return subprocess.run([sys.executable, '-I', self.script] + args, capture_output=True,
                              text=True, timeout=120)

    def install_stub(self):
        with open(self.web, 'w') as stream:
            stream.write(STUB)
        os.chmod(self.web, 0o755)

    def test_web_hands_the_restart_to_reload_web(self):
        self.install_stub()
        result = subprocess.run([sys.executable, '-I', self.script, 'web', '--port', '49177',
                                 '--state', '/nonexistent/state.json', '--dry-run'],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        # the stub prints the argv it received: the entry adds nothing and drops nothing
        self.assertEqual(result.stdout.strip(), '["--port", "49177", "--state", "/nonexistent/state.json", "--dry-run"]')

    def test_web_fails_when_the_release_lacks_reload_web(self):
        # a release built before PR #1020 has no reload-web.py; running web must fail, not silently pass
        self.assertFalse(os.path.exists(self.web))
        result = self.run_script(['web'])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('PR #1020', result.stderr)

    def test_web_propagates_a_failed_restart(self):
        self.install_stub()
        with open(self.web + '.exit', 'w') as stream:
            stream.write('1')
        result = self.run_script(['web'])
        self.assertEqual(result.returncode, 1)

    def test_unknown_step_is_refused(self):
        result = self.run_script(['start'])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('reload-dsh.py web', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
