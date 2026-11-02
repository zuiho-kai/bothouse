import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("watchvid", HERE / "watchvid.py")
wv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wv)

GOOD = '''
MATCH = r"example\\.com/v/"
def media_id(url): return url.rsplit("/", 1)[-1]
def fetch(url, d):
    (d / "video.mp4").write_bytes(b"x")
    return {"title": "t"}
'''


class Adapters(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_loads_good_skips_broken(self):
        (self.dir / "good.py").write_text(GOOD)
        (self.dir / "nomatch.py").write_text("def fetch(url, d): pass\n")
        (self.dir / "syntax.py").write_text("MATCH = (\n")
        (self.dir / "off.py.example").write_text(GOOD)
        err = io.StringIO()
        with redirect_stderr(err):
            ads = wv.load_adapters([self.dir, self.dir / "missing"])
        self.assertEqual([a.NAME for a in ads], ["good"])
        self.assertIn("nomatch.py skipped", err.getvalue())
        self.assertIn("syntax.py skipped", err.getvalue())

    def test_pick_and_fetch(self):
        (self.dir / "good.py").write_text(GOOD)
        with redirect_stderr(io.StringIO()):
            ads = wv.load_adapters([self.dir])
        self.assertIsNone(wv.pick_adapter("https://www.bilibili.com/video/BV1xx", ads))
        ad = wv.pick_adapter("https://example.com/v/42", ads)
        self.assertEqual(wv.adapter_id(ad, "https://example.com/v/42"), "ad-good_42")
        out = self.dir / "out"
        out.mkdir()
        meta, mp4 = wv.via_adapter(ad, "https://example.com/v/42", out)
        self.assertEqual(mp4, out / "video.mp4")
        self.assertEqual(meta, {"title": "t", "site": "good", "url": "https://example.com/v/42"})

    def test_fetch_without_video_stops(self):
        (self.dir / "bad.py").write_text('MATCH = "x"\ndef fetch(url, d): return {}\n')
        with redirect_stderr(io.StringIO()):
            ad = wv.load_adapters([self.dir])[0]
            with self.assertRaises(SystemExit):
                wv.via_adapter(ad, "x", self.dir)

    def test_douyin_example_matches_and_explains(self):
        src = HERE / "watchvid-adapters" / "douyin.py.example"
        (self.dir / "douyin.py").write_text(src.read_text())
        with redirect_stderr(io.StringIO()):
            ad = wv.load_adapters([self.dir])[0]
        for url in ("https://v.douyin.com/abcd/", "https://www.douyin.com/video/7300000000000000000"):
            self.assertIs(wv.pick_adapter(url, [ad]), ad)
        self.assertIsNone(wv.pick_adapter("https://www.youtube.com/watch?v=x", [ad]))
        self.assertEqual(ad.media_id("https://www.douyin.com/video/7300000000000000000"), "7300000000000000000")
        err = io.StringIO()
        with redirect_stderr(err), self.assertRaises(SystemExit):
            wv.via_adapter(ad, "https://v.douyin.com/abcd/", self.dir)
        self.assertIn("not set up", err.getvalue())


if __name__ == "__main__":
    unittest.main()
