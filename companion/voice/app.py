"""One local user, one in-flight turn, one audible answer at a time."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import time
from uuid import UUID
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .bridge import Bridge, BridgeError
from .settings import Settings
from .memory import SharedMemory
from .roles import Role, validate_roles, voice_label


class TurnInput(BaseModel):
    id: str
    project: str
    text: str = Field(min_length=1, max_length=6000)


class PlaybackInput(BaseModel):
    state: str
    position_seconds: float = Field(ge=0)
    duration_seconds: float = Field(ge=0)


def spoken_answer(text: str) -> str:
    """Keep a short spoken view; the complete original stays visible."""
    value = re.sub(r'\x60{3}.*?\x60{3}', '（代码请看屏幕）', text, flags=re.S)
    value = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', value)
    value = re.sub(r'https?://\S+', '（链接请看屏幕）', value)
    value = re.sub(r'<@!?\d+>', '', value)
    value = re.sub(r'(?m)^\s{0,3}#{1,6}\s+', '', value)
    value = value.replace('**', '').replace(chr(96), '').replace('[[', '（').replace(']]', '）').strip()
    if len(value) > 450:
        value = value[:450] + '。后面内容请看屏幕。'
    return value


class VoiceService:
    def __init__(self, settings: Settings, speech, bridge=None, roles=None):
        self.settings = settings
        self.check_bindings = roles is not None
        roster = validate_roles(roles if roles is not None else [Role(settings.project, settings.role_name)], settings)
        self.roles = {role.project: role for role in roster}
        self.submit_lock = asyncio.Lock()
        self.speech = speech
        self.bridge = bridge or Bridge(settings.bridge_socket)
        self.token = secrets.token_urlsafe(32)
        self.turns: dict[str, dict] = {}
        self.audio: dict[str, bytes] = {}
        self.tasks: set[asyncio.Task] = set()
        self.active: str | None = None
        self.transcribing = False
        self.last_turn: dict[str, str] = {}
        self.data_dir = Path(settings.data_dir).expanduser()
        self.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.memory = SharedMemory(settings.shared_memory_dir, settings.session_key)

    def record(self, event: str, value: dict):
        path = self.data_dir / 'events.jsonl'
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(json.dumps({'time': time.time(), 'event': event, **value}, ensure_ascii=False) + '\n')
        self.memory.append(event, value)

    def snapshot(self, turn: dict) -> dict:
        return {k: v for k, v in turn.items() if k not in {'prompt', 'started'} and not k.startswith('_')}

    def playback_context(self, project: str) -> str:
        previous = self.last_turn.get(project)
        if not previous or previous not in self.turns:
            return ''
        turn = self.turns[previous]
        feedback = turn.get('playback', {})
        state = feedback.get('state', 'not_started')
        if state == 'completed':
            detail = '上一条语音已完整播放。'
        elif state == 'not_started':
            detail = '上一条回答生成过，但没有收到音频播放确认。'
        else:
            detail = (f'上一条语音状态为{state}，播放位置约'
                      f'{feedback.get("position_seconds", 0):.1f}/'
                      f'{feedback.get("duration_seconds", 0):.1f}秒。')
        return ('[电脑语音播放反馈：' + detail +
                '这只表示设备播放状态，不保证用户实际听见或理解；不能精确推断听到哪些词。'
                '屏幕保留了完整回答。停止播放不代表取消后台任务。]\n')

    async def submit(self, data: TurnInput) -> dict:
        # Binding checks yield to I/O: hold admission until a turn is reserved,
        # so two simultaneous role submissions cannot both pass the busy check.
        async with self.submit_lock:
            return await self._submit(data)

    async def binding(self, project: str) -> dict:
        query = urlencode({'project': project, 'session_key': self.settings.session_key})
        result = await asyncio.to_thread(self.bridge.call, '/input/bindings?' + query)
        if (result.get('project') != project or result.get('session_key') != self.settings.session_key
                or not result.get('session_id') or not result.get('agent_session_id')
                or not isinstance(result.get('busy'), bool)):
            raise BridgeError('伙伴会话绑定未通过核对，本轮未发送。', 422)
        return result

    async def role_status(self, role: Role) -> dict:
        result = {'id': role.project, 'name': role.name, 'voice_label': voice_label(self.settings, role)}
        if self.check_bindings:
            try:
                binding = await self.binding(role.project)
                result.update(available=not binding['busy'],
                              status='busy' if binding['busy'] else 'bound',
                              detail='原会话正忙，请刷新状态。' if binding['busy'] else '已找到原会话；发送时严格核验续接。')
            except BridgeError as exc:
                result.update(available=False, status='unavailable', detail=str(exc))
        return result

    async def _submit(self, data: TurnInput) -> dict:
        try:
            UUID(data.id)
        except ValueError:
            raise HTTPException(400, '请求编号格式不正确。') from None
        if data.project not in self.roles:
            raise HTTPException(400, '该伙伴不在本机明确配置的名单中。')
        text = data.text.strip()
        if not text or text.startswith('/'):
            raise HTTPException(400, '请输入普通对话；管理命令请在 Discord 使用。')
        if data.id in self.turns:
            existing = self.turns[data.id]
            if existing['input_text'] != text or existing['project'] != data.project:
                raise HTTPException(409, '同一请求编号不能用于不同内容。')
            return self.snapshot(existing)
        if self.active:
            raise HTTPException(409, '上一条消息仍在处理，请先等它结束。停止播放不会取消任务。')
        binding = None
        if self.check_bindings:
            try:
                binding = await self.binding(data.project)
            except BridgeError as exc:
                raise HTTPException(422, '本轮未发送。' + str(exc)) from None
            if binding['busy']:
                raise HTTPException(409, '这位伙伴的原会话正忙；本轮未发送，也不会排队。')
        while len(self.turns) >= 20:
            oldest = next(iter(self.turns))
            self.turns.pop(oldest)
            self.audio.pop(oldest, None)
        turn = {'id': data.id, 'project': data.project, 'input_text': text,
                'status': 'thinking', 'text': '', 'spoken_text': '', 'error': '',
                'timings': {}, 'started': time.monotonic(),
                '_binding': binding,
                'role_name': self.roles[data.project].name,
                'voice_label': voice_label(self.settings, self.roles[data.project]),
                'prompt': self.playback_context(data.project) +
                '[用户从电脑语音入口发言，请接续当前会话，用适合朗读的简短中文回答。'
                '本轮结果由语音页面展示；不要另外用消息工具向Discord重复发送本轮对话。]\n' + text}
        try:
            self.record('submitted', self.snapshot(turn))
        except OSError:
            raise HTTPException(503, '共享记录无法写入，本轮尚未发送。请检查本机存储。') from None
        self.turns[data.id] = turn
        self.active = data.id
        task = asyncio.create_task(self.run(turn))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return self.snapshot(turn)

    async def run(self, turn: dict):
        request_id = 'voice-' + turn['id']
        try:
            body = {
                'request_id': request_id, 'project': turn['project'],
                'session_key': self.settings.session_key, 'text': turn['prompt'],
            }
            if expected := turn.get('_binding'):
                body.update(expected_session_id=expected['session_id'],
                            expected_agent_session_id=expected['agent_session_id'])
            try:
                await asyncio.to_thread(self.bridge.call, '/input', body)
            except BridgeError as exc:
                if exc.status < 500:
                    raise
                turn['notice'] = str(exc)
            while True:
                try:
                    result = await asyncio.to_thread(self.bridge.call, '/input/' + request_id)
                except BridgeError as exc:
                    if exc.status == 404:
                        raise BridgeError('桥接没有保存这条请求的回执。执行结果未知，请先在 Discord 核对，勿盲目重发。', 404) from None
                    turn['notice'] = '与桥接暂时断开，仍在等待原请求回执；不会重复投递。'
                    await asyncio.sleep(2)
                    continue
                if result.get('status') in {'completed', 'silent', 'failed', 'rejected'}:
                    break
                await asyncio.sleep(0.4)
            turn.pop('notice', None)
            turn['timings']['agent_ms'] = round((time.monotonic() - turn['started']) * 1000)
            turn['session_id'] = result.get('session_id', '')
            turn['agent_session_id'] = result.get('agent_session_id', '')
            expected = turn.get('_binding')
            if expected and (result.get('request_id') != request_id
                             or result.get('session_id') != expected['session_id']
                             or result.get('agent_session_id') != expected['agent_session_id']):
                raise BridgeError('原会话或回执编号发生变化；本轮不播放，请核对伙伴会话后再继续。', 422)
            if result['status'] != 'completed':
                raise BridgeError('伙伴本轮没有可播放的完整回答。原会话可能需要恢复或权限处理，请检查桥接状态。', 502)
            turn['text'] = result.get('text', '')
            if not turn['text'].strip():
                raise BridgeError('伙伴返回了空回答。', 502)
            turn['spoken_text'] = spoken_answer(turn['text'])
            turn['status'] = 'synthesizing'
            tts_start = time.monotonic()
            try:
                role = self.roles[turn['project']]
                options = {'voice': role.tts_voice} if role.tts_voice is not None else {}
                audio = await asyncio.to_thread(self.speech.synthesize, turn['spoken_text'], **options)
            except Exception:
                turn['status'] = 'error'
                turn['error'] = '文字回答已收到，但语音合成失败；请看文字，勿重复发送任务。'
            else:
                self.audio[turn['id']] = audio
                turn['audio_url'] = '/api/turn/' + turn['id'] + '/audio'
                turn['status'] = 'ready'
            turn['timings']['tts_ms'] = round((time.monotonic() - tts_start) * 1000)
        except BridgeError as exc:
            turn['status'] = 'error'
            turn['error'] = str(exc)
        except asyncio.CancelledError:
            turn['status'] = 'error'
            turn['error'] = '语音页面服务停止等待；原任务可能继续，请在 Discord 核对。'
            raise
        except Exception:
            turn['status'] = 'error'
            turn['error'] = '语音入口遇到错误；原任务可能已送达，请先核对 Discord。'
        finally:
            turn['timings']['total_ms'] = round((time.monotonic() - turn['started']) * 1000)
            self.active = None
            self.last_turn[turn['project']] = turn['id']
            try:
                self.record('finished', self.snapshot(turn))
            except OSError:
                turn['memory_warning'] = '共享记录保存失败，本轮可能无法被其他伙伴查到。'


def create_app(settings: Settings, speech=None, bridge=None, roles=None) -> FastAPI:
    if roles is not None:
        roles = validate_roles(roles, settings)
    if speech is None:
        from .speech import Speech
        tts = None
        if settings.tts_backend == 'qwen3':
            from .neural_tts import NeuralTTS
            tts = NeuralTTS(settings.tts_python, settings.tts_model_path, settings.tts_voice)
        speech = Speech(settings.model_path, settings.voice, tts=tts)
    service = VoiceService(settings, speech, bridge, roles)

    @asynccontextmanager
    async def lifespan(app):
        yield
        for task in list(service.tasks):
            task.cancel()
        await asyncio.gather(*service.tasks, return_exceptions=True)
        if hasattr(speech, 'close'):
            await asyncio.to_thread(speech.close)

    app = FastAPI(title='共栖 · 电脑语音', lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.service = service
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost'])

    @app.middleware('http')
    async def local_guard(request: Request, call_next):
        if request.method not in {'GET', 'HEAD'}:
            origin = request.headers.get('origin')
            allowed = {f'http://127.0.0.1:{settings.port}', f'http://localhost:{settings.port}'}
            if origin and origin not in allowed:
                return JSONResponse({'detail': '只接受本机语音页面的请求。'}, 403)
            if not hmac.compare_digest(request.headers.get('x-voice-token', ''), service.token):
                return JSONResponse({'detail': '页面已过期，请刷新后重试。'}, 403)
            limit = 1_000_000 if request.url.path == '/api/transcribe' else 32_000
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

    @app.get('/api/config')
    async def configuration():
        return {'roles': await asyncio.gather(*(service.role_status(role) for role in service.roles.values())),
                'default_role': settings.project, 'session_label': settings.session_label,
                'max_record_seconds': 30, 'token': service.token,
                'active_turn': service.active,
                'voice_label': voice_label(settings, service.roles[settings.project]),
                'asr_model_ready': Path(settings.model_path).is_dir()}

    @app.post('/api/transcribe')
    async def transcribe(request: Request):
        if service.transcribing or service.active:
            raise HTTPException(409, '上一条消息仍在处理，请稍后录音。')
        service.transcribing = True
        started = time.monotonic()
        try:
            body = await request.body()
            text = await asyncio.to_thread(service.speech.transcribe, body)
            return {'text': text, 'elapsed_ms': round((time.monotonic() - started) * 1000)}
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(422, str(exc)) from None
        except Exception:
            raise HTTPException(503, '本地识别失败，请检查语音依赖和模型配置。') from None
        finally:
            service.transcribing = False

    @app.post('/api/turn', status_code=202)
    async def submit(data: TurnInput):
        return await service.submit(data)

    def get_turn(turn_id):
        if turn_id not in service.turns:
            raise HTTPException(404, '该轮不在当前页面服务中；历史文字保存在本机共享语音记录。')
        return service.turns[turn_id]

    @app.get('/api/turn/{turn_id}')
    async def status(turn_id: str):
        return service.snapshot(get_turn(turn_id))

    @app.get('/api/turn/{turn_id}/audio')
    async def audio(turn_id: str):
        get_turn(turn_id)
        if turn_id not in service.audio:
            raise HTTPException(404, '本轮音频尚未就绪或合成失败。')
        return Response(service.audio[turn_id], media_type='audio/wav')

    @app.post('/api/turn/{turn_id}/playback')
    async def playback(turn_id: str, data: PlaybackInput):
        turn = get_turn(turn_id)
        if data.state not in {'playing', 'completed', 'stopped', 'failed'}:
            raise HTTPException(400, '播放状态不正确。')
        if not all(math.isfinite(v) for v in (data.position_seconds, data.duration_seconds)):
            raise HTTPException(400, '播放时间不正确。')
        if data.position_seconds > data.duration_seconds + 0.25:
            raise HTTPException(400, '播放位置超过总时长。')
        turn['playback'] = data.model_dump()
        service.record('playback', {'id': turn_id, 'project': turn['project'], **data.model_dump()})
        return {'ok': True}

    static = Path(__file__).with_name('static')

    @app.get('/')
    async def index():
        return FileResponse(static / 'index.html')

    @app.get('/favicon.ico')
    async def favicon():
        return Response(status_code=204)

    app.mount('/static', StaticFiles(directory=static, check_dir=False), name='static')
    return app
