"""Local desktop devices over the existing voice pipeline, without a second CLI call."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import io
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from uuid import UUID
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .app import TurnInput, PlaybackInput, build_service
from .bridge import BridgeError
from .devices import DeviceRegistry, RoutingError
from .roles import voice_label


DEFAULT_LEASE_SECONDS = 30.0
# A client can claim any duration; never let one receipt hold the room forever.
MAX_PLAYBACK_HOLD = 600.0


class DeviceRoom:
    """A room owns one turn through *playback*, not just through synthesis.

    Each page instance has a fresh client UUID. Refresh/duplicate tabs cannot
    take over or replay the previous page's audio.

    A device that disappears must not keep the shared slot forever, but silence
    is not proof that the turn ended: the lease expires the *slot* and records
    why, and the turn is reported as abandoned rather than completed. A missing
    receipt on a live device still keeps the room held.
    """

    def __init__(self, service, registry: DeviceRegistry, *, lease_seconds: float = DEFAULT_LEASE_SECONDS,
                 clock=time.monotonic):
        self.service, self.registry = service, registry
        self.lease_seconds = float(lease_seconds)
        self.clock = clock
        self.leases: dict[tuple[str, str], float] = {}
        # A playing receipt already promises future audio: hold the slot for the
        # remaining duration plus one lease, so a lost heartbeat cannot cut it.
        self.holds: dict[tuple[str, str], float] = {}
        if any(d.session_key != service.settings.session_key for d in registry.devices):
            raise ValueError('首版设备必须显式使用本实例的同一会话频道。')
        if any(d.project not in service.roles for d in registry.devices):
            raise ValueError('设备伙伴不在显式名单中。')
        self.bindings: dict[str, dict] = {}
        self.records: dict[str, dict] = {}
        self.active: str | None = None
        self.last_release: dict | None = None

    # -- lease ------------------------------------------------------------

    def touch(self, device_id: str, client: str) -> None:
        """Record that this client is alive right now."""
        self.leases[(device_id, client)] = self.clock()

    def lease(self, device_id: str, client: str) -> dict:
        last = self.leases.get((device_id, client))
        now = self.clock()
        remaining = None if last is None else max(0.0, self.lease_seconds - (now - last))
        held = self.holds.get((device_id, client))
        if held is not None:
            hold_remaining = max(0.0, held - now)
            remaining = hold_remaining if remaining is None else max(remaining, hold_remaining)
        return {'seconds': self.lease_seconds,
                'last_heartbeat_seconds': None if last is None else round(now - last, 3),
                'expires_in_seconds': None if remaining is None else round(remaining, 3)}

    def hold_for_playback(self, device_id: str, client: str, remaining_seconds: float) -> None:
        """Keep the slot for the audio this device has already promised to play.

        The page reports ``playing`` once and then sends nothing until the answer
        ends; without this hold a 45 s answer would look silent after 30 s.
        """
        key = (device_id, client)
        remaining = min(max(0.0, float(remaining_seconds)), MAX_PLAYBACK_HOLD)
        self.holds[key] = self.clock() + remaining + self.lease_seconds

    def release_hold(self, device_id: str, client: str) -> None:
        self.holds.pop((device_id, client), None)

    def _prune(self) -> None:
        """Forget long-dead clients so page reloads cannot grow the map forever."""
        horizon = self.clock() - self.lease_seconds * 2
        for key, last in list(self.leases.items()):
            if last < horizon and key not in self.holds:
                self.leases.pop(key, None)
        for key, until in list(self.holds.items()):
            if until < horizon:
                self.holds.pop(key, None)

    def _expire(self) -> None:
        """Release the slot of a client whose lease ran out; say why, out loud.

        Expiry is decided *before* pruning. Pruning first used to delete the
        active client's old lease, which then looked like a first sighting and
        restarted its clock -- a 61 s silence could hold the room forever.
        """
        now = self.clock()
        record = self.records.get(self.active) if self.active else None
        if record is not None and not record.get('completed'):
            key = (record['device_id'], record['client'])
            held = self.holds.get(key)
            if held is None or now >= held:
                last = self.leases.get(key)
                if last is None:
                    self.leases[key] = now  # First sighting starts the clock.
                elif now - last > self.lease_seconds:
                    self.abandon(record, now - last)
        self._prune()

    def abandon(self, record: dict, silent_for: float) -> dict:
        """Drop the held slot and record that the device stopped answering.

        Not a completion and not a user stop: the turn keeps its text in the
        shared record, its playback state becomes ``stopped``, and every later
        read reports ``abandoned`` with the reason instead of pretending the
        answer was heard.
        """
        reason = (f'设备 {silent_for:.0f} 秒没有心跳，占位已释放；'
                  '本轮没有播放完成确认，后台任务仍会收尾。')
        record['abandoned'] = True
        record['abandon_reason'] = reason
        record['stop_requested'] = True
        self.active = None
        self.release_hold(record['device_id'], record['client'])
        if record['id'] in self.service.turns:
            try:
                self.service.record_playback(record['id'], PlaybackInput(
                    state='stopped', position_seconds=0, duration_seconds=0))
            except HTTPException:
                pass
        self.last_release = {'turn_id': record['id'], 'device_id': record['device_id'],
                             'reason': 'lease-expired', 'detail': reason}
        # Written to the shared record too: a release must be auditable, not a
        # quiet deletion from the room.
        self.service.record('lease_expired', dict(self.last_release))
        return self.last_release

    def device(self, device_id):
        try:
            return self.registry.get(device_id)
        except RoutingError as exc:
            raise HTTPException(exc.status, str(exc)) from None

    def get(self, device_id, identifier, client=None):
        self.device(device_id)
        if client is not None:
            self.touch(device_id, client)
        record = self.records.get(identifier)
        if record is None or record['device_id'] != device_id:
            raise HTTPException(404, '这一轮不属于这台设备。')
        if client is not None and record['client'] != client:
            raise HTTPException(409, '本轮由另一个页面持有，请在原页面停止；不会接管或重播。')
        return record

    def reap(self):
        self._expire()
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
        # A stop acknowledgement is not a release: delivered CLI work keeps the slot.
        result['device_released'] = self.active != record['id']
        if record.get('abandoned'):
            result['abandoned'] = True
            result['abandon_reason'] = record.get('abandon_reason', '')
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
        self.touch(device_id, client)
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
            return {'id': identifier, 'status': 'stopped', 'playback_allowed': False,
                    'device_released': self.active != identifier}
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
            # Hold the slot through the rest of the promised audio.
            self.hold_for_playback(device_id, client,
                                   data.duration_seconds - data.position_seconds)
        elif data.state == 'completed':
            record['completed'] = True
            self.release_hold(device_id, client)
        elif data.state in {'stopped', 'failed'}:
            record['stop_requested'] = True
            record['stop_recorded'] = True
            self.release_hold(device_id, client)
        self.reap()
        return {'ok': True}


LOCAL_CLIENTS = frozenset({'127.0.0.1', '::1', 'localhost'})

def device_api_id(path: str) -> str | None:
    """Return the device id for /device/<id>/api/... paths, else None."""
    parts = path.split('/')
    if len(parts) >= 4 and parts[0] == '' and parts[1] == 'device' and parts[3] == 'api':
        return parts[2]
    return None

def create_device_app(settings, registry, *, speech=None, bridge=None, roles, host='127.0.0.1',
                      lease_seconds: float = DEFAULT_LEASE_SECONDS, clock=time.monotonic,
                      screen_dir=None):
    settings.validate()
    if not isinstance(host, str) or not host.strip():
        raise ValueError('必须显式指定监听地址。')
    host = host.strip()
    wildcard = host in {'0.0.0.0', '::'}
    if host not in LOCAL_CLIENTS:
        # A reachable entry without per-device credentials would let any host on
        # the LAN impersonate a partner's device. Refuse to start instead.
        registry.require_secrets()
    service = build_service(settings, speech, bridge, roles)
    if not isinstance(lease_seconds, (int, float)) or lease_seconds <= 0:
        raise ValueError('租约时长必须是正数秒。')
    room = DeviceRoom(service, registry, lease_seconds=lease_seconds, clock=clock)

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
    app.state.host = host
    # 0.0.0.0 cannot pin a Host header; the device secret is then the only gate.
    app.add_middleware(TrustedHostMiddleware,
                       allowed_hosts=['*'] if wildcard else sorted(LOCAL_CLIENTS | {host}))

    def is_local(request):
        client = request.client
        return bool(client) and client.host in LOCAL_CLIENTS

    @app.middleware('http')
    async def device_guard(request, call_next):
        local = is_local(request)
        device_id = device_api_id(request.url.path)
        authenticated = bool(device_id) and registry.authenticate(
            device_id, request.headers.get('x-device-secret', ''))
        if device_id is None and not local:
            # Pages, the device list and static files stay on the computer.
            return JSONResponse({'detail': '这个页面只在本机可用；设备请用 /device/<id>/api。'}, 403)
        if request.method in {'GET', 'HEAD'}:
            if not local and not authenticated:
                return JSONResponse({'detail': '设备凭据不正确。'}, 403)
        else:
            if not authenticated:
                allowed = {f'http://127.0.0.1:{settings.port}', f'http://localhost:{settings.port}'}
                if not wildcard:
                    allowed.add(f'http://{host}:{settings.port}')
                if not local:
                    return JSONResponse({'detail': '设备凭据不正确。'}, 403)
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
        local = is_local(request)
        room.touch(device_id, client)
        return {'token': service.token if local else '', 'auth': 'page-token' if local else 'device-secret',
                'lease': room.lease(device_id, client),
                'last_release': room.last_release,
                'device_id': device_id, 'device_name': device.name,
                'default_role': device.project, 'session_label': settings.session_label,
                'max_record_seconds': 30, 'asr_model_ready': Path(settings.model_path).is_dir(),
                'active_turn': active['id'] if active and active['device_id'] == device_id and active['client'] == client else None,
                'roles': [{'id': device.project, 'name': role.name, 'available': available,
                           'detail': detail, 'voice_label': voice_label(settings, role)}]}

    @app.post('/device/{device_id}/api/heartbeat')
    async def heartbeat(device_id: str, request: Request):
        device = room.device(device_id)
        client = client_id(request)
        room.touch(device_id, client)
        room.reap()
        active = room.records.get(room.active)
        return {'ok': True, 'device_id': device.device_id,
                'active_turn': active['id'] if active and active['client'] == client else None,
                'lease': room.lease(device_id, client),
                'last_release': room.last_release}

    @app.post('/device/{device_id}/api/turn', status_code=202)
    async def submit(device_id: str, data: TurnInput, request: Request):
        return await room.submit(device_id, client_id(request), data)

    @app.get('/device/{device_id}/api/turn/{identifier}')
    async def status(device_id: str, identifier: str, request: Request):
        room.reap()
        client = client_id(request)
        room.touch(device_id, client)
        record = room.get(device_id, identifier)
        return room.snapshot(record, client)

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

    # The round screen lives on the same origin as the API it drives: a page
    # opened from http.server or file:// cannot reach /device/<id>/api at all.
    # 大豆包 (#54) owns the page; this only serves whatever she drops here.
    screen_root = Path(screen_dir).expanduser() if screen_dir else static / 'screen'

    def screen_index(device_id: str) -> str:
        index = screen_root / 'index.html'
        if not index.is_file():
            raise HTTPException(404, '圆屏页面还没有安装：把 #54 构建出的 index.html 与资源放进 '
                                     'companion/voice/static/screen/ 后重启入口。')
        html = index.read_text(encoding='utf-8')
        # An inline bootstrap would be blocked by `script-src 'self'`. The
        # bootstrap therefore comes from this same-origin endpoint; the page's
        # own relative assets also need the final URL to end in `/screen/`.
        bootstrap = (f'<script src="/device/{device_id}/screen/__coqin_device.js"></script>')
        if '</head>' in html:
            return html.replace('</head>', bootstrap + '</head>', 1)
        return bootstrap + html

    @app.get('/device/{device_id}/screen')
    async def screen(device_id: str, request: Request):
        room.device(device_id)
        # `./app.js` must resolve under /screen/, not under /device/<id>/.
        target = request.url.replace(path=f'/device/{device_id}/screen/')
        return RedirectResponse(str(target), status_code=307)

    @app.get('/device/{device_id}/screen/__coqin_device.js')
    async def screen_bootstrap(device_id: str):
        room.device(device_id)
        payload = json.dumps({'id': device_id, 'api': f'/device/{device_id}/api'})
        return Response(f'window.__COQIN_DEVICE__={payload};',
                        media_type='application/javascript')

    @app.get('/device/{device_id}/screen/')
    async def screen_directory(device_id: str):
        room.device(device_id)
        return HTMLResponse(screen_index(device_id))

    @app.get('/device/{device_id}/screen/{asset:path}')
    async def screen_asset(device_id: str, asset: str):
        room.device(device_id)
        root = screen_root.resolve()
        target = (screen_root / asset).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise HTTPException(404, '页面资源不存在。')
        return FileResponse(target)

    app.mount('/static', StaticFiles(directory=static), name='static')
    return app
