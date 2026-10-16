"""Loopback-only reading server; exposes generated pages, never the workspace."""
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
from urllib.parse import urlsplit


class ReaderHandler(BaseHTTPRequestHandler):
    def __init__(self, *args, directory, **kwargs):
        self.directory = Path(directory).resolve()
        super().__init__(*args, **kwargs)

    def do_GET(self):
        self.send_page(body=True)

    def do_HEAD(self):
        self.send_page(body=False)

    def send_page(self, body):
        name = urlsplit(self.path).path.removeprefix('/') or 'index.html'
        if not re.fullmatch(r'index\.html|[0-9]{4}-[0-9]{2}-[0-9]{2}\.(?:html|md)', name):
            self.send_error(404)
            return
        path = self.directory / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != self.directory:
            self.send_error(404)
            return
        try:
            data = path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8' if name.endswith('.html') else 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        if body:
            self.wfile.write(data)

    def log_message(self, format, *args):
        # Reading should not generate a second log of message URLs or content.
        pass


def serve_pages(directory, port):
    if not (directory / 'index.html').is_file():
        raise ValueError('no reading pages; run scripts/autonomy build first')
    with ThreadingHTTPServer(('127.0.0.1', port), partial(ReaderHandler, directory=directory)) as server:
        print(f'一家子每日故事：http://127.0.0.1:{server.server_port} （按 Ctrl+C 停止）', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
