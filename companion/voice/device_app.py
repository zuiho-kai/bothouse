"""Local desktop devices over the existing voice pipeline, without a second CLI call."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import io
from pathlib import Path
import time
from urllib.parse import urlencode
from uuid import UUID
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .app import TurnInput, PlaybackInput, build_service
from .bridge import BridgeError
from .devices import DeviceRegistry, RoutingError
from .roles import voice_label


class DeviceRoom:
    """A room owns one turn through *playback*, not just through synthesis.

    Each page instance has a fresh client UUID. Refresh/duplicate tabs cannot
    take over or replay the previous page's audio. No timeout guesses that a
    disconnected speaker has stopped; a missing receipt keeps the room held.
    """

    def __init__(self, service, registry: DeviceRegistry):
        self.service, self.registry = service, registry
        if any(d.session_key != service.settings.session_key for d in registry.devices):
            raise ValueError('首版设备必须显式使用本实例的同一会话频道。')
        if any(d.project not in service.roles for d in registry.devices):
            raise ValueError('设备伙伴不在显式名单中。')
        self.bindings: dict[str, dict] = {}
        self.records: dict[str, dict] = {}
        self.active: str | None = None

    def device(self, device_id):
        try:
            return self.registry.get(device_id)
        except RoutingError as exc:
            raise HTTPException(exc.status, str(exc)) from None

    def get(self, device_id, identifier, client=None):
        self.device(device_id)
        record = self.records.get(identifier)
        if record is None or record['device_id'] != device_id:
            raise HTTPException(404, '这一轮不属于这台设备。')
        if client is not None and record['client'] != client:
            raise HTTPException(409, '本轮由另一个页面持有，请在原页面停止；不会接管或重播。')
        return record

    def reap(self):
        if not self.active:
            return
        record = self.records[self.active]
        turn = self.service.turns.get(self.active)
        if record['admitting'] or (turn and not turn['_task'].done()):
            return
        if (record['stop_requested'] or record.get('completed')
                or (turn and turn['status'] == 'error' and not record['audio_fetched'])):
            self.active = None

    async def binding(self, device):
        binding = await self.service.binding(device.project)
        # setdefault occurs after I/O without another yield: simultaneous first
        # reads cannot both establish conflicting pins.
        pinned = self.bindings.setdefault(device.device_id, dict(binding))
        if any(binding[k] != pinned[k] for k in ('session_id', 'agent_session_id')):
            raise BridgeError('原会话已变更，请核对后重启独立设备入口；不会自动改绑。', 409)
        return binding

    def snapshot(self, record, client):
        turn = self.service.turns.get(record['id'])
        if turn is None and not record['admitting'] and record.get('completed'):
            raise HTTPException(410, '这一轮音频已回收，文字请查共享记录；没有重新发送。')
        result = (self.service.snapshot(turn) if turn else {
            'id': record['id'], 'project': record['project'], 'input_text': record['text'],
            'status': 'thinking', 'text': '', 'timings': {},
        })
        result.update(device_id=record['device_id'], audio_target=record['device_id'])
        if record['stop_requested']:
            result.update(status='stopped', error='已停止本轮；已送达的后台任务仍会收尾。')
        elif record.get('error'):
            result.update(status='error', error=record['error'])
        allowed = (client == record['client'] and self.active == record['id']
                   and not record['stop_requested'] and not record.get('completed'))
        result['playback_allowed'] = allowed
        root = f"/device/{record['device_id']}/api/turn/{record['id']}"
        query = '?' + urlencode({'client': client})
        if allowed:
            if 'audio_url' in result:
                result['audio_url'] = root + '/audio' + query
            for chunk in result.get('audio_chunks', []):
                chunk['audio_url'] = root + '/audio/chunks/' + str(chunk['index']) + query
        else:
            result.pop('audio_url', None)
            result.pop('audio_chunks', None)
        return result

    async def submit(self, device_id, client, data: TurnInput):
        device = self.device(device_id)
        if data.project != device.project:
            raise HTTPException(400, '这个入口固定属于当前伙伴，不能指定另一位。')
        try:
            UUID(data.id)
        except ValueError:
            raise HTTPException(400, '请求编号格式不正确。') from None
        text = data.text.strip()
        if not text or text.startswith(('/', '!')):
            raise HTTPException(400, '请输入普通对话。')
        async with self.service.submit_lock:
            self.reap()
            if data.id in self.records:
                record = self.get(device_id, data.id, client)
                if record['text'] != text:
                    raise HTTPException(409, '同一请求编号不能用于不同内容。')
                return self.snapshot(record, client)
            if self.active or self.service.transcribing:
                raise HTTPException(409, '另一轮仍在处理或播放，请等它播完或在原页面停止。没有自动排队。')
            # Bound tombstones prevent old UUIDs from ever being accepted again
            # in this process, including after VoiceService evicts old audio.
            if len(self.records) >= 200:
                raise HTTPException(503, '本次演示已达200轮，请在空闲时重启独立设备入口。')
            record = dict(id=data.id, device_id=device_id, project=device.project,
                          client=client, text=text, stop_requested=False,
                          admitting=True, audio_fetched=False, started=False)
            self.records[data.id] = record
            self.active = data.id
            try:
                binding = await self.binding(device)
                await self.service._submit(data, expected_binding=binding, device=record)
            except asyncio.CancelledError:
                record['stop_requested'] = True
                raise
            except (HTTPException, BridgeError) as exc:
                record['error'] = exc.detail if isinstance(exc, HTTPException) else str(exc)
                record['stop_requested'] = True
                raise HTTPException(getattr(exc, 'status_code', getattr(exc, 'status', 422)), record['error']) from None
            except Exception:
                record['error'] = '设备接纳失败，本轮未发送。'
                record['stop_requested'] = True
                raise
            finally:
                record['admitting'] = False
                self.reap()
            return self.snapshot(record, client)

    def stop(self, device_id, identifier, client):
        record = self.get(device_id, identifier, client)
        # Does not cancel a thread that may already have delivered a CLI task.
        # Keep the slot until that task finishes; all later audio stays denied.
        record['stop_requested'] = True
        if identifier in self.service.turns and not record.get('stop_recorded'):
            self.service.record_playback(identifier, PlaybackInput(
                state='stopped', position_seconds=0, duration_seconds=0))
            record['stop_recorded'] = True
        self.reap()
        if identifier not in self.service.turns and record.get('completed'):
            return {'id': identifier, 'status': 'stopped', 'playback_allowed': False}
        return self.snapshot(record, client)

    def audio(self, device_id, identifier, client, index=None):
        record = self.get(device_id, identifier, client)
        turn = self.service.turns.get(identifier)
        if (self.active != identifier or record['stop_requested'] or record.get('completed')
                or not turn or turn['status'] not in {'synthesizing', 'ready'}):
            raise HTTPException(409, '本轮没有播放权，已停止或已经结束。')
        if index is None:
            audio = self.service.audio.get(identifier)
        else:
            chunks = self.service.audio_chunks.get(identifier, [])
            audio = chunks[index] if 0 <= index < len(chunks) else None
        if audio is None:
            raise HTTPException(404, '音频尚未就绪。')
        record['audio_fetched'] = True
        return audio

    def playback(self, device_id, identifier, client, data):
        record = self.get(device_id, identifier, client)
        if record.get('completed') and data.state == 'completed':
            return {'ok': True}
        if self.active != identifier or record['stop_requested']:
            if data.state in {'stopped', 'failed'}:
                return {'ok': True}
            raise HTTPException(409, '旧轮次不能恢复播放。')
        if data.state in {'playing', 'completed'} and not record['audio_fetched']:
            raise HTTPException(409, '设备尚未取得本轮音频。')
        if data.state == 'completed':
            if not record['started']:
                raise HTTPException(409, '没有实际开始播放的回执，不能确认播完。')
            audio = self.service.audio.get(identifier)
            if not audio:
                raise HTTPException(409, '音频尚未完整生成。')
            with wave.open(io.BytesIO(audio), 'rb') as wav:
                duration = wav.getnframes() / wav.getframerate()
            tolerance = min(.25, duration * .01)
            if duration <= 0 or any(abs(value - duration) > tolerance for value in
                                    (data.position_seconds, data.duration_seconds)):
                raise HTTPException(409, '播放回执没有覆盖完整音频。')
        self.service.record_playback(identifier, data)
        if data.state == 'playing':
            record['started'] = True
        elif data.state == 'completed':
            record['completed'] = True
        elif data.state in {'stopped', 'failed'}:
            record['stop_requested'] = True
            record['stop_recorded'] = True
        self.reap()
        return {'ok': True}


def create_device_app(settings, registry, *, speech=None, bridge=None, roles):
    settings.validate()
    service = build_service(settings, speech, bridge, roles)
    room = DeviceRoom(service, registry)

    @asynccontextmanager
    async def lifespan(app):
        yield
        for record in room.records.values():
            record['stop_requested'] = True
        for task in list(service.tasks):
            task.cancel()
        await asyncio.gather(*service.tasks, return_exceptions=True)
        if hasattr(service.speech, 'close'):
            await asyncio.to_thread(service.speech.close)

    app = FastAPI(title='共栖 · 双设备电脑验证', lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.service, app.state.room = service, room
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost'])

    @app.middleware('http')
    async def local_guard(request, call_next):
        if request.method not in {'GET', 'HEAD'}:
            allowed = {f'http://127.0.0.1:{settings.port}', f'http://localhost:{settings.port}'}
            if request.headers.get('origin') and request.headers['origin'] not in allowed:
                return JSONResponse({'detail': '只接受本机页面请求。'}, 403)
            if not hmac.compare_digest(request.headers.get('x-voice-token', ''), service.token):
                return JSONResponse({'detail': '页面已过期，请刷新。'}, 403)
            limit = 1_000_000 if request.url.path.endswith('/transcribe') else 32_000
            body = bytearray()
            async for part in request.stream():
                body.extend(part)
                if len(body) > limit:
                    return JSONResponse({'detail': '输入过长；录音最多30秒。'}, 413)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Content-Security-Policy'] = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; frame-ancestors 'none'"
        return response

    def client_id(request):
        value = request.headers.get('x-device-client') or request.query_params.get('client', '')
        try:
            UUID(value)
        except ValueError:
            raise HTTPException(400, '缺少有效页面身份。') from None
        return value

    @app.get('/api/devices')
    async def devices():
        room.reap()
        return {'devices': registry.statuses(), 'busy': bool(room.active)}

    @app.get('/device/{device_id}/api/config')
    async def configuration(device_id: str, request: Request):
        device, client = room.device(device_id), client_id(request)
        room.reap()
        role = service.roles[device.project]
        detail, available = '接续原会话；声音只从这台设备播放。', True
        try:
            binding = await room.binding(device)
            available = not binding['busy'] and not room.active
            if not available:
                detail = '正在处理或播放另一轮，请在结束后刷新状态。'
        except BridgeError as exc:
            detail, available = str(exc), False
        active = room.records.get(room.active)
        return {'token': service.token, 'device_id': device_id, 'device_name': device.name,
                'default_role': device.project, 'session_label': settings.session_label,
                'max_record_seconds': 30, 'asr_model_ready': Path(settings.model_path).is_dir(),
                'active_turn': active['id'] if active and active['device_id'] == device_id and active['client'] == client else None,
                'roles': [{'id': device.project, 'name': role.name, 'available': available,
                           'detail': detail, 'voice_label': voice_label(settings, role)}]}

    @app.post('/device/{device_id}/api/turn', status_code=202)
    async def submit(device_id: str, data: TurnInput, request: Request):
        return await room.submit(device_id, client_id(request), data)

    @app.get('/device/{device_id}/api/turn/{identifier}')
    async def status(device_id: str, identifier: str, request: Request):
        room.reap()
        record = room.get(device_id, identifier)
        return room.snapshot(record, client_id(request))

    @app.post('/device/{device_id}/api/turn/{identifier}/stop')
    async def stop(device_id: str, identifier: str, request: Request):
        return room.stop(device_id, identifier, client_id(request))

    @app.post('/device/{device_id}/api/turn/{identifier}/playback')
    async def playback(device_id: str, identifier: str, data: PlaybackInput, request: Request):
        return room.playback(device_id, identifier, client_id(request), data)

    @app.get('/device/{device_id}/api/turn/{identifier}/audio')
    async def audio(device_id: str, identifier: str, request: Request):
        return Response(room.audio(device_id, identifier, client_id(request)), media_type='audio/wav')

    @app.get('/device/{device_id}/api/turn/{identifier}/audio/chunks/{index}')
    async def chunk(device_id: str, identifier: str, index: int, request: Request):
        return Response(room.audio(device_id, identifier, client_id(request), index), media_type='audio/wav')

    @app.post('/device/{device_id}/api/transcribe')
    async def transcribe(device_id: str, request: Request):
        room.device(device_id)
        client_id(request)
        async with service.submit_lock:
            room.reap()
            if room.active or service.transcribing:
                raise HTTPException(409, '请等当前轮次结束后再录音。')
            service.transcribing = True
        started = time.monotonic()
        try:
            text = await asyncio.to_thread(service.speech.transcribe, await request.body())
            return {'text': text, 'elapsed_ms': round((time.monotonic() - started) * 1000)}
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(422, str(exc)) from None
        finally:
            service.transcribing = False

    static = Path(__file__).with_name('static')

    @app.get('/')
    async def index():
        return FileResponse(static / 'devices.html')

    @app.get('/favicon.ico')
    async def favicon():
        return Response(status_code=204)

    @app.get('/device/{device_id}')
    async def page(device_id: str):
        room.device(device_id)
        return FileResponse(static / 'index.html')

    app.mount('/static', StaticFiles(directory=static), name='static')
    return app
