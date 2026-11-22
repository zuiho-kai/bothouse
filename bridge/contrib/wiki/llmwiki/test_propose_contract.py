"""Loss regressions shared by role and main proposal implementations; no network."""
import importlib.util
from pathlib import Path
import re
import sys
import tempfile
from types import SimpleNamespace
import unittest

path = Path(sys.argv.pop(1)) if len(sys.argv) > 1 and sys.argv[1].endswith('.py') else Path(__file__).with_name('propose.py')
spec = importlib.util.spec_from_file_location('proposal_under_test', path)
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)


def fact(text='配置用新值', session='aaaaaaaa'):
    return dict(fact=text, quote=text, relay='', section='现状', domain='tooling', terms=['配置'], session=session)


def op(**kw):
    return dict(dict(facts=[0], action='append', page='tooling/a.md', section='现状',
                     lines=['- 配置用新值'], at='', title='', description='', scope='', readme=''), **kw)


class ProposalContract(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='proposal-contract-'))
        (self.root / 'tooling').mkdir()
        (self.root / 'MEMORY.md').write_text('- [工具](tooling/README.md) — 配置\n')
        (self.root / 'tooling/README.md').write_text('# 工具\n- [配置](a.md) — 配置\n')
        (self.root / 'tooling/a.md').write_text('---\nname: a\ndescription: 配置\nmetadata:\n  scope: 配置\n---\n# 配置\n## 现状\n- 无关的既有事实\n')
        (self.root / 'log.md').write_text('# 日志\n')
        lint = SimpleNamespace(PAGE_LINES=60, PAGE_CHARS=4000, MAX_TOPICS=25, README_LINE=120, BODY_LINE=300,
                               SECTIONS=('现状', '关键事实', '决策与踩坑', '待办', '历史'), META=re.compile('NEVER'))
        self.rules = P.Rules(lint)

    def ingest(self, facts, operations, sessions=None):
        prepared = (dict(title='配置', nothing_reason=''), facts, [], dict(ops=operations, unplaced=[]))
        return P.ingest(self.root, '', 'aaaaaaaa', '2026-11-20', self.rules,
                        lambda *args: dict(ops=[], unplaced=[]), 'ingest', prepared, sessions=sessions)

    def test_empty_write_cannot_account_for_a_fact(self):
        self.ingest([fact()], [op(lines=[])])
        self.assertIn('未写入', (self.root / 'log.md').read_text())
        self.assertIn('配置用新值', (self.root / 'log.md').read_text())

    def test_skip_requires_matching_body_evidence(self):
        self.ingest([fact()], [op(action='skip', at='tooling/a.md:7', lines=[])])
        self.assertIn('未写入', (self.root / 'log.md').read_text())

    def test_each_session_logs_only_its_facts(self):
        self.ingest([fact('甲会话独有的事实'), fact('乙会话独有的事实', 'bbbbbbbb')],
                    [op(lines=['- 甲会话独有的事实']), op(facts=[1], lines=['- 乙会话独有的事实'])],
                    [('aaaaaaaa', '2026-11-20'), ('bbbbbbbb', '2026-11-21')])
        log = (self.root / 'log.md').read_text()
        first, second = log.split('## [2026-11-21]')
        self.assertIn('甲会话独有的事实', first)
        self.assertNotIn('乙会话独有的事实', first)
        self.assertIn('乙会话独有的事实', second)
        self.assertNotIn('甲会话独有的事实', second)

    def test_missing_facts_is_not_cached_and_next_run_recovers(self):
        calls = []
        def call(prompt, schema, label):
            calls.append(label)
            if schema == P.FACTS_SCHEMA:
                return {} if len(calls) == 1 else dict(title='配置', nothing_reason='', facts=[fact()])
            return dict(ops=[], unplaced=[])
        with self.assertRaises((ValueError, KeyError, TypeError)):
            P.prepare(self.root, 'USER: 配置用新值', self.rules, call, 'ingest', cache=self.root / 'cache')
        result = P.prepare(self.root, 'USER: 配置用新值', self.rules, call, 'ingest', cache=self.root / 'cache')
        self.assertEqual(len(result[1]), 1)
        self.assertEqual(calls.count('ingest facts'), 2)

    def test_grounding_cannot_borrow_another_sessions_quote(self):
        transcript = '=== SESSION aaaaaaaa | 甲 ===\nUSER: 配置用新值\n=== SESSION bbbbbbbb | 乙 ===\nUSER: 乙说了其他话\n'
        kept, dropped = P.grounded([fact(session='bbbbbbbb')], transcript, self.rules)
        self.assertEqual(kept, [])
        self.assertEqual(len(dropped), 1)

    def test_multiple_pieces_keep_the_same_sessions_earlier_words(self):
        transcript = ('=== SESSION aaaaaaaa | 甲 ===\nUSER: 配置用新值\n'
                      '=== SESSION aaaaaaaa | 甲的后半段 ===\nUSER: 继续讨论其他内容\n')
        kept, dropped = P.grounded([fact()], transcript, self.rules)
        self.assertEqual(len(kept), 1)
        self.assertEqual(dropped, [])


if __name__ == '__main__':
    unittest.main()
