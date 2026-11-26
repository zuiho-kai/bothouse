"""Every llmwiki tool takes its wiki from wikiroot.py (#2064: six tools each worked it out with resolve(), and when
~/wiki/bin/*.py became links to the bridge's installed copy they all looked in ~/.bothouse/wiki)."""
import os, re, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
OWN_ROOT = re.compile(r"^WIKI\s*=\s*Path\(__file__\)|__file__\)\.resolve\(\)\.parent\.parent", re.M)


class WikiRoot(unittest.TestCase):
    def test_no_tool_works_out_its_own(self):
        bad = [f.name for f in HERE.glob("*.py") if not f.name.startswith("test_") and OWN_ROOT.search(f.read_text())]
        self.assertEqual(bad, [], "take WIKI from wikiroot.wiki_root(__file__, __name__)")

    def test_linked_script_uses_the_wiki_that_holds_the_link(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "bin").mkdir()
            link = Path(d) / "bin" / "probe.py"
            probe = Path(d) / "probe_src.py"
            probe.write_text(f"import sys; sys.path.insert(0, {str(HERE)!r})\nfrom wikiroot import wiki_root\n"
                             "print(wiki_root(__file__, __name__))\n")
            link.symlink_to(probe)
            env = {k: v for k, v in os.environ.items() if k != "WIKI_DIR"}
            out = subprocess.run([sys.executable, "-I", str(link)], capture_output=True, text=True, env=env).stdout
            self.assertEqual(out.strip(), str(Path(d)))

    def test_imported_follows_wiki_dir_else_home(self):
        code = "import sys; sys.path.insert(0, %r); import lint; print(lint.WIKI)" % str(HERE)
        env = {k: v for k, v in os.environ.items() if k != "WIKI_DIR"}
        home = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True, env=env).stdout
        self.assertEqual(home.strip(), str(Path.home() / "wiki"))
        env["WIKI_DIR"] = "/tmp/x-wiki"
        self.assertEqual(subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True,
                                        env=env).stdout.strip(), "/tmp/x-wiki")


if __name__ == "__main__":
    unittest.main()
