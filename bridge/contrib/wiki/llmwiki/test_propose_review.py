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
    return dict(fact=text, quote=text, relay="", section="现状", domain="tooling", terms=["配置"], session="")


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

    def test_omitted_fact_is_preserved_in_unplaced_log(self):
        prepared = (dict(title="配置", nothing_reason=""), [fact()], [], dict(ops=[], unplaced=[]))
        P.ingest(self.root, "", "aaaaaaaa", "2026-11-20", self.rules, None, "ingest", prepared)
        self.assertIn("未写入", (self.root / "log.md").read_text())
        self.assertIn(fact()["fact"], (self.root / "log.md").read_text())

    def test_proposal_pass_moves_superseded_old_fact_to_history(self):
        def codex(prompt, schema, label, model, effort):
            if schema == P.FACTS_SCHEMA:
                answer = dict(title="配置", nothing_reason="", facts=[fact()])
            elif schema == P.OPS_SCHEMA:
                answer = dict(ops=[op()], unplaced=[])
            else:
                self.assertEqual(schema, I.invalidate.SCHEMA)
                answer = dict(results=[dict(g=0, n=0, contradicted_facts=[0])])
            return True, json.dumps(answer), 0, None
        with patch.multiple(I, WIKI=self.root, WORK=self.root, REPO=self.root,
                            PROPOSE_DIR=self.root / "cache"), \
                patch.object(I, "sync_work"), patch.object(I, "codex_json", codex), \
                patch.object(I, "user_texts", return_value=[I.flat(fact()["quote"])]), \
                patch.object(I, "acceptance", return_value=""), patch.object(I, "log"), \
                patch.object(I, "deliver", return_value=True):
            result = I.propose_pass("ingest aaaaaaaa", dict(id="aaaaaaaa", date="2026-11-20"),
                                    "USER: 现在配置用新值", ["aaaaaaaa"], [self.root / "s.jsonl"], "codex")
        self.assertEqual(result, "changed")
        text = (self.root / "tooling/a.md").read_text()
        self.assertIn("## 历史\n- 原来配置是旧值。", text)
        self.assertNotIn("原来配置是旧值", text.split("## 历史")[0])

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
            I.ingest_batches(db, [item], ["codex", "sonnet"], False)
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
        def codex(prompt, schema, label, model, effort):
            calls.append(label.rsplit(" ", 1)[-1])
            if schema == P.FACTS_SCHEMA:
                answer = dict(title="配置", nothing_reason="", facts=[fact()])
            elif schema == P.OPS_SCHEMA:
                answer = dict(ops=[op(readme="", description="")], unplaced=[])
            else:
                answer = dict(results=[])
            return True, json.dumps(answer), 0, None
        with patch.multiple(I, WIKI=self.root, WORK=self.root, REPO=self.root,
                            PROPOSE_DIR=self.root / "cache"), \
                patch.object(I, "sync_work"), patch.object(I, "discard", discard), \
                patch.object(I, "codex_json", codex), patch.object(I, "log"), \
                patch.object(I, "user_texts", return_value=[I.flat(fact()["quote"])]), \
                patch.object(I, "acceptance", side_effect=["refused", ""]), \
                patch.object(I, "deliver", return_value=True):
            args = ("ingest aaaaaaaa", dict(id="aaaaaaaa", date="2026-11-20"),
                    "USER: 现在配置用新值", ["aaaaaaaa"], [self.root / "s.jsonl"], "codex")
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
        with patch.object(I, "propose_pass", accept), \
                patch.object(I, "log"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "reject_streaks"):
            I.ingest_batches(db, items, ["codex"], pending=True)
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
        I.invalidate.run(self.root, ask=ask, log=lambda msg: None,
                         order={I.lossless.norm(old): 0, I.lossless.norm(new): 1})
        text = path.read_text()
        self.assertIn('## 历史\n' + old, text)
        self.assertNotIn(old, text.split('## 历史')[0])

    BATCH = ("=== SESSION aaaaaaaa | 2026-11-20 ===\nUSER: 现在配置用新值\n"
             "=== SESSION bbbbbbbb | 2026-11-20 ===\nUSER: 以后合并前先跑检查\nCLAUDE: 审稿结论是合并前必须全绿\n")

    def batch_pass(self, fixed_line, calls):
        """One proposal pass over two sessions; the second session's first line gives the user a quote (「合并前必须全绿」)
        that only the assistant said. Acceptance's quote check (page_checks) is the real one."""
        facts = [dict(fact("现在配置用新值"), session="aaaaaaaa"), dict(fact("以后合并前先跑检查"), session="bbbbbbbb")]
        def codex(prompt, schema, label, model, effort):
            calls.append((label.rsplit(" ", 1)[-1], prompt))
            if schema == P.FACTS_SCHEMA:
                answer = dict(title="配置", nothing_reason="", facts=facts)
            elif label.endswith("ops-fix"):
                answer = dict(ops=[op(lines=[fixed_line], readme="", description="")], unplaced=[])
            elif schema == P.OPS_SCHEMA:
                answer = dict(ops=[op(readme="", description=""),
                                   op(facts=[1], lines=["- 用户要求「合并前必须全绿」"], readme="", description="")],
                              unplaced=[])
            else:
                answer = dict(results=[])
            return True, json.dumps(answer), 0, None
        words = {"aaaaaaaa": [I.flat("现在配置用新值")], "bbbbbbbb": [I.flat("以后合并前先跑检查")]}
        with patch.multiple(I, WIKI=self.root, WORK=self.root, REPO=self.root, PROPOSE_DIR=self.root / "cache"), \
                patch.object(I, "sync_work"), patch.object(I, "discard"), patch.object(I, "codex_json", codex), \
                patch.object(I, "user_texts", side_effect=lambda p, strict=False: words[p.stem]), \
                patch.object(I, "acceptance", return_value=""), patch.object(I, "log"), \
                patch.object(I, "deliver", return_value=True):
            return I.propose_pass("ingest aaaaaaaa, bbbbbbbb", dict(
                id="aaaaaaaa", date="2026-11-20", _sessions=[("aaaaaaaa", "2026-11-20"), ("bbbbbbbb", "2026-11-20")]),
                self.BATCH, ["aaaaaaaa", "bbbbbbbb"], [self.root / "aaaaaaaa.jsonl", self.root / "bbbbbbbb.jsonl"], "codex")

    def test_line_acceptance_would_refuse_goes_back_to_the_model_with_the_reason(self):
        calls = []
        self.assertEqual(self.batch_pass("- 以后合并前先跑检查", calls), "changed")
        fixes = [prompt for label, prompt in calls if label == "ops-fix"]
        self.assertEqual(len(fixes), 1)
        self.assertIn("「合并前必须全绿」 不是这些会话里用户的原话", fixes[0])
        self.assertNotIn("现在配置用新值", fixes[0])  # the accepted session's fact is not sent again
        text = (self.root / "tooling/a.md").read_text()
        self.assertIn("- 现在配置用新值（用户原话「现在配置用新值」）", text)
        self.assertIn("- 以后合并前先跑检查（用户原话「以后合并前先跑检查」）", text)

    def test_line_refused_twice_leaves_out_its_own_fact_only(self):
        self.assertEqual(self.batch_pass("- 用户要求「合并前必须全绿」", []), "changed")
        self.assertIn("- 现在配置用新值（用户原话「现在配置用新值」）", (self.root / "tooling/a.md").read_text())
        self.assertNotIn("合并前必须全绿", (self.root / "tooling/a.md").read_text())
        entry = (self.root / "log.md").read_text().split("ingest | bbbbbbbb")[1]
        self.assertIn("未写入（程序两次拒绝", entry)
        self.assertIn("以后合并前先跑检查", entry)

    def test_smaller_retry_reuses_each_sessions_saved_facts(self):
        calls = []
        def call(prompt, schema, label):
            calls.append(label)
            if schema == P.FACTS_SCHEMA:
                return dict(title="配置", nothing_reason="", facts=[
                    dict(fact("现在配置用新值"), session="aaaaaaaa"), dict(fact("以后合并前先跑检查"), session="bbbbbbbb")])
            return dict(ops=[], unplaced=[])
        P.prepare(self.root, self.BATCH, self.rules, call, "ingest", cache=self.root / "cache")
        second = self.BATCH[self.BATCH.index("=== SESSION bbbbbbbb"):]
        _, facts, dropped, _ = P.prepare(self.root, second, self.rules, call, "ingest", cache=self.root / "cache")
        self.assertEqual(calls.count("ingest facts"), 1)
        self.assertEqual([f["fact"] for f in facts], ["以后合并前先跑检查"])
        self.assertEqual(dropped, [])

    def test_pending_round_retries_a_failed_proposal_batch_with_fewer_sessions(self):
        paths = [self.root / "aaaaaaaa.jsonl", self.root / "bbbbbbbb.jsonl"]
        for path in paths:
            path.write_text("x")
        db = sqlite3.connect(":memory:")
        db.executescript("CREATE TABLE ingested(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE fails(id TEXT PRIMARY KEY, n INT);"
                         "CREATE TABLE reviewed(id TEXT PRIMARY KEY, offset INT, at REAL);"
                         "CREATE TABLE pending_parts(id TEXT PRIMARY KEY, end INT, chunk TEXT, part INT);"
                         "INSERT INTO fails VALUES ('aaaaaaaa', 1), ('bbbbbbbb', 1);")
        offered = []
        def accept(label, item, text, sids, *args):
            offered.append((sids, text))
            return True
        with patch.multiple(I, WIKI=self.root, WORK=self.root, QUEUE=self.root / "queue", LAST_ENGINE="codex:test"), \
                patch.object(I, "state", return_value=db), patch.object(I, "ready", return_value=paths), \
                patch.object(I, "pending_extract", side_effect=lambda p, start, limit=None: {
                    "text": f"USER: {p.stem} 的话 limit={limit}", "end": 1, "prompts": 1, "cwd": "/test", "title": "t"}), \
                patch.object(I, "split_pass"), patch.object(I, "candidates_note", return_value=""), \
                patch.object(I, "propose_pass", accept), patch.object(I, "reject_streaks"), patch.object(I, "log"):
            I.run(type("Args", (), dict(lint=False, nightly=False, pending=True, session=None))(), engines=["codex"])
        self.assertEqual([sids for sids, _ in offered], [["aaaaaaaa"]])
        self.assertIn("limit=None", offered[0][1])  # the session itself stays whole: its saved facts still match

    def relayed(self, said_by_teammate, quote):
        """A session whose only incoming message is a teammate relaying a request; the user's own message is in the
        channel's record (user_texts), not in this session. Rules as the role wikis build them."""
        transcript = f"TEAM C酱: 【C酱】{said_by_teammate}\nCLAUDE: 好\n"
        relayed = dict(fact(quote), relay="C酱")
        answers = [dict(title="配置", nothing_reason="", facts=[relayed]), dict(ops=[op(
            lines=[f"- C酱 转述：{quote}"], readme="", description="")], unplaced=[])]
        _, rules = I.role_rules([self.root / "source.jsonl"], transcript)
        self.assertIn("队友转述的用户要求也要列", P.facts_prompt(self.root, transcript, rules))
        return rules, answers, P.prepare(self.root, transcript, rules, lambda *args: answers.pop(0), "ingest")

    def test_relayed_request_matching_the_users_own_words_is_recorded_with_its_source(self):
        words = [I.flat("以后合并前先跑检查")]  # what the user wrote in the channel
        with patch.object(I, "WIKI", self.root), patch.object(I, "user_texts", return_value=words):
            rules, _, (got, facts, dropped, ops) = self.relayed("用户刚才说以后合并前先跑检查，你照这个做", "以后合并前先跑检查")
            self.assertEqual(([f["relay"] for f in facts], dropped), (["C酱"], []))
            plan = P.Plan(self.root, rules, facts)
            self.assertEqual(plan.apply(ops["ops"]), [])
            plan.write()
            self.assertIn("- C酱 转述：以后合并前先跑检查（用户原话「以后合并前先跑检查」）｜源：转述 · C酱\n",
                          (self.root / "tooling/a.md").read_text())
            self.assertEqual(I.page_misquotes([self.root / "source.jsonl"]), "")
        self.assertEqual([e for e in I.lint.check(self.root)[0] if "tooling/a.md" in e], [])  # the tag is lint's own format

    def test_relayed_request_the_user_never_wrote_is_dropped(self):
        words = [I.flat("以后合并前先跑检查")]  # the teammate relays something else
        with patch.object(I, "WIKI", self.root), patch.object(I, "user_texts", return_value=words):
            _, answers, (got, facts, dropped, ops) = self.relayed("用户刚才说以后合并前不用跑检查，你照这个做", "以后合并前不用跑检查")
        self.assertEqual((facts, ops), ([], None))
        self.assertEqual([(f["relay"], f["fact"], why) for f, why in dropped],
                         [("C酱", "以后合并前不用跑检查", "需要用户原话，但引文不是这个会话里用户说的话")])
        self.assertEqual(len(answers), 1)  # nothing left to place: the second call is not made

    def test_miswritten_session_drops_that_fact_and_the_call_stays_saved(self):
        calls = []
        def call(prompt, schema, label):
            calls.append(label)
            if schema == P.FACTS_SCHEMA:
                return dict(title="配置", nothing_reason="", facts=[
                    dict(fact("现在配置用新值"), session="aaaaaaaa"), dict(fact("以后合并前先跑检查"), session="cccccccc")])
            return dict(ops=[], unplaced=[])
        for _ in range(2):
            _, facts, dropped, _ = P.prepare(self.root, self.BATCH, self.rules, call, "ingest", cache=self.root / "cache")
            self.assertEqual([f["fact"] for f in facts], ["现在配置用新值"])
            self.assertEqual([(f["fact"], why) for f, why in dropped], [("以后合并前先跑检查", "会话编号「cccccccc」不在本批")])
        self.assertEqual(calls.count("ingest facts"), 1)

    def test_proposal_directory_is_ignored_and_old_saved_facts_are_cleared(self):
        cache = self.root / ".ingest-propose"
        (cache / "facts").mkdir(parents=True)
        old, recent = cache / "facts/old.json", cache / "facts/recent.json"
        for path in (old, recent):
            path.write_text("{}")
        stale = I.time.time() - (I.CACHE_DAYS * 86400 + 60)
        os.utime(old, (stale, stale))
        with patch.multiple(I, REPO=self.root, WIKI=self.root, PROPOSE_DIR=cache):
            I.propose_dir()
            I.propose_dir()
        self.assertEqual((old.exists(), recent.exists()), (False, True))
        self.assertEqual((self.root / ".git/info/exclude").read_text().count(".ingest-propose/\n"), 1)
        status = subprocess.run(["git", "status", "--porcelain"], cwd=self.root, capture_output=True, text=True).stdout
        self.assertEqual(status, "")
        template = (Path(__file__).resolve().parent.parent / "template/gitignore").read_text()
        self.assertIn(".ingest-propose/\n", template)


if __name__ == "__main__":
    unittest.main()
