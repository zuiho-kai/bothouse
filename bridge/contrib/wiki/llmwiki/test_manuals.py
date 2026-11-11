import ast, importlib.util, json, os, sys, tempfile, time, types, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("manuals_under_test", HERE / "manuals.py")
manuals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manuals)


class ManualsPending(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.saved = {key: getattr(manuals, key) for key in (
            'STATE', 'PENDING', 'SKILLS', 'LINKS', 'WIKI', 'MAPS', 'ROLE')}
        manuals.PENDING = self.root / 'pending' / 'writer'
        manuals.SKILLS = self.root / 'library'
        manuals.LINKS = []
        self.addCleanup(lambda: [setattr(manuals, key, value) for key, value in self.saved.items()])

    def approved(self):
        path = manuals.SKILLS / 'guide' / 'SKILL.md'
        path.parent.mkdir(parents=True)
        path.write_text('---\nname: guide\ndescription: A guide\n---\nOriginal.\n')
        return path

    def test_append_stages_revision_and_keeps_active_body(self):
        active = self.approved()
        old = active.read_text()
        have = manuals.existing()
        manuals.write_append({'append': 'guide', 'add': 'First addition.'}, '2026-11-11', have)
        manuals.write_append({'append': 'guide', 'add': 'Second addition.'}, '2026-11-11', have)
        self.assertEqual(active.read_text(), old)
        pending = manuals.PENDING / 'guide.md'
        self.assertIn('First addition.', pending.read_text())
        self.assertIn('Second addition.', pending.read_text())
        self.assertEqual(manuals.existing()['guide'][1], pending)

    def test_tidy_stages_revision_instead_of_rewriting_approved_skill(self):
        active = self.approved()
        active.write_text(active.read_text() + '\n## 补充\nDuplicate.\n')
        old = active.read_text()
        def rewrite(path, _day, **_kwargs):
            path.write_text('TIDIED')
            return True
        with patch.object(manuals, 'tidy', rewrite):
            self.assertEqual(manuals.tidy_all('2026-11-11', ['guide']), [('tidy', 'guide')])
        self.assertEqual(active.read_text(), old)
        self.assertEqual((manuals.PENDING / 'guide.md').read_text(), 'TIDIED')

    def test_standalone_ask_uses_configured_wiki_runner(self):
        calls = []
        engine = types.SimpleNamespace(profile_ask=lambda text: calls.append(text) or {'groups': []})
        with patch.dict(sys.modules, ingest=engine), patch.object(manuals.subprocess, 'run', side_effect=AssertionError('unexpected CLI')):
            self.assertEqual(manuals.ask('draft a guide'), {'groups': []})
        self.assertEqual(calls, ['draft a guide'])

    def test_nightly_shares_role_identity_runner_transcripts_and_budget(self):
        tree = ast.parse((HERE / 'ingest.py').read_text())
        entry = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'nightly')
        repo = self.root / 'wiki'
        repo.mkdir()
        transcripts = self.root / 'transcripts' / 'writer'
        calls = []
        ask_fn = lambda text: {'groups': []}
        noop = lambda *args, **kwargs: None
        env = dict(os=os, Path=Path, time=time, WORK=repo, REPO=repo, NIGHT_BUDGET=1,
                   NIGHT_ENGINE='dsh', ROOT=transcripts, CFG={'assistant': '显示名'},
                   run=noop, split_pass=noop, state=noop, dream=noop, review=noop, profile_ask=ask_fn)
        exec(compile(ast.Module(body=[entry], type_ignores=[]), str(HERE / 'ingest.py'), 'exec'), env)
        with patch.dict(os.environ, BOTHOUSE_DATA_DIR=str(self.root / 'data'), MANUALS_ROLE='writer'), \
             patch.dict(sys.modules, manuals=manuals), \
             patch.object(manuals, 'run', side_effect=lambda **kwargs: calls.append(kwargs)):
            env['nightly'](None)
        self.assertEqual(manuals.ROLE, 'writer')
        self.assertEqual(manuals.PENDING, self.root / 'data' / 'skills' / 'pending' / 'writer')
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0]['ask_fn'], ask_fn)
        self.assertEqual(calls[0]['transcripts'], transcripts)
        self.assertGreater(calls[0]['deadline'], time.time() - 1)

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
