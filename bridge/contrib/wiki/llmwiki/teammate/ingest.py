#!/usr/bin/env python3
"""This wiki runs the shared tool, 橘's ~/wiki/bin/ingest.py (user 2026-10-20 「让他们和你一样的待遇，不要区分」);
config.json next to MEMORY.md says whose wiki this is. A copy of ~/wiki/bin/teammate/ingest.py: test_ingest.py
(TeammateShims) fails when a teammate wiki's copy differs. The own copy this replaced: git show legacy-ingest:bin/ingest.py"""
import os, sys
from pathlib import Path

wiki = Path(__file__).resolve().parent.parent
shared = Path(__file__).resolve().parent / ".shared-bin"  # setup_wiki.py: the main wiki's bin/ when not ~/wiki
tool = Path(os.environ.get("WIKI_BIN") or (shared.read_text().strip() if shared.exists() else "")
            or Path.home() / "wiki" / "bin") / "ingest.py"
# an older ~/wiki/bin (before config.json / --root) would run 橘's settings on this wiki: refuse, don't forward
if "\nSHARED_TOOL = 1" not in (tool.read_text() if tool.exists() else ""):
    sys.exit(f"{tool} is not the shared tool (no SHARED_TOOL marker: ~/wiki not merged or rolled back); not running it")
os.environ["WIKI_DIR"] = str(wiki)
os.execv(sys.executable, [sys.executable, "-X", "utf8", "-I", str(tool), *sys.argv[1:]])
