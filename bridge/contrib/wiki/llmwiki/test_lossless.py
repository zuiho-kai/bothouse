"""lossless.py: the four credibility markers at a line end are metadata (#1486) — tagging an old line or correcting
its tag is not a loss, any other change of the wording still is; a line moved verbatim into 「## 历史」 is kept.
Run: python3 -I bridge/contrib/wiki/llmwiki/test_lossless.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lossless  # noqa: E402

OLD = """---
name: page
description: fixture
---
# 页

## 现状
- 用户定：先做 A（11-01）。
- 助手觉得 B 更好（推论）。
- 数字 17 是实测。

## 历史
- 曾以为 C → 改为 D（11-02）。
"""


class TagIsMetadata(unittest.TestCase):
    def miss(self, new):
        return lossless.missing({"page.md": OLD}, {"page.md": new})

    def test_tagging_an_old_line_is_not_a_loss(self):
        new = OLD.replace("- 用户定：先做 A（11-01）。", "- 用户定：先做 A（11-01）。（推测）")
        self.assertEqual(self.miss(new), [])

    def test_correcting_a_tag_is_not_a_loss(self):
        new = OLD.replace("- 助手觉得 B 更好（推论）。", "- 助手觉得 B 更好（判断）。")
        self.assertEqual(self.miss(new), [])

    def test_removing_a_word_is_still_a_loss(self):
        new = OLD.replace("先做 A（11-01）", "先做（11-01）")
        self.assertTrue(self.miss(new))

    def test_new_wording_with_a_tag_is_a_loss(self):
        new = OLD.replace("- 用户定：先做 A（11-01）。", "- 用户定：先做 Z（11-01）。（推论）")
        self.assertTrue(self.miss(new))

    def test_line_moved_verbatim_into_history_is_kept(self):
        new = OLD.replace("- 用户定：先做 A（11-01）。\n", "")
        new = new.replace("## 历史\n", "## 历史\n- 用户定：先做 A（11-01）。\n")
        self.assertEqual(self.miss(new), [])

    def test_marker_inside_the_text_is_not_stripped(self):
        old = OLD.replace("- 数字 17 是实测。", "- 数字 17（推论）是实测。")
        new = old.replace("- 数字 17（推论）是实测。", "- 数字 17 是实测。")
        self.assertTrue(lossless.missing({"page.md": old}, {"page.md": new}))

    def test_floor_tag_with_marker_before_it(self):
        old = OLD.replace("- 数字 17 是实测。", "- 数字 17 是实测。 <!-- 帖 t29accdfd1f·2楼 -->")
        new = old.replace("- 数字 17 是实测。 <!-- 帖 t29accdfd1f·2楼 -->",
                          "- 数字 17 是实测。（推测） <!-- 帖 t29accdfd1f·2楼 -->")
        self.assertEqual(lossless.missing({"page.md": old}, {"page.md": new}), [])


SENT = "第{0}条写在这里，把当时看到的现象和最后的结论都记全，一句接一句，长度差不多够一整段了。"
SPLIT_LINE = "- 长行：" + "".join(SENT.format(i) for i in range(1, 10)) + "收尾。"


class SplitKeepsThePeriodAtTheCut(unittest.TestCase):
    """#2103: norm() takes the last 「。」 off every line (TRAIL), so the page copy of a line lint.wrap() cut right after
    a sentence is one character shorter than the old line. That 「。」 is content, not the old line's own end: the split
    must still count as the old line (lint --wrap then git commit no longer rejected), and any other change still lost."""

    def check(self, new_lines, kept):
        old = f"# P\n{SPLIT_LINE}\n"
        new = "# P\n" + "\n".join(new_lines) + "\n"
        miss = lossless.missing({"p.md": old}, {"p.md": new})
        self.assertEqual(miss == [], kept, miss)

    def test_wrap_cut_after_a_period_is_kept(self):
        import lint
        parts = lint.wrap(SPLIT_LINE)
        self.assertGreater(len(parts), 1)
        self.assertTrue(any(p.endswith("。") for p in parts[:-1]), parts)  # a cut sits right after a 「。」
        self.check(parts, True)

    def test_a_dropped_piece_is_still_lost(self):
        import lint
        self.check(lint.wrap(SPLIT_LINE)[:-1], False)

    def test_one_character_changed_is_still_lost(self):
        import lint
        self.check([p.replace("结论", "结果") for p in lint.wrap(SPLIT_LINE)], False)


if __name__ == "__main__":
    unittest.main()
