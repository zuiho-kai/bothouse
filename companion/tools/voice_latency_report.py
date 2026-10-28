#!/usr/bin/env python3
"""CLI wrapper around voice.latency_report; run from companion/ with PYTHONPATH=."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from voice.latency_report import summarize


def main(argv=None):
    parser = argparse.ArgumentParser(description='语音首句出声延迟分布（实测日志）')
    parser.add_argument('events', nargs='+', type=Path, help='events.jsonl 或其所在目录')
    parser.add_argument('--target-ms', type=int, default=0,
                        help='给定时额外统计达标比例；不传不判断达标')
    args = parser.parse_args(argv)
    report = summarize(args.events)
    if args.target_ms:
        report['target_ms'] = args.target_ms
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
