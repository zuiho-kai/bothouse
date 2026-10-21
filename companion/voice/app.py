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
import threading
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
from .discussion import Discussions, DiscussionInput, AdvanceInput
from .speech import _pcm_samples
from .recognition import prewarm, transcribe_request
from .prompt import SPOKEN_REPLY_GUIDANCE


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
        roster = validate_roles(roles if roles is not None else [Role(
            settings.project, settings.role_name,
            relay_project=settings.project if settings.require_isolated_voice else '')], settings)
        self.roles = {role.project: role for role in roster}
        self.submit_lock = asyncio.Lock()
        self.speech = speech
        self.bridge = bridge or Bridge(settings.bridge_socket)
        self.token = secrets.token_urlsafe(32)
        self.turns: dict[str, dict] = {}
        self.audio: dict[str, bytes] = {}
        self.audio_chunks: dict[str, list[bytes]] = {}
        self.tasks: set[asyncio.Task] = set()
        self.active: str | None = None
        self.transcribing = False
        self.last_turn: dict[str, str] = {}
        self.discussions = Discussions(self)
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
        result = {k: v for k, v in turn.items() if k not in {'prompt', 'started'} and not k.startswith('_')}
        if 'audio_chunks' in result:
            result['audio_chunks'] = [dict(chunk) for chunk in result['audio_chunks']]
        result['timings'] = dict(result.get('timings', {}))
        return result

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

    async def binding(self, project: str, scope: str = "desktop") -> dict:
        if self.roles[project].relay_project:
            from .relay import relay_binding
            return await relay_binding(self, project, scope)
        query = urlencode({'project': project, 'session_key': self.settings.session_key})
        result = await asyncio.to_thread(self.bridge.call, '/input/bindings?' + query)
        if (result.get('project') != project or result.get('session_key') != self.settings.session_key
                or not result.get('session_id') or not result.get('agent_session_id')
                or not isinstance(result.get('busy'), bool)):
            raise BridgeError('伙伴会话绑定未通过核对，本轮未发送。', 422)
        return result

    async def role_status(self, role: Role) -> dict:
        result = {'id': role.project, 'name': role.name, 'voice_label': voice_label(self.settings, role)}
        if self.check_bindings or role.relay_project:
            try:
                binding = await self.binding(role.project)
                result.update(available=not binding['busy'],
                              status='busy' if binding['busy'] else 'bound',
                              detail=('独立语音会话正忙。' if binding['busy'] else '将使用独立语音会话。')
                              if role.relay_project else
                              ('原会话正忙，请刷新状态。' if binding['busy'] else '已找到原会话；发送时严格核验续接。'))
            except BridgeError as exc:
                result.update(available=False, status='unavailable', detail=str(exc))
        return result

    async def discussion_turn(self, identifier, project, topic, context, binding, metadata):
        await self._submit(TurnInput(id=identifier, project=project, text=topic),
                           expected_binding=binding, discussion=metadata, context=context)
        return self.turns[identifier]

    async def _submit(self, data: TurnInput, *, expected_binding=None, discussion=None, context='', device=None) -> dict:
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
        if self.discussions.active and (not discussion or discussion['discussion_id'] != self.discussions.active):
            raise HTTPException(409, '讨论正在进行，请先结束讨论再单独发言。')
        if self.active or self.transcribing:
            raise HTTPException(409, '上一条消息仍在处理，请先等它结束。停止播放不会取消任务。')
        binding = None
        if self.check_bindings or self.roles[data.project].relay_project:
            try:
                if self.roles[data.project].relay_project:
                    binding = await self.binding(data.project, device["device_id"] if device else "desktop")
                else:
                    binding = await self.binding(data.project)
            except BridgeError as exc:
                raise HTTPException(422, '本轮未发送。' + str(exc)) from None
            if binding['busy']:
                raise HTTPException(409, '这位伙伴的原会话正忙；本轮未发送，也不会排队。')
            if expected_binding and any(binding[k] != expected_binding.get(k)
                                        for k in (('relay_key',) if 'relay_key' in binding else ('session_id', 'agent_session_id'))):
                raise HTTPException(409, '伙伴会话已变更，讨论停止；本轮尚未发送。')
        if discussion and self.discussions.get(discussion['discussion_id'])['stop_requested']:
            raise HTTPException(409, '已停止讨论，本轮尚未发送。')
        if device and device['stop_requested']:
            raise HTTPException(409, '设备已停止本轮，本轮尚未发送。')
        while len(self.turns) >= 20:
            oldest = next(iter(self.turns))
            self.turns.pop(oldest)
            self.audio.pop(oldest, None)
            self.audio_chunks.pop(oldest, None)
        turn = {'id': data.id, 'project': data.project, 'input_text': text,
                'status': 'thinking', 'text': '', 'spoken_text': '', 'error': '',
                'timings': {}, 'started': time.monotonic(),
                '_binding': binding,
                'role_name': self.roles[data.project].name,
                'voice_label': voice_label(self.settings, self.roles[data.project]),
                'prompt': self.playback_context(data.project) +
                '[用户从电脑语音入口发言，请接续当前会话。' + SPOKEN_REPLY_GUIDANCE +
                '本轮结果由语音页面展示；不要另外用消息工具向Discord重复发送本轮对话。]\n' + (context or text)}
        if discussion:
            turn.update(discussion)
        if device:
            turn.update(device_id=device['device_id'], audio_target=device['device_id'], _device=device)
        try:
            self.record('submitted', self.snapshot(turn))
        except OSError:
            raise HTTPException(503, '共享记录无法写入，本轮尚未发送。请检查本机存储。') from None
        self.turns[data.id] = turn
        self.active = data.id
        task = asyncio.create_task(self.run(turn))
        turn['_task'] = task
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return self.snapshot(turn)

    def discussion_stopped(self, turn: dict) -> bool:
        return bool(turn.get('discussion_id') and
                    self.discussions.get(turn['discussion_id'])['stop_requested'])

    def output_stopped(self, turn: dict) -> bool:
        return self.discussion_stopped(turn) or bool(turn.get('_device', {}).get('stop_requested'))

    async def synthesize_stream(self, turn: dict, options: dict, *, text=None, append=False) -> bytes:
        """Publish immutable chunks on the event loop while the worker continues."""
        loop = asyncio.get_running_loop()
        accepting = threading.Event()
        accepting.set()
        received: list[tuple[bytes, int]] = []
        total_bytes, total_frames = 0, 0
        if not append or 'audio_chunks' not in turn:
            turn.update(audio_chunks=[], audio_complete=False)
            self.audio_chunks[turn['id']] = []
        base_index = len(turn['audio_chunks'])
        existing_frames = sum(round(c['duration_seconds'] * 24000) for c in turn['audio_chunks'])

        def publish(index, audio, frames):
            if (not accepting.is_set() or turn['status'] != 'synthesizing'
                    or self.output_stopped(turn)):
                return
            if index < len(turn['audio_chunks']):
                return
            self.audio_chunks[turn['id']].append(audio)
            turn['audio_chunks'].append({
                'index': index, 'audio_url': f"/api/turn/{turn['id']}/audio/chunks/{index}",
                'duration_seconds': frames / 24000,
            })
            if text is not None and index == base_index:
                turn['audio_chunks'][-1]['text'] = text
            if index == 0:
                turn['timings']['tts_first_chunk_ms'] = round((time.monotonic() - turn['_tts_started']) * 1000)

        def receive(audio):
            nonlocal total_bytes, total_frames
            if not accepting.is_set():
                raise RuntimeError('stream consumer closed')
            frames = len(_pcm_samples(audio, rate=24000, max_bytes=15_000_000, max_seconds=300))
            total_bytes += len(audio)
            total_frames += frames
            if base_index + len(received) >= 512 or total_bytes > 15_000_000 or existing_frames + total_frames > 24000 * 300:
                raise ValueError('stream exceeds bounds')
            index = base_index + len(received)
            received.append((audio, frames))
            loop.call_soon_threadsafe(publish, index, audio, frames)

        try:
            audio = await asyncio.to_thread(self.speech.synthesize_stream, turn['spoken_text'] if text is None else text, receive, **options)
            frames = len(_pcm_samples(audio, rate=24000, max_bytes=15_000_000, max_seconds=300))
            if not received or frames != total_frames:
                raise ValueError('incomplete stream')
            # Drain any already-delivered callbacks before exposing completion.
            for index in range(len(turn['audio_chunks']) - base_index, len(received)):
                publish(base_index + index, *received[index])
            return audio
        finally:
            # A cancelled task cannot publish late worker data into a new turn.
            accepting.clear()

    async def run(self, turn: dict):
        request_id = 'voice-' + turn['id']
        sentences = None
        try:
            if turn.get('_device', {}).get('stop_requested'):
                turn.update(status='stopped')
                return
            if turn.get('discussion_id') and self.discussions.get(turn['discussion_id'])['stop_requested']:
                turn.update(status='error', error='已停止讨论，本轮尚未发送。')
                return
            if self.roles[turn['project']].relay_project:
                from .relay import relay_turn
                result = await relay_turn(self, turn, request_id)
            else:
                body = {
                    'request_id': request_id, 'project': turn['project'],
                    'session_key': self.settings.session_key, 'text': turn['prompt'],
                }
                if expected := turn.get('_binding'):
                    body.update(expected_session_id=expected['session_id'],
                                expected_agent_session_id=expected['agent_session_id'])
                if (self.settings.sentence_stream and expected and
                        callable(getattr(self.speech, 'synthesize_stream', None))):
                    from .sentence_stream import SentenceSpeech
                    role = self.roles[turn['project']]
                    options = {'voice': role.tts_voice} if role.tts_voice is not None else {}
                    sentences = SentenceSpeech(self, turn, request_id, options)
                    body['stream'] = True
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
                    if sentences:
                        await sentences.feed(result)
                    await asyncio.sleep(0.4)
            turn.pop('notice', None)
            turn['timings']['agent_ms'] = round((time.monotonic() - turn['started']) * 1000)
            turn['session_id'] = result.get('session_id', '')
            turn['agent_session_id'] = result.get('agent_session_id', '')
            expected = turn.get('_binding')
            if expected and 'relay_key' not in expected and (result.get('request_id') != request_id
                             or result.get('session_id') != expected['session_id']
                             or result.get('agent_session_id') != expected['agent_session_id']):
                raise BridgeError('原会话或回执编号发生变化；本轮不播放，请核对伙伴会话后再继续。', 422)
            if result['status'] != 'completed':
                raise BridgeError('伙伴本轮没有可播放的完整回答。原会话可能需要恢复或权限处理，请检查桥接状态。', 502)
            turn['text'] = result.get('text', '')
            if not turn['text'].strip():
                raise BridgeError('伙伴返回了空回答。', 502)
            if turn.get('_device', {}).get('stop_requested'):
                turn.update(status='stopped')
                return
            if sentences:
                await sentences.feed(result, final=True)
                audio = await sentences.finish()
                if sentences.blocked:
                    turn['speech_truncated'] = True
                    if audio is None:
                        raise BridgeError('回答包含不适合逐句朗读的内容，请查看文字结果。', 422)
                if audio is not None:
                    self.audio[turn['id']] = audio
                    turn.update(audio_url='/api/turn/' + turn['id'] + '/audio',
                                status='stopped' if self.output_stopped(turn) else 'ready',
                                audio_complete=not self.output_stopped(turn))
                    turn['timings']['tts_ms'] = round((time.monotonic()-turn['_tts_started'])*1000)
                    return
            turn['spoken_text'] = spoken_answer(turn['text'])
            turn['status'] = 'synthesizing'
            tts_start = time.monotonic()
            turn['_tts_started'] = tts_start
            try:
                role = self.roles[turn['project']]
                options = {'voice': role.tts_voice} if role.tts_voice is not None else {}
                if callable(getattr(self.speech, 'synthesize_stream', None)):
                    audio = await self.synthesize_stream(turn, options)
                else:
                    audio = await asyncio.to_thread(self.speech.synthesize, turn['spoken_text'], **options)
            except Exception:
                turn['status'] = 'error'
                turn['error'] = '文字回答已收到，但语音合成失败；请看文字，勿重复发送任务。'
            else:
                self.audio[turn['id']] = audio
                turn['audio_url'] = '/api/turn/' + turn['id'] + '/audio'
                turn['status'] = 'stopped' if turn.get('_device', {}).get('stop_requested') else 'ready'
                if 'audio_chunks' in turn:
                    turn['audio_complete'] = not self.output_stopped(turn)
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
            if sentences:
                await sentences.close()
            turn['timings']['total_ms'] = round((time.monotonic() - turn['started']) * 1000)
            self.active = None
            self.last_turn[turn['project']] = turn['id']
            try:
                self.record('finished', self.snapshot(turn))
            except OSError:
                turn['memory_warning'] = '共享记录保存失败，本轮可能无法被其他伙伴查到。'


    def record_playback(self, turn_id: str, data: PlaybackInput):
        turn = self.turns.get(turn_id)
        if turn is None:
            raise HTTPException(404, '没有找到这一轮。')
        if data.state not in {'playing', 'completed', 'stopped', 'failed'}:
            raise HTTPException(400, '播放状态不正确。')
        if not all(math.isfinite(v) for v in (data.position_seconds, data.duration_seconds)):
            raise HTTPException(400, '播放时间不正确。')
        if data.position_seconds > data.duration_seconds + 0.25:
            raise HTTPException(400, '播放位置超过总时长。')
        if data.state in {'playing', 'completed'}:
            if self.discussion_stopped(turn) or turn['status'] not in {'synthesizing', 'ready'}:
                raise HTTPException(409, '本轮尚无可播放音频，或讨论已停止。')
            if data.state == 'playing' and turn['status'] != 'ready' and not turn.get('audio_chunks'):
                raise HTTPException(409, '本轮尚无可播放音频。')
            if data.state == 'completed' and turn['status'] != 'ready':
                raise HTTPException(409, '语音尚未完整生成，不能报告完成。')
        if 'audio_chunks' in turn:
            if data.state == 'completed':
                duration = sum(c['duration_seconds'] for c in turn['audio_chunks'])
                tolerance = min(.25, duration * .01)
                if (turn['status'] != 'ready' or not turn['audio_complete']
                        or abs(data.duration_seconds - duration) > tolerance
                        or abs(data.position_seconds - duration) > tolerance):
                    raise HTTPException(409, '语音尚未完整生成或播放，不能报告完成。')
        if data.state == 'playing' and '_tts_started' in turn and 'first_playback_ms' not in turn['timings']:
            now = time.monotonic()
            turn['timings']['first_playback_ms'] = round((now - turn['started']) * 1000)
            turn['timings']['tts_to_playback_ms'] = round((now - turn['_tts_started']) * 1000)
        turn['playback'] = data.model_dump()
        self.record('playback', {'id': turn_id, 'project': turn['project'],
                                  **{k: turn[k] for k in ('discussion_id', 'phase', 'round', 'device_id', 'audio_target') if k in turn},
                                  **data.model_dump(), 'timings': dict(turn['timings'])})
        return {'ok': True}


def build_service(settings: Settings, speech=None, bridge=None, roles=None) -> VoiceService:
    if roles is not None:
        roles = validate_roles(roles, settings)
    if speech is None:
        from .speech import Speech
        tts = None
        if settings.tts_backend == 'qwen3':
            from .neural_tts import NeuralTTS
            tts = NeuralTTS(settings.tts_python, settings.tts_model_path, settings.tts_voice)
        if settings.tts_backend == 'volc':
            from .volc_tts import VolcTTS
            tts = VolcTTS(settings.tts_volc_credentials, default_voice=settings.tts_voice)
        elif settings.tts_volc_credentials:
            from .volc_tts import HybridTTS, VolcTTS
            tts = HybridTTS(tts, VolcTTS(settings.tts_volc_credentials))
        speech = Speech(settings.model_path, settings.voice, tts=tts)
    return VoiceService(settings, speech, bridge, roles)


def create_app(settings: Settings, speech=None, bridge=None, roles=None) -> FastAPI:
    service = build_service(settings, speech, bridge, roles)
    speech = service.speech

    @asynccontextmanager
    async def lifespan(app):
        await prewarm(speech, settings.asr_prewarm)
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
            upload_started = time.monotonic()
            async for part in request.stream():
                body.extend(part)
                if len(body) > limit:
                    return JSONResponse({'detail': '输入过长；录音最多30秒。'}, 413)
            request._body = bytes(body)
            request.state.upload_ms = round((time.monotonic() - upload_started) * 1000)
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
                'active_discussion': service.discussions.active,
                'last_discussion': service.discussions.last,
                'voice_label': voice_label(settings, service.roles[settings.project]),
                'asr_model_ready': Path(settings.model_path).is_dir()}

    @app.post('/api/transcribe')
    async def transcribe(request: Request):
        async with service.submit_lock:
            if service.transcribing or service.active or service.discussions.active:
                raise HTTPException(409, '上一条消息仍在处理，请稍后录音。')
            service.transcribing = True
        try:
            return await transcribe_request(service.speech, request)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(422, str(exc)) from None
        except Exception:
            raise HTTPException(503, '本地识别失败，请检查语音依赖和模型配置。') from None
        finally:
            service.transcribing = False

    @app.post('/api/turn', status_code=202)
    async def submit(data: TurnInput):
        return await service.submit(data)

    @app.post('/api/discussion', status_code=202)
    async def start_discussion(data: DiscussionInput):
        return await service.discussions.start(data)

    @app.get('/api/discussion/{identifier}')
    async def discussion_status(identifier: str):
        return service.discussions.snapshot(service.discussions.get(identifier))

    @app.post('/api/discussion/{identifier}/advance')
    async def advance_discussion(identifier: str, data: AdvanceInput):
        return await service.discussions.advance(identifier, data)

    @app.post('/api/discussion/{identifier}/stop')
    async def stop_discussion(identifier: str):
        return await service.discussions.stop(identifier)

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

    @app.get('/api/turn/{turn_id}/audio/chunks/{index}')
    async def audio_chunk(turn_id: str, index: int):
        turn = get_turn(turn_id)
        chunks = service.audio_chunks.get(turn_id, [])
        if (turn['status'] not in {'synthesizing', 'ready'} or service.discussion_stopped(turn)
                or not 0 <= index < len(chunks)):
            raise HTTPException(404, '本段音频尚未就绪或本轮合成失败。')
        return Response(chunks[index], media_type='audio/wav')

    @app.post('/api/turn/{turn_id}/playback')
    async def playback(turn_id: str, data: PlaybackInput):
        return service.record_playback(turn_id, data)

    static = Path(__file__).with_name('static')

    @app.get('/')
    async def index():
        return FileResponse(static / 'index.html')

    @app.get('/discussion')
    async def discussion_page():
        return FileResponse(static / 'discussion.html')

    @app.get('/favicon.ico')
    async def favicon():
        return Response(status_code=204)

    app.mount('/static', StaticFiles(directory=static, check_dir=False), name='static')
    return app
