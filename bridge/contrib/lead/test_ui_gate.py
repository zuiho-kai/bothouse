"""#2042：界面活的用户视角走查在交回时按实际改动文件查（_ui_gate.py），不看交接字眼。"""
import subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ui_gate as g  # noqa: E402


def git(d, *a):
    subprocess.run(["git", *a], cwd=d, check=True, capture_output=True)


class UIGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(dir=Path.home() / "work")) if (Path.home() / "work").is_dir() else Path(tempfile.mkdtemp())
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
        git(self.repo, "update-ref", "refs/remotes/origin/develop", "HEAD")
        (self.repo / "a.py").write_text("x")
        self.draft = self.tmp / "d.md"

    def tearDown(self):
        subprocess.run(["rm", "-rf", str(self.tmp)])

    def test_kv_layout_backend_change_passes(self):
        self.draft.write_text(f"交接写 KV 布局；改动在 {self.repo}/a.py:1")
        self.assertIsNone(g.report_block(self.draft))

    def test_ui_change_needs_screenshot(self):
        (self.repo / "web").mkdir()
        (self.repo / "web" / "App.tsx").write_text("x")
        self.draft.write_text(f"改动在 {self.repo}")
        self.assertIn("web/App.tsx", g.report_block(self.draft) or "")
        self.assertIsNone(g.report_block(self.draft, ["--image", "/x/after.png"]))
        shot = self.tmp / "after.png"
        shot.write_bytes(b"x")
        self.draft.write_text(f"改动在 {self.repo}，截图 {shot}")
        self.assertIsNone(g.report_block(self.draft))

    def test_no_change_info_passes(self):
        self.draft.write_text("没写改动在哪")
        self.assertIsNone(g.report_block(self.draft))


if __name__ == "__main__":
    unittest.main()
