"""Explicit private relay through the existing bridge, with no strict fallback.

Only server-side roles select a target. This module never sends Discord messages,
executes CLI commands, or chooses a channel from aggregated busy state.
"""
from __future__ import annotations

import asyncio
import time
from urllib.parse import urlencode

from .bridge import BridgeError


def payload_identity(service, project, scope):
    return {'from': service.settings.project,
            'to': service.roles[project].relay_project,
            'session_key': service.settings.session_key, 'scope': scope}


async def relay_binding(service, project, scope):
    expected = payload_identity(service, project, scope)
    result = await asyncio.to_thread(service.bridge.call, '/relay/voice/binding?' + urlencode(expected))
    if (any(result.get(k) != v for k, v in expected.items())
            or not isinstance(result.get('relay_key'), str)
            or len(result['relay_key']) != 64 or not isinstance(result.get('busy'), bool)):
        raise BridgeError('语音转发绑定未通过核对，本轮未发送。', 422)
    return result


async def relay_turn(service, turn, request_id):
    expected = turn['_binding']
    scope = turn.get('device_id', 'desktop')
    body = dict(payload_identity(service, turn['project'], scope),
                mode='voice', request_id=request_id, message=turn['prompt'])
    path = '/relay/voice/' + request_id
    deadline = time.monotonic() + 190
    submitted = False
    try:
        # At most one POST. A lost acknowledgement is resolved only by GET.
        submitted = True
        try:
            await asyncio.to_thread(service.bridge.call, '/relay/send', body)
        except BridgeError as exc:
            if exc.not_sent:
                submitted = False
                raise
            if exc.status < 500:
                raise
        while time.monotonic() < deadline:
            if service.output_stopped(turn):
                raise BridgeError('本轮语音已停止；任务可能已经执行，请核对后再发送。', 409)
            try:
                result = await asyncio.to_thread(service.bridge.call, path)
            except BridgeError as exc:
                if exc.status == 404:
                    raise BridgeError('转发执行结果未知；不会重新投递，请先核对。', 404) from None
                if exc.status < 500:
                    raise
                await asyncio.sleep(1)
                continue
            if (result.get('request_id') != request_id
                    or result.get('relay_key') != expected['relay_key']):
                raise BridgeError('转发回执与本轮绑定不符；本轮不播放。', 422)
            status = result.get('status')
            if status == 'completed':
                if not isinstance(result.get('text'), str) or not result['text'].strip():
                    raise BridgeError('转发没有完整公开回答，本轮不播放。', 502)
                if not result.get('agent_session_id'):
                    raise BridgeError('转发会话身份未确认，本轮不播放。', 422)
                submitted = False
                return result
            if status != 'running':
                submitted = False
                raise BridgeError('转发未完成；不会播放半截回答，请检查目标会话或权限。', 502)
            await asyncio.sleep(0.4)
        raise BridgeError('转发等待超时；不会重复发送或播放半截回答。', 504)
    finally:
        if submitted:
            try:
                await asyncio.to_thread(service.bridge.call, path + '/cancel', {})
            except BridgeError:
                # Cancellation cannot undo tools already executed. The bridge's
                # bounded deadline still terminates this request independently.
                turn['notice'] = '取消回执未确认；本轮不播放，执行情况需核对。'
