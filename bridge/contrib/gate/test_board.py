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
