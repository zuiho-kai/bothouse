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


if __name__ == "__main__":
    unittest.main()
