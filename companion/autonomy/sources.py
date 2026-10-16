"""Source identity and safe links shared by evidence selection and reading pages."""
from urllib.parse import urlsplit


def message_url(config, message):
    return f'https://discord.com/channels/{config["guild_id"]}/{message["channel_id"]}/{message["id"]}'


def author(config, message):
    ident = message.get('author', {}).get('id')
    return next((r['name'] for r in config['roles'] if r['id'] == ident),
                message.get('author', {}).get('global_name') or message.get('author', {}).get('username', '未知'))


def safe_url(value):
    if not isinstance(value, str) or any(ord(c) < 32 for c in value):
        return ''
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username and not parsed.password else ''
    except ValueError:
        return ''


def is_report(message):
    text = message.get('content', '').lstrip('#* \t\r\n')
    return text.startswith(('【今日手记】', '【每日归档】'))


def source_messages(messages):
    # Reports remain in the full archive, but must not become fresh evidence.
    return [m for m in messages if not is_report(m)]
