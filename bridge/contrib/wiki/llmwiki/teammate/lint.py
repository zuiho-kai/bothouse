#!/usr/bin/env python3
"""This wiki is checked by the shared linter, 橘's ~/wiki/bin/lint.py (one code for every wiki, user 2026-10-20
「不要区分」). A copy of ~/wiki/bin/teammate/lint.py: test_ingest.py (TeammateShims) fails when a copy differs."""
import os, sys
from pathlib import Path

wiki = Path(__file__).resolve().parent.parent
tool = Path(os.environ.get("WIKI_BIN") or Path.home() / "wiki" / "bin") / "lint.py"
# an older ~/wiki/bin (before config.json / --root) would run 橘's settings on this wiki: refuse, don't forward
if "\nSHARED_TOOL = 1" not in (tool.read_text() if tool.exists() else ""):
    sys.exit(f"{tool} is not the shared tool (no SHARED_TOOL marker: ~/wiki not merged or rolled back); not running it")
os.execv(sys.executable, [sys.executable, "-X", "utf8", "-I", str(tool), *sys.argv[1:], "--root", str(wiki)])
