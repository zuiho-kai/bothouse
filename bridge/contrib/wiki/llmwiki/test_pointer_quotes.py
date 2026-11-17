"""Pointer guidance and the unchanged source contract; no model calls or file writes."""
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

os.environ["WIKI_DIR"] = "/nonexistent-wiki-pointer-test"
os.environ["WIKI_BRIDGE_CONFIG"] = "/nonexistent-bridge-config"
os.environ["WIKI_CC_CONNECT"] = "/nonexistent-cc-connect"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest as I


class PointerQuotes(unittest.TestCase):
    def test_generation_review_and_saved_fix_explain_exact_exemption(self):
        for prompt in (I.SOP_INGEST, I.SOP_REVIEW, I.FIX):
            with self.subTest(prompt=prompt[:30]):
                self.assertIn("原话见 [[user-requests]]", prompt)
                self.assertIn("裸 PR/任务链接", prompt)
                self.assertIn("updates.source 不能代替正文引文", prompt)
                self.assertNotIn("只有整行纯指针可免引", prompt)

    def test_stable_links_still_require_user_words(self):
        links = ("- [[team-board]]",
                 "- [owner/repo PR #42](https://github.com/owner/repo/pull/42)")
        with mock.patch.object(I, "user_texts", return_value=[I.flat("只改入口卡的样式")]):
            for line in links:
                with self.subTest(line=line):
                    self.assertIn("没有引文", I.claim_msgs([line], lambda: "", [Path("source.jsonl")])[0])
                    self.assertEqual(I.claim_msgs([line + "；用户要求「只改入口卡的样式」"],
                                                 lambda: "", [Path("source.jsonl")]), [])
            self.assertEqual(I.claim_msgs(["- 原话见 [[user-requests]]。"], lambda: "", []), [])
            self.assertIn("没有引文", I.claim_msgs(["- 卡片已修改，原话见 [[user-requests]]。"],
                                                   lambda: "", [Path("source.jsonl")])[0])


if __name__ == "__main__":
    unittest.main()
