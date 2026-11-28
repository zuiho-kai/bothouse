"""Exercise the publisher with local management and world transport fixtures."""
from pathlib import Path
import json
import runpy
import tempfile
import unittest
from unittest.mock import patch

pub = runpy.run_path(str(Path(__file__).with_name("publish-residents.py")))


class ResidentLooks(unittest.TestCase):
    def test_project_and_member_identity_to_wire(self):
        models = ["claude-sonnet-4", "gpt-5", "deepseek-chat", "gemini-3", "grok-4", "MiniMax-M2.1"]
        looks = ["orange", "dragon", "whale", "rainbow", "grok", "lanxi"]
        roles, metadata, team = [], [], []
        expected = {}

        def add(source, name, model, avatar, expected_look):
            roles.append(dict(source=source, name=name, role_key=source + ":" + name,
                              display_name="Claude", online=True, status="idle"))
            metadata.append(dict(source=source if source == "dsh" else "",
                                 name=("dsh:" if source == "dsh" else "") + name,
                                 model=model, agent_type="dsh", current_task="private-marker"))
            if source == "bridge":
                team.append(dict(project=name, avatar=avatar))
            expected[source, name] = expected_look

        for i, (model, look, brand) in enumerate(zip(models, looks, pub["BRANDS"])):
            add("bridge", str(i), model, "", look)
            add("dsh", str(i), models[i-1], "", looks[i-1])
            add("bridge", "dress-" + str(i), "unknown", brand, look)
        add("bridge", "explicit", "gpt-5", "lanxi", "lanxi")
        add("dsh", "unknown", "", "", "default")
        add("bridge", "custom", "claude-sonnet-4", "custom-shadow", "custom-shadow")
        captured = []

        def transport(base, path, headers, payload=None, snapshot=False):
            if snapshot:
                return {"roles": roles}
            if path == "/api/resident-feed":
                captured.append(payload)
                return {"ok": True}
            data = {"setup/state": {"setup": {"team": team}}, "roles": {"roles": metadata},
                    "library": {}}.get(path.removeprefix("/api/v1/"), {"configured": False})
            return {"ok": True, "data": data}

        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "host.toml"
            config.write_text('[management]\nenabled=true\ntoken="fixture"\n')
            with patch.dict(pub["publish"].__globals__, request=transport, fingerprint=lambda p: "a"*64):
                pub["publish"](config, set(), None, pub["origin"]("http://localhost"), "fixture")
        rows = captured[0]["residents"]
        self.assertEqual({(r["source"], r["project"]): r["appearanceKey"] for r in rows}, expected)
        for row in rows:
            self.assertLessEqual(set(row), {"source", "project", "activity", "displayName", "appearanceKey", "portrait"})
        for private in [*models, "private-marker", "fixture"]:
            self.assertNotIn(private, json.dumps(captured))

    def test_native_body_with_private_portrait(self):
        body = pub["native_body"]
        member = {"avatar": "upload:private.png", "name": "GPT", "model": {"model": "gpt-5"}}
        self.assertEqual(body(member), "dragon")
        self.assertEqual(body({**member, "worldBody": "whale"}), "whale")
        self.assertEqual(body({**member, "avatar": "whale", "worldBody": "auto"}), "dragon")
        self.assertEqual(body({**member, "model": None}), "default")
        self.assertEqual(body({**member, "model": None, "cli": "gemini"}), "rainbow")

    def test_approved_portrait_retained(self):
        row = {"appearanceKey": "brand-openai", "portrait": {"sha256": "a"*64}}
        pub["finalize_looks"]({"residents": [row]})
        self.assertEqual(row, {"appearanceKey": "dragon", "portrait": {"sha256": "a"*64}})

    def test_management_agent_without_model_and_ambiguous_rows(self):
        rows = [{"name": "local", "agent_type": "claudecode"},
                {"name": "dsh:local", "source": "dsh", "agent_type": "codex"}]
        self.assertEqual(pub["role_looks"](rows), {("bridge", "local"): "orange", ("dsh", "local"): "dragon"})
        rows.append({"name": "local", "agent_type": "gemini"})
        self.assertEqual(pub["role_looks"](rows)[("bridge", "local")], "default")


if __name__ == "__main__":
    unittest.main()
