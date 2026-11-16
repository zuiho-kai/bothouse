"""续做交接指向的旧任务还在做：并进旧任务的工作区，不新开任务、不另派会话。
来源：11-17 #1727 在工作区做着时，任务句写「接回 #1727」的新交接被开成 #1730、派给另一个工作区，
同一个面板做了两份（PR #1906 / #1908）。假桥和池子沿用 test_ws_up 的 FAKE_POOL，全在临时目录里跑。"""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_ws_up import FAKE_POOL  # noqa: E402


class ResumeRefTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "setup").mkdir()
        self.fake = self.tmp / "bothouse"
        self.fake.write_text(f"#!{sys.executable}\n" + FAKE_POOL)
        self.fake.chmod(0o755)
        Path(str(self.fake) + ".json").write_text(json.dumps({"ws": [
            {"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0},
            {"id": "2", "name": "工作区2", "owner": "", "open": 0, "parked": 0}]}))
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.tmp / "setup"),
                    "BOARD_DIR": str(self.tmp / "board"), "CC_BIN": str(self.fake), "CC_PROJECT": "lead-proj",
                    "CC_SESSION_KEY": "test:100", "WS_HANDOFF_WAIT": "1"}

    def note(self, n, title="交接"):
        p = self.tmp / f"{n}.md"
        p.write_text(f"# {title}\n\n# 用户原话\n# 总目标\n# 范围\n改：x\n不改：无\n# 已查过什么\n无（没查过）\n# 进度\n# 相关改动\n冲突：无\n"
                     "# 规矩\n# 参照实现\n- bridge/contrib/lead/ws-up:1\n", encoding="utf-8")
        return str(p)

    def handoff(self, notes, task, short, chat="test:100"):
        return subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), notes, task, "--short", short],
                              capture_output=True, text=True, env={**self.env, "CC_SESSION_KEY": chat})

    def claims(self, ws, rows):
        """桥的工作区状态（team_workspaces.json 的 handoffs）：假桥不写它，这里照桥的格式记。"""
        (self.tmp / "setup" / "team_workspaces.json").write_text(json.dumps({"handoffs": {ws: rows}}))

    def board(self, *args):
        return subprocess.run([str(HERE / "board"), *args], capture_output=True, text=True, env=self.env)

    def items(self):
        f = self.tmp / "board" / "board.jsonl"
        return [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []

    def timers(self, desc):
        f = Path(str(self.fake) + ".calls")
        calls = [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []
        return [c for c in calls if c[:2] == ["timer", "add"] and "--desc" in c and c[c.index("--desc") + 1].startswith(desc)]

    def start_old(self):
        r = self.handoff(self.note("old", "两单"), "处理两单，各自分支和 PR", "两单")
        self.assertEqual(r.returncode, 0, r.stderr)
        old = self.items()[0]
        self.assertTrue(old["ws"])
        self.claims(old["ws"], [{"chat": "test:100", "board": old["id"]}])
        return old

    def test_resume_handoff_joins_the_task_in_progress(self):
        old = self.start_old()
        new = self.note("resume", f"接回 #{old['id']}：用量面板")
        r = self.handoff(new, f"接回 #{old['id']}：完成面板并收口", "面板收口", chat="test:200")  # 11-17 是另一个聊天频道发的
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([i["id"] for i in self.items()], [old["id"]])  # 任务板没有新编号
        self.assertEqual(len(self.timers("工作区接手")), 1)  # 只有旧任务那一个会话被叫去开工
        fwd = self.timers("工作区转交")
        self.assertEqual(len(fwd), 1)
        self.assertEqual(fwd[0][fwd[0].index("-s") + 1], old["ws"])  # 内容送进正在做的工作区
        self.assertIn(new, fwd[0][fwd[0].index("--prompt") + 1])
        self.assertIn(f"#{old['id']}", r.stderr)

    def test_title_alone_is_enough(self):
        old = self.start_old()
        r = self.handoff(self.note("resume", f"续做 #{old['id']} 面板"), "完成面板并收口", "面板收口")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.items()), 1)
        self.assertEqual(len(self.timers("工作区转交")), 1)

    def test_same_notes_in_progress_joins_too(self):
        old = self.start_old()
        r = self.handoff(str(self.tmp / "old.md"), "补一句：先做面板", "两单补话")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.items()), 1)
        self.assertEqual(len(self.timers("工作区接手")), 1)
        fwd = self.timers("工作区转交")
        self.assertEqual(fwd[0][fwd[0].index("-s") + 1], old["ws"])

    def test_paused_old_task_opens_a_new_one_as_before(self):
        old = self.start_old()
        self.assertEqual(self.board("pause", str(old["id"])).returncode, 0)
        r = self.handoff(self.note("resume", f"接回 #{old['id']}：用量面板"), f"接回 #{old['id']}：完成面板并收口", "面板收口")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.items()), 2)
        self.assertEqual(len(self.timers("工作区接手")), 2)
        self.assertEqual(self.timers("工作区转交"), [])

    def test_workspace_moved_on_opens_a_new_one(self):
        """板上还挂着「在做」，工作区已经归了别的活：不并进去，照常新开。"""
        old = self.start_old()
        self.claims(old["ws"], [{"chat": "test:100", "board": old["id"], "closed": "2026-11-17T01:36:19+09:00"},
                                {"chat": "test:100", "board": 99}])
        r = self.handoff(self.note("resume", f"接回 #{old['id']}：用量面板"), f"接回 #{old['id']}：完成面板并收口", "面板收口")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.items()), 2)
        self.assertEqual(self.timers("工作区转交"), [])

    def test_mention_in_the_middle_is_a_new_task(self):
        old = self.start_old()
        r = self.handoff(self.note("copy", "面板文案"), f"写面板文案，等接回 #{old['id']} 那件合了再上", "面板文案")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(self.items()), 2)


if __name__ == "__main__":
    unittest.main()
