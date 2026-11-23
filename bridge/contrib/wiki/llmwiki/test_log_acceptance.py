#!/usr/bin/env python3 -I
"""Append-only and repair regressions; isolated Git repos, no models or directory deletion."""
from contextlib import ExitStack
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(tempfile.mkdtemp(prefix="wiki-append-test-", dir=os.environ.get("WIKI_TEST_ROOT")))
os.environ["WIKI_DIR"] = str(ROOT)
os.environ["WIKI_BRIDGE_CONFIG"] = str(ROOT / "bridge.toml")
os.environ["WIKI_CC_CONNECT"] = str(ROOT / "no-bridge")
os.environ["AGENT_SESSIONS_DIR"] = str(ROOT / "sessions")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest as I


class LogAcceptance(unittest.TestCase):
    def setUp(self):
        self.wiki = Path(tempfile.mkdtemp(dir=ROOT))
        self.git("init", "-q")
        self.git("config", "user.name", "test")
        self.git("config", "user.email", "test@localhost")
        self.log = self.wiki / "log.md"
        # The original final heading has no newline, as in the archived 44d3cd5 log.
        self.old = b"# log\n## [2026-11-18] ingest | abcdef12 old  "
        self.entry = b"\n## [2026-11-18] ingest | 12345678 new\n- recorded\n"
        self.log.write_bytes(self.old)
        self.git("add", "log.md")
        self.git("commit", "-qm", "baseline")
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.multiple(I, WIKI=self.wiki, REPO=self.wiki, WORK=self.wiki))
        # Lint is independent; exercise the real Git, preservation and A2 checks.
        self.stack.enter_context(mock.patch.object(I, "new_lint_errors", return_value=""))

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.wiki, capture_output=True, check=True).stdout

    def test_append_without_final_newline(self):
        self.log.write_bytes(self.old + self.entry)
        self.assertEqual(I.acceptance(["12345678"]), "")

    def test_old_bytes_changed_or_removed_are_rejected(self):
        for old in (self.old.replace(b"old", b"changed"), self.old[:-1]):
            with self.subTest(old=old):
                self.log.write_bytes(old + self.entry)
                self.assertIn("log.md is append-only", I.acceptance(["12345678"]))

    def test_old_heading_cannot_count_as_new_entry(self):
        self.log.write_bytes(self.old + self.entry)
        self.assertIn("A2: no new log.md entry", I.acceptance(["abcdef12"]))


class RepairPrompt(unittest.TestCase):
    def test_repair_round_uses_actual_errors_and_preserves_literals(self):
        # The saved rejection changed this code literal into HTML entities during repair.
        literal = "at least one [[projects]] entry is required"
        errors = "log.md is append-only: restore the lines you removed or changed\n" + literal
        for scripted in (False, True):
            with self.subTest(scripted=scripted), \
                    mock.patch.multiple(I, WORK=ROOT, WIKI=ROOT, REPO=ROOT), \
                    mock.patch.object(I, "sync_work"), mock.patch.object(I, "home_state", return_value=None), \
                    mock.patch.object(I, "log"), mock.patch.object(I, "discard"), \
                    mock.patch.object(I.invalidate, "run"), \
                    mock.patch.object(I, "acceptance", side_effect=[errors, errors]), \
                    mock.patch.object(I, "runner") as runner:
                call = runner.return_value
                call.return_value = (True, "candidate", 0)
                apply = (lambda answer: "") if scripted else None
                self.assertFalse(I._model_pass("repair-test", "original task", engine="test-engine", apply=apply))
                repair = call.call_args_list[-1].args[0]
                self.assertIn(errors, repair)
                self.assertNotIn("split or compress", repair)
                self.assertNotIn("structural linter rejected", repair)
                self.assertIn("reported errors", repair)
                self.assertIn("warnings", repair)
                self.assertIn("verbatim", repair)
                self.assertIn("commands", repair)
                self.assertIn("configuration", repair)
                self.assertIn("unrelated", repair)


if __name__ == "__main__":
    unittest.main()
