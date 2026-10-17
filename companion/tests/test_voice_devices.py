"""Offline two-device routing: identity, binding, isolation and playback.

No bridge socket, real session or hardware is used. The injected bridge mimics
the existing local input API contract (``/input``, ``/input/<id>``,
``/input/bindings``), so a pass here is a software-stage result only.
"""
import asyncio
import json
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest

from voice.bridge import BridgeError
from voice.devices import (DeviceBinding, DeviceRegistry, DeviceRouter,
                           RoutingError, read_devices)
from voice.roles import Role

ROLES = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))

class FakeBridge:
    """Per-project sessions with a busy flag and scripted receipts."""

    def __init__(self):
        self.sessions = {
            'gge': ('gge-session', 'gge-cli'),
            'cursor': ('cursor-session', 'cursor-cli'),
        }
        self.busy = set()
        self.missing = set()
        self.requests = {}
        self.results = {}
        self.pending = set()
        self.lookup_gate = None
        self.calls = []
        self.binding_errors = {}
        self.down = False

    def call(self, path, body=None):
        self.calls.append((path, body))
        if self.down:
            raise BridgeError('桥接暂时不可用。', 503)
        if path.startswith('/input/bindings?'):
            query = parse_qs(urlsplit(path).query)
            project = query['project'][0]
            if project in self.binding_errors:
                raise BridgeError('原会话不能安全恢复。', self.binding_errors[project])
            if project in self.missing:
                raise BridgeError('会话不存在。', 404)
            session_id, agent_id = self.sessions[project]
            return {'project': project, 'session_key': query['session_key'][0],
                    'session_id': session_id, 'agent_session_id': agent_id,
                    'busy': project in self.busy}
        if body is not None:
            if body['request_id'] in self.requests:
                return {'request_id': body['request_id'], 'status': 'running'}
            self.requests[body['request_id']] = body
            return {'request_id': body['request_id'], 'status': 'running'}
        request_id = path.rsplit('/', 1)[-1]
        if self.lookup_gate is not None:
            self.lookup_gate.wait(5)
        if request_id not in self.requests:
            raise BridgeError('桥接没有这条请求的回执。', 404)
        if request_id in self.results:
            return self.results[request_id]
        if request_id in self.pending:
            return {'request_id': request_id, 'status': 'running'}
        project = self.requests[request_id]['project']
        session_id, agent_id = self.sessions[project]
        return {'request_id': request_id, 'status': 'completed',
                'text': project + '的回答', 'session_id': session_id,
                'agent_session_id': agent_id}

def registry():
    return DeviceRegistry((
        DeviceBinding('desk-gge', 'G哥的设备', 'gge', 'discord:room', '蓝色鲸鱼徽章'),
        DeviceBinding('desk-cursor', 'Cursor的设备', 'cursor', 'discord:room', '橙色方块徽章'),
    ), ROLES)

def router(bridge=None, **kwargs):
    return DeviceRouter(registry(), bridge or FakeBridge(), **kwargs)

def turn_id():
    return str(uuid4())

def test_config_requires_explicit_unique_bindings(tmp_path):
    path = tmp_path / 'devices.json'
    path.write_text(json.dumps({'devices': [
        {'device_id': 'a', 'name': '甲', 'project': 'gge', 'session_key': 'discord:room'},
        {'device_id': 'b', 'name': '乙', 'project': 'cursor', 'session_key': 'discord:room'},
    ]}), encoding='utf-8')
    loaded = read_devices(path, ROLES)
    assert [device.device_id for device in loaded.devices] == ['a', 'b']

    with pytest.raises(ValueError, match='重复'):
        DeviceRegistry((DeviceBinding('a', '甲', 'gge', 'discord:room'),
                        DeviceBinding('a', '乙', 'cursor', 'discord:room')), ROLES)
    with pytest.raises(ValueError, match='一位伙伴'):
        DeviceRegistry((DeviceBinding('a', '甲', 'gge', 'discord:room'),
                        DeviceBinding('b', '乙', 'gge', 'discord:room')), ROLES)
    with pytest.raises(ValueError, match='不在伙伴名单'):
        DeviceRegistry((DeviceBinding('a', '甲', 'grok', 'discord:room'),), ROLES)
    with pytest.raises(ValueError, match='设备编号'):
        DeviceBinding('bad id', '甲', 'gge', 'discord:room')
    with pytest.raises(ValueError, match='1至8台'):
        DeviceRegistry(())

    path.write_text(json.dumps({'devices': [], 'extra': 1}), encoding='utf-8')
    with pytest.raises(ValueError, match='只含 devices'):
        read_devices(path, ROLES)

def test_shipped_example_is_a_valid_two_device_map():
    example = Path(__file__).parent.parent / 'examples/device-bindings.json'
    loaded = read_devices(example, ROLES)
    assert [device.project for device in loaded.devices] == ['gge', 'cursor']
    assert [device.name for device in loaded.devices] == ['G哥的设备', 'Cursor 的设备']
    assert len({device.session_key for device in loaded.devices}) == 1

async def test_two_devices_route_to_their_own_partner_and_target():
    bridge = FakeBridge()
    service = router(bridge)

    first = turn_id()
    gge = await service.converse('desk-gge', first, '查一下进度')
    cursor = await service.converse('desk-cursor', turn_id(), '看下测试')

    assert gge['status'] == 'ready' and gge['device_id'] == 'desk-gge'
    assert cursor['status'] == 'ready' and cursor['device_id'] == 'desk-cursor'
    assert gge['audio_target'] == 'desk-gge'
    assert cursor['audio_target'] == 'desk-cursor'
    assert [request['project'] for request in bridge.requests.values()] == ['gge', 'cursor']
    assert [request['session_key'] for request in bridge.requests.values()] == ['discord:room'] * 2
    gge_request = bridge.requests[gge['request_id']]
    assert gge_request['expected_session_id'] == 'gge-session'
    assert gge_request['expected_agent_session_id'] == 'gge-cli'
    assert 'G哥的设备' in gge_request['text']
    assert service.audio_target('desk-gge', first) == 'desk-gge'

async def test_unbound_or_wrong_device_cannot_borrow_another_answer():
    service = router()
    first = turn_id()
    await service.converse('desk-gge', first, '接着说')

    with pytest.raises(RoutingError) as unknown:
        await service.open_turn('desk-other', turn_id(), '你好')
    assert unknown.value.code == 'unknown_device' and unknown.value.status == 404

    with pytest.raises(RoutingError) as wrong:
        service.audio_target('desk-cursor', first)
    assert wrong.value.code == 'wrong_device'
    with pytest.raises(RoutingError):
        service.record_playback('desk-cursor', first, 'completed', 10, 10)

async def test_missing_session_is_refused_before_delivery():
    bridge = FakeBridge()
    bridge.missing.add('cursor')
    service = router(bridge)

    with pytest.raises(RoutingError) as exc:
        await service.open_turn('desk-cursor', turn_id(), '你好')
    assert exc.value.code == 'session_missing' and exc.value.status == 422
    assert not bridge.requests
    status = service.device_status('desk-cursor')
    assert status['session']['status'] == 'missing'
    assert '不会新建会话' in status['session']['detail']
    assert status['state'] == 'listening'

async def test_changed_session_after_reply_is_not_played_as_continuation():
    bridge = FakeBridge()
    service = router(bridge)
    request = turn_id()
    opened = await service.open_turn('desk-gge', request, '记一下')
    bridge.sessions['gge'] = ('other-session', 'gge-cli')
    bridge.results[opened['request_id']] = {
        'request_id': opened['request_id'], 'status': 'completed', 'text': '冒充的回答',
        'session_id': 'other-session', 'agent_session_id': 'gge-cli',
    }
    result = await service.wait_turn(request)
    assert result['status'] == 'error'
    assert result['error_code'] == 'session_changed'
    assert result['playback_allowed'] is False and result['text'] == ''
    assert service.device_status('desk-gge')['session']['status'] == 'changed'

async def test_duplicate_and_late_events_do_not_cross_devices():
    bridge = FakeBridge()
    service = router(bridge)
    first = turn_id()
    await service.converse('desk-gge', first, '第一轮')
    second = turn_id()
    await service.converse('desk-cursor', second, '第二轮')

    # A repeated send with the same id and text is the same turn, not a new one.
    again = await service.open_turn('desk-gge', first, '第一轮')
    assert again['turn_id'] == first
    assert len(bridge.requests) == 2

    # The same id with different text, or from another device, is refused.
    with pytest.raises(RoutingError) as conflict:
        await service.open_turn('desk-gge', first, '换一段内容')
    assert conflict.value.code == 'duplicate_turn_conflict'
    with pytest.raises(RoutingError) as conflict:
        await service.open_turn('desk-cursor', first, '第一轮')
    assert conflict.value.code == 'duplicate_turn_conflict'

async def test_cancelled_turn_ignores_late_reply_and_keeps_device_free():
    bridge = FakeBridge()
    service = router(bridge, poll_interval=0.01)
    request = turn_id()
    opened = await service.open_turn('desk-gge', request, '慢慢来')
    bridge.pending.add(opened['request_id'])
    bridge.lookup_gate = threading.Event()
    waiting = asyncio.create_task(service.wait_turn(request))
    await asyncio.sleep(0.05)
    service.cancel('desk-gge', request)
    # The reply lands only after the cancel: it must be ignored, not spoken.
    bridge.pending.discard(opened['request_id'])
    bridge.results[opened['request_id']] = {
        'request_id': opened['request_id'], 'status': 'completed', 'text': '迟到的回答',
        'session_id': 'gge-session', 'agent_session_id': 'gge-cli',
    }
    bridge.lookup_gate.set()
    result = await waiting

    assert result['status'] == 'cancelled'
    assert result['playback_allowed'] is False
    assert result['late_reply_ignored'] is True
    assert result['late_reply']['status'] == 'completed'
    assert result['text'] == ''
    assert service.device_status('desk-gge')['state'] == 'listening'

    # Cancelling again is idempotent; cancelling an ended turn is not.
    assert service.cancel('desk-gge', request)['status'] == 'cancelled'
    with pytest.raises(RoutingError):
        service.cancel('desk-gge', turn_id())

async def test_reconnect_keeps_identity_and_reports_missing_session():
    bridge = FakeBridge()
    service = router(bridge)

    first = await service.reconnect('desk-gge', 'conn-1')
    assert first['binding_status'] == 'bound' and first['connected'] is True
    assert first['project'] == 'gge' and first['session']['status'] == 'bound'
    assert (await service.reconnect('desk-gge', 'conn-1'))['connection_generation'] == 1

    bridge.missing.add('gge')
    second = await service.reconnect('desk-gge', 'conn-2')
    assert second['connection_generation'] == 2
    assert second['binding_status'] == 'unavailable'
    assert second['project'] == 'gge' and second['session']['status'] == 'missing'
    assert not bridge.requests

async def test_playback_completion_needs_the_whole_audio():
    service = router()
    request = turn_id()
    await service.converse('desk-gge', request, '讲个短句')

    with pytest.raises(RoutingError) as incomplete:
        service.record_playback('desk-gge', request, 'completed', 2.0, 10.0)
    assert incomplete.value.code == 'playback_incomplete'
    assert service.snapshot(service.turns[request])['playback']['state'] == 'incomplete'

    done = service.record_playback('desk-gge', request, 'completed', 10.0, 10.0)
    assert done['playback']['state'] == 'completed'
    # A repeated or late progress event cannot reopen a finished answer.
    assert service.record_playback('desk-gge', request, 'playing', 1.0, 10.0)['playback']['state'] == 'completed'
    assert service.record_playback('desk-gge', request, 'completed', 10.0, 10.0)['playback']['state'] == 'completed'
    with pytest.raises(RoutingError):
        service.record_playback('desk-gge', request, 'completed', 11.0, 10.0)
    with pytest.raises(RoutingError):
        service.record_playback('desk-gge', request, 'finished', 10.0, 10.0)

async def test_busy_or_offline_device_never_reaches_the_bridge():
    bridge = FakeBridge()
    bridge.busy.add('cursor')
    service = router(bridge)
    with pytest.raises(RoutingError) as busy:
        await service.open_turn('desk-cursor', turn_id(), '在吗')
    assert busy.value.code == 'busy' and busy.value.status == 409
    assert not bridge.requests

    service.set_online('desk-gge', False)
    with pytest.raises(RoutingError) as offline:
        await service.open_turn('desk-gge', turn_id(), '在吗')
    assert offline.value.code == 'device_offline'
    assert service.device_status('desk-gge')['state'] == 'offline'
    service.set_online('desk-gge', True)
    assert service.device_status('desk-gge')['state'] == 'listening'

async def test_delivery_failure_is_not_retried_or_played():
    bridge = FakeBridge()
    service = router(bridge)
    request = turn_id()
    opened = await service.open_turn('desk-gge', request, '你好')
    bridge.results[opened['request_id']] = {
        'request_id': opened['request_id'], 'status': 'failed', 'text': '半截回答',
        'session_id': 'gge-session', 'agent_session_id': 'gge-cli', 'error': '额度不足',
    }
    result = await service.wait_turn(request)
    assert result['status'] == 'error' and result['error_code'] == 'turn_failed'
    assert result['playback_allowed'] is False
    assert len(bridge.requests) == 1

async def test_turn_timeout_reports_unknown_instead_of_success():
    service = router()
    request = turn_id()
    await service.open_turn('desk-gge', request, '想很久')
    result = await service.wait_turn(request, timeout=0)
    assert result['status'] == 'error' and result['error_code'] == 'timeout'
    assert result['playback_allowed'] is False
