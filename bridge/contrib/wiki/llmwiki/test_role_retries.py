"""User 2026-11-17: retry a failed model three times, then use the next model."""
from unittest.mock import patch
import json
import os
import subprocess
import sys
import unittest

import test_codex_retry as fixtures


class RoleFailurePolicy(unittest.TestCase):
    setUp = fixtures.RoleCodexRetry.setUp
    invoke = fixtures.RoleCodexRetry.invoke
    run_pass = fixtures.RoleCodexRetry.run_pass

    def test_local_role_repository_needs_no_remote_pull(self):
        with patch.object(self.m, 'remote', side_effect=AssertionError('local wiki has no remote')):
            self.assertTrue(self.m.pull())

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

    def test_correction_retry_keeps_first_round_output(self):
        self.m.AFTER_CODEX = []
        self.acceptance.side_effect = ['requires correction', '']
        original = self.invoke
        self.fail_at = 2
        def invoke(cmd, **kwargs):
            seed, partial = self.m.WORK / 'first-round.txt', self.m.WORK / 'failed-correction.txt'
            if not self.calls:
                seed.write_text('first round output')
            else:
                self.assertEqual(seed.read_text(), 'first round output')
                self.assertFalse(partial.exists())
                if len(self.calls) == 1:
                    partial.write_text('failed correction')
            return original(cmd, **kwargs)
        with patch.object(self.m, 'engine_run', side_effect=invoke):
            self.assertTrue(self.run_pass())
        self.assertEqual(len(self.calls), 3)

    def test_hydrogen_configuration_reaches_cli(self):
        (self.root / 'config.json').write_text(json.dumps({'agy_model': 'gemini-4-hydrogen-medium'}))
        script = ("import sys; sys.path.insert(0, " + repr(str(fixtures.SOURCE.parent)) + "); "
                  "import ingest; print(ingest.MODELS['agy'])")
        env = dict(os.environ)
        env.pop('WIKI_AGY_MODEL', None)
        configured = subprocess.run([sys.executable, '-I', '-c', script], env=env,
                                    capture_output=True, text=True, check=True)
        self.assertEqual(configured.stdout.strip(), 'gemini-4-hydrogen-medium')
        overridden = subprocess.run([sys.executable, '-I', '-c', script],
                                    env=dict(env, WIKI_AGY_MODEL='fixture-model'),
                                    capture_output=True, text=True, check=True)
        self.assertEqual(overridden.stdout.strip(), 'fixture-model')
        with patch.dict(self.m.MODELS, agy=configured.stdout.strip()), \
                patch.dict(self.m.CFG, agy_cmd='/synthetic/bin/agy'), \
                patch.object(self.m, 'engine_run', return_value=subprocess.CompletedProcess(
                    [], 0, json.dumps({'status': 'SUCCESS', 'response': 'completed'}), '')) as command:
            self.assertTrue(self.m.agy('retain facts')[0])
        args = command.call_args.args[0]
        self.assertEqual(args[0], '/synthetic/bin/agy')
        self.assertEqual(args[args.index('--model') + 1], 'gemini-4-hydrogen-medium')


if __name__ == '__main__':
    unittest.main()
