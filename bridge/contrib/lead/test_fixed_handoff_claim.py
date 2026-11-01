"""Fixed workspace handoffs must register ownership before publishing/waking."""
import contextlib
import io
import os
from pathlib import Path
import runpy
import tempfile
import types
import unittest
from unittest.mock import patch


class FixedHandoffClaim(unittest.TestCase):
    def run_handoff(self, claim_ok=True, wake_ok=True):
        directory = tempfile.mkdtemp()
        notes = Path(directory) / "notes.prompt"
        notes.write_text("fixture")
        events = []
        with patch.dict(os.environ, {"GATE_SETUP_DIR": directory, "BOARD_DIR": directory,
                                     "CC_BIN": "fake-bridge", "CC_PROJECT": "lead",
                                     "CC_SESSION_KEY": "room:chat", "WS_CHANNEL": "room:ws"}):
            mod = runpy.run_path(str(Path(__file__).with_name("ws-handoff")))
            g = mod["main"].__globals__
            def run(args, **kwargs):
                events.append(args[1:3])
                ok = claim_ok if args[1:3] == ["workspace", "claim"] else wake_ok
                return types.SimpleNamespace(returncode=0 if ok else 1, stdout="receipt", stderr="rejected" if not ok else "")
            def add(*args, **kwargs):
                events.append("board")
                return 7
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.dict(g, {"check_notes": lambda *a: None,
                    "generic_gate": lambda *a: None, "intent_gate": lambda *a: None,
                    "own_gate": lambda *a: None, "live_dup": lambda *a: None,
                    "append_source": lambda *a: None, "record_last": lambda *a: None,
                    "arm_drift": lambda *a: None}))
                stack.enter_context(patch.object(g["_recall"], "append_to", return_value=False))
                stack.enter_context(patch.object(g["_team"], "name_of", return_value="lead"))
                stack.enter_context(patch.object(g["subprocess"], "run", side_effect=run))
                for name, impl in {"add": add, "unadd": lambda *a: events.append("unadd"),
                                   "arm_guard": lambda *a: None,
                                   "_park_once": lambda *a: events.append("park") or True}.items():
                    stack.enter_context(patch.object(g["board"], name, side_effect=impl))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
                try:
                    mod["main"]([str(notes), "test task", "--short", "test"])
                except SystemExit:
                    if claim_ok and wake_ok:
                        raise
        return events

    def test_claim_precedes_board_and_wake(self):
        self.assertEqual(self.run_handoff()[:3], [["workspace", "claim"], "board", ["timer", "add"]])

    def test_rejected_claim_never_creates_board_or_wakes(self):
        self.assertEqual(self.run_handoff(claim_ok=False), [["workspace", "claim"]])

    def test_failed_wake_releases_fixed_claim(self):
        self.assertEqual(self.run_handoff(wake_ok=False)[-2:], ["unadd", "park"])


if __name__ == "__main__":
    unittest.main()
