"""consolidate.pinned reads life_page through `bothouse config get projects` (#2051), not its own TOML regex."""
import os, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import consolidate  # noqa: E402


class Pinned(unittest.TestCase):
    def test_life_pages_come_from_the_bridge(self):
        with tempfile.TemporaryDirectory() as d:
            wiki = Path(d) / "wiki"
            (wiki / "bots").mkdir(parents=True)
            fake = Path(d) / "bothouse"
            fake.write_text("#!/bin/sh\n[ \"$1 $2 $3 $4\" = \"config get --config /x/cfg.toml\" ] || exit 9\n"
                            f"echo '[{{\"name\":\"a\",\"life_page\":\"{wiki}/bots/days.md\"}},{{\"name\":\"b\"}},{{\"life_page\":\"/elsewhere/p.md\"}}]'\n")
            fake.chmod(0o755)
            with mock.patch.dict(os.environ, {"CC_BIN": str(fake), "WIKI_BRIDGE_CONFIG": "/x/cfg.toml"}):
                self.assertEqual(consolidate.pinned(wiki), {"bots/days.md"})
                self.assertEqual(consolidate.pinned(wiki / ".ingest-work"), {"bots/days.md"})

    def test_no_bridge_pins_nothing(self):
        with mock.patch.dict(os.environ, {"CC_BIN": "/nonexistent/bothouse"}):
            self.assertEqual(consolidate.pinned("/tmp"), set())


if __name__ == "__main__":
    unittest.main()
