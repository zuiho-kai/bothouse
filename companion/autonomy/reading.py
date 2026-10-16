"""A local reading edition derived from attributed channel messages, never invented stories."""
import html
import ipaddress
import json
import re
from urllib.parse import urlsplit

from .sources import author, message_url, safe_url, source_messages

STYLE = '''
:root{color-scheme:light;--paper:#f7f4ec;--ink:#28372f;--muted:#6b746b;--line:#dcded1;--accent:#8c4d36}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.85 system-ui,sans-serif}
.wrap{max-width:1080px;margin:auto;padding:30px 28px 64px}a{color:var(--accent);text-underline-offset:4px;overflow-wrap:anywhere}
nav{display:flex;gap:22px;flex-wrap:wrap;padding-bottom:22px;border-bottom:1px solid var(--line)}
h1,h2,h3{font-family:Georgia,"Songti SC",serif;line-height:1.45}h1{font-size:clamp(32px,6vw,60px);font-weight:500;margin:12px 0 22px}
h2{font-size:25px;margin:0 0 18px}h3{font-size:19px}p{margin:12px 0;overflow-wrap:anywhere}.eyebrow,small,.muted{color:var(--muted);font-size:14px}
.eyebrow{letter-spacing:2px;margin-top:30px}.intro{max-width:660px;color:var(--muted)}
.story{max-width:760px;margin:36px auto;padding:30px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.story p{line-height:2.05}.story h3{margin-top:28px}.notice{padding:14px 18px;background:#eceee3;border-radius:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:20px;margin:24px 0}
.card{padding:24px;border:1px solid var(--line);background:#fffdf7;border-radius:5px;min-width:0}
.card h2{font-size:25px}.card h3{margin-top:0}.quote{white-space:pre-wrap;font-size:15px;overflow-wrap:anywhere}
.label{display:inline-block;color:var(--muted);font-size:13px;border:1px solid var(--line);border-radius:20px;padding:2px 10px}
.section{margin-top:48px}.sources{padding-left:22px}.sources li{padding:7px 0}.next{border-left:3px solid #9aa47e;padding:4px 18px;margin:18px 0}
details{margin:28px 0;border-top:1px solid var(--line);padding-top:18px}summary{cursor:pointer;font-weight:600}
.raw article{padding:20px 0;border-bottom:1px solid var(--line)}header{color:var(--muted);font-size:14px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:14px}.footer{margin-top:44px;color:var(--muted);font-size:13px}
a:focus-visible,summary:focus-visible{outline:3px solid #8c4d36;outline-offset:5px}
@media(max-width:600px){.wrap{padding:20px 18px 40px}.grid{grid-template-columns:1fr}.card{padding:20px}.story{margin-top:24px}}
'''

DISCORD_LINK = re.compile(r'https://discord\.com/channels/[0-9]+/[0-9]+/[0-9]+')
LINK = re.compile(r'\[([^\]\n]+)\]\((https?://[^\s)]+)\)|(https?://[^\s<>\[\]）]+)')


def shareable_url(value):
    """Keep service addresses in raw logs, not in the shared-work reading shelf."""
    if not safe_url(value):
        return False
    host = urlsplit(value).hostname.lower().rstrip('.')
    if host == 'localhost' or host.endswith(('.localhost', '.local')):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return '.' in host


def inline(text):
    """Only links are rendered; HTML and all other markup remain inert text."""
    output, pos = [], 0
    for match in LINK.finditer(text):
        output.append(html.escape(text[pos:match.start()]))
        label, url = (match[1], match[2]) if match[2] else (match[3], match[3])
        url = safe_url(url)
        if url:
            output.append(f'<a rel="noreferrer" href="{html.escape(url, quote=True)}">{html.escape(label)}</a>')
        else:
            output.append(html.escape(match[0]))
        pos = match.end()
    return ''.join(output) + html.escape(text[pos:])


def paragraphs(text):
    blocks = []
    for block in re.split(r'\n\s*\n', text.strip()):
        if not block:
            continue
        for line in block.splitlines():
            if line.startswith(('## ', '### ')):
                blocks.append('<h3>' + inline(line.lstrip('# ')) + '</h3>')
            else:
                blocks.append('<p>' + inline(line) + '</p>')
    return ''.join(blocks)


def story_for(config, messages, date):
    leader = next(r['id'] for r in config['roles'] if r['project'] == config['leader'])
    known = {message_url(config, m) for m in source_messages(messages)}
    marker = re.compile(r'^【今日手记】\s*' + re.escape(date) + r'(?:[｜|：: \t]+(.*))?$')
    for message in reversed(messages):
        if message.get('author', {}).get('id') != leader or message['channel_id'] != config['main_channel']:
            continue
        text = message.get('content', '').strip().lstrip('#* ')
        first, _, body = text.partition('\n')
        match = marker.fullmatch(first.strip().rstrip('*'))
        if not match or not body.strip():
            continue
        links = set(DISCORD_LINK.findall(body))
        valid = sorted(links & known)
        verified = bool(valid) and links <= known
        return {'title': (match[1] or '今日手记').strip('* '), 'body': body.strip(),
                'source': message_url(config, message), 'citations': valid,
                'status': '有来源手记' if verified else '手记待核对', 'attributed': verified}
    return None


def edition(config, messages, date, runs=()):
    story = story_for(config, messages, date)
    leader_name = next(r['name'] for r in config['roles'] if r['project'] == config['leader'])
    originals = source_messages(messages)
    digests = [run for key, run in runs if key.startswith(f'digest:{date}:')]
    last_digest = max(digests, key=lambda run: run.get('at', ''), default={})
    blocked = last_digest.get('error', '') if not story else ''
    if story:
        note = (f'引用链接已匹配当天归档；故事内容由 {leader_name}整理，行动与成果仍以原话和产物为准。'
                if story['attributed'] else '这篇手记缺少可匹配的当天来源，或含未采集的引用；请先核对原话。')
        body = (f'<section class="story"><span class="label">{story["status"]}</span>'
                f'<h2>{html.escape(story["title"])}</h2>{paragraphs(story["body"])}'
                f'<p class="muted"><a href="{story["source"]}">{html.escape(leader_name)}的手记原文</a> · {html.escape(note)}</p></section>')
    else:
        body = ('<section class="story"><h2>今天的故事，等他们慢慢写。</h2>'
                '<p>尚未采集到符合格式的今日手记。先看看他们留下的原话；有真实经历，再整理成故事。</p>'
                f'<p class="muted">计划 {html.escape(config.get("digest_time", "22:00"))} 整理手记。模型限额或任务失败时，原话仍会保留。</p></section>')
        if blocked:
            body = '<p class="notice">今日手记整理受阻：' + html.escape(blocked) + '</p>' + body
    cards = []
    for role in config['roles']:
        own = [m for m in originals if m.get('author', {}).get('id') == role['id']]
        snippets = ''.join(f'<p class="quote">{html.escape(m.get("content", "")[:420] or "[附件消息]")}</p>'
                           f'<a href="{message_url(config, m)}">查看原话</a>' for m in own[-1:])
        cards.append(f'<article class="card"><h3>{html.escape(role["name"])}</h3><small>{len(own)} 条原始消息</small>'
                     + (snippets or '<p class="muted">今天还没有采集到发言。</p>') + '</article>')
    body += '<section class="section"><h2>他们留下的片段</h2><p class="muted">各自最近的一条原话。发言数量不代表完成了多少事。</p><div class="grid">' + ''.join(cards) + '</div></section>'
    commitments = [m for m in originals if '【下次】' in m.get('content', '')][-8:]
    body += '<section class="section"><h2>留到下一次</h2><p class="muted">来自原话中的约定，是否已经完成需结合后续消息判断。</p>'
    for message in commitments:
        content = message['content'].split('【下次】', 1)[1][:600]
        body += f'<div class="next"><b>{html.escape(author(config, message))}</b><p>{inline(content)}</p><a href="{message_url(config, message)}">约定来源</a></div>'
    body += ('<p class="muted">暂无明确留下的约定。</p>' if not commitments else '') + '</section>'
    shared = []
    for message in originals:
        links = [(a.get('filename', '附件'), a.get('url', '')) for a in message.get('attachments', [])]
        for match in LINK.finditer(message.get('content', '')):
            label, url = (match[1], match[2]) if match[2] else ('分享的链接', match[3].rstrip('。，；、.!?,;)'))
            if not DISCORD_LINK.fullmatch(url):
                links.append((label, url))
        seen = set()
        for label, url in links:
            if shareable_url(url) and url not in seen:
                seen.add(url)
                shared.append((message, label, url))
    body += '<section class="section"><h2>分享的链接与附件</h2><p class="muted">作品或参考资料，按原消息保留出处；内容尚未逐项验收，附件链接可能过期。</p><ul class="sources">'
    for message, label, url in shared[-12:]:
        body += f'<li>{html.escape(author(config, message))} · <a rel="noreferrer" href="{html.escape(url, quote=True)}">{html.escape(label)}</a> · <a href="{message_url(config, message)}">来源</a></li>'
    body += '</ul>' + ('<p class="muted">暂无已采集的分享链接或附件。</p>' if not shared else '') + '</section>'
    metadata = {'date': date, 'title': story['title'] if story else '今天的故事，等待整理',
                'status': story['status'] if story else ('整理受阻' if blocked else '等待手记'),
                'excerpt': re.sub(r'https?://\S+', '', story['body'])[:150] if story else (blocked or '原话已按时间保存。手记会在整理后出现在这里。'),
                'messages': len(originals),
                'speakers': len({m.get('author', {}).get('id') for m in originals if m.get('author', {}).get('id') in {r['id'] for r in config['roles']}})}
    return body, metadata


def document(title, body):
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)}</title><style>{STYLE}</style></head><body><div class="wrap">{body}</div></body></html>')


def index_page(directory):
    cards = []
    for path in sorted(directory.glob('????-??-??.html'), reverse=True):
        date = path.stem
        if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', date):
            continue
        info = {'title': '回看这一天', 'status': '原话归档', 'excerpt': '查看当天记录。'}
        try:
            info.update(json.loads(path.with_suffix('.story.json').read_text(encoding='utf-8')))
        except (OSError, ValueError):
            pass
        cards.append(f'<article class="card"><span class="label">{html.escape(info["status"])}</span>'
                     f'<p class="eyebrow">{date}</p><h2><a href="{date}.html">{html.escape(info["title"])}</a></h2>'
                     f'<p>{html.escape(info["excerpt"])}</p><a href="{date}.html">读这一天 →</a></article>')
    return document('一家子 · 每日故事', '<nav><strong>一家子</strong><span class="muted">日常 / 发现 / 彼此的回应</span></nav>'
                    '<p class="eyebrow">从常规频道，寄来的一页日常</p><h1>今天，他们聊了些什么？</h1>'
                    '<p class="intro">把各自的发现、接住的话题和留到明天的念头，按天收在这里。每篇手记都可以回到原话。</p>'
                    '<div class="grid">' + (''.join(cards) or '<p>还没有已归档的日期。</p>') + '</div>'
                    '<p class="footer">本机阅读版 · 内容来自已采集的 Discord 消息。没有发生的经历，不补写。</p>')
