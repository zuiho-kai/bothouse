"""任务板（board.py）和它进每轮上下文（ctxsvc.board_items）的最小测试：python3 -I test_board.py"""
import contextlib, io, json, os, subprocess, sys, tempfile, unittest
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
TMP = tempfile.mkdtemp()
os.environ["BOARD_DIR"] = TMP
os.environ.pop("CC_SESSION_KEY", None)
os.environ.pop("DISCORD_BOT_TOKEN", None)  # board 不读平台 token、不发卡片（#597 K9）
# #699 D：board done/pause/wait 先问桥改状态；测试里的「没有桥」只回 transition（known=false），别的命令都失败
NOBRIDGE = os.path.join(tempfile.mkdtemp(), "nobridge")
with open(NOBRIDGE, "w") as _f:
    _f.write('#!/bin/sh\n[ "$2" = transition ] && { echo \'{"known":false}\'; exit 0; }\nexit 1\n')
os.chmod(NOBRIDGE, 0o755)
os.environ["CC_BIN"] = NOBRIDGE  # 不问真桥
os.environ.pop("BOARD_PR_REPO", None)  # done 后不调 gh
import board  # noqa: E402
import ctxsvc  # noqa: E402


def cli(*args):
    if args[:1] == ("add",) and len(args) >= 5 and "--short" not in args:
        args = (*args, "--short", "测试")  # board add 要短名（10-30）
    p = subprocess.run([str(HERE.parent / "lead" / "board"), *args], capture_output=True, text=True,
                       env={**os.environ, "BOARD_DIR": TMP})
    return p.returncode, (p.stdout + p.stderr).strip()


class Board(unittest.TestCase):
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()

    def test_wait_external(self):
        # 外部卡住（agentm #26 GPU 全占，11-09）：记等外部、带到点时刻、撤兜底，不算交回待验收
        self.assertEqual(cli("add", "PR9977 验证", "~/n.md", "在做", "工作区1"), (0, "#1"))
        cur = board._read()
        cur[0]["guard"] = "t-guard"
        board._write(cur)
        import time
        before = int(time.time())
        rc, out = cli("wait", "1", "GPU 8 张全被占用", "120")
        self.assertEqual(rc, 0, out)
        self.assertIn("已记等外部", out)
        it = board._read()[0]
        self.assertTrue(it.get("paused"))
        self.assertTrue(it["pause_why"].startswith(board.WAIT_EXT))
        self.assertIn("GPU", it["pause_why"])
        self.assertGreaterEqual(it["wait_until"], before + 120 * 60)
        self.assertNotIn("guard", it)
        self.assertNotIn("returned_at", it)
        self.assertFalse(board._asking(it))
        self.assertNotEqual(cli("wait", "9", "x", "10")[0], 0)

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

    def test_hold_unhold_for_release(self):
        """为发布暂停（#134 ②）：不给编号只标在工作区、没交回、没暂停的；unhold --at 只撤那一次标记。"""
        self.assertEqual(cli("add", "在做的", "x", "进行中", "橘"), (0, "#1"))
        self.assertEqual(cli("add", "聊天里的", "y", "进行中", "橘"), (0, "#2"))
        rows = board._read()
        rows[0]["ws"] = "discord:ws1"
        board._write(rows)
        code, out = cli("hold", "--why", "集中发布")
        self.assertEqual((code, out), (0, "为发布暂停：#1"))
        mark = board._read()[0]["release_hold"]
        self.assertEqual(mark["why"], "集中发布")
        self.assertIn("为发布暂停", cli()[1].splitlines()[0])
        self.assertEqual(cli("hold", "1"), (0, "为发布暂停：没有符合的条目"))  # 已标过
        self.assertEqual(cli("unhold", "1", "--at", "2000-01-01T00:00:00+00:00"), (0, "去掉为发布暂停：没有符合的条目"))
        self.assertEqual(cli("unhold", "1", "--at", mark["at"]), (0, "去掉为发布暂停：#1"))
        self.assertNotIn("release_hold", board._read()[0])
        self.assertEqual(cli("hold", "2"), (0, "为发布暂停：#2"))  # 点名的照标
        self.assertEqual(cli("unhold"), (0, "去掉为发布暂停：#2"))

    def test_done_record_status_is_done(self):
        # #597 N3：结束的条目进 board-done.jsonl 时 status 要是「已完成」，不能带着原来的「进行中」
        board.add("写 hello.py", "-", "进行中", "橘")
        self.assertTrue(board.done(1, 0))
        rec = json.loads((Path(TMP) / "board-done.jsonl").read_text().splitlines()[-1])
        self.assertEqual(rec["status"], "已完成")
        self.assertIn("done_at", rec)

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
        os.environ["CC_SESSION_KEY"] = "discord:1"  # 条目按频道分（#611），这里造本频道的一条
        try:
            board.add("x", "y", "z", "橘")
        finally:
            os.environ.pop("CC_SESSION_KEY")
        one = ctxsvc.board_items("discord:1")
        self.assertNotEqual(empty[0]["path"], one[0]["path"])  # 板子变了 path 就变，cc-connect 会重推
        self.assertIn("#1 x｜y｜z｜橘", one[0]["desc"])
        self.assertEqual(one, ctxsvc.board_items("discord:1"))  # 不变就不重推
        self.assertIn("别处还有 1 件在做", ctxsvc.board_items("discord:2")[0]["desc"])  # 别的频道只计数（#611）
        self.assertIn(one[0], ctxsvc.context({"key": "discord:1", "text": "hi", "bot": "jingyu"})["wiki"])

    def test_context_counts_backlog_without_listing_it(self):
        """进每轮上下文：待办只报个数，不占行（主板只留在做和等人的事）。"""
        os.environ["CC_SESSION_KEY"] = "discord:1"
        try:
            board.add("在做的活", "y", "进行中", "橘")
            board.add("顺手的小事", "-", "待修", "橘")
            board.backlog(2)
        finally:
            os.environ.pop("CC_SESSION_KEY")
        desc = ctxsvc.board_items("discord:1")[0]["desc"]
        self.assertIn("#1 在做的活", desc)
        self.assertNotIn("顺手的小事", desc)
        self.assertIn("另有 1 件待办", desc)

    def test_not_a_team_status_file(self):  # cc-connect 把 team/*.json 当队友状态读，任务板不能叫 .json
        board.add("x", "y", "z", "橘")
        self.assertEqual(list(Path(TMP).glob("*.json")), [])


class AppendForward(unittest.TestCase):
    """「## 转交结果」节：插在节内最后一条后面，节不存在就新建；写失败时原文件不动。

    用户 2026-10-28「为什么又重新跑了一次，什么问题修一下」——转交结果落进后面的「## 检查点」，
    工作区读到的还是旧的「接着做」；返工要求再加一条：半途失败不能把交接文件写坏。
    """

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def write(self, text):
        p = self.dir / "handoff.prompt"
        p.write_text(text, encoding="utf-8")
        return p

    def read(self, p):
        return p.read_text(encoding="utf-8")

    def test_inserts_inside_forward_section(self):
        p = self.write("# 交接\n\n## 交给工作区\n做 A。\n\n## 转交结果\n- 早期一条\n\n## 检查点\n- 别动这里\n")
        board.append_forward(str(p), "11:20 新结果")
        self.assertEqual(
            self.read(p),
            "# 交接\n\n## 交给工作区\n做 A。\n\n## 转交结果\n- 早期一条\n- 11:20 新结果\n\n## 检查点\n- 别动这里\n",
        )

    def test_creates_section_when_missing(self):
        p = self.write("# 交接\n\n## 交给工作区\n做 A。\n")
        board.append_forward(str(p), "11:20 第一条")
        self.assertEqual(self.read(p), "# 交接\n\n## 交给工作区\n做 A。\n\n## 转交结果\n- 11:20 第一条\n")

    def test_section_at_eof_without_trailing_newline(self):
        p = self.write("# 交接\n\n## 转交结果\n- 早期一条")
        board.append_forward(str(p), "11:20 新结果")
        self.assertEqual(self.read(p), "# 交接\n\n## 转交结果\n- 早期一条\n- 11:20 新结果\n")

    def test_empty_file(self):
        p = self.write("")
        board.append_forward(str(p), "11:20 第一条")
        self.assertEqual(self.read(p), "## 转交结果\n- 11:20 第一条\n")

    def test_keeps_file_mode(self):
        p = self.write("# 交接\n")
        os.chmod(p, 0o640)
        board.append_forward(str(p), "11:20 新结果")
        self.assertEqual(os.stat(p).st_mode & 0o777, 0o640)

    def test_failure_leaves_file_byte_identical(self):
        # 半截代理对：utf-8 编不出来，旧实现已经 open(path,"w") 截断了文件。
        before = "# 交接\n\n## 交给工作区\n做 A。\n\n## 检查点\n- 后面这些不能丢\n"
        p = self.write(before)
        original = p.read_bytes()
        with self.assertRaises(ValueError):
            board.append_forward(str(p), "11:2\ud800 坏摘要")
        self.assertEqual(p.read_bytes(), original)

    def test_failure_writes_no_temp_file(self):
        p = self.write("# 交接\n")
        with self.assertRaises(ValueError):
            board.append_forward(str(p), "\udfff")
        self.assertEqual([f.name for f in self.dir.iterdir()], ["handoff.prompt"])

    def test_long_multiline_summary_stays_one_entry(self):
        p = self.write("# 交接\n\n## 转交结果\n- 旧\n\n## 检查点\n- 保留\n")
        board.append_forward(str(p), "11:20 第一行\n第二行\n第三行")
        got = self.read(p)
        self.assertIn("- 11:20 第一行\n第二行\n第三行\n\n## 检查点", got)


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

    def test_backlog_hides_from_list_and_resume_brings_it_back(self):
        """待办：默认列表和置顶团队板不列，board backlog 单独列（用户 2026-11-05「任务板怎么还有一堆任务」）。"""
        cli("add", "进程不回收", "-", "待修", "肥鱼", "--short", "进程")
        cli("add", "在做的活", "-", "进行中", "橘", "--short", "在做")
        self.assertEqual(cli("backlog", "1", "--why", "排在 bug 后"), (0, "已挪进待办：#1（board backlog 看，board resume <编号> 恢复）"))
        self.assertEqual([l.split()[0] for l in cli()[1].splitlines()], ["#2"])  # 默认列表只剩在做
        self.assertEqual(board.items()[0]["backlog_why"], "排在 bug 后")
        self.assertEqual(board.backlog_count(), 1)
        back = cli("backlog")[1].splitlines()
        self.assertEqual(len(back), 1)
        self.assertIn("｜待办（", back[0])  # 待办自己那行带标记
        self.assertIn("排在 bug 后", back[0])
        self.assertFalse((Path(TMP) / "board-done.jsonl").exists())  # 待办不算做完，也不删条目
        self.assertEqual(cli("resume", "1"), (0, "已恢复"))  # 恢复同暂停
        self.assertNotIn("待办", cli()[1])
        self.assertEqual(cli("backlog")[1], "（没有待办）")
        self.assertNotEqual(cli("backlog", "9")[0], 0)  # 没有这条

    def test_backlog_parks_workspace_and_resume_takes_it_back(self):
        """待办同样把工作区放回池子；board resume 像暂停一样先向桥收回再绑回（不然两个聊天频道抢一个工作区）。"""
        log = Path(TMP) / "park2.log"
        log.write_text("")
        fake = Path(TMP) / "fakepark3"
        fake.write_text(f"""#!/bin/sh
[ "$2" = transition ] && {{ echo '{{"known":false}}'; exit 0; }}
echo "$@" >> {log}
case "$2" in park) echo '{{"freed":true}}' ;; claim) echo ok ;; esac
""")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.add("交来的活", "a.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100:u1")
            bound = board.items()[0].get("bound")
            board.main(["backlog", "1"])
            self.assertEqual(log.read_text().strip(),
                             f"workspace park --session-key discord:201 --chat discord:100 --before {bound} --stop --json")
            row = board.items()[0]
            self.assertNotIn("ws", row)
            self.assertEqual(row["ws_was"], "discord:201")  # 恢复时向桥收回它
            with contextlib.redirect_stdout(io.StringIO()):
                board.main(["resume", "1"])
            self.assertEqual([c.split()[1] for c in log.read_text().splitlines()], ["park", "claim"])
            self.assertEqual(board.items()[0]["ws"], "discord:201")
        finally:
            os.environ["CC_BIN"] = NOBRIDGE

    def test_backlog_takes_over_pause_and_update_takes_it_back(self):
        """从暂停挪进待办要算待办不算暂停；改了状态（有人接手）就撤掉待办标记，回主板。"""
        cli("add", "QQ插话点表情", "-", "待修", "待接手")
        self.assertEqual(cli("pause", "1", "等排期"), (0, "已暂停"))
        cli("backlog", "1")
        row = board.items()[0]
        self.assertIn("backlog", row)
        self.assertNotIn("paused", row)  # 团队板的「暂停 N 件」不能再算它
        self.assertEqual(cli("update", "1", "已接手", "-", "肥鱼")[0], 0)
        row = board.items()[0]
        self.assertNotIn("backlog", row)
        self.assertEqual([l.split()[0] for l in cli()[1].splitlines()], ["#1"])

    def test_backlog_item_not_in_ws_task_or_exp_task(self):
        """工作区上下文按 ws 认「这件活在做什么」：挪进待办的不能再被认成在做的活。"""
        board.add("顺手的事", "-", "待修", "工作区1主角色", ws="discord:ws1", chat="discord:ch1")
        os.environ["CC_SESSION_KEY"] = "discord:ws1:u1"
        try:
            self.assertEqual(ctxsvc.ws_task("discord:ws1"), 1)
            board.backlog(1)
            self.assertIsNone(ctxsvc.ws_task("discord:ws1"))
            self.assertIsNone(ctxsvc.exp_task("discord:ch1"))
        finally:
            os.environ.pop("CC_SESSION_KEY")

    def test_pause_parks_only_bound_item(self):
        """ws-handoff 建的条目绑了工作区（ws）：pause 时 <桥> workspace park 一次、解绑；没绑的不动桥。"""
        log = Path(TMP) / "park.log"
        log.write_text("")
        fake = Path(TMP) / "fakepark"
        fake.write_text(f"#!/bin/sh\n[ \"$2\" = transition ] && {{ echo '{{\"known\":false}}'; exit 0; }}\necho \"$@\" >> {log}\necho '{{\"freed\":true}}'\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        board.set_prune_conf(on=False)  # 这里只看 park；暂停挂的自动收起定时见 test_board_prune.py
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
                                                       "--chat", "feishu:oc_chat", "--before", board.items()[0]["bound"],
                                                       "--stop", "--json"])  # 暂停 = 用户喊停，连同那一轮一起停（#571）
            self.assertNotIn("ws", board.items()[0])
            board.main(["resume", "1"]); board.main(["pause", "1"])
            calls = log.read_text().splitlines()  # 恢复时向桥收回（claim）、重新绑上，再停再放一次
            self.assertEqual([c.split()[1] for c in calls], ["park", "claim", "park"])
        finally:
            os.environ["CC_BIN"] = NOBRIDGE

    def test_self_pause_in_own_workspace_records_request(self):
        """agentm #26（11-09）：工作区在自己那一轮 board pause 自己的活：不暂停、不 park（park 会清会话、掐掉这一轮，
        暂停又会让桥扣下交回），只记 pause_req，叫它交 [report]；别处 pause 照旧停、照旧 park --stop。"""
        log = Path(TMP) / "selfpark.log"
        log.write_text("")
        fake = Path(TMP) / "fakeselfpark"
        fake.write_text(f"#!/bin/sh\n[ \"$2\" = transition ] && {{ echo '{{\"known\":false}}'; exit 0; }}\necho \"$@\" >> {log}\necho '{{\"freed\":true}}'\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        board.set_prune_conf(on=False)
        try:
            board.add("交来的活", "n.md", "已交接", "工作区1主角色", ws="discord:ws1", chat="discord:ch1")
            os.environ["CC_SESSION_KEY"] = "discord:ws1:u1"
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                board.main(["pause", "1", "十分钟上限"])
            self.assertIn("[report] #1", buf.getvalue())
            it = board.items()[0]
            self.assertEqual(it.get("pause_req"), "十分钟上限")
            self.assertFalse(it.get("paused"))
            self.assertEqual(it.get("ws"), "discord:ws1")
            self.assertEqual(log.read_text(), "")
            os.environ["CC_SESSION_KEY"] = "discord:ch1:u1"  # 聊天频道里 pause：照旧停、连那一轮一起停
            board.main(["pause", "1"])
            it = board.items()[0]
            self.assertTrue(it.get("paused"))
            self.assertNotIn("pause_req", it)
            self.assertIn("--stop", log.read_text().split())
        finally:
            os.environ.pop("CC_SESSION_KEY", None)
            os.environ["CC_BIN"] = NOBRIDGE

    def test_done_parks_bound_item(self):
        """用户 2026-11-04「交回/暂停/验收完当场放回」：没交回就直接 done 的条目还绑着工作区，
        当场 park 放回，不等每小时对账；已交回（解绑）或没绑工作区的不动桥。"""
        log = Path(TMP) / "parkdone.log"
        log.write_text("")
        fake = Path(TMP) / "fakeparkdone"
        fake.write_text(f"#!/bin/sh\n[ \"$2\" = transition ] && {{ echo '{{\"known\":false}}'; exit 0; }}\necho \"$@\" >> {log}\necho '{{\"freed\":true}}'\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        board.set_prune_conf(on=False)
        try:
            board.add("交来的活", "a.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100")
            board.add("另一件", "b.md", "已交接", "工作区2主角色", ws="discord:202", chat="discord:100")
            board.add("顺手的事", "-", "s", "主角色")
            bound = board.items()[0]["bound"]
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                board.main(["done", "1", "0"])
            self.assertIn("工作区已放回池子", out.getvalue())
            self.assertEqual(log.read_text().split(), ["workspace", "park", "--session-key", "discord:201",
                                                       "--chat", "discord:100", "--before", bound, "--stop", "--json"])
            log.write_text("")
            with contextlib.redirect_stdout(io.StringIO()):
                board.main(["done", "2", "0"])  # #699 D：收尾词不再结束，只有 done
            self.assertIn("--session-key discord:202", log.read_text())
            log.write_text("")
            with contextlib.redirect_stdout(io.StringIO()):
                board.main(["done", "3", "0"])
            self.assertEqual(log.read_text(), "")  # 没绑工作区：不问桥
        finally:
            os.environ["CC_BIN"] = NOBRIDGE

    def test_park_names_chat_and_task(self):
        """审查 pr261-code.md 第 1 条：pause / 把「谁」改走时 park 带上交活的聊天频道和绑定时刻，桥只放这一件；
        工作区已归别的聊天频道（假桥按 --chat 判）时桥拒绝，什么都不放。没记聊天频道的绑定条目不动桥。"""
        log = Path(TMP) / "park1.log"
        log.write_text("")
        fake = Path(TMP) / "fakepark1"
        # 假桥：工作区 201 眼下归 discord:300（聊天频道 Y）；不带 --chat discord:300 的 park 一律当成放掉 Y 的活
        fake.write_text(f"""#!/bin/sh
[ "$2" = transition ] && {{ echo '{{"known":false}}'; exit 0; }}
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
            board.main(["update", "2", "s", "", "待接手"])  # 待接手：离开工作区（#1111 后只改负责人不再解绑）
            board.main(["pause", "3"])
            calls = log.read_text()
            self.assertNotIn("STOLE", calls)
            self.assertIn(f"workspace park --session-key discord:201 --chat discord:100 --before {bound} --stop --json", calls)
            self.assertEqual(len(calls.splitlines()), 2)  # 1 和 2 各问一次（被拒），3 不问桥
        finally:
            os.environ["CC_BIN"] = NOBRIDGE

    def test_paused_item_stays_on_chat_card(self):
        """审查 pr261-code.md 第 2 条：暂停或把「谁」改走后工作区放回池子，条目的卡片频道改回交活的聊天频道，
        原聊天频道的卡上还在、不跟着工作区到后来领走它的频道卡上；恢复收回后再回到工作区。"""
        fake = Path(TMP) / "fakepark2"
        fake.write_text("""#!/bin/sh
[ "$2" = transition ] && { echo '{"known":false}'; exit 0; }
case "$2" in park) echo '{"freed":true}' ;; claim) echo ok ;; esac
""")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)
        try:
            board.add("交来的活", "a.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100:u1")
            board.add("另一块", "b.md", "已交接", "工作区1主角色", ws="discord:201", chat="discord:100")
            self.assertEqual(board.items()[0]["ch"], "201")
            board.main(["pause", "1"])
            board.main(["update", "2", "s", "", "待接手"])  # 待接手：离开工作区（#1111 后只改负责人不再解绑）
            self.assertEqual([i["ch"] for i in board.items()], ["100", "100"])
            # 聊天频道 100 的卡（名下已没有工作区 201）列着它；后来领走 201 的频道（只认 201）的卡上没有
            self.assertEqual({i.get("chat") for i in board.items()}, {"discord:100"})  # 原生团队板按 chat 列在交活的聊天频道
            self.assertEqual([i for i in board.items() if i.get("ch") in {"201"}], [])
            board.main(["resume", "1"])
            self.assertEqual(board.items()[0]["ch"], "201")
        finally:
            os.environ["CC_BIN"] = NOBRIDGE

    def test_resume_reoccupies_or_refuses(self):
        """暂停后工作区放回池子；恢复/把「谁」改回时先以交活的聊天频道向桥认领：归别的聊天频道就拒绝、板子不改，
        没被领走就收回、重新绑上（之后再停会再放回）。"""
        log, owned = Path(TMP) / "claim.log", Path(TMP) / "owned"
        log.write_text("")
        fake = Path(TMP) / "fakebridge"
        fake.write_text(f"""#!/bin/sh
[ "$2" = transition ] && {{ echo '{{"known":false}}'; exit 0; }}
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
            self.assertIn("workspace claim 201 --session-key discord:100 --board 1", log.read_text())
            # 没被领走：收回、重新绑上；再停会再放回一次
            owned.unlink()
            board.main(["resume", "1"])
            it = board.items()[0]
            self.assertFalse(it.get("paused")); self.assertEqual(it["ws"], "discord:201"); self.assertNotIn("ws_was", it)
            log.write_text("")
            board.main(["pause", "1"])
            self.assertIn("workspace park --session-key discord:201", log.read_text())
            board.main(["resume", "1"])
            # 只改负责人（不点名别的工作区）：还绑着工作区1，不问桥（#1111）
            log.write_text("")
            board.main(["update", "1", "s", "", "龙娘"])
            self.assertEqual(board.items()[0]["ws"], "discord:201")
            self.assertNotIn("park", log.read_text())
            # 改派到工作区2：先认领工作区2，归别人就拒绝、「谁」不变
            owned.write_text("")
            with self.assertRaises(SystemExit):
                board.main(["update", "1", "s", "", "工作区2主角色"])
            self.assertEqual(board.items()[0]["who"], "龙娘")
            owned.unlink()
            log.write_text("")
            board.main(["update", "1", "s", "", "工作区2主角色"])
            self.assertIn("workspace claim 202 --session-key discord:100 --board 1", log.read_text())
            self.assertEqual(board.items()[0]["ws"], "discord:202")
            # 待接手不是工作区：不问桥
            log.write_text("")
            board.main(["update", "1", "s", "", "待接手"])
            self.assertNotIn("claim", log.read_text())
            self.assertEqual(board.items()[0]["who"], "待接手")
        finally:
            os.environ["CC_BIN"] = NOBRIDGE
            owned.unlink(missing_ok=True)

    def test_who_change_keeps_ws(self):
        """Issue #1111（用户 2026-11-05 选①）：改负责人不拆工作区绑定，主桥每小时收口（core reconcileTeamWorkspaces
        只认 ws 指向工作区、没暂停没结束的条目）不再把在跑的工作区当成空的收回。只有改派到另一个工作区或待接手才解绑。"""
        log = Path(TMP) / "keep.log"
        log.write_text("")
        fake = Path(TMP) / "fakekeep"
        fake.write_text(f"""#!/bin/sh
[ "$2" = transition ] && {{ echo '{{"known":false}}'; exit 0; }}
echo "$@" >> {log}
case "$2" in
  park) echo '{{"freed":true}}' ;;
  list) echo '{{"parent":"discord:100","pool":[{{"id":"201","name":"工作区1"}},{{"id":"202","name":"工作区2"}}]}}' ;;
  claim) echo ok ;;
esac
""")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)

        def live_ws():  # 和 core reconcileTeamWorkspaces 同一判据：ws 非空、没暂停、没结束
            return {i["ws"] for i in board.items() if i.get("ws") and not i.get("paused") and not i.get("done_at")}
        try:
            board.add("修 QQ 重复回复", "notes/a.md", "已交接", "工作区1肥鱼", ws="discord:201", chat="discord:100")
            with contextlib.redirect_stdout(io.StringIO()):
                # 15:0x 的写法：「谁」从「工作区N肥鱼」改成「肥鱼 <频道id>」
                board.main(["update", "1", "在修", "", "肥鱼 1560000000000000201"])
                self.assertEqual(live_ws(), {"discord:201"})
                self.assertNotIn("ws_was", board.items()[0])
                # 同一工作区换个写法（名字指回眼下这个工作区）：不收回、不解绑、不问 claim/park
                board.main(["update", "1", "在修", "", "工作区1肥鱼"])
                self.assertEqual(live_ws(), {"discord:201"})
                self.assertNotIn("claim", log.read_text())
                self.assertNotIn("park", log.read_text())
                # 明确改派到工作区2：解绑工作区1、绑工作区2
                board.main(["update", "1", "改派", "", "工作区2肥鱼"])
                self.assertEqual(live_ws(), {"discord:202"})
                self.assertIn("workspace park --session-key discord:201", log.read_text())
                # 待接手：离开工作区
                board.main(["update", "1", "等人接", "", "待接手"])
                self.assertEqual(live_ws(), set())
        finally:
            os.environ["CC_BIN"] = NOBRIDGE

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


class BoardEvents(unittest.TestCase):
    """任务板事件流（Issue #876）：每次真实变化追加一行，页面按 kind 飞光。"""

    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()
        os.environ["CC_PROJECT"] = "lead"
        os.environ["CC_BIN"] = NOBRIDGE
        board.set_prune_conf(on=False)

    def tearDown(self):
        os.environ.pop("CC_PROJECT", None)

    def events(self):
        p = Path(TMP) / board.EVENTS
        return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []

    def test_add_update_pause_done_kinds(self):
        board.add("修登录页", "a.md", "进行中", "肥鱼（复审）", short_name="登录")
        board.update(1, "改派", who="G哥")
        board.update(1, "已交回：报告到了")
        board.update(1, "打回：少证据")
        board.pause(1, "等显卡")
        board.resume(1)
        board.done(1, 0)
        evs = self.events()
        self.assertEqual([e["kind"] for e in evs],
                         ["created", "assigned", "returned", "rejected", "paused", "done"])
        self.assertEqual((evs[0]["id"], evs[0]["from"], evs[0]["to"], evs[0]["title"]),
                         ("1", "lead", "肥鱼", "登录"))
        self.assertEqual(evs[1]["to"], "G哥")
        self.assertEqual(evs[3]["note"], "打回：少证据")
        self.assertEqual(evs[4]["note"], "等显卡")
        self.assertIsNotNone(datetime.fromisoformat(evs[0]["ts"]).tzinfo)

    def test_workspace_prefix_without_number(self):
        board.add("无数字工作区", "-", "进行中", "工作区gge", short_name="无数字")
        board.add("带数字工作区", "-", "进行中", "工作区1gge", short_name="带数字")
        self.assertEqual([e["to"] for e in self.events()], ["gge", "gge"])

    def test_returned_and_reject_entry_points(self):
        board.add("被验收的活", "-", "进行中", "肥鱼", short_name="验收")
        self.assertTrue(board.returned(1, "C酱"))
        self.assertTrue(board.reject(1, "缺复现证据"))
        evs = self.events()
        self.assertEqual([e["kind"] for e in evs], ["created", "returned", "rejected"])
        self.assertEqual(evs[-1]["note"], "缺复现证据")

    def test_ws_handoff_dispatch_is_assigned_not_returned(self):
        # ws-handoff 派活写的是「已交接」+「工作区N主角色」（bridge/contrib/lead/ws-handoff:488）：
        # 这是光飞出去；不能因为状态含「已交」就记成 returned，否则接活的人永远不亮
        board.add("派出去的活", "-", "进行中", "待接手", short_name="派活")
        board.update(1, "已交接", who="工作区1gge")
        evs = self.events()
        self.assertEqual([e["kind"] for e in evs], ["created", "assigned"])
        self.assertEqual(evs[-1]["to"], "gge")

    def test_append_only_and_write_failure_isolated(self):
        board.add("A", "-", "进行中", "肥鱼", short_name="A")
        before = (Path(TMP) / board.EVENTS).read_text()
        old = board.EVENTS
        board.EVENTS = "no-such-dir/board-events.jsonl"
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                board.add("B", "-", "进行中", "G哥", short_name="B")
        finally:
            board.EVENTS = old
        self.assertEqual(len(board.items()), 2)  # 事件写不进去，板子照样加
        self.assertIn("事件没写进", err.getvalue())
        self.assertTrue((Path(TMP) / board.EVENTS).read_text().startswith(before))  # 只追加，旧行不动


class WriteAtomic(unittest.TestCase):
    """#257：落盘临时名唯一 + os.replace 对 Windows 瞬时错误有界重试。"""

    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()

    def test_write_retries_transient_replace_error(self):
        """#257：Windows 上目标文件被短暂占用时 os.replace 抛 WinError 5，落盘要重试而不是偶发失败。
        交接给的确定性用例：monkeypatch os.replace 让前两次对 board.jsonl 抛 PermissionError(5)、第三次成功。"""
        board.add("A", "-", "进行中", "肥鱼", short_name="A")
        target = Path(TMP) / "board.jsonl"
        real = os.replace
        calls = []

        def flaky(src, dst):
            if str(dst) == str(target):
                calls.append(1)
                if len(calls) <= 2:
                    e = PermissionError(13, "Access is denied")
                    e.winerror = 5  # 照 Windows 的 WinError 5（交接里的失败栈 os.replace -> [WinError 5]）
                    raise e
            return real(src, dst)

        board.os.replace = flaky
        try:
            board.add("B", "-", "进行中", "G哥", short_name="B")
        finally:
            board.os.replace = real
        self.assertEqual(len(calls), 3, "前两次失败后应重试到第三次成功")
        self.assertEqual([r["short"] for r in board._read()], ["A", "B"])  # 内容正确
        self.assertEqual([p.name for p in Path(TMP).glob("board.jsonl.*.tmp")], [])  # 临时文件清掉

    def test_write_uses_unique_temp_names(self):
        """#257 第 1 条：每次落盘用自己的临时名，不再所有进程共抢 board.jsonl.tmp（互相覆盖/删掉
        对方正要 rename 的文件）。这里抓 os.replace 的源文件名，两次写必须不同且都不是老名字。"""
        board.add("A", "-", "进行中", "肥鱼", short_name="A")
        target = Path(TMP) / "board.jsonl"
        real = os.replace
        srcs = []

        def capture(src, dst):
            if str(dst) == str(target):
                srcs.append(Path(src).name)
            return real(src, dst)

        board.os.replace = capture
        try:
            board.add("B", "-", "进行中", "G哥", short_name="B")
            board.update(1, "已交接", who="工作区1")
        finally:
            board.os.replace = real
        self.assertEqual(len(srcs), 2)
        self.assertNotEqual(srcs[0], srcs[1], "两次写的临时文件名不能相同")
        self.assertNotIn("board.jsonl.tmp", srcs, "不再用固定的 .tmp 名")
        self.assertTrue(all(x.startswith("board.jsonl.") and x.endswith(".tmp") for x in srcs), srcs)

    def test_write_does_not_retry_other_errors(self):
        """只有 Windows 上那两类可重试错误才重试；别的异常照常抛，不能拖 2 秒。"""
        board.add("A", "-", "进行中", "肥鱼", short_name="A")
        target = Path(TMP) / "board.jsonl"
        real = os.replace
        calls = []

        def broken(src, dst):
            if str(dst) == str(target):
                calls.append(1)
                raise OSError(95, "Operation not supported")  # 无 winerror 的普通 OSError
            return real(src, dst)

        board.os.replace = broken
        try:
            with self.assertRaises(OSError):
                board.add("B", "-", "进行中", "G哥", short_name="B")
        finally:
            board.os.replace = real
        self.assertEqual(len(calls), 1, "非瞬时错误不重试")
        self.assertEqual([p.name for p in Path(TMP).glob("board.jsonl.*.tmp")], [])  # 失败也要清临时文件
        self.assertEqual([r["short"] for r in board._read()], ["A"])  # 原文件一个字节没变

    def test_write_raises_after_budget_and_cleans_temp(self):
        """重试有界：一直 PermissionError 时最终抛出，且不留临时文件、原文件不变。"""
        board.add("A", "-", "进行中", "肥鱼", short_name="A")
        target = Path(TMP) / "board.jsonl"
        real = os.replace
        calls = []

        def always(src, dst):
            if str(dst) == str(target):
                calls.append(1)
                e = PermissionError(13, "Access is denied")
                e.winerror = 32  # WinError 32：文件被占用
                raise e
            return real(src, dst)

        board.os.replace = always
        try:
            with self.assertRaises(PermissionError):
                board.add("B", "-", "进行中", "G哥", short_name="B")
        finally:
            board.os.replace = real
        self.assertGreater(len(calls), 1, "应当重试多次才放弃")
        self.assertEqual([p.name for p in Path(TMP).glob("board.jsonl.*.tmp")], [])
        self.assertEqual([r["short"] for r in board._read()], ["A"])


if __name__ == "__main__":
    unittest.main()
