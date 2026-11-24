import importlib.util
import io
import json
import os
import stat
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("watchvid", HERE / "watchvid.py")
wv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wv)


class DouyinCookiesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_is_douyin_matches_supported_hosts_only(self):
        for u in (
            "https://v.douyin.com/thOKpXIj0No/",
            "https://www.douyin.com/video/7681297307158202468",
            "https://m.iesdouyin.com/share/video/123456/",
        ):
            self.assertTrue(wv.is_douyin(u), u)
        for u in (
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.bilibili.com/video/BV1xx411c7mD",
            "https://example.com/?next=douyin.com/",
        ):
            self.assertFalse(wv.is_douyin(u), u)

    def test_header_cookie_converted_to_temp_netscape_and_cleaned(self):
        cfile = self.dir / "douyin.cookie"
        cfile.write_text("Cookie: ttwid=abc%3D1; s_v_web_id=verify_xyz; empty=\n", encoding="utf-8")
        with mock.patch.dict(os.environ, {"WATCHVID_DOUYIN_COOKIE": str(cfile)}, clear=False):
            with wv.ytdlp_cookie_args("https://v.douyin.com/thOKpXIj0No/") as args:
                self.assertEqual(len(args), 2)
                self.assertEqual(args[0], "--cookies")
                tmp_cookie = Path(args[1])
                self.assertNotEqual(tmp_cookie, cfile)
                self.assertTrue(tmp_cookie.exists())
                mode = stat.S_IMODE(tmp_cookie.stat().st_mode)
                self.assertEqual(mode, 0o600)
                content = tmp_cookie.read_text(encoding="utf-8")
                self.assertIn("# Netscape HTTP Cookie File", content)
                self.assertIn(".douyin.com\tTRUE\t/\tFALSE\t0\tttwid\tabc%3D1", content)
                self.assertIn(".iesdouyin.com\tTRUE\t/\tFALSE\t0\ts_v_web_id\tverify_xyz", content)
            self.assertFalse(tmp_cookie.exists())

    def test_netscape_cookie_file_uses_temp_copy_preserving_original(self):
        original = "# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tTRUE\t1800000000\ts_v_web_id\tverify_abc\n"
        cfile = self.dir / "douyin.cookie"
        cfile.write_text(original, encoding="utf-8")
        with mock.patch.dict(os.environ, {"WATCHVID_DOUYIN_COOKIE": str(cfile)}, clear=False):
            with wv.ytdlp_cookie_args("https://www.douyin.com/video/7681297307158202468") as args:
                self.assertEqual(args[0], "--cookies")
                tmp_cookie = Path(args[1])
                self.assertNotEqual(tmp_cookie, cfile)
                self.assertEqual(tmp_cookie.read_text(encoding="utf-8"), original)
            self.assertFalse(tmp_cookie.exists())
        self.assertEqual(cfile.read_text(encoding="utf-8"), original)

    def test_non_douyin_ignores_douyin_cookies_and_browser(self):
        cfile = self.dir / "douyin.cookie"
        cfile.write_text("ttwid=secret_val", encoding="utf-8")
        with mock.patch.dict(
            os.environ,
            {"WATCHVID_DOUYIN_COOKIE": str(cfile), "WATCHVID_DOUYIN_BROWSER": "chrome"},
            clear=False,
        ):
            with wv.ytdlp_cookie_args("https://www.youtube.com/watch?v=123") as args:
                self.assertEqual(args, [])

    def test_browser_fallback_when_cookie_file_missing(self):
        missing = self.dir / "missing.cookie"
        with mock.patch.dict(
            os.environ,
            {"WATCHVID_DOUYIN_COOKIE": str(missing), "WATCHVID_DOUYIN_BROWSER": "chrome"},
            clear=False,
        ):
            with wv.ytdlp_cookie_args("https://v.douyin.com/thOKpXIj0No/") as args:
                self.assertEqual(args, ["--cookies-from-browser", "chrome"])

    def test_ytdlp_calls_receive_cookie_args_without_logging_cookie(self):
        cfile = self.dir / "douyin.cookie"
        cfile.write_text("ttwid=super_secret_cookie_val", encoding="utf-8")
        calls = []

        def fake_run(cmd, **kw):
            calls.append(cmd)
            if "-J" in cmd:
                return subprocess.CompletedProcess(
                    cmd, 0, stdout=json.dumps({"id": "7681", "extractor_key": "Douyin", "title": "t"}), stderr=""
                )
            if "-o" in cmd:
                out_arg = cmd[cmd.index("-o") + 1]
                if "--skip-download" in cmd:
                    Path(out_arg + ".zh-Hans.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n")
                else:
                    Path(out_arg).write_bytes(b"mp4")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with mock.patch.dict(os.environ, {"WATCHVID_DOUYIN_COOKIE": str(cfile)}, clear=False):
            with mock.patch.object(wv, "run", side_effect=fake_run), mock.patch.object(wv, "FFMPEG", "/usr/bin/ffmpeg"):
                err = io.StringIO()
                with redirect_stderr(err):
                    info, mid = wv.ytdlp_info("https://v.douyin.com/thOKpXIj0No/")
                    self.assertEqual(mid, "vid-Douyin_7681")
                    out_dir = self.dir / mid
                    out_dir.mkdir()
                    meta, mp4 = wv.ytdlp("https://v.douyin.com/thOKpXIj0No/", info, out_dir)
                    self.assertTrue(mp4.exists())
                    self.assertEqual(meta["site"], "Douyin")
                    lines, lang = wv.site_subtitles(
                        "https://v.douyin.com/thOKpXIj0No/",
                        {"subtitles": {"zh-Hans": [{"ext": "vtt"}]}},
                        "zh-Hans",
                    )
                    self.assertEqual(lang, "zh-Hans")
                    self.assertEqual(len(lines), 1)
                self.assertNotIn("super_secret_cookie_val", err.getvalue())
        self.assertEqual(len(calls), 3)
        for cmd in calls:
            self.assertIn("--cookies", cmd)

    def test_unreadable_or_empty_cookie_file_warns_without_crashing(self):
        cfile = self.dir / "douyin.cookie"
        cfile.write_text("invalid_no_equals", encoding="utf-8")
        err = io.StringIO()
        with mock.patch.dict(os.environ, {"WATCHVID_DOUYIN_COOKIE": str(cfile), "WATCHVID_DOUYIN_BROWSER": ""}, clear=False):
            with redirect_stderr(err):
                with wv.ytdlp_cookie_args("https://v.douyin.com/thOKpXIj0No/") as args:
                    self.assertEqual(args, [])
        self.assertIn("no valid cookies", err.getvalue())
        self.assertNotIn("invalid_no_equals", err.getvalue())

    def test_douyin_cookie_adapter_example(self):
        src = HERE / "watchvid-adapters" / "douyin_cookie.py.example"
        dst = self.dir / "douyin_cookie.py"
        dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        mod_spec = importlib.util.spec_from_file_location("douyin_cookie_adapter", dst)
        mod = importlib.util.module_from_spec(mod_spec)
        mod_spec.loader.exec_module(mod)
        self.assertRegex("https://v.douyin.com/thOKpXIj0No/", mod.MATCH)
        self.assertEqual(mod.media_id("https://www.douyin.com/video/7681297307158202468"), "7681297307158202468")
        urls = mod._pick_video_urls({
            "video": {
                "bit_rate": [
                    {"bit_rate": 900, "play_addr": {"height": 1080, "url_list": ["https://cdn/1080"]}},
                    {"bit_rate": 700, "play_addr": {"height": 720, "url_list": ["https://cdn/720"]}},
                    {"bit_rate": 400, "play_addr": {"height": 540, "url_list": ["https://cdn/540"]}},
                ]
            }
        })
        self.assertEqual(urls, ["https://cdn/720"])
        with mock.patch.dict(os.environ, {"WATCHVID_DOUYIN_COOKIE": str(self.dir / "missing.cookie")}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "Douyin cookie not found"):
                mod.fetch("https://v.douyin.com/thOKpXIj0No/", self.dir)


if __name__ == "__main__":
    unittest.main()
