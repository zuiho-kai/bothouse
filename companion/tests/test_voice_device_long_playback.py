"""C酱 的复现：电脑页面播长回答时，占位不能在播放中途被租约释放。

页面只在开始时报一次 playing，之后 45 秒内不再发请求；服务端必须按已承诺的
剩余播放时长续住租约，否则另一台设备会在同一时间开口。
"""
import asyncio
from uuid import uuid4
import httpx
from voice.device_app import create_device_app
from voice.devices import DeviceBinding, DeviceRegistry
from voice.roles import Role
from voice.settings import Settings
from test_voice_multi import Bridge
from test_voice_device_app import Speech

async def test_browser_page_playing_a_long_answer_keeps_its_slot(tmp_path):
    now = [1000.0]
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example', bridge_socket=str(tmp_path / 'a.sock'),
                        model_path=str(tmp_path), data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name, r.project, settings.session_key) for r in roles], roles)
    app = create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles, clock=lambda: now[0])
    token = app.state.service.token
    page = {'X-Voice-Token': token, 'X-Device-Client': str(uuid4())}
    other = {'X-Voice-Token': token, 'X-Device-Client': str(uuid4())}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8796') as c:
        tid = str(uuid4())
        await c.post('/device/desk-gge/api/turn', headers=page, json={'id': tid, 'project': 'gge', 'text': '讲个长故事'})
        await asyncio.gather(*app.state.service.tasks)
        snap = (await c.get(f'/device/desk-gge/api/turn/{tid}', headers=page)).json()
        for ch in snap['audio_chunks']:
            assert (await c.get(ch['audio_url'], headers=page)).status_code == 200
        await c.post(f'/device/desk-gge/api/turn/{tid}/playback', headers=page, json={'state': 'playing', 'position_seconds': 0, 'duration_seconds': 45})
        # The browser page sends nothing while a 45 s answer plays (app.js has no heartbeat).
        now[0] += 31
        # The other device may now *ask* (#33), but it must not get the sound:
        # one voice at a time still holds, and this answer is not abandoned.
        second = str(uuid4())
        r = await c.post('/device/desk-cursor/api/turn', headers=other,
                         json={'id': second, 'project': 'cursor', 'text': '我也说一句'})
        assert r.status_code == 202, 'the other device may form a new human turn while G哥 speaks'
        waiting = (await c.get(f'/device/desk-cursor/api/turn/{second}', headers=other)).json()
        assert waiting['playback_allowed'] is False and 'audio_url' not in waiting
        assert (await c.get(f'/device/desk-gge/api/turn/{tid}', headers=page)).json().get('abandoned') is None
        assert app.state.room.active == tid, 'slot released mid-playback: two voices would overlap'


async def test_hold_expires_after_the_announced_playback_ends(tmp_path):
    """The hold is not forever: once the promised audio is over, the slot frees."""
    now = [1000.0]
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'a.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name, r.project,
                                            settings.session_key) for r in roles], roles)
    app = create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles,
                            clock=lambda: now[0])
    page = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    other = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url='http://127.0.0.1:8796') as c:
        tid = str(uuid4())
        await c.post('/device/desk-gge/api/turn', headers=page,
                     json={'id': tid, 'project': 'gge', 'text': '讲个长故事'})
        await asyncio.gather(*app.state.service.tasks)
        snap = (await c.get(f'/device/desk-gge/api/turn/{tid}', headers=page)).json()
        for chunk in snap['audio_chunks']:
            await c.get(chunk['audio_url'], headers=page)
        await c.post(f'/device/desk-gge/api/turn/{tid}/playback', headers=page,
                     json={'state': 'playing', 'position_seconds': 0, 'duration_seconds': 45})
        # 45 s of audio + one 30 s lease of slack, then the slot is free again.
        now[0] += 44
        assert app.state.room.active == tid, 'the hold must outlast the announced audio'
        now[0] += 32
        # Past the promise the held slot expires with an explicit reason.
        abandoned = (await c.get(f'/device/desk-gge/api/turn/{tid}', headers=page)).json()
        assert abandoned['abandoned'] is True and '心跳' in abandoned['abandon_reason']
        assert app.state.room.active is None
        assert (await c.post('/device/desk-cursor/api/turn', headers=other,
                             json={'id': str(uuid4()), 'project': 'cursor', 'text': '该我了'})).status_code == 202

async def test_progress_receipts_extend_the_hold_as_playback_advances(tmp_path):
    now = [1000.0]
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'a.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name, r.project,
                                            settings.session_key) for r in roles], roles)
    app = create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles,
                            clock=lambda: now[0])
    page = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url='http://127.0.0.1:8796') as c:
        tid = str(uuid4())
        await c.post('/device/desk-gge/api/turn', headers=page,
                     json={'id': tid, 'project': 'gge', 'text': '讲个长故事'})
        await asyncio.gather(*app.state.service.tasks)
        snap = (await c.get(f'/device/desk-gge/api/turn/{tid}', headers=page)).json()
        for chunk in snap['audio_chunks']:
            await c.get(chunk['audio_url'], headers=page)
        now[0] += 20
        await c.post(f'/device/desk-gge/api/turn/{tid}/playback', headers=page,
                     json={'state': 'playing', 'position_seconds': 20, 'duration_seconds': 60})
        now[0] += 50  # still inside 40 s remaining + 30 s lease
        assert app.state.room.active == tid
        assert (await c.get(f'/device/desk-gge/api/config', headers=page)).json()['active_turn'] == tid

async def test_an_absurd_claimed_duration_cannot_hold_the_room_forever(tmp_path):
    now = [1000.0]
    roles = (Role('gge', 'G哥', 'uncle_fu'), Role('cursor', 'Cursor', 'serena'))
    settings = Settings(project='gge', role_name='G哥', session_key='discord:example',
                        bridge_socket=str(tmp_path / 'a.sock'), model_path=str(tmp_path),
                        data_dir=str(tmp_path / 'data'), shared_memory_dir=str(tmp_path / 'memory'),
                        tts_backend='qwen3', port=8796)
    devices = DeviceRegistry([DeviceBinding('desk-' + r.project, r.name, r.project,
                                            settings.session_key) for r in roles], roles)
    app = create_device_app(settings, devices, speech=Speech(), bridge=Bridge(), roles=roles,
                            clock=lambda: now[0])
    page = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    other = {'X-Voice-Token': app.state.service.token, 'X-Device-Client': str(uuid4())}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url='http://127.0.0.1:8796') as c:
        tid = str(uuid4())
        await c.post('/device/desk-gge/api/turn', headers=page,
                     json={'id': tid, 'project': 'gge', 'text': '想占住房间'})
        await asyncio.gather(*app.state.service.tasks)
        snap = (await c.get(f'/device/desk-gge/api/turn/{tid}', headers=page)).json()
        for chunk in snap['audio_chunks']:
            await c.get(chunk['audio_url'], headers=page)
        await c.post(f'/device/desk-gge/api/turn/{tid}/playback', headers=page,
                     json={'state': 'playing', 'position_seconds': 0, 'duration_seconds': 10 ** 9})
        now[0] += 600 + 30 + 1
        assert (await c.post('/device/desk-cursor/api/turn', headers=other,
                             json={'id': str(uuid4()), 'project': 'cursor', 'text': '轮到我'})).status_code == 202
