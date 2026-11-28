"""With api_base and api_key_file configured, Codex calls go to that route with the wiki's own key
(user 2026-11-28「整理用密钥 有个专门的luna密钥啊」), not Codex's ChatGPT login."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(tempfile.mkdtemp(prefix="codex-route-"))
os.environ.update(WIKI_DIR=str(ROOT), WIKI_BRIDGE_CONFIG=str(ROOT / "absent.toml"),
                  AGENT_SESSIONS_DIR=str(ROOT / "sessions"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ingest as I


class CodexRoute(unittest.TestCase):
    def setUp(self):
        self.key = ROOT / "key"
        self.key.write_text("sk-test\n")
        I.PROPOSE_DIR.mkdir(parents=True, exist_ok=True)

    def run_json(self, cfg):
        seen = {}

        def fake(cmd, **kw):
            seen.update(cmd=cmd, env=kw["env"])
            return subprocess.CompletedProcess(cmd, 1, "", "")
        with patch.dict(I.CFG, cfg), patch.object(I, "engine_run", fake):
            I.codex_json("p", {"type": "object"}, "ingest x facts", "gpt-6-luna", "high")
        return seen

    def test_configured_route_carries_provider_and_key(self):
        seen = self.run_json(dict(api_base="https://relay.example/v1", api_key_file=str(self.key)))
        self.assertIn('model_provider="wiki_api"', seen["cmd"])
        self.assertIn('model_providers.wiki_api={name="wiki_api",base_url="https://relay.example/v1",'
                      'env_key="WIKI_API_KEY",wire_api="responses"}', seen["cmd"])
        self.assertEqual(seen["env"]["WIKI_API_KEY"], "sk-test")
        self.assertNotIn("sk-test", " ".join(seen["cmd"]))

    def test_no_route_keeps_codex_login(self):
        seen = self.run_json(dict(api_base="", api_key_file=""))
        self.assertFalse(any("model_provider" in a for a in seen["cmd"]))
        self.assertNotIn("WIKI_API_KEY", {k: v for k, v in seen["env"].items() if k not in os.environ})

    def test_unreadable_key_is_a_config_error(self):
        with self.assertRaises(I.ConfigError):
            self.run_json(dict(api_base="https://relay.example/v1", api_key_file=str(ROOT / "missing")))


if __name__ == "__main__":
    unittest.main()
