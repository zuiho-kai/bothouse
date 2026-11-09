#!/usr/bin/env python3 -I
"""Native Codex accounting regressions. No network or model calls."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import codex_daypack as C
import daypack as D

SID = "01a15ee1-e0ef-7802-a59a-b047674a9b47"
OTHER = "01a15ee1-e0ef-7802-a59a-b047674a9b48"


def event(t, typ, payload):
    return {"timestamp": f"2026-10-21T00:{t // 60:02d}:{t % 60:02d}Z", "type": typ, "payload": payload}


def usage(t, n):
    return event(t, "event_msg", {"type": "token_count", "info": {
        "total_token_usage": {"input_tokens": n, "cached_input_tokens": n // 2, "output_tokens": n // 10}}})


def call(t, name, args, cid):
    return event(t, "response_item", {"type": "function_call", "name": name,
                                      "arguments": json.dumps(args), "call_id": cid})


def result(t, text, cid):
    return event(t, "response_item", {"type": "function_call_output", "call_id": cid, "output": text})


class CodexPack(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.start = D.ts_of("2026-10-21T00:00:00Z")
        self.sessions = [("674a9b47-" + SID, "own", [])]

    def write(self, sid, events):
        p = self.root / "2026/10/21" / f"rollout-2026-10-21T00-00-00-{sid}.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("\n".join(json.dumps(e) for e in [
            event(0, "session_meta", {"id": sid}), *events]) + "\n")
        return p

    def read(self, start=0, end=1000):
        return C.measurements(self.start + start, self.start + end, self.sessions, self.root)

    def test_deduplicate_baseline_window_and_other_role(self):
        self.write(SID, [usage(1, 100), usage(10, 200), usage(11, 200), usage(20, 300)])
        self.write(OTHER, [usage(10, 99900)])
        stats, *_ = self.read(5, 20)
        self.assertEqual(set(stats), {SID})
        self.assertEqual(stats[SID]["input_tokens"], 100)
        self.assertEqual(stats[SID]["cached_input_tokens"], 50)
        self.assertEqual(stats[SID]["output_tokens"], 10)

    def test_async_exit_and_poll_intervals_pending_at_cutoff(self):
        self.write(SID, [
            call(1, "exec_command", {"cmd": "long task"}, "a"),
            result(2, "Process running with session ID 7", "a"),
            call(300, "write_stdin", {"session_id": 7}, "b"),
            result(330, "Process running with session ID 7", "b"),
            call(590, "write_stdin", {"session_id": 7}, "c"),
            result(620, "Process exited with code 0", "c")])
        _, commands, waits, pending, _ = self.read(end=610)
        self.assertFalse(commands)
        self.assertEqual(pending, [(SID, self.start + 1, "long task")])
        self.assertEqual(len(waits), 1)
        _, commands, waits, pending, _ = self.read()
        self.assertEqual(commands[0][0], 619)
        self.assertEqual([w[0] for w in waits], [30, 30])
        self.assertFalse(pending)

    def test_counter_rollback_warns_without_negative_usage(self):
        self.write(SID, [usage(1, 100), usage(2, 50), usage(3, 80)])
        stats, *_, warnings = self.read()
        self.assertEqual(stats[SID]["input_tokens"], 130)
        self.assertTrue(any("回退" in w for w in warnings))

    def test_missing_and_mismatched_logs_are_not_zero_cost_claims(self):
        text, totals = D.build(self.start, self.start + 100, self.sessions,
                               usage=False, codex_root=self.root)
        self.assertIn("缺失", text)
        self.assertIn("不套用 Claude 价格", text)
        self.assertIsNone(totals)
        p = self.write(SID, [usage(1, 100)])
        p.write_text(p.read_text().replace(SID, OTHER))
        self.assertFalse(self.read()[0])

    def test_codex_and_claude_totals_do_not_cross_compare(self):
        self.write(SID, [usage(1, 100)])
        text, totals = D.build(self.start, self.start + 100, self.sessions,
                               usage=False, codex_root=self.root, prev={"day": "yesterday", "totals": {"cost": 10}})
        self.assertIn("无可比指标", text)
        text, _ = D.build(self.start, self.start + 100, self.sessions,
                          usage=False, codex_root=self.root, prev={"day": "yesterday", "totals": totals})
        self.assertIn("Codex input 100 → 100", text)

    def test_missing_billing_is_explicit_and_not_zero_or_a_claude_estimate(self):
        self.write(SID, [usage(1, 100)])
        lines, totals = C.part(self.start, self.start + 100, self.sessions, self.root)
        text = "\n".join(lines)
        for key in ("billing", "cache_ttl", "cache_expiry_reason"):
            self.assertEqual(totals[key], "missing")
            self.assertIn(key + "=missing", text)
        self.assertNotIn("cost", totals)
        self.assertIn("不套用 Claude 价格", text)
        self.assertIn("missing 不等于 0", text)

    def test_input_and_output_rank_independently_and_only_selected_sessions(self):
        self.sessions.append(("other-" + OTHER, "own", []))
        a, b = usage(1, 1000), usage(1, 200)
        a["payload"]["info"]["total_token_usage"]["output_tokens"] = 1
        b["payload"]["info"]["total_token_usage"]["output_tokens"] = 500
        self.write(SID, [a])
        self.write(OTHER, [b])
        lines, _ = C.part(self.start, self.start + 100, self.sessions, self.root)
        text = "\n".join(lines)
        self.assertIn(f"input #1：{SID}", text)
        self.assertIn(f"output #1：{OTHER}", text)
        self.assertIn("token 排名不代表费用排名", text)
        self.sessions.pop()
        lines, _ = C.part(self.start, self.start + 100, self.sessions, self.root)
        self.assertNotIn(OTHER, "\n".join(lines))

    def test_rankings_include_every_selected_session_without_a_top_five_limit(self):
        self.sessions = []
        expected = []
        for index in range(7):
            sid = f"01a15ee1-e0ef-7802-a59a-b047674a9b{index:02x}"
            self.sessions.append((sid, "own", []))
            entry = usage(1, (index + 1) * 100)
            entry["payload"]["info"]["total_token_usage"]["output_tokens"] = 70 - index
            self.write(sid, [entry])
            expected.append(sid)
        lines, _ = C.part(self.start, self.start + 100, self.sessions, self.root)
        for label, order in (("input", list(reversed(expected))), ("output", expected)):
            ranked = [line for line in lines if line.startswith(f"- {label} #")]
            self.assertEqual(len(ranked), len(expected))
            for rank, (line, sid) in enumerate(zip(ranked, order), 1):
                self.assertIn(f"{label} #{rank}：{sid} ", line)

    def test_no_usage_does_not_create_a_zero_cost_ranking(self):
        lines, totals = C.part(self.start, self.start + 100, self.sessions, self.root)
        self.assertIsNone(totals)
        self.assertNotIn("input #1", "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
