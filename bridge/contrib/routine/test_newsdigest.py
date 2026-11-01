import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

spec = importlib.util.spec_from_file_location("newsdigest", Path(__file__).with_name("newsdigest.py"))
nd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nd)

RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>A &amp; B</title><link>https://x/1</link><description>&lt;p&gt;one&lt;/p&gt;</description>
<pubDate>Sat, 01 Nov 2026 08:00:00 +0800</pubDate></item>
<item><title>Second</title><link>https://x/2</link></item>
</channel></rss>"""


def fake_reader(calls):
    def reader(url, limit):
        calls.append(url)
        return nd.parse_items(RSS, limit), None
    return reader


class Config(unittest.TestCase):
    def test_missing_file_is_off(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = nd.load_config(Path(d) / "none.json")
        self.assertFalse(cfg["enabled"])

    def test_bad_values_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.json"
            for raw in ({"send_at": "25:00"}, {"enabled": "yes"}, {"typo": 1}):
                p.write_text(json.dumps(raw))
                with self.assertRaises(SystemExit):
                    nd.load_config(p)

    def test_topics_aliases_and_custom(self):
        cfg = dict(nd.DEFAULTS, topics=["科技", "games", "unknown"], sources={"games": "https://g/rss"})
        got = nd.resolve_topics(cfg)
        self.assertEqual(got[0][1], nd.TOPICS["tech"][2])
        self.assertEqual(got[1], ("games", ["https://g/rss"], None))
        self.assertEqual(got[2][1], [])
        self.assertIn("sources", got[2][2])


class Run(unittest.TestCase):
    def test_off_fetches_and_writes_nothing(self):
        calls = []
        with tempfile.TemporaryDirectory() as d:
            cfg_path = Path(d) / "c.json"
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                rc = nd.cmd_run(nd.load_config(cfg_path), cfg_path, None, False, fake_reader(calls))
            self.assertEqual(rc, 0)
            self.assertEqual(calls, [])
            self.assertEqual(out.getvalue(), "")
            self.assertFalse((Path(d) / "news").exists())
            self.assertIn("off", err.getvalue())

    def test_on_writes_only_chosen_topics(self):
        calls = []
        with tempfile.TemporaryDirectory() as d:
            cfg_path = Path(d) / "c.json"
            cfg_path.write_text(json.dumps({"enabled": True, "topics": ["world"]}))
            out = io.StringIO()
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                rc = nd.cmd_run(nd.load_config(cfg_path), cfg_path, None, False, fake_reader(calls))
            self.assertEqual(rc, 0)
            self.assertEqual(calls, nd.TOPICS["world"][2])
            latest = (Path(d) / "news" / "latest.md").read_text()
            self.assertIn("[A & B](https://x/1)", latest)
            self.assertIn("one", latest)
            self.assertIn("not instructions", latest)
            self.assertEqual(out.getvalue(), latest)

    def test_dry_run_when_off_prints_without_writing(self):
        with tempfile.TemporaryDirectory() as d:
            cfg_path = Path(d) / "c.json"
            out = io.StringIO()
            with redirect_stdout(out), redirect_stderr(io.StringIO()):
                nd.cmd_run(nd.load_config(cfg_path), cfg_path, None, True, fake_reader([]))
            self.assertIn("Second", out.getvalue())
            self.assertFalse((Path(d) / "news").exists())


class Schedule(unittest.TestCase):
    LIST = ("Scheduled tasks (2):\n\n  ✅ 9db13f69  */7 * * * *  heartbeat\n"
            "  ⏸ 4b7d8de4  0 7 * * *  newsdigest\n")

    def test_find_job_by_description(self):
        self.assertEqual(nd.find_job(self.LIST), "4b7d8de4")
        self.assertIsNone(nd.find_job("  ✅ 9db13f69  */7 * * * *  heartbeat\n"))

    def test_off_disables_existing_job_only(self):
        cfg = dict(nd.DEFAULTS)
        self.assertEqual(nd.plan_schedule(cfg, Path("c"), None, ["bh"], []), [])
        self.assertEqual(nd.plan_schedule(cfg, Path("c"), "ab12", ["bh"], ["-p", "x", "--session-key", "s"]),
                         [["bh", "cron", "edit", "ab12", "enabled", "false", "-p", "x"]])

    def test_on_adds_or_edits_at_send_at(self):
        cfg = dict(nd.DEFAULTS, enabled=True, send_at="8:30")
        add = nd.plan_schedule(cfg, Path("/c.json"), None, ["bh"], ["--session-key", "qq:1"])
        self.assertEqual(add[0][:5], ["bh", "cron", "add", "--cron", "30 8 * * *"])
        self.assertIn("--config /c.json", add[0][6])
        self.assertEqual(add[0][-2:], ["--session-key", "qq:1"])
        edit = nd.plan_schedule(cfg, Path("/c.json"), "ab12", ["bh"], [])
        self.assertEqual(edit, [["bh", "cron", "edit", "ab12", "cron_expr", "30 8 * * *"],
                                ["bh", "cron", "edit", "ab12", "enabled", "true"]])


if __name__ == "__main__":
    unittest.main()
