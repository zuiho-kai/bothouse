#!/usr/bin/env python3
"""Fact search over this wiki with the shared tool, 橘's ~/wiki/bin/search.py (user 2026-10-20 「不要区分」).
A copy of ~/wiki/bin/teammate/search.py: test_ingest.py (TeammateShims) fails when a copy differs."""
import os, sys
from pathlib import Path

wiki = Path(__file__).resolve().parent.parent
tool = Path(os.environ.get("WIKI_BIN") or Path.home() / "wiki" / "bin") / "search.py"
# an older ~/wiki/bin (before config.json / --root) would run 橘's settings on this wiki: refuse, don't forward
if "\nSHARED_TOOL = 1" not in (tool.read_text() if tool.exists() else ""):
    sys.exit(f"{tool} is not the shared tool (no SHARED_TOOL marker: ~/wiki not merged or rolled back); not running it")
os.execv(sys.executable, [sys.executable, "-I", str(tool), "--root", str(wiki), *sys.argv[1:]])
