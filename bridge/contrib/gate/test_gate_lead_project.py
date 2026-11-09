"""Regression #1434: legacy lead project identity through the real HTTP handler."""
import json
import os
import sys
import unittest
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_gate_addressee import load_gate


class LeadProjectRouting(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ)
        self.env.start()
        self.addCleanup(self.env.stop)
        saved = {m: sys.modules.get(m) for m in ("gate", "lead", "ctxsvc")}
        def restore():
            for name, mod in saved.items():
                if mod is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = mod
        self.addCleanup(restore)
        self.g = load_gate(
            team={"lead": {"name": "Lead", "aliases": ["Codex"]},
                  "subs": {"grok": {"name": "Grok", "id": "222"}}},
            config_toml='[[projects]]\nname = "gge"\nteam_name = "Lead"\n')
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), self.g.H)
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.thread.join(timeout=5)

    def post(self, path, body):
        req = urllib.request.Request(f"http://127.0.0.1:{self.srv.server_port}{path}",
                                     json.dumps(body).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read())

    def test_legacy_lead_project_does_not_404(self):
        got = self.post("/decide?bot=gge", {"content": "<@222> help", "addressed_other": True})
        self.assertEqual(got["action"], "context")

    def test_self_mention_and_switched_lead(self):
        self.assertEqual(self.post("/decide?bot=gge", {"content": "help", "mentioned": True})["action"], "reply")
        self.post("/lead", {"action": "set", "who": "grok"})
        self.assertEqual(self.g.lead.current(), "grok")
        self.assertEqual(self.post("/decide?bot=gge", {"content": "<@222> help"})["action"], "context")
        self.assertEqual(self.g.lead.member("gge"), "")
        self.assertIsNotNone(self.g.lead.identity("gge"))
        self.post("/lead", {"action": "set", "who": "gge"})
        self.assertEqual(self.g.lead.current(), "")

    def test_project_alias_and_context_use_same_identity(self):
        self.assertEqual(self.g._project_member("gge"), "")
        self.assertEqual(self.g._cc_projects()[0][0], "")
        self.assertEqual(self.g.lead.resolve("gge"), "")

    def test_unknown_project_still_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("/decide?bot=stranger", {"content": "help"})
        self.assertEqual(caught.exception.code, 404)

    def test_ambiguous_name_does_not_guess_lead_project(self):
        (self.g._test_data_dir / "config.toml").write_text(
            '[[projects]]\nname = "gge"\nteam_name = "Lead"\n'
            '[[projects]]\nname = "duplicate"\nteam_name = "Lead"\n')
        self.g.lead.configure(self.g._team)
        self.assertEqual(self.g.lead.member("gge"), "gge")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post("/decide?bot=gge", {"content": "help"})
        self.assertEqual(caught.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
