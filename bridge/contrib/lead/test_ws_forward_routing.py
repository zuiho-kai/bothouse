"""Workspace/project recipient regression; pure fake bridge, no files or timers."""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import types
import unittest
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent


def functions(file, names, ns):
    tree = ast.parse((HERE / file).read_text())
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), file, "exec"), ns)
    return ns


class ForwardRecipientTest(unittest.TestCase):
    def setUp(self):
        self.notes = "/persistent/notes/task.md"
        self.record = dict(file=self.notes, channel="discord:ws3", chat="discord:chat", project="deep")
        self.live = dict(id=362, where=self.notes, ws="discord:ws3", chat="discord:chat", who="工作区3肥鱼")
        self.team = types.SimpleNamespace(
            project=Mock(side_effect=AssertionError("must not use the caller gge as recipient")),
            cc_bin=lambda: "bothouse",
            team=lambda: {"subs": {"deep": {"name": "肥鱼"}}},
            name_of=lambda p: {"deep": "肥鱼"}.get(p, p),
            LAST=types.SimpleNamespace(is_file=lambda: True, read_text=lambda **kw: json.dumps(self.record)),
        )
        self.board = types.SimpleNamespace(
            done_item=lambda p: None, paused_item=lambda p: None,
            items=lambda: [self.live], append_forward=Mock(), arm_guard=Mock(),
        )
        self.run = Mock(return_value=types.SimpleNamespace(returncode=0, stdout="Timer created: fake", stderr=""))
        self.ns = functions("ws-forward", {"append_result", "wake_prompt", "timer_cmd", "recipient_project", "other_chat_work", "main"}, dict(
            _team=self.team, board=self.board, json=json, re=re, os=os,
            subprocess=types.SimpleNamespace(run=self.run),
            sys=types.SimpleNamespace(exit=lambda message: (_ for _ in ()).throw(SystemExit(message))),
            time=types.SimpleNamespace(strftime=lambda fmt: "2026-11-08"),
            PROMPT_MAX=1500, Path=Path,
        ))

    def forward(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"]([*args, "continue existing task"])
        return self.run.call_args.args[0]

    def test_cross_project_forward_keeps_recipient_and_workspace(self):
        cmd = self.forward()
        self.assertEqual(cmd[cmd.index("-p")+1], "deep")
        self.assertEqual(cmd[cmd.index("-s")+1], "discord:ws3")
        self.assertIn("--forward", cmd)
        self.team.project.assert_not_called()

    def test_transfer_uses_current_owner_and_current_workspace(self):
        self.record["project"] = "gge"
        self.live["ws"] = "discord:ws4"
        cmd = self.forward("--interrupt")
        self.assertEqual(cmd[cmd.index("-p")+1], "deep")
        self.assertEqual(cmd[cmd.index("-s")+1], "discord:ws4")
        self.assertIn("--inject-if-busy", cmd)

    def test_unknown_owner_does_not_append_or_dispatch(self):
        self.live["who"] = "工作区3未绑定成员"
        with self.assertRaises(SystemExit):
            self.forward()
        self.run.assert_not_called()
        self.board.append_forward.assert_not_called()

    def test_legacy_record_resolves_current_named_owner(self):
        self.record.pop("project")
        self.assertEqual(self.forward()[4], "deep")

    def test_fixed_workspace_without_number_keeps_recorded_lead(self):
        self.record["project"] = "gge"
        self.live["who"] = "工作区gge"
        cmd = self.forward()
        self.assertEqual(cmd[cmd.index("-p")+1], "gge")

    def test_legacy_without_owner_never_falls_back_to_sender(self):
        with self.assertRaises(ValueError):
            self.ns["recipient_project"]({}, None)
        with self.assertRaises(ValueError):
            self.ns["timer_cmd"]("discord:ws3", self.notes, "continue")
        self.team.project.assert_not_called()

    def test_notes_record_retains_recipient(self):
        self.record["tasks"] = {self.notes: dict(channel="ws3", ws_key="discord:ws3", chat="discord:chat", project="deep")}
        cmd = self.forward("--notes", self.notes)
        self.assertEqual(cmd[cmd.index("-p")+1], "deep")

    def test_handoff_records_actual_project_for_queued_dispatch(self):
        last = Mock()
        last.read_text.side_effect = OSError()
        ns = functions("ws-handoff", {"record_last"}, dict(json=json, _team=types.SimpleNamespace(LAST=last, project=lambda: "gge")))
        ns["record_last"](self.notes, "discord:ws3", "task", "discord:chat", 362, "deep")
        saved = json.loads(last.write_text.call_args.args[0])
        self.assertEqual(saved["project"], "deep")
        self.assertEqual(saved["tasks"][self.notes]["project"], "deep")

    def test_queued_handoff_wakes_recorded_project(self):
        ns = functions("ws-handoff", {"timer_cmd"}, dict(
            _team=self.team, cc_bin=lambda: "bothouse", KICKOFF="",
            kickoff_maps=lambda *args: "", SOURCE="source", _QUOTE_SEC="quote",
            _recall=types.SimpleNamespace(SECTION="recall"), SKELETON="skeleton",
        ))
        cmd = ns["timer_cmd"]("discord:ws3", self.notes, "task", 362, project="deep")
        self.assertEqual(cmd[cmd.index("-p")+1], "deep")
        self.assertEqual(cmd[cmd.index("-s")+1], "discord:ws3")
        self.team.project.assert_not_called()


if __name__ == "__main__":
    unittest.main()
