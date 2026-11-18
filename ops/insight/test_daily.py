"""Offline checks: no network, API credentials, bridge events or real sends."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import daily


class DailyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / 'run'
        self.run.mkdir()
        (self.run / 'packet.txt').write_text('offline material')
        (self.root / 'latest-run').write_text(str(self.run))
        (self.root / 'log.md').write_text('previous\n')
        (self.root / 'snapshots').mkdir()
        self.config = self.root / 'config.toml'
        self.config.write_text('''[[projects]]
name = "claude"
[projects.agent.options]
cmd = "offline-claude"
model = "claude-opus-5-5"
provider = "test"
[[projects.agent.providers]]
name = "test"
api_key = "fake-test-key"
base_url = "https://invalid.example"
''')

    def response(self, **changes):
        data = dict(model='claude-opus-5-5', stop_reason='end_turn',
                    content=[{'type': 'text', 'text': '【技术方向】核过的原文'}],
                    usage={'input_tokens': 20000, 'output_tokens': 1000})
        data.update(changes)
        return io.StringIO(json.dumps(data))

    def test_publish_time_excludes_build_time(self):
        self.assertEqual(daily.page_date('<html buildTime="2026-11-18"><time dateTime="2026-09-08T00:00:00-07:00">old</time>'), '2026-09-08T00:00:00-07:00')
        self.assertEqual(daily.page_date('<html buildTime="2026-11-18">copyright 2026-11-18'), '')

    def test_page_excludes_navigation_and_scripts(self):
        self.assertEqual(daily.Page('<nav>hidden</nav><main>article<script>secret</script><p>claim</p></main><footer>hidden</footer>').text, ['article', 'claim'])

    def test_packet_bounds_and_freshness(self):
        source = 'https://official.example/blog/'
        def article(date, text, url='https://official.example/blog/new'):
            return dict(url=url, source=source, date=date, title='technical article', discovery=False, text=text)
        full = dict(window=['2026-11-17T09:30:00+08:00', '2026-11-18T09:30:00+08:00'], sources=[dict(url=source, status='已核')], articles=[article('2026-11-18', '观点\n' * 100000), article('2026-09-08', 'old', 'https://official.example/blog/old')])
        packet = daily.pack(full, '2026-11-17 sent https://official.example/previous')
        self.assertLessEqual(len(packet.encode()), daily.PACKET_BYTES)
        header, records = json.loads(packet)
        self.assertEqual(header['previous_urls'], ['https://official.example/previous'])
        self.assertEqual(len(records), 1)
        self.assertTrue(records[0]['truncated'])
        self.assertGreater(len(records[0]['excerpt']), 1000)

    def test_single_request_keeps_model_and_disables_tools(self):
        with patch.object(daily.urllib.request, 'urlopen', return_value=self.response()) as call:
            daily.summarize(self.root, self.config, self.run)
        request = call.call_args.args[0]
        data = json.loads(request.data)
        self.assertEqual(data['model'], 'claude-opus-5-5')
        self.assertNotIn('tools', data)
        self.assertNotIn('thinking', data)
        self.assertEqual(len(data['messages']), 1)
        self.assertEqual(call.call_count, 1)
        self.assertAlmostEqual(json.loads((self.run / 'model.json').read_text())['total_cost_usd'], 0.1)

    def test_model_error_or_overbudget_never_sends(self):
        for changes in [dict(stop_reason='max_tokens'), dict(stop_reason='tool_use'), dict(usage={'input_tokens': 100000, 'output_tokens': 1000}), dict(content=[]), dict(content=[{'type': 'text', 'text': 'x' * 2001}])]:
            with self.subTest(changes=changes), patch.object(sys, 'argv', ['daily.py', 'run', str(self.root), str(self.config)]), patch.object(daily, 'collect', return_value=self.run), patch.object(daily.urllib.request, 'urlopen', return_value=self.response(**changes)) as api, patch.object(daily.subprocess, 'run') as send:
                with self.assertRaises(RuntimeError):
                    daily.main()
                self.assertEqual(api.call_count, 1)
                send.assert_not_called()
                self.assertEqual((self.root / 'log.md').read_text(), 'previous\n')

    def test_failed_delivery_never_marks_sent(self):
        with patch.object(sys, 'argv', ['daily.py', 'run', str(self.root), str(self.config)]), patch.object(daily, 'collect', return_value=self.run), patch.object(daily.urllib.request, 'urlopen', return_value=self.response()), patch.object(daily.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'offline-send')):
            with self.assertRaises(subprocess.CalledProcessError):
                daily.main()
        self.assertEqual((self.root / 'log.md').read_text(), 'previous\n')
        self.assertTrue((self.run / 'digest.md').exists())

    def test_marks_sent_only_after_delivery(self):
        (self.run / ('a' * 64 + '.txt')).write_text('verified snapshot')
        def send(argv, **kwargs):
            self.assertEqual((self.root / 'log.md').read_text(), 'previous\n')
            return subprocess.CompletedProcess(argv, 0, 'delivered', '')
        with patch.object(sys, 'argv', ['daily.py', 'run', str(self.root), str(self.config)]), patch.object(daily, 'collect', return_value=self.run), patch.object(daily.urllib.request, 'urlopen', return_value=self.response()), patch.object(daily.subprocess, 'run', side_effect=send):
            daily.main()
        self.assertIn('日报发送成功', (self.root / 'log.md').read_text())
        self.assertEqual((self.root / 'snapshots' / ('a' * 64 + '.txt')).read_text(), 'verified snapshot')


if __name__ == '__main__':
    unittest.main()
