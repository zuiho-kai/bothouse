#!/usr/bin/env python3 -I
"""daypack.slow_commands：会话中途被结束的调用不算慢命令（11-24 vent「卡 18.5 分钟」误报）。"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import daypack as D


def rec(ts, content):
    return {"timestamp": ts, "sessionId": "s1", "message": {"content": content}}


class SlowCommands(unittest.TestCase):
    def run_on(self, rows):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "proj" / "s1.jsonl"
            f.parent.mkdir()
            f.write_text("\n".join(json.dumps(r) for r in rows))
            return D.slow_commands(D.ts_of("2026-11-24T00:00:00Z"), root=Path(d))

    def test_real_slow_counted_interrupted_skipped(self):
        rows = [
            rec("2026-11-24T03:02:00Z", [{"type": "tool_use", "id": "a", "name": "Bash", "input": {"command": "python review.py"}}]),
            rec("2026-11-24T03:12:00Z", [{"type": "tool_result", "tool_use_id": "a", "content": "ok"}]),
            rec("2026-11-24T04:12:30Z", [{"type": "tool_use", "id": "b", "name": "Bash", "input": {"command": "bothouse vent x"}}]),
            rec("2026-11-24T04:31:00Z", [{"type": "tool_result", "tool_use_id": "b", "is_error": True,
                                          "content": "[Tool call interrupted: the session ended before this call's result was recorded]"}]),
        ]
        out = self.run_on(rows)
        self.assertEqual([c for _, _, _, c in out], ["python review.py"])

    def test_batched_call_not_double_counted(self):
        # 11-24 e4fea772：premarket.py 和一条 grep 同一条消息发出，grep 排在后面，原来也记成 8.9 分钟
        rows = [
            rec("2026-11-24T03:18:00Z", [{"type": "tool_use", "id": "a", "name": "Bash", "input": {"command": "python premarket.py"}},
                                         {"type": "tool_use", "id": "b", "name": "Bash", "input": {"command": "grep PROMPT.md"}}]),
            rec("2026-11-24T03:26:55Z", [{"type": "tool_result", "tool_use_id": "a", "content": "ok"}]),
            rec("2026-11-24T03:26:56Z", [{"type": "tool_result", "tool_use_id": "b", "content": "ok"}]),
        ]
        self.assertEqual([c for _, _, _, c in self.run_on(rows)], ["python premarket.py"])


if __name__ == "__main__":
    unittest.main()
