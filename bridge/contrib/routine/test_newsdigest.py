import importlib.util
import io
import json
import shlex
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
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
    def test_prompt_preserves_shell_paths(self):
        cfg = dict(nd.DEFAULTS, enabled=True)
        path = Path("/review/My News/reader's config.json")
        with patch.object(nd.sys, 'executable', '/review/My Python/python3'), \
             patch.object(nd, '__file__', '/review/My Tools/newsdigest.py'):
            plan = nd.plan_schedule(cfg, path, None, ['bh'], [])
        prompt = plan[0][plan[0].index('--prompt') + 1]
        self.assertEqual(shlex.split(prompt.split('`')[1]),
                         ['/review/My Python/python3', '/review/My Tools/newsdigest.py',
                          'run', '--config', str(path)])

    def test_two_configs_and_targets_do_not_share_jobs(self):
        jobs = {}
        def cron(argv, **kwargs):
            if argv[2] == 'list':
                listing = ''.join(f'  ✅ {key}  0 7 * * *  {job["description"]}\n'
                                  for key, job in jobs.items())
                return SimpleNamespace(returncode=0, stdout=listing)
            if argv[2] == 'add':
                jobs[format(len(jobs) + 1, 'x')] = {
                    'description': argv[argv.index('--desc') + 1],
                    'session_key': argv[argv.index('--session-key') + 1],
                    'prompt': argv[argv.index('--prompt') + 1],
                    'enabled': 'true',
                }
            else:
                jobs[argv[3]][argv[4]] = argv[5]
            return SimpleNamespace(returncode=0)
        def apply(path, session, enabled):
            nd.cmd_schedule(dict(nd.DEFAULTS, enabled=enabled), Path(path), ['bh'], True,
                            ['--project', 'role', '--session-key', session])
        with patch.object(nd.subprocess, 'run', side_effect=cron), redirect_stdout(io.StringIO()):
            apply('/review/A.json', 'qq:A', True)
            apply('/review/B.json', 'qq:B', False)
            self.assertEqual(jobs['1']['enabled'], 'true', 'disabling B must not disable A')
            apply('/review/B.json', 'qq:B', True)
            self.assertEqual(len(jobs), 2)
            self.assertEqual(jobs['2']['session_key'], 'qq:B')
            self.assertIn('/review/B.json', jobs['2']['prompt'])
            apply('/review/B.json', 'qq:B', False)
            self.assertEqual(jobs['1']['enabled'], 'true')
            self.assertEqual(jobs['2']['enabled'], 'false')
            jobs['2']['session_key'] = 'qq:stale'
            jobs['2']['prompt'] = 'stale config'
            apply('/review/B.json', 'qq:B', True)
            self.assertEqual(jobs['2']['session_key'], 'qq:B')
            self.assertIn('/review/B.json', jobs['2']['prompt'])
            self.assertEqual(len(jobs), 2)
            apply('/review/A.json', 'qq:C', True)
            apply('/review/C.json', 'qq:A', True)
            self.assertEqual(len(jobs), 4)

    LIST = ("Scheduled tasks (2):\n\n  ✅ 9db13f69  */7 * * * *  heartbeat\n"
            "  ⏸ 4b7d8de4  0 7 * * *  newsdigest\n")

    def test_find_job_by_description(self):
        description = nd.job_description(Path('/review/A.json'), ['--project', 'role', '--session-key', 'qq:A'])
        self.assertIsNone(nd.find_job(self.LIST, description))
        self.assertEqual(nd.find_job(self.LIST + f'  ✅ ab12  0 7 * * *  {description}\n', description), 'ab12')

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
        self.assertEqual(edit[0], ["bh", "cron", "edit", "ab12", "cron_expr", "30 8 * * *"])
        self.assertEqual(edit[1][:5], ['bh', 'cron', 'edit', 'ab12', 'prompt'])
        self.assertIn('--config /c.json', edit[1][5])
        self.assertEqual(edit[2], ["bh", "cron", "edit", "ab12", "enabled", "true"])

    def test_target_aliases_and_environment_select_same_job(self):
        configs = [
            ({}, ['--project', 'role', '--session-key', 'qq:A']),
            ({}, ['-s', 'qq:A', '-p', 'role']),
            ({}, ['--session', 'qq:A', '--project', 'role']),
            ({'CC_PROJECT': 'role', 'CC_SESSION_KEY': 'qq:A'}, []),
        ]
        descriptions = []
        for env, extra in configs:
            with patch.dict(nd.os.environ, env, clear=True), redirect_stdout(io.StringIO()), \
                 patch.object(nd.subprocess, 'run') as run:
                run.return_value = SimpleNamespace(returncode=0, stdout='')
                nd.cmd_schedule(dict(nd.DEFAULTS, enabled=True), Path('/review/A.json'), ['bh'], True, extra)
                argv = run.call_args.args[0]
                descriptions.append(argv[argv.index('--desc') + 1])
                self.assertEqual(argv[argv.index('--session-key') + 1], 'qq:A')
        self.assertEqual(len(set(descriptions)), 1)

    def test_missing_target_rejected_before_cron_access(self):
        with patch.dict(nd.os.environ, {}, clear=True), patch.object(nd.subprocess, 'run') as run:
            with self.assertRaisesRegex(SystemExit, 'requires --project and --session-key'):
                nd.cmd_schedule(nd.DEFAULTS, Path('/review/A.json'), ['bh'], True, [])
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
