#!/usr/bin/env -S python3 -I
"""A stand-in for `dsh --profile web`: announces itself like the real host, then answers 303 on the
launch token and 401 otherwise, until killed.

- --public-url makes it announce the public address instead of loopback, exactly like the formal host
  (its plist carries --public-url https://<tailnet host>/), which is the case that used to be written
  into the state file verbatim and turned the panel's 503 into a 502.
- --announce-token/--announce-port print an address the host does not serve, to prove the script
  refuses a mismatched or foreign announcement.
- FAKE_DSH_TOKEN_FILE makes every start hand out a fresh token, like the real host, even though the
  restarted process inherits the same argv and environment.
"""
import argparse
import http.server
import os


class Handler(http.server.BaseHTTPRequestHandler):
    token = 'NEW'

    def do_GET(self):
        if 'token=' + self.token in self.path:
            self.send_response(303)
            self.send_header('location', './')
            self.send_header('content-length', '0')
            self.end_headers()
            return
        self.send_response(401)
        self.send_header('content-length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass


def next_token(path):
    try:
        with open(path) as stream:
            current = stream.read().strip()
    except OSError:
        current = ''
    number = int(current[1:] or 0) if current[:1] == 'T' else 0
    token = 'T%d' % (number + 1)
    with open(path, 'w') as stream:
        stream.write(token)
    return token


parser = argparse.ArgumentParser()
parser.add_argument('--profile')
parser.add_argument('--no-open', action='store_true')
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--public-url')
parser.add_argument('--trusted-host')
parser.add_argument('--token')
parser.add_argument('--announce-token')
parser.add_argument('--announce-port', type=int)
parser.add_argument('--silent', action='store_true')
args = parser.parse_args()

token_file = os.environ.get('FAKE_DSH_TOKEN_FILE')
token = next_token(token_file) if token_file else (args.token or 'NEW')
Handler.token = token
port = args.announce_port or args.port
base = (args.public_url or 'http://127.0.0.1:%d/' % port).rstrip('/') + '/'
if not (args.silent or os.environ.get('FAKE_DSH_SILENT')):
    print('dsh web: %s?token=%s' % (base, args.announce_token or token), flush=True)
http.server.HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()