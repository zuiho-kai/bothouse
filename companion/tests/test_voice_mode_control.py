import asyncio
import json
from uuid import uuid4

import pytest

from voice.mode_control import ModeStore
from voice.modes import MODES


def test_store_defaults_to_work_and_persists(tmp_path):
    path = tmp_path / 'device-modes.json'
    store = ModeStore(path, 'work')
    assert store.get('desk') == 'work'
    result = store.set('desk', 'companion', 'voice-put-1')
    assert result == {'mode': 'companion', 'previous': 'work', 'changed': True,
                      'operation_id': 'voice-put-1'}
    again = ModeStore(path, 'work')
    assert again.get('desk') == 'companion'
    assert again.snapshot('desk')['operation_id'] == 'voice-put-1'
    assert again.snapshot('desk')['modes'] == list(MODES)


def test_store_rejects_unknown_mode_and_missing_identity(tmp_path):
    store = ModeStore(tmp_path / 'device-modes.json')
    with pytest.raises(ValueError):
        store.set('desk', 'turbo', 'op')
    with pytest.raises(ValueError):
        store.set('desk', 'companion', '  ')


def test_store_snapshot_before_any_change(tmp_path):
    store = ModeStore(tmp_path / 'device-modes.json', 'auto')
    assert store.snapshot('new') == {'mode': 'auto', 'modes': list(MODES),
                                     'operation_id': '', 'updated_at': ''}


def test_device_mode_endpoint_round_trip(tmp_path):
    from test_voice_device_app import setup, path
    app, client, bridge, speech = setup(tmp_path)

    async def go():
        async with client:
            config = (await client.get(path('gge') + '/config')).json()
            assert config['mode']['mode'] == 'work'
            assert config['modes_enabled'] is False
            put = await client.put(path('gge') + '/mode',
                                   json={'mode': 'companion', 'operation_id': 'board-按键-1'})
            assert put.status_code == 200, put.text
            assert put.json()['mode'] == 'companion'
            assert (await client.get(path('gge') + '/mode')).json()['mode'] == 'companion'
            bad = await client.put(path('gge') + '/mode',
                                   json={'mode': 'turbo', 'operation_id': 'x'})
            assert bad.status_code == 400
            assert (await client.put(path('gge') + '/mode',
                                     json={'mode': 'auto'})).status_code == 422

    asyncio.run(go())
