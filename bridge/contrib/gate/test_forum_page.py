"""记忆论坛页的帖子标题（forum_page.title_of）和楼层帖一楼标题重算（forum_threads.title_for）：python3 -I contrib/gate/test_forum_page.py"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import forum_page, forum_threads  # noqa: E402


class Title(unittest.TestCase):
    def test_no_break_inside_brackets_or_quotes(self):  # #1187：括号、引号里的句号不断开
        self.assertEqual(forum_page.title_of("- 发版用（先合 main。再打 tag）流水线。后面是正文"),
                         ("发版用（先合 main。再打 tag）流水线", "后面是正文"))
        self.assertEqual(forum_page.title_of("- 用户说「别停。继续」然后走了。第二句"), ("用户说「别停。继续」然后走了", "第二句"))

    def test_no_break_in_url_or_time(self):
        self.assertEqual(forum_page.title_of("- 看 https://x.com/a 的时间 09:30。后面"), ("看 https://x.com/a 的时间 09:30", "后面"))

    def test_long_head_without_break_stays_whole(self):  # 用户定「标题不要截断」：找不到括号外断点整句当标题
        t = "很长" * 40
        self.assertEqual(forum_page.title_of(f"- 「{t}，里面」"), (f"「{t}，里面」", ""))

    def test_thread_title_cut_from_floor_text_is_recomputed(self):
        line = "- 发版用（先合 main。再打 tag）流水线。后面是正文"
        self.assertEqual(forum_threads.title_for({"title": "发版用（先合 main"}, line), "发版用（先合 main。再打 tag）流水线")
        self.assertEqual(forum_threads.title_for({"title": "发版怎么走？"}, line), "发版怎么走？")  # 模型起的问句原样留


if __name__ == "__main__":
    unittest.main()
