"""#848 diagnostics under the user's #853 retry policy, through main/split/correction calls.
Retains isolated fixtures; never invokes a model or changes an installed wiki."""
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
import uuid
from unittest.mock import patch

SOURCE = Path(os.environ.get('WIKI_CODEX_TEST_SOURCE', str(Path(__file__).with_name('ingest.py'))))
FIXTURES = Path(os.environ.get('WIKI_CODEX_TEST_FIXTURES', str(Path(__file__).parent / '.codex-test-fixtures')))


class RoleCodexRetry(unittest.TestCase):
    def setUp(self):
        self.root = FIXTURES / uuid.uuid4().hex
        self.root.mkdir(parents=True)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, WIKI_DIR=str(self.root),
            WIKI_BRIDGE_CONFIG=str(self.root / 'missing.toml'), AGENT_SESSIONS_DIR=str(self.root / 'sessions'),
            CC_JOB_DEADLINE='', WIKI_STOP_AT=''))
        sys.path.insert(0, str(SOURCE.parent))
        spec = importlib.util.spec_from_file_location('role_ingest_' + self.root.name, SOURCE)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        m = self.m
        m.REPO = m.WIKI = self.root
        m.WORK = self.root / '.ingest-work'
        m.LOG, m.USAGE = self.root / 'log', self.root / 'usage.tsv'
        # Frozen candidates need a real accepted baseline, including the correction-round snapshot.
        (self.root / '.gitignore').write_text('.ingest*\nlog\nusage.tsv\n')
        (self.root / 'log.md').write_text('# Log\n')
        for args in [('init', '-q'), ('config', 'user.name', 'Synthetic Fixture'),
                     ('config', 'user.email', 'fixture@example.invalid'), ('add', '-A'),
                     ('commit', '-qm', 'synthetic baseline')]:
            subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True)
        m.CODEX_CHAIN, m.AFTER_CODEX = ['fixture-model'], ['forbidden-fallback']
        self.stack.enter_context(patch.object(m.budget, 'remaining', return_value=1500))
        self.stack.enter_context(patch.object(m, 'home_state', return_value='unchanged'))
        self.stack.enter_context(patch.object(m.invalidate, 'run'))
        self.acceptance = self.stack.enter_context(patch.object(m, 'acceptance', return_value=''))
        self.stack.enter_context(patch.object(m, 'runner', side_effect=AssertionError('must not fall back')))
        self.calls, self.fail_at = [], 1
        self.error = 'exceeded retry limit, last status: 429 Too Many Requests'
        self.stderr, self.open_tool, self.thread = '', False, True
        self.stack.enter_context(patch.object(m, 'engine_run', side_effect=self.invoke))

    def invoke(self, cmd, **kwargs):
        self.calls.append(cmd)
        events = [{'type': 'thread.started', 'thread_id': 'fixture-thread'}] if self.thread else []
        if len(self.calls) == self.fail_at:
            if self.open_tool:
                events.append({'type': 'item.started', 'item': {'id': 'tool', 'type': 'command_execution'}})
            events.extend([{'type': 'error', 'message': self.error},
                           {'type': 'turn.failed', 'error': {'message': self.error}}])
            return subprocess.CompletedProcess(cmd, 1, '\n'.join(map(json.dumps, events)), self.stderr)
        Path(cmd[cmd.index('-o') + 1]).write_text('Completed the requested work.')
        events.append({'type': 'turn.completed', 'usage': {}})
        return subprocess.CompletedProcess(cmd, 0, '\n'.join(map(json.dumps, events)), '')

    def run_pass(self, kind='ingest'):
        return self.m.model_pass('fixture ' + kind, 'retain facts', engine='codex', kind=kind)

    def production_fixtures(self):
        return sorted((Path(__file__).parent / 'fixtures/codex-connect-429').glob('*.json'))

    def test_three_production_stderr_retry_fresh(self):
        fixtures = self.production_fixtures()
        self.assertEqual(len(fixtures), 3)
        for fixture in fixtures:
            with self.subTest(fixture=fixture.name):
                data = json.loads(fixture.read_text())
                self.stderr, self.error = data['stderr'], data['error']
                self.calls.clear()
                self.assertTrue(self.run_pass())
                self.assertEqual(len(self.calls), 2)
                self.assertNotIn('resume', self.calls[1])
                self.assertEqual(self.calls[0][self.calls[0].index('-m') + 1],
                                 self.calls[1][self.calls[1].index('-m') + 1])

    def test_no_thread_execs_again(self):
        self.stderr = json.loads(self.production_fixtures()[0].read_text())['stderr']
        self.thread = False
        self.assertTrue(self.run_pass())
        self.assertEqual(len(self.calls), 2)
        self.assertNotIn('resume', self.calls[1])

    def test_quota_and_unfinished_tool_retry_after_discard(self):
        self.stderr = json.loads(self.production_fixtures()[0].read_text())['stderr']
        for error, tool in [('usage limit: quota exhausted', False), (self.error, True)]:
            with self.subTest(error=error, tool=tool):
                self.error, self.open_tool = error, tool
                self.calls.clear()
                self.assertTrue(self.run_pass())
                self.assertEqual(len(self.calls), 2)

    def test_split_and_correction_continue(self):
        self.stderr = json.loads(self.production_fixtures()[0].read_text())['stderr']
        self.assertTrue(self.run_pass('restructure'))
        self.assertEqual(len(self.calls), 2)
        self.calls.clear()
        self.fail_at = 2
        self.acceptance.side_effect = ['requires a correction', '']
        self.assertTrue(self.run_pass())
        self.assertEqual(len(self.calls), 3)
        self.assertNotIn('resume', self.calls[-1])

    def test_capacity_without_terminal_event_and_gave_up_keep_model_chain(self):
        self.m.CODEX_CHAIN = ['m1', 'm2', 'm3']
        self.m.AFTER_CODEX = []
        self.m.budget.remaining.return_value = None
        def invoke(cmd, **kwargs):
            self.calls.append(cmd)
            model = cmd[cmd.index('-m') + 1]
            events = [{'type': 'thread.started', 'thread_id': 'fixture-thread'}]
            if model == 'm1':
                events.append({'type': 'error', 'message': 'Selected model is at capacity'})
                return subprocess.CompletedProcess(cmd, 1, '\n'.join(map(json.dumps, events)), '')
            output = '这轮没有完成原任务。' if model == 'm2' else 'Completed the requested work.'
            Path(cmd[cmd.index('-o') + 1]).write_text(output)
            events.append({'type': 'turn.completed', 'usage': {}})
            return subprocess.CompletedProcess(cmd, 0, '\n'.join(map(json.dumps, events)), '')
        with patch.object(self.m, 'engine_run', side_effect=invoke):
            self.assertTrue(self.run_pass())
        self.assertEqual([c[c.index('-m') + 1] for c in self.calls], ['m1'] * 4 + ['m2'] * 4 + ['m3'])
        self.assertTrue(all('resume' not in c for c in self.calls))

    def test_budget_slots_and_short_remainder(self):
        self.stderr = json.loads(self.production_fixtures()[0].read_text())['stderr']
        with patch.object(self.m.budget, 'remaining', return_value=510):
            self.assertFalse(self.run_pass())
        self.assertEqual(self.calls, [])
        original = self.invoke
        def fail(cmd, **kwargs):
            self.fail_at = len(self.calls) + 1
            return original(cmd, **kwargs)
        # A real deadline decreases; retries spend elapsed time rather than fictitious full slots.
        with patch.object(self.m, 'engine_run', side_effect=fail), \
                patch.object(self.m, 'round_remaining', side_effect=[1500, 1500, 989, 478]):
            self.assertFalse(self.run_pass())
        self.assertEqual(len(self.calls), 1500 // 511)


if __name__ == '__main__':
    unittest.main()
