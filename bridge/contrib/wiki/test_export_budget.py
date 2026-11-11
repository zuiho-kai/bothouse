#!/usr/bin/env python3
"""#659 rework: deadline semantics and the real sub-wiki -> budget.run -> export boundary."""
import contextlib
import importlib.util
import os
import subprocess
import sys
import time
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_rolewiki import ExportLockWait


class ExportBudget(unittest.TestCase):
    setUp = ExportLockWait.setUp
    hold = ExportLockWait.hold
    state = ExportLockWait.state

    def module(self):
        spec = importlib.util.spec_from_file_location('role_export', HERE / 'export.py')
        mod = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, self.env, clear=True):
            spec.loader.exec_module(mod)
        return mod

    @contextlib.contextmanager
    def clock(self, mod, deadline, old=False):
        now = [100.0]
        sleeps = []

        def sleep(seconds):
            sleeps.append(seconds)
            now[0] += seconds
            if now[0] > 104:
                raise AssertionError('wait ignored the supplied absolute deadline')

        clock = SimpleNamespace(time=lambda: now[0], sleep=sleep)
        env = dict(self.env)
        if deadline is not None:
            env['CC_JOB_DEADLINE'] = deadline
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, env, clear=True))
            stack.enter_context(patch.object(mod, 'time', clock))
            if old:
                stack.enter_context(patch.object(mod, 'budget', None))
            else:
                stack.enter_context(patch.object(mod.budget, 'time', clock))
                stack.enter_context(patch.object(mod.budget, '_fallback_end', None))
            yield now, sleeps

    def test_old_module_uses_absolute_deadline_and_clips_last_sleep(self):
        mod = self.module()
        with self.clock(mod, '100.35', old=True) as (now, sleeps):
            with patch.object(mod.filelock, 'lock', side_effect=BlockingIOError):
                self.assertIsNone(mod.lock_or_busy(object(), True))
            self.assertAlmostEqual(now[0], 100.35)
            self.assertLessEqual(sleeps[-1], 0.15 + 1e-10)

    def test_explicit_unlimited_stays_unlimited_with_or_without_budget(self):
        for old in (False, True):
            with self.subTest(old=old):
                mod = self.module()
                with self.clock(mod, '', old=old) as (now, sleeps):
                    def sleep(seconds):
                        now[0] += mod.NIGHT_WINDOW + 1
                    with patch.object(mod.time, 'sleep', side_effect=sleep), \
                            patch.object(mod.filelock, 'lock', side_effect=[BlockingIOError, BlockingIOError, None]):
                        self.assertIs(mod.lock_or_busy(object(), True), True)
                    self.assertEqual(os.environ['CC_JOB_DEADLINE'], '')

    def test_missing_deadline_is_armed_once_for_all_bots(self):
        for old in (False, True):
            with self.subTest(old=old):
                mod = self.module()
                with self.clock(mod, None, old=old) as (now, sleeps):
                    with patch.object(mod.filelock, 'lock', side_effect=BlockingIOError):
                        with patch.object(mod, 'NIGHT_WINDOW', 0.35):
                            if not old:
                                with patch.object(mod.budget, 'FALLBACK_NIGHT_WINDOW', 2.35):
                                    self.assertIsNone(mod.lock_or_busy(object(), True))
                            else:
                                self.assertIsNone(mod.lock_or_busy(object(), True))
                    deadline = os.environ.get('CC_JOB_DEADLINE')
                    self.assertIsNotNone(deadline, 'the round must publish its one fallback deadline')
                    with patch.object(mod.filelock, 'lock') as take:
                        self.assertIsNone(mod.lock_or_busy(object(), True))
                        take.assert_not_called()
                    self.assertEqual(os.environ['CC_JOB_DEADLINE'], deadline)

    def test_expired_budget_never_attempts_a_free_lock(self):
        for old, deadline in ((False, '102'), (True, '100')):
            with self.subTest(old=old):
                mod = self.module()
                with self.clock(mod, deadline, old=old):
                    with patch.object(mod.filelock, 'lock') as take:
                        self.assertIsNone(mod.lock_or_busy(object(), True))
                        take.assert_not_called()

    def test_deadline_rechecked_after_lock_acquisition(self):
        mod = self.module()
        with self.clock(mod, '102.1') as (now, sleeps):
            with patch.object(mod.filelock, 'lock', side_effect=lambda *_: now.__setitem__(0, 100.2)):
                self.assertIsNone(mod.lock_or_busy(object(), True))

    def test_expired_export_without_a_wiki_lock_preserves_state(self):
        mod = self.module()
        with self.clock(mod, '102'):
            with patch.object(mod, 'sources') as sources:
                result = mod.export('whale', out=self.tmp / 'no-lock-output')
                self.assertEqual(result['failed'], 1)
                sources.assert_not_called()
        self.assertFalse((self.tmp / 'no-lock-output').exists())

    def test_real_nightly_entry_stops_with_held_lock(self):
        """The actual CLI entry, with no clock/process/run replacements and no scheduling fault injection."""
        before = self.state()
        holder = self.hold(60)
        fixture = self.tmp / 'program'
        (fixture / 'llmwiki').mkdir(parents=True)
        for name in ('budget.py', 'filelock.py'):
            (fixture / 'llmwiki' / name).write_bytes((HERE / 'llmwiki' / name).read_bytes())
        for name in ('sub-wiki.py', 'export.py'):
            (fixture / name).write_bytes((HERE / name).read_bytes())
        env = dict(self.env, CC_JOB_DEADLINE=str(time.time() + 3))
        result = subprocess.run([sys.executable, '-I', str(fixture / 'sub-wiki.py'), 'nightly'],
                                env=env, capture_output=True, text=True, timeout=15,
                                start_new_session=(os.name != 'nt'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        log = (fixture / 'sub-wiki.log').read_text()
        self.assertIn('export failed (ingest still runs on what is there)', log)
        self.assertIn('done nightly', log)
        self.assertNotIn('whale ingest', log)
        self.assertEqual(self.state(), before)
        self.assertFalse((self.tmp / 'tr').exists())
        self.assertIsNone(holder.poll())
        print(f'入口自验：{fixture / "sub-wiki.py"} nightly; rc={result.returncode}; '
              f'offsets/pending_parts unchanged; ingest not started\n{log}', flush=True)

    def test_real_nightly_parent_timeout_is_reported_after_cleanup(self):
        """Pin the race: after the first real flock failure, pause the exporter past the parent's deadline.
        Keep real budget.run/processes/Popen, real export/main, and a separate process holding the actual lock.
        """
        before = self.state()
        holder = self.hold(60)
        fixture = self.tmp / 'program'
        (fixture / 'llmwiki').mkdir(parents=True)
        for name in ('budget.py', 'filelock.py'):
            (fixture / 'llmwiki' / name).write_bytes((HERE / 'llmwiki' / name).read_bytes())
        (fixture / 'sub-wiki.py').write_bytes((HERE / 'sub-wiki.py').read_bytes())
        child_pid = self.tmp / 'export.pid'
        # Scheduling fault injection only: real export code and flock run before the forced pause.
        wrapper = (
            'import os,runpy,sys,time\n'
            f'sys.path.insert(0, {str(fixture / "llmwiki")!r})\n'
            'import filelock\n'
            f'g = runpy.run_path({str(HERE / "export.py")!r}, run_name="fixture_export")\n'
            'original = filelock.lock\n'
            'def pause_after_busy(f, wait=True):\n'
            '    try: return original(f, wait)\n'
            '    except BlockingIOError:\n'
            f'        open({str(child_pid)!r}, "w").write(str(os.getpid()))\n'
            '        time.sleep(60)\n'
            '        raise\n'
            'filelock.lock = pause_after_busy\n'
            'g["main"]()\n'
        )
        (fixture / 'export.py').write_text(wrapper)
        driver = self.tmp / 'nightly.py'
        driver.write_text(
            'import os,runpy,sys,time\n'
            f'g = runpy.run_path({str(fixture / "sub-wiki.py")!r}, run_name="fixture_subwiki")\n'
            'real_run = g["budget"].run\n'
            'def run(cmd, **kw):\n'
            '    if "--list" not in cmd:\n'
            '        os.environ["CC_JOB_DEADLINE"] = str(time.time() + 3)\n'
            '    return real_run(cmd, **kw)\n'
            'g["budget"].run = run\n'
            'sys.exit(g["main"](["sub-wiki.py", "nightly"]))\n'
        )
        # A fresh group isolates budget.run's real ownership snapshot from the test runner.
        env = dict(self.env, CC_JOB_DEADLINE=str(time.time() + 60))
        result = subprocess.run([sys.executable, '-I', str(driver)], env=env, capture_output=True, text=True,
                                start_new_session=(os.name != 'nt'), timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('TimeoutExpired', result.stderr)
        log = (fixture / 'sub-wiki.log').read_text()
        self.assertIn('export failed (ingest still runs on what is there)', log)
        self.assertIn('done nightly', log)
        self.assertTrue(child_pid.exists(), 'the child must reach the real held lock')
        pid = int(child_pid.read_text())
        if os.name != 'nt':
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
        self.assertIsNone(holder.poll(), 'the unrelated writer must remain alive')
        self.assertEqual(self.state(), before)
        self.assertFalse((self.tmp / 'tr').exists())
        print(f'入口自验：sub-wiki nightly -> real budget.run -> real export; rc={result.returncode}; '
              f'export_reaped={pid}; offsets/pending_parts unchanged; writer alive\n{log}', flush=True)


if __name__ == '__main__':
    unittest.main()
