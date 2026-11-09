#!/usr/bin/env python3 -I
"""Daily reflection regression checks; fake engines only, no external model calls.

  python3 -I bin/test_reflect.py
"""
import json, re, sqlite3, sys, time, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_ingest import Fake, I, jsonl, user, claude
import daypack as D
import lint


class Pack(unittest.TestCase):
    def call(self, t, ttl=300, read=0):
        return dict(proj="p", sid="aaaaaaaa", sub=True, file="a", t=t,
                    u={"cache_read_input_tokens": read, "cache_creation":
                       {"ephemeral_5m_input_tokens": 100 if ttl == 300 else 0,
                        "ephemeral_1h_input_tokens": 100 if ttl == 3600 else 0}})

    def test_one_hour_cache_is_not_expired_after_ten_minutes(self):
        s = D.per_session([self.call(1, 3600), self.call(601, 3600)])
        self.assertEqual(s[("p", "aaaaaaaa")]["rewrites"], 0)
        self.assertEqual(D.per_session([self.call(1), self.call(601)])[("p", "aaaaaaaa")]["rewrites"], 1)
        self.assertEqual(D.per_session([self.call(1, 3600), self.call(3602, 3600)])[("p", "aaaaaaaa")]["rewrites"], 1)

    def test_read_only_call_keeps_the_previous_ttl(self):
        calls = [self.call(1, 3600), self.call(501, None, read=100), self.call(1101, 3600)]
        self.assertEqual(D.per_session(calls)[("p", "aaaaaaaa")]["rewrites"], 0)

    def test_rewrite_reasons(self):
        c = self.call
        S = D.per_session([dict(c(1), model="a"), dict(c(61), model="b"), dict(c(121), model="b", compact=True),
                           dict(c(181), model="b"), dict(c(900), model="b"), dict(c(960, read=500), model="b")])
        v = S[("p", "aaaaaaaa")]
        self.assertEqual([v["rw_" + r] for r in D.REASONS], [1, 1, 1, 1])
        self.assertEqual(v["rewrites"], 1)
        self.assertEqual([r["reason"] for r in D.REWRITES], ["换模型", "压缩", "前缀变", "过期"])
        self.assertEqual(D.REWRITES[-1]["ttl"], 300)

    def test_promises_include_a_delivery_before_unrelated_last_reply(self):
        text = "\n".join(D.promise_part([("aaaaaaaa", "t", [(1, "接下来我去修。"),
                                                             (2, "修完了，测试通过。"), (3, "聊别的。")])], 1500))
        self.assertIn("下一条回复", text)
        self.assertIn("修完了，测试通过。", text)
        self.assertIn("证据不足写无法判断", text)
        self.assertIn("不是未完成清单", text)

    def test_comparison_does_not_claim_global_spending_proves_effect(self):
        text = "\n".join(D.compare_part(None, None, []))
        self.assertIn("不能仅凭涨跌判断", text)


class Reflection(Fake):
    DAY = "2026-10-21"
    PACK = "合计 $10.0，疑似缓存过期重写 1 次。\n『接下来我去修。』"

    def setUp(self):
        super().setUp()
        self.page("tooling/rule-candidates.md", "- 旧规则")
        self.page("tooling/unrelated.md", "- 保留")
        (self.w / "tooling" / "README.md").write_text(
            "# tooling\n- [rule-candidates](rule-candidates.md) — d\n- [unrelated](unrelated.md) — d\n")
        self.commit("base")

    def write_reflection(self, day=None, extra=""):
        day = day or self.DAY
        self.page("tooling/daily-reflection.md",
                  f"- {day} 反思（数据包：合计 $10.0）\n"
                  "  - 钱：疑似缓存过期重写（来源：数据包）；根因：需按 TTL 区分的推测\n"
                  "    - 改法 a：修正统计脚本并用 1h 用例复测\n"
                  "  - 慢：无\n  - 返工：无\n  - 答应了没做：无法判断，摘录不足\n"
                  "  - 昨日对照：无对照\n" + extra)
        p = self.w / "tooling" / "daily-reflection.md"
        p.write_text(p.read_text().replace("## 现状", "## 关键事实") +
                     "## 待办\n- 明早待办（今日反思）：修正统计脚本并用 1h 用例复测\n")
        readme = self.w / "tooling" / "README.md"
        if "daily-reflection.md" not in readme.read_text():
            readme.write_text(readme.read_text() + "- [daily-reflection](daily-reflection.md) — d\n")
        with (self.w / "log.md").open("a") as f:
            f.write(f"## [{day}] dream | 今日反思 {day}\n- 今日反思\n")

    def test_fabricated_price_and_quote_are_rejected(self):
        self.write_reflection(extra="  - 来源：$100.0『编出来的』，999 次\n")
        got = I.pack_misquotes(self.PACK)
        self.assertIn("$100.0", got)
        self.assertIn("编出来的", got)
        self.assertIn("999 次", got)

    def test_model_date_sid_and_copied_quote_around_an_id_are_not_doubled(self):
        # 鲸鱼娘 2026-10-22 反思: 「10-23 10-23 e0ade4c4「…」「…」」 and 「sid1647e456：『…』」 (a bot's reply as source)
        cites = {"U1": ("10-23", "e0ade4c4", "停 别雷霆大思考了 给我瑞凤哥省点额度")}
        ans = json.dumps({"钱": [{"问题": "额度", "来源": "10-23 U1「停 别雷霆大思考了 给我瑞凤哥省点额度」；"
                                 "10-22 sid1647e456：『接下来我去修。』", "根因": "r"}]}, ensure_ascii=False)
        self.assertEqual(I.reflect_render(ans, self.DAY, cites, "tooling/daily-reflection.md", self.PACK), "")
        text = (self.w / "tooling" / "daily-reflection.md").read_text()
        self.assertIn("（来源：10-23 e0ade4c4「停 别雷霆大思考了 给我瑞凤哥省点额度」；数据包原句『接下来我去修。』）", text)
        self.assertNotIn("10-23 10-23", text)
        self.assertNotIn("1647e456", text)

    # codex:high's 2026-10-23 reflection (.ingest.log 2026-10-24 03:43:42): the source written inside 「问题」 and no
    # 「来源」 key, so all 8 items came out 「没有可核对的来源」 though their 『』 were in the pack
    REAL_PACK = ("- 合计 $463.5，其中子 agent $290.1；写缓存 $161.9，读缓存 $175.0，输出 $126.4；会话 51 个\n"
                 "## 慢命令（Bash 从发出到拿到结果超过 5 分钟：共 20 条，合计 147 分钟）\n"
                 "## 昨日对照（上一次反思 2026-10-22 的数据包 → 今天）\n"
                 "- 合计 $408.1 → $463.5；子 agent $246.0 → $290.1；写缓存 $150.0 → $161.9\n")

    def render_real(self, question, cites=None):
        ans = json.dumps({"钱": [{"问题": question, "根因": "r", "改法": [{"类": "a", "内容": "f"}]}]},
                         ensure_ascii=False)
        self.assertEqual(I.reflect_render(ans, self.DAY, cites or {}, "tooling/daily-reflection.md", self.REAL_PACK), "")
        return (self.w / "tooling" / "daily-reflection.md").read_text()

    def test_source_written_inside_the_question_is_kept(self):
        cites = {"U3": ("10-23", "e0ade4c4", "那感觉为啥现在还是不够用")}
        text = self.render_real("今天总开销仍高且较昨日上升。来源：『合计 $463.5，其中子 agent $290.1；写缓存 $161.9，"
                                "读缓存 $175.0，输出 $126.4；会话 51 个』；昨日对照『合计 $408.1 → $463.5；子 agent "
                                "$246.0 → $290.1』；U3", cites)
        self.assertIn("  - 钱：今天总开销仍高且较昨日上升。（来源：『合计 $463.5", text)
        self.assertIn("10-23 e0ade4c4「那感觉为啥现在还是不够用」", text)
        self.assertNotIn("没有可核对的来源", text)
        self.assertIn("明早待办（2026-10-21 反思，a 类）：f", text)

    def test_source_in_parentheses_inside_the_question_is_kept(self):
        text = self.render_real("前台等待和轮询仍然很多（来源：『慢命令（Bash 从发出到拿到结果超过 5 分钟：共 20 条，合计 147 分钟）』）")
        self.assertIn("  - 钱：前台等待和轮询仍然很多（来源：『慢命令（Bash 从发出到拿到结果超过 5 分钟：共 20 条，合计 147 分钟）』）；根因", text)

    def test_made_up_source_inside_the_question_is_still_rejected(self):
        text = self.render_real("开销上升。来源：『合计 $999.9，全是子 agent』")
        self.assertIn("  - 钱：无法判断（有数字或数据包原句对不上", text)
        self.assertNotIn("$999.9", text)
        self.assertNotIn("明早待办（2026-10-21 反思", text)

    def test_question_without_any_source_is_still_not_written_as_fact(self):
        text = self.render_real("开销上升，来源见上")
        self.assertIn("  - 钱：无法判断（没有可核对的来源）", text)

    def test_batches_keep_all_evidence_and_repeat_the_session_header(self):
        source = "=== SESSION aaaaaaaa | test\n" + "".join(f"USER: 独特证据-{n:04d}\n" for n in range(100))
        parts = I.reflect_batches(source, limit=600)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(p) <= 600 for p in parts))
        self.assertTrue(all("=== SESSION aaaaaaaa" in p for p in parts))
        for n in range(100):
            self.assertEqual("".join(parts).count(f"独特证据-{n:04d}"), 1)

    def test_historical_section_can_move_verbatim(self):
        self.write_reflection(extra="  - 来源：旧日 $999.0，77 次\n")
        self.commit("prior reflection")
        old = self.w / "tooling" / "daily-reflection.md"
        old.rename(old.with_name("daily-reflection-history.md"))
        self.assertEqual(I.pack_misquotes(self.PACK), "")

    def test_teammate_using_unified_sessions_does_not_get_juzi_costs(self):
        with mock.patch.multiple(I, ASSISTANT="龙娘", ROOT=None, day_sessions=lambda *a: [],
                                 transcripts=lambda **kw: {}, model_pass=lambda *a, **kw: False), \
             mock.patch.object(I.daypack, "build", return_value=("无记录", None)) as build:
            I.reflect(sqlite3.connect(":memory:"), time.time() + 3600)
        self.assertFalse(build.call_args.kwargs["usage"])

    def test_dialog_does_not_read_past_the_snapshot_end(self):
        p = self.root / "p" / "aaaaaaaa.jsonl"
        jsonl(p, [user("窗口里", "2026-10-21T00:00:00Z"), claude("结果", "2026-10-21T00:00:01Z"),
                  user("窗口外", "2026-10-21T01:00:00Z")])
        end = D.ts_of("2026-10-21T00:30:00Z")
        with mock.patch.object(I, "transcripts", return_value={p.stem: p}):
            got = I.day_sessions(end - 3600, end)
        self.assertIn("窗口里", got[0][3]["user"])
        self.assertNotIn("窗口外", got[0][3]["user"])

    def test_complete_dream_reflects_even_without_new_user_lines(self):
        # Exercise real model_pass -> guard -> commit -> deliver, with an in-process fake engine.
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text(Path(lint.__file__).read_text())
        (self.w / ".gitignore").write_text(".ingest-work/\n")
        self.commit("test runner")
        now = D.ts_of("2026-10-21T13:00:00Z")
        db = sqlite3.connect(":memory:")
        db.execute("create table dreamed(id text primary key, offset int, at real)")
        db.execute("create table alerts(kind text primary key, day text)")
        calls = []

        def engine(instruction, stdin="", label="?", context=None):
            calls.append(context)  # structured reflection: the model answers JSON, reflect_render writes the page
            return True, '{"钱": {"无": true}, "慢": {"无": true}, "返工": {"无": true}, "答应了没做": {"无": true}, "昨日对照": "无对照"}', 0

        def run(*args, **kwargs):
            old = self.w
            self.w = I.WIKI
            try:
                return engine(*args, **kwargs)
            finally:
                self.w = old

        with mock.patch.multiple(I, WORK=self.w / ".ingest-work", HOME=self.w, DREAM_ENGINE="fake",
                                 DREAM_NOTIFY="test test", transcripts=lambda **kw: {},
                                 day_sessions=lambda *a: [], runner=lambda name: run), \
             mock.patch.object(I.daypack, "build",
                               return_value=(self.PACK + " token=sk-" + "a" * 30 + "\n" + "证据\n" * 90000, {"cost": 10})), \
             mock.patch.object(I.time, "time", return_value=now), mock.patch.object(I, "notify_dream") as notify:
            I.dream(db, now + 3600)
            self.assertEqual(db.execute("select day from reflected").fetchall(), [(self.DAY,)])
            self.assertEqual(len(calls), 2)
            self.assertTrue(all(len(c) <= I.MAX_CHARS for c in calls))
            self.assertIn("[REDACTED]", calls[0])
            self.assertNotIn("sk-" + "a" * 30, calls[0])
            notify.assert_called_once()
            I.reflect(db, now + 3600)
            self.assertEqual(len(calls), 2)  # repeated nightly invocation doesn't reflect the same date twice
            # --reflect-day: a past day is redone on request, in the window that ends where the next day's began
            I.reflect(db, now + 3600, "2026-10-20")
        self.assertEqual(len(calls), 4)  # two dream batches and two reflect calls; no profiles pass without Discord sources
        rows = dict(db.execute("select day, at from reflected"))
        self.assertEqual(rows["2026-10-20"], now - 86400)

    def test_redo_does_not_move_the_night_run(self):
        # review 2026-10-23 A: --reflect-day of yesterday run between 00:00 and 03:00 stores at = today 00:00; the
        # 03:00 night run must still run, over its own window (from the last night run), not skip as "already completed"
        t = lambda d, h=0: time.mktime(time.strptime(d, "%Y-%m-%d")) + h * 3600
        db = sqlite3.connect(":memory:")
        db.execute("create table reflected(day text primary key, at real, totals text)")
        db.execute("insert into reflected values ('2026-10-21', ?, null)", (t("2026-10-22", 3),))  # last night run
        windows, clock = [], [t("2026-10-23", 1)]
        def mp(label, *a, **kw):
            return True
        with mock.patch.multiple(I, model_pass=mp, transcripts=lambda **kw: {}, reflect_page=lambda: "p.md",
                                 dream_page=lambda: "d.md", last_fixes=lambda *a: (None, [])), \
             mock.patch.object(I, "day_sessions", side_effect=lambda s, e: windows.append((s, e)) or []), \
             mock.patch.object(I.daypack, "build", return_value=("pack", {"cost": 1})), \
             mock.patch.object(I.time, "time", side_effect=lambda: clock[0]):
            self.assertTrue(I.reflect(db, clock[0] + 3600, "2026-10-22"))  # 01:00: redo yesterday
            clock[0] = t("2026-10-23", 3)  # the 03:00 night run
            self.assertTrue(I.reflect(db, clock[0] + 3600))
            self.assertEqual(len(windows), 2)  # it ran
            self.assertEqual(windows[-1], (t("2026-10-22", 3), t("2026-10-23", 3)))  # from the last night run
            clock[0] = t("2026-10-23", 4)
            self.assertTrue(I.reflect(db, clock[0] + 3600))
            self.assertEqual(len(windows), 2)  # same date again: already completed
            clock[0] = t("2026-10-24", 3)
            self.assertTrue(I.reflect(db, clock[0] + 3600))
            self.assertEqual(windows[-1], (t("2026-10-23", 3), t("2026-10-24", 3)))

    def test_seed_survives_an_early_return(self):
        # review 2026-10-23 third pass #1: the seed of reflect_nights was not committed; a first run that returned early
        # rolled it back and left an empty table, never seeded again. Real state copy when present, else a built one.
        import shutil, tempfile
        tmp = Path(tempfile.mkdtemp()) / "state.sqlite"
        real = Path.home() / "wiki" / ".ingest.sqlite"
        if real.exists():
            src = sqlite3.connect(f"file:{real}?mode=ro", uri=True)
            dst = sqlite3.connect(tmp)
            src.backup(dst)
            src.close()
            dst.close()
        db = sqlite3.connect(tmp)
        db.execute("create table if not exists reflected(day text primary key, at real, totals text)")
        db.execute("drop table if exists reflect_nights")
        if not db.execute("select count(*) from reflected where at is not null").fetchone()[0]:
            db.execute("insert into reflected values ('2026-10-21', 1761069600, null)")
        db.commit()
        want = db.execute("select max(at) from reflected").fetchone()[0]
        # returns early (budget used up, or already completed today on the real state) before anything is committed
        with mock.patch.object(I, "model_pass", side_effect=AssertionError("must return before the model")):
            I.reflect(db, time.time() - 1)
        db.close()  # no commit by the caller, as dream() on an early return
        db = sqlite3.connect(tmp)
        self.assertEqual(db.execute("select max(at) from reflect_nights").fetchone()[0], want)
        with mock.patch.object(I, "model_pass", side_effect=AssertionError("must return before the model")):
            I.reflect(db, time.time() - 1)  # second run: the table stays seeded, not re-created empty
        db.close()
        db = sqlite3.connect(tmp)
        self.assertEqual(db.execute("select max(at) from reflect_nights").fetchone()[0], want)
        db.close()
        shutil.rmtree(tmp.parent)

    def test_night_after_a_redo_of_the_same_day_compares_with_the_day_before(self):
        # review 2026-10-23 third pass #2: a 01:00 redo of yesterday is the newest row; the 03:00 night run (its window
        # is mostly yesterday) took it as prev and compared the day with itself
        t = lambda d, h=0: time.mktime(time.strptime(d, "%Y-%m-%d")) + h * 3600
        db = sqlite3.connect(":memory:")
        db.execute("create table reflected(day text primary key, at real, totals text)")
        db.execute("insert into reflected values ('2026-10-21', ?, '{\"cost\": 21}')", (t("2026-10-22", 3),))
        prevs, clock = [], [t("2026-10-23", 1)]
        def build(*a, prev=None, **kw):
            prevs.append(prev and prev["day"])
            return "pack", {"cost": 22}
        with mock.patch.multiple(I, model_pass=lambda *a, **kw: True, transcripts=lambda **kw: {},
                                 reflect_page=lambda: "p.md", dream_page=lambda: "d.md",
                                 last_fixes=lambda *a: (None, []), day_sessions=lambda s, e: []), \
             mock.patch.object(I.daypack, "build", side_effect=build), \
             mock.patch.object(I.time, "time", side_effect=lambda: clock[0]):
            self.assertTrue(I.reflect(db, clock[0] + 3600, "2026-10-22"))  # 01:00: redo yesterday
            clock[0] = t("2026-10-23", 3)
            self.assertTrue(I.reflect(db, clock[0] + 3600))  # 03:00 night run, day 2026-10-22
        self.assertEqual(prevs, ["2026-10-21", "2026-10-21"])

    def test_reflect_window(self):
        db = sqlite3.connect(":memory:")
        db.execute("create table reflected(day text primary key, at real, totals text)")
        t = lambda d, h=0: time.mktime(time.strptime(d, "%Y-%m-%d")) + h * 3600
        r20, r22 = ("2026-10-20", t("2026-10-21", 3), '{"a": 1}'), ("2026-10-22", t("2026-10-23", 3), None)
        db.executemany("insert into reflected values (?,?,?)", [r20, r22])
        self.assertEqual(I.reflect_window(db, "2026-10-22"), (r20[1], r22[1], r20))  # its own window
        self.assertEqual(I.reflect_window(db, "2026-10-20"), (r20[1] - 86400, r20[1], None))  # first night: a day back
        # never reflected, the 10-22 night read it (its window began 10-21 03:00): the local day, overlapping that
        self.assertEqual(I.reflect_window(db, "2026-10-21"), (t("2026-10-21"), t("2026-10-22"), r20))
        db.execute("delete from reflected where day='2026-10-20'")  # main wiki: 10-22 is the first night
        self.assertEqual(I.reflect_window(db, "2026-10-21"), (r22[1] - 2 * 86400, r22[1] - 86400, None))
        # today or a future day: refused (its window would end in the future; the stored `at` would make tonight's
        # run skip as "already completed", review 2026-10-23 #3)
        today = time.strftime("%Y-%m-%d")
        tomorrow = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400))
        for d in (today, tomorrow, "2999-01-01"):
            with self.assertRaises(ValueError):
                I.reflect_window(db, d)
        self.assertEqual(I.reflect_window(db, "2026-10-01"), (t("2026-10-01"), t("2026-10-02"), None))  # long before

    def test_a_failed_later_batch_does_not_deliver_partial_results(self):
        calls = []
        def run(instruction, stdin="", label="?", context=None):
            calls.append(context)
            if len(calls) == 2:
                return False, "offline", 0
            (I.WIKI / "tooling" / "partial.md").write_text("partial\n")
            return True, "first batch read", 0
        with mock.patch.multiple(I, WORK=self.w / ".ingest-work", HOME=self.w, runner=lambda name: run):
            self.assertFalse(I.model_pass("reflect trial", "read batches", context="first",
                                          extra_contexts=["second"], engine="fake"))
            self.assertFalse((self.w / "tooling" / "partial.md").exists())
            self.assertFalse((I.WORK / "tooling" / "partial.md").exists())

    def test_notification_carries_pending_fixes_and_keeps_b_in_lessons(self):
        with mock.patch.multiple(I, HOME=Path("/nonexistent/reflection-test"),
                                 DREAM_NOTIFY="assistant test-session"):
            I.notify_dream()
        text = I.LOG.read_text()
        self.assertIn("逐条处理「明早待办」a 类", text)
        self.assertIn("b 类只写进教训表，不在频道里请用户拍板", text)
        self.assertNotIn("等用户拍板", text)  # 教训表是唯一升级口：dream 通知不再在频道里请用户拍板
        self.assertIn("daily-reflection.md", text)


if __name__ == "__main__":
    unittest.main()
