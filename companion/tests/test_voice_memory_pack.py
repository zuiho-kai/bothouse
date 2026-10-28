import json
import time
from pathlib import Path

import pytest

from voice.memory_pack import (MemoryPack, VoiceOutbox, merge_staging,
                               operation_id, record_turn)


def write_pack(path: Path, persona='我是肥鱼，说话简短。', facts='主人喜欢安静。'):
    path.write_text(json.dumps({'persona': persona, 'recent_summary': ['今天在改语音'],
                                'facts': facts, 'recent_turns': []}, ensure_ascii=False),
                    encoding='utf-8')


def test_pack_renders_sections_and_survives_broken_file(tmp_path):
    path = tmp_path / 'memory-pack.json'
    write_pack(path)
    pack = MemoryPack(path, ttl_seconds=60)
    text = pack.get()
    assert '[人设卡]' in text and '我是肥鱼' in text
    assert '[近期摘要]' in text and '[高频事实]' in text
    assert '[最近语音对话]' not in text
    path.write_text('{not json', encoding='utf-8')
    assert pack.refresh() == text  # broken pack keeps the last good version


def test_pack_refreshes_after_ttl(tmp_path):
    path = tmp_path / 'memory-pack.json'
    write_pack(path, persona='旧人设')
    pack = MemoryPack(path, ttl_seconds=0.01)
    assert '旧人设' in pack.get()
    write_pack(path, persona='新人设')
    time.sleep(0.05)
    pack.refresh()
    assert '新人设' in pack.get()


def sample_turn():
    return {'id': 'turn-1', 'project': 'gge', 'input_text': '你好', 'text': '我在。'}


def test_outbox_deduplicates_by_operation_identity(tmp_path):
    outbox = VoiceOutbox(tmp_path)
    record = record_turn('desk-gge', sample_turn(), mode='companion', route='small')
    assert record['operation_id'] == operation_id('desk-gge', 'turn-1')
    assert outbox.append(record) is True
    assert outbox.append(record) is False
    lines = outbox.path.read_text(encoding='utf-8').splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])['origin'] == 'voice-origin'
    assert json.loads(lines[0])['canonical'] is False
    # A fresh instance sees the same operation and still refuses a duplicate.
    assert VoiceOutbox(tmp_path).append(record) is False


def test_outbox_retries_a_failed_append(tmp_path):
    outbox = VoiceOutbox(tmp_path)
    real = outbox.path
    outbox.path = tmp_path  # a directory: os.open must fail
    record = record_turn('desk-gge', sample_turn(), mode='companion', route='small')
    assert outbox.append(record) is True
    assert outbox.pending() == 1
    outbox.path = real
    assert outbox.retry() == 0
    assert real.read_text(encoding='utf-8').count('operation_id') == 1


def test_merge_writes_staging_only_and_never_invents_facts(tmp_path):
    outbox = VoiceOutbox(tmp_path)
    outbox.append(record_turn('desk-gge', sample_turn(), mode='companion', route='small'))
    canonical = tmp_path / 'canonical.md'
    canonical.write_text('权威记忆\n', encoding='utf-8')
    assert merge_staging(outbox) == 1
    assert canonical.read_text(encoding='utf-8') == '权威记忆\n'
    rows = [json.loads(line) for line in outbox.staging.read_text(encoding='utf-8').splitlines()]
    assert rows[0]['facts'] == [] and rows[0]['reviewed'] is False
    assert rows[0]['note'] == 'voice-origin / 未复核'
    assert merge_staging(outbox) == 0  # rerun is idempotent


def test_extractor_facts_are_bounded_to_two(tmp_path):
    outbox = VoiceOutbox(tmp_path)
    outbox.append(record_turn('desk-gge', sample_turn(), mode='companion', route='small'))
    merge_staging(outbox, extractor=lambda record: ['一', '二', '三'])
    row = json.loads(outbox.staging.read_text(encoding='utf-8').splitlines()[0])
    assert row['facts'] == ['一', '二']
