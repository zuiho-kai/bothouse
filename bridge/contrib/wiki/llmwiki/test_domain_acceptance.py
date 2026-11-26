"""Domain moves preserve lint provenance and the accepted baseline; no models or cleanup."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_block_contract as fixture

I = fixture.I
NEW_LINT_ERRORS = I.new_lint_errors
GROUPS = {
    "subdomains": [
        dict(name="alpha", desc="first group", pages=["source.md", "second.md"]),
        dict(name="beta", desc="second group", pages=["third.md", "fourth.md"]),
    ]
}


class DomainAcceptance(unittest.TestCase):
    setUp = fixture.BlockContract.setUp
    git = fixture.BlockContract.git
    commit = fixture.BlockContract.commit

    def prepare(self):
        (self.repo / "bin").mkdir()
        for f in ("lint.py", "wikiroot.py"):  # setup_wiki.py copies every llmwiki/*.py
            (self.repo / "bin" / f).write_text((Path(I.__file__).parent / f).read_text())
        for name in ("source", "second", "third", "fourth"):
            (self.repo / f"misc/{name}.md").write_text(
                fixture.PAGE.replace("name: fixture", f"name: {name}")
                + fixture.FACT + "## 待办\n"
                + ("- 未答复提议：是否测试另一个入口\n" if name == "source" else ""))
        (self.repo / "misc/README.md").write_text(
            "# Misc\n" + "".join(f"- [{n}]({n}.md) — synthetic topic\n"
                                   for n in ("source", "second", "third", "fourth")))
        self.commit("domain with an existing unanswered proposal")
        self.real_lint = patch.object(I, "new_lint_errors", NEW_LINT_ERRORS)
        self.real_lint.start()
        self.addCleanup(self.real_lint.stop)

    def test_exact_move_keeps_existing_lint_error_on_its_source(self):
        self.prepare()
        self.assertIn("unanswered proposal", I.run_lint()[0])
        state = dict(lines=I.lint.entries(self.repo / "misc/README.md"), moved={})
        self.assertEqual(I.apply_groups("misc", json.dumps(GROUPS), state), "")
        self.assertEqual(I.new_lint_errors(), "")

    def test_new_proposal_on_moved_page_still_rejects(self):
        self.prepare()
        state = dict(lines=I.lint.entries(self.repo / "misc/README.md"), moved={})
        self.assertEqual(I.apply_groups("misc", json.dumps(GROUPS), state), "")
        with (self.repo / "misc/alpha/source.md").open("a") as stream:
            stream.write("- 未答复提议：是否添加一个新任务\n")
        self.assertIn("unanswered proposal", I.new_lint_errors())

    def test_domain_fix_round_uses_original_paths_and_delivers(self):
        self.prepare()
        state = dict(lines=I.lint.entries(self.repo / "misc/README.md"), moved={},
                     before=I.unresolved())
        calls = []
        checks = []

        def model(*args, **kwargs):
            calls.append(True)
            return True, json.dumps(GROUPS), 0

        def check():
            checks.append(True)
            return I.domain_check("misc", state) or ("synthetic repair required" if len(checks) == 1 else "")

        with patch.object(I, "runner", return_value=model):
            self.assertEqual(I.model_pass(
                "split-domain misc", "group synthetic topics", engine="fake", kind="restructure",
                apply=lambda out: I.apply_groups("misc", out, state), check=check), "changed")
        self.assertEqual(len(calls), 2)
        self.assertEqual((self.repo / "misc/alpha/source.md").read_text().count("未答复提议"), 1)
        self.assertEqual((self.repo / "log.md").read_text().count("restructure | split-domain misc"), 1)

    def test_saved_domain_candidate_reconstructs_move_state_without_a_model(self):
        self.prepare()
        def model(*args, **kwargs):
            return True, json.dumps(GROUPS), 0

        def run():
            state = dict(lines=I.lint.entries(self.repo / "misc/README.md"), moved={},
                         before=I.unresolved())
            return I.model_pass("saved split-domain misc", "group synthetic topics", engine="fake",
                                kind="restructure", apply=lambda out: I.apply_groups("misc", out, state),
                                check=lambda: I.domain_check("misc", state))

        with patch.object(I, "runner", return_value=model), patch.object(I, "deliver", return_value=[]):
            self.assertFalse(run())
        with patch.object(I, "runner", side_effect=AssertionError("saved split invokes no model")):
            self.assertEqual(run(), "changed")


if __name__ == "__main__":
    unittest.main()
