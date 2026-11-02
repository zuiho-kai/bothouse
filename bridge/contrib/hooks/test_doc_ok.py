"""doc-ok / dispatch-review-guard 的会话登记回归测试（Claude Code、DSH、Codex）。"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOC_OK = HERE / "doc-ok.py"
GUARD = HERE / "dispatch-review-guard.py"
IDENTITIES = ("CLAUDE_CODE_SESSION_ID", "DSH_SESSION_ID", "CODEX_SESSION_ID", "CODEX_THREAD_ID")


def clean_env(home, reviews, **extra):
    env = {k: v for k, v in os.environ.items() if k not in IDENTITIES + ("HOOK_REVIEWS_DIR", "HOME")}
    env.update(HOME=str(home), HOOK_REVIEWS_DIR=str(reviews))
    env.update(extra)
    return env


class DocOkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.reviews = self.root / "reviews"
        self.reviews.mkdir()
        self.docs = self.root / "docs"
        self.docs.mkdir()
        self.doc = self.docs / "guide.md"
        self.doc.write_text("# guide\n", encoding="utf-8")
        self.env = clean_env(self.home, self.reviews)

    def tearDown(self):
        self.tmp.cleanup()

    def register(self, path, cwd=None, **extra):
        env = clean_env(self.home, self.reviews, **extra)
        return subprocess.run([sys.executable, "-I", str(DOC_OK), str(path)],
                              cwd=cwd or self.root, env=env, capture_output=True, text=True, timeout=10)

    def guard(self, session_id, path):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Edit", "session_id": session_id,
                   "cwd": str(self.root), "tool_input": {"file_path": str(path)}}
        result = subprocess.run([sys.executable, "-I", str(GUARD)], input=json.dumps(payload),
                                env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def denied(self, session_id, path):
        out = self.guard(session_id, path)
        return out.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def test_codex_session_registers_with_session_id(self):
        result = self.register(self.doc, CODEX_SESSION_ID="sess-codex-1", CODEX_THREAD_ID="thread-codex-1")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = (self.reviews / ".docs").read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines, [f"sess-codex-1\t{self.doc.resolve()}"])
        self.assertEqual(self.guard("sess-codex-1", self.doc), {})

    def test_codex_thread_id_is_not_the_guard_session_id(self):
        self.register(self.doc, CODEX_SESSION_ID="sess-codex-2", CODEX_THREAD_ID="thread-codex-2")
        self.assertTrue(self.denied("thread-codex-2", self.doc))

    def test_codex_thread_id_alone_is_not_an_identity(self):
        result = self.register(self.doc, CODEX_THREAD_ID="thread-only")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CODEX_SESSION_ID", result.stderr)
        self.assertFalse((self.reviews / ".docs").exists())

    def test_other_session_is_denied(self):
        self.register(self.doc, CODEX_SESSION_ID="sess-owner")
        self.assertTrue(self.denied("sess-other", self.doc))

    def test_claude_and_dsh_are_unchanged(self):
        for var in ("CLAUDE_CODE_SESSION_ID", "DSH_SESSION_ID"):
            with self.subTest(var):
                doc = self.docs / f"{var}.md"
                doc.write_text("# doc\n", encoding="utf-8")
                result = self.register(doc, **{var: f"{var}-sid"})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.guard(f"{var}-sid", doc), {})
                self.assertTrue(self.denied("some-other-session", doc))

    def test_missing_identity_mentions_codex(self):
        result = self.register(self.doc)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CODEX_SESSION_ID", result.stderr)
        self.assertFalse((self.reviews / ".docs").exists())

    def test_relative_and_symlink_paths_resolve_to_the_same_file(self):
        link = self.root / "link.md"
        link.symlink_to(self.doc)
        result = self.register("docs/../link.md", cwd=self.root, CODEX_SESSION_ID="sess-path")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = (self.reviews / ".docs").read_text(encoding="utf-8").splitlines()
        self.assertEqual(lines, [f"sess-path\t{self.doc.resolve()}"])
        self.assertEqual(self.guard("sess-path", self.doc), {})


if __name__ == "__main__":
    unittest.main()
