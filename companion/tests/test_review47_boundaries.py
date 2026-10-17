"""Regression for the two boundary defects found in PR #47 review.

These are kept in the repository so the fixed races cannot silently return.
They use this PR's FakeBridge and never touch a real bridge, session or device.
"""
import asyncio

import pytest

from test_voice_devices import FakeBridge, registry, turn_id
from voice.devices import DeviceRouter, RoutingError


class GatedAdmission(DeviceRouter):
    def __init__(self):
        super().__init__(registry(), FakeBridge())
        self.entered = asyncio.Event()
        self.both = asyncio.Event()
        self.release = asyncio.Event()
        self.count = 0

    async def _binding(self, device):
        self.count += 1
        self.entered.set()
        if self.count == 2:
            self.both.set()
        await self.release.wait()
        return {'session_id': device.project + '-session',
                'agent_session_id': device.project + '-cli', 'busy': False}


@pytest.mark.parametrize('same_device', [True, False])
async def test_concurrent_admission_is_exclusive(same_device):
    service = GatedAdmission()
    first_id = turn_id()
    second_id = turn_id() if same_device else first_id
    first = asyncio.create_task(service.open_turn('desk-gge', first_id, 'first'))
    await service.entered.wait()
    second = asyncio.create_task(service.open_turn(
        'desk-gge' if same_device else 'desk-cursor', second_id, 'second'))
    try:
        await asyncio.wait_for(service.both.wait(), .2)
    except asyncio.TimeoutError:
        pass  # Correct serialization may keep the second lookup from starting.
    finally:
        service.release.set()
    results = await asyncio.gather(first, second, return_exceptions=True)
    accepted = [r for r in results if isinstance(r, dict)]
    assert len(accepted) == 1, results
    assert sum(isinstance(r, RoutingError) for r in results) == 1
    assert len(service.bridge.requests) == 1


async def test_repeated_same_turn_is_still_idempotent_after_serialization():
    service = DeviceRouter(registry(), FakeBridge())
    tid = turn_id()
    first = await service.open_turn('desk-gge', tid, '同一轮')
    second = await service.open_turn('desk-gge', tid, '同一轮')
    assert first['turn_id'] == second['turn_id']
    assert len(service.bridge.requests) == 1


class GatedAck(DeviceRouter):
    def __init__(self):
        super().__init__(registry(), FakeBridge())
        self.posted = asyncio.Event()
        self.release = asyncio.Event()

    async def _call(self, path, body=None):
        if path == '/input' and body is not None:
            self.posted.set()
            await self.release.wait()
            return {'request_id': body['request_id'], 'status': 'completed',
                    'session_id': body['expected_session_id'],
                    'agent_session_id': body['expected_agent_session_id'],
                    'text': 'late answer'}
        return await super()._call(path, body)


class GatedFailure(DeviceRouter):
    def __init__(self):
        super().__init__(registry(), FakeBridge())
        self.posted = asyncio.Event()
        self.release = asyncio.Event()

    async def _call(self, path, body=None):
        if path == '/input' and body is not None:
            self.posted.set()
            await self.release.wait()
            raise RuntimeError('模拟传输异常')
        return await super()._call(path, body)


async def test_cancel_during_post_cannot_restore_playback():
    service = GatedAck()
    tid = turn_id()
    pending = asyncio.create_task(service.open_turn('desk-gge', tid, 'hello'))
    await service.posted.wait()
    assert service.cancel('desk-gge', tid)['status'] == 'cancelled'
    service.release.set()
    result = await pending
    assert result['status'] == 'cancelled', result
    assert result['playback_allowed'] is False
    assert result['late_reply_ignored'] is True
    assert service.device_status('desk-gge')['state'] == 'listening'
    # The occupied slot is released, so the next turn can be admitted.
    assert (await service.open_turn('desk-gge', turn_id(), '下一轮'))['status'] in {'thinking', 'ready'}


async def test_cancel_during_failing_post_cannot_repaint_the_turn():
    service = GatedFailure()
    tid = turn_id()
    pending = asyncio.create_task(service.open_turn('desk-gge', tid, 'hello'))
    await service.posted.wait()
    assert service.cancel('desk-gge', tid)['status'] == 'cancelled'
    service.release.set()
    result = await pending
    assert result['status'] == 'cancelled', result
    assert result['playback_allowed'] is False
    assert result['error'] == ''
    assert result['late_reply_ignored'] is True
    # A cancelled delivery does not permanently block the device: the next
    # turn reaches the (still failing) transport instead of being called busy.
    retry = await service.open_turn('desk-gge', turn_id(), '重试')
    assert retry['status'] == 'error' and retry['error_code'] == 'delivery_unknown'


async def test_unexpected_delivery_error_fails_the_turn_and_frees_the_device():
    class Broken(DeviceRouter):
        async def _call(self, path, body=None):
            if path == '/input' and body is not None:
                raise RuntimeError('传输层意外异常')
            return await super()._call(path, body)

    service = Broken(registry(), FakeBridge())
    result = await service.open_turn('desk-gge', turn_id(), '你好')
    assert result['status'] == 'error' and result['error_code'] == 'delivery_unknown'
    assert result['playback_allowed'] is False
    assert service.device_status('desk-gge')['state'] == 'listening'
    # The slot is free: the retry is not rejected as busy, it fails on transport.
    retry = await service.open_turn('desk-gge', turn_id(), '再来')
    assert retry['status'] == 'error' and retry['error_code'] == 'delivery_unknown'
