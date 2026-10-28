import json

from voice import latency_report as report


def write(path, rows):
    path.write_text('\n'.join(json.dumps(row, ensure_ascii=False) for row in rows) + '\n',
                    encoding='utf-8')


def row(mode, route, timings, state='playing', timestamp='2026-10-28T10:00:00+08:00'):
    return {'event': 'playback', 'state': state, 'mode': mode, 'route': route,
            'timings': timings, 'timestamp': timestamp}


def test_grouped_distribution_uses_recorded_samples_only(tmp_path):
    path = tmp_path / '2026-10-28.jsonl'
    write(path, [
        row('companion', 'small', {'e2e_first_playback_ms': 1800}),
        row('companion', 'small', {'e2e_first_playback_ms': 1900}),
        row('companion', 'small', {'e2e_first_playback_ms': 2100}),
        row('work', 'big', {'e2e_first_playback_ms': 4200}),
        # 陪伴模式回退大脑：仍按陪伴 2 秒判，不按大脑 4 秒放宽。
        row('companion', 'big', {'e2e_first_playback_ms': 2600}),
        # No speech-end sample: must stay in its own lower-fidelity bucket.
        row('companion', 'small', {'first_playback_ms': 1200}),
        # Not a playback start: ignored.
        row('companion', 'small', {'e2e_first_playback_ms': 1}, state='completed'),
    ])
    result = report.summarize([path])
    small = result['groups']['companion/small e2e_first_playback_ms']
    assert small['n'] == 3
    assert small['p50'] == 1900
    assert small['min'] == 1800 and small['max'] == 2100
    assert small['target_ms'] == 2000 and small['within_target'] == 2
    assert small['pass_rate'] == 0.667
    work = result['groups']['work/big e2e_first_playback_ms']
    assert work['n'] == 1 and work['target_ms'] == 4000 and work['within_target'] == 0
    escalated = result['groups']['companion/big e2e_first_playback_ms']
    assert escalated['target_ms'] == 2000 and escalated['within_target'] == 0
    assert 'companion/small first_playback_ms' in result['groups']
    assert result['days'] == ['2026-10-28']


def test_no_samples_is_empty_not_zero(tmp_path):
    path = tmp_path / 'events.jsonl'
    path.write_text('', encoding='utf-8')
    result = report.summarize([path])
    assert result == {'files': [str(path)], 'days': [], 'groups': {}, 'samples': 0}
