"""Synthetic product-pipeline regressions; no private wiki, models or cleanup."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
ARTIFACTS = Path(tempfile.mkdtemp(prefix="block-contract-", dir=os.environ.get("WIKI_TEST_ARTIFACTS")))
os.environ["WIKI_DIR"] = str(ARTIFACTS / "import-only")
os.environ["WIKI_BRIDGE_CONFIG"] = str(ARTIFACTS / "missing.toml")
os.environ["AGENT_SESSIONS_DIR"] = str(ARTIFACTS / "sessions")
import ingest as I

PAGE = "---\nname: fixture\ndescription: synthetic facts\nmetadata:\n  scope: test\n---\n# Fixture\n## 关键事实\n"
FACT = "- synthetic allocation: 17 units\n"


class BlockContract(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(dir=ARTIFACTS))
        self.repo = self.root / "wiki"
        (self.repo / "misc").mkdir(parents=True)
        (self.repo / "MEMORY.md").write_text("- [misc](misc/README.md) — fixtures\n", encoding="utf-8")
        (self.repo / "misc/README.md").write_text("# Misc\n- [source](source.md) — synthetic source\n", encoding="utf-8")
        (self.repo / "misc/source.md").write_text(PAGE + FACT + FACT, encoding="utf-8")
        (self.repo / "log.md").write_text("# Log\n", encoding="utf-8")
        (self.repo / ".gitignore").write_text(".ingest*\n", encoding="utf-8")
        self.git("init", "-q")
        self.git("config", "user.name", "Synthetic Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.commit("synthetic baseline")
        self.calls = []
        self.patches = patch.multiple(I, create=True, REPO=self.repo, WIKI=self.repo, WORK=self.repo / ".ingest-work",
                                     HOME=self.repo, STATE=self.root / "state.sqlite", LOG=self.root / "run.log",
                                     LAST_ENGINE="fake", LAST_REJECTED=False, CRASHED="", ACTIVE_CHECKPOINT=None,
                                     BLOCK_PENDING=False)
        self.patches.start()
        self.addCleanup(self.patches.stop)
        for obj, name, value in ((I, "new_lint_errors", ""), (I.invalidate, "run", [])):
            p = patch.object(obj, name, return_value=value)
            p.start()
            self.addCleanup(p.stop)

    def git(self, *args, cwd=None):
        return subprocess.run(["git", *args], cwd=cwd or self.repo, check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, label):
        self.git("add", "-A")
        self.git("commit", "-qm", label)
        return self.git("rev-parse", "HEAD")

    def move_model(self, instruction, stdin="", label="?", context=None):
        self.calls.append(label)
        self.assertIn("LOSSLESS BLOCK CONTRACT", instruction)
        c = I.block_contract
        catalog = json.loads((I.WORK / c.CATALOG).read_text(encoding="utf-8"))
        row = next(row for row in catalog["blocks"] if row["text"] == FACT.strip())
        (I.WORK / "misc/dest.md").write_text(PAGE, encoding="utf-8")
        with (I.WORK / "misc/README.md").open("a", encoding="utf-8") as f:
            f.write("- [dest](dest.md) — destination\n")
        plan = dict(moves=[dict(block=row["id"], to="misc/dest.md", section="## 关键事实")], updates=[])
        return True, c.PLAN_PREFIX + json.dumps(plan), 0

    def test_acceptance_rejects_losing_one_identical_occurrence(self):
        (self.repo / "misc/source.md").write_text(PAGE + FACT, encoding="utf-8")
        self.assertIn("block coverage", I.acceptance())

    def test_program_moves_one_occurrence_and_delivery_has_contract(self):
        with patch.object(I, "runner", return_value=self.move_model):
            self.assertEqual(I.model_pass("synthetic split", "split", engine="fake", kind="restructure"), "changed")
        self.assertEqual((self.repo / "misc/source.md").read_text(encoding="utf-8").count(FACT), 1)
        self.assertEqual((self.repo / "misc/dest.md").read_text(encoding="utf-8").count(FACT), 1)
        self.assertIsNotNone(I.block_contract.from_message(self.git("show", "-s", "--format=%B")))

    def test_nested_topic_move_is_searchable_and_orphan_is_rejected(self):
        c = I.block_contract
        coverage = c.freeze(self.repo, ["HEAD"])
        row = next(iter(c.inventory(self.repo, coverage["sources"])[0].values()))
        files = c.working_tree(self.repo)
        files["misc/README.md"] += "- [nested](nested/README.md) — nested\n"
        files["misc/nested/README.md"] = "# Nested\n- [dest](dest.md) — destination\n"
        files["misc/nested/dest.md"] = PAGE
        coverage["plan"]["moves"] = [dict(block=row["id"], to="misc/nested/dest.md", section="## 关键事实")]
        final = c.render(self.repo, coverage, files, "restructure")
        self.assertEqual(c.check(self.repo, coverage, final, "restructure"), [])
        self.assertEqual(final, c.render(self.repo, coverage, final, "restructure"))
        final["misc/README.md"] = files["misc/README.md"].replace("- [nested](nested/README.md) — nested\n", "")
        with self.assertRaisesRegex(ValueError, "indexed"):
            c.check(self.repo, coverage, final, "restructure")

    def test_pending_move_survives_two_main_advances_without_duplicate_source(self):
        (self.repo / "misc/other.md").write_text(PAGE + "- unrelated original fact\n", encoding="utf-8")
        with (self.repo / "misc/README.md").open("a", encoding="utf-8") as f:
            f.write("- [other](other.md) — independent page\n")
        self.commit("independent page")
        with patch.object(I, "runner", return_value=self.move_model), patch.object(I, "deliver", return_value=[]):
            self.assertFalse(I.model_pass("pending move", "split", engine="fake", kind="restructure"))
        for label in ("first", "second"):
            with (self.repo / "misc/other.md").open("a", encoding="utf-8") as f:
                f.write(f"- independent {label} fact\n")
            self.commit(label + " main advancement")
            with patch.object(I, "runner", side_effect=AssertionError("must reuse saved candidate")), \
                    patch.object(I, "deliver", return_value=[]):
                self.assertFalse(I.model_pass("pending move", "split", engine="fake", kind="restructure"))
        with patch.object(I, "runner", side_effect=AssertionError("must reuse saved candidate")):
            self.assertEqual(I.model_pass("pending move", "split", engine="fake", kind="restructure"), "changed")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual((self.repo / "misc/source.md").read_text(encoding="utf-8").count(FACT), 1)
        self.assertEqual((self.repo / "misc/dest.md").read_text(encoding="utf-8").count(FACT), 1)
        self.assertIn("independent second fact", (self.repo / "misc/other.md").read_text(encoding="utf-8"))

    def test_delivered_progress_recovers_after_git_before_sqlite(self):
        checkpoint = [dict(id="synthetic-session", start=0, end=123)]
        with patch.object(I, "runner", return_value=self.move_model):
            self.assertEqual(I.model_pass("crash fixture", "move", engine="fake", checkpoint=checkpoint), "changed")
        db = I.state()
        self.assertEqual(db.execute("select offset from ingested").fetchone(), (123,))
        I.recover_ingested(db)
        self.assertEqual(db.execute("select count(*) from ingested").fetchone(), (1,))
        db.close()

    def test_update_waits_for_exact_tree_review_and_resumes_without_model(self):
        # One old occurrence, so explicit replacement removes the old current state.
        (self.repo / "misc/source.md").write_text(PAGE + FACT, encoding="utf-8")
        self.commit("single update source")
        original = "USER: replace synthetic allocation with 23 units"
        def update(instruction, stdin="", label="?", context=None):
            self.calls.append(label)
            c = I.block_contract
            catalog = json.loads((I.WORK / c.CATALOG).read_text(encoding="utf-8"))
            row = next(row for row in catalog["blocks"] if row["text"] == FACT.strip())
            intent = dict(block=row["id"], to="misc/source.md", section="## 关键事实",
                          text="- synthetic allocation: 23 units", source=dict(line=1, quote=original),
                          reason="Synthetic user explicitly replaces the current allocation.")
            return True, c.PLAN_PREFIX + json.dumps(dict(moves=[], updates=[intent])), 0
        with patch.object(I, "runner", return_value=update):
            self.assertFalse(I.model_pass("update fixture", "update", context=original, engine="fake"))
        self.assertTrue(I.BLOCK_PENDING)
        with patch.object(I, "runner", side_effect=AssertionError("review wait invokes no model")):
            self.assertFalse(I.model_pass("update fixture", "update", context=original, engine="fake"))
        key = I.block_contract.digest(["update fixture", "ingest", None])
        sha = self.git("rev-parse", "refs/wiki-ingest/pending/" + key)
        # Only the isolated synthetic fixture receives a simulated independent approval.
        subprocess.run([sys.executable, "-I", str(Path(I.__file__).parent / "block_contract.py"),
                        "approve", "--repo", str(self.repo), "--candidate", sha,
                        "--reviewer", "synthetic-independent-reviewer", "--reason", "synthetic explicit replacement"],
                       check=True, capture_output=True, text=True,
                       env={k: v for k, v in os.environ.items() if k != "WIKI_INGEST"})
        with patch.object(I, "runner", side_effect=AssertionError("approved candidate needs no model")):
            self.assertEqual(I.model_pass("update fixture", "update", context=original, engine="fake"), "changed")
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn(FACT, (self.repo / "misc/source.md").read_text(encoding="utf-8"))
        self.assertIn("23 units", (self.repo / "misc/source.md").read_text(encoding="utf-8"))

    def test_uncompleted_turn_does_not_turn_into_an_accepted_checkpoint(self):
        checkpoint = [dict(id="failed-session", start=0, end=123)]
        def interrupted(*args, **kwargs):
            (I.WORK / "misc/source.md").write_text(PAGE + FACT + FACT + "- incomplete new fact\n", encoding="utf-8")
            return False, "interrupted synthetic turn", 0
        with patch.object(I, "runner", return_value=interrupted):
            self.assertFalse(I.model_pass("failed turn", "append", engine="fake", checkpoint=checkpoint))
        with patch.object(I, "runner", return_value=lambda *a, **k: (False, "still incomplete", 0)):
            self.assertFalse(I.model_pass("failed turn", "append", engine="fake", checkpoint=checkpoint))
        db = I.state()
        self.assertEqual(db.execute("select * from ingested").fetchall(), [])
        self.assertNotIn("incomplete new fact", (self.repo / "misc/source.md").read_text(encoding="utf-8"))
        db.close()

    def test_program_callback_can_relocate_exact_blocks_but_not_rewrite_them(self):
        def apply(answer):
            (I.WORK / "misc/dest.md").write_text(PAGE + FACT + FACT, encoding="utf-8")
            (I.WORK / "misc/source.md").write_text(PAGE, encoding="utf-8")
            with (I.WORK / "misc/README.md").open("a", encoding="utf-8") as f:
                f.write("- [dest](dest.md) — scripted destination\n")
            return ""
        with patch.object(I, "runner", return_value=lambda *a, **k: (True, "synthetic grouping", 0)):
            self.assertEqual(I.model_pass("scripted move", "group", engine="fake", kind="restructure", apply=apply), "changed")
        self.assertEqual((self.repo / "misc/dest.md").read_text(encoding="utf-8").count(FACT), 2)

    def test_review_receipt_becomes_invalid_when_main_advances(self):
        c = I.block_contract
        coverage = c.freeze(self.repo, ["HEAD"], "USER: synthetic replacement")
        row = next(iter(c.inventory(self.repo, coverage["sources"])[0].values()))
        coverage["plan"]["updates"] = [dict(block=row["id"], to=row["path"], section=row["section"],
                                              text="- replacement synthetic fact", source=dict(line=1, quote="USER: synthetic replacement"),
                                              reason="synthetic explicit update")]
        files = c.render(self.repo, coverage, c.working_tree(self.repo), "ingest")
        key = c.review_key(coverage, files, "ingest")
        receipt = c.review_path(self.repo, key)
        receipt.parent.mkdir(parents=True)
        receipt.write_text(json.dumps(dict(subject=key, reviewer="synthetic reviewer", reason="fixture only")), encoding="utf-8")
        self.assertTrue(c.reviewed(self.repo, coverage, files, "ingest"))
        (self.repo / "log.md").write_text("# Log\n- new main entry\n", encoding="utf-8")
        self.commit("main advanced after review")
        coverage["sources"] = c.freeze(self.repo, coverage["sources"] + ["HEAD"])["sources"]
        self.assertFalse(c.reviewed(self.repo, coverage, files, "ingest"))

    def test_saved_program_fix_applies_the_corrected_answer(self):
        def apply(answer):
            if answer != "complete grouping":
                return "incomplete synthetic grouping"
            (I.WORK / "log.md").write_text("# Log\n- completed grouping\n", encoding="utf-8")
            return ""
        with patch.object(I, "runner", return_value=lambda *a, **k: (True, "incomplete", 0)):
            self.assertFalse(I.model_pass("saved program", "group", engine="fake", apply=apply))
        with patch.object(I, "runner", return_value=lambda *a, **k: (True, "complete grouping", 0)):
            self.assertEqual(I.model_pass("saved program", "group", engine="fake", apply=apply), "changed")
        self.assertIn("completed grouping", (self.repo / "log.md").read_text(encoding="utf-8"))

    def test_acceptance_preserves_original_long_block_bytes(self):
        long_fact = "- " + "synthetic original words " * 200 + "\n"
        (self.repo / "misc/source.md").write_text(PAGE + long_fact, encoding="utf-8")
        self.commit("long original source")
        self.assertEqual(I.acceptance(), "")
        self.assertEqual((self.repo / "misc/source.md").read_text(encoding="utf-8"), PAGE + long_fact)

    def test_partial_checkpoint_recovers_before_final_offset(self):
        partial = [dict(id="chunk-session", start=0, end=123, chunk="synthetic complete record", part=1)]
        with patch.object(I, "runner", return_value=self.move_model):
            self.assertEqual(I.model_pass("partial fixture", "move", engine="fake", checkpoint=partial), "changed")
        db = I.state()
        self.assertEqual(db.execute("select * from ingested").fetchall(), [])
        self.assertEqual(db.execute("select part from pending_parts").fetchone(), (1,))
        with patch.object(I, "runner", return_value=lambda *a, **k: (True, "no further edits", 0)):
            self.assertEqual(I.model_pass("final fixture", "append", engine="fake",
                                          checkpoint=[dict(id="chunk-session", start=0, end=123)]), "changed")
        db.close()
        db = I.state()
        self.assertEqual(db.execute("select offset from ingested").fetchone(), (123,))
        self.assertEqual(db.execute("select * from pending_parts").fetchall(), [])
        db.close()


if __name__ == "__main__":
    unittest.main()
