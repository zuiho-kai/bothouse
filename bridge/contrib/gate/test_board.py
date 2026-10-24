"""任务板（board.py）和它进每轮上下文（ctxsvc.board_items）的最小测试：python3 -I test_board.py"""
import os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
TMP = tempfile.mkdtemp()
os.environ["BOARD_DIR"] = TMP
os.environ.pop("CC_SESSION_KEY", None)  # 没有频道就不发卡片：子进程 CLI 不碰真 Discord
os.environ.pop("DISCORD_BOT_TOKEN", None)
os.environ["CC_BIN"] = "false"  # 不问真桥的定时列表：timer list 失败 = 不知道，「下次看」照原样显示
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
        self.assertEqual(cli("done", "1")[0], 0)
        self.assertTrue(cli()[1].startswith("#2 "))
        self.assertEqual(cli("add", "a", "b", "c", "龙娘"), (0, "#3"))  # 结束过的编号不再用
        self.assertIn('"done_at"', (Path(TMP) / "board-done.jsonl").read_text())

    def test_bad_input(self):
        self.assertNotEqual(cli("done", "9")[0], 0)
        self.assertNotEqual(cli("done", "x")[0], 0)
        self.assertNotEqual(cli("add", "只有一项")[0], 0)
        self.assertEqual(cli(), (0, "（任务板是空的）"))

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


class Card(unittest.TestCase):
    """频道卡片：Discord 调用打桩。"""
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()
        self.calls, self.gone = [], set()
        def fake(method, path, body=None):
            self.calls.append((method, path, body))
            if method == "PATCH" and path.rsplit("/", 1)[1] in self.gone:
                raise board.urllib.error.HTTPError(path, 404, "gone", {}, None)
            return {"id": f"m{len(self.calls)}"} if method == "POST" else {}
        self.orig, board.api = board.api, fake
        os.environ["CC_SESSION_KEY"] = "discord:111"

    def tearDown(self):
        board.api = self.orig
        os.environ.pop("CC_SESSION_KEY", None)

    def test_post_pin_then_edit_same_message(self):
        os.environ["BOARD_LATER"] = "1"  # 装作 later 调的
        board.main(["add", "修桥", "PR #1", "写代码", "龙娘", "--next", "14:30"])
        os.environ.pop("BOARD_LATER")
        self.assertEqual([c[0] for c in self.calls], ["POST", "PUT"])
        self.assertEqual(self.calls[1][1], "/channels/111/pins/m1")
        body = self.calls[0][2]["content"]
        self.assertIn("#1 修桥｜龙娘｜写代码｜", body)
        self.assertIn("下次看 14:30", body)
        self.assertNotIn("PR #1", body)  # 卡片只列事情、谁、状态、时间、下次看
        self.assertEqual(self.calls[0][2]["allowed_mentions"], {"parse": []})
        self.calls.clear()
        board.main(["update", "1", "测试中"])
        self.assertEqual([c[:2] for c in self.calls], [("PATCH", "/channels/111/messages/m1")])
        self.assertIn("测试中", self.calls[0][2]["content"])
        self.assertIn("下次看 14:30", self.calls[0][2]["content"])  # 不给 --next 就保留原来的
        self.calls.clear()
        board.main(["done", "1"])
        self.assertIn("没有进行中的事", self.calls[0][2]["content"])

    def test_next_only_from_later(self):
        os.environ.pop("BOARD_LATER", None)
        for argv in (["add", "x", "-", "s", "橘", "--next", "14:30"], ["update", "1", "s", "--next", "14:30"]):
            with self.assertRaises(SystemExit) as e:
                board.main(argv)
            self.assertIn("later", str(e.exception.code))
        self.assertEqual(board.lines(), [])
        self.assertEqual(self.calls, [])

    def test_deleted_message_reposted(self):
        board.main(["add", "a", "b", "c", "橘"])
        self.gone.add("m1")
        self.calls.clear()
        board.main(["update", "1", "d"])
        self.assertEqual([c[0] for c in self.calls], ["PATCH", "POST", "PUT"])

    def test_channels_kept_apart_and_legacy_everywhere(self):
        board._write([{"id": 1, "what": "旧事", "where": "-", "status": "s", "who": "橘", "at": "10-22 10:00"}])
        board.main(["add", "频道一的事", "-", "s", "橘"])
        os.environ["CC_SESSION_KEY"] = "discord:222"
        self.calls.clear()
        board.main(["add", "频道二的事", "-", "s", "橘"])
        by = {c[1]: c[2]["content"] for c in self.calls if c[0] in ("POST", "PATCH")}
        two = next(v for k, v in by.items() if "/222/" in k)
        one = next(v for k, v in by.items() if "/111/" in k)
        self.assertIn("旧事", two); self.assertIn("旧事", one)
        self.assertIn("频道二的事", two); self.assertNotIn("频道二的事", one)

    def test_workspace_blocks_from_registry(self):
        fake = Path(TMP) / "fakews"
        reg = '{"parent":"discord:111","workspaces":[{"name":"工作区1","id":"333","owner":""}]}'
        fake.write_text("#!/bin/sh\n[ \"$1\" = workspace ] || exit 1\n"
                        "case \"$4\" in discord:111|discord:333) printf '%s' '" + reg + "';; *) exit 1;; esac\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.main(["add", "聊天频道的事", "-", "s", "橘"])
            os.environ["CC_SESSION_KEY"] = "discord:333"
            self.calls.clear()
            board.main(["add", "工作区的事", "-", "s", "工作区1橘"])
            by = {c[1]: c[2]["content"] for c in self.calls if c[0] in ("POST", "PATCH")}
            chat = next(v for k, v in by.items() if "/111/" in k)  # 工作区的条目变了，聊天频道的卡也改
            ws = next(v for k, v in by.items() if "/333/" in k)
            self.assertIn("**工作区1**", chat)
            self.assertLess(chat.index("聊天频道的事"), chat.index("**工作区1**"))
            self.assertLess(chat.index("**工作区1**"), chat.index("工作区的事"))
            self.assertIn("工作区的事", ws); self.assertNotIn("聊天频道的事", ws)
            self.calls.clear()
            board.main(["done", "2"])
            chat = next(c[2]["content"] for c in self.calls if "/111/" in c[1])
            self.assertIn("工作区1·工作区1橘：工作区的事", chat)
        finally:
            os.environ["CC_BIN"] = "false"
        self.assertIsNone(board._ws_reg("111"))  # 问不到桥：退回只按条目频道过滤

    def test_fits_discord_limit(self):
        for n in range(30):
            board.add(f"事{n}", "-", "很长" * 100, "橘")
        self.assertLessEqual(len(board.card_text(board.items())), board.LIMIT)
        self.assertIn("#30 事29", board.card_text(board.items()))

    def test_discord_failure_does_not_break_board(self):
        def boom(*a, **k):
            raise OSError("net down")
        board.api = boom
        board.main(["add", "x", "y", "z", "橘"])
        self.assertEqual(len(board.items()), 1)


class Increments(unittest.TestCase):
    """暂停/恢复、挂卡、返工汇总、今天做完、下次看「已过」、开着的 PR 提示。"""
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()

    def test_pause_resume(self):
        cli("add", "推理引擎", "-", "调参", "龙娘")
        self.assertEqual(cli("pause", "1", "等显卡"), (0, "已暂停"))
        self.assertIn("｜暂停（", cli()[1])
        self.assertIn("等显卡", cli()[1])
        text = board.card_text(board.items(), timers=None)
        self.assertIn("现在没有进行中的事", text)  # 暂停的不算在做
        self.assertIn("**暂停**", text)
        self.assertIn("暂停：等显卡", text)
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
            text = board.card_text([i for i in board.items() if i.get("ch") in {"100"}], [], None, None)
            self.assertIn("交来的活", text); self.assertIn("另一块", text)
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
        self.assertIn(f" [卡]({url})", board.card_text(board.items(), timers=None))

    def test_rework_report(self):
        for k in range(4):
            cli("add", f"事{k}", "-", "s", "橘")
        cli("done", "1", "2", "没先读现有实现")
        cli("done", "2", "1", "没先读现有实现")
        cli("done", "3", "0")
        cli("done", "4")
        out = cli("rework")[1].splitlines()
        self.assertEqual(out[0], "最近 14 天结束 4 件：返工 2 件，没返工 1 件，未填 1 件")
        self.assertTrue(out[1].startswith("没先读现有实现：3 次｜#1 事0（2）"), out[1])
        self.assertNotEqual(cli("done", "1", "-1")[0], 0)

    def test_today_done_block(self):
        for k in range(5):
            board.add(f"事{k}", "-", "s", "橘")
            board.done(k + 1)
        board.add("事0", "-", "s", "橘"); board.done(6)  # 同一件事第二趟
        text = board.card_text([], board._today_done(), timers=None)
        self.assertIn("**今天做完**", text)
        self.assertIn("- 橘：事0（2 趟）", text)
        self.assertIn("- …另 2 件", text)  # 5 件不同的事，只列最新 DONE_PER_BLOCK 件
        self.assertNotIn("事1\n", text)

    def test_done_never_crowds_out_live(self):
        done = [{"id": k, "what": f"做完的事{k}" * 5, "who": "橘"} for k in range(200)]
        its = [{"id": 1000 + k, "what": f"在做{k}", "status": "长" * 300, "who": "橘"} for k in range(20)]
        text = board.card_text(its, done, timers=None)
        self.assertLessEqual(len(text), board.LIMIT)
        self.assertIn("#1019 在做19", text)

    def test_deadline_crosses_midnight(self):
        ref = board.time.mktime((2026, 10, 24, 23, 50, 0, 0, 0, -1))
        self.assertEqual(board._deadline("00:10", ref), ref + 20 * 60)
        self.assertEqual(board._deadline("23:55", ref), ref + 5 * 60)
        self.assertIsNone(board._deadline("x", ref))

    def test_next_overdue(self):
        now = board.time.mktime((2026, 10, 24, 15, 0, 0, 0, 0, -1))
        it = {"id": 1, "what": "等 CI", "next": "14:30", "next_ts": now - 1800}
        self.assertIsNone(board._next_live(it, None, now))  # 问不到桥：不知道
        self.assertFalse(board._next_live(it, [], now))  # 到点了、定时也不在：已过
        self.assertTrue(board._next_live(it, [(now - 1790, "等 CI")], now))  # 定时还挂着（桥晚发）
        self.assertTrue(board._next_live({**it, "next_ts": now + 60}, [], now))  # 还没到点
        text = board.card_text([it], timers=[])
        self.assertIn("下次看 14:30（已过）", text)

    def test_timer_list_parse(self):
        fake = Path(TMP) / "fakecc"
        fake.write_text("#!/bin/sh\nprintf 'Pending timers:\\n  maomao abc123 2026-10-24T15:30:00+08:00 等 CI\\n'\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            ts = board._timers()
        finally:
            os.environ["CC_BIN"] = "false"
        self.assertEqual(len(ts), 1)
        self.assertEqual(ts[0][1], "等 CI")
        self.assertIsNone(board._timers())  # false：拿不到

    def test_open_pr_hint_off_without_repo(self):
        self.assertIsNone(board.open_pr_hint())


if __name__ == "__main__":
    unittest.main()
