"""Exercise the build/package boundaries without compiling or signing an app."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DashboardBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.work = Path(self.tmp.name)
        self.tools = self.work / "tools"
        self.tools.mkdir()
        self.env = dict(os.environ, PATH=f"{self.tools}:{os.environ['PATH']}")
        self.env["HOME"] = str(self.work)
        self.env.pop("MAKEFLAGS", None)
        self.env.pop("NO_WEB", None)
        self.env.pop("EXCLUDE", None)
        self.write_tool("go", '''#!/bin/sh
printf '%s\\n' "$@" > go-args.txt
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; printf 'API-only candidate\\n' > "$1"; exit 0; fi
  shift
done
exit 1
''')

    def write_tool(self, name, contents):
        path = self.tools / name
        path.write_text(contents)
        path.chmod(0o755)
        return path

    def make(self, *args):
        return subprocess.run(
            ["make", "-f", str(ROOT / "bridge/Makefile"), "-o", "web", "-o", "hubsrc", *args],
            cwd=self.work, env=self.env, capture_output=True, text=True,
        )

    def test_noweb_build_preserves_dashboard_binary(self):
        dashboard = self.work / "bothouse"
        dashboard.write_text("installed dashboard candidate")
        result = self.make("build-noweb", "EXCLUDE=discord")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(dashboard.read_text(), "installed dashboard candidate")
        self.assertTrue((self.work / "bothouse-noweb").is_file())
        args = (self.work / "go-args.txt").read_text().splitlines()
        tags = args[args.index("-tags") + 1].split()
        self.assertIn("no_web", tags)
        self.assertIn("no_discord", tags)
        self.assertIn("goolm", tags)
        self.assertEqual(args.count("-tags"), 1)

    def test_dashboard_build_rejects_web_exclusion(self):
        for setting in ("NO_WEB=1", "EXCLUDE=web"):
            with self.subTest(setting=setting):
                result = self.make("build", setting)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("build-noweb", result.stdout + result.stderr)
                self.assertFalse((self.work / "go-args.txt").exists())

    def test_dashboard_build_keeps_web(self):
        result = self.make("build")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.work / "bothouse").is_file())
        args = (self.work / "go-args.txt").read_text().splitlines()
        self.assertNotIn("no_web", args[args.index("-tags") + 1].split())

    def test_packaging_rejects_noweb_before_touching_stage(self):
        self.write_tool("lipo", "#!/bin/sh\nexit 0\n")
        for tool in ("security", "codesign", "hdiutil"):
            self.write_tool(tool, "#!/bin/sh\necho 'unexpected packaging side effect' >&2\nexit 97\n")
        candidate = self.work / "bothouse-candidate"
        candidate.write_text('''#!/bin/sh
test "$1 $2" = 'web --check' || exit 99
echo 'Web admin is not available: no_web' >&2
exit 1
''')
        candidate.chmod(0o755)
        stage = self.work / "stage"
        stage.mkdir()
        sentinel = stage / "keep.txt"
        sentinel.write_text("untouched")
        for binary in (str(candidate), candidate.name):
            with self.subTest(binary=binary):
                result = subprocess.run(
                    ["bash", str(ROOT / ".github/release-check/package-dmg.sh"), binary,
                     str(self.work / "output.dmg"), "v0.0.0-test", str(stage)],
                    cwd=self.work, env=self.env, capture_output=True, text=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("no_web", result.stderr)
                self.assertTrue(sentinel.is_file(), "packaging changed staging before checking web assets")
                self.assertFalse((stage / "Bothouse.app").exists())


if __name__ == "__main__":
    unittest.main()
