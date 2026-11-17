"""User 2026-11-17: retry a failed model three times, then use the next model."""
from unittest.mock import patch
import unittest

import test_codex_retry as fixtures


class RoleFailurePolicy(unittest.TestCase):
    setUp = fixtures.RoleCodexRetry.setUp
    invoke = fixtures.RoleCodexRetry.invoke
    run_pass = fixtures.RoleCodexRetry.run_pass

    def test_429_retries_three_times_then_sol_from_clean_head(self):
        self.m.CODEX_CHAIN = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']
        self.m.AFTER_CODEX = []
        self.m.budget.remaining.return_value = None
        attempts, clean = [], []
        original = self.invoke
        def fail_luna(cmd, **kwargs):
            model = cmd[cmd.index('-m') + 1]
            attempts.append(model)
            clean.append(not (self.m.WORK / 'partial.txt').exists())
            if model == 'gpt-6-luna':
                (self.m.WORK / 'partial.txt').write_text('unaccepted output')
                self.fail_at = len(self.calls) + 1
            else:
                self.fail_at = -1
            return original(cmd, **kwargs)
        with patch.object(self.m, 'engine_run', side_effect=fail_luna):
            self.assertTrue(self.run_pass())
        self.assertEqual(attempts, ['gpt-6-luna'] * 4 + ['gpt-6.1-sol'])
        self.assertTrue(all(clean), clean)
        self.assertTrue(all('resume' not in cmd for cmd in self.calls))
        self.assertIn('gpt-6.1-sol', self.m.LOG.read_text())

    def test_any_failure_retries_instead_of_stopping(self):
        self.m.AFTER_CODEX = []
        for error, active in [('usage limit: quota exhausted', False),
                              ('upstream_reset_replay_refused', True),
                              ('model failed', False)]:
            with self.subTest(error=error):
                self.error, self.open_tool = error, active
                self.calls.clear()
                self.assertTrue(self.run_pass())
                self.assertEqual(len(self.calls), 2)
                self.assertNotIn('resume', self.calls[1])

    def test_hydrogen_primary_retries_then_haiku(self):
        self.m.AFTER_CODEX = ['agy', 'haiku']
        self.m.budget.remaining.return_value = None
        calls = []
        def runner(name):
            def call(*args, **kwargs):
                calls.append(name)
                return name == 'haiku', 'completed' if name == 'haiku' else '429', 0
            return call
        with patch.object(self.m, 'runner', side_effect=runner):
            self.assertTrue(self.m.model_pass('hydrogen primary', 'retain facts', engine='agy'))
        self.assertEqual(calls, ['agy'] * 4 + ['haiku'])


if __name__ == '__main__':
    unittest.main()
