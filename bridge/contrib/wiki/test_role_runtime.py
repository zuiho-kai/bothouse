"""Role launcher credentials and generated dream destinations; no model calls."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class RoleRuntime(unittest.TestCase):
    def test_role_profile_uses_registered_dream_domain(self):
        profiles = module('role_profiles', 'llmwiki/profiles.py')
        root = Path(tempfile.mkdtemp(prefix='role-profile-'))
        (root / '.bothouse-role').write_text('helper\n')
        (root / 'config.json').write_text(json.dumps({'dream_dir': 'misc'}))
        (root / 'misc').mkdir()
        (root / 'misc/README.md').write_text('# misc\n')
        answer = {'lines': [{'section': '判断标准', 'text': '他要根因，所以追到源头',
                             'id': 'U1', 'quote': '我要根因'}]}
        profiles.rewrite(root, 'discord-1', 'Helper', 'USER: 我要根因',
                         {'U1': ('11-17', 'discord:1', '我要根因')},
                         lambda _: answer, lambda _: None)
        self.assertTrue((root / 'misc/profile-discord-1.md').is_file())
        self.assertFalse((root / 'tooling').exists())
        self.assertIn('(profile-discord-1.md)', (root / 'misc/README.md').read_text())

    def test_launcher_uses_wiki_login_instead_of_calling_agents_codex_home(self):
        scheduler = module('role_scheduler', 'sub-wiki.py')
        root = Path(tempfile.mkdtemp(prefix='role-runtime-'))
        scheduler.LOG = root / 'scheduler.log'
        with mock.patch.dict(os.environ, {'CODEX_HOME': '/stale-agent-login',
                                         'CC_PROJECT': 'test-role'}), \
                mock.patch.object(scheduler.subprocess, 'run') as run:
            run.return_value.returncode = 0
            scheduler.run_one([('role', 'test-role', str(root))], 'role', '--pending')
        env = run.call_args.kwargs['env']
        self.assertIsNone(env.get('CODEX_HOME'))
        self.assertEqual(env['CC_PROJECT'], 'test-role')
        self.assertEqual(env['WIKI_DIR'], str(root))

    def test_created_role_dream_uses_registered_misc_domain(self):
        setup = module('role_setup', 'setup_wiki.py')
        root = Path(tempfile.mkdtemp(prefix='role-setup-')) / 'wiki'

        def template(wiki):
            (wiki / 'schema').mkdir(parents=True)
            (wiki / 'schema/CLAUDE.zh-CN.md').write_text('## 分层\n')
            (wiki / 'bin').mkdir()
            (wiki / 'misc').mkdir()

        setup._bots = {'helper': {'workdir': str(root.parent), 'wiki': str(root)}}
        setup.NAMES = {'helper': 'Helper'}
        setup.PERSONA = {'helper': '/fake/persona.md'}
        with mock.patch.object(setup, 'from_template', side_effect=template), \
                mock.patch.object(setup, 'commit'), \
                mock.patch.object(setup.subprocess, 'run') as run, \
                mock.patch.object(setup.shutil, 'rmtree'), \
                mock.patch.dict(os.environ, {'WIKI_ENGINES': '{}', 'WIKI_SHARED_BIN': ''}):
            # Existing template cleanup is mocked: fixtures are retained, no directories deleted.
            run.return_value.returncode = 1
            run.return_value.stdout = ''
            setup.main('helper')
        cfg = json.loads((root / 'config.json').read_text())
        self.assertEqual(cfg.get('dream_dir'), 'misc')
        self.assertIn(f"({cfg['dream_dir']}/README.md)", (root / 'MEMORY.md').read_text())


if __name__ == '__main__':
    unittest.main()
