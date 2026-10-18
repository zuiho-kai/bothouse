"""Explicit device identity, partner binding and original-session routing.

The device transport (#42) owns audio framing, chunk order and the wire
messages. This module owns only the identity and delivery rules:

* which physical device is bound to which partner and original session;
* which turn may be sent, and to which device its answer may be played;
* how missing sessions, duplicate events, reconnects and late replies are
  refused instead of silently creating a new identity or crossing devices.

There is no discovery and no default partner. A device without an explicit
binding is rejected before the bridge is called.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import hmac
import json
import math
from pathlib import Path
import re
import time
from typing import Iterable, Sequence
from urllib.parse import urlencode
from uuid import UUID

from .bridge import BridgeError
from .roles import Role

DEVICE_ID_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')
DEVICE_SECRET_RE = re.compile(r'[A-Za-z0-9_-]{32,128}\Z')
PROJECT_RE = re.compile(r'[A-Za-z0-9_-]{1,64}\Z')
SESSION_KEY_RE = re.compile(r'[A-Za-z0-9:._-]{1,200}\Z')
MAX_DEVICES = 8
DEVICE_STATES = ('listening', 'waiting', 'playing', 'offline')
PLAYBACK_STATES = frozenset({'playing', 'completed', 'stopped', 'failed'})

class RoutingError(RuntimeError):
    """A refusal that a transport adapter can turn into a device reply."""

    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code = code
        self.status = status

@dataclass(frozen=True)
class DeviceBinding:
    """One physical device and the one partner/session it is allowed to use."""

    device_id: str
    name: str
    project: str
    session_key: str
    appearance: str = ''
    secret: str = ''

    def __post_init__(self):
        if not isinstance(self.device_id, str) or not DEVICE_ID_RE.fullmatch(self.device_id):
            raise ValueError('设备编号必须是1至64位字母、数字、下划线或短横线。')
        if not isinstance(self.name, str) or not self.name.strip() or len(self.name) > 40:
            raise ValueError('设备名称必须是1至40字。')
        if not isinstance(self.project, str) or not PROJECT_RE.fullmatch(self.project):
            raise ValueError('设备绑定的伙伴 project 必须是1至64位字母、数字、下划线或短横线。')
        if not isinstance(self.session_key, str) or not SESSION_KEY_RE.fullmatch(self.session_key):
            raise ValueError('设备绑定的 session_key 格式不正确。')
        if not isinstance(self.appearance, str) or len(self.appearance) > 80:
            raise ValueError('外观标识最多80字。')
        if not isinstance(self.secret, str) or (self.secret and not DEVICE_SECRET_RE.fullmatch(self.secret)):
            raise ValueError('设备凭据必须留空，或为32至128位字母、数字、下划线、短横线。')

class DeviceRegistry:
    """Validated, immutable device-to-partner map loaded from one JSON file."""

    def __init__(self, devices: Iterable[DeviceBinding], roles: Sequence[Role] | None = None):
        self.devices = tuple(devices)
        if not 1 <= len(self.devices) <= MAX_DEVICES:
            raise ValueError('请明确配置1至8台设备。')
        if any(not isinstance(device, DeviceBinding) for device in self.devices):
            raise ValueError('设备名单只能包含设备绑定。')
        ids = [device.device_id for device in self.devices]
        if len(set(ids)) != len(ids):
            raise ValueError('设备编号不得重复；重复身份不能自动合并。')
        projects = [device.project for device in self.devices]
        if len(set(projects)) != len(projects):
            raise ValueError('一位伙伴只能绑定一台设备；伙伴 project 不得重复。')
        names = [device.name for device in self.devices]
        if len(set(names)) != len(names):
            raise ValueError('设备名称不得重复，用户需要能辨认每台设备。')
        secrets = [device.secret for device in self.devices if device.secret]
        if len(set(secrets)) != len(secrets):
            raise ValueError('设备凭据不得重复；共用凭据等于互相冒充。')

        roster = tuple(roles) if roles is not None else ()
        self.roles = {role.project: role for role in roster}
        if len(self.roles) != len(roster):
            raise ValueError('伙伴名单中的 project 不得重复。')
        if roles is not None:
            unknown = [project for project in projects if project not in self.roles]
            if unknown:
                raise ValueError('设备绑定了不在伙伴名单中的 project：' + '、'.join(unknown))
        self._by_id = {device.device_id: device for device in self.devices}
        self._by_project = {device.project: device for device in self.devices}

    def get(self, device_id: str) -> DeviceBinding:
        device = self._by_id.get(device_id)
        if device is None:
            raise RoutingError('unknown_device', '这台设备没有显式绑定；本轮未发送。', 404)
        return device

    def by_project(self, project: str) -> DeviceBinding | None:
        return self._by_project.get(project)

    def require_secrets(self) -> None:
        """Refuse remote listening unless every device can authenticate itself."""
        missing = [device.device_id for device in self.devices if not device.secret]
        if missing:
            raise ValueError('监听非本机地址前，必须为每台设备配置独立凭据：' + '、'.join(missing))

    def authenticate(self, device_id: str, supplied: str) -> bool:
        """Constant-time check of one device's own secret; never a shared token.

        The shape is validated first: ``hmac.compare_digest`` raises on
        non-ASCII strings, and a malformed header must be a refusal (403), not
        an exception the middleware turns into a 500.
        """
        device = self._by_id.get(device_id)
        if device is None or not device.secret or not isinstance(supplied, str):
            return False
        if not DEVICE_SECRET_RE.fullmatch(supplied):
            return False
        return hmac.compare_digest(supplied, device.secret)

    def role_name(self, device: DeviceBinding) -> str:
        role = self.roles.get(device.project)
        return role.name if role is not None else device.project

    def voice(self, device: DeviceBinding) -> str | None:
        role = self.roles.get(device.project)
        return role.tts_voice if role is not None else None

    def statuses(self) -> list[dict]:
        return [{'device_id': device.device_id, 'name': device.name,
                 'project': device.project, 'role_name': self.role_name(device),
                 'appearance': device.appearance}
                for device in self.devices]

def read_devices(path: Path, roles: Sequence[Role] | None = None) -> DeviceRegistry:
    """Read one strict JSON file; unknown fields are rejected, not ignored."""
    value = json.loads(Path(path).expanduser().read_text(encoding='utf-8'))
    if not isinstance(value, dict) or set(value) != {'devices'} or not isinstance(value['devices'], list):
        raise ValueError('设备配置必须是只含 devices 数组的 JSON 对象。')
    return DeviceRegistry(tuple(DeviceBinding(**item) for item in value['devices']), roles)

class DeviceRouter:
    """Route turns by device identity, never by guessing the current speaker.

    ``bridge`` only needs the existing synchronous ``call(path, body)``
    interface used by ``voice.bridge.Bridge``. Tests inject a fake bridge and
    never touch a real socket or session.
    """

    def __init__(self, registry: DeviceRegistry, bridge, *,
                 poll_interval: float = 0.4, timeout: float = 120.0,
                 clock=time.monotonic):
        if poll_interval <= 0 or timeout <= 0:
            raise ValueError('轮询间隔和超时都必须大于0。')
        self.registry = registry
        self.bridge = bridge
        self.poll_interval = poll_interval
        self.timeout = timeout
        self._clock = clock
        # Admission is serialized so the global turn_id and the per-device
        # slot are reserved atomically, before any bridge I/O yields.
        self._admission = asyncio.Lock()
        self.turns: dict[str, dict] = {}
        self._by_device: dict[str, str] = {}
        self._bindings: dict[str, dict] = {}
        self._session_status: dict[str, str] = {}
        self._online = {device.device_id: True for device in registry.devices}
        self._states = {device.device_id: 'listening' for device in registry.devices}
        self._connections = {device.device_id: 0 for device in registry.devices}
        self._connection_ids: dict[str, str | None] = {device.device_id: None
                                                      for device in registry.devices}

    # -- bridge and binding -------------------------------------------------

    async def _call(self, path: str, body: dict | None = None) -> dict:
        return await asyncio.to_thread(self.bridge.call, path, body)

    async def _binding(self, device: DeviceBinding) -> dict:
        query = urlencode({'project': device.project, 'session_key': device.session_key})
        try:
            result = await self._call('/input/bindings?' + query)
        except BridgeError as exc:
            if exc.status in {400, 404, 422}:
                self._session_status[device.device_id] = 'missing'
                raise RoutingError(
                    'session_missing',
                    f'{device.name} 的原会话不存在或不能安全恢复；本轮未发送。', 422) from None
            self._session_status[device.device_id] = 'unknown'
            raise RoutingError('bridge_unavailable', f'无法核对{device.name}的原会话：{exc}', 503) from None
        if not isinstance(result, dict):
            self._session_status[device.device_id] = 'missing'
            raise RoutingError('session_missing', '桥接返回了无法核对的会话绑定；本轮未发送。', 422)
        session_id = result.get('session_id')
        agent_session_id = result.get('agent_session_id')
        if (result.get('project') != device.project
                or result.get('session_key') != device.session_key
                or not isinstance(session_id, str) or not session_id
                or not isinstance(agent_session_id, str) or not agent_session_id
                or not isinstance(result.get('busy'), bool)):
            self._session_status[device.device_id] = 'missing'
            raise RoutingError('session_missing', '桥接返回的会话绑定与设备配置不一致；本轮未发送。', 422)
        previous = self._bindings.get(device.device_id)
        if previous is not None and (previous['session_id'] != session_id
                                     or previous['agent_session_id'] != agent_session_id):
            self._session_status[device.device_id] = 'changed'
            raise RoutingError(
                'session_changed',
                f'{device.name} 的原会话已变更；本轮未发送，也不会自动改用新会话。', 409)
        binding = {'session_id': session_id, 'agent_session_id': agent_session_id,
                   'busy': result['busy']}
        self._bindings[device.device_id] = binding
        self._session_status[device.device_id] = 'bound'
        return binding

    # -- turn admission -----------------------------------------------------

    async def open_turn(self, device_id: str, turn_id: str, text: str, *,
                        prompt: str | None = None) -> dict:
        """Reserve and send one turn; waiting for the reply is separate.

        Admission failures raise ``RoutingError`` and never call ``/input``.
        Failures after the bridge was asked return a turn with ``status=error``
        and ``playback_allowed=False``; they are not retried automatically.
        """
        device = self.registry.get(device_id)
        turn_id = self._turn_id(turn_id)
        text = self._text(text)
        # Checks, session lookup and the turn reservation happen under one
        # lock: two admissions cannot both pass the dedupe/busy checks and
        # then overwrite each other's device slot or turn record.
        async with self._admission:
            existing = self.turns.get(turn_id)
            if existing is not None:
                if existing['device_id'] == device_id and existing['input_text'] == text:
                    return self.snapshot(existing)
                raise RoutingError(
                    'duplicate_turn_conflict',
                    '同一请求编号已用于另一台设备或另一段内容；本轮未发送。', 409)
            if not self._online[device_id]:
                raise RoutingError('device_offline', f'{device.name} 当前离线；本轮未发送。', 503)
            current = self._by_device.get(device_id)
            if current is not None and self.turns[current]['status'] == 'thinking':
                raise RoutingError('busy', f'{device.name} 上一轮仍在处理；本轮未发送，也不排队。', 409)
            if current is not None and self.turns[current].get('_delivering'):
                raise RoutingError('busy', f'{device.name} 上一轮仍在结束中；本轮未发送，也不排队。', 409)

            binding = await self._binding(device)
            if binding['busy']:
                raise RoutingError('busy', f'{device.name} 的原会话正忙；本轮未发送，也不排队。', 409)

            request_id = f'device-{device.device_id}-{turn_id}'
            if len(request_id) > 128:
                raise RoutingError('invalid_turn', '请求编号过长，桥接无法接收。', 400)
            turn = {
                'turn_id': turn_id,
                'request_id': request_id,
                'device_id': device.device_id,
                'project': device.project,
                'session_key': device.session_key,
                'input_text': text,
                'status': 'thinking',
                'text': '',
                'error': '',
                'error_code': '',
                'playback_allowed': False,
                'audio_target': device.device_id,
                'session_id': binding['session_id'],
                'agent_session_id': binding['agent_session_id'],
                'playback': {'state': 'not_started'},
                'created_at': time.time(),
                'timings': {},
            }
            self.turns[turn_id] = turn
            self._by_device[device_id] = turn_id
            self._states[device_id] = 'waiting'

        body = {
            'request_id': request_id,
            'project': device.project,
            'session_key': device.session_key,
            'text': prompt if prompt is not None else self._prompt(device, text),
            'expected_session_id': binding['session_id'],
            'expected_agent_session_id': binding['agent_session_id'],
        }
        # Keep the device slot occupied until POST settles, so a cancelled but
        # still-delivering turn cannot overlap a second delivery to the bridge.
        turn['_delivering'] = True
        try:
            # Cancelled after reservation but before delivery: send nothing.
            if turn['status'] == 'cancelled':
                return self.snapshot(turn)
            try:
                ack = await self._call('/input', body)
            except BridgeError as exc:
                if turn['status'] == 'cancelled':
                    self._note_late_reply(turn, {'request_id': request_id, 'status': 'error',
                                                 'error': str(exc)})
                    return self.snapshot(turn)
                code = 'delivery_rejected' if exc.status < 500 else 'delivery_unknown'
                message = (f'桥接拒绝本轮输入：{exc}' if exc.status < 500 else
                           '未取得桥接回执；请求可能已送达，不会自动重发。')
                self._fail(turn, code, message)
                return self.snapshot(turn)
            except Exception:
                # An unexpected transport error must not leave the device slot
                # stuck or let the turn look successful.
                if turn['status'] == 'cancelled':
                    self._note_late_reply(turn, {'request_id': request_id, 'status': 'error'})
                    return self.snapshot(turn)
                self._fail(turn, 'delivery_unknown',
                           '投递时发生未预期错误；请求可能已送达，不会自动重发。')
                return self.snapshot(turn)
            # A cancel may land while POST is in flight; its terminal receipt
            # must not turn the turn back into a playable answer.
            if turn['status'] == 'cancelled':
                self._note_late_reply(turn, ack if isinstance(ack, dict) else {})
                return self.snapshot(turn)
            if not isinstance(ack, dict) or ack.get('request_id') not in {None, request_id}:
                self._fail(turn, 'delivery_unknown', '桥接回执与请求编号不一致；本轮不播放。')
                return self.snapshot(turn)
            if ack.get('status') in {'completed', 'silent', 'failed', 'rejected'}:
                self._apply_reply(turn, ack)
            return self.snapshot(turn)
        finally:
            turn['_delivering'] = False

    async def wait_turn(self, turn_id: str, *, timeout: float | None = None) -> dict:
        """Wait for the one reply that belongs to this turn.

        A reply that arrives after cancellation is recorded only as ignored:
        it cannot restore the turn, speak text, or target another device.
        """
        turn = self._turn(turn_id)
        deadline = self._clock() + (self.timeout if timeout is None else timeout)
        while turn['status'] == 'thinking':
            if self._clock() >= deadline:
                self._fail(turn, 'timeout',
                           '等待伙伴回答超时；请求可能仍在执行，不会自动重发。')
                break
            try:
                result = await self._call('/input/' + turn['request_id'])
            except BridgeError as exc:
                if turn['status'] != 'thinking':
                    self._note_late_reply(turn, {'request_id': turn['request_id'],
                                                 'status': 'error', 'error': str(exc)})
                    break
                if exc.status == 404:
                    self._fail(turn, 'receipt_missing',
                               '桥接没有保存这条请求的回执；执行结果未知，请先核对，勿盲目重发。')
                    break
                turn['notice'] = '与桥接暂时断开，仍在等待原请求回执；不会重复投递。'
                await asyncio.sleep(self.poll_interval)
                continue
            if turn['status'] != 'thinking':
                # Cancelled while this poll was in flight: keep the refusal.
                self._note_late_reply(turn, result if isinstance(result, dict) else {})
                break
            if not isinstance(result, dict) or result.get('request_id') != turn['request_id']:
                self._fail(turn, 'reply_mismatch', '桥接返回了无法核对的结果；本轮不播放。')
                break
            if result.get('status') not in {'completed', 'silent', 'failed', 'rejected'}:
                await asyncio.sleep(self.poll_interval)
                continue
            self._apply_reply(turn, result)
        turn.pop('notice', None)
        return self.snapshot(turn)

    async def converse(self, device_id: str, turn_id: str, text: str, *,
                       prompt: str | None = None, timeout: float | None = None) -> dict:
        snapshot = await self.open_turn(device_id, turn_id, text, prompt=prompt)
        if snapshot['status'] != 'thinking':
            return snapshot
        return await self.wait_turn(turn_id, timeout=timeout)

    def cancel(self, device_id: str, turn_id: str) -> dict:
        device = self.registry.get(device_id)
        turn = self._turn_for_device(device, turn_id)
        if turn['status'] == 'thinking':
            turn['status'] = 'cancelled'
            turn['playback_allowed'] = False
            turn['cancelled_at'] = time.time()
            self._states[device_id] = 'listening'
        elif turn['status'] != 'cancelled':
            raise RoutingError('not_cancellable', '本轮已经结束，不能取消。', 409)
        return self.snapshot(turn)

    # -- reconnect, presence and status ------------------------------------

    def set_online(self, device_id: str, online: bool) -> dict:
        device = self.registry.get(device_id)
        if not isinstance(online, bool):
            raise RoutingError('invalid_presence', '在线状态必须是布尔值。', 400)
        self._online[device_id] = online
        self._states[device_id] = 'listening' if online else 'offline'
        return self.device_status(device_id)

    async def reconnect(self, device_id: str, connection_id: str | None = None) -> dict:
        """Resume the same identity and session; never create or rebind one.

        A repeated connection event with the same id is idempotent. A new
        connection only re-checks the existing binding, so a missing or changed
        session is reported instead of being replaced by a fresh one.
        """
        device = self.registry.get(device_id)
        if connection_id is not None and self._connection_ids[device_id] == connection_id:
            return self.device_status(device_id)
        self._connections[device_id] += 1
        self._connection_ids[device_id] = connection_id
        self._online[device_id] = True
        self._states[device_id] = 'listening'
        current = self._by_device.get(device_id)
        if current is not None and self.turns[current]['status'] == 'thinking':
            self.turns[current]['reconnected'] = True
        try:
            binding = await self._binding(device)
        except RoutingError as exc:
            return {**self.device_status(device_id), 'connected': True,
                    'binding_status': 'unavailable', 'detail': str(exc)}
        detail = ('已恢复连接；继续使用原会话，没有创建新身份。'
                  if not binding['busy'] else '已恢复连接；原会话正忙，发送前会再次核对。')
        return {**self.device_status(device_id), 'connected': True,
                'binding_status': 'bound', 'detail': detail}

    def device_status(self, device_id: str) -> dict:
        device = self.registry.get(device_id)
        current_id = self._by_device.get(device_id)
        turn = self.turns.get(current_id) if current_id is not None else None
        online = self._online[device_id]
        state = 'offline' if not online else self._state_for(turn)
        session_status = self._session_status.get(device_id, 'unknown')
        return {
            'device_id': device.device_id,
            'name': device.name,
            'project': device.project,
            'role_name': self.registry.role_name(device),
            'appearance': device.appearance,
            'voice': self.registry.voice(device),
            'online': online,
            'state': state,
            'connection_generation': self._connections[device_id],
            'session': {'status': session_status, 'detail': self._session_detail(session_status)},
            'current_turn': current_id,
            'turn_status': turn['status'] if turn is not None else None,
            'playback': dict(turn['playback']) if turn is not None else {'state': 'not_started'},
            'last_error': turn.get('error', '') if turn is not None and turn['status'] == 'error' else '',
        }

    def statuses(self) -> list[dict]:
        return [self.device_status(device.device_id) for device in self.registry.devices]

    # -- audio target and playback -----------------------------------------

    def audio_target(self, device_id: str, turn_id: str) -> str:
        """Return the only device allowed to fetch/play this answer."""
        device = self.registry.get(device_id)
        turn = self._turn_for_device(device, turn_id)
        if turn['status'] != 'ready':
            raise RoutingError('not_ready', '这一轮还没有可播放的完整回答。', 409)
        return turn['audio_target']

    def record_playback(self, device_id: str, turn_id: str, state: str,
                        position_seconds: float, duration_seconds: float) -> dict:
        device = self.registry.get(device_id)
        turn = self._turn_for_device(device, turn_id)
        if state not in PLAYBACK_STATES:
            raise RoutingError('invalid_playback', '播放状态不正确。', 400)
        if not all(isinstance(value, (int, float)) and math.isfinite(value)
                   for value in (position_seconds, duration_seconds)):
            raise RoutingError('invalid_playback', '播放时间不正确。', 400)
        if position_seconds < 0 or duration_seconds < 0 or position_seconds > duration_seconds + 0.25:
            raise RoutingError('invalid_playback', '播放位置超过总时长。', 400)
        if turn['status'] != 'ready':
            raise RoutingError('not_ready', '这一轮还没有可播放的完整回答。', 409)

        current = turn['playback'].get('state')
        if current == 'completed' and state == 'completed':
            return self.snapshot(turn)
        if current in {'completed', 'failed'} and state in {'playing', 'stopped'}:
            # A duplicate or out-of-order progress event cannot reopen a
            # finished playback.
            return self.snapshot(turn)
        if state == 'completed' and position_seconds < duration_seconds - 0.25:
            turn['playback'] = {'state': 'incomplete', 'reported_state': 'completed',
                                'position_seconds': float(position_seconds),
                                'duration_seconds': float(duration_seconds)}
            raise RoutingError(
                'playback_incomplete',
                '设备报告播放完成，但位置没有到结尾；不记为完整播放。', 422)

        turn['playback'] = {'state': state,
                            'position_seconds': float(position_seconds),
                            'duration_seconds': float(duration_seconds)}
        self._states[device_id] = 'playing' if state == 'playing' else 'listening'
        return self.snapshot(turn)

    # -- snapshots and helpers ---------------------------------------------

    def snapshot(self, turn: dict) -> dict:
        result = {key: value for key, value in turn.items() if not key.startswith('_')}
        result['playback'] = dict(turn.get('playback', {}))
        result['timings'] = dict(turn.get('timings', {}))
        if 'late_reply' in turn:
            result['late_reply'] = dict(turn['late_reply'])
        return result

    def _turn(self, turn_id: str) -> dict:
        turn = self.turns.get(turn_id)
        if turn is None:
            raise RoutingError('turn_unknown', '没有找到这一轮请求。', 404)
        return turn

    def _turn_for_device(self, device: DeviceBinding, turn_id: str) -> dict:
        turn = self._turn(turn_id)
        if turn['device_id'] != device.device_id:
            raise RoutingError('wrong_device', '这一轮属于另一台设备；未记录播放。', 409)
        return turn

    @staticmethod
    def _turn_id(value: str) -> str:
        try:
            UUID(str(value))
        except (TypeError, ValueError):
            raise RoutingError('invalid_turn', '请求编号格式不正确。', 400) from None
        return str(value)

    @staticmethod
    def _text(value: str) -> str:
        text = value.strip() if isinstance(value, str) else ''
        if not text:
            raise RoutingError('invalid_text', '请输入普通对话。', 400)
        if text.startswith(('/', '!')):
            raise RoutingError('invalid_text', '管理命令不能通过设备入口发送。', 400)
        if len(text) > 6000:
            raise RoutingError('invalid_text', '这一轮内容过长；请缩短后重试。', 400)
        return text

    def _prompt(self, device: DeviceBinding, text: str) -> str:
        return ('[用户从' + device.name + '发言，请接续当前会话，用适合朗读的简短中文回答。'
                '本轮结果只由这台设备播放；不要另外用消息工具向Discord重复发送本轮对话。]\n' + text)

    def _apply_reply(self, turn: dict, result: dict) -> None:
        if turn['status'] == 'cancelled':
            # Defence in depth: a receipt that wins a race with cancel() must
            # never restore this turn or make it playable.
            self._note_late_reply(turn, result)
            return
        if result.get('request_id') != turn['request_id']:
            self._fail(turn, 'reply_mismatch', '回执编号与请求不一致；本轮不播放。')
            return
        if (result.get('session_id') != turn['session_id']
                or result.get('agent_session_id') != turn['agent_session_id']):
            self._session_status[turn['device_id']] = 'changed'
            self._fail(turn, 'session_changed',
                       '原会话在回答前发生变化；本轮不播放，也不会冒充续接。')
            return
        if result.get('status') != 'completed':
            detail = result.get('error') or '伙伴本轮没有可播放的完整回答。'
            self._fail(turn, 'turn_failed', detail)
            return
        text = result.get('text')
        if not isinstance(text, str) or not text.strip():
            self._fail(turn, 'empty_reply', '伙伴返回了空回答；本轮不播放。')
            return
        turn['text'] = text
        turn['status'] = 'ready'
        turn['playback_allowed'] = True
        turn['audio_target'] = turn['device_id']
        self._states[turn['device_id']] = 'waiting'

    @staticmethod
    def _note_late_reply(turn: dict, result: dict) -> None:
        turn['late_reply_ignored'] = True
        turn['late_reply'] = {
            'request_id': result.get('request_id', '') if isinstance(result, dict) else '',
            'status': result.get('status', '') if isinstance(result, dict) else '',
        }

    def _fail(self, turn: dict, code: str, message: str) -> None:
        turn['status'] = 'error'
        turn['error'] = message
        turn['error_code'] = code
        turn['playback_allowed'] = False
        self._states[turn['device_id']] = 'listening'

    def _state_for(self, turn: dict | None) -> str:
        if turn is None:
            return 'listening'
        if turn['status'] == 'thinking':
            return 'waiting'
        if turn['status'] == 'ready':
            return 'playing' if turn['playback'].get('state') == 'playing' else 'waiting'
        return 'listening'

    @staticmethod
    def _session_detail(status: str) -> str:
        return {
            'bound': '已核对原会话；发送时仍会再次校验。',
            'missing': '原会话不存在或不能安全恢复；不会新建会话替代。',
            'changed': '原会话已变化；不会自动改绑或冒充续接。',
            'unknown': '尚未核对原会话。',
        }.get(status, '尚未核对原会话。')
