"""#2047 第 11 条：模型输入上限在 wiki（llmwiki/budget.py）和 gate（score_night.py）各一处，两边必须一样。"""
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import score_night  # noqa: E402


class WikiLimits(unittest.TestCase):
    def test_max_chars_same_as_wiki(self):
        src = (HERE.parent / "wiki" / "llmwiki" / "budget.py").read_text(encoding="utf-8")
        m = re.search(r"^MAX_CHARS = ([\d_]+)", src, re.M)
        self.assertIsNotNone(m, "budget.py 没有 MAX_CHARS")
        want = int(m.group(1).replace("_", ""))
        self.assertEqual(want, score_night.MAX_CHARS)
        for f in ("invalidate.py", "profiles.py", "manuals.py"):
            m2 = re.search(r"^MAX_CHARS = ([\d_]+)", (HERE.parent / "wiki" / "llmwiki" / f).read_text(encoding="utf-8"), re.M)
            self.assertIsNotNone(m2, f)
            self.assertEqual(int(m2.group(1).replace("_", "")), want, f)


if __name__ == "__main__":
    unittest.main()
