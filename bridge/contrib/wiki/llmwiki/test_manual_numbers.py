"""#757: the manuals (SOP_*) quote the numbers lint.py holds; the split line is the --warn line."""
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(tempfile.mkdtemp(prefix="wiki-manual-"))
os.environ["WIKI_DIR"] = str(ROOT)
os.environ["WIKI_BRIDGE_CONFIG"] = str(ROOT / "missing.toml")
os.environ["AGENT_SESSIONS_DIR"] = str(ROOT / "sessions")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest as I  # noqa: E402
import lint  # noqa: E402


class ManualNumbers(unittest.TestCase):
    def test_split_line_is_the_warn_line(self):
        self.assertEqual(I.SPLIT_AT, lint.WARN)
        self.assertEqual(lint.SPLIT_AT, lint.WARN)

    def test_manuals_quote_program_values(self):
        for name in [n for n in dir(I) if n.startswith("SOP_") and isinstance(getattr(I, n), str)]:
            self.assertNotRegex(getattr(I, name), r"@[A-Z_]+@", name)
        self.assertIn(f"≤{lint.BODY_LINE} 字", I.SOP_INGEST)
        self.assertIn(f"≥{lint.WARN:.0%}", I.SOP_INGEST)
        self.assertIn(f"{I.SPLIT_TARGET:.0%}", I.SOP_SPLIT)

    def test_no_number_written_into_a_manual(self):
        src = (Path(__file__).resolve().parent / "ingest.py").read_text()
        manuals = "".join(re.findall(r'^SOP_\w+ = (?:persona\()?"""(.*?)"""', src, re.S | re.M))
        self.assertTrue(manuals)
        for value in (f"≤{lint.BODY_LINE}", "70%", f"{lint.WARN:.0%}"):
            self.assertNotIn(value, manuals)

    def test_unknown_setting_name_fails(self):
        with self.assertRaises(KeyError):
            I.manual("≤@NO_SUCH@")


    def test_schema_budget_is_lint_budget(self):
        """#757: the page budget the model reads (template CLAUDE.md) is the one lint.py enforces. SOP v2
        (2026-10-25, merge first, split last; a5b512bbe) raised lint to these numbers; the templates had kept 60/4000."""
        tpl = Path(__file__).resolve().parent.parent / "template"
        want = {"L1": (lint.MAX_TOPICS, lint.README_LINE), "L2": (lint.PAGE_LINES, lint.PAGE_CHARS),
                "L0": (lint.MAX_DOMAINS, lint.INDEX_LINE)}
        for f in (tpl / "CLAUDE.md", tpl / "schema" / "CLAUDE.md", tpl / "schema" / "CLAUDE.zh-CN.md"):
            rows = {l.split("|")[1].split()[0]: l for l in f.read_text().splitlines() if re.match(r"\| L[0-2] ", l)}
            for level, nums in want.items():
                self.assertEqual(tuple(int(n) for n in re.findall(r"≤ (\d+)", rows[level])), nums, f"{f} {level}")
            self.assertIn(f"≤ {lint.BODY_LINE} ", f.read_text(), f)


if __name__ == "__main__":
    unittest.main()
