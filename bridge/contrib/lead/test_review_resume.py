"""#797: rejection keeps ownership-safe workspace preference, using fake bridge boundaries."""
import json
import os
from pathlib import Path
import runpy
import tempfile
import types
import unittest
from unittest.mock import patch


class ReviewResume(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = patch.dict(os.environ, {
            "GATE_SETUP_DIR": self.tmp,
            "BOARD_DIR": self.tmp,
            "CC_BIN": "/usr/bin/false",
            "CC_PROJECT": "reviewer",
            "CC_SESSION_KEY": "room:chat",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.mod = runpy.run_path(str(Path(__file__).with_name("ws-handoff")))
        self.g = self.mod["pick_pool"].__globals__

    def choose(self, pool, preferred):
        calls = []

        def claim(args, **kwargs):
            calls.append(args)
            return types.SimpleNamespace(returncode=0, stderr="")

        with patch.dict(self.g, {
            "ws_cmd": lambda *args: {"parent": "room:chat", "pool": pool},
            "migrate_unbound": lambda *args: False,
        }), patch.object(self.g["subprocess"], "run", claim):
            got = self.mod["pick_pool"]("room:chat", "redo", 46, preferred)
        return got, calls

    def test_original_workspace_first_only_when_free_and_owned(self):
        pool = [{"id": "1", "name": "工作区1", "open": 0},
                {"id": "3", "name": "工作区3", "open": 0}]
        got, calls = self.choose(pool, "room:3")
        self.assertEqual(got[0], "room:3")
        self.assertEqual(len(calls), 1)
        pool[1]["open"] = 1
        self.assertEqual(self.choose(pool, "room:3")[0][0], "room:1")
        pool[1].update(open=0, owner="room:other")
        self.assertEqual(self.choose(pool, "room:3")[0][0], "room:1")

    def test_busy_pool_creates_new_workspace_or_fails(self):
        pool = [{"id": "1", "name": "工作区1", "open": 1}]
        calls = []
        with patch.dict(self.g, {
            "ws_cmd": lambda *args: {"parent": "room:chat", "pool": pool, "workspace": {}},
            "migrate_unbound": lambda *args: False,
        }), patch.object(self.g["subprocess"], "run", lambda *a, **k: calls.append(a)):
            with self.assertRaises(SystemExit) as cm:
                self.mod["pick_pool"]("room:chat", "redo", 46, "room:3")
            self.assertIn("workspace new 没回工作区", str(cm.exception))
        self.assertEqual(calls, [])

    def wake_fails(self, items, call):
        """#1492 L3 共用：真任务板写在临时目录，工作区挑中工作区3，叫醒（timer add）失败。"""
        board = self.g["board"]
        tmp = Path(self.tmp)
        (tmp / "board.jsonl").write_text("".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items))
        parked = []
        with patch.object(board, "DIR", tmp), patch.dict(self.g, {
                "pick_pool": lambda *a: ("room:3", "工作区3", "room:chat"),
                "QUEUE": tmp / "ws-queue.json", "cc_bin": lambda: "bothouse",
                "append_skeleton": lambda *a: None}), \
             patch.object(board, "_park_once", lambda *a, **k: parked.append(a) or True), \
             patch.object(board, "_del_timer", lambda *a: None), \
             patch.object(self.g["_recall"], "append_to", lambda *a: None), \
             patch.object(self.g["subprocess"], "run",
                          lambda *a, **k: types.SimpleNamespace(returncode=1, stdout="", stderr="timer 坏了")):
            with self.assertRaises(SystemExit) as cm:
                call()
            after = board.items()
        return str(cm.exception.code), after, parked

    def test_wake_fail_restores_board(self):
        # #1492 L3：叫醒失败原先只放回工作区，任务板停在「已交接」、绑着工作区3
        item = {"id": 46, "what": "redo", "where": "/n.md", "status": "排队", "chat": "room:chat", "at": "11-12 10:00"}
        msg, after, parked = self.wake_fails([item], lambda: self.mod["start"]("/n.md", "redo", "room:chat", 46, "reviewer"))
        self.assertEqual(after[0]["id"], item["id"])
        self.assertEqual(after[0]["status"], item["status"])
        self.assertTrue(parked)
        self.assertIn("任务板已退回改前", msg)
        self.assertIn("工作区已放回", msg)

    def test_resume_wake_fail_restores_paused_item(self):
        notes = Path(self.tmp) / "n.md"
        notes.write_text("# 交接\n")
        item = {"id": 47, "what": "redo", "where": str(notes), "status": "验收退回：截图不对", "chat": "room:chat",
                "paused": "11-12 10:00", "pause_why": "验收退回：截图不对", "review_rejected": "截图不对", "at": "11-12 10:00"}
        msg, after, _ = self.wake_fails([item], lambda: self.mod["resume_answered"](47, "截图重截"))
        self.assertEqual(after[0]["id"], item["id"])
        self.assertEqual(after[0]["status"], item["status"])
        self.assertIn("已退回接回前", msg)
        self.assertIn("没送到", notes.read_text())

    def test_rejected_task_passes_preference_through_start(self):
        board = self.g["board"]
        seen = []
        def pick(*args):
            seen.append(args)
            return None
        with patch.object(board, "items", return_value=[{"id": 46, "ws_was": "room:3", "review_rejected": "test"}]), patch.dict(self.g, {"pick_pool": pick}):
            self.assertFalse(self.mod["start"]("notes", "redo", "room:chat", 46, "reviewer"))
        self.assertEqual(seen, [("room:chat", "redo", 46, "room:3")])

    def test_resume_reassign_updates_dispatcher_and_skips_old_workspace(self):
        """#2086: 任务由 devin 派发并被 board pause 暂停后，显式 --project cjiang 改派接手续做：
        1. dispatcher 改为 cjiang；
        2. start 重新挑干净工作区，不复用 devin 的旧区。"""
        board = self.g["board"]
        tmp = Path(self.tmp)
        notes = tmp / "n.md"
        notes.write_text("# 交接\n")
        item = {"id": 988, "what": "fix", "where": str(notes), "status": "暂停", "chat": "room:chat",
                "paused": "11-23 00:07", "pause_why": "叫停改由C酱接手", "dispatcher": "devin",
                "ws_was": "room:3", "at": "11-23 00:05"}
        (tmp / "board.jsonl").write_text(json.dumps(item, ensure_ascii=False) + "\n")
        seen_pick = []
        held_called = []
        with patch.object(board, "DIR", tmp), patch.dict(self.g, {
            "pick_pool": lambda *a: seen_pick.append(a) or ("room:1", "工作区1", "room:chat"),
            "held": lambda *a: held_called.append(a) or ("room:3", "工作区3", "room:chat"),
            "append_skeleton": lambda *a: None,
            "timer_cmd": lambda *a: ["true"],
            "arm_drift": lambda *a: None,
            "record_last": lambda *a: None,
            "_recall": types.SimpleNamespace(append_to=lambda *a: None),
        }), patch.object(self.g["subprocess"], "run", lambda *a, **k: types.SimpleNamespace(returncode=0, stdout="Timer created: t1", stderr="")), \
           patch.dict(os.environ, {"CC_PROJECT": "cjiang", "CC_SESSION_KEY": "room:chat"}):
            self.mod["resume_answered"](988, "接手", project="cjiang")
            after = board.items()[0]
        self.assertEqual(after["dispatcher"], "cjiang")
        self.assertIn("cjiang", after["who"])
        self.assertEqual(held_called, [])  # 改派不得复用旧区
        self.assertEqual(seen_pick[0][3], "")  # 改派不得偏好原 ws_was

    def test_resume_without_project_retains_dispatcher_and_workspace(self):
        """#2086: 调用方≠原负责人、无 --project、非提问（如桥到点重试、主角色退回队友派的活）：
        仍保留原负责人和原工作区，不得误判改派。"""
        board = self.g["board"]
        tmp = Path(self.tmp)
        notes = tmp / "n.md"
        notes.write_text("# 交接\n")
        item = {"id": 988, "what": "fix", "where": str(notes), "status": "暂停", "chat": "room:chat",
                "paused": "11-23 00:07", "pause_why": "等外部：依赖分支合并", "dispatcher": "devin",
                "ws_was": "room:3", "at": "11-23 00:05"}
        (tmp / "board.jsonl").write_text(json.dumps(item, ensure_ascii=False) + "\n")
        seen_pick = []
        held_called = []
        with patch.object(board, "DIR", tmp), patch.dict(self.g, {
            "pick_pool": lambda *a: seen_pick.append(a) or ("room:3", "工作区3", "room:chat"),
            "held": lambda *a: held_called.append(a) or None,
            "append_skeleton": lambda *a: None,
            "timer_cmd": lambda *a: ["true"],
            "arm_drift": lambda *a: None,
            "record_last": lambda *a: None,
            "_recall": types.SimpleNamespace(append_to=lambda *a: None),
        }), patch.object(self.g["subprocess"], "run", lambda *a, **k: types.SimpleNamespace(returncode=0, stdout="Timer created: t1", stderr="")), \
           patch.dict(os.environ, {"CC_PROJECT": "cjiang", "CC_SESSION_KEY": "room:chat"}):
            self.mod["resume_answered"](988, "到点重试")
            after = board.items()[0]
        self.assertEqual(after["dispatcher"], "devin")
        self.assertIn("devin", after["who"])
        self.assertEqual(seen_pick[0][3], "room:3")  # 默认无 --project 时保留原工作区偏好

    def test_resume_in_progress_task_retains_held_workspace(self):
        """#2086: 任务未放回工作区（如等待期间保持工作区占有），续做时继续走 held 复用原工作区。"""
        board = self.g["board"]
        tmp = Path(self.tmp)
        notes = tmp / "n.md"
        notes.write_text("# 交接\n")
        item = {"id": 990, "what": "fix", "where": str(notes), "status": "暂停", "chat": "room:chat",
                "paused": "11-23 00:07", "pause_why": "等外部：pr CI 通过", "dispatcher": "devin",
                "ws": "room:3", "at": "11-23 00:05"}
        (tmp / "board.jsonl").write_text(json.dumps(item, ensure_ascii=False) + "\n")
        held_called = []
        pick_called = []
        with patch.object(board, "DIR", tmp), patch.dict(self.g, {
            "held": lambda *a: held_called.append(a) or ("room:3", "工作区3", "room:chat"),
            "pick_pool": lambda *a: pick_called.append(a) or ("room:1", "工作区1", "room:chat"),
            "append_skeleton": lambda *a: None,
            "timer_cmd": lambda *a: ["true"],
            "arm_drift": lambda *a: None,
            "record_last": lambda *a: None,
            "_recall": types.SimpleNamespace(append_to=lambda *a: None),
        }), patch.object(self.g["subprocess"], "run", lambda *a, **k: types.SimpleNamespace(returncode=0, stdout="Timer created: t1", stderr="")), \
           patch.dict(os.environ, {"CC_PROJECT": "cjiang", "CC_SESSION_KEY": "room:chat"}):
            self.mod["resume_answered"](990, "重试")
            after = board.items()[0]
        self.assertEqual(after["dispatcher"], "devin")
        self.assertEqual(len(held_called), 1)  # 优先复用已占工作区
        self.assertEqual(pick_called, [])

    def test_resume_ask_retains_original_dispatcher(self):
        """#1727 保持：若是工作区提问（[ask]），主角色转达定案不改变原负责人 dispatcher。"""
        board = self.g["board"]
        tmp = Path(self.tmp)
        notes = tmp / "n.md"
        notes.write_text("# 交接\n")
        item = {"id": 989, "what": "feat", "where": str(notes), "status": "等你", "chat": "room:chat",
                "paused": "11-23 00:07", "pause_why": board.ASK_WHY, "dispatcher": "longniang",
                "at": "11-23 00:05"}
        (tmp / "board.jsonl").write_text(json.dumps(item, ensure_ascii=False) + "\n")
        started_project = []
        with patch.object(board, "DIR", tmp), patch.dict(self.g, {
            "start": lambda p, t, c, nid, proj, ans, *a, **k: started_project.append(proj) or True,
            "append_skeleton": lambda *a: None,
            "_recall": types.SimpleNamespace(append_to=lambda *a: None),
        }), patch.dict(os.environ, {"CC_PROJECT": "cjiang", "CC_SESSION_KEY": "room:chat"}):
            self.mod["resume_answered"](989, "定案")
            after = board.items()[0]
        self.assertEqual(after["dispatcher"], "longniang")
        self.assertEqual(started_project, ["longniang"])

    def test_resume_cli_flags(self):
        """#2086: main --resume 支持解析 --project、--model、--effort。"""
        calls = []
        with patch.dict(self.g, {
            "resume_answered": lambda nid, ans, project=None, model=None, effort=None: calls.append((nid, ans, project, model, effort))
        }):
            self.mod["main"](["--resume", "#123", "接着改", "--project", "luna", "--model", "gpt-5", "--effort", "high"])
        self.assertEqual(calls, [(123, "接着改", "luna", "gpt-5", "high")])


if __name__ == "__main__":
    unittest.main()
