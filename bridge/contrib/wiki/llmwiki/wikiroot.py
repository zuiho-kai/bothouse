"""The one place every llmwiki tool gets the wiki it works on (#2064).

Run as a script: the wiki whose bin/ holds it. A link there counts (absolute, not resolve): ~/wiki/bin/lint.py may be a
link to the shared copy the bridge installs, and following the link would land on the install directory, not a wiki.
Imported (ingest.py, restate.py ... import each other): WIKI_DIR, else ~/wiki.
New tools take WIKI from here; test_wikiroot.py fails a tool that works out its own."""
import os
from pathlib import Path

HOME_WIKI = Path.home() / "wiki"


def wiki_root(file, name):
    """`file`, `name`: the calling module's __file__ and __name__."""
    if name == "__main__":
        return Path(file).absolute().parent.parent
    return Path(os.environ.get("WIKI_DIR") or HOME_WIKI)
