from functools import partial
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from threading import Thread

from autonomy.reader_server import ReaderHandler


def test_reader_serves_only_generated_pages_and_blocks_scripts(tmp_path):
    public = tmp_path / 'journal'
    public.mkdir()
    (public / 'index.html').write_text('<h1>每日故事</h1>')
    (public / '2026-10-16.md').write_text('原话')
    private = tmp_path / 'secret.txt'
    private.write_text('private')
    (public / '2026-10-15.html').symlink_to(private)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(ReaderHandler, directory=public))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for path, expected in [('/', 200), ('/2026-10-16.md', 200), ('/../secret.txt', 404),
                               ('/%2e%2e/secret.txt', 404), ('/2026-10-15.html', 404),
                               ('/artifacts/', 404), ('/config.json', 404), ('/index.html.new', 404)]:
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request('GET', path)
                response = connection.getresponse()
                content = response.read().decode()
                assert response.status == expected, path
                assert 'private' not in content
                if expected == 200:
                    assert "default-src 'none'" in response.getheader('Content-Security-Policy')
                    assert response.getheader('Cache-Control') == 'no-store'
            finally:
                connection.close()
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()
