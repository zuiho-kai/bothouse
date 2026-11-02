#!/usr/bin/env python3
"""SessionEnd (global install, core/global_hooks.go): hand the closing session to the memory wiki's own
`bin/ingest.py --hook` (WIKI_DIR, default ~/wiki), the same entry a hand-made SessionEnd hook uses
(docs/ccm-and-wiki.md step 4). No wiki = nothing happens. ingest.py returns at once and ingests in the background.
Any error exits 0 silently: this hook must never hold up the end of a session."""
import os, subprocess, sys
from pathlib import Path


def main():
    wiki = Path(os.environ.get("WIKI_DIR") or Path.home() / "wiki").expanduser()
    ingest = wiki / "bin" / "ingest.py"
    if not ingest.is_file() or os.environ.get("WIKI_INGEST"):
        return
    subprocess.run([sys.executable, "-X", "utf8", "-I", str(ingest), "--hook"], input=sys.stdin.buffer.read(),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8)  # 来源：hook timeout 10 s, 留 2 s


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
