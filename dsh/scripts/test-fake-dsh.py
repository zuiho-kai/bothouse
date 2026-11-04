#!/usr/bin/env -S python3 -I
"""A stand-in for `dsh --profile web`: announces itself like the real host, then serves 401 on / until killed."""
import argparse
import http.server


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(401)
        self.send_header('content-length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass


parser = argparse.ArgumentParser()
parser.add_argument('--profile')
parser.add_argument('--no-open', action='store_true')
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--token', default='NEW')
args = parser.parse_args()
print('dsh web: http://127.0.0.1:%d/?token=%s' % (args.port, args.token), flush=True)
http.server.HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
