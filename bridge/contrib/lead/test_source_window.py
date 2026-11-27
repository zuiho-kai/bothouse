"""_source._window_start：原话节写成几级标题都从里面最早的时刻起算（#2089：11-25 停活通知那件写成「# 用户原话」，
时间窗退成交活前 3 小时，漏了用户 01:08「通过更多状态去管理」）。"""
import datetime as dt, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _source  # noqa: E402


class WindowStartTest(unittest.TestCase):
    def setUp(self):
        now = dt.datetime.now().astimezone()
        self.said = (now - dt.timedelta(hours=10)).replace(second=0, microsecond=0)
        self.stamp = f"{self.said:%m-%d %H:%M}"

    def check(self, head):
        text = f"{head}\n（{self.stamp} 秘书频道）「不是通过更多状态去管理吗」\n\n# 总目标\nx\n"
        self.assertEqual(_source._window_start(text), self.said - dt.timedelta(minutes=10))

    def test_h1_quote_section(self):
        self.check("# 用户原话")

    def test_h2_quote_section(self):
        self.check("## 用户原话")

    def test_stamp_outside_quote_section_ignored(self):
        text = f"# 用户原话\n「x」\n\n# 范围\n- 改：{self.stamp} 那件\n"
        start = _source._window_start(text)
        self.assertLess(abs(start - (dt.datetime.now().astimezone() - dt.timedelta(hours=3))), dt.timedelta(minutes=1))


if __name__ == "__main__":
    unittest.main()
