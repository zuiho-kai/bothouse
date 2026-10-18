"""检查发言日志：每条角色发言都有开始/结束，任意两段“在说”时间不重叠。

    uv run python tools/check_overlap.py logs/speech-*.jsonl
"""
from __future__ import annotations

import json
import sys
from datetime import datetime


def check(path: str) -> list[str]:
    starts, spans, errors = {}, [], []
    for line in open(path, encoding="utf-8"):
        ev = json.loads(line)
        if ev["event"] == "start":
            starts[ev["msg_id"]] = ev
        elif ev["event"] == "end":
            s = starts.pop(ev["msg_id"], None)
            if s is None:
                errors.append(f"msg {ev['msg_id']} 有结束没有开始")
                continue
            spans.append((s["t"], ev["t"], ev["msg_id"], s["role"], ev["reason"]))
    for mid in starts:
        errors.append(f"msg {mid} 有开始没有结束")
    spans.sort()
    for a, b in zip(spans, spans[1:]):
        if b[0] < a[1]:
            errors.append(f"重叠：msg {a[2]}({a[3]}) 到 {a[1]:.3f}，msg {b[2]}({b[3]}) 从 {b[0]:.3f} 开始")
    ts = lambda t: datetime.fromtimestamp(t).strftime("%H:%M:%S.%f")[:-3]
    for s, e, mid, role, reason in spans:
        print(f"msg {mid:>3} {role:<6} {ts(s)} -> {ts(e)}  {e - s:6.2f}s  {reason}")
    print(f"{path}: {len(spans)} 段发言，{len(errors)} 个问题")
    return errors


if __name__ == "__main__":
    bad = []
    for p in sys.argv[1:]:
        bad += check(p)
    for e in bad:
        print("ERROR", e)
    sys.exit(1 if bad else 0)
