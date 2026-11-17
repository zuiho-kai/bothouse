"""Codex candidate resume must retain producer identity and the undelivered offset."""
import json
from contextlib import contextmanager
import subprocess
import unittest
from unittest.mock import patch
import test_block_contract as fixture

I = fixture.I


class PendingExecution(unittest.TestCase):
    setUp = fixture.BlockContract.setUp
    git = fixture.BlockContract.git
    commit = fixture.BlockContract.commit
    move_model = fixture.BlockContract.move_model

    def interrupted_candidate(self):
        checkpoint = [dict(id="codex-session", start=0, end=123)]
        def call(*args, **kwargs):
            if kwargs.get("label", "").endswith(" fix"):
                return False, "interrupted correction", 0, None
            kwargs = {key: value for key, value in kwargs.items() if key not in ("effort", "model", "resume")}
            return (*self.move_model(*args, **kwargs), "synthetic-thread")
        with patch.object(I, "codex", side_effect=call), patch.object(I, "CODEX_CHAIN", ["fixture-model"]), \
                patch.object(I, "AFTER_CODEX", []):
            self.assertFalse(I.model_pass("codex resume", "move", engine="codex:high",
                                          checkpoint=checkpoint, check=lambda: "unfinished correction"))
        key = I.block_contract.digest(["codex resume", "ingest", checkpoint])
        ref = "refs/wiki-ingest/pending/" + key
        message = self.git("show", "-s", "--format=%B", ref)
        saved = next(json.loads(line[len(I.PENDING_TRAILER):]) for line in message.splitlines()
                     if line.startswith(I.PENDING_TRAILER))
        db = I.state()
        self.assertEqual(db.execute("select * from ingested").fetchall(), [])
        db.close()
        return checkpoint, ref, saved, message

    def replace_record(self, ref, saved, message):
        lines = [I.PENDING_TRAILER + I.block_contract.canonical(saved)
                 if line.startswith(I.PENDING_TRAILER) else line for line in message.splitlines()]
        tree = self.git("rev-parse", ref + "^{tree}")
        parent = self.git("rev-parse", ref + "^")
        candidate = self.git("commit-tree", tree, "-p", parent, "-m", "\n".join(lines))
        self.git("update-ref", ref, candidate)

    def resume(self, checkpoint):
        with patch.object(I, "codex", return_value=(True, "correction complete", 0, None)) as call, \
                patch.object(I, "EFFORT", "max"), patch.object(I, "CODEX_CHAIN", ["different-model"]):
            self.assertEqual(I.model_pass("codex resume", "move", engine="codex:low",
                                          checkpoint=checkpoint), "changed")
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.kwargs["model"], "different-model")
        self.assertIsNone(call.call_args.kwargs.get("resume"))
        db = I.state()
        self.assertEqual(db.execute("select offset from ingested where id='codex-session'").fetchone(), (123,))
        db.close()
        self.assertEqual((self.repo / "misc/source.md").read_text().count(fixture.FACT), 1)
        self.assertEqual((self.repo / "misc/dest.md").read_text().count(fixture.FACT), 1)
        return call.call_args.kwargs

    def test_codex_new_pending_uses_current_model_and_effort_across_batches(self):
        checkpoint, _, saved, _ = self.interrupted_candidate()
        self.assertEqual(saved["execution"], dict(engine="codex", model="fixture-model", effort="high"))
        self.assertEqual(saved["checkpoint"], checkpoint)
        self.assertEqual(self.resume(checkpoint)["effort"], "low")

    def test_codex_legacy_model_is_never_parsed_as_effort(self):
        checkpoint, ref, saved, message = self.interrupted_candidate()
        saved.pop("execution")
        self.replace_record(ref, saved, message)
        self.assertEqual(self.resume(checkpoint)["effort"], "low")

    def test_legacy_deepseek_fix_uses_current_codex_and_retains_source(self):
        checkpoint, ref, saved, message = self.interrupted_candidate()
        saved.pop("execution")
        saved["engine"] = "deepseek"
        saved["session"] = "old-provider-session"
        self.replace_record(ref, saved, message)
        with patch.object(I, "runner", side_effect=AssertionError("must use current Codex")):
            self.resume(checkpoint)
        message = self.git("show", "-s", "--format=%B", ref)
        delivered = next(json.loads(line[len(I.PENDING_TRAILER):]) for line in message.splitlines()
                         if line.startswith(I.PENDING_TRAILER))
        self.assertEqual(delivered["source"]["engine"], "deepseek")
        self.assertEqual(delivered["source"]["session"], "old-provider-session")
        self.assertEqual(delivered["execution"], dict(engine="codex", model="different-model", effort="low"))

    def test_malformed_execution_retains_candidate_and_offset_without_calling_model(self):
        checkpoint, ref, saved, message = self.interrupted_candidate()
        saved["execution"].pop("effort")
        self.replace_record(ref, saved, message)
        before = self.git("rev-parse", ref)
        with patch.object(I, "codex", side_effect=AssertionError("must retain ambiguous candidate")):
            self.assertFalse(I.model_pass("codex resume", "move", engine="codex:low", checkpoint=checkpoint))
        self.assertTrue(I.BLOCK_PENDING)
        self.assertEqual(self.git("rev-parse", ref), before)
        db = I.state()
        self.assertEqual(db.execute("select * from ingested").fetchall(), [])
        db.close()

    def test_legacy_codex_default_and_non_codex_records_remain_readable(self):
        with patch.object(I, "EFFORT", "high"):
            for identity in ("codex", "codex:None"):
                self.assertEqual(I.pending_execution(dict(engine=identity)),
                                 dict(engine="codex", model=None, effort="high"))
        self.assertEqual(I.pending_execution(dict(engine="dsh")), dict(engine="dsh", model=None, effort=None))

    def test_codex_fresh_and_resume_cli_keep_model_separate_from_effort(self):
        @contextmanager
        def output_file(*args, **kwargs):
            with (self.root / "codex-output.txt").open("w+") as stream:
                yield stream
        def run(cmd, **kwargs):
            (self.root / "codex-output.txt").write_text("completed")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        with patch.object(I.tempfile, "NamedTemporaryFile", output_file), \
                patch.object(I, "USAGE", self.root / "usage.tsv"), \
                patch.object(I, "engine_run", side_effect=run) as invoke:
            for resume in (None, "synthetic-thread"):
                self.assertTrue(I.codex("synthetic", model="fixture-model", effort="high", resume=resume)[0])
                cmd = invoke.call_args.args[0]
                self.assertEqual(cmd[cmd.index("-m") + 1], "fixture-model")
                self.assertIn("model_reasoning_effort=high", cmd)
                self.assertNotIn("model_reasoning_effort=fixture-model", cmd)


if __name__ == "__main__":
    unittest.main()
