"""ws-up / ws-handoff 记来源 / ws-forward --notes：全在临时目录里跑，cc-connect 用假脚本记参数，不发真实消息。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class WsUpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.setup = self.tmp / "setup"
        self.setup.mkdir()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        self.calls = self.tmp / "calls.jsonl"
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\nimport json,sys\n"
                        f"open({str(self.calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\nprint('timer-1')\n")
        fake.chmod(0o755)
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOTHOUSE_DATA_DIR": str(self.tmp / "data"), "CC_BIN": str(fake), "CC_PROJECT": "lead-proj",
                    "WS_CHANNEL": "900"}
        self.last = self.setup / "ws-handoff-last.json"

    def run_tool(self, name, *args, key, var="CC_SESSION_KEY"):
        return subprocess.run([sys.executable, "-I", str(HERE / name), *args], capture_output=True, text=True,
                              env={**self.env, var: key})

    def handoff(self, *args, key):
        """ws-handoff 原样跑，只把 Discord API（查/建工作区频道）换成桩，不走网络。"""
        drv = ("import sys; from importlib.machinery import SourceFileLoader as L; "
               "m = L('ws_handoff', sys.argv[1]).load_module(); m.api = lambda *a, **k: {}; m.main(sys.argv[2:])")
        return subprocess.run([sys.executable, "-I", "-c", drv, str(HERE / "ws-handoff"), *args], capture_output=True,
                              text=True, env={**self.env, "CC_SESSION_KEY": key})

    def timers(self):
        return [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def write_last(self, tasks, **top):
        self.last.write_text(json.dumps({**top, "tasks": tasks}, ensure_ascii=False), encoding="utf-8")

    def test_reports_to_source_chat_with_lead_identity(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        r = self.run_tool("ws-up", "进度一半", key="test:900")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "timer-1")
        argv = self.timers()[0]
        self.assertEqual(argv[argv.index("-s") + 1], "test:100")
        self.assertEqual(argv[argv.index("-p") + 1], "lead-proj")
        prompt = argv[argv.index("--prompt") + 1]
        self.assertIn("【工作区上报】进度一半", prompt)
        self.assertIn("ws-forward --notes /n/a.md", prompt)

    def test_falls_back_to_cc_session_under_dsh(self):
        """DSH 删掉 CC_SESSION_KEY，只剩 CC_SESSION 时也要认出当前工作区。"""
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        r = self.run_tool("ws-up", "进度", key="test:900", var="CC_SESSION")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[0]
        self.assertEqual(argv[argv.index("-s") + 1], "test:100")

    def test_ask_mode(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        r = self.run_tool("ws-up", "选哪个？", "--ask", key="test:900")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[0]
        self.assertIn("【工作区要问用户】选哪个？", argv[argv.index("--prompt") + 1])
        self.assertEqual(argv[argv.index("--desc") + 1], "工作区提问")

    def test_multiple_chats_needs_notes(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"},
                         "/n/b.md": {"channel": "900", "chat": "test:200", "task": "B"}})
        r = self.run_tool("ws-up", "x", key="test:900")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--notes /n/a.md", r.stderr)
        self.assertEqual(self.timers(), [])
        r = self.run_tool("ws-up", "--notes", "/n/b.md", "x", key="test:900")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[0]
        self.assertEqual(argv[argv.index("-s") + 1], "test:200")

    def test_rejects_unknown_notes_and_non_workspace(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        self.assertNotEqual(self.run_tool("ws-up", "--notes", "/n/z.md", "x", key="test:900").returncode, 0)
        r = self.run_tool("ws-up", "x", key="test:555")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("不是交过活的工作区", r.stderr)
        self.assertEqual(self.timers(), [])

    def test_usage_errors_do_not_send(self):
        self.write_last({"/n/a.md": {"channel": "900", "chat": "test:100", "task": "A"}})
        for args in (["--help"], [], ["--notes"], ["-x"], ["a", "b"]):
            self.run_tool("ws-up", *args, key="test:900")
        self.assertEqual(self.timers(), [])

    def test_handoff_records_chat_and_forward_by_notes(self):
        notes = []
        for n in ("a", "b"):
            p = self.tmp / f"{n}.md"
            p.write_text("# 用户原话\n# 进度\n# 规矩\n# 参照实现\n- bridge/contrib/lead/ws-up:1\n", encoding="utf-8")
            notes.append(str(p))
        self.assertEqual(self.handoff(notes[0], "A", key="test:100").returncode, 0)
        self.env["WS_CHANNEL"] = "901"
        self.assertEqual(self.handoff(notes[1], "B", key="test:200").returncode, 0)
        last = json.loads(self.last.read_text(encoding="utf-8"))
        self.assertEqual(last["file"], notes[1])
        self.assertEqual(last["tasks"][notes[0]], {"channel": "900", "chat": "test:100", "task": "A", "board": [1]})
        # 工作区 900 报回交 a 进来的聊天频道
        self.assertEqual(self.run_tool("ws-up", "done", key="test:900").returncode, 0)
        rows = [json.loads(line) for line in (self.setup / "team" / "board.jsonl").read_text().splitlines()]
        self.assertIsNotNone(rows[0].get("progress_at"))
        argv = [t for t in self.timers() if "-s" in t][-1]  # 最后一条是进度戳后排的停滞检查，取 ws-up 自己的上报定时
        self.assertEqual(argv[argv.index("-s") + 1], "test:100")
        # 答复按 --notes 转回 a 所在工作区，而不是最近一次交接
        r = self.run_tool("ws-forward", "--notes", notes[0], "用户说选 A", key="test:100")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.timers()[-1]
        self.assertEqual(argv[argv.index("-s") + 1], "discord:900")
        self.assertIn("用户说选 A", Path(notes[0]).read_text(encoding="utf-8"))
        self.assertNotIn("用户说选 A", Path(notes[1]).read_text(encoding="utf-8"))



FAKE_POOL = r"""
import json, sys
st_path, calls = sys.argv[0] + ".json", sys.argv[0] + ".calls"
a = sys.argv[1:]
open(calls, "a").write(json.dumps(a) + "\n")
st = json.load(open(st_path))
def save(): json.dump(st, open(st_path, "w"))
if a[:2] == ["timer", "add"]:
    print("timer-1"); sys.exit(0)
if a[0] != "workspace":
    sys.exit(1)
sk = a[a.index("--session-key") + 1]
plat, chat = sk.split(":")[0], sk
ws = {w["id"]: w for w in st["ws"]}
if a[1] == "list":
    print(json.dumps({"parent": chat, "pool": st["ws"]}))
elif a[1] == "claim":
    w = ws[a[2]]
    if w["owner"] not in ("", chat):
        print("claimed by another chat", file=sys.stderr); sys.exit(1)
    w["owner"], w["open"] = chat, w["open"] + 1; save()
elif a[1] == "new":
    n = len(st["ws"]) + 1
    w = {"id": str(n), "name": f"工作区{n}", "owner": "", "open": 0, "parked": 0}
    st["ws"].append(w); save(); print(json.dumps({"workspace": w}))
elif a[1] == "park":
    w = ws.get(sk.split(":")[1])
    if not w or not w["owner"] or not w["open"] or ("--chat" in a and a[a.index("--chat") + 1].split(":u")[0] != w["owner"]):
        print("workspace is not owned by any chat channel", file=sys.stderr); sys.exit(1)
    w["open"], w["parked"] = w["open"] - 1, w["parked"] + 1
    if not w["open"]:
        w["owner"] = ""
    save(); print(json.dumps({"freed": not w["open"]}))
"""


class WsPoolTest(unittest.TestCase):
    """没配 WS_CHANNEL：走桥的共享池（list/claim/new/park），假桥把池子记在 JSON 里。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "setup").mkdir()
        self.fake = self.tmp / "bothouse"
        self.fake.write_text(f"#!{sys.executable}\n" + FAKE_POOL)
        self.fake.chmod(0o755)
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.tmp / "setup"),
                    "BOARD_DIR": str(self.tmp / "board"), "CC_BIN": str(self.fake), "CC_PROJECT": "lead-proj"}
        self.pool([])

    def pool(self, ws=None):
        f = Path(str(self.fake) + ".json")
        if ws is not None:
            f.write_text(json.dumps({"ws": ws}))
        return {w["name"]: w for w in json.loads(f.read_text())["ws"]}

    def note(self, n):
        p = self.tmp / f"{n}.md"
        p.write_text("# 用户原话\n# 进度\n# 规矩\n# 参照实现\n- bridge/contrib/lead/ws-up:1\n", encoding="utf-8")
        return str(p)

    def handoff(self, notes, task, chat="test:100"):
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), notes, task], capture_output=True, text=True,
                           env={**self.env, "CC_SESSION_KEY": chat})
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = [c for c in map(json.loads, Path(str(self.fake) + ".calls").read_text().splitlines())
                if c[:2] == ["timer", "add"] and "--desc" in c and c[c.index("--desc") + 1] == "工作区接手"][-1]
        return argv[argv.index("-s") + 1]

    def board(self, *args):
        r = subprocess.run([str(HERE / "board"), *args], capture_output=True, text=True, env=self.env)
        return r.returncode, r.stdout + r.stderr

    def items(self):
        f = self.tmp / "board" / "board.jsonl"
        return [json.loads(l) for l in f.read_text().splitlines()] if f.exists() else []

    def test_fills_to_busy_then_next(self):  # 方案 9：满 3 件后第 4 件落到下一个，不全进同一个
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0}])
        got = [self.handoff(self.note(f"n{k}"), f"T{k}") for k in range(5)]
        self.assertEqual(got, ["test:1", "test:1", "test:1", "test:2", "test:2"])
        self.assertNotIn("工作区3", self.pool())
        self.assertEqual([i["ws"] for i in self.items()], got)  # 每块都上板、绑工作区

    def test_same_notes_twice_both_bound(self):  # 方案 10：同一交接文件连交 2 件，两条都在
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0}])
        n = self.note("a")
        self.handoff(n, "A"); self.handoff(n, "B")
        records = json.loads((self.tmp / "setup" / "ws-handoff-last.json").read_text())["tasks"]
        self.assertEqual(len(records), 2)
        self.assertEqual([r["board"] for r in records.values()], [[1], [2]])
        self.assertEqual([r["task"] for r in records.values()], ["A", "B"])
        self.assertEqual([i["what"] for i in self.items()], ["A", "B"])

    def test_three_handoffs_balance_existing_workspaces(self):
        self.pool([{"id": str(i), "name": f"工作区{i}", "owner": "", "open": 0} for i in range(1, 4)])
        got = [self.handoff(self.note(str(i)), str(i)) for i in range(3)]
        self.assertEqual(got, ["test:1", "test:2", "test:3"])
        self.assertEqual([w["open"] for w in self.pool().values()], [1, 1, 1])

    def test_ask_pauses_bound_task_and_reuses_workspace(self):
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0}])
        note = self.note("question")
        self.handoff(note, "A")
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-up"), "--notes", note, "Choose A/B", "--ask"],
                           capture_output=True, text=True, env={**self.env, "CC_SESSION_KEY": "test:1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(self.items()[0].get("paused"))
        self.assertEqual(self.handoff(self.note("next"), "Next"), "test:1")

    def test_stale_bound_task_pauses_but_future_check_stays(self):
        import time
        self.pool([{"id": str(i), "name": f"工作区{i}", "owner": "", "open": 0} for i in range(1, 3)])
        self.handoff(self.note("old"), "Old")
        self.handoff(self.note("scheduled"), "Scheduled")
        rows = self.items()
        for row in rows:
            row["at"] = time.strftime("%m-%d %H:%M", time.localtime(time.time() - 7200))
            row["progress_at"] = time.time() - 7200
        rows[1]["next_ts"] = time.time() + 3600
        (self.tmp / "board" / "board.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        self.assertEqual(self.board("refresh")[0], 0)
        self.assertTrue(self.items()[0].get("paused"))
        self.assertFalse(self.items()[1].get("paused"))

    def test_paused_old_workspace_reused(self):  # 方案 11：暂停放回的旧号 + 一个满的：新活落到旧号，不新建
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0},
                   {"id": "2", "name": "工作区2", "owner": "test:100", "open": 3, "parked": 0}])
        self.assertEqual(self.handoff(self.note("old"), "旧活"), "test:1")
        code, out = self.board("pause", "1", "等用户")
        self.assertEqual(code, 0, out)
        self.assertIn("工作区已放回池子", out)
        self.assertEqual(self.pool()["工作区1"]["owner"], "")
        self.assertEqual(self.handoff(self.note("new"), "新活", chat="test:200"), "test:1")
        self.assertNotIn("工作区3", self.pool())

    def test_pause_keeps_just_handed_task(self):  # 审查第二轮：先交 B，再停旧活，B 照旧占着，别的频道不挑它
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0}])
        self.handoff(self.note("x"), "旧活 X")
        self.handoff(self.note("b"), "新活 B")
        code, out = self.board("pause", "1")
        self.assertEqual(code, 0, out)
        self.assertNotIn("放回池子", out)
        w = self.pool()["工作区1"]
        self.assertEqual((w["owner"], w["open"]), ("test:100", 1))
        self.assertEqual(self.handoff(self.note("c"), "C", chat="test:200"), "test:2")

    def test_manual_item_in_workspace_does_not_park(self):  # 没绑工作区的条目（工作区里手动 add 的）暂停不动桥
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0}])
        self.handoff(self.note("x"), "X")
        r = subprocess.run([str(HERE / "board"), "add", "顺手的事", "-", "s", "工作区1主角色"], capture_output=True,
                           text=True, env={**self.env, "CC_SESSION_KEY": "test:1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.board("pause", "2")
        self.assertEqual(self.pool()["工作区1"]["open"], 1)

    def test_who_moved_out_parks(self):  # 「谁」改走（如改成待接手）：它那件交接放回
        self.pool([{"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0}])
        self.handoff(self.note("x"), "X")
        code, out = self.board("update", "1", "等人接", "-", "待接手")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.pool()["工作区1"]["owner"], "")
        self.assertNotIn("ws", self.items()[0])

    def test_migrates_unbound_once(self):  # 升级前没绑编号的旧交接：名下没有在做条目的工作区放回，有的不动；只迁一次
        self.pool([{"id": "1", "name": "工作区1", "owner": "test:100", "open": 2, "parked": 0},
                   {"id": "2", "name": "工作区2", "owner": "test:100", "open": 1, "parked": 0},
                   {"id": "3", "name": "工作区3", "owner": "test:100", "open": 3, "parked": 0}])
        r = subprocess.run([str(HERE / "board"), "add", "还在做", "-", "s", "工作区2主角色"], capture_output=True,
                           text=True, env={**self.env, "CC_SESSION_KEY": "test:2"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.handoff(self.note("a"), "A"), "test:1")
        p = self.pool()
        self.assertEqual((p["工作区1"]["open"], p["工作区1"]["parked"]), (1, 2))
        self.assertEqual(p["工作区2"]["open"], 1)
        self.assertEqual(p["工作区3"]["open"], 0)  # 只剩旧交接、板上没在做的：放回
        p3 = {**p["工作区3"], "owner": "test:100", "open": 3}
        self.pool([p["工作区1"], p["工作区2"], p3])
        self.handoff(self.note("b"), "B")
        self.assertEqual(self.pool()["工作区3"]["open"], 3)  # 迁过一次就不再迁
    def test_migration_keeps_working_workspaces(self):  # 审查 pr261-code.md 第 3 条：在做的工作区一个都不放
        self.pool([{"id": "1", "name": "工作区1", "owner": "test:100", "open": 1, "parked": 0},
                   {"id": "2", "name": "工作区2", "owner": "test:100", "open": 1, "parked": 0},
                   {"id": "3", "name": "工作区3", "owner": "test:100", "open": 1, "parked": 0},
                   {"id": "4", "name": "工作区4", "owner": "test:300", "open": 1, "parked": 0}])
        # 工作区1 只剩一条 later 回查条目（等 CI，带 next）
        r = subprocess.run([str(HERE / "board"), "add", "等 CI", "-", "s", "工作区1主角色", "--next", "23:59"],
                           capture_output=True, text=True, env={**self.env, "CC_SESSION_KEY": "test:1", "BOARD_LATER": "1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        # 工作区2：聊天频道 add 的条目（条目频道是聊天频道），工作区只把「谁」改成「工作区2…」
        r = subprocess.run([str(HERE / "board"), "add", "旧活", "-", "s", "橘"], capture_output=True, text=True,
                           env={**self.env, "CC_SESSION_KEY": "test:100"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.board("update", "2", "做着", "-", "工作区2橘")[0], 0)
        self.handoff(self.note("a"), "A")
        p = self.pool()
        self.assertEqual((p["工作区1"]["open"], p["工作区1"]["owner"]), (1, "test:100"))
        self.assertEqual((p["工作区2"]["open"], p["工作区2"]["owner"]), (1, "test:100"))
        self.assertEqual(p["工作区3"]["open"], 1)  # 只剩旧交接、板上没在做的：放回后被 A 领走
        self.assertEqual(p["工作区3"]["parked"], 1)
        self.assertEqual((p["工作区4"]["open"], p["工作区4"]["owner"]), (1, "test:300"))  # 别的聊天频道的不碰

class HandoffNotesCheckTest(unittest.TestCase):
    """交接文件要带参照实现（文件:行 或「无（新建）」）；写了多人改同组文件还要底分支。缺了不建定时、不上任务板。"""
    setUp, handoff, timers = WsUpTest.setUp, WsUpTest.handoff, WsUpTest.timers
    BASE = "# 交接\n## 用户原话\n「x」\n## 进度\n| a |\n## 规矩\n- y\n"
    GOOD = BASE + "## 参照实现\n- bridge/contrib/lead/ws-up:120（差异：不发卡）\n"

    def check(self, text):
        drv = ("import sys; from importlib.machinery import SourceFileLoader as L; "
               "m = L('ws_handoff', sys.argv[1]).load_module(); r = m.check_notes(sys.stdin.read()); print(r or 'OK')")
        r = subprocess.run([sys.executable, "-I", "-c", drv, str(HERE / "ws-handoff")], input=text,
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout.strip()

    def refused(self, text):
        p = self.tmp / "n.md"
        p.write_text(text, encoding="utf-8")
        r = self.handoff(str(p), "任务", key="test:100")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.timers(), [])  # 没建定时
        self.assertFalse((self.setup / "team" / "board.jsonl").exists())  # 没上任务板
        return r.stderr

    def test_missing_ref_refused(self):
        err = self.refused(self.BASE)
        self.assertIn("缺参照实现：写 文件:行，非代码活写「无（新建）」", err)
        self.assertIn(":120", err)  # 带一行示例
        # 节里只有时间、引用在别的节里，都不算
        self.assertIn("缺参照实现", self.refused(self.BASE + "## 参照实现\n- 还没找，14:30 再说\n## 其他\n- a.py:3\n"))

    def test_ref_passes(self):
        for t in (self.GOOD, self.BASE + "参照实现：bridge/contrib/lead/ws-up:120，差异：不发卡\n",
                  self.BASE + "## 3. 参照实现与差异\n看 `gate/board.py:88`\n",
                  self.BASE + "- 参照实现：无（新建）\n"):
            self.assertEqual(self.check(t), "OK", t)

    def test_multi_editor_needs_base(self):
        self.assertIn("底分支", self.refused(self.GOOD + "## 共改文件\n- agent_hooks.go\n"))
        self.assertIn("底分支", self.check(self.GOOD + "## 多人改\n- x\n底分支：\n"))
        self.assertEqual(self.check(self.GOOD + "## 共改文件\n- agent_hooks.go\n底分支：feat/approvals\n"), "OK")
        self.assertEqual(self.check(self.GOOD + "- 底分支: main\n## 多人改\n"), "OK")
        self.assertEqual(self.check(self.GOOD + "正文提到多人改，但没有这一节\n"), "OK")


if __name__ == "__main__":
    unittest.main()
