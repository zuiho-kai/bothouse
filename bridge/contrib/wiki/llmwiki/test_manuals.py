import importlib.util, json, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("manuals_under_test", HERE / "manuals.py")
manuals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manuals)


class ManualsPending(unittest.TestCase):
    def test_exported_role_tools_create_pending_document_without_skill_root_file(self):
        root = Path(tempfile.mkdtemp())
        transcripts = root / "transcripts" / "dsh-role"
        transcripts.mkdir(parents=True)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for sid in ("session-one", "session-two"):
            rows = [
                {"type": "assistant", "timestamp": stamp, "message": {"content": [
                    {"type": "tool_use", "name": "exec", "input": {"command": "which alpha-cli"}},
                    {"type": "tool_use", "name": "exec", "input": {"command": "which alpha-cli"}},
                ]}},
            ]
            (transcripts / f"{sid}.jsonl").write_text("\n".join(json.dumps(row) for row in rows) + "\n")

        manuals.STATE = root / "state.json"
        manuals.PENDING = root / "skills" / "pending" / "dsh-role"
        manuals.SKILLS = root / "skills" / "library"
        manuals.LINKS = []
        manuals.WIKI = root / "wiki"
        manuals.MAPS = root / "maps"
        manuals.ROLE = "dsh-role"
        old_transcripts = __import__("os").environ.get("MANUALS_TRANSCRIPTS")
        __import__("os").environ["MANUALS_TRANSCRIPTS"] = str(transcripts)
        old_ask = manuals.ask
        manuals.ask = lambda _prompt: {"groups": [{"id": 0, "name": "alpha-cli", "description": "Use alpha-cli when needed.", "body": "Run it."}]}
        try:
            result = manuals.run()
        finally:
            manuals.ask = old_ask
            if old_transcripts is None:
                __import__("os").environ.pop("MANUALS_TRANSCRIPTS", None)
            else:
                __import__("os").environ["MANUALS_TRANSCRIPTS"] = old_transcripts

        draft = manuals.PENDING / "alpha-cli.md"
        self.assertTrue(draft.exists(), result)
        self.assertIn("name: alpha-cli", draft.read_text())
        self.assertFalse((manuals.SKILLS / "alpha-cli" / "SKILL.md").exists())
        self.assertTrue((manuals.WIKI / manuals.INDEX).exists())

    def test_tool_name_adapters_keep_existing_search_predicate(self):
        self.assertTrue(manuals.is_search("exec", "which alpha-cli"))
        self.assertTrue(manuals.is_search("search_files", "alpha-cli"))
        self.assertFalse(manuals.is_search("exec", "echo hello"))


if __name__ == "__main__":
    unittest.main()
