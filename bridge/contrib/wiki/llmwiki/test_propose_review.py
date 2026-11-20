"""PR 2019 regressions: isolated wiki, no network or production state."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(tempfile.mkdtemp(prefix="propose-review-"))
os.environ["WIKI_DIR"] = str(ROOT)
os.environ["WIKI_BRIDGE_CONFIG"] = str(ROOT / "absent.toml")
os.environ["AGENT_SESSIONS_DIR"] = str(ROOT / "sessions")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest as I
import propose as P

PAGE = "---\nname: a\ndescription: 配置\nmetadata:\n  scope: 配置\n---\n# 配置\n## 现状\n- 原来配置是旧值。\n"


def fact(text="现在配置用新值"):
    return dict(fact=text, quote=text, section="现状", domain="tooling", terms=["配置"], session="")


def op(**kw):
    return dict(dict(facts=[0], action="append", page="tooling/a.md", section="现状",
                     lines=["- 现在配置用新值"], at="", title="配置", description="配置更新",
                     scope="配置", readme="- [配置](a.md) — 配置更新"), **kw)


class ProposeReview(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(dir=ROOT))
        (self.root / "tooling").mkdir()
        (self.root / "MEMORY.md").write_text("# Wiki\n- [工具](tooling/README.md) — 配置\n")
        (self.root / "tooling/README.md").write_text("# 工具\n- [配置](a.md) — 配置\n")
        (self.root / "tooling/a.md").write_text(PAGE)
        (self.root / "log.md").write_text("# 日志\n")
        for args in [("init", "-q"), ("config", "user.email", "test@example.invalid"),
                     ("config", "user.name", "test"), ("add", "."), ("commit", "-qm", "base")]:
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        self.rules = P.Rules(I.lint, user_quote=True, user_said=lambda q: True)

    def test_new_page_and_updated_index_pass_the_actual_quote_check(self):
        for operation in [op(), op(action="new_page", page="tooling/b.md",
                                    readme="- [配置](b.md) — 配置更新")]:
            with self.subTest(action=operation["action"]):
                plan = P.Plan(self.root, self.rules, [fact()])
                self.assertEqual(plan.apply([operation]), [])
                plan.write()
                with patch.object(I, "WIKI", self.root), patch.object(I, "user_texts",
                                                                             return_value=[I.flat(fact()["quote"])]):
                    self.assertEqual(I.page_misquotes([self.root / "source.jsonl"]), "")

    def test_prefetch_unreadable_words_cannot_prepare_a_dropped_fact_result(self):
        worker = I.Prefetch.__new__(I.Prefetch)
        worker.stopped = False
        with patch.object(I, "REPO", self.root), patch.object(I, "user_texts", return_value=[]), \
                patch.object(I, "api_json", return_value=(True, json.dumps(dict(
                    title="配置", nothing_reason="", facts=[fact()])), False)) as api:
            with self.assertRaises(I.discord_said.Unavailable):
                worker.work("ingest aaaaaaaa", "USER: 现在配置用新值", [self.root / "source.jsonl"])
        api.assert_not_called()

    def test_omitted_fact_is_preserved_in_unplaced_log(self):
        prepared = (dict(title="配置", nothing_reason=""), [fact()], [], dict(ops=[], unplaced=[]))
        P.ingest(self.root, "", "aaaaaaaa", "2026-11-20", self.rules, None, "ingest", prepared)
        self.assertIn("未写入", (self.root / "log.md").read_text())
        self.assertIn(fact()["fact"], (self.root / "log.md").read_text())

    def test_proposal_pass_moves_superseded_old_fact_to_history(self):
        def api(prompt, schema, label):
            if schema == P.FACTS_SCHEMA:
                answer = dict(title="配置", nothing_reason="", facts=[fact()])
            elif schema == P.OPS_SCHEMA:
                answer = dict(ops=[op()], unplaced=[])
            else:
                self.assertEqual(schema, I.invalidate.SCHEMA)
                answer = dict(results=[dict(g=0, n=0, contradicted_facts=[0])])
            return True, json.dumps(answer), False
        with patch.multiple(I, WIKI=self.root, WORK=self.root, REPO=self.root, PREFETCH=None,
                            PROPOSE_DIR=self.root / "cache"), \
                patch.object(I, "sync_work"), patch.object(I, "api_json", api), \
                patch.object(I, "user_texts", return_value=[I.flat(fact()["quote"])]), \
                patch.object(I, "acceptance", return_value=""), patch.object(I, "log"), \
                patch.object(I, "deliver", return_value=True):
            result = I.propose_pass("ingest aaaaaaaa", dict(id="aaaaaaaa", date="2026-11-20"),
                                    "USER: 现在配置用新值", ["aaaaaaaa"], [self.root / "s.jsonl"], "openai:high")
        self.assertEqual(result, "changed")
        text = (self.root / "tooling/a.md").read_text()
        self.assertIn("## 历史\n- 原来配置是旧值。", text)
        self.assertNotIn("原来配置是旧值", text.split("## 历史")[0])

    def test_provider_down_stops_before_fallback_and_keeps_offsets_and_fail_count(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        item = dict(id="aaaaaaaa", end=10, path=self.root / "s.jsonl", title="配置",
                    cwd="/test", date="2026-11-20", text="USER: 现在配置用新值")
        def down(*args):
            I.ROUTE_DOWN = True
            return False
        with patch.object(I, "propose_pass", side_effect=down), patch.object(I, "model_pass", return_value=True) as fallback, \
                patch.object(I, "log"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "reject_streaks"):
            I._ingest_batches(db, I.batches_of([item]), ["openai:high", "sonnet"], False)
        fallback.assert_not_called()
        self.assertEqual(db.execute("SELECT * FROM ingested").fetchall(), [])
        self.assertEqual(db.execute("SELECT * FROM fails").fetchall(), [])

    def test_failed_placement_reuses_durable_first_call(self):
        calls = []
        def call(prompt, schema, label):
            calls.append(label)
            return dict(title="配置", nothing_reason="", facts=[fact()]) if schema == P.FACTS_SCHEMA else None
        for _ in range(2):
            self.assertIsNone(P.prepare(self.root, "USER: 现在配置用新值", self.rules, call,
                                        "ingest", cache=self.root / "cache"))
        self.assertEqual(calls, ["ingest facts", "ingest ops", "ingest ops"])

    def test_unreadable_source_cannot_advance_through_another_engine(self):
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        item = dict(id="aaaaaaaa", end=10, path=self.root / "s.jsonl", title="配置",
                    cwd="/test", date="2026-11-20", text="USER: 现在配置用新值")
        with patch.object(I, "propose_pass", side_effect=I.discord_said.Unavailable("unreadable")), \
                patch.object(I, "model_pass", return_value=True) as fallback, \
                patch.object(I, "log"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "reject_streaks"):
            I._ingest_batches(db, I.batches_of([item]), ["openai:high", "sonnet"], False)
        fallback.assert_not_called()
        self.assertEqual(db.execute("SELECT * FROM ingested").fetchall(), [])

    def test_correction_sends_only_rejected_facts_and_remaps_their_ids(self):
        facts = [fact("已经接受的独有事实"), fact("需要修正的独有事实")]
        prepared = (dict(title="配置", nothing_reason=""), facts, [],
                    dict(ops=[op(lines=["- 已经接受的独有事实"], readme="", description=""),
                              op(facts=[1], page="tooling/missing.md")], unplaced=[]))
        def fix(prompt, schema, label):
            self.assertNotIn(facts[0]["fact"], prompt)
            self.assertIn(facts[1]["fact"], prompt)
            return dict(ops=[op(lines=["- 需要修正的独有事实"], readme="", description="")], unplaced=[])
        P.ingest(self.root, "", "aaaaaaaa", "2026-11-20", self.rules, fix, "ingest", prepared)
        text = (self.root / "tooling/a.md").read_text()
        self.assertIn("需要修正的独有事实（用户原话「需要修正的独有事实」）", text)

    def test_acceptance_rejection_reuses_facts_on_the_next_pass(self):
        calls = []
        originals = {p: p.read_text() for p in [self.root / "tooling/a.md", self.root / "log.md"]}
        def discard():
            for path, text in originals.items():
                path.write_text(text)
        def api(prompt, schema, label):
            calls.append(label.rsplit(" ", 1)[-1])
            if schema == P.FACTS_SCHEMA:
                answer = dict(title="配置", nothing_reason="", facts=[fact()])
            elif schema == P.OPS_SCHEMA:
                answer = dict(ops=[op(readme="", description="")], unplaced=[])
            else:
                answer = dict(results=[])
            return True, json.dumps(answer), False
        with patch.multiple(I, WIKI=self.root, WORK=self.root, REPO=self.root, PREFETCH=None,
                            PROPOSE_DIR=self.root / "cache"), \
                patch.object(I, "sync_work"), patch.object(I, "discard", discard), \
                patch.object(I, "api_json", api), patch.object(I, "log"), \
                patch.object(I, "user_texts", return_value=[I.flat(fact()["quote"])]), \
                patch.object(I, "acceptance", side_effect=["refused", ""]), \
                patch.object(I, "deliver", return_value=True):
            args = ("ingest aaaaaaaa", dict(id="aaaaaaaa", date="2026-11-20"),
                    "USER: 现在配置用新值", ["aaaaaaaa"], [self.root / "s.jsonl"], "openai:high")
            self.assertFalse(I.propose_pass(*args))
            self.assertEqual(I.propose_pass(*args), "changed")
        self.assertEqual(calls.count("facts"), 1)
        self.assertEqual(calls.count("ops"), 2)

    def test_small_sessions_share_a_proposal_batch_and_each_get_a_log_entry(self):
        items = [dict(id=sid, end=10, path=self.root / (sid + ".jsonl"), title="配置", cwd="/test",
                      date="2026-11-20", text="USER: 现在配置用新值") for sid in ["aaaaaaaa", "bbbbbbbb"]]
        seen = []
        def accept(label, item, text, sids, *args):
            seen.append(sids)
            prepared = (dict(title="配置", nothing_reason="闲聊"), [], [], None)
            P.ingest(self.root, text, sids[0], item["date"], self.rules, None, label, prepared,
                     sessions=item.get("_sessions"))
            return True
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);")
        with patch.object(I, "propose_pass", accept), patch.object(I, "Prefetch"), \
                patch.object(I, "log"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "reject_streaks"):
            I.ingest_batches(db, items, ["openai:high"], pending=True)
        self.assertEqual(seen, [["aaaaaaaa", "bbbbbbbb"]])
        for sid in ["aaaaaaaa", "bbbbbbbb"]:
            self.assertIn("ingest | " + sid, (self.root / "log.md").read_text())
        self.assertEqual(db.execute("SELECT count(*) FROM ingested").fetchone(), (2,))

    def test_one_readable_source_cannot_hide_an_unreadable_session(self):
        sources = [self.root / 'aaaaaaaa.jsonl', self.root / 'bbbbbbbb.jsonl']
        text = ('=== SESSION aaaaaaaa | 甲 ===\nUSER: 甲的话\n'
                '=== SESSION bbbbbbbb | 乙 ===\nUSER: 乙的话\n')
        with patch.object(I, 'user_texts', side_effect=[[I.flat('甲的话')], []]):
            with self.assertRaises(I.discord_said.Unavailable):
                I.role_rules(sources, text)

    def test_codex_request_refusal_stops_paid_fallback(self):
        I.ROUTE_DOWN = False
        refusal = I.codex_retry.Failure('usage limit', 'request_rejected')
        with patch.multiple(I, WIKI=self.root, WORK=self.root, REPO=self.root, PREFETCH=None,
                            PROPOSE_DIR=self.root / 'cache'), \
                patch.object(I, 'sync_work'), patch.object(I, 'discard'), patch.object(I, 'log'), \
                patch.object(I, 'role_rules', return_value=([], self.rules)), \
                patch.object(I.codex_retry, 'run', return_value=(False, refusal, 0, None, 'luna')):
            self.assertFalse(I.propose_pass('ingest aaaaaaaa', dict(id='aaaaaaaa', date='2026-11-20'),
                                           'USER: 现在配置用新值', ['aaaaaaaa'], [], 'codex'))
        self.assertTrue(I.ROUTE_DOWN)

    def test_nightly_does_no_paid_maintenance_after_route_down(self):
        def down(*args, **kw):
            I.ROUTE_DOWN = True
        with patch.object(I, 'run', side_effect=down), patch.object(I, 'split_pass') as split, \
                patch.object(I, 'dream') as dream, patch.object(I, 'state'):
            I.nightly(type('Args', (), {})())
        split.assert_not_called()
        dream.assert_not_called()

    def test_same_batch_new_value_supersedes_earlier_new_value(self):
        path = self.root / 'tooling/a.md'
        old = '- 先前在本批写入的配置旧值'
        new = '- 随后用户明确改为配置新值'
        path.write_text(PAGE + old + '\n' + new + '\n')
        def ask(prompt):
            # Mark only the explicit old/new pair; unrelated HEAD content stays current.
            groups = []
            for block in prompt.split('## GROUP ')[1:]:
                g = int(block.split('\n', 1)[0])
                existing, latest = block.split('<NEW FACTS>')
                if old in existing and new in latest:
                    idx = int(existing.split(old)[0].rsplit('idx=', 1)[1].split(',', 1)[0])
                    groups.append(dict(g=g, n=0, contradicted_facts=[idx]))
            return json.dumps(dict(results=groups))
        I.invalidate.run(self.root, ask=ask, log=lambda msg: None)
        text = path.read_text()
        self.assertIn('## 历史\n' + old, text)
        self.assertNotIn(old, text.split('## 历史')[0])


if __name__ == "__main__":
    unittest.main()
