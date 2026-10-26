"""暂停条目自动收起（board.auto_prune）回放 + 单测：python3 -I test_board_prune.py
回放样本：2026-10-26 10:53 橘在本机任务板手动清掉的 8 条（还原成暂停态）和当时板上 6 条不该收的，
原样取自本机 ~/im-bridge/team/board-done.jsonl / board.jsonl（字段裁到判据用得上的）；#597 是 #557 #574 并入的主线条目。"""
import json, os, shutil, subprocess, sys, tempfile, time, unittest
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
TMP = tempfile.mkdtemp()
FAKEBIN = Path(TMP) / "fakebin"
FAKEBIN.mkdir()
GH_LOG = Path(TMP) / "gh.log"
# 假 gh：记一次调用，输出 FAKE_GH_OUT（没设就失败 = gh 查不到）
(FAKEBIN / "gh").write_text(f'#!/bin/sh\necho call >> "{GH_LOG}"\n[ -n "$FAKE_GH_OUT" ] || exit 1\nprintf %s "$FAKE_GH_OUT"\n')
(FAKEBIN / "gh").chmod(0o755)
import board  # noqa: E402

# 环境和 board.DIR 在模块开始/结束时设/还原：pytest 同进程跑多个测试文件时，board 可能已被别的文件按它的
# BOARD_DIR 导入过（DIR 是导入时定的），不改这里会和子进程读的 BOARD_DIR 对不上
_SAVED = {}


def setUpModule():
    _SAVED["env"] = dict(os.environ)
    _SAVED["dir"] = board.DIR
    os.environ["BOARD_DIR"] = TMP
    for k in ("CC_SESSION_KEY", "BOARD_AUTO_PRUNE", "BOARD_PRUNE_IDLE_HOURS", "FAKE_GH_OUT"):
        os.environ.pop(k, None)
    os.environ["BOARD_PR_REPO"] = "zuiho-kai/bothouse"
    os.environ["CC_BIN"] = "false"
    os.environ["PATH"] = f"{FAKEBIN}:{os.environ['PATH']}"
    board.DIR = Path(TMP)


def tearDownModule():
    os.environ.clear()
    os.environ.update(_SAVED["env"])
    board.DIR = _SAVED["dir"]

SAMPLES = [341, 462, 467, 557, 574, 575, 583, 584]
# 闲置起点不早于暂停时刻（PR #457 审查第 1 条）后，#583 #584 是 10-26 10:31 才暂停的（手动清时只暂停了 22 分钟），
# 8 小时档也不再按③收；它们当时被清靠的是暂停前很久没汇报，那正是审查指出的误收。照实不收，不为凑样本放宽。
PAUSED_JUST_NOW = {583, 584}
KEEP = [589, 591, 600, 602, 607, 609]
NOW = datetime(2026, 10, 26, 10, 53).timestamp()  # 手动清的时刻（本机时区）
# PR259 / PR297 的真实合并时刻（gh pr view --json mergedAt）
GH_DATA = {"data": {"repository": {
    "pr259": {"number": 259, "state": "MERGED", "mergedAt": "2026-10-24T16:27:08Z", "closedAt": "2026-10-24T16:27:08Z"},
    "pr297": {"number": 297, "state": "MERGED", "mergedAt": "2026-10-25T06:53:08Z", "closedAt": "2026-10-25T06:53:08Z"}}}}
BOARD = [
    {"id": 341, "what": "bothouse 积压 29 个 PR 清理", "where": "notes/pr-backlog-1024.md", "status": "要接着做：PR16/19/161 仍开+一批10-24旧draft；彩虹猫出合/关/留清单后批量处理", "who": "彩虹猫", "at": "10-25 20:42", "paused": "10-25 20:42", "pause_why": "今晚收尾：不开新活，明天再接"},
    {"id": 462, "what": "H3 搜索第2轮：龙娘出候选→ABBA", "where": "~/im-bridge/longniang/wt/harness-h3-first-candidate-1024", "status": "按一条主线规则暂停；要做先改名「FastH3 接入」重新交活", "who": "工作区8橘", "at": "10-25 20:11", "paused": "10-25 13:35", "pause_why": "工作区8 撤掉，收敛到1~6"},
    {"id": 467, "what": "第6轮块D 网页端点名唤起主角色", "where": "zuiho-kai/bothouse#259", "status": "PR259已合develop，待F重启后网页端实测", "who": "工作区12橘", "at": "10-25 13:27", "paused": "10-25 13:27", "pause_why": "等用户/外部，收敛工作区 10-25"},
    {"id": 557, "what": "DSH：@角色的对话窗口被归档后再说话报错", "where": "/Users/zuiho/im-bridge/claude/notes/dsh-archive-session-error-1025.md", "status": "#290已合；#296等CI→合→发v0.1.17；之后装包按清单①–⑤验", "who": "工作区6橘", "at": "10-26 10:31", "paused": "10-26 10:31", "pause_why": "修复已合并并随新版发布；装包验收并入主线#597 的干净机器验收", "progress_at": 1792910405.695551},
    {"id": 574, "what": "今天的流程改进做进 bothouse 产品：先出对照表和切块", "where": "/Users/zuiho/im-bridge/claude/notes/productize-workflow-1025.md", "status": "恢复，并入#587线：B5/B6 由工作区3派", "who": "工作区3橘", "at": "10-26 10:31", "paused": "10-26 10:31", "pause_why": "已并入主线#597，由工作区5接着做"},
    {"id": 575, "what": "私聊本地规则打断修复 PR297 审+合；桌面端升级任务栏计数待彩虹猫确认", "where": "zuiho-kai/bothouse#297", "status": "PR297 15:53 已合；左栏计数确认未收", "who": "工作区4橘", "at": "10-26 10:31", "paused": "10-26 10:31", "pause_why": "PR297 已合；只剩左栏计数确认，主线外暂停"},
    {"id": 583, "what": "流程提速第二轮：量化今天时间去哪、删步骤不加规则", "where": "/Users/zuiho/im-bridge/claude/notes/process-speed-r2-1025.md", "status": "用户19:25都做：块1 hooks 龙娘、块2 board 主线闸门子agent、块3 CLAUDE.md 橘", "who": "工作区2橘", "at": "10-26 10:31", "paused": "10-26 10:31", "pause_why": "主线外，暂停", "progress_at": 1792925664.77865},
    {"id": 584, "what": "调研 z家服务器为什么和我们差异那么大，归类出可派修复块", "where": "/Users/zuiho/im-bridge/claude/notes/zserver-diff-1025.md", "status": "今晚合 7 个 PR（#347 #352 #355-#359）；停点：明天发 v0.1.22→发布包验→改说明发 z家", "who": "工作区2橘", "at": "10-26 10:31", "paused": "10-26 10:31", "pause_why": "z家已升级；等 C酱回三项人工验证", "progress_at": 1792949603.410014},
    {"id": 589, "what": "#378 主线：新手向导分流，照交接从 WIP 分支 ws7/wizard-gate-default-1024 接着做", "where": "/Users/zuiho/im-bridge/claude/notes/p1-wizard-gate-handoff.md", "status": "停在干净点：PR341已合+隔离浏览器验过；明天：真实Discord(等测试bot)→飞书/Lark专测→小问题→发版验，见交接末节", "who": "工作区5橘", "at": "10-25 21:30", "paused": "10-25 21:30", "pause_why": "今晚停在干净点：PR341已合+隔离浏览器验过；明天按交接末节接着做（真实Discord等测试bot）", "progress_at": 1792929843.818354},
    {"id": 591, "what": "用户点名：B站新抓人宣传片出英文版发X（做法照 v9 英文主片：英文配音+字幕，动画界面中文字换英文，真实聊天截图保留）", "where": "无（新建）；参考 notes/role-household-oss-promo.md 英文主片流程", "status": "待定片源：B2/A1/两条都做，等鱼片确认后派工作区", "who": "鲸鱼娘", "at": "10-26 10:31", "paused": "10-26 10:31", "pause_why": "片源未定，排在主线后"},
    {"id": 600, "what": "宣传稿返工（用户点名）：真实高热对标→鲸鱼娘写三版→没写的人对照审", "where": "notes/benchmark-real-1026.md", "status": "干净上下文复核完（必须改5条全改完）；三版字数 316/272/233，只用真截图；排序A>C>B；还缺3张真截图", "who": "鲸鱼娘", "at": "10-26 10:32", "paused": "10-26 10:32", "pause_why": "等用户[看片] 三版稿+三张真截图已交，Word 稿 /tmp/L站帖-数字版.docx"},
    {"id": 602, "what": "用户点名：加成员命名与人设默认，按交接四点改三个入口，代码派龙娘，开PR到develop，审一轮后合并并截图验收", "where": "/Users/zuiho/im-bridge/claude/notes/member-naming-1026.md", "status": "PR367 审查不通过，3条必修派龙娘；Discord默认名问用户", "who": "工作区1橘", "at": "10-26 02:39", "paused": "10-26 02:38", "pause_why": "等待用户答复：#602 有一处要你定：Discord 这类自带 bot 的平台，新加角色的默认名用什么？现在的分支会填「Codex」，但 Discord 聊天里显示的还是 b", "progress_at": 1792949962.5604239},
    {"id": 607, "what": "用户点名（有空搞）：角色给用户打 QQ 语音/视频电话，参考 B站 BV1hdHN6dETa 和 github chauko0423/ohwhale-deploy，先评估能否接角色小家语音链路", "where": "无（新建）；素材 /Volumes/personal_folder/wiki-media/bili-BV1hdHN6dETa", "status": "未开工，排在现有主线后", "who": "待排", "at": "10-26 03:37", "paused": "10-26 03:37", "pause_why": "用户说有空再搞，排在现有主线后"},
    {"id": 609, "what": "用户点名#608续：task assign/relay 派的活桥内也看门（G6），d10 也要让位，免得催两次", "where": "~/im-bridge/bin/d10", "status": "用户 10:4x 点头「改」：人设那句已改（橘改，备份 .bak-20261026-d10）；剩两种派法各派一件真活验只催一次", "who": "工作区3橘", "at": "10-26 10:41", "paused": "10-26 06:05", "pause_why": "等工作区5 修桥：relay 看门回合结束即停（审稿必改），修好再上 d10 让位"},
    {"id": 597, "what": "#574 主线（用户点名）：本机能力进产品——先出全量缺口清单和切块，验收=干净机器只装发布包派真活即有板/卡/工作区/看门/记忆", "where": "/Users/zuiho/im-bridge/claude/notes/productize-workflow-1025.md", "status": "停点：K1 K2a K4 已合，K3 CI 绿即合，K5a 待修两处；明天按 notes 停点节开首批", "who": "工作区5橘", "at": "10-26 10:32", "progress_at": 1792964265.317278},
]


def picks(**kw):
    return {i["id"]: w for i, w in board.prune_candidates(now=NOW, **kw)}


class Replay(unittest.TestCase):
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()
        board._write(BOARD)
        os.environ["FAKE_GH_OUT"] = json.dumps(GH_DATA)
        os.environ.pop("BOARD_PRUNE_IDLE_HOURS", None)
        GH_LOG.unlink(missing_ok=True)

    def show(self, title, got):
        print(f"\n回放 {title}（10-26 10:53）：")
        for n in SAMPLES + KEEP:
            print(f"  #{n} {'收' if n in got else '留'}：{got.get(n, '-')}")
        print(f"  其余被选中：{sorted(set(got) - set(SAMPLES))}")

    def test_replay_default_24h(self):
        got = picks()
        self.show("默认 24 小时", got)
        self.assertEqual(set(got), {467, 557, 574, 575})
        self.assertIn("#259已合", got[467])  # 写了「等用户/外部」，但 PR 已合照收
        self.assertEqual(got[557], "已并入 #597")

    def test_replay_8h(self):
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "8"
        got = picks()
        self.show("8 小时", got)
        self.assertEqual(set(got), set(SAMPLES) - PAUSED_JUST_NOW)  # 收 6 条；6 条保护项（含闲 13 小时的主线 #589）不收

    def test_prune_and_resume_back(self):
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "8"
        out = board.auto_prune(now=NOW)
        ids = {i["id"] for i, _ in out}
        self.assertEqual(ids, set(SAMPLES) - PAUSED_JUST_NOW)
        self.assertFalse(ids & {i["id"] for i in board._read()})
        recs = [r for r in board._read("board-done.jsonl") if r["id"] in ids]
        self.assertEqual(len(recs), 6)
        self.assertTrue(all(r["auto_pruned"] and r["paused"] and r["done_at"] for r in recs))
        self.assertIn("最近 14 天结束 0 件", board.rework_report())  # 自动收起不进返工统计
        board.done(591, 0)  # 手动 done 的不能用 resume 找回
        self.assertIsNone(board.unprune(591))
        # resume：从完成记录拿回板上再恢复；原来的状态、在哪原样
        board.main(["resume", "467"])
        it = next(i for i in board._read() if i["id"] == 467)
        self.assertNotIn("paused", it)
        self.assertEqual(it["where"], "zuiho-kai/bothouse#259")
        self.assertNotIn(467, {r["id"] for r in board._read("board-done.jsonl")})
        self.assertIsNone(board.unprune(99999))

    def test_gh_cached(self):
        picks()
        picks()
        self.assertEqual(GH_LOG.read_text().count("call"), 1)  # 终态缓存，不再问 gh

    def test_gh_down_skips_pr_rule(self):
        os.environ.pop("FAKE_GH_OUT")
        got = picks()
        self.assertNotIn(467, got)  # 查不到 PR：不按①收；等用户又免③
        self.assertNotIn(575, got)  # 闲 23 分钟，③也不到

    def test_pr_merged_under_2h_kept(self):
        recent = json.loads(json.dumps(GH_DATA))
        recent["data"]["repository"]["pr297"]["mergedAt"] = "2026-10-26T01:30:00Z"  # 本机 10-26 09:30（+08:00）前后，不满 2 小时
        os.environ["FAKE_GH_OUT"] = json.dumps(recent)
        prs = board.pr_final({297}, NOW)
        prs[297]["closed_at"] = NOW - 3600
        self.assertNotIn(575, picks(prs=prs))

    def test_where_only(self):
        its = board._read()
        i589 = next(i for i in its if i["id"] == 589)
        self.assertEqual(board._where_prs(i589), set())  # 状态里的「PR341已合」不算
        self.assertEqual(board._where_prs({"where": "github.com/zuiho-kai/bothouse/pull/12 和 PR#13"}), {12, 13})
        self.assertEqual(board._where_prs({"where": "#14"}), set())  # 裸 #N 是任务板编号

    def test_wait_user_and_ask(self):
        its = board._read()
        i600 = next(i for i in its if i["id"] == 600)  # 等用户[看片]：闲多久都不按③收
        self.assertIsNone(board.prune_why(i600, its, NOW + 30 * 86400, {}, idle_after=3600))
        i602 = next(i for i in its if i["id"] == 602)  # 提问等答复：一律不收，并入也不收
        self.assertIsNone(board.prune_why({**i602, "status": "并入 #597"}, its, NOW + 30 * 86400, {}, idle_after=3600))
        self.assertTrue(board._waiting_user({"pause_why": "等待用户确认"}))
        self.assertFalse(board._waiting_user({"pause_why": "等显卡"}))

    def test_switch_off(self):
        os.environ["BOARD_AUTO_PRUNE"] = "0"
        try:
            self.assertEqual(board.auto_prune(now=NOW), [])
            self.assertEqual(len(board._read()), len(BOARD))
        finally:
            os.environ.pop("BOARD_AUTO_PRUNE")

    def test_just_paused_with_old_progress_kept(self):
        """暂停前很久没汇报（progress_at 旧）、刚暂停的不收：闲置从暂停时刻算（审查第 1 条）。"""
        old = NOW - 3 * 86400
        it = {"id": 1, "what": "x", "where": "-", "status": "s", "who": "工作区1橘", "at": "10-26 10:50",
              "paused": "10-26 10:50", "pause_why": "等 CI", "progress_at": old}
        self.assertIsNone(board.prune_why(it, [it], NOW, {}))
        self.assertIsNotNone(board.prune_why(it, [it], NOW + 25 * 3600, {}))  # 暂停满 24 小时照收

    def test_rejudge_inside_lock(self):
        """查 gh 期间有人把暂停原因改成等用户：进锁后重判，不按旧原因收（审查第 3 条）。"""
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "8"
        real = board.pr_final

        def slow_gh(*a, **kw):
            cur = board._read()
            next(i for i in cur if i["id"] == 341)["pause_why"] = "等用户[定方向]"
            board._write(cur)
            return real(*a, **kw)
        board.pr_final = slow_gh
        try:
            ids = {i["id"] for i, _ in board.auto_prune(now=NOW)}
        finally:
            board.pr_final = real
        self.assertNotIn(341, ids)
        self.assertIn(462, ids)
        self.assertIn(341, {i["id"] for i in board._read()})

    def test_resume_refused_not_pruned_again(self):
        """找回后（resume 接着被拒、条目还暂停着）下一条命令不按③马上又收（审查第 4 条）。"""
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "8"
        board.auto_prune(now=NOW)
        self.assertIsNotNone(board.unprune(341))
        it = next(i for i in board._read() if i["id"] == 341)
        self.assertTrue(it.get("paused"))
        self.assertNotIn(341, {i["id"] for i, _ in board.auto_prune(check_pr=False)})

    def test_every_command_prunes_without_gh(self):
        """每个 board 命令顺带收（不查 gh）；这次要操作的编号先不收。"""
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "0.001"
        board.main(["update", "341", "接着做"])  # 341 被改：不收；别的闲着的收
        left = {i["id"] for i in board._read()}
        self.assertIn(341, left)
        self.assertNotIn(462, left)
        self.assertNotIn(557, left)  # 并入 #597
        self.assertFalse(GH_LOG.exists())


class Timers(unittest.TestCase):
    def setUp(self):
        for f in Path(TMP).glob("board*"):
            f.unlink()
        self.log = Path(TMP) / "cc.log"
        self.log.write_text("")
        fake = Path(TMP) / "fakecc"
        fake.write_text(f"#!{sys.executable}\nimport json, sys\nopen({str(self.log)!r}, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n")
        fake.chmod(0o755)
        os.environ["CC_BIN"] = str(fake)

    def tearDown(self):
        os.environ["CC_BIN"] = "false"
        os.environ.pop("BOARD_PRUNE_IDLE_HOURS", None)

    def calls(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()]

    def test_pause_schedules_two_checks(self):
        """聊天频道里直接 pause、没绑工作区的条目也挂（不复用要求 ws 的 schedule_stale_check）。"""
        os.environ["CC_SESSION_KEY"] = "discord:100:u1"
        try:
            board.add("修登录", "-", "在做", "龙娘")
        finally:
            os.environ.pop("CC_SESSION_KEY")
        board.main(["pause", "1", "等显卡"])
        timers = [c for c in self.calls() if c[:2] == ["timer", "add"]]
        self.assertEqual([c[c.index("--delay") + 1] for c in timers], ["121m", "1441m"])
        for c in timers:
            self.assertEqual(c[c.index("--session-key") + 1], "discord:100")
            self.assertIn("--mute", c)
            cmd = c[c.index("--exec") + 1]
            self.assertTrue(cmd.endswith("board.py refresh"), cmd)
            self.assertIn(f"BOARD_DIR={TMP}", cmd)
            self.assertIn("BOARD_TIMER=1", cmd)
            self.assertIn("BOARD_PR_REPO=zuiho-kai/bothouse", cmd)
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "2"
        self.log.write_text("")
        board.main(["resume", "1"]); board.main(["pause", "1"])
        self.assertEqual([c[c.index("--delay") + 1] for c in self.calls() if c[:2] == ["timer", "add"]], ["121m"])

    def test_refresh_runs_prune(self):
        board._write([{"id": 1, "what": "a", "where": "-", "status": "s", "who": "橘", "at": "10-26 01:00",
                       "paused": "10-26 01:00", "pause_why": "主线外暂停"},
                      {"id": 2, "what": "b", "where": "-", "status": "s", "who": "橘", "at": "10-26 01:00",
                       "paused": "10-26 01:00", "pause_why": "等用户[方向]"}])
        os.environ["BOARD_PRUNE_IDLE_HOURS"] = "0.001"
        r = subprocess.run([sys.executable, str(HERE / "board.py"), "refresh"], capture_output=True, text=True,
                           env={**os.environ, "FAKE_GH_OUT": ""})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("自动收起 #1", r.stderr)
        self.assertEqual([i["id"] for i in board._read()], [2])

    def test_timer_reads_role_switch_and_hours(self):
        """定时由桥用自己的环境跑（BOARD_TIMER=1）：读角色侧记下的开关和门槛，不看自己的环境（审查第 2 条）。"""
        p = time.strftime("%m-%d %H:%M", time.localtime(time.time() - 3 * 86400))  # 暂停 3 天：桥默认 24 小时会收
        item = [{"id": 1, "what": "a", "where": "-", "status": "s", "who": "橘", "at": p, "paused": p, "pause_why": "主线外暂停"}]
        board._write(item)
        bridge_env = {k: v for k, v in os.environ.items() if k not in ("BOARD_AUTO_PRUNE", "BOARD_PRUNE_IDLE_HOURS")}

        def role(**env):
            subprocess.run([sys.executable, str(HERE / "board.py")], capture_output=True, text=True,
                           env={**bridge_env, "BOARD_AUTO_PRUNE": "0", **env})

        def timer():
            return subprocess.run([sys.executable, str(HERE / "board.py"), "refresh"], capture_output=True, text=True,
                                  env={**bridge_env, "BOARD_TIMER": "1", "FAKE_GH_OUT": ""})
        role(BOARD_AUTO_PRUNE="0")  # 角色侧关掉开关
        timer()
        self.assertEqual([i["id"] for i in board._read()], [1])
        role(BOARD_AUTO_PRUNE="1", BOARD_PRUNE_IDLE_HOURS="100000")  # 开着，门槛设得很高
        timer()
        self.assertEqual([i["id"] for i in board._read()], [1])
        role(BOARD_AUTO_PRUNE="1", BOARD_PRUNE_IDLE_HOURS="0.001")  # 角色侧这条命令自己也会收，收完再放回去给定时收
        board._write(item)
        r = timer()
        self.assertIn("自动收起 #1", r.stderr)
        self.assertEqual(board._read(), [])

    def test_no_sk_no_timer(self):
        board.add("顺手", "-", "s", "橘")
        board.main(["pause", "1"])
        self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    try:
        unittest.main(verbosity=1)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
