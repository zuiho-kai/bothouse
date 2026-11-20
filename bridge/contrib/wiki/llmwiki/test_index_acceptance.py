"""Navigation descriptions use the real page checks; synthetic data, no model or cleanup."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_block_contract as fixture

I = fixture.I


class IndexAcceptance(unittest.TestCase):
    setUp = fixture.BlockContract.setUp
    git = fixture.BlockContract.git
    commit = fixture.BlockContract.commit

    def test_index_descriptions_are_navigation(self):
        for path, entry in (
            ("misc/README.md", "- [source](source.md) — synthetic source and recovery"),
            ("misc/README.md", "- [nested](nested/README.md) — nested topics"),
            ("MEMORY.md", "- [misc](misc/README.md) — fixtures and recovery"),
        ):
            with self.subTest(path=path, entry=entry):
                p = self.repo / path
                before = p.read_text()
                try:
                    p.write_text(before + entry + "\n")
                    self.assertEqual(I.page_checks("ingest fixture", []), "")
                finally:
                    p.write_text(before)

    def test_new_facts_still_require_quotes(self):
        for path, entry in (
            ("misc/source.md", "- [config](config.md) — allocation is now 23 units"),
            ("misc/README.md", "- allocation is now 23 units"),
            ("misc/README.md", "- [config](config.md): allocation is now 23 units"),
            ("MEMORY.md", "- allocation is now 23 units"),
        ):
            with self.subTest(path=path):
                p = self.repo / path
                before = p.read_text()
                try:
                    p.write_text(before + "\n" + entry + "\n")
                    self.assertIn("没有引文", I.page_checks("ingest fixture", []))
                finally:
                    p.write_text(before)

    def test_index_description_cannot_forge_a_user_quote(self):
        with (self.repo / "misc/README.md").open("a") as stream:
            stream.write('- [source](source.md) — 用户说「从未说过的批准」\n')
        self.assertIn("quotes given to the user", I.page_checks("ingest fixture", []))

    def test_index_description_is_not_exempt_inside_a_code_fence(self):
        with (self.repo / "misc/README.md").open("a") as stream:
            stream.write("```markdown\n- [config](config.md) — allocation is now 23 units\n```\n")
        self.assertIn("没有引文", I.page_checks("ingest fixture", []))

    def test_ingest_delivers_index_description_and_advances_checkpoint(self):
        sid = "fixture1"
        checkpoint = [dict(id=sid, start=0, end=123)]
        calls = []

        def model(*args, **kwargs):
            calls.append(True)
            with (I.WORK / "misc/README.md").open("a") as stream:
                stream.write("- [source](source.md) — synthetic source and recovery\n")
            with (I.WORK / "log.md").open("a") as stream:
                stream.write("\n## [2026-11-17] ingest | fixture1 navigation update\n")
            return True, I.block_contract.PLAN_PREFIX + json.dumps(dict(moves=[], updates=[])), 0

        with patch.object(I, "runner", return_value=model):
            result = I.model_pass("index description", "update navigation", engine="fake",
                                  sids=[sid], checkpoint=checkpoint,
                                  check=lambda: I.page_checks("ingest fixture", []))
        self.assertEqual(result, "changed")
        self.assertEqual(len(calls), 1)
        self.assertEqual((self.repo / "misc/source.md").read_text().count(fixture.FACT), 2)
        db = I.state()
        try:
            self.assertEqual(db.execute("select offset from ingested where id=?", (sid,)).fetchone(), (123,))
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
