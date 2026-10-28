"""Pre-generated memory pack, append-only voice outbox, and staging merge.

This is the "pull memory before answering, send the diary back after" half of
the companion mode. It is deliberately conservative:

* the pack is read from memory, never from a live wiki read on the hot path;
* an outbox record carries an operation identity and is deduplicated by it;
* the merge writes staging only -- canonical memory (wiki / DSH) is never
  overwritten, and no model guess is written as a user fact.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import threading
import time


PACK_SECTIONS = ('persona', 'recent_summary', 'facts', 'recent_turns')
MAX_PACK_CHARS = 12000  # 研究笔记 §6.1 的记忆包上限约 1.3–2.2k token，按中文约 3 字/token 取宽上限


@dataclass
class MemoryPack:
    """A cached prompt prefix. Stale is better than blocking the first sound."""

    path: Path
    ttl_seconds: float = 600.0  # 研究笔记 §6.1：每 10 分钟刷新一次
    text: str = ''
    loaded_at: float = 0.0
    _reloading: bool = False
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def render(self, data: dict) -> str:
        parts = []
        labels = {'persona': '人设卡', 'recent_summary': '近期摘要',
                  'facts': '高频事实', 'recent_turns': '最近语音对话'}
        for key in PACK_SECTIONS:
            value = data.get(key)
            if isinstance(value, list):
                value = '\n'.join(str(item) for item in value if str(item).strip())
            if not isinstance(value, str) or not value.strip():
                continue
            parts.append(f'[{labels[key]}]\n{value.strip()}')
        return '\n\n'.join(parts)[:MAX_PACK_CHARS]

    def _load(self) -> str:
        if not self.path.is_file():
            return ''
        data = json.loads(self.path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('记忆包必须是 JSON 对象。')
        return self.render(data)

    def refresh(self) -> str:
        try:
            text = self._load()
        except (OSError, ValueError, json.JSONDecodeError):
            # A broken pack must not take the voice path down; keep the old one.
            return self.text
        with self._lock:
            self.text, self.loaded_at = text, time.monotonic()
        return text

    def get(self) -> str:
        """Return cached text now; refresh in the background when stale."""
        with self._lock:
            text, loaded_at = self.text, self.loaded_at
        if not loaded_at:
            return self.refresh()
        if time.monotonic() - loaded_at > self.ttl_seconds:
            self._refresh_async()
        return text

    def _refresh_async(self) -> None:
        with self._lock:
            if self._reloading:
                return
            self._reloading = True
        try:
            asyncio.get_running_loop().create_task(self._run_refresh())
        except RuntimeError:
            with self._lock:
                self._reloading = False

    async def _run_refresh(self) -> None:
        try:
            await asyncio.to_thread(self.refresh)
        finally:
            with self._lock:
                self._reloading = False


def operation_id(device_id: str, turn_id: str) -> str:
    """Stable across retries: the same device turn is the same operation."""
    raw = f'voice:{device_id}:{turn_id}'.encode('utf-8')
    return hashlib.sha256(raw).hexdigest()[:32]


class VoiceOutbox:
    """Append-only diary. Same operation never appears twice."""

    def __init__(self, directory: str):
        self.directory = Path(directory).expanduser()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.directory / 'voice-outbox.jsonl'
        self.staging = self.directory / 'voice-staging.jsonl'
        self._seen: set[str] = set()
        self._pending: list[dict] = []
        self._load_seen()

    def _load_seen(self):
        if not self.path.is_file():
            return
        with self.path.open('r', encoding='utf-8') as stream:
            for line in stream:
                try:
                    op = json.loads(line).get('operation_id')
                except json.JSONDecodeError:
                    continue
                if op:
                    self._seen.add(op)

    def append(self, record: dict) -> bool:
        op = record.get('operation_id')
        if not op:
            raise ValueError('语音日记缺少 operation_id。')
        if op in self._seen:
            return False
        self._pending.append(dict(record))
        self._flush()
        return True

    def _flush(self):
        while self._pending:
            record = self._pending[0]
            try:
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                    stream.write(json.dumps(record, ensure_ascii=False) + '\n')
                    stream.flush()
                    os.fsync(stream.fileno())
            except OSError:
                # Keep it queued: the next append or retry flushes it.
                return
            self._seen.add(record['operation_id'])
            self._pending.pop(0)

    def retry(self) -> int:
        self._flush()
        return len(self._pending)

    def pending(self) -> int:
        return len(self._pending)


def record_turn(device_id: str, turn: dict, *, mode: str, route: str,
                model: str = '', confidence: float = 0.0, escalated: bool = False) -> dict:
    return {
        'operation_id': operation_id(device_id, turn['id']),
        'origin': 'voice-origin',
        'reviewed': False,
        'canonical': False,
        'device_id': device_id,
        'project': turn.get('project', ''),
        'turn_id': turn['id'],
        'mode': mode,
        'route': route,
        'model': model,
        'confidence': confidence,
        'escalated': escalated,
        'transcript': turn.get('input_text', ''),
        'answer': turn.get('text', ''),
        'at': datetime.now(timezone.utc).isoformat(),
    }


def merge_staging(outbox: VoiceOutbox, *, extractor=None) -> int:
    """Copy unreviewed voice records into staging; never touch canonical files.

    ``extractor`` may return 0-2 fact strings; without one no fact is invented
    and only the transcript/answer pair is recorded as unreviewed material.
    """
    if not outbox.path.is_file():
        return 0
    written = 0
    existing = set()
    if outbox.staging.is_file():
        with outbox.staging.open('r', encoding='utf-8') as stream:
            for line in stream:
                try:
                    existing.add(json.loads(line).get('operation_id'))
                except json.JSONDecodeError:
                    continue
    with outbox.path.open('r', encoding='utf-8') as stream:
        records = []
        for line in stream:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    for record in records:
        if record.get('operation_id') in existing:
            continue
        facts = []
        if extractor is not None:
            facts = [str(f).strip() for f in extractor(record) if str(f).strip()][:2]
        row = {**record, 'staging': True, 'facts': facts, 'note': 'voice-origin / 未复核'}
        fd = os.open(outbox.staging, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')
        existing.add(record.get('operation_id'))
        written += 1
    return written
