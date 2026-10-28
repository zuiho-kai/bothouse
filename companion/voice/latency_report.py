"""Summarize voice first-answer latency from local voice event logs.

The acceptance clock for the voice work is: the user finished speaking -> the
first *effective* answer sentence starts playing. Acknowledgment tones and the
"thinking" emotion are explicitly excluded. Two recorded timings approximate
that clock, in increasing fidelity:

* ``e2e_first_playback_ms`` -- from the device-reported speech-end timestamp to
  the device reporting that the first audio started playing. This is the
  acceptance number.
* ``e2e_first_audio_ms`` -- from speech-end to the first audio chunk being
  ready on 8796. Audio still has to travel to the board, so this is a floor.

Rows without ``speech_end_ms`` are reported separately (submit-to-playback),
never silently mixed into the acceptance number. The tool only reads recorded
events; it never estimates or fills in missing samples.

Acceptance targets (频道 2026-10-28 明确口径): companion-mode answers within
2 seconds and work-mode answers within 4 seconds, measured from the user
finishing speech to the first effective answer sentence playing, excluding
acknowledgment tones. ``auto`` is judged by the route it chose.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
import statistics


METRICS = ('e2e_first_playback_ms', 'e2e_first_audio_ms',
           'first_playback_ms', 'submit_to_first_audio_ms')
# 来源：频道 2026-10-28 明确口径——陪伴 2 秒、工作 4 秒（用户说完→第一句有效回答出声）。
TARGETS_BY_ROUTE = {'small': 2000, 'big': 4000}


def percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * ratio
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def events_from(paths: list[Path]):
    files = []
    for path in paths:
        if path.is_dir():
            files.extend(sorted(path.glob('*.jsonl')))
        elif path.is_file():
            files.append(path)
    for path in files:
        with path.open('r', encoding='utf-8') as stream:
            for line in stream:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get('event') != 'playback' or row.get('state') != 'playing':
                    continue
                yield path, row


def summarize(paths: list[Path]) -> dict:
    groups = defaultdict(list)
    days = set()
    for path, row in events_from(paths):
        timings = row.get('timings') or {}
        modes = f"{row.get('mode', 'unknown')}/{row.get('route', 'unknown')}"
        for metric in METRICS:
            value = timings.get(metric)
            if isinstance(value, (int, float)):
                groups[(modes, metric)].append(float(value))
        stamp = row.get('timestamp') or ''
        if stamp:
            days.add(stamp[:10])
    result = {'files': [str(p) for p in paths], 'days': sorted(days),
              'groups': {}, 'samples': 0}
    for (mode, metric), values in sorted(groups.items()):
        route = mode.rsplit('/', 1)[-1]
        entry = {
            'n': len(values),
            'p50': round(percentile(values, 0.5), 1),
            'p90': round(percentile(values, 0.9), 1),
            'min': round(min(values), 1),
            'max': round(max(values), 1),
            'mean': round(statistics.fmean(values), 1),
        }
        target = TARGETS_BY_ROUTE.get(route)
        if metric == 'e2e_first_playback_ms' and target:
            entry['target_ms'] = target
            entry['within_target'] = sum(1 for value in values if value <= target)
            entry['pass_rate'] = round(entry['within_target'] / len(values), 3)
        result['groups'][f'{mode} {metric}'] = entry
        result['samples'] = max(result['samples'], len(values))
    return result
