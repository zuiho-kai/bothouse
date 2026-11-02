import importlib.util
import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('_recall', Path(__file__).with_name('_recall.py'))
recall = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recall)


class RecallTests(unittest.TestCase):
    def test_gather_includes_attributed_channel_feedback(self):
        rows = [('频道 彩虹猫 @discord:1 caihongmao/s1 2026-11-01 02:48', '【队友原话：彩虹猫】ASCII 架构图太土，不要用字符图')]
        with patch.object(recall, 'channel_hits', return_value=rows, create=True), patch.object(recall, 'wiki_hits', return_value=[]), patch.object(recall, 'session_ids', return_value=[]):
            self.assertEqual(recall.gather(['架构图'], '2026-11-01T04:00:00'), rows)

    def test_channel_filters_time_system_and_preserves_author(self):
        records = [
            ('2026-11-01T11:48:00.74905+09:00', '彩虹猫', 'ASCII 架构图太土', 'discord:1', 'caihongmao/s1'),
            ('2026-11-01T02:49:00Z', '用户:张三', '不要这种架构图', 'discord:1', 'maomao/s1'),
            ('2026-11-01T02:49:00Z', '用户/系统', '[Bridge] 架构图', 'discord:1', 'maomao/s1'),
            ('2026-11-01T02:49:00Z', '彩虹猫', '⏰ 架构图定时提醒', 'discord:1', 'caihongmao/s1'),
            ('2026-11-01T05:00:00Z', '龙娘', '未来的架构图', 'discord:1', 'longniang/s1'),
        ]
        with patch.object(recall, 'channel_records', return_value=iter(records)):
            rows = recall.channel_hits(['架构图'], '2026-11-01T04:00:00Z')
        self.assertEqual(len(rows), 2)
        self.assertIn('彩虹猫', rows[0][0])
        self.assertIn('【队友原话：彩虹猫】', rows[0][1])
        self.assertIn('【用户原话：用户:张三】', rows[1][1])
        self.assertIn('不是用户定案', recall.PICK_SYSTEM)

    def test_chanlog_reads_bot_history_and_append_keeps_attribution(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'sessions').mkdir()
            (root / 'sessions' / 'caihongmao_test.json').write_text(json.dumps({
                'user_sessions': {'discord:1': ['s1']},
                'sessions': {'s1': {'history': [
                    {'role': 'assistant', 'timestamp': '2026-11-01T02:48:00Z', 'content': 'ASCII 架构图太土'},
                    {'role': 'user', 'timestamp': '2026-11-01T02:49:00Z', 'content': '[Bridge] 架构图系统注入'},
                ]}},
            }))
            with patch.dict(recall.channel_records.__globals__, {'DATA': root}):
                rows = recall.channel_hits(['架构图'], '2026-11-01T04:00:00Z')
            self.assertEqual(len(rows), 1)
            self.assertIn('caihongmao/s1', rows[0][0])
            notes = root / 'handoff.md'
            notes.write_text('# 总目标\n换架构图\n')
            with patch.object(recall, 'old_decisions', return_value=['队友意见（彩虹猫）：' + rows[0][1] + '——' + rows[0][0]]):
                recall.append_to(notes)
                self.assertIsNone(recall.append_to(notes))
            self.assertIn('队友意见（彩虹猫）', notes.read_text())
            self.assertEqual(notes.read_text().count('## ' + recall.SECTION), 1)


if __name__ == '__main__':
    unittest.main()
