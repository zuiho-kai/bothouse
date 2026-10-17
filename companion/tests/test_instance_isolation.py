"""Tests for #2: removing legacy path/role defaults and isolating independent instances."""
from __future__ import annotations

import asyncio
from datetime import datetime
import json
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest

import autonomy.__main__ as autonomy_cli
from autonomy.__main__ import Runner, initialize as init_autonomy, install, read_config, validate as validate_autonomy
from voice.app import create_app
from voice.settings import DEFAULT_CONFIG as VOICE_DEFAULT_CONFIG, Settings, default_config_path, initialize as init_voice


TZ = ZoneInfo('Asia/Shanghai')
NOW = datetime(2026, 10, 17, 12, 0, 15, tzinfo=TZ)


class SpeechStub:
    def __init__(self, tag: str):
        self.tag = tag
        self.spoken: list[str] = []

    def transcribe(self, audio: bytes) -> str:
        return f'{self.tag}:{audio.decode()}'

    def synthesize(self, text: str, **kwargs) -> bytes:
        self.spoken.append(text)
        return f'WAV-{self.tag}-{text}'.encode()


class BridgeStub:
    def __init__(self, tag: str):
        self.tag = tag
        self.calls: list[tuple[str, dict | None]] = []

    def call(self, path: str, body: dict | None = None) -> dict:
        self.calls.append((path, body))
        if body is not None:
            return {'status': 'running'}
        req_id = path.rsplit('/', 1)[-1]
        return {
            'request_id': req_id,
            'status': 'completed',
            'text': f'{self.tag}已完成响应。',
            'session_id': f'{self.tag}-session',
            'agent_session_id': f'{self.tag}-cli',
        }


def _make_fake_model(root: Path) -> Path:
    snapshot = root / '.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/snapshots/snap-1'
    snapshot.mkdir(parents=True, exist_ok=True)
    (snapshot / 'config.json').write_text('{}', encoding='utf-8')
    (snapshot / 'weights.safetensors').write_bytes(b'weights')
    return snapshot


def test_no_legacy_paths_or_channels_in_defaults_or_examples():
    assert 'cc-connect-maomao' not in str(VOICE_DEFAULT_CONFIG)
    assert 'cc-connect-maomao' not in str(autonomy_cli.DEFAULT_CONFIG)
    blank = Settings()
    for field in ('project', 'role_name', 'session_key', 'bridge_socket', 'model_path', 'data_dir', 'shared_memory_dir'):
        assert getattr(blank, field) == ''

    examples_dir = Path(__file__).resolve().parents[1] / 'examples'
    example_files = sorted(examples_dir.glob('*.example.json'))
    assert len(example_files) >= 3
    for example in example_files:
        raw = example.read_text(encoding='utf-8')
        assert 'cc-connect-maomao' not in raw
        assert '1560320196239953953' not in raw
        assert 'agents-demo' not in raw
        parsed = json.loads(raw)
        if example.name.startswith('voice-config'):
            settings = Settings(**parsed).validate()
            assert settings.project in {'gge', 'cursor'}
        elif example.name.startswith('autonomy-config'):
            validated = validate_autonomy(parsed)
            assert validated['leader'] == 'gge'


def test_voice_missing_bindings_fail_closed_without_writing_files(tmp_path, monkeypatch):
    fake_home = tmp_path / 'empty-home'
    fake_home.mkdir()
    monkeypatch.setenv('HOME', str(fake_home))
    monkeypatch.delenv('VOICE_CONFIG', raising=False)
    monkeypatch.delenv('CONEST_HOME', raising=False)

    # Unconfigured initialize must fail before touching disk or looking up models.
    target_cfg = default_config_path()
    with pytest.raises(ValueError, match='缺少初始化必填绑定'):
        init_voice()
    assert not target_cfg.exists()
    assert not (fake_home / '.cc-connect-maomao').exists()

    # Missing config file on Settings.read raises actionable FileNotFoundError.
    with pytest.raises(FileNotFoundError, match='未找到语音实例配置文件'):
        Settings.read(tmp_path / 'missing-voice.json')

    # Partial config missing any required binding must fail closed and never fall back to legacy values.
    complete = {
        'project': 'cursor',
        'role_name': 'Cursor',
        'session_key': 'discord:20001',
        'bridge_socket': str(tmp_path / 'cursor/api.sock'),
        'model_path': str(tmp_path / 'model'),
        'data_dir': str(tmp_path / 'cursor/voice'),
        'shared_memory_dir': str(tmp_path / 'cursor/memory'),
    }
    for required_key in complete:
        partial_path = tmp_path / f'partial-{required_key}.json'
        partial = dict(complete)
        partial.pop(required_key)
        partial_path.write_text(json.dumps(partial), encoding='utf-8')
        with pytest.raises(ValueError, match=required_key):
            Settings.read(partial_path)


def test_voice_init_in_temp_home_isolates_paths_and_supports_non_gge_roles(tmp_path, monkeypatch):
    fake_home = tmp_path / 'isolated-home'
    fake_home.mkdir()
    model_dir = _make_fake_model(fake_home)
    monkeypatch.setenv('HOME', str(fake_home))
    monkeypatch.delenv('VOICE_CONFIG', raising=False)
    monkeypatch.delenv('CONEST_HOME', raising=False)
    monkeypatch.setenv('VOICE_PROJECT', 'cursor')
    monkeypatch.setenv('VOICE_ROLE_NAME', 'Cursor')
    monkeypatch.setenv('VOICE_SESSION_KEY', 'discord:88888888')
    monkeypatch.setenv('VOICE_PORT', '8788')

    settings = init_voice()
    expected_cfg = fake_home / '.conest/voice/config.json'
    assert expected_cfg.is_file()
    assert expected_cfg.stat().st_mode & 0o777 == 0o600
    assert settings.project == 'cursor'
    assert settings.role_name == 'Cursor'
    assert settings.session_key == 'discord:88888888'
    assert settings.port == 8788
    assert settings.model_path == str(model_dir)
    assert settings.data_dir == str(fake_home / '.conest/voice')
    assert settings.shared_memory_dir == str(fake_home / '.conest/shared-memory')
    assert settings.bridge_socket == str(fake_home / '.conest/data/run/api.sock')
    assert not (fake_home / '.cc-connect-maomao').exists()

    # Re-reading from disk returns the exact same isolated settings.
    reloaded = Settings.read(expected_cfg)
    assert reloaded == settings


async def test_two_independent_voice_instances_do_not_interfere(tmp_path):
    cfg_gge_path = tmp_path / 'instance-gge/voice/config.json'
    cfg_cursor_path = tmp_path / 'instance-cursor/voice/config.json'

    settings_gge = init_voice(
        cfg_gge_path,
        project='gge',
        role_name='G哥',
        session_key='discord:11111111',
        session_label='G哥频道',
        model_path=str(tmp_path / 'shared-whisper'),
        port=8787,
    )
    settings_cursor = init_voice(
        cfg_cursor_path,
        project='cursor',
        role_name='Cursor',
        session_key='discord:22222222',
        session_label='Cursor频道',
        model_path=str(tmp_path / 'shared-whisper'),
        port=8788,
    )

    bridge_gge, speech_gge = BridgeStub('gge'), SpeechStub('gge')
    bridge_cursor, speech_cursor = BridgeStub('cursor'), SpeechStub('cursor')

    app_gge = create_app(Settings.read(cfg_gge_path), speech_gge, bridge_gge)
    app_cursor = create_app(Settings.read(cfg_cursor_path), speech_cursor, bridge_cursor)

    client_gge = httpx.AsyncClient(transport=httpx.ASGITransport(app=app_gge), base_url='http://127.0.0.1:8787')
    client_cursor = httpx.AsyncClient(transport=httpx.ASGITransport(app=app_cursor), base_url='http://127.0.0.1:8788')
    headers_gge = {'X-Voice-Token': app_gge.state.service.token}
    headers_cursor = {'X-Voice-Token': app_cursor.state.service.token}

    turn_gge = {'id': str(uuid4()), 'project': 'gge', 'text': 'G哥你好'}
    turn_cursor = {'id': str(uuid4()), 'project': 'cursor', 'text': 'Cursor你好'}

    async with client_gge, client_cursor:
        # Cross-instance tokens and cross-instance project names must be rejected.
        assert (await client_gge.post('/api/turn', headers=headers_cursor, json=turn_gge)).status_code == 403
        assert (await client_gge.post('/api/turn', headers=headers_gge, json=turn_cursor)).status_code == 400
        assert (await client_cursor.post('/api/turn', headers=headers_cursor, json=turn_gge)).status_code == 400

        r1 = await client_gge.post('/api/turn', headers=headers_gge, json=turn_gge)
        r2 = await client_cursor.post('/api/turn', headers=headers_cursor, json=turn_cursor)
        assert r1.status_code == 202 and r2.status_code == 202

        await asyncio.gather(*app_gge.state.service.tasks, *app_cursor.state.service.tasks)

        res_gge = (await client_gge.get('/api/turn/' + turn_gge['id'])).json()
        res_cursor = (await client_cursor.get('/api/turn/' + turn_cursor['id'])).json()
        assert res_gge['status'] == 'ready' and res_gge['text'] == 'gge已完成响应。'
        assert res_cursor['status'] == 'ready' and res_cursor['text'] == 'cursor已完成响应。'
        assert (await client_gge.get('/api/turn/' + turn_cursor['id'])).status_code == 404
        assert (await client_cursor.get('/api/turn/' + turn_gge['id'])).status_code == 404

    posted_gge = [body for path, body in bridge_gge.calls if path == '/input']
    posted_cursor = [body for path, body in bridge_cursor.calls if path == '/input']
    assert len(posted_gge) == 1 and posted_gge[0]['project'] == 'gge' and posted_gge[0]['session_key'] == 'discord:11111111'
    assert len(posted_cursor) == 1 and posted_cursor[0]['project'] == 'cursor' and posted_cursor[0]['session_key'] == 'discord:22222222'

    events_gge = [json.loads(line) for line in (Path(settings_gge.data_dir) / 'events.jsonl').read_text().splitlines()]
    events_cursor = [json.loads(line) for line in (Path(settings_cursor.data_dir) / 'events.jsonl').read_text().splitlines()]
    assert all(e['project'] == 'gge' for e in events_gge)
    assert all(e['project'] == 'cursor' for e in events_cursor)

    mem_gge = [json.loads(line) for f in Path(settings_gge.shared_memory_dir).glob('*.jsonl') for line in f.read_text().splitlines()]
    mem_cursor = [json.loads(line) for f in Path(settings_cursor.shared_memory_dir).glob('*.jsonl') for line in f.read_text().splitlines()]
    assert all(e['session_key'] == 'discord:11111111' and e['project'] == 'gge' for e in mem_gge)
    assert all(e['session_key'] == 'discord:22222222' and e['project'] == 'cursor' for e in mem_cursor)


def test_autonomy_init_and_cli_fail_closed_when_bindings_missing(tmp_path, monkeypatch):
    fake_home = tmp_path / 'autonomy-home'
    fake_home.mkdir()
    monkeypatch.setenv('HOME', str(fake_home))
    monkeypatch.delenv('AUTONOMY_CONFIG', raising=False)
    monkeypatch.delenv('CONEST_HOME', raising=False)
    monkeypatch.delenv('AUTONOMY_LEADER', raising=False)
    monkeypatch.delenv('AUTONOMY_BRIDGE_CONFIG', raising=False)
    monkeypatch.delenv('CC_CONNECT_CONFIG', raising=False)

    def must_not_call_network(*args, **kwargs):
        raise AssertionError('must not contact Discord or Bridge when bindings are missing')

    monkeypatch.setattr(autonomy_cli, 'Discord', must_not_call_network)
    monkeypatch.setattr(autonomy_cli, 'Bridge', must_not_call_network)

    cfg_path = fake_home / '.conest/autonomy/config.json'
    # Missing leader
    with pytest.raises(ValueError, match='missing leader'):
        init_autonomy(cfg_path, '123456')
    # Missing bridge_config
    with pytest.raises(ValueError, match='missing bridge_config'):
        init_autonomy(cfg_path, '123456', leader='gge')

    bridge_toml = tmp_path / 'config.toml'
    bridge_toml.write_text(
        '[[projects]]\nname = "gge"\n[[projects.platforms]]\ntype = "discord"\n',
        encoding='utf-8',
    )
    # Leader not present in bridge_config
    with pytest.raises(ValueError, match="leader 'cursor' not found"):
        init_autonomy(cfg_path, '123456', leader='cursor', bridge_config=bridge_toml)
    assert not cfg_path.exists()
    assert not (fake_home / '.cc-connect-maomao').exists()

    # Missing config file on read_config fails with actionable error
    with pytest.raises(ValueError, match='missing autonomy config'):
        read_config(cfg_path)


def test_two_independent_autonomy_instances_initialize_and_run_isolated(tmp_path, monkeypatch):
    fake_home = tmp_path / 'home'
    fake_home.mkdir()
    monkeypatch.setenv('HOME', str(fake_home))

    class ScopedDiscord:
        def __init__(self, config_path: str, project: str):
            self.config_path = config_path
            self.project = project
            self.posts = []

        def call(self, path: str, body=None, **kwargs):
            if '/messages' in path and body is None:
                return []
            if path.startswith('/channels/') and '/messages' not in path:
                channel_id = path.rsplit('/', 1)[-1]
                return {'id': channel_id, 'guild_id': f'999{channel_id}'}
            if path == '/users/@me':
                uid = '101' if self.project == 'gge' else '202'
                name = 'G哥' if self.project == 'gge' else 'Cursor'
                return {'id': uid, 'username': name}
            self.posts.append((path, body, kwargs))
            return {'id': '888'}

    class ScopedBridge:
        def __init__(self):
            self.calls = []
            self.jobs = []
            self.timers = {}

        def call(self, path: str, body=None):
            self.calls.append((path, body))
            if path == '/timer/add':
                job = dict(body, id=str(len(self.timers) + 1), fired=False)
                self.timers[job['id']] = job
                return job
            if path.startswith('/timer/info'):
                return self.timers[path.split('=')[1]]
            if path == '/cron/list':
                return self.jobs
            if path == '/cron/add':
                self.jobs.append(dict(body, id='job-1', enabled=True))
                return self.jobs[-1]
            if path == '/cron/edit':
                job = next(j for j in self.jobs if j['id'] == body['id'])
                job[body['field']] = body['value']
                return job
            raise AssertionError(path)

    monkeypatch.setattr(autonomy_cli, 'Discord', ScopedDiscord)

    inst_a = tmp_path / 'inst-gge'
    inst_b = tmp_path / 'inst-cursor'
    inst_a.mkdir()
    inst_b.mkdir()
    toml_a = inst_a / 'config.toml'
    toml_b = inst_b / 'config.toml'
    toml_a.write_text('[[projects]]\nname = "gge"\n[[projects.platforms]]\ntype = "discord"\n', encoding='utf-8')
    toml_b.write_text('[[projects]]\nname = "cursor"\n[[projects.platforms]]\ntype = "discord"\n', encoding='utf-8')

    cfg_a_path = inst_a / 'autonomy/config.json'
    cfg_b_path = inst_b / 'autonomy/config.json'

    cfg_a = init_autonomy(cfg_a_path, '111111', leader='gge', bridge_config=toml_a)
    cfg_b = init_autonomy(cfg_b_path, '222222', leader='cursor', bridge_config=toml_b)

    assert cfg_a['leader'] == 'gge' and cfg_a['main_channel'] == '111111'
    assert cfg_b['leader'] == 'cursor' and cfg_b['main_channel'] == '222222'
    assert cfg_a['socket'] == str((inst_a / 'data/run/api.sock').resolve())
    assert cfg_b['socket'] == str((inst_b / 'data/run/api.sock').resolve())
    assert cfg_a['journal_dir'] == str((inst_a / 'autonomy/journal').resolve())
    assert cfg_b['journal_dir'] == str((inst_b / 'autonomy/journal').resolve())
    assert not (fake_home / '.cc-connect-maomao').exists()

    # Enable both instances at 11:00 and run a 12:00 tick independently.
    for path, cfg in ((cfg_a_path, cfg_a), (cfg_b_path, cfg_b)):
        cfg['enabled'] = True
        cfg['start_at'] = NOW.replace(hour=11, minute=0, second=0).isoformat()
        cfg['archive_since'] = NOW.replace(hour=0, minute=0, second=0).isoformat()
        path.write_text(json.dumps(cfg), encoding='utf-8')

    bridge_a, bridge_b = ScopedBridge(), ScopedBridge()
    install(cfg_a, cfg_a_path, bridge_a)
    install(cfg_b, cfg_b_path, bridge_b)
    assert bridge_a.jobs[0]['project'] == 'gge' and bridge_a.jobs[0]['session_key'] == 'discord:111111'
    assert bridge_b.jobs[0]['project'] == 'cursor' and bridge_b.jobs[0]['session_key'] == 'discord:222222'

    runner_a = Runner(cfg_a, cfg_a_path.parent / 'state.json', bridge_a, ScopedDiscord(str(toml_a), 'gge'))
    runner_b = Runner(cfg_b, cfg_b_path.parent / 'state.json', bridge_b, ScopedDiscord(str(toml_b), 'cursor'))
    try:
        runner_a.tick(NOW)
        runner_b.tick(NOW)
    finally:
        runner_a.journal.db.close()
        runner_b.journal.db.close()

    assert bridge_a.timers['1']['project'] == 'gge'
    assert bridge_a.timers['1']['session_key'] == 'discord:111111'
    assert '你是 G哥' in bridge_a.timers['1']['prompt']

    assert bridge_b.timers['1']['project'] == 'cursor'
    assert bridge_b.timers['1']['session_key'] == 'discord:222222'
    assert '你是 Cursor' in bridge_b.timers['1']['prompt']

    assert (Path(cfg_a['journal_dir']) / 'index.html').is_file()
    assert (Path(cfg_b['journal_dir']) / 'index.html').is_file()


EXAMPLES = Path(__file__).resolve().parents[1] / 'examples'


@pytest.mark.parametrize('field', ['project', 'role_name', 'session_key', 'bridge_socket', 'model_path', 'data_dir', 'shared_memory_dir'])
@pytest.mark.parametrize('bad_value', [None, '   ', 123, True, ['list']])
def test_null_or_nonstring_voice_binding_is_rejected(tmp_path, field, bad_value):
    config = json.loads((EXAMPLES / 'voice-config.example.json').read_text(encoding='utf-8'))
    config[field] = bad_value
    path = tmp_path / 'voice.json'
    path.write_text(json.dumps(config), encoding='utf-8')
    with pytest.raises(ValueError, match=field):
        Settings.read(path)


@pytest.mark.parametrize('field', ['socket', 'bridge_config', 'leader', 'timer_store', 'journal_dir'])
@pytest.mark.parametrize('bad_value', [None, '   ', 123, True])
def test_null_or_nonstring_autonomy_binding_is_rejected(tmp_path, field, bad_value):
    config = json.loads((EXAMPLES / 'autonomy-config.example.json').read_text(encoding='utf-8'))
    config[field] = bad_value
    path = tmp_path / 'autonomy.json'
    path.write_text(json.dumps(config), encoding='utf-8')
    with pytest.raises(ValueError, match=field):
        read_config(path, require_socket=True, require_bridge_config=True)


class SharedBridge:
    def __init__(self):
        self.jobs = []
        self.calls = []
        self.timers = {}

    def call(self, path, body=None):
        import copy
        self.calls.append((path, body))
        if path == '/cron/list':
            return copy.deepcopy(self.jobs)
        if path == '/cron/add':
            job = dict(body, id=str(len(self.jobs) + 1))
            self.jobs.append(job)
            return copy.deepcopy(job)
        if path == '/cron/edit':
            job = next(j for j in self.jobs if j['id'] == body['id'])
            job[body['field']] = body['value']
            return copy.deepcopy(job)
        raise AssertionError(path)


def test_second_config_cannot_take_over_first_cron_across_install_leader_and_status(tmp_path, monkeypatch):
    import copy
    from autonomy.__main__ import change_leader

    bridge = SharedBridge()
    base = json.loads((EXAMPLES / 'autonomy-config.example.json').read_text(encoding='utf-8'))
    a = dict(base, leader='gge', main_channel='1111', channels=['1111'],
             timer_store=str(tmp_path / 'a/timers.json'), journal_dir=str(tmp_path / 'a/journal'))
    b = dict(base, leader='cursor', main_channel='2222', channels=['2222'],
             timer_store=str(tmp_path / 'b/timers.json'), journal_dir=str(tmp_path / 'b/journal'))
    path_a = tmp_path / 'a' / 'config.json'
    path_b = tmp_path / 'b' / 'config.json'
    path_a.parent.mkdir(parents=True, exist_ok=True)
    path_b.parent.mkdir(parents=True, exist_ok=True)
    path_a.write_text(json.dumps(a), encoding='utf-8')
    path_b.write_text(json.dumps(b), encoding='utf-8')

    install(a, path_a, bridge)
    first = copy.deepcopy(bridge.jobs[0])

    # 1. install() with second config must not overwrite first cron
    with pytest.raises(ValueError, match='another config|foreign'):
        install(b, path_b, bridge)
    assert bridge.jobs == [first], 'second config overwrote first cron binding and exec'

    # 2. change_leader() with second config must not edit first cron or mutate b/config.json
    with pytest.raises(ValueError, match='another config|foreign'):
        change_leader(b, path_b, bridge, 'gge')
    assert bridge.jobs == [first]
    assert json.loads(path_b.read_text(encoding='utf-8'))['leader'] == 'cursor'

    # 3. status CLI with second config on shared bridge must reject foreign cron
    monkeypatch.setattr(autonomy_cli, 'Bridge', lambda _: bridge)
    monkeypatch.setattr(autonomy_cli, 'Discord', lambda *_: None)
    monkeypatch.setattr('sys.argv', ['autonomy', '--config', str(path_b), 'status'])
    with pytest.raises(ValueError, match='another config|foreign'):
        autonomy_cli.main()
    assert bridge.jobs == [first]
