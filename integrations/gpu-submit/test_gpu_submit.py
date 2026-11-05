import base64
import json
import subprocess
import sys
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

sys.path.insert(0, str(Path(__file__).parent))
import gpu_submit


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.private = Ed25519PrivateKey.generate()
        self.public = self.private.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.now = datetime.now(timezone.utc)
        self.claims = {"version": 1, "platform": "discord", "user_id": "alice", "project": "kimi", "session": "discord:room", "action": "gpu.run", "nonce": base64.b64encode(b"a" * 32).decode(), "issued_at": self.now.isoformat().replace("+00:00", "Z"), "expires_at": (self.now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")}

    def tearDown(self):
        self.temp.cleanup()

    def ticket(self):
        # Match OriginatorClaimsJSON, including an omitted optional message_id.
        return {"claims": self.claims, "key_id": __import__('hashlib').sha256(self.public).hexdigest(), "public_key": base64.b64encode(self.public).decode(), "signature": base64.b64encode(self.private.sign(gpu_submit.canonical(self.claims))).decode()}

    def policy(self, command=None):
        return {"principals": {"discord:alice": {"role": "member", "projects": {"kimi": {"execute_as": "alice-agent", "actions": ["gpu.run"], "command": command or [sys.executable, "-c", "print('authorized')"]}}}}}

    def verify(self, ticket=None, policy=None, keys=None):
        return gpu_submit.authorize(policy or self.policy(), gpu_submit.verify(ticket or self.ticket(), keys or {__import__('hashlib').sha256(self.public).hexdigest(): self.public}, self.now))

    def test_authenticated_identity_not_content(self):
        ticket = self.ticket()
        result = self.verify(ticket)
        self.assertEqual(result["originator"], "discord:alice")
        self.assertEqual(result["execute_as"], "alice-agent")
        self.claims["user_id"] = "forged"
        with self.assertRaises(InvalidSignature):
            self.verify(ticket)

    def test_cross_project_and_action_rejected(self):
        for field in ("project", "action"):
            ticket = self.ticket()
            self.claims[field] = "other"
            ticket["signature"] = base64.b64encode(self.private.sign(gpu_submit.canonical(self.claims))).decode()
            with self.assertRaises(ValueError):
                self.verify(ticket)

    def test_expired_and_untrusted_key_rejected(self):
        self.claims["expires_at"] = self.now.isoformat().replace("+00:00", "Z")
        with self.assertRaises(ValueError):
            self.verify()
        self.claims["expires_at"] = (self.now + timedelta(minutes=1)).isoformat().replace("+00:00", "Z")
        ticket = self.ticket()
        other = Ed25519PrivateKey.generate().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        with self.assertRaises(ValueError):
            self.verify(ticket, keys={__import__('hashlib').sha256(self.public).hexdigest(): other})

    def test_unauthorized_principal_rejected(self):
        with self.assertRaises(ValueError):
            self.verify(policy={"principals": {}})

    def test_replay_rejected_even_after_expiry(self):
        path = self.dir / "nonces"
        path.mkdir()
        nonce_file = path / (__import__('hashlib').sha256(self.claims["nonce"].encode()).hexdigest() + ".json")
        nonce_file.touch()
        ticket_path = self.dir / "ticket.json"
        ticket_path.write_text(json.dumps(self.ticket()))
        policy_path = self.dir / "policy.json"
        policy_path.write_text(json.dumps(self.policy()))
        trusted_path = self.dir / "trusted.json"
        trusted_path.write_text(json.dumps({__import__('hashlib').sha256(self.public).hexdigest(): base64.b64encode(self.public).decode()}))
        argv = ["--ticket", str(ticket_path), "--policy", str(policy_path), "--trusted-keys", str(trusted_path), "--audit-log", str(self.dir / "audit.jsonl"), "--nonce-db", str(path)]
        with mock.patch.object(gpu_submit, "datetime") as clock:
            clock.now.return_value = self.now + timedelta(days=1)
            clock.fromisoformat.side_effect = datetime.fromisoformat
            self.assertEqual(gpu_submit.main(argv), 2)
        self.assertFalse((self.dir / "audit.jsonl").exists())

    def test_invalid_signature_leaves_no_nonce_file(self):
        # A forged ticket must not be able to fill (or exhaust) the nonce
        # directory: the nonce is only written once verification passed.
        path = self.dir / "nonces"
        path.mkdir()
        ticket = self.ticket()
        ticket["signature"] = base64.b64encode(b"\x00" * 64).decode()
        ticket_path = self.dir / "ticket.json"
        ticket_path.write_text(json.dumps(ticket))
        policy_path = self.dir / "policy.json"
        policy_path.write_text(json.dumps(self.policy()))
        trusted_path = self.dir / "trusted.json"
        trusted_path.write_text(json.dumps({__import__('hashlib').sha256(self.public).hexdigest(): base64.b64encode(self.public).decode()}))
        argv = ["--ticket", str(ticket_path), "--policy", str(policy_path), "--trusted-keys", str(trusted_path), "--audit-log", str(self.dir / "audit.jsonl"), "--nonce-db", str(path)]
        self.assertEqual(gpu_submit.main(argv), 2)
        self.assertEqual(list(path.iterdir()), [])
        self.assertFalse((self.dir / "audit.jsonl").exists())

    def test_verified_nonce_is_recorded_once(self):
        path = self.dir / "nonces"
        ticket_path = self.dir / "ticket.json"
        ticket_path.write_text(json.dumps(self.ticket()))
        policy_path = self.dir / "policy.json"
        policy_path.write_text(json.dumps(self.policy()))
        trusted_path = self.dir / "trusted.json"
        trusted_path.write_text(json.dumps({__import__('hashlib').sha256(self.public).hexdigest(): base64.b64encode(self.public).decode()}))
        argv = ["--ticket", str(ticket_path), "--policy", str(policy_path), "--trusted-keys", str(trusted_path), "--audit-log", str(self.dir / "audit.jsonl"), "--nonce-db", str(path), "--dry-run"]
        self.assertEqual(gpu_submit.main(argv), 0)
        self.assertEqual(len(list(path.iterdir())), 1)
        self.assertEqual(gpu_submit.main(argv), 2)
        self.assertEqual(len(list(path.iterdir())), 1)

    def test_replay_rejected_and_delegated_identity_audited(self):
        ticket_path = self.dir / "ticket.json"
        ticket_path.write_text(json.dumps(self.ticket()))
        policy_path = self.dir / "policy.json"
        policy_path.write_text(json.dumps(self.policy()))
        trusted_path = self.dir / "trusted.json"
        trusted_path.write_text(json.dumps({__import__('hashlib').sha256(self.public).hexdigest(): base64.b64encode(self.public).decode()}))
        argv = ["--ticket", str(ticket_path), "--policy", str(policy_path), "--trusted-keys", str(trusted_path), "--audit-log", str(self.dir / "audit.jsonl"), "--nonce-db", str(self.dir / "nonces")]
        self.assertEqual(gpu_submit.main(argv), 0)
        self.assertEqual(gpu_submit.main(argv), 2)
        lines = [json.loads(line) for line in (self.dir / "audit.jsonl").read_text().splitlines()]
        self.assertEqual(lines[0]["originator"], "discord:alice")
        self.assertEqual(lines[0]["execute_as"], "alice-agent")
        self.assertEqual(lines[-1]["exit_code"], 0)


if __name__ == "__main__":
    unittest.main()
