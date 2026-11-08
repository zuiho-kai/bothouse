"""Reflector tests use isolated bridge, wiki and map directories; codex is never called."""
import json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

_tmp = tempfile.TemporaryDirectory()
_root = Path(_tmp.name)
for key, value in {
    "MEMVOTE_DIR": str(_root / "gate"),
    "CC_DATA_DIR": str(_root / "data"),
    "GATE_WIKI": str(_root / "wiki"),
    "CODEMAP_DIR": str(_root / "maps"),
    "CODEMAP_FILL_SCRIPT": str(_root / "codemap-fill.py"),
    "GATE_DEFAULT_BOT": "helper",
    "REFLECTOR_MODEL": "test-model",
}.items():
    os.environ[key] = value
for path in (Path(os.environ["MEMVOTE_DIR"]), Path(os.environ["CC_DATA_DIR"]),
             Path(os.environ["GATE_WIKI"]), Path(os.environ["CODEMAP_DIR"])):
    path.mkdir(parents=True, exist_ok=True)
Path(os.environ["CODEMAP_FILL_SCRIPT"]).write_text("def fill(text, source):\n    return []\n")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import memvote, reflector  # noqa: E402


class Reflector(unittest.TestCase):
    def setUp(self):
        reflector.PUSH.write_text(json.dumps({
            "t": "2026-11-08 10:00:00", "key": "discord:1", "q": "request", "refs": []
        }) + "\n", encoding="utf-8")
        reflector.STATE.unlink(missing_ok=True)

    def test_paths_and_identity_are_configurable(self):
        row = reflector.load_push()[0]
        self.assertEqual(row["proj"], "helper")
        self.assertEqual(reflector.MODEL, "test-model")
        self.assertEqual(reflector.MAPS, Path(os.environ["CODEMAP_DIR"]))
        self.assertEqual(reflector.FILL_SCRIPT, Path(os.environ["CODEMAP_FILL_SCRIPT"]))

    def test_first_run_only_records_cursor(self):
        self.assertEqual(reflector.main([]), 0)
        state = json.loads(reflector.STATE.read_text())
        self.assertEqual(state, {"pos": 0, "done": []})
        self.assertFalse(reflector.LOG.exists())

    def test_missing_push_log_is_an_empty_first_run(self):
        reflector.PUSH.unlink()
        self.assertEqual(reflector.main([]), 0)
        self.assertEqual(json.loads(reflector.STATE.read_text()), {"pos": -1, "done": []})

    def test_dry_does_not_write_votes_or_log(self):
        reflector.STATE.write_text('{"pos": -1, "done": []}', encoding="utf-8")
        state_before = reflector.STATE.read_text(encoding="utf-8")
        with patch.object(reflector, "ready_turns", return_value=([{
            "i": 0, "t": "2026-11-08 10:00:00", "proj": "helper", "key": "discord:1",
            "items": [("tooling/p.md#id", "- fact")], "q": "request", "reply": "response"
        }], {"pos": 0, "done": []})), patch.object(reflector, "_fill_mod", return_value=type(
                "Fill", (), {"fill": staticmethod(lambda *args: [])})()), \
                patch.object(reflector, "judge", return_value=([{
                    "i": 0, "reasoning": "neutral", "bullet_tags": [{"id": "0", "tag": "helpful"}],
                    "map_entries": []
                }], 10)), patch.object(memvote, "_recs", return_value=[]):
            self.assertEqual(reflector.main(["--dry"]), 0)
        self.assertFalse(reflector.LOG.exists())
        self.assertEqual(reflector.STATE.read_text(encoding="utf-8"), state_before)
        self.assertFalse(memvote.VOTES.exists())


if __name__ == "__main__":
    unittest.main()
