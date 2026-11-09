"""Regression #1434: legacy lead project identity through the real HTTP handler."""
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_gate_addressee import load_gate


class LeadProjectRouting(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.g = load_gate(
            team={"lead": {"name": "Lead", "aliases": ["Codex"]},
                  "subs": {"grok": {"name": "Grok", "id": "222"}}},
            config_toml='[[projects]]\nname = "gge"\nteam_name = "Lead"\n')

    def post(self, path, body):
        h = self.g.H.__new__(self.g.H)
        data = json.dumps(body).encode()
        h.path = path
        h.headers = {"Content-Length": str(len(data))}
        h.rfile, h.wfile = io.BytesIO(data), io.BytesIO()
        status = []
        h.send_response = lambda code, *args: status.append(code)
        h.send_header = lambda *args: None
        h.end_headers = lambda: None
        h.send_error = lambda code, *args: status.append(code)
        h.do_POST()
        self.assertEqual(status, [200], h.wfile.getvalue())
        return json.loads(h.wfile.getvalue())

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


if __name__ == "__main__":
    unittest.main()
