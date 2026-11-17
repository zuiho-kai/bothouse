"""Claude model identity regressions. Isolated wiki and fake CLI only; no credentials or paid calls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(tempfile.mkdtemp(prefix="wiki-claude-model-", dir=os.environ.get("WIKI_MODEL_TEST_ROOT")))
with patch.dict(os.environ, {"WIKI_DIR": str(ROOT), "WIKI_BRIDGE_CONFIG": str(ROOT / "missing.toml"),
                             "WIKI_CC_CONNECT": str(ROOT / "no-bridge"),
                             "AGENT_SESSIONS_DIR": str(ROOT / "sessions")}, clear=True):
    import ingest as I


class ClaudeModel(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(dir=ROOT))
        self.usage = self.root / "usage.tsv"
        self.model = "claude-haiku-5-5"
        self.result = {"result": "done", "num_turns": 1, "total_cost_usd": 0.25,
                       "modelUsage": {self.model: {"inputTokens": 10, "outputTokens": 2, "costUSD": 0.25}}}
        self.scope = patch.multiple(I, WIKI=self.root, REPO=self.root, WORK=self.root, USAGE=self.usage,
                                    LOG=self.root / "ingest.log", MODELS=dict(I.MODELS, claude="haiku"))
        self.scope.start()
        self.addCleanup(self.scope.stop)

    def call(self, result=None, rc=0, **kwargs):
        reply = subprocess.CompletedProcess([], rc, json.dumps(self.result if result is None else result), "")
        with patch.object(I, "engine_run", return_value=reply) as run:
            answer = I.claude("work", **kwargs)
        return answer, run.call_args

    def test_alias_is_pinned_before_cli_and_global_mapping_cannot_replace_it(self):
        fake = self.root / "claude"
        fake.write_text("#!" + sys.executable + '\n' + r'''
import json, os, sys
from pathlib import Path
requested = sys.argv[sys.argv.index('--model') + 1]
Path('requested.txt').write_text(requested)
actual = os.environ['ANTHROPIC_DEFAULT_HAIKU_MODEL'] if requested == 'haiku' else requested
print(json.dumps({'result': 'done', 'modelUsage': {actual: {'costUSD': 0.25}}}))
''')
        fake.chmod(0o700)
        env = {"PATH": str(self.root), "HOME": str(self.root), "USERPROFILE": str(self.root),
               "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-opus-5-5", "ANTHROPIC_MODEL": "claude-opus-5-5"}
        with patch.dict(os.environ, env, clear=True):
            ok, _, _ = I.claude("work", model="haiku")
        self.assertTrue(ok)
        self.assertEqual((self.root / "requested.txt").read_text(), self.model)
        self.assertIn(self.model, self.usage.read_text())

    def test_mismatch_is_fatal_but_actual_usage_is_kept(self):
        self.result["modelUsage"] = {"claude-opus-5-5": {"costUSD": 0.25}}
        with self.assertRaisesRegex(SystemExit, "expected.*haiku.*reported.*opus"):
            self.call(model="haiku")
        self.assertIn("claude-opus-5-5", self.usage.read_text())
        self.assertNotIn(self.model, self.usage.read_text())

    def test_missing_and_multiple_models_cannot_be_delivered(self):
        for models in ({}, {self.model: {"costUSD": 0.25}, "claude-opus-5-5": {"costUSD": 0.5}}):
            with self.subTest(models=models), self.assertRaises(SystemExit):
                self.call(result=dict(self.result, modelUsage=models), model="haiku")
        self.assertIn("claude-opus-5-5", self.usage.read_text())

    def test_explicit_model_and_api_job_use_same_identity(self):
        for api in (False, True):
            with self.subTest(api=api):
                (ok, _, cost), args = self.call(model=self.model, api=api)
                self.assertTrue(ok)
                self.assertEqual(cost, 0.25)
                if api:
                    self.assertEqual(json.loads(args.kwargs["input"])["model"], self.model)
                else:
                    cmd = args.args[0]
                    self.assertEqual(cmd[cmd.index("--model") + 1], self.model)

    def test_default_and_api_alias_are_resolved(self):
        for kwargs in ({}, {"model": "haiku", "api": True}):
            with self.subTest(kwargs=kwargs):
                (ok, _, _), args = self.call(**kwargs)
                self.assertTrue(ok)
                if kwargs.get("api"):
                    self.assertEqual(json.loads(args.kwargs["input"])["model"], self.model)
                else:
                    cmd = args.args[0]
                    self.assertEqual(cmd[cmd.index("--model") + 1], self.model)

    def test_failure_usage_stays_actual_and_quota_failure_needs_no_model(self):
        (ok, _, _), _ = self.call(rc=1, model=self.model)
        self.assertFalse(ok)
        self.assertIn(self.model, self.usage.read_text())
        (ok, _, _), _ = self.call(result={"result": "usage limit", "is_error": True}, rc=1, model=self.model)
        self.assertFalse(ok)

    def test_error_flag_and_unverifiable_success_are_not_success(self):
        (ok, _, _), _ = self.call(result=dict(self.result, is_error=True), model=self.model)
        self.assertFalse(ok)
        with patch.object(I, "engine_run", return_value=subprocess.CompletedProcess([], 0, "not JSON", "")):
            with self.assertRaises(SystemExit):
                I.claude("work", model=self.model)

    def test_mismatch_reverts_batch_and_exits_before_fallback_or_delivery(self):
        page = self.root / "page.md"
        page.write_text("original")
        self.result["modelUsage"] = {"claude-opus-5-5": {"costUSD": 0.25}}

        def invoke(*args, **kwargs):
            page.write_text("wrong-model edits")
            return subprocess.CompletedProcess([], 0, json.dumps(self.result), "")

        with patch.object(I, "sync_work"), patch.object(I, "home_state"), \
                patch.object(I, "engine_run", side_effect=invoke) as run, \
                patch.object(I, "discard", side_effect=lambda: page.write_text("original")) as discard, \
                patch.object(I, "acceptance") as accept, patch.object(I, "deliver") as deliver:
            with self.assertRaises(SystemExit):
                I.model_pass("test", "work", engine="api-haiku|sonnet")
            self.assertEqual(run.call_count, 1)
            discard.assert_called_once()
            accept.assert_not_called()
            deliver.assert_not_called()
        self.assertEqual(page.read_text(), "original")


if __name__ == "__main__":
    unittest.main()
