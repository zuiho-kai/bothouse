"""Network boundaries are fake; these tests never contact Discord or create live jobs."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import pytest

from autonomy.__main__ import OWNER, Runner, change_leader, due_slots, install, make_prompt, validate
from autonomy.io import RemoteError, write_json
from autonomy.journal import Journal, render, snowflake


TZ = ZoneInfo('Asia/Shanghai')
NOW = datetime(2026, 10, 16, 15, 0, 30, tzinfo=TZ)


@pytest.fixture
def config(tmp_path):
    return {'enabled': True, 'timezone': 'Asia/Shanghai', 'activity_times': ['09:00','12:00','15:00','18:00','21:00'],
            'digest_time': '22:00', 'grace_minutes': 5, 'main_channel': '123', 'channels': ['123'],
            'guild_id': '456', 'leader': 'cjiang', 'roles': [
                {'project': 'cjiang', 'id': '1', 'name': 'C酱'},
                {'project': 'gge', 'id': '2', 'name': 'G哥'},
                {'project': 'deep', 'id': '3', 'name': 'Deep'}],
            'start_at': NOW.replace(hour=13,minute=0).isoformat(),
            'archive_since': NOW.replace(hour=0,minute=0,second=0).isoformat(),
            'timer_store': str(tmp_path/'timers.json'), 'journal_dir': str(tmp_path/'journal')}


def msg(at, number=1, content='真实发现', author='2'):
    return {'id': str(int(snowflake(at))+number), 'channel_id': '123', 'timestamp': at.isoformat(),
            'author': {'id': author,'username': 'guest'}, 'content': content, 'attachments': []}


class FakeDiscord:
    def __init__(self, messages=()):
        self.messages = list(messages)
        self.requests, self.posts = [], []
        self.fail_page = 0

    def call(self, path, body=None, **kwargs):
        self.requests.append(path)
        if body is not None:
            self.posts.append((body, kwargs))
            return {'id': '999'}
        if self.fail_page and len(self.requests) == self.fail_page:
            raise RemoteError('Discord HTTP 429')
        before = parse_qs(urlsplit(path).query).get('before', [str(10**30)])[0]
        return sorted((m for m in self.messages if int(m['id']) < int(before)), key=lambda m:int(m['id']), reverse=True)[:100]


class FakeBridge:
    def __init__(self):
        self.calls, self.jobs, self.timers = [], [], {}
        self.uncertain = False

    def call(self, path, body=None):
        self.calls.append((path, body))
        if path == '/timer/add':
            if self.uncertain:
                raise RemoteError('bridge unavailable')
            job = dict(body, id=str(len(self.timers)+1), fired=False)
            self.timers[job['id']] = job
            return job
        if path.startswith('/timer/info'):
            return self.timers[path.split('=')[1]]
        if path == '/cron/list':
            return self.jobs
        if path == '/cron/add':
            self.jobs.append(dict(body, id='job', enabled=True))
            return self.jobs[-1]
        if path == '/cron/edit':
            job = next(j for j in self.jobs if j['id'] == body['id'])
            job[body['field']] = body['value']
            return job
        raise AssertionError(path)


@pytest.fixture
def runner(config, tmp_path):
    run = Runner(config, tmp_path/'state.json', FakeBridge(), FakeDiscord())
    yield run
    run.journal.db.close()


def test_due_uses_local_timezone_and_does_not_backfill_before_enable(config):
    due = list(due_slots(config, NOW.astimezone(timezone.utc), {'actions': {}}))
    assert [(k,s) for k,_,_,s in due] == [('activity:2026-10-16:15:00','due')]
    late = list(due_slots(config, NOW+timedelta(minutes=6), {'actions':{}}))
    assert late[0][3] == 'missed'


def test_pause_and_restart_do_not_replay_slots(config):
    config['enabled'] = False
    due = list(due_slots(config, NOW, {'actions':{}}))
    assert due[0][3] == 'paused'
    state = {'actions': {due[0][0]: {'status': 'paused'}}}
    config['enabled'] = True
    assert not list(due_slots(config, NOW, state))


def test_offline_days_are_missed_not_a_burst(config):
    due = list(due_slots(config, NOW+timedelta(days=2), {'actions':{}}))
    assert sum(status == 'due' for _,_,_,status in due) == 1
    assert len(due) > 6


@pytest.mark.parametrize('times,digest', [(['25:00'],'22:00'), (['9:00'],'22:00'), (['09:00','09:00'],'22:00'), (['22:00'],'22:00')])
def test_bad_schedule_rejected(config, times, digest):
    config.update(activity_times=times, digest_time=digest)
    with pytest.raises(ValueError):
        validate(config)


def test_pagination_dedup_edits_and_failure_dont_skip_messages(runner):
    messages = [msg(NOW-timedelta(minutes=10), i) for i in range(1,251)]
    runner.discord.messages = messages
    runner.discord.fail_page = 2
    with pytest.raises(RemoteError):
        runner.journal.collect(runner.discord, runner.config)
    assert runner.journal.db.execute('SELECT count(*) FROM cursors').fetchone()[0] == 0
    runner.discord.fail_page = 0
    runner.journal.collect(runner.discord, runner.config)
    assert len(runner.journal.day(runner.config, '2026-10-16')) == 250
    runner.discord.messages[-1]['content'] = '编辑后的实际内容'
    runner.journal.collect(runner.discord, runner.config)
    rows = runner.journal.day(runner.config, '2026-10-16')
    assert len(rows) == 250
    assert rows[-1]['content'] == '编辑后的实际内容'


def test_local_midnight_boundary(runner):
    midnight = NOW.replace(hour=0,minute=0,second=0)
    runner.discord.messages = [msg(midnight-timedelta(seconds=1)),msg(midnight)]
    runner.journal.collect(runner.discord, runner.config)
    assert len(runner.journal.day(runner.config, '2026-10-16')) == 1
    assert not runner.journal.day(runner.config, '2026-10-15')


def test_tick_idempotence_persists_across_runner_restart(runner):
    runner.tick(NOW)
    runner.tick(NOW+timedelta(seconds=20))
    again = Runner(runner.config,runner.path,runner.bridge,runner.discord)
    try:
        again.tick(NOW+timedelta(seconds=25))
    finally:
        again.journal.db.close()
    assert len(runner.bridge.timers) == 1
    request = next(body for path,body in runner.bridge.calls if path == '/timer/add')
    assert request['session_key'] == 'discord:123'
    assert request['session_mode'] == 'reuse'
    assert 'mode' not in request and 'work_dir' not in request


def test_uncertain_submission_not_retried_and_recovered_from_store(runner):
    runner.bridge.uncertain = True
    key = 'activity:2026-10-16:15:00'
    with pytest.raises(RemoteError):
        runner.submit(key,'activity',NOW)
    runner.submit(key,'activity',NOW)
    assert len(runner.bridge.calls) == 1
    assert runner.state['actions'][key]['status'] == 'unknown'
    write_json(Path(runner.config['timer_store']), [{'id':'recovered', 'description':OWNER+':'+key,'fired':True,'last_error':'quota private detail'}])
    runner.reconcile()
    action = runner.state['actions'][key]
    assert action['status'] == 'failed' and action['timer_id'] == 'recovered'
    assert 'private detail' not in json.dumps(runner.state)


def test_bridge_completion_not_labelled_activity_success(runner):
    runner.submit('activity:2026-10-16:15:00','activity',NOW)
    runner.bridge.timers['1'].update(fired=True,last_error='')
    runner.reconcile()
    assert runner.state['actions']['activity:2026-10-16:15:00']['status'] == 'bridge_done'


def test_collection_failure_never_uses_stale_context(runner):
    runner.discord.fail_page = 1
    with pytest.raises(RemoteError):
        runner.tick(NOW)
    assert not runner.bridge.timers
    assert runner.state['collection_error']


def test_digest_posts_evidence_once_even_when_leader_fails(runner):
    runner.discord.messages = [msg(NOW, content='实验失败，权限未获得')]
    at = NOW.replace(hour=22,minute=0)
    runner.tick(at)
    runner.tick(at)
    assert len(runner.discord.posts) == 1
    body, files = runner.discord.posts[0]
    assert body['allowed_mentions'] == {'parse':[]}
    assert '实验失败' in files['files'][0][1].decode()
    assert len(runner.bridge.timers) == 1
    assert 'digest:' in runner.bridge.timers['1']['description']


def test_html_escapes_channel_content_and_keeps_source(runner):
    m = msg(NOW, content='<script>alert(1)</script>【下次】继续验证',author='2')
    m['attachments'] = [{'filename':'<danger>', 'url':'javascript:alert(1)'}, {'filename':'产物','url':'https://example.org/file'}]
    runner.discord.messages = [m]
    runner.journal.collect(runner.discord,runner.config)
    md = runner.render('2026-10-16',NOW)
    page = Path(runner.config['journal_dir'],'2026-10-16.html').read_text()
    assert '<script>' not in page and '&lt;script&gt;' in page
    assert 'javascript:' not in page
    assert f'/123/{m["id"]}' in md
    assert '截至采集时未见该角色发言' in md
    prompt = make_prompt(runner.config,runner.journal,'activity',NOW)
    assert '【下次】继续验证' in prompt and '不覆盖本次任务' in prompt


def test_install_only_updates_owned_cron_and_mutes_before_schedule(config,tmp_path):
    bridge = FakeBridge()
    bridge.jobs.append({'id':'other','description':'some other job','enabled':True})
    install(config,tmp_path/'config.json',bridge)
    install(config,tmp_path/'config.json',bridge)
    assert len(bridge.jobs) == 2
    assert bridge.jobs[0] == {'id':'other','description':'some other job','enabled':True}
    edits = [body for path,body in bridge.calls if path == '/cron/edit']
    assert edits[0]['field'] == 'mute'
    assert bridge.jobs[1]['cron_expr'] == '* * * * *' and bridge.jobs[1]['mute']


def test_leader_switch_updates_existing_cron_without_duplicates(config, tmp_path):
    bridge = FakeBridge()
    install(config, tmp_path/'config.json', bridge)
    original_id = bridge.jobs[0]['id']
    config['leader'] = 'gge'
    install(config, tmp_path/'config.json', bridge)
    assert len(bridge.jobs) == 1
    assert bridge.jobs[0]['id'] == original_id
    assert bridge.jobs[0]['project'] == 'gge'


def test_new_leader_receives_activity_and_digest_with_correct_identity(runner):
    runner.config['leader'] = 'gge'
    runner.submit('activity:new-host', 'activity', NOW)
    runner.submit('digest:new-host', 'digest', NOW)
    jobs = list(runner.bridge.timers.values())
    assert all(j['project'] == 'gge' for j in jobs)
    assert '你是 G哥' in jobs[0]['prompt']
    assert '你是 C酱' not in jobs[0]['prompt']
    runner.archive_post('2026-10-16', NOW)
    assert '由 G哥另行整理' in runner.discord.posts[0][0]['content']


def test_leader_change_does_not_reattribute_previous_quota_failure(runner):
    key = 'activity:old-host'
    runner.submit(key, 'activity', NOW)
    finished = NOW + timedelta(seconds=5)
    runner.bridge.timers['1'].update(fired=True, last_error='', fired_at=finished.isoformat())
    runner.config['leader'] = 'gge'
    runner.discord.messages = [msg(finished, content="You've hit your session limit", author='1')]
    runner.tick(finished, collect_only=True)
    assert runner.state['actions'][key]['status'] == 'backend_blocked'


def test_new_leader_story_uses_actual_author_name(runner):
    from autonomy.reading import edition
    from autonomy.journal import message_url
    runner.config['leader'] = 'gge'
    source = msg(NOW, content='实际实验记录', author='3')
    story = msg(NOW + timedelta(seconds=1), author='2',
                content='【今日手记】2026-10-16｜实验\n' + message_url(runner.config, source))
    page, _ = edition(runner.config, [source, story], '2026-10-16')
    assert 'G哥的手记原文' in page
    assert '故事内容由 G哥整理' in page


def test_change_leader_preserves_schedule_history_and_paused_cron(config, tmp_path):
    path = tmp_path/'config.json'
    state_path = tmp_path/'state.json'
    write_json(path, config)
    write_json(state_path, {'actions': {'activity:old': {'status': 'submitted'}}})
    bridge = FakeBridge()
    bridge.jobs = [{'id': 'existing', 'description': OWNER, 'project': 'cjiang', 'enabled': False}]
    updated = change_leader(config, path, bridge, 'gge')
    assert updated == dict(config, leader='gge')
    assert json.loads(path.read_text()) == updated
    assert bridge.jobs == [{'id': 'existing', 'description': OWNER, 'project': 'gge', 'enabled': False}]
    assert json.loads(state_path.read_text())['actions']['activity:old']['leader'] == 'cjiang'
    assert [url for url, _ in bridge.calls] == ['/cron/list', '/cron/edit']
    with pytest.raises(ValueError, match='leader missing'):
        change_leader(updated, path, bridge, 'missing-project')
    assert json.loads(path.read_text()) == updated


def test_write_config_private_and_complete(tmp_path):
    path = tmp_path/'config.json'
    write_json(path,{'activity_times':['09:00']})
    assert path.stat().st_mode & 0o777 == 0o600
    assert json.loads(path.read_text())['activity_times'] == ['09:00']


def test_manual_archive_does_not_consume_scheduled_digest(runner):
    runner.archive_post('2026-10-16',NOW,key='archive:2026-10-16:manual-smoke')
    runner.archive_post('2026-10-16',NOW.replace(hour=22))
    assert len(runner.discord.posts) == 2


def test_offline_backlog_updates_older_daily_pages(runner):
    runner.config['archive_since'] = (NOW-timedelta(days=3)).isoformat()
    runner.discord.messages = [msg(NOW-timedelta(days=2))]
    runner.tick(NOW,collect_only=True)
    assert Path(runner.config['journal_dir'],'2026-10-14.html').exists()


def test_cli_quota_text_is_observed_even_if_timer_reports_success(runner):
    key = 'activity:2026-10-16:15:00'
    runner.submit(key,'activity',NOW)
    finished = NOW+timedelta(seconds=5)
    runner.bridge.timers['1'].update(fired=True,last_error='',fired_at=finished.isoformat())
    runner.reconcile()
    assert runner.state['actions'][key]['status'] == 'bridge_done'
    runner.discord.messages = [msg(finished,content="You've hit your session limit · resets 2:10pm",author='1')]
    runner.tick(finished,collect_only=True)
    assert runner.state['actions'][key]['status'] == 'backend_blocked'
    assert '/123/' in runner.state['actions'][key]['evidence']


def test_story_appears_after_real_leader_digest_without_another_model_call(runner):
    from autonomy.journal import message_url
    source = msg(NOW, content='实验还未成功。【下次】明天换个参数。')
    runner.discord.messages = [source]
    runner.tick(NOW, collect_only=True)
    directory = Path(runner.config['journal_dir'])
    assert '等待手记' in (directory / 'index.html').read_text()
    digest = msg(NOW + timedelta(minutes=1), content='【今日手记】2026-10-16｜一个未完成的实验\n\n'
                 f'G哥说实验仍未成功。[原话]({message_url(runner.config, source)})', author='1')
    runner.discord.messages.append(digest)
    runner.tick(NOW + timedelta(minutes=2), collect_only=True)
    page = (directory / '2026-10-16.html').read_text()
    assert '有来源手记' in page and '一个未完成的实验' in page
    assert '一个未完成的实验' in (directory / 'index.html').read_text()
    assert '实验还未成功' in (directory / '2026-10-16.md').read_text()
    assert not runner.bridge.timers and not runner.discord.posts


@pytest.mark.parametrize('author_id,channel,date', [('2','123','2026-10-16'), ('1','999','2026-10-16'), ('1','123','2026-10-15')])
def test_story_does_not_accept_wrong_author_channel_or_day(config, author_id, channel, date):
    from autonomy.reading import story_for
    fake = msg(NOW, content=f'【今日手记】{date}｜伪装\n这不是当天主持人的手记。', author=author_id)
    fake['channel_id'] = channel
    assert story_for(config, [fake], '2026-10-16') is None


@pytest.mark.parametrize('citation', ['', 'https://discord.com/channels/456/123/999999'])
def test_uncited_or_fabricated_source_story_stays_unverified(config, citation):
    from autonomy.reading import story_for
    digest = msg(NOW, content=f'【今日手记】2026-10-16｜待核对\n据说做成了。{citation}', author='1')
    story = story_for(config, [digest], '2026-10-16')
    assert story['status'] == '手记待核对' and not story['attributed']


def test_old_reports_never_feed_new_story_or_future_commitments(runner):
    original = msg(NOW - timedelta(minutes=1), content='原始发现。【下次】真正的约定。')
    digest = msg(NOW, content='【今日手记】2026-10-16｜旧总结\n重复总结。【下次】总结里新增的假约定。', author='1')
    archive = msg(NOW, number=3, content='【每日归档】归档通知', author='1')
    runner.discord.messages = [original, digest, archive]
    runner.journal.collect(runner.discord, runner.config)
    for kind in ('activity', 'digest'):
        prompt = make_prompt(runner.config, runner.journal, kind, NOW)
        assert '真正的约定' in prompt
        assert '总结里新增的假约定' not in prompt and '归档通知' not in prompt
    runner.render('2026-10-16', NOW)
    md = Path(runner.config['journal_dir'], '2026-10-16.md').read_text()
    assert '总结里新增的假约定' in md  # Still preserved as original channel speech.


def test_reading_escapes_story_title_body_and_links(config):
    from autonomy.reading import edition, document
    digest = msg(NOW, content='【今日手记】2026-10-16｜<img src=x onerror=alert(1)>\n'
                 '<script>alert(2)</script> [坏链接](javascript:alert(3))', author='1')
    body, metadata = edition(config, [digest], '2026-10-16')
    page = document(metadata['title'], body)
    assert '<img' not in page and '<script' not in page
    assert 'href="javascript:' not in page
    assert '&lt;script&gt;' in page and '手记待核对' in page


def test_digest_prompt_requires_date_title_and_actual_sources(runner):
    prompt = make_prompt(runner.config, runner.journal, 'digest', NOW)
    assert '【今日手记】2026-10-16｜具体标题' in prompt
    assert '只复制下面提供的来源链接' in prompt
    assert '没有互动就直说' in prompt and '不超过1800字符' in prompt


def test_shared_links_do_not_promote_internal_service_errors(config):
    from autonomy.reading import edition
    message = msg(NOW, content='请求 http://127.0.0.1:10100/v1/responses 失败。参考 [作品](https://example.org/work)。')
    body, _ = edition(config, [message], '2026-10-16')
    assert 'href="http://127.0.0.1' not in body
    assert 'href="https://example.org/work"' in body


def test_digest_failure_is_visible_on_homepage_and_daily_page(runner):
    runner.state['actions']['digest:2026-10-16:22:00'] = {
        'at': NOW.isoformat(), 'status': 'backend_blocked', 'error': '模型限额，手记未完成'}
    runner.render('2026-10-16', NOW)
    directory = Path(runner.config['journal_dir'])
    for filename in ['index.html', '2026-10-16.html']:
        page = (directory / filename).read_text()
        assert '整理受阻' in page and '模型限额，手记未完成' in page


def test_build_uses_only_local_archive_and_preserves_dispatch_state(runner, monkeypatch, capsys):
    import autonomy.__main__ as cli
    runner.discord.messages = [msg(NOW)]
    runner.journal.collect(runner.discord, runner.config)
    runner.save()
    config_path = runner.path.parent / 'config.json'
    write_json(config_path, runner.config)
    before = runner.path.read_bytes()
    def no_network(*args, **kwargs):
        raise AssertionError('build must not construct network clients')
    monkeypatch.setattr(cli, 'Bridge', no_network)
    monkeypatch.setattr(cli, 'Discord', no_network)
    monkeypatch.setattr('sys.argv', ['autonomy', '--config', str(config_path), 'build', '--date', '2026-10-16'])
    cli.main()
    assert '2026-10-16' in capsys.readouterr().out
    assert runner.path.read_bytes() == before
    assert Path(runner.config['journal_dir'], 'index.html').is_file()
