"""The devin engine: a JSON reply passes the schema, an account-wide rate limit is waited out once or stops the
round uncounted, a reply off the schema is the model's failure. A stand-in script plays `devin -p`."""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(tempfile.mkdtemp(prefix="devin-engine-"))
os.environ.update(WIKI_DIR=str(ROOT), WIKI_BRIDGE_CONFIG=str(ROOT / "absent.toml"),
                  AGENT_SESSIONS_DIR=str(ROOT / "sessions"))
sys.path.insert(0, os.environ.get("WIKI_PROPOSAL_SOURCE", str(Path(__file__).resolve().parent)))
import ingest as I

SCHEMA = {"type": "object", "properties": {"facts": {"type": "array", "items": {"type": "string"}}}}
# source: #931 measurement 2026-11-21, the CLI's refusal verbatim
LIMIT = ("Error: Agent error: Reached request rate limit. Please switch to a different model or contact support. "
         "Your limit will reset in 3 seconds (at 06:15 UTC).: {\n  \"cognition.ai/errorKind\": \"unavailable\"\n}")


def fake(replies):
    """A devin stand-in that prints the next reply of `replies` per call and records its argv."""
    state = ROOT / f"state-{len(list(ROOT.glob('state-*')))}"
    state.mkdir()
    for n, (out, rc) in enumerate(replies):
        (state / f"{n}.out").write_text(out)
        (state / f"{n}.rc").write_text(str(rc))
    bin_ = state / "devin"
    bin_.write_text(f"""#!/bin/sh
n=$(ls {state}/*.argv 2>/dev/null | wc -l | tr -d ' ')
echo "$@" > {state}/$n.argv
cat prompt.txt > {state}/$n.prompt
cat {state}/$n.out
exit $(cat {state}/$n.rc)
""")
    bin_.chmod(bin_.stat().st_mode | stat.S_IEXEC)
    return state, str(bin_)


class DevinEngine(unittest.TestCase):
    def setUp(self):
        I.USAGE = ROOT / "usage.tsv"

    def run_json(self, replies, remaining=None):
        state, bin_ = fake(replies)
        with patch.object(I, "DEVIN", bin_), patch.object(I.time, "sleep") as sleep, \
                patch.object(I.budget, "remaining", return_value=remaining):
            ok, out = I.devin_json("提取事实", SCHEMA, "ingest abcd1234 facts", "swe-2-flash-high")
        return ok, out, state, sleep

    def test_reply_wrapped_in_prose_and_fence_is_parsed_and_checked(self):
        ok, out, state, _ = self.run_json([("I'll answer.\n```json\n{\"facts\": [\"a\", \"b\"]}\n```\n", 0)])
        self.assertTrue(ok)
        self.assertEqual(out, {"facts": ["a", "b"]})
        argv = (state / "0.argv").read_text()
        for part in ("--process-model in-process", "--model swe-2-flash-high", "--prompt-file prompt.txt", "-p"):
            self.assertIn(part, argv)
        self.assertIn("JSON Schema", (state / "0.prompt").read_text())

    def test_rate_limit_is_waited_out_once_by_the_refusal_time(self):
        ok, out, state, sleep = self.run_json([(LIMIT, 1), ('{"facts": []}', 0)])
        self.assertTrue(ok)
        sleep.assert_called_once_with(8)  # 3 s from the refusal + 5 s skew

    def test_second_rate_limit_stops_the_round_uncounted(self):
        ok, out, _, _ = self.run_json([(LIMIT, 1), (LIMIT, 1)])
        self.assertFalse(ok)
        self.assertTrue(out.provider_down)

    def test_rate_limit_without_room_for_the_wait_is_not_waited(self):
        ok, out, _, sleep = self.run_json([(LIMIT, 1)], remaining=60)
        self.assertFalse(ok)
        self.assertTrue(out.provider_down)
        sleep.assert_not_called()

    def test_reply_off_the_schema_is_a_model_failure_not_an_outage(self):
        for reply in ('{"facts": "a"}', '{"other": []}', "no json here"):
            with self.subTest(reply=reply):
                ok, out, _, _ = self.run_json([(reply, 0)])
                self.assertFalse(ok)
                self.assertFalse(out.provider_down)

    def test_quota_refusal_is_an_outage(self):
        ok, out, _, _ = self.run_json([("Quota exhausted\nPurchase on-demand usage", 1)])
        self.assertFalse(ok)
        self.assertTrue(out.provider_down)

    def test_devin_is_a_proposal_route_and_not_claude(self):
        self.assertEqual(I.family("devin:swe-2-high"), "devin")
        self.assertFalse(I.is_claude("devin:swe-2-high"))
        self.assertFalse(I.openai_route(["devin:swe-2-high"]))


if __name__ == "__main__":
    unittest.main()
