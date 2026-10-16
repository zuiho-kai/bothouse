"""Durable channel snapshots and portable, escaped daily reading pages."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
import html
import json
from pathlib import Path
import sqlite3
import time
from zoneinfo import ZoneInfo

from .sources import author, message_url, safe_url, source_messages
from .reading import document, edition, index_page


def snowflake(at: datetime) -> str:
    return str(max(0, (int(at.timestamp() * 1000) - 1420070400000) << 22))


class Journal:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel TEXT NOT NULL, timestamp TEXT NOT NULL, data TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS cursors (channel TEXT PRIMARY KEY, id TEXT NOT NULL)')
        self.db.commit()

    def collect(self, discord, config):
        """Walk backwards from newest; commit cursor only after complete pagination."""
        touched_dates = set()
        deadline = time.monotonic() + 60
        for channel in config['channels']:
            stored = self.db.execute('SELECT id FROM cursors WHERE channel=?', (channel,)).fetchone()
            boundary = stored[0] if stored else snowflake(datetime.fromisoformat(config['archive_since']))
            before, batch = None, {}
            for _ in range(100):
                if time.monotonic() >= deadline:
                    raise ValueError('archive deadline reached; incomplete channel cursor unchanged')
                path = f'/channels/{channel}/messages?limit=100'
                if before:
                    path += '&before=' + before
                messages = discord.call(path)
                if not isinstance(messages, list):
                    raise ValueError('invalid Discord page')
                if not messages:
                    break
                for message in messages:
                    if int(message['id']) >= int(snowflake(datetime.fromisoformat(config['archive_since']))):
                        message['channel_id'] = channel
                        batch[message['id']] = message
                oldest = min(int(m['id']) for m in messages)
                if oldest <= int(boundary) or len(messages) < 100:
                    break
                if before and oldest >= int(before):
                    raise ValueError('Discord pagination did not advance')
                before = str(oldest)
            else:
                raise ValueError('archive backlog exceeds 100 pages; cursor unchanged')
            with self.db:
                for message in batch.values():
                    touched_dates.add(datetime.fromisoformat(message['timestamp']).astimezone(ZoneInfo(config['timezone'])).date())
                    stamp = datetime.fromisoformat(message['timestamp']).astimezone(timezone.utc).isoformat()
                    self.db.execute('INSERT OR REPLACE INTO messages VALUES (?,?,?,?)',
                                    (message['id'], channel, stamp, json.dumps(message, ensure_ascii=False)))
                if batch:
                    newest = max([int(boundary)] + [int(k) for k in batch])
                    self.db.execute('INSERT OR REPLACE INTO cursors VALUES (?,?)', (channel, str(newest)))
        return touched_dates

    def between(self, start: datetime, end: datetime):
        rows = self.db.execute('SELECT data FROM messages WHERE timestamp>=? AND timestamp<? ORDER BY timestamp,id',
                               (start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()))
        return [json.loads(row[0]) for row in rows]

    def day(self, config, date):
        start = datetime.fromisoformat(date).replace(tzinfo=ZoneInfo(config['timezone']))
        return self.between(start, start + timedelta(days=1))


def excerpts(config, messages, per_role=3, max_chars=12000):
    """Bounded, attributed quotations; never turn a statement into a verified action."""
    chosen, counts = [], Counter()
    for message in reversed(source_messages(messages)):
        ident = message.get('author', {}).get('id', '')
        if counts[ident] >= per_role or not message.get('content'):
            continue
        counts[ident] += 1
        chosen.append(message)
        if len(chosen) >= 36:
            break
    lines = []
    budget = max_chars // max(1, len(chosen))
    for message in reversed(chosen):
        header = f'{author(config, message)} | {message["timestamp"]} | {message_url(config, message)}\n'
        line = header + message.get('content', '')[:max(0, min(1200, budget-len(header)-2))]
        lines.append(line)
    return '\n\n'.join(lines) or '此时间范围尚无已采集的文字消息。'


def render(config, journal, state, date, now):
    messages = journal.day(config, date)
    cutoff = now.astimezone(ZoneInfo(config['timezone'])).strftime('%Y-%m-%d %H:%M:%S')
    preface = f'采集截至 {cutoff}（{config["timezone"]}）。消息是发言证据，不自动证明任务完成；未发言不代表未工作。'
    lines = [f'# 一家子 · {date}', '', preface, '', '## 调度记录', '']
    runs = [(key, value) for key, value in state.get('actions', {}).items() if date in key]
    for key, run in runs:
        lines.append(f'- {key}：{run["status"]}' + (f'；{run["error"]}' if run.get('error') else ''))
        if run.get('evidence'):
            lines.append(f'  [对应消息]({run["evidence"]})')
    if not runs:
        lines.append('本日暂无调度记录。')
    lines.extend(['', '## 各自留下的记录', ''])
    for role in config['roles']:
        own = [m for m in messages if m.get('author', {}).get('id') == role['id']]
        lines.extend([f'### {role["name"]} · {len(own)} 条消息', ''])
        if not own:
            lines.extend(['截至采集时未见该角色发言。', ''])
        for message in own[-3:]:
            lines.extend([f'[原消息]({message_url(config, message)})', '', '> ' + message.get('content', '[附件消息]')[:1200].replace('\n', '\n> '), ''])
    lines.extend(['## 按时间回看（原话）', ''])
    entries = []
    for message in messages:
        time = datetime.fromisoformat(message['timestamp']).astimezone(ZoneInfo(config['timezone'])).strftime('%H:%M:%S')
        name = author(config, message)
        url = message_url(config, message)
        content = message.get('content', '')
        lines.extend([f'### {time} · {name} · [来源]({url})', '', '> ' + content.replace('\n', '\n> '), ''])
        attachments = []
        for attachment in message.get('attachments', []):
            link = safe_url(attachment.get('url', ''))
            if link:
                filename = attachment.get('filename', '附件')
                lines.append(f'- 附件：{filename} {link}')
                attachments.append(f'<a href="{html.escape(link, quote=True)}">{html.escape(filename)}</a>')
        reply = message.get('message_reference', {}).get('message_id')
        reply_html = ''
        if reply:
            parent = dict(message, id=reply, channel_id=message.get('message_reference', {}).get('channel_id', message['channel_id']))
            parent_url = message_url(config, parent)
            lines.append(f'回复：[原消息]({parent_url})')
            reply_html = f'<a href="{parent_url}">回复的消息</a>'
        entries.append(f'<article><header><b>{html.escape(name)}</b> <a href="{url}">{time} · 来源</a> {reply_html}</header><pre>{html.escape(content)}</pre>{" · ".join(attachments)}</article>')
    directory = Path(config['journal_dir'])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    markdown = '\n'.join(lines) + '\n'
    reading, metadata = edition(config, messages, date, runs)
    page = document(f'一家子 · {date}',
                    f'<nav><a href="index.html">← 每日故事</a><a href="{date}.md">原话 Markdown</a><a href="#archive">按时间回看</a></nav>'
                    f'<p class="eyebrow">{date} · 常规频道</p><h1>一家子的一天</h1><p class="intro">{html.escape(preface)}</p>'
                    + reading + '<details id="archive" class="raw"><summary>按时间回看全部原话</summary>' + ''.join(entries) + '</details>'
                    + '<details><summary>调度与失败记录</summary><pre>'
                    + html.escape(chr(10).join(f"{k}: {v['status']} {v.get('error', '')}" for k,v in runs) or '本日暂无调度记录。')
                    + '</pre></details><p class="footer">原话归档与手记分开保留。手记是整理，不代替任务验收。</p>')
    for suffix, text in [('.md', markdown), ('.story.json', json.dumps(metadata, ensure_ascii=False)), ('.html', page)]:
        target = directory / (date + suffix)
        temporary = target.with_name(target.name + '.new')
        temporary.write_text(text, encoding='utf-8')
        temporary.replace(target)
    temporary = directory / 'index.html.new'
    temporary.write_text(index_page(directory), encoding='utf-8')
    temporary.replace(directory / 'index.html')
    return markdown
