#!/usr/bin/env python3 -I
"""Seconds-fast checks of bin/hooks/pre-commit and bin/install-hooks.sh on a fake wiki repo (temp dir); no model calls.

  python3 -I bin/test_precommit.py
"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

BIN = Path(__file__).resolve().parent
ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_AUTHOR_NAME": "t",
       "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
PAGE = "---\nname: p\ndescription: d\n---\n# P\n## 关键事实\n- 事实甲\n- 事实乙\n"


def put(root, rel, text):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = Path(self.tmp.name) / "wiki"
        self.w.mkdir()
        self.sh("git", "init", "-q")
        r = self.sh("zsh", str(BIN / "install-hooks.sh"), str(self.w))
        self.assertEqual(r.returncode, 0, r.stderr)

    def tearDown(self):
        self.tmp.cleanup()

    def sh(self, *a, cwd=None):
        return subprocess.run(a, cwd=cwd or self.w, env=ENV, capture_output=True, text=True)

    def commit(self, msg="c", cwd=None):
        self.sh("git", "add", "-A", cwd=cwd)
        return self.sh("git", "commit", "-qm", msg, cwd=cwd)

    def base(self):
        put(self.w, "infra/a.md", PAGE)
        put(self.w, "log.md", "# log\n")
        r = self.commit("first")  # no HEAD yet: passes
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_hookspath_set(self):
        self.assertEqual(self.sh("git", "config", "core.hooksPath").stdout.strip(), str(BIN / "hooks"))

    def test_deleted_line_refused(self):
        self.base()
        put(self.w, "infra/a.md", PAGE.replace("- 事实乙\n", ""))
        r = self.commit()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("infra/a.md: - 事实乙", r.stderr)
        self.assertIn("## 历史", r.stderr)
        self.assertEqual(self.sh("git", "rev-list", "--count", "HEAD").stdout.strip(), "1")

    def test_moved_to_history_passes(self):
        self.base()
        put(self.w, "infra/a.md", PAGE.replace("- 事实乙\n", "") + "\n## 历史\n- 事实乙\n")
        r = self.commit()
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_moved_to_log_refused(self):
        self.base()
        put(self.w, "infra/a.md", PAGE.replace("- 事实乙\n", ""))
        put(self.w, "log.md", "# log\n- 事实乙\n")
        self.assertNotEqual(self.commit().returncode, 0)

    def test_log_bin_and_new_text_pass(self):
        self.base()
        put(self.w, "log.md", "")
        self.assertEqual(self.commit().returncode, 0)
        put(self.w, "bin/x.py", "print(1)\n")
        put(self.w, "infra/a.md", PAGE + "- 事实丙\n")
        put(self.w, "infra/b.md", PAGE.replace("甲", "丁"))
        r = self.commit()
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_checks_index_not_worktree(self):
        self.base()
        put(self.w, "infra/a.md", PAGE.replace("- 事实乙\n", ""))
        self.sh("git", "add", "-A")
        put(self.w, "infra/a.md", PAGE)  # line back in the worktree only: the commit would still lose it
        self.assertNotEqual(self.sh("git", "commit", "-qm", "c").returncode, 0)

    def test_worktree_commit_checked(self):
        """ingest commits in its git worktree (.ingest-work): the shared core.hooksPath applies there too."""
        self.base()
        wt = self.w / ".ingest-work"
        self.sh("git", "worktree", "add", "-q", "--detach", str(wt))
        put(wt, "infra/a.md", PAGE + "- 事实丙\n")
        self.assertEqual(self.commit(cwd=wt).returncode, 0)
        put(wt, "infra/a.md", PAGE.replace("- 事实甲\n", ""))
        r = self.commit(cwd=wt)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("事实甲", r.stderr)


if __name__ == "__main__":
    unittest.main()
