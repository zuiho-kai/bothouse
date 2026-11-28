import importlib.util
import io
import os
import sys
import types
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("websearch", HERE / "websearch.py")
ws = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ws)


class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


class Keenable(unittest.TestCase):
    """The keenable search engine and fetch backend, against a stand-in for requests (no network)."""

    def setUp(self):
        self.calls, self.reply = [], FakeResponse(200, {"results": []})
        fake = types.ModuleType("requests")
        fake.post = lambda url, **kw: self.calls.append((url, kw)) or self.reply
        patcher = mock.patch.dict(sys.modules, {"requests": fake})
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, {}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("KEENABLE_API_KEY", None)

    def test_search_keyless(self):
        self.reply = FakeResponse(200, {"results": [
            {"title": "T", "url": "https://a.example/", "description": "", "snippet": "line one\n\n  line two " + "x" * 400},
        ]})
        rows = ws.search("python release", 3, "keenable")
        url, kw = self.calls[0]
        self.assertEqual(url, "https://api.keenable.ai/v1/search/public")
        self.assertEqual(kw["json"], {"query": "python release", "max_results": 3})
        self.assertEqual(kw["headers"], {"X-Keenable-Title": "bothouse"})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["engine"], "keenable")
        self.assertEqual(rows[0]["url"], "https://a.example/")
        self.assertTrue(rows[0]["snippet"].startswith("line one line two x"))
        self.assertEqual(len(rows[0]["snippet"]), 200)

    def test_search_with_key(self):
        os.environ["KEENABLE_API_KEY"] = "k-test"
        ws.search("q", 80, "keenable")
        url, kw = self.calls[0]
        self.assertEqual(url, "https://api.keenable.ai/v1/search")
        self.assertEqual(kw["headers"]["X-API-Key"], "k-test")
        self.assertEqual(kw["json"]["max_results"], 50)

    def test_combines_with_cn(self):
        self.reply = FakeResponse(200, {"results": [{"title": "K", "url": "https://k.example/", "snippet": "k"}]})
        def stub(name):
            def engine(q, n, px):
                return [{"title": name, "url": f"https://{name}.example/", "snippet": ""}]
            engine.__name__ = name
            return engine
        with mock.patch.multiple(ws, so360=stub("so360"), baidu=stub("baidu"), sogou=stub("sogou"), bili=stub("bili")), \
                mock.patch.object(ws, "_cn_proxies", return_value=None):
            rows = ws.search("查询", 6, "keenable+cn")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(sorted(r["engine"] for r in rows), ["baidu", "bili", "keenable", "so360"])

    def test_not_in_auto(self):
        def ddgs(q, n, px=None):
            return [{"title": "d", "url": "https://d.example/", "snippet": ""}]
        def none(q, n, px):
            return []
        with mock.patch.multiple(ws, ddgs=ddgs, so360=none, baidu=none, sogou=none, bili=none), \
                mock.patch.object(ws, "_cn_proxies", return_value=None):
            self.assertEqual([r["engine"] for r in ws.search("english query", 3)], ["ddgs"])
            self.assertEqual([r["engine"] for r in ws.search("中文查询", 3)], ["ddgs"])
        self.assertEqual(self.calls, [])

    def test_error_is_reported_not_raised(self):
        self.reply = FakeResponse(429, {"detail": "rate limited"})
        err = io.StringIO()
        with redirect_stderr(err):
            rows = ws.search("q", 3, "keenable")
        self.assertEqual(rows, [])
        self.assertIn("keenable HTTP 429", err.getvalue())

    def test_fetch_default_is_local(self):
        self.assertEqual(sorted(ws.FETCH_BACKENDS), ["keenable", "local"])
        local = mock.Mock(return_value="page text")
        with mock.patch.dict(ws.FETCH_BACKENDS, {"local": local}):
            self.assertEqual(ws.fetch("https://a.example/"), "page text")
            ws.fetch("https://a.example/", 100)
        self.assertEqual(local.call_args_list, [mock.call("https://a.example/", 6000), mock.call("https://a.example/", 100)])
        self.assertEqual(self.calls, [])

    def test_fetch(self):
        self.reply = FakeResponse(200, {"results": [{"url": "https://a.example/", "content": "# Page\n" + "y" * 100}]})
        text = ws.fetch("https://a.example/", 20, "keenable")
        url, kw = self.calls[0]
        self.assertEqual(url, "https://api.keenable.ai/v1/fetch/public")
        self.assertEqual(kw["json"], {"urls": ["https://a.example/"], "content": {"max_chars": 20}})
        self.assertEqual(text, ("# Page\n" + "y" * 100)[:20])

    def test_fetch_page_error(self):
        self.reply = FakeResponse(200, {"results": [{"url": "https://a.example/", "error": {"status": 404, "message": "not found"}}]})
        with self.assertRaisesRegex(RuntimeError, "not found"):
            ws.fetch("https://a.example/", 100, "keenable")


if __name__ == "__main__":
    unittest.main()
