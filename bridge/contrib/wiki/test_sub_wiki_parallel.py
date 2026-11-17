"""Exercise the real scheduler entry with isolated, bounded role programs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest


class ParallelRoles(unittest.TestCase):
    def test_nightly_roles_overlap_and_ignore_daytime_newest_flag(self):
        root = Path(tempfile.mkdtemp(prefix='wiki-role-parallel-'))
        shutil.copy2(Path(__file__).with_name('sub-wiki.py'), root / 'sub-wiki.py')
        (root / 'llmwiki').mkdir()
        shutil.copy2(Path(__file__).parent / 'llmwiki/budget.py', root / 'llmwiki/budget.py')
        rows = []
        for name in ('gge', 'gjiang', 'deep'):
            role = root / name
            (role / 'bin').mkdir(parents=True)
            rows.append(f'{name} {name} {role}')
            (role / 'bin' / 'ingest.py').write_text('''import json, os, subprocess, sys, time
from pathlib import Path
role = Path(os.environ['WIKI_DIR'])
(role / 'started').write_text(str(time.monotonic()))
until = time.monotonic() + 1
while not all((role.parent / name / 'started').exists() for name in ('gge','gjiang','deep')) and time.monotonic() < until:
    time.sleep(0.01)
overlap = all((role.parent / name / 'started').exists() for name in ('gge','gjiang','deep'))
if os.name != 'nt':
    sys.path.insert(0, str(role.parent / 'llmwiki'))
    import budget
    if role.name == 'gge':
        try:
            budget.run([sys.executable, '-c', 'import time; time.sleep(1)'], timeout=0.05)
        except subprocess.TimeoutExpired:
            pass
        (role.parent / 'timed-out').write_text('gge only')
    else:
        until = time.monotonic() + 1
        while not (role.parent / 'timed-out').exists() and time.monotonic() < until:
            time.sleep(0.01)
(role / 'result.json').write_text(json.dumps({'overlap': overlap, 'newest': os.environ.get('WIKI_NEWEST_FIRST'), 'pgid': os.getpgrp() if os.name != 'nt' else None, 'ended': time.monotonic()}))
''')
        (root / 'export.py').write_text("import sys\nif '--list' in sys.argv: print(" + repr('\n'.join(rows)) + ')\n')
        env = dict(os.environ, WIKI_NEWEST_FIRST='1', CC_JOB_DEADLINE=str(time.time() + 30),
                   CC_JOB_DEADLINE_FALLBACK='', WIKI_STOP_AT='')
        result = subprocess.run([sys.executable, '-I', str(root / 'sub-wiki.py'), 'nightly'],
                                env=env, capture_output=True, text=True, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        observations = [json.loads((root / name / 'result.json').read_text()) for name in ('gge', 'gjiang', 'deep')]
        self.assertTrue(all(row['overlap'] for row in observations), observations)
        self.assertTrue(all(not row['newest'] for row in observations), observations)
        if os.name != 'nt':
            self.assertEqual(len({row['pgid'] for row in observations}), len(rows))


if __name__ == '__main__':
    unittest.main()
