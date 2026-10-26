# 测 d10-fire 的判定（同目录 d10-fire 和 _team.worktrees）：没回、只回状态行、只回接单、回了交付、有动静续期。mock API 和 git，不发 Discord、不挂真 timer。
import importlib.machinery, importlib.util, os, unittest
from unittest import mock

_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "d10-fire")
_spec = importlib.util.spec_from_loader("d10fire", importlib.machinery.SourceFileLoader("d10fire", _p))
d = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(d)

TID = "2002"
SINCE = 1792724400.0  # 2026-10-23T03:00:00Z
def msg(content, author=TID, ts="2026-10-23T03:05:00+00:00"):
    return {"author": {"id": author}, "content": content, "timestamp": ts}
LATE = "2026-10-23T03:05:00+00:00"   # 晚于 SINCE
EARLY = "2026-10-23T02:00:00+00:00"  # 早于 SINCE

class T(unittest.TestCase):
    def setUp(self):  # 下面断言按桥程序名 cc-connect 写；找程序的逻辑另在 BridgeBinTest 测
        p = mock.patch.dict(os.environ, {"CC_BIN": "cc-connect"})
        p.start(); self.addCleanup(p.stop)

    def run_fire(self, messages, now=SINCE + 600, commit=0.0, extra=()):
        with mock.patch.object(d, "fetch_messages", return_value=messages), \
             mock.patch.object(d, "last_commit_epoch", return_value=commit), \
             mock.patch.object(d.time, "time", return_value=now), \
             mock.patch.object(d.subprocess, "run") as run, \
             mock.patch("builtins.print") as pr:
            run.return_value.returncode = 0
            d.main([TID, "活", str(SINCE), "discord:3003", "lead-proj", *extra])
        return run, pr

    def assertRenewed(self, n, **kw):
        run, _ = self.run_fire(**kw)
        argv = run.call_args[0][0]
        self.assertEqual(argv[:7], ["cc-connect", "timer", "add", "-p", "lead-proj", "-s", "discord:3003"])
        self.assertTrue(argv[-1].endswith(f"lead-proj --renew {n}"), argv[-1])  # 续期带回 project，下次照样能发暂停

    # 没交回但 10 分钟内有动静 → 续 10 分钟；没动静 → 暂停；续到上限 → 暂停
    def test_commit_renews(self):
        self.assertRenewed(1, messages=[], commit=SINCE + 300)

    def test_chat_renews(self):
        self.assertRenewed(1, messages=[msg("还在跑测试", ts="2026-10-23T03:08:00+00:00")])

    def test_old_commit_pauses(self):
        self.assertSent([], commit=SINCE - 60)

    def test_status_and_card_not_activity(self):
        self.assertSent([msg(""), msg("↪ 已插入")])

    def test_renew_second(self):
        self.assertRenewed(2, messages=[], now=SINCE + 1200, commit=SINCE + 1100, extra=("--renew", "1"))

    def test_renew_cap_pauses(self):
        self.assertSent([], now=SINCE + 1800, commit=SINCE + 1700, extra=("--renew", str(d.MAX_RENEW)))

    def test_renew_window_ignores_first_period(self):
        # 第二次到点只看最近 10 分钟：第一段里的提交不再算
        self.assertSent([], now=SINCE + 1200, commit=SINCE + 300, extra=("--renew", "1"))

    def test_delivered_beats_activity(self):
        self.assertSkipped([msg("Cursor 调研交付：" + "要点说明。" * 20)], commit=SINCE + 300)

    def assertSent(self, messages, **kw):
        run, _ = self.run_fire(messages, **kw)
        self.assertTrue(run.called); self.assertEqual(run.call_args[0][0][:2], ["cc-connect", "send"])

    def assertSkipped(self, messages, **kw):
        run, pr = self.run_fire(messages, **kw)
        self.assertFalse(run.called)

    def test_no_reply(self):
        self.assertSent([msg("别人说的话，交付了 PR" * 10, author="999")])

    def test_status_only(self):
        self.assertSent([msg("↪ 已转给队友"), msg("⏹ 已停止" + "x" * 100), msg("📬 收到 " + "交付" * 50)])

    def test_accept_only(self):
        self.assertSent([msg("【接】已派子 agent 去查 Cursor 的定价和功能对比，预计十分钟内做完交回，有问题我再来问你。" * 2)])

    def test_delivered(self):
        self.assertSkipped([msg("【接】已派子 agent"), msg("Cursor 调研交付：" + "要点说明。" * 20)])

    def test_delivered_before_dispatch_ignored(self):
        self.assertSent([msg("Cursor 调研交付：" + "要点说明。" * 20, ts=EARLY)])

    def test_pr_link(self):
        self.assertSkipped([msg("好了 https://github.com/org/x/pull/12 " + "说明" * 40)])

    # 2026-10-24 事故二的消息形状
    JU = "1001"
    CAT_RESULT = ("<@1001> 【接】搜过 wiki 以前没读过。原帖解读 Anthropic 新文《何时把子智能体合并回主智能体循环》，"
                  "讲把 Agent 搞成公司组织架构会导致“每一次 handoff 都在丢失关键细节、端到端延迟翻倍”。\n\n"
                  "- **能用在哪**：直接指导「把本机能力搬进产品」。" + "应按原帖把业务经验沉淀为 Skill，数据读写拆为标准 MCP Tools。" * 4 +
                  "\n- **不适用的地方**：不能直接套在 bothouse「多模型团队模式」的本体上。" + "原帖预设是单一前沿模型收回所有业务。" * 3 +
                  "\n\n*model · 5h 剩 100%*")

    def test_accept_with_result_counts(self):
        self.assertSkipped([msg("", ts="2026-10-23T03:01:00+00:00"), msg(self.CAT_RESULT)])

    # 审查 PR #377 第 1 条：Discord 回复经桥读回的形状「[回复 橘：派活原文前 40 字…] @橘 【接】…」
    DISPATCH = "龙娘，派你一件，10 分钟：读一下这个帖子，把要点和能用在 bothouse 上的地方列出来，交回写来源。"
    ACCEPT52 = "【接】马上读帖子，十分钟内把要点和能用在 bothouse 的地方列出来交回，有问题我再来群里问你吧好。"

    def reply_shape(self, text):
        return "[回复 橘：" + self.DISPATCH[:40] + "…] @橘 " + text

    def test_reply_prefixed_accept_not_handback(self):
        self.assertEqual(len(self.ACCEPT52), 52)
        c = self.reply_shape(self.ACCEPT52)
        self.assertGreater(len(c), d.MIN_LEN)
        self.assertFalse(d.is_handback(c))
        self.assertSent([msg(c)])

    def test_reply_prefixed_short_quote(self):
        self.assertFalse(d.is_handback("[回复 橘：去查一下] @橘 " + self.ACCEPT52))
        self.assertTrue(d.is_handback("[回复 橘：去查一下] @橘 调研交付：" + "要点说明。" * 20))

    def test_reply_prefixed_result_counts(self):
        self.assertSkipped([msg(self.reply_shape("调研交付：" + "要点说明。" * 20))])

    def test_reply_prefixed_accept_not_activity(self):
        self.assertFalse(d.chat_active([msg(self.reply_shape(self.ACCEPT52))], TID, SINCE))

    def test_reply_to_her_not_redispatch(self):
        # 主角色回复她的【接】：引用里有她的 @，桥给的 mentions 不含回复 ping → 不算第二次派活
        self.assertFalse(d.redispatched([
            {"author": {"id": self.JU}, "content": "@龙娘 派你一件", "mentions": [TID], "timestamp": "2026-10-23T03:00:07+00:00"},
            {"author": {"id": self.JU}, "content": "[回复 龙娘：<@%s> 【接】马上读] 好" % TID, "mentions": [], "timestamp": "2026-10-23T03:02:00+00:00"},
        ], TID, SINCE))
        # 平台没给 mentions 时：引用里的 <@id> 也不算
        self.assertFalse(d.redispatched([
            {"author": {"id": self.JU}, "content": "<@%s> 派你一件" % TID, "timestamp": "2026-10-23T03:00:07+00:00"},
            {"author": {"id": self.JU}, "content": "[回复 龙娘：<@%s> 【接】马上读] 好" % TID, "timestamp": "2026-10-23T03:02:00+00:00"},
        ], TID, SINCE))

    def test_redispatch_skips(self):
        # 原派活 @ 一次，她只发了进度卡（空正文），主角色又 @ 她派新活 → 旧 d10 不发暂停
        self.assertSkipped([
            msg("<@%s> 队友，派你一件，10 分钟：读一下帖子" % TID, author=self.JU, ts="2026-10-23T03:00:07+00:00"),
            msg("", ts="2026-10-23T03:00:30+00:00"),
            msg("明白……\n\n<@%s> 队友，派你一件，10 分钟：给 bothouse 仓库做开源前的体检。" % TID, author=self.JU, ts="2026-10-23T03:08:13+00:00"),
        ])

    def test_still_working_sends(self):
        # 队友 02:18 形状：派活一次 @、只有进度卡和「↪ 已插入」→ 照发暂停；别的 d10 发的暂停不算新派活
        self.assertSent([
            msg("<@%s> 队友，派你一件，10 分钟：把私信合进主线" % TID, author=self.JU, ts="2026-10-23T03:00:27+00:00"),
            msg("", ts="2026-10-23T03:00:57+00:00"),
            msg("<@%s> 暂停（「别的活」到 10 分钟了，停手，把做到哪一步交回来）" % TID, author=self.JU),
            msg("↪ 已插入"),
        ])

    def test_api_fail_sends(self):
        with mock.patch.object(d, "fetch_messages", side_effect=OSError), \
             mock.patch.object(d, "last_commit_epoch", return_value=0.0), \
             mock.patch.object(d.subprocess, "run") as run:
            run.return_value.returncode = 0
            d.main([TID, "活", str(SINCE), "discord:1", "lead-proj"])
        self.assertTrue(run.called)

    def test_no_token_needed(self):
        # 不读 DISCORD_BOT_TOKEN：平台不支持读历史（桥回 501 → None）时只按提交续期，不报「读不到 token」
        with mock.patch.dict(os.environ, {}, clear=False) as env, \
             mock.patch.object(d._team, "channel_history", return_value=None) as hist, \
             mock.patch.object(d, "last_commit_epoch", return_value=SINCE + 300), \
             mock.patch.object(d.time, "time", return_value=SINCE + 600), \
             mock.patch.object(d.subprocess, "run") as run, mock.patch("builtins.print"):
            env.pop("DISCORD_BOT_TOKEN", None)
            run.return_value.returncode = 0
            self.assertEqual(d.main([TID, "活", str(SINCE), "feishu:oc_1", "lead-proj"]), 0)
        hist.assert_called_once_with("feishu:oc_1", "lead-proj")
        self.assertEqual(run.call_args[0][0][:3], ["cc-connect", "timer", "add"])

    def test_renew_fail_sends(self):
        # timer add 返回非 0 → 退回发暂停
        with mock.patch.object(d, "fetch_messages", return_value=[]), \
             mock.patch.object(d, "last_commit_epoch", return_value=SINCE + 300), \
             mock.patch.object(d.time, "time", return_value=SINCE + 600), \
             mock.patch.object(d.subprocess, "run") as run, \
             mock.patch("builtins.print"):
            run.return_value.returncode = 1
            d.main([TID, "活", str(SINCE), "discord:1", "lead-proj"])
        calls = [c[0][0] for c in run.call_args_list]
        self.assertEqual(calls[0][:3], ["cc-connect", "timer", "add"])
        self.assertEqual(calls[-1][:2], ["cc-connect", "send"])
        self.assertIn("暂停", calls[-1][-1])

    def test_renew_oserror_sends(self):
        def fake(argv, *a, **k):
            if argv[1] == "timer":
                raise FileNotFoundError
            return mock.Mock(returncode=0)
        with mock.patch.object(d, "fetch_messages", return_value=[]), \
             mock.patch.object(d, "last_commit_epoch", return_value=SINCE + 300), \
             mock.patch.object(d.time, "time", return_value=SINCE + 600), \
             mock.patch.object(d.subprocess, "run", side_effect=fake) as run, \
             mock.patch("builtins.print"):
            d.main([TID, "活", str(SINCE), "discord:1", "lead-proj"])
        self.assertEqual(run.call_args[0][0][:2], ["cc-connect", "send"])

    def test_dry_run_shows_renew(self):
        _, pr = self.run_fire([], commit=SINCE + 300, extra=("--dry-run",))
        self.assertIn("会续 10 分钟（第 1/2 次）", pr.call_args[0][0])


class BridgeHistoryTest(unittest.TestCase):
    """fetch_messages 经桥 api.sock GET /channel/history 读频道（假桥：临时 unix socket 上的 HTTP 服务）。"""
    def serve(self, status, payload):
        import http.server, socketserver, tempfile, threading, json
        tmp = tempfile.mkdtemp(dir="/tmp")
        os.makedirs(os.path.join(tmp, "run"))
        sock = os.path.join(tmp, "run", "api.sock")
        seen = []
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.path)
                body = json.dumps(payload).encode() if status == 200 else b"not supported"
                self.send_response(status); self.send_header("Content-Length", str(len(body))); self.end_headers()
                self.wfile.write(body)
            def log_message(self, *a): pass
            def address_string(self): return "unix"
        srv = socketserver.UnixStreamServer(sock, H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(lambda: (srv.shutdown(), srv.server_close(), __import__("shutil").rmtree(tmp, ignore_errors=True)))
        p = mock.patch.dict(os.environ, {"CC_DATA_DIR": tmp}); p.start(); self.addCleanup(p.stop)
        return seen

    JU = "1001"
    def rows(self):
        return {"messages": [
            {"id": "1", "author_id": self.JU, "author_name": "橘", "is_bot": True, "content": "@龙娘 派你一件，10 分钟：读帖子", "time": "2026-10-23T03:00:07.123456789Z"},
            {"id": "2", "author_id": TID, "author_name": "龙娘", "is_bot": True, "content": "【接】", "time": "2026-10-23T03:00:30Z"},
            {"id": "3", "author_id": self.JU, "author_name": "橘", "is_bot": True, "content": "@龙娘 再派一件：体检", "time": "2026-10-23T03:08:13Z"},
        ]}

    def test_reads_via_bridge(self):
        seen = self.serve(200, self.rows())
        msgs = d.fetch_messages("discord:3003:9", "lead-proj")
        self.assertIn("session_key=discord%3A3003%3A9", seen[0]); self.assertIn("project=lead-proj", seen[0])
        self.assertEqual(msgs[1]["author"], {"id": TID, "username": "龙娘", "bot": True})
        # 桥回的正文里 <@id> 已换成 @用户名：仍认得出又派了新活
        self.assertTrue(d.redispatched(msgs, TID, SINCE))

    def test_redispatch_by_mention_ids(self):
        # 她窗口内一条没发（用户名无从得知），被 @ 两次：靠桥给的 mentions ID 认出重新派活（审查 #4）
        rows = {"messages": [
            {"id": "1", "author_id": self.JU, "author_name": "橘", "is_bot": True, "content": "@龙娘 派你一件，10 分钟：读帖子", "mentions": [TID], "time": "2026-10-23T03:00:07Z"},
            {"id": "2", "author_id": self.JU, "author_name": "橘", "is_bot": True, "content": "@别人 顺手看下", "mentions": ["9"], "time": "2026-10-23T03:04:00Z"},
            {"id": "3", "author_id": self.JU, "author_name": "橘", "is_bot": True, "content": "@龙娘 再派一件：体检", "mentions": [TID], "time": "2026-10-23T03:08:13Z"},
        ]}
        self.serve(200, rows)
        msgs = d.fetch_messages("discord:3003", "lead-proj")
        self.assertTrue(d.redispatched(msgs, TID, SINCE))
        self.assertFalse(d.redispatched(msgs[:2], TID, SINCE))  # 只 @ 过一次（本次派活）不算
        with mock.patch.object(d, "last_commit_epoch", return_value=0.0), \
             mock.patch.object(d.subprocess, "run") as run, mock.patch("builtins.print"):
            self.assertEqual(d.main([TID, "活", str(SINCE), "discord:3003", "lead-proj"]), 0)
        self.assertFalse(run.called)

    def test_redispatch_via_bridge_skips_pause(self):
        self.serve(200, self.rows())
        with mock.patch.object(d, "last_commit_epoch", return_value=0.0), \
             mock.patch.object(d.subprocess, "run") as run, mock.patch("builtins.print"):
            self.assertEqual(d.main([TID, "活", str(SINCE), "discord:3003", "lead-proj"]), 0)
        self.assertFalse(run.called)

    def test_handback_via_bridge_skips_pause(self):
        rows = self.rows(); rows["messages"] = rows["messages"][:2] + [
            {"id": "4", "author_id": TID, "author_name": "龙娘", "is_bot": True, "content": "做完了 https://github.com/a/b/pull/1", "time": "2026-10-23T03:06:00Z"}]
        self.serve(200, rows)
        with mock.patch.object(d, "last_commit_epoch", return_value=0.0), \
             mock.patch.object(d.subprocess, "run") as run, mock.patch("builtins.print"):
            self.assertEqual(d.main([TID, "活", str(SINCE), "discord:3003", "lead-proj"]), 0)
        self.assertFalse(run.called)

    def test_unsupported_platform_commit_only(self):
        self.serve(501, None)
        self.assertIsNone(d.fetch_messages("feishu:oc_1", "lead-proj"))
        with mock.patch.dict(os.environ, {"CC_BIN": "cc-connect"}), \
             mock.patch.object(d, "last_commit_epoch", return_value=0.0), \
             mock.patch.object(d.subprocess, "run") as run, mock.patch("builtins.print"):
            run.return_value.returncode = 0
            d.main([TID, "活", str(SINCE), "feishu:oc_1", "lead-proj"])
        self.assertEqual(run.call_args[0][0][:2], ["cc-connect", "send"])  # 没提交 → 照发暂停

    def test_bridge_down_raises(self):
        import tempfile
        with mock.patch.dict(os.environ, {"CC_DATA_DIR": tempfile.mkdtemp(dir="/tmp")}):
            with self.assertRaises(OSError):
                d.fetch_messages("discord:1", "p")


class BridgeBinTest(unittest.TestCase):
    """只装了 bothouse（PATH 里没有 cc-connect、没设 CC_BIN）：续期和暂停都真调到 bothouse。"""
    def setUp(self):
        import tempfile
        self.tmp = tempfile.mkdtemp()
        self.log = os.path.join(self.tmp, "calls.log")
        fake = os.path.join(self.tmp, "bothouse")
        with open(fake, "w") as fh:
            fh.write('#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\n' % self.log)
        os.chmod(fake, 0o755)
        env = {k: v for k, v in os.environ.items() if k != "CC_BIN"}
        env["PATH"] = self.tmp + ":/usr/bin:/bin"
        p = mock.patch.dict(os.environ, env, clear=True)
        p.start(); self.addCleanup(p.stop)

    def fire(self, commit, extra=()):
        with mock.patch.object(d, "fetch_messages", return_value=[]), \
             mock.patch.object(d, "last_commit_epoch", return_value=commit), \
             mock.patch.object(d.time, "time", return_value=SINCE + 600), \
             mock.patch("builtins.print"):
            rc = d.main([TID, "活", str(SINCE), "discord:3003", "lead-proj", *extra])
        with open(self.log) as fh:
            return rc, fh.read()

    def test_finds_bothouse(self):
        self.assertEqual(d.cc_bin(), os.path.join(self.tmp, "bothouse"))

    def test_cc_bin_env_wins(self):
        with mock.patch.dict(os.environ, {"CC_BIN": "/opt/x/bothouse"}):
            self.assertEqual(d.cc_bin(), "/opt/x/bothouse")

    def test_renew_via_bothouse(self):
        rc, log = self.fire(commit=SINCE + 300)
        self.assertEqual(rc, 0)
        self.assertTrue(log.startswith("timer add -p lead-proj -s discord:3003 --delay 10m"), log)

    def test_pause_via_bothouse(self):
        rc, log = self.fire(commit=0.0)
        self.assertEqual(rc, 0)
        self.assertTrue(log.startswith("send -p lead-proj -s discord:3003 --message"), log)
        self.assertIn("暂停", log)

    def test_d10_arms_via_bothouse(self):
        import json, subprocess, sys
        team = os.path.join(self.tmp, "team.json")
        with open(team, "w") as fh:
            json.dump({"lead": {"name": "L", "id": "1"}, "subs": {"c": {"name": "C", "id": "2"}}}, fh)
        d10 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "d10")
        env = {"PATH": os.environ["PATH"], "HOME": self.tmp, "GATE_TEAM": team, "GATE_SETUP_DIR": self.tmp,
               "CC_SESSION_KEY": "discord:3003", "CC_PROJECT": "lead-proj"}
        out = subprocess.run([sys.executable, "-I", d10, "C", "活"], capture_output=True, text=True, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        with open(self.log) as fh:
            self.assertTrue(fh.read().startswith("timer add -p lead-proj -s discord:3003 --delay 10m"))

    def test_d10_arms_on_dsh(self):
        # DSH 删掉带 KEY 的变量，只留 CC_SESSION：d10 照样挂上，timer add 带 -p/-s（审查 PR #377 第 4 条）
        import json, subprocess, sys
        team = os.path.join(self.tmp, "team.json")
        with open(team, "w") as fh:
            json.dump({"lead": {"name": "L", "id": "1"}, "subs": {"c": {"name": "C", "id": "2"}}}, fh)
        d10 = os.path.join(os.path.dirname(os.path.abspath(__file__)), "d10")
        env = {"PATH": os.environ["PATH"], "HOME": self.tmp, "GATE_TEAM": team, "GATE_SETUP_DIR": self.tmp,
               "CC_SESSION": "dsh:room-1:u", "CC_PROJECT": "lead-proj"}
        out = subprocess.run([sys.executable, "-I", d10, "C", "活"], capture_output=True, text=True, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        with open(self.log) as fh:
            self.assertTrue(fh.read().startswith("timer add -p lead-proj -s dsh:room-1:u --delay 10m"))

    def test_no_bridge_fails_loudly(self):
        os.remove(os.path.join(self.tmp, "bothouse"))
        with mock.patch.object(d, "fetch_messages", return_value=[]), \
             mock.patch.object(d, "last_commit_epoch", return_value=SINCE + 300), \
             mock.patch.object(d.time, "time", return_value=SINCE + 600), \
             mock.patch("builtins.print"):
            self.assertEqual(d.main([TID, "活", str(SINCE), "discord:3003", "lead-proj"]), 1)


class WorktreesTest(unittest.TestCase):
    def test_team_wt(self):
        import json, subprocess, sys, tempfile
        tmp = tempfile.mkdtemp()
        repo = os.path.join(tmp, "wt", "a")
        os.makedirs(repo)
        subprocess.run(["git", "init", "-q", repo], check=True)
        team = os.path.join(tmp, "team.json")
        with open(team, "w") as fh:
            json.dump({"lead": {"name": "L", "id": "1"}, "subs": {"c": {"name": "C", "id": "2", "wt": os.path.join(tmp, "wt")},
                       "w": {"name": "W", "id": "3", "wt": [repo]}}}, fh)
        drv = "import sys; sys.path.insert(0, sys.argv[1]); import _team; print([str(p) for p in _team.worktrees(sys.argv[2])])"
        here = os.path.dirname(os.path.abspath(__file__))
        for tid, want in (("2", [repo]), ("3", [repo]), ("1", []), ("9", [])):
            out = subprocess.run([sys.executable, "-I", "-c", drv, here, tid], capture_output=True, text=True,
                                 env={"PATH": "/usr/bin:/bin", "HOME": tmp, "GATE_TEAM": team, "GATE_SETUP_DIR": tmp})
            self.assertEqual(out.stdout.strip(), repr(want), out.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
