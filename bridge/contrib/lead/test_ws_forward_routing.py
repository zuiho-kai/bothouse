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
            project_of=lambda w: {"deep": "deep", "肥鱼": "deep", "cjiang": "cjiang", "C酱": "cjiang",
                                  "gge": "gge", "G哥": "gge"}.get(w),
            LAST=types.SimpleNamespace(is_file=lambda: True, read_text=lambda **kw: json.dumps(self.record)),
        )
        self.board = types.SimpleNamespace(
            done_item=lambda p: None, paused_item=lambda p: None, done_records=lambda: [],
            items=lambda: [self.live], append_forward=Mock(), arm_guard=Mock(),
        )
        self.run = Mock(return_value=types.SimpleNamespace(returncode=0, stdout="Timer created: fake", stderr=""))
        self.ns = functions("ws-forward", {"append_result", "wake_prompt", "timer_cmd", "recipient_project", "other_chat_work", "reject_held_report",
                                                "task_ids", "find_live", "find_done", "reject_first", "reject_on_board", "main"}, dict(
            _team=self.team, board=self.board, json=json, re=re, os=os,
            subprocess=types.SimpleNamespace(run=self.run),
            sys=types.SimpleNamespace(exit=lambda message: (_ for _ in ()).throw(SystemExit(message)), stderr=io.StringIO()),
            time=types.SimpleNamespace(strftime=lambda fmt: "2026-11-08"),
            PROMPT_MAX=1500, Path=Path,
        ))

    def forward(self, *args):
        with contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"]([*args, "continue existing task"])
        # the timer that wakes the workspace (a held report's reject call may follow it)
        return next(c.args[0] for c in self.run.call_args_list if "timer" in c.args[0])

    def test_forward_rejects_held_report_after_delivery(self):
        # 11-09: a forward while the bridge holds this task's text [report] for the lead sends it back
        # (bothouse report reject) once the work reached the workspace.
        self.forward()
        # #1405: the reject lands first; the timer that wakes the workspace follows
        self.assertIn("timer", self.run.call_args_list[1].args[0])
        first = self.run.call_args_list[0].args[0]
        self.assertEqual(first[:5], ["bothouse", "report", "reject", "--id", "362"])
        self.assertEqual(first[first.index("--reason")+1], "continue existing task")

    def test_done_task_still_rejects_held_report(self):
        # 11-09 #1261: returned a minute earlier, the lead's forward exited on "已交回" without rejecting,
        # so the held [report] was posted 10 minutes later as 「主角色未验收」.
        done = dict(id=1261, where=self.notes, what="仿片照抄", done_at="11-09 13:15")
        self.record["board"] = [1261]
        self.board.items = lambda: []
        self.board.done_records = lambda: [done]
        self.board.done_item = lambda p: done if p == self.notes else None
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"](["redo the ending"])
        self.assertIn("已交回", str(cm.exception))
        cmds = [c.args[0] for c in self.run.call_args_list]
        self.assertEqual(len(cmds), 1)
        self.assertEqual(cmds[0][:5], ["bothouse", "report", "reject", "--id", "1261"])
        self.assertEqual(cmds[0][cmds[0].index("--reason")+1], "redo the ending")

    def test_same_notes_new_item_not_blocked_by_old_done_item(self):
        # 11-09: one notes file handed to two workspaces (#1261 done, #1271 live with a changed where);
        # done-by-filename found #1261 and blocked the forward meant for #1271.
        old = dict(id=1261, where=self.notes, done_at="11-09 13:15")
        self.board.done_item = lambda p: old if p == self.notes else None
        self.board.done_records = lambda: [old]
        self.live.update(id=1271, where="/work/tmp/fish1261", ws="discord:ws3")
        self.record["board"] = [1271]
        cmd = self.forward()
        self.assertEqual(cmd[cmd.index("-s")+1], "discord:ws3")
        reject = self.run.call_args_list[0].args[0]
        self.assertEqual(reject[:5], ["bothouse", "report", "reject", "--id", "1271"])
        self.board.arm_guard.assert_called_once_with(1271)

    def test_waiting_external_item_resumes_and_rejects_held_report(self):
        # #1378: 11-10 #1376 was parked 「等外部」 (workspace freed, busy on another chat's #936); the lead's
        # forward exited 「没转」 and the held progress report was posted 「主角色未验收」 10 minutes later.
        parked = dict(id=1376, where=self.notes, chat="discord:chat", paused="11-10 17:37", pause_why="等外部：CI 排队")
        other = dict(id=936, where="/other.md", ws="discord:ws3", chat="discord:other")
        self.record["board"] = [1376]
        self.board.items = lambda: [parked, other]
        self.board.paused_item = lambda p: parked if p == self.notes else None
        self.board.ASK_WHY, self.board.WAIT_EXT = "等待用户答复", "等外部："
        self.ns["__file__"] = str(HERE / "ws-forward")
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"](["CI 绿了，接着发版"])
        self.assertEqual(cm.exception.code, 0)
        cmds = [c.args[0] for c in self.run.call_args_list]
        # #1405: the reject lands on the task first, before any forwarding step can fail
        self.assertEqual(cmds[0][:5], ["bothouse", "report", "reject", "--id", "1376"])
        self.assertTrue(cmds[1][0].endswith("ws-handoff") and cmds[1][1:3] == ["--resume", "1376"], cmds[1])

    def returned_forward(self, board_rc=0, board_out="已记录退回问题；用 ws-handoff --resume <编号> <问题> 续办"):
        # 交回待验收的活（工作区已让出，returned_at 有值）被主角色转话
        done = dict(id=1500, where=self.notes, chat="discord:chat", returned_at="2026-11-12T10:00:00+09:00")
        self.record["board"] = [1500]
        self.board.items = lambda: [done]
        self.board.__file__ = "/gate/board.py"
        self.ns["sys"].executable = "py"
        self.ns["__file__"] = str(HERE / "ws-forward")
        def run(cmd, **kw):
            rc, out = (board_rc, board_out) if cmd[:3] == ["py", "/gate/board.py", "reject"] else (0, "")
            return types.SimpleNamespace(returncode=rc, stdout=out, stderr="board 报错" if rc else "")
        self.run.side_effect = run
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"](["打回：截图没对上"])
        return cm.exception.code, [c.args[0] for c in self.run.call_args_list]

    def test_returned_item_forward_records_reject_on_board(self):
        # #1492 L2：桥的 report reject 只丢扣着的汇报不改任务板；走 --resume 前要先 board reject，
        # 否则退回原因不记、返工次数不算、第二次退回的上限拦不住
        code, cmds = self.returned_forward()
        self.assertEqual(code, 0)
        self.assertEqual(cmds[1], ["py", "/gate/board.py", "reject", "1500", "打回：截图没对上"])
        self.assertTrue(cmds[2][0].endswith("ws-handoff") and cmds[2][1:3] == ["--resume", "1500"], cmds)

    def test_returned_item_board_reject_fail_stops(self):
        code, cmds = self.returned_forward(board_rc=1)
        self.assertIn("退回失败", str(code))
        self.assertFalse(any(c[0].endswith("ws-handoff") for c in cmds), cmds)

    def test_returned_item_second_reject_does_not_resume(self):
        code, cmds = self.returned_forward(board_out="第二次退回：已暂停「两轮未过，等用户」，已在聊天频道发 [ask] 请用户定")
        self.assertEqual(code, 0)
        self.assertFalse(any(c[0].endswith("ws-handoff") for c in cmds), cmds)

    def test_not_forwarded_still_rejects_by_notes(self):
        # #1405: 11-10 #1348 — the freed workspace was on another chat's #936, ws-forward --notes exited
        # 「没转」 without rejecting and the held report went out 「主角色未验收」.
        other = dict(id=936, where="/other.md", ws="discord:ws3", chat="discord:other")
        self.record["board"] = [1348]
        self.board.items = lambda: [other]
        self.board.done_records = lambda: []
        self.board.done_item = lambda p: None
        self.board.paused_item = lambda p: None
        with self.assertRaises(SystemExit) as cm, contextlib.redirect_stdout(io.StringIO()):
            self.ns["main"](["打回：误拦没上线"])
        self.assertIn("没转", str(cm.exception))
        cmds = [c.args[0] for c in self.run.call_args_list]
        self.assertEqual([c[:5] for c in cmds], [["bothouse", "report", "reject", "--id", "1348"]])

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
        # nothing goes to a workspace; the lead's words still count as the task's reject (#1405)
        self.assertTrue(all(c.args[0][1:3] == ["report", "reject"] for c in self.run.call_args_list), self.run.call_args_list)
        self.board.append_forward.assert_not_called()

    def test_legacy_record_resolves_current_named_owner(self):
        self.record.pop("project")
        self.assertEqual(self.forward()[4], "deep")

    def test_fixed_workspace_without_number_keeps_recorded_lead(self):
        self.record["project"] = "gge"
        self.live["who"] = "工作区gge"
        cmd = self.forward()
        self.assertEqual(cmd[cmd.index("-p")+1], "gge")

    def test_owner_project_suffix_names_the_lead_project(self):
        # #631: 11-10 four forwards to the lead's own workspace1 were refused「当前任务负责人无法唯一
        # 对应接收项目」with who=工作区1gge and no project in the record (gge is the lead, not a sub).
        self.record.pop("project")
        self.live["who"] = "工作区1gge"
        cmd = self.forward()
        self.assertEqual(cmd[cmd.index("-p")+1], "gge")
        self.team.project.assert_not_called()

    def test_owner_project_suffix_names_a_sub(self):
        self.record.pop("project")
        self.live["who"] = "工作区9肥鱼"
        self.assertEqual(self.forward()[4], "deep")

    def test_owner_named_in_subs_still_routes_without_record(self):
        self.record.pop("project")
        self.live["who"] = "工作区3C酱"
        self.assertEqual(self.forward()[4], "cjiang")

    def test_owner_written_as_lead_name_maps_to_lead_project(self):
        self.record.pop("project")
        self.live["who"] = "工作区1G哥"
        self.assertEqual(self.forward()[4], "gge")

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
            kickoff_maps=lambda *args: "", kickoff_existing=lambda *args: "", kickoff_long=lambda: "", Path=Path, re=re, PLAN_FIRST="plan", SOURCE="source", _QUOTE_SEC="quote",
            _recall=types.SimpleNamespace(SECTION="recall"), SKELETON="skeleton",
        ))
        cmd = ns["timer_cmd"]("discord:ws3", self.notes, "task", 362, project="deep")
        self.assertEqual(cmd[cmd.index("-p")+1], "deep")
        self.assertEqual(cmd[cmd.index("-s")+1], "discord:ws3")
        self.team.project.assert_not_called()


if __name__ == "__main__":
    unittest.main()
