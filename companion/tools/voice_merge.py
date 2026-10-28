#!/usr/bin/env python3
"""把语音日记合并到 staging；只写未复核副本，不改 wiki/DSH 权威记忆。

用法：cd companion && PYTHONPATH=. python -m tools.voice_merge <voice-outbox 所在目录>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from voice.memory_pack import VoiceOutbox, merge_staging


def main(argv=None):
    parser = argparse.ArgumentParser(description='语音日记合并到 staging（不改权威记忆）')
    parser.add_argument('outbox_dir', type=Path, help='voice-outbox.jsonl 所在目录（通常是语音 data_dir）')
    args = parser.parse_args(argv)
    outbox = VoiceOutbox(str(args.outbox_dir))
    print(json.dumps({'written': merge_staging(outbox), 'pending': outbox.pending()}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
