import asyncio

import pytest

from test_voice_devices import FakeBridge, registry, turn_id
from voice.bridge import BridgeError
from voice.devices import DeviceRouter


@pytest.mark.parametrize('status', [404, 503])
async def test_cancelled_poll_error_cannot_change_terminal_state(status):
    class GatedPoll(DeviceRouter):
        async def _call(self, path, body=None):
            if path.startswith('/input/device-'):
                entered.set()
                await release.wait()
                raise BridgeError('late poll error', status)
            return await super()._call(path, body)

    entered, release = asyncio.Event(), asyncio.Event()
    router = GatedPoll(registry(), FakeBridge())
    tid = turn_id()
    await router.open_turn('desk-gge', tid, 'hello')
    pending = asyncio.create_task(router.wait_turn(tid))
    await asyncio.wait_for(entered.wait(), 2)
    router.cancel('desk-gge', tid)
    release.set()
    result = await pending
    assert result['status'] == 'cancelled'
    assert result['error'] == ''
    assert result['playback_allowed'] is False
    assert result['late_reply_ignored'] is True
