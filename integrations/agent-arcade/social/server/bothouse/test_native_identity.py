"""Run with python -I -B social/server/bothouse/test_native_identity.py."""
import json
import os
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

adapter = runpy.run_path(str(Path(__file__).with_name("instance.py")))
bindings = adapter["native_bindings"]


class NativeMemberTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.file = self.root / "config.toml"
        (self.root / "collab.owner.json").write_text(json.dumps({"local": {"origin": "http://127.0.0.1:4123"}}))
        self.channel = {"type": "cloud_web", "options": {"ws_url": "ws://127.0.0.1:4123/cloud-web/ws?bot=tide"}}
        self.config = {"projects": [{"name": "tide", "platforms": [self.channel]}]}
        self.rows = [
            {"name": "tide", "agent_type": "dsh", "platforms": [{"name": "cloud_web", "ready": True}]},
            {"name": "dsh:tide", "source": "dsh", "display_name": "Harbor", "agent_type": "dsh", "online": True},
        ]
        self.member = {"id": "tide", "source": "ui", "cli": None}

    def resolve(self):
        def get(route):
            self.assertEqual(route, "dsh/members")
            return {"members": [self.member]}
        with patch.dict(os.environ, {"CONEST_COLLAB_DATA": str(self.root)}):
            return bindings(self.config, self.file, get, self.rows)

    def test_native_member_and_offline_platform(self):
        self.assertTrue(self.resolve()["tide"][1])
        self.channel["disabled"] = True
        self.assertFalse(self.resolve()["tide"][1])

    def test_bridge_source_forms_bind_the_same_native_member(self):
        for source in ("bridge", ""):
            with self.subTest(source=source):
                self.rows[0]["source"] = source
                self.assertTrue(self.resolve()["tide"][1])
        for source in ("dsh", "external", False):
            with self.subTest(source=source):
                self.rows[0]["source"] = source
                self.assertEqual(self.resolve(), {})

    def test_authority_lists_one_bridge_engine_for_either_source_shape(self):
        self.file.write_text("[management]\nenabled=true\ntoken='fixture'\n", encoding="utf-8")
        run = adapter["run"]
        def read(port, token, route):
            responses = {
                "/api/v1/roles": {"roles": self.rows},
                "/api/v1/dsh/members": {"members": [self.member]},
                "/api/v1/projects/tide/users": {"configured": False},
            }
            return responses[route]

        with patch.dict(os.environ, {"CONEST_COLLAB_DATA": str(self.root)}), patch.dict(
                run.__globals__, {"read_json": read, "instance_id": lambda cfg, file: "fixture"}):
            for source in (None, "bridge", "unknown"):
                with self.subTest(source=source):
                    if source is not None:
                        self.rows[0]["source"] = source
                    result = run(self.file, {"action": "authority"})
                    self.assertEqual([r["id"] for r in result["projects"]],
                                     [] if source == "unknown" else ["tide"])

    def test_equal_labels_do_not_link_different_member_ids_or_hosts(self):
        for url in ("ws://127.0.0.1:4123/cloud-web/ws?bot=other",
                    "ws://127.0.0.1:4124/cloud-web/ws?bot=tide",
                    "ws://127.0.0.1:4123/cloud-web/ws?bot=tide&bot=other"):
            with self.subTest(url=url):
                self.channel["options"]["ws_url"] = url
                self.assertEqual(self.resolve(), {})

    def test_external_cli_or_roster_only_has_no_native_transport(self):
        self.member["source"] = "external"
        self.assertEqual(self.resolve(), {})
        self.member.update(source="ui", cli="codex")
        self.assertEqual(self.resolve(), {})
        self.member["cli"] = None
        self.rows.pop(0)
        self.assertEqual(self.resolve(), {})


if __name__ == "__main__":
    unittest.main()
