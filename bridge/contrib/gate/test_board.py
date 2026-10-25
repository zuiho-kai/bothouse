"""任务板（board.py）和它进每轮上下文（ctxsvc.board_items）的最小测试：python3 -I test_board.py"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
TMP = tempfile.mkdtemp()
os.environ["BOARD_DIR"] = TMP
os.environ.pop("CC_SESSION_KEY", None)
os.environ.pop("DISCORD_BOT_TOKEN", None)  # board 不读平台 token、不发卡片（#597 K9）
os.environ["CC_BIN"] = "false"  # 不问真桥
os.environ.pop("BOARD_PR_REPO", None)  # done 后不调 gh
import board  # noqa: E402
import ctxsvc  # noqa: E402


def cli(*args):
    p = subprocess.run([str(HERE.parent / "lead" / "board"), *args], capture_output=True, text=True,
                       env={**os.environ, "BOARD_DIR": TMP})
    return p.returncode, (p.stdout + p.stderr).strip()


class Board(unittest.TestCase):
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()

    def test_add_update_done(self):
        self.assertEqual(cli("add", "@ 路由修复", "PR #236", "等实测", "橘"), (0, "#1"))
        self.assertEqual(cli("add", "release 0.1.1", "~/code/x", "写说明", "鲸鱼娘"), (0, "#2"))
        self.assertEqual(cli("update", "#1", "已合并")[0], 0)
        out = cli()[1].splitlines()
        self.assertEqual(len(out), 2)
        self.assertTrue(out[0].startswith("#1 @ 路由修复｜PR #236｜已合并｜橘｜"), out[0])
        self.assertEqual(cli("done", "1", "0")[0], 0)
        self.assertTrue(cli()[1].startswith("#2 "))
        self.assertEqual(cli("add", "a", "b", "c", "龙娘"), (0, "#3"))  # 结束过的编号不再用
        self.assertIn('"done_at"', (Path(TMP) / "board-done.jsonl").read_text())

    def test_bad_input(self):
        self.assertNotEqual(cli("done", "9")[0], 0)
        self.assertNotEqual(cli("done", "x")[0], 0)
        self.assertNotEqual(cli("add", "只有一项")[0], 0)
        self.assertEqual(cli(), (0, "（任务板是空的）"))

    def test_add_refuses_lookback(self):
        self.assertEqual(cli("add", "修登录页", "-", "在做", "橘"), (0, "#1"))
        rc, out = cli("add", "#1 回来看", "-", "在做", "橘")
        self.assertNotEqual(rc, 0); self.assertIn("指向板上已有的 #1", out)
        rc, out = cli("add", "回头看看", "-", "等着 CI", "橘")
        self.assertNotEqual(rc, 0); self.assertIn("没有 PR 号/路径", out)
        self.assertEqual(cli("add", "#9 不在板上", "-", "在做", "橘"), (0, "#2"))  # 指向不存在的编号不算回看
        self.assertEqual(cli("add", "等 CI", "PR #12", "等着 CI", "橘"), (0, "#3"))  # 等着但有 PR 号
        self.assertEqual(cli("add", "等合并", "-", "等着 PR #13 合", "橘"), (0, "#4"))
        self.assertEqual(len(cli()[1].splitlines()), 4)

    def test_done_needs_rework_and_reason(self):
        cli("add", "x", "-", "s", "橘")
        rc, out = cli("done", "1")
        self.assertNotEqual(rc, 0); self.assertIn("要写返工次数", out)
        rc, out = cli("done", "1", "2")
        self.assertNotEqual(rc, 0); self.assertIn("要写原因", out)
        self.assertNotEqual(cli("done", "1", "1", "  ")[0], 0)
        self.assertEqual(cli()[1].count("#1 "), 1)  # 被拒的不结束
        self.assertEqual(cli("done", "1", "1", "没先读现有实现"), (0, "已结束"))

    def test_next_subcommand_needs_later(self):
        cli("add", "x", "-", "s", "橘")
        rc = subprocess.run([str(HERE.parent / "lead" / "board"), "next", "1", "14:30"], capture_output=True, text=True,
                                 env={k: v for k, v in os.environ.items() if k != "BOARD_LATER"} | {"BOARD_DIR": TMP}).returncode
        self.assertNotEqual(rc, 0)
        self.assertNotIn("next", board.items()[0])
        env = {**os.environ, "BOARD_DIR": TMP, "BOARD_LATER": "1"}
        p = subprocess.run([str(HERE.parent / "lead" / "board"), "next", "1", "14:30"], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout.splitlines(), ["{}", "x"])
        self.assertEqual(board.items()[0]["next"], "14:30")
        p = subprocess.run([str(HERE.parent / "lead" / "board"), "next", "1", "--restore", "{}"], capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("next", board.items()[0])
        p = subprocess.run([str(HERE.parent / "lead" / "board"), "next", "9", "14:30"], capture_output=True, text=True, env=env)
        self.assertNotEqual(p.returncode, 0)

    def test_context_push_changes_with_board(self):
        self.assertEqual(ctxsvc.board_items(), [])  # 没用过任务板不附
        board._write([])
        empty = ctxsvc.board_items()
        self.assertIn("现在没有进行中的事", empty[0]["desc"])
        board.add("x", "y", "z", "橘")
        one = ctxsvc.board_items()
        self.assertNotEqual(empty[0]["path"], one[0]["path"])  # 板子变了 path 就变，cc-connect 会重推
        self.assertIn("#1 x｜y｜z｜橘", one[0]["desc"])
        self.assertEqual(one, ctxsvc.board_items())  # 不变就不重推
        self.assertIn(one[0], ctxsvc.context({"key": "discord:1", "text": "hi", "bot": "jingyu"})["wiki"])

    def test_not_a_team_status_file(self):  # cc-connect 把 team/*.json 当队友状态读，任务板不能叫 .json
        board.add("x", "y", "z", "橘")
        self.assertEqual(list(Path(TMP).glob("*.json")), [])


class Increments(unittest.TestCase):
    """暂停/恢复、挂卡、返工汇总、开着的 PR 提示。"""
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()

    def test_pause_resume(self):
        cli("add", "推理引擎", "-", "调参", "龙娘")
        self.assertEqual(cli("pause", "1", "等显卡"), (0, "已暂停"))
        self.assertIn("｜暂停（", cli()[1])
        self.assertIn("等显卡", cli()[1])
        self.assertEqual(board.items()[0]["pause_why"], "等显卡")  # 原生团队板按它出「暂停」块（core/team_task_board.go）
        self.assertFalse((Path(TMP) / "board-done.jsonl").exists())  # 暂停不算做完
        self.assertEqual(cli("resume", "1"), (0, "已恢复"))
        self.assertEqual(cli("resume", "1"), (0, "#1 没在暂停"))
        self.assertNotIn("暂停", cli()[1])
        self.assertNotEqual(cli("pause", "9")[0], 0)
        self.assertNotEqual(cli("resume", "9")[0], 0)

    def test_pause_parks_only_bound_item(self):
        """ws-handoff 建的条目绑了工作区（ws）：pause 时 <桥> workspace park 一次、解绑；没绑的不动桥。"""
        log = Path(TMP) / "park.log"
        log.write_text("")
        fake = Path(TMP) / "fakepark"
        fake.write_text(f"#!/bin/sh\necho \"$@\" >> {log}\necho '{{\"freed\":true}}'\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.add("交来的活", "n.md", "已交接", "工作区1主角色", ws="feishu:oc_1", chat="feishu:oc_chat:u1")
            os.environ["CC_SESSION_KEY"] = "feishu:oc_1:u1"
            board.add("顺手的事", "-", "s", "工作区1主角色")
            os.environ.pop("CC_SESSION_KEY")
            self.assertEqual(board.items()[1]["sk"], "feishu:oc_1")  # 会话 key 去掉用户段
            board.main(["pause", "2"])
            self.assertEqual(log.read_text(), "")
            board.main(["pause", "1"])
            self.assertEqual(log.read_text().split(), ["workspace", "park", "--session-key", "feishu:oc_1",
                                                       "--chat", "feishu:oc_chat", "--before", board.items()[0]["bound"], "--json"])
            self.assertNotIn("ws", board.items()[0])
            board.main(["resume", "1"]); board.main(["pause", "1"])
            calls = log.read_text().splitlines()  # 恢复时向桥收回（claim）、重新绑上，再停再放一次
            self.assertEqual([c.split()[1] for c in calls], ["park", "claim", "park"])
        finally:
            os.environ["CC_BIN"] = "false"

    def test_park_names_chat_and_task(self):
        """审查 pr261-code.md 第 1 条：pause / 把「谁」改走时 park 带上交活的聊天频道和绑定时刻，桥只放这一件；
        工作区已归别的聊天频道（假桥按 --chat 判）时桥拒绝，什么都不放。没记聊天频道的绑定条目不动桥。"""
        log = Path(TMP) / "park1.log"
        log.write_text("")
        fake = Path(TMP) / "fakepark1"
        # 假桥：工作区 201 眼下归 discord:300（聊天频道 Y）；不带 --chat discord:300 的 park 一律当成放掉 Y 的活
        fake.write_text(f"""#!/bin/sh
[ "$2" = park ] || exit 1
echo "$@" >> {log}
case "$*" in
  *"--chat discord:300"*) echo '{{"freed":true}}' ;;
  *"--chat "*) echo "Error: team workspace park: discord:201 belongs to discord:300, not discord:100: workspace is not owned by any chat channel" >&2; exit 1 ;;
  *) echo "STOLE" >> {log}; echo '{{"freed":true}}' ;;
esac
""")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.add("X 交的 B", "b.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100:u1")
            board.add("X 交的 E", "e.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100")
            board.add("没记聊天频道", "c.md", "已交接", "工作区1主角色", ws="discord:201")
            bound = board.items()[0].get("bound")
            board.main(["pause", "1"])
            board.main(["update", "2", "s", "", "龙娘"])
            board.main(["pause", "3"])
            calls = log.read_text()
            self.assertNotIn("STOLE", calls)
            self.assertIn(f"workspace park --session-key discord:201 --chat discord:100 --before {bound} --json", calls)
            self.assertEqual(len(calls.splitlines()), 2)  # 1 和 2 各问一次（被拒），3 不问桥
        finally:
            os.environ["CC_BIN"] = "false"

    def test_paused_item_stays_on_chat_card(self):
        """审查 pr261-code.md 第 2 条：暂停或把「谁」改走后工作区放回池子，条目的卡片频道改回交活的聊天频道，
        原聊天频道的卡上还在、不跟着工作区到后来领走它的频道卡上；恢复收回后再回到工作区。"""
        fake = Path(TMP) / "fakepark2"
        fake.write_text("""#!/bin/sh
case "$2" in park) echo '{"freed":true}' ;; claim) echo ok ;; esac
""")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.add("交来的活", "a.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100:u1")
            board.add("另一块", "b.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100")
            self.assertEqual(board.items()[0]["ch"], "201")
            board.main(["pause", "1"])
            board.main(["update", "2", "s", "", "龙娘"])
            self.assertEqual([i["ch"] for i in board.items()], ["100", "100"])
            # 聊天频道 100 的卡（名下已没有工作区 201）列着它；后来领走 201 的频道（只认 201）的卡上没有
            self.assertEqual({i.get("chat") for i in board.items()}, {"discord:100"})  # 原生团队板按 chat 列在交活的聊天频道
            self.assertEqual([i for i in board.items() if i.get("ch") in {"201"}], [])
            board.main(["resume", "1"])
            self.assertEqual(board.items()[0]["ch"], "201")
        finally:
            os.environ["CC_BIN"] = "false"

    def test_resume_reoccupies_or_refuses(self):
        """暂停后工作区放回池子；恢复/把「谁」改回时先以交活的聊天频道向桥认领：归别的聊天频道就拒绝、板子不改，
        没被领走就收回、重新绑上（之后再停会再放回）。"""
        log, owned = Path(TMP) / "claim.log", Path(TMP) / "owned"
        log.write_text("")
        fake = Path(TMP) / "fakebridge"
        fake.write_text(f"""#!/bin/sh
echo "$@" >> {log}
case "$2" in
  park) echo '{{"freed":true}}' ;;
  list) echo '{{"parent":"discord:100","pool":[{{"id":"201","name":"工作区1"}},{{"id":"202","name":"工作区2"}}]}}' ;;
  claim) if [ -e {owned} ]; then echo "Error: team workspace claim: discord:100 → $3: workspace belongs to another chat channel (discord:300, until it finishes its last task)" >&2; exit 1; fi; echo ok ;;
esac
""")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.add("交来的活", "notes/a.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100:u1")
            self.assertEqual(board.items()[0]["chat"], "discord:100")
            board.main(["pause", "1"])
            it = board.items()[0]
            self.assertTrue(it.get("paused")); self.assertEqual(it["ws_was"], "discord:201"); self.assertNotIn("ws", it)
            # 被别的聊天频道领走：拒绝，非零退出，板子不改（还在暂停、还在板上、交接文件路径还在）
            owned.write_text("")
            with self.assertRaises(SystemExit) as e:
                board.main(["resume", "1"])
            self.assertIn("待接手", str(e.exception.code))
            it = board.items()[0]
            self.assertTrue(it.get("paused")); self.assertEqual(it["where"], "notes/a.md"); self.assertNotIn("ws", it)
            self.assertIn("workspace claim 201 --session-key discord:100", log.read_text())
            # 没被领走：收回、重新绑上；再停会再放回一次
            owned.unlink()
            board.main(["resume", "1"])
            it = board.items()[0]
            self.assertFalse(it.get("paused")); self.assertEqual(it["ws"], "discord:201"); self.assertNotIn("ws_was", it)
            log.write_text("")
            board.main(["pause", "1"])
            self.assertIn("workspace park --session-key discord:201", log.read_text())
            board.main(["resume", "1"])
            # 「谁」改走再改回工作区2：先认领工作区2，归别人就拒绝、「谁」不变
            board.main(["update", "1", "s", "", "龙娘"])
            owned.write_text("")
            with self.assertRaises(SystemExit):
                board.main(["update", "1", "s", "", "工作区2主角色"])
            self.assertEqual(board.items()[0]["who"], "龙娘")
            owned.unlink()
            log.write_text("")
            board.main(["update", "1", "s", "", "工作区2主角色"])
            self.assertIn("workspace claim 202 --session-key discord:100", log.read_text())
            self.assertEqual(board.items()[0]["ws"], "discord:202")
            # 待接手不是工作区：不问桥
            log.write_text("")
            board.main(["update", "1", "s", "", "待接手"])
            self.assertNotIn("claim", log.read_text())
            self.assertEqual(board.items()[0]["who"], "待接手")
        finally:
            os.environ["CC_BIN"] = "false"
            owned.unlink(missing_ok=True)

    def test_link(self):
        cli("add", "x", "-", "s", "橘")
        url = "https://discord.com/channels/1/2/3"
        self.assertNotEqual(cli("link", "1", "https://example.com/a")[0], 0)
        self.assertEqual(cli("link", "1", url), (0, "已挂卡"))
        self.assertEqual(board.items()[0]["card"], url)

    def test_rework_report(self):
        for k in range(4):
            cli("add", f"事{k}", "-", "s", "橘")
        cli("done", "1", "2", "没先读现有实现")
        cli("done", "2", "1", "没先读现有实现")
        cli("done", "3", "0")
        self.assertNotEqual(cli("done", "4")[0], 0)  # 返工次数必填
        board.done(4)  # 规矩之前结束的旧记录没填返工次数，汇总照样算「未填」
        out = cli("rework")[1].splitlines()
        self.assertEqual(out[0], "最近 14 天结束 4 件：返工 2 件，没返工 1 件，未填 1 件")
        self.assertTrue(out[1].startswith("没先读现有实现：3 次｜#1 事0（2）"), out[1])
        self.assertNotEqual(cli("done", "1", "-1")[0], 0)

    def test_deadline_crosses_midnight(self):
        ref = board.time.mktime((2026, 10, 24, 23, 50, 0, 0, 0, -1))
        self.assertEqual(board._deadline("00:10", ref), ref + 20 * 60)
        self.assertEqual(board._deadline("23:55", ref), ref + 5 * 60)
        self.assertIsNone(board._deadline("x", ref))

    def test_open_pr_hint_off_without_repo(self):
        self.assertIsNone(board.open_pr_hint())


if __name__ == "__main__":
    unittest.main()
