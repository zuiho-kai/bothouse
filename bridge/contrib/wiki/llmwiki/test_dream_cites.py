#!/usr/bin/env python3 -I
import re
"""Reviewed citation-ID regressions: fake engines and temporary wikis only."""
import json, math, sqlite3, sys, time, unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_ingest import Fake, I, jsonl, user, claude, Speakers
import lint


class OldBudget(Fake):
    """These fixtures were sized for the 60-line/4000-char page budget; SOP v2 raised it to 159/13874 (lint.py),
    so the budget paths are exercised at the old size rather than rewriting every fixture."""

    def setUp(self):
        super().setUp()
        for k, v in (("PAGE_LINES", 60), ("PAGE_CHARS", 4000)):  # pre-SOP-v2 lint.py values
            p = mock.patch.object(I.lint, k, v)
            p.start()
            self.addCleanup(p.stop)


class Citations(Fake):
    def setUp(self):
        super().setUp()
        self.page('tooling/rule-candidates.md', '- old')
        self.commit('base')
        self.refs = {'U1': ('10-17', 'aaaaaaaa', '别乱加'),
                     'U2': ('10-17', 'aaaaaaaa', '先看原话'),
                     'U3': ('10-17', 'bbbbbbbb', '别重复')}
        self.said = {'aaaaaaaa': '别乱加\n先看原话', 'bbbbbbbb': '别重复'}

    def test_only_direct_user_gets_number(self):
        p = self.root / 'im-bridge' / 'aaaaaaaa.jsonl'
        jsonl(p, [claude('今天做完的'), user(Speakers.BLOCK),
                  user('【鲸鱼娘】不是用户'), user('（定时任务）\n检查'),
                  user('[replying to 彩虹猫: hi]\n说中文')])
        refs = {}
        d = I.dialog(p, 0, citations=refs)
        self.assertEqual(list(refs.values()), [('10-17', 'aaaaaaaa', '你看一下')])
        self.assertIn('USER [10-17] U1: 你看一下', d['text'])
        self.assertEqual(d['quotable'], [('10-17', '你看一下')])

    def test_classifier_uses_existing_default_and_only_yes_no(self):
        with mock.patch.object(I, 'DREAM_ENGINE', 'codex:high'), \
             mock.patch.object(I, 'codex', return_value=(True, '不是', 0, None)) as run:
            self.assertFalse(I.rule_correction('规则X', '普通任务'))
        self.assertEqual(run.call_args.kwargs['model'], I.MODELS['codex'])

    def test_short_quote_is_first_sentence_prefix(self):
        self.assertEqual(I.short_quote('不符合预期。你开并发了吗？'), '不符合预期。')
        self.assertEqual(I.short_quote('没有句号的话'), '没有句号的话')

    def test_rule_name_after_backfill_is_not_a_quote_in_final_guard(self):
        self.page('tooling/rule-candidates.md', '- 补证 10-17 aaaaaaaa「别乱加」；对应规则「修 bug/定方案」')
        self.assertEqual(I.misquotes(self.said), '')
        self.assertEqual(I.misquotes(self.said, citations=self.refs), '')

    def test_backfills_are_trusted_on_retry_and_in_final_guard(self):
        # Even if transcript lookup disagrees, the numbered USER source is authoritative.
        self.page('tooling/rule-candidates.md', '- 补证 10-17 aaaaaaaa「别乱加」')
        with mock.patch.object(I, 'transcripts', return_value={'aaaaaaaa': self.root / 'missing.jsonl'}), \
             mock.patch.object(I, 'dialog', side_effect=AssertionError('backfill transcript rechecked')):
            self.assertEqual(I.misquotes({}, citations=self.refs), '')

    def test_backfilled_user_text_with_nested_quotes_is_trusted(self):
        self.refs['U4'] = ('10-17', 'aaaaaaaa', '规则「修 bug/定方案」先看原话')
        self.page('tooling/rule-candidates.md', '- 补证 10-17 aaaaaaaa「规则「修 bug/定方案」先看原话」；对应「规则名」')
        self.assertEqual(I.misquotes({}, citations=self.refs), '')



class DreamSplit(OldBudget):
    def test_no_split_without_evidence_or_after_deadline(self):
        p = self.root / 'aaaaaaaa.jsonl'
        now = time.time()
        jsonl(p, [user('以后先看原话', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)))])
        for paths, deadline in (({}, now + 3600), ({p.stem: p}, now - 1)):
            with self.subTest(paths=bool(paths)), sqlite3.connect(':memory:') as db:
                db.execute('create table dreamed(id text primary key, offset int, at real)')
                db.execute('create table alerts(kind text primary key, day text)')
                with mock.patch.multiple(I, transcripts=lambda **kw: paths, reflect=lambda *a: False), \
                     mock.patch.object(I, 'split_pass') as split, mock.patch.object(I, 'model_pass') as model:
                    I.dream(db, deadline)
                split.assert_not_called()
                model.assert_not_called()

    def test_reflect_render_writes_page_todos_candidates_and_budget(self):
        rel = 'tooling/daily-reflection.md'
        old_days = "\n".join(f"- 2026-10-{d:02d} 反思\n  - 钱：" + "旧" * 200 for d in range(1, 15))
        self.page(rel, "## 关键事实\n" + old_days + "\n## 待办\n- 明早待办（2026-10-01 反思，a 类）：旧待办")
        self.page('tooling/rule-candidates.md', '## 待办\n- x')
        refs = {'U1': ('10-21', 'aaaaaaaa', '别乱加。后面')}
        ans = ('{"钱": {"问题": "贵", "来源": "U1", "根因": "长会话", "改法": [{"类": "a", "内容": "切会话"}, '
               '{"类": "b", "内容": "加规则", "规则": "CLAUDE.md/干活"}]}, "慢": {"无": true}, "返工": [{"无法判断": "缺数据"}], '
               '"昨日对照": "无对照"}')
        with mock.patch.object(I, 'dream_page', return_value='tooling/rule-candidates.md'):
            self.assertEqual(I.reflect_render(ans, '2026-10-21', refs, rel), '')
        text = (self.w / rel).read_text()
        self.assertIn('- 2026-10-21 反思', text)
        self.assertIn('来源：10-21 aaaaaaaa「别乱加。」', text)
        self.assertIn('  - 返工：无法判断（缺数据）', text)
        self.assertIn('  - 答应了没做：无', text)
        self.assertIn('- 明早待办（2026-10-21 反思，a 类）：切会话', text)
        self.assertIn('旧待办', text)
        self.assertLessEqual(len(text), I.lint.PAGE_CHARS)
        self.assertIn('移入「历史」的较早反思', (self.w / 'log.md').read_text())
        self.assertIn('「加规则」加进 CLAUDE.md/干活', (self.w / 'tooling/rule-candidates.md').read_text())

    def test_reflect_render_rejects_non_json(self):
        self.assertIn('not the JSON', I.reflect_render('完成了', '2026-10-21', {}, 'tooling/daily-reflection.md'))

    def test_dream_render_ops(self):
        self.page('tooling/rule-candidates.md', '## 关键事实\n- 已有规则仍犯：规则X「别乱加」：出现 1 次（10-16 bbbbbbbb「旧」）\n- 先看原话模式：出现 1 次（10-16 cccccccc「旧2」）\n## 待办\n- y')
        refs = {'U1': ('10-17', 'aaaaaaaa', '别乱加'), 'U2': ('10-17', 'aaaaaaaa', '先看原话')}
        known = {'aaaaaaaa', 'bbbbbbbb', 'cccccccc'}
        ans = ('{"ops": [{"op": "recur", "rule": "规则X「别乱加」", "ids": ["U1"]}, '
               '{"op": "add", "to": "先看原话模式", "ids": ["U2"], "草稿": "先看原话再动手", "规则": "CLAUDE.md/干活"}, '
               '{"op": "new", "模式": "新东西", "ids": ["U9"]}]}')
        with mock.patch.object(I, 'rule_correction', return_value=True), \
             mock.patch.object(I, 'dream_page', return_value='tooling/rule-candidates.md'):
            self.assertEqual(I.dream_render(ans, refs, known, {}, 'dream 1'), '')
        text = (self.w / 'tooling/rule-candidates.md').read_text()
        self.assertIn('规则X「别乱加」：出现 2 次', text)
        long = '- 很长的旧模式：出现 1 次（' + '；'.join(f'10-0{d} dddddddd「{"旧" * 80}」' for d in range(1, 9)) + '）'
        self.page('tooling/rule-candidates.md', '## 关键事实\n' + long + '\n## 待办\n- y')
        with mock.patch.object(I, 'dream_page', return_value='tooling/rule-candidates.md'):
            I.dream_render('{"ops": [{"op": "new", "模式": "新模式", "ids": ["U2"]}]}', refs, known, {}, 'dream 2')
        squeezed = (self.w / 'tooling/rule-candidates.md').read_text()
        self.assertIn('- 新模式：出现 1 次', squeezed)
        self.assertIn('10-17 aaaaaaaa「先看原话」', squeezed)  # tonight's evidence keeps its words
        self.assertLessEqual(len(squeezed), I.lint.PAGE_CHARS)
        self.assertIn('  - 10-17 aaaaaaaa「别乱加」', text)
        todo = text.split('## 待办')[1]
        self.assertIn('是否把「先看原话再动手」加进 CLAUDE.md/干活', todo)
        self.assertIn('dream 建议，用户未答复', todo)
        self.assertNotIn('新东西', text)  # U9 unknown: nothing to cite, not written
        self.assertIn('unknown ID U9', I.LOG.read_text())
        self.assertIn('## [', (self.w / 'log.md').read_text())
        self.assertIn('not the JSON', I.dream_render('好了', refs, known, {}, 'dream 1'))


    def test_answer_json_takes_first_object_and_rejects_a_declined_task(self):
        # replay 2026-10-22: jingyu's reflection ended in one stray 「}」; longniang's dream answered {"error": …, "ops": []}
        self.assertEqual(I.answer_json('{"钱": {"无": true}}}'), {"钱": {"无": True}})
        self.assertEqual(I.answer_json('好的：\n{"ops": []}\n{"ops": [1]}'), {"ops": []})
        with self.assertRaisesRegex(ValueError, 'declines'):
            I.answer_json('{"error": "无法完成评估", "ops": []}')
        self.page('tooling/rule-candidates.md', '## 关键事实\n- x\n## 待办\n- y')
        with mock.patch.object(I, 'dream_page', return_value='tooling/rule-candidates.md'):
            self.assertIn('declines', I.dream_render('{"error": "没有读取接口", "ops": []}', {}, set(), {}, 'dream 1'))
        self.assertIn('declines', I.reflect_render('{"error": "不能读"}', '2026-10-21', {}, 'tooling/daily-reflection.md'))

    def test_dream_keeps_every_quote_and_leaves_an_over_budget_page_to_split_pass(self):
        # SOP v2 (不遗忘): no compression step; tonight's quotes stay whole, nothing goes to log.md, split_pass splits later
        self.page('tooling/rule-candidates.md', '## 关键事实\n- x\n## 待办\n- y')
        refs = {f'U{k}': ('10-21', f'{k:08x}', f'第{k}句' + '长' * 120) for k in range(1, 31)}
        known = {v[1] for v in refs.values()}
        ans = json.dumps({"ops": [{"op": "new", "模式": f"模式{m}", "ids": [f"U{k}" for k in range(m * 10 + 1, m * 10 + 11)]}
                                  for m in range(3)]}, ensure_ascii=False)
        with mock.patch.object(I, 'dream_page', return_value='tooling/rule-candidates.md'):
            self.assertEqual(I.dream_render(ans, refs, known, {}, 'dream 1'), '')
        text = (self.w / 'tooling/rule-candidates.md').read_text()
        self.assertIn('模式0：出现 10 次', text)
        for k in range(1, 31):
            self.assertIn(f'第{k}句' + '长' * 120, text)  # every quote kept verbatim
        self.assertIn('- x', text)
        self.assertNotIn('原话移入 log', (self.w / 'log.md').read_text())
        if I.over_budget(text):
            self.assertIn('over budget, left for split_pass', I.LOG.read_text())

    def test_reflect_budget_when_today_alone_is_too_long(self):
        rel = 'tooling/daily-reflection.md'
        self.page(rel, "## 关键事实\n## 待办\n")
        refs = {f'U{k}': ('10-21', f'{k:08x}', '长' * 150) for k in range(1, 25)}
        item = lambda n: {"问题": "问题" * 20, "来源": "、".join(f"U{k}" for k in range(n, n + 6)), "根因": "根因",
                          "改法": [{"类": "a", "内容": "改" * 60}]}
        ans = json.dumps({"钱": item(1), "慢": item(7), "返工": item(13), "答应了没做": item(19)}, ensure_ascii=False)
        self.assertEqual(I.reflect_render(ans, '2026-10-21', refs, rel), '')
        text = (self.w / rel).read_text()
        self.assertFalse(I.over_budget(text))
        self.assertIn('（来源：见 2026-10-21 反思）', text)  # 明早待办 points at the section instead of copying it
        self.assertEqual(text.count('- 明早待办（2026-10-21 反思，a 类）'), 4)
        self.assertIn('10-21 00000018', text)
        self.assertIn('篇幅超限，原话移入 log：10-21 ', (self.w / 'log.md').read_text())

    def test_reflect_cites_once_without_the_models_own_sid(self):
        rel = 'tooling/daily-reflection.md'
        self.page(rel, "## 关键事实\n## 待办\n")
        refs = {'U1': ('10-22', '99cab942', '太久了'), 'U2': ('10-22', '99cab942', '10分钟')}
        ans = '{"慢": {"问题": "慢", "来源": "10-22 99cab942 U1、U1、U2", "根因": "等", "改法": []}}'
        self.assertEqual(I.reflect_render(ans, '2026-10-21', refs, rel), '')
        self.assertIn('（来源：10-22 99cab942「太久了」、10-22 99cab942「10分钟」）', (self.w / rel).read_text())

    def test_bridge_preamble_is_not_the_users_words(self):
        pre = ('[Task lifecycle]\nBefore manage_task actions, check.\n\n[Bridge identity — current responder]\n'
               'Your conversation name is "橘".\n[Request and reference material]\n')
        self.assertEqual(I.speakers(pre + '帮我看看日志'), [('USER', '帮我看看日志')])
        self.assertEqual(I.speakers(pre), [])
        self.assertEqual(I.speakers(pre + '在终端里', False), [('USER', '在终端里')])
        self.assertEqual(I.speakers('引用一下 [Task lifecycle]\nx'), [('USER', '引用一下 [Task lifecycle]\nx')])


class ReviewFixes(OldBudget):
    """One regression per item of ~/.claude/reviews/dream-structured-code.md (M1–M7, L1, L3); each fails on fd77cd9."""
    RC, RP = 'tooling/rule-candidates.md', 'tooling/daily-reflection.md'
    NONE = {"慢": {"无": True}, "返工": {"无": True}, "答应了没做": {"无": True}, "昨日对照": "无对照"}

    def setUp(self):
        super().setUp()
        self.page(self.RC, '- old\n## 关键事实\n## 待办')
        self.page(self.RP, '# x\n## 关键事实\n## 待办')
        (self.w / 'tooling' / 'README.md').write_text('# tooling\n- [rule-candidates](rule-candidates.md) — d\n')
        self.commit('base')

    def ans(self, **cats):
        return json.dumps({**self.NONE, **cats}, ensure_ascii=False)

    def text(self, rel):
        return (self.w / rel).read_text()

    # M1
    def test_m1_classifier_failure_counts_the_evidence_and_logs(self):
        for out in ((False, 'quota exceeded', 0), (True, '是的', 0)):
            with mock.patch.object(I, 'DREAM_ENGINE', 'fake'), mock.patch.object(I, 'runner', return_value=lambda *a, **k: out):
                self.assertTrue(I.rule_correction('规则X', '别乱加'))
        def boom(*a, **k):
            raise OSError('codex missing')
        with mock.patch.object(I, 'DREAM_ENGINE', 'codex:high'), mock.patch.object(I, 'codex', side_effect=boom):
            self.assertTrue(I.rule_correction('规则X', '别乱加'))
        self.assertEqual(I.LOG.read_text().count('classification failed, evidence counted'), 3)
        refs = {'U3': ('10-21', 'aaaaaaaa', '别乱加')}
        with mock.patch.object(I, 'DREAM_ENGINE', 'fake'), \
             mock.patch.object(I, 'runner', return_value=lambda *a, **k: (False, 'quota', 0)):
            self.assertEqual(I.dream_render(json.dumps({"ops": [{"op": "recur", "rule": "CLAUDE.md/x「y」", "ids": ["U3"]}]}),
                                            refs, {'aaaaaaaa'}, {}, 'd'), '')
        self.assertIn('10-21 aaaaaaaa「别乱加」', self.text(self.RC))

    def test_m1_a_batch_exception_does_not_stop_the_night(self):
        p = self.root / 'aaaaaaaa.jsonl'
        jsonl(p, [user('以后先看原话', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))])
        db = sqlite3.connect(':memory:')
        db.execute('create table dreamed(id text primary key, offset int, at real)')
        db.execute('create table alerts(kind text primary key, day text)')
        with mock.patch.multiple(I, transcripts=lambda **kw: {p.stem: p}, discard=mock.DEFAULT, notify_dream=mock.DEFAULT), \
             mock.patch.object(I, 'model_pass', side_effect=RuntimeError('rule classification failed: quota')), \
             mock.patch.object(I, 'reflect', return_value=False) as reflect:
            I.dream(db, time.time() + 3600)
        reflect.assert_called_once()
        self.assertIn('FAILED: RuntimeError', I.LOG.read_text())
        self.assertEqual(db.execute("select count(*) from dreamed where id='aaaaaaaa'").fetchone()[0], 0)

    # M2
    def test_m2_wrapped_fix_and_split_dollar_are_judged_as_whole_lines(self):
        long = "并且把日志写清楚，" * 40 + "把夜跑重试改成 3 次。"
        pack = "合计 $12.34"
        for pad in range(300):  # a 问题 whose hard cut falls inside 「$12.34」
            head = f"  - 钱：{'贵' * pad}$12.34{'贵' * 300}"
            if not any('$12.34' in w for w in I.wrap(head + "（来源：s）；根因：r")):
                break
        logical = {}
        ans = self.ans(钱={"问题": head[len("  - 钱："):], "来源": "s", "根因": "r", "改法": [{"类": "a", "内容": long}]})
        self.assertEqual(I.reflect_render(ans, '2026-10-21', {}, self.RP, pack, logical), '')
        page = self.text(self.RP)
        self.assertIn('改成 3 次', page)
        self.assertNotIn('$12.34', page.replace('\n', '#'))  # really cut across two lines
        self.assertEqual(I.pack_misquotes(pack, logical=logical), '')
        p = self.w / self.RP  # a number the model really made up is still caught
        p.write_text(p.read_text() + '- 编的 $99.0\n')
        self.assertIn('$99.0', I.pack_misquotes(pack, logical=logical))

    # M3
    def test_m3_reflect_drops_hand_citations_and_finds_ids_next_to_cjk(self):
        refs = {'U17': ('10-21', 'bbbbbbbb', '别乱加')}
        ans = self.ans(钱={"问题": "用户在U17说别乱加", "来源": "10-21 aaaaaaaa「我从没说过」、U17", "根因": "r", "改法": []})
        self.assertEqual(I.reflect_render(ans, '2026-10-21', refs, self.RP, ''), '')
        page = self.text(self.RP)
        self.assertNotIn('我从没说过', page)
        self.assertNotIn('U17', page)
        self.assertIn('用户在10-21 bbbbbbbb「别乱加」说', page)
        self.assertIn('hand citation DROPPED', I.LOG.read_text())
        self.assertEqual(I.CITE_ID.findall('GPU12 U2F XU3 _U4 在U5说 (U6) U7。'), ['U5', 'U6', 'U7'])

    # M4
    def test_m4_missing_rule_candidates_page_is_created_and_registered(self):
        (self.w / self.RC).unlink()
        (self.w / 'tooling' / 'README.md').write_text('# tooling\n')
        refs = {'U1': ('10-21', 'aaaaaaaa', '别乱加')}
        self.assertEqual(I.dream_render('{"ops": [{"op": "new", "模式": "乱加东西", "ids": ["U1"]}]}', refs, {'aaaaaaaa'}, {}, 'd'), '')
        text = self.text(self.RC)
        self.assertTrue(text.startswith('---\nname: rule-candidates\ndescription: '))
        self.assertIn('scope: ', text)
        self.assertIn('- 乱加东西：出现 1 次', text)
        self.assertIn('[rule-candidates](rule-candidates.md)', self.text('tooling/README.md'))
        self.assertEqual(I.lint.frontmatter(text).keys() >= {'name', 'description', 'scope'}, True)
        (self.w / self.RC).unlink()  # reflect's b-class fix creates it too instead of dropping the candidate
        ans = self.ans(钱={"问题": "p", "来源": "s", "根因": "r", "改法": [{"类": "b", "内容": "加规则"}]})
        self.assertEqual(I.reflect_render(ans, '2026-10-21', {}, self.RP, ''), '')
        self.assertIn('是否把「加规则」加进 常驻规则', self.text(self.RC))

    # M5
    def test_m5_line_budget_alone_keeps_every_quote(self):
        olds = [f'- 模式{k}：出现 1 次\n  - 10-0{k % 9 + 1} {k:08x}「旧话{k}」' for k in range(24)]
        self.page(self.RC, '## 关键事实\n' + '\n'.join(olds) + '\n## 待办')
        known = {f'{k:08x}' for k in range(24)} | {'aaaaaaaa'}
        refs = {'U1': ('10-21', 'aaaaaaaa', '别乱加')}
        self.assertEqual(I.dream_render('{"ops": [{"op": "new", "模式": "新", "ids": ["U1"]}]}', refs, known, {}, 'd'), '')
        text = self.text(self.RC)
        self.assertTrue(I.over_budget(text) and len(text) <= I.lint.PAGE_CHARS * I.lint.WARN)
        for k in range(24):
            self.assertIn(f'「旧话{k}」', text)
        self.assertIn('10-21 aaaaaaaa「别乱加」', text)
        self.assertIn('left for split_pass', I.LOG.read_text())

    # M6
    def test_m6_fix_round_gets_the_previous_answer(self):
        calls = []
        def run(instruction, stdin='', label='?', context=None):
            calls.append((instruction, context))
            return True, ('坏答案' if len(calls) == 1 else '好答案'), 0
        with mock.patch.multiple(I, WORK=self.w / '.ingest-work', HOME=self.w, runner=lambda name: run, acceptance=lambda *a: ''):
            self.assertTrue(I.model_pass('reflect t', 'do', context='all', engine='fake',
                                         apply=lambda out: '' if out == '好答案' else 'REFLECT: not JSON',
                                         fix_context='pack only'))
        self.assertEqual(len(calls), 2)
        self.assertIn('上一次的输出：\n坏答案', calls[1][0])
        self.assertEqual(calls[1][1], 'pack only')

    def test_m6_reflect_fix_context_fits_one_call(self):
        got = {}
        with mock.patch.multiple(I, day_sessions=lambda *a: [], transcripts=lambda **kw: {},
                                 model_pass=lambda *a, **kw: got.update(kw) or False), \
             mock.patch.object(I.daypack, 'build', return_value=('证据\n' * 150000, None)):
            I.reflect(sqlite3.connect(':memory:'), time.time() + 3600)
        self.assertTrue(got['fix_context'] is None or len(got['fix_context']) <= I.MAX_CHARS)

    # M7
    def test_m7_loose_json_shapes_keep_their_evidence(self):
        ans = self.ans(钱={"问题": "p", "来源": ["s1", "s2"], "根因": "r", "改法": "改成重试"}, 慢="等太久",
                       返工={"问题": "q", "来源": "s", "根因": "r", "改法": {"类": "b", "内容": "草稿", "规则": ["CLAUDE.md", "干活"]}})
        self.assertEqual(I.reflect_render(ans, '2026-10-21', {}, self.RP, ''), '')
        page = self.text(self.RP)
        self.assertIn('改法 a：改成重试', page)
        self.assertIn('明早待办（2026-10-21 反思，a 类）：改成重试', page)
        self.assertIn('（来源：s1、s2）', page)
        self.assertIn('慢：无法判断（没有可核对的来源）', page)  # a bare string has no source (R2)
        self.assertIn('改法 b：草稿', page)
        nested = self.ans(慢={"问题": [{"问题": "等太久", "来源": "s", "根因": "r", "改法": [{"类": "a", "内容": "加超时"}]}]})
        self.assertEqual(I.reflect_render(nested, '2026-10-22', {}, self.RP, ''), '')
        self.assertIn('  - 慢：等太久（来源：s）；根因：r', self.text(self.RP))
        refs = {'U3': ('10-21', 'aaaaaaaa', '别乱加')}
        self.assertEqual(I.dream_render(json.dumps({"ops": [{"op": "new", "模式": "m", "ids": "U3"}]}), refs, {'aaaaaaaa'}, {}, 'd'), '')
        self.assertIn('10-21 aaaaaaaa「别乱加」', self.text(self.RC))
        self.assertFalse(I.LOG.exists() and 'unknown ID' in I.LOG.read_text())

    # L1
    def test_l1_a_later_batch_leaving_out_a_finding_does_not_lose_it(self):
        first = self.ans(钱={"问题": "贵", "来源": "s", "根因": "r", "改法": []})
        last = self.ans(钱={"无": True}, 慢={"问题": "慢", "来源": "s", "根因": "r", "改法": []})
        merged = json.loads(I.reflect_merge([first, last]))
        self.assertEqual([it["问题"] for it in merged["钱"]], ["贵"])
        self.assertEqual([it["问题"] for it in merged["慢"]], ["慢"])
        self.assertEqual(merged["返工"], [{"无": True}])
        self.assertIn('kept from earlier batches', I.LOG.read_text())
        self.assertEqual(I.reflect_merge([first, '不是 JSON']), '不是 JSON')  # goes to the fix round, not skipped
        seen, answers = [], iter([first, last])
        run = lambda instruction, stdin='', label='?', context=None: (True, next(answers), 0)
        with mock.patch.multiple(I, WORK=self.w / '.ingest-work', HOME=self.w, runner=lambda name: run, acceptance=lambda *a: ''):
            I.model_pass('reflect t', 'do', context='1', extra_contexts=['2'], engine='fake',
                         apply=lambda out: seen.append(out) or '', merge=I.reflect_merge)
        self.assertIn('贵', seen[0])

    # L3
    def test_l3_preamble_without_closing_header_keeps_the_message(self):
        t = "[Task lifecycle]\nfoo\n[Bridge identity — current responder]\nbar\n\n用户真正的话"
        self.assertIn('用户真正的话', ''.join(x for _, x in I.speakers(t)))

    def test_wrap_keeps_dream_marker_whole(self):
        line = '- 是否把「' + '甲，' * 140 + '」加进 X：出现 2 次；dream 建议，用户未答复'
        out = I.wrap(line)
        self.assertTrue(any('dream 建议，用户未答复' in l for l in out))
        self.assertFalse(any('未答复' in l and 'dream 建议' not in l for l in out))

    def test_reflect_item_without_source_is_unsure(self):
        rel = 'tooling/daily-reflection.md'
        ans = '{"钱": {"问题": "贵", "来源": "aaaaaaaa「编的」", "根因": "x", "改法": "切会话"}, "昨日对照": "无对照"}'
        with mock.patch.object(I, 'dream_page', return_value='tooling/rule-candidates.md'):
            self.assertEqual(I.reflect_render(ans, '2026-10-21', {}, rel), '')
        text = (self.w / rel).read_text()
        self.assertIn('钱：无法判断（没有可核对的来源）', text)
        self.assertNotIn('切会话', text)


if __name__ == '__main__':
    unittest.main()
