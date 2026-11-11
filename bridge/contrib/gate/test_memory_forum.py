"""画像、经验推送和记忆论坛（投票、低分折叠）：python3 -I contrib/gate/test_memory_forum.py"""
import json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ctxsvc, forum_scores, memvote

LESSONS = ("---\nname: rule-candidates-recurrence\ndescription: 教训表\n---\n# 教训表\n## 关键事实\n"
           "- 经验：嘉立创下单前先核对板厚和层数参数\n  - 11-01 下单板厚选错\n  - 11-02 又选错\n"
           "- 经验：发版前先看流水线有没有旧 run 在跑\n  - 11-01 旧 run 挡住\n")
# 画像每人一页（#1160）：页名 profile-<平台>-<账号>.md，落在 GATE_PROFILE 指的那个目录里，格式同 profiles.py 的页头
PROFILE_PAGE = ("---\nname: profile-discord-1\ndescription: 懂你：鲸鱼娘 的画像\n---\n# 懂你：鲸鱼娘\n\n"
                "## 现状\n- 喜欢短汇报\n\n## 历史\n- 旧说法\n")


class T(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.d = Path(tmp.name)
        wiki, exp = self.d / "wiki", self.d / "exp"
        (wiki / "tooling").mkdir(parents=True)
        exp.mkdir()
        (wiki / "tooling/README.md").write_text("x", encoding="utf-8")
        (wiki / "tooling/rule-candidates-recurrence.md").write_text(LESSONS, encoding="utf-8")
        (wiki / "tooling/me.md").write_text(PROFILE_PAGE, encoding="utf-8")  # 旧的一页位置：配了目录也不该用它
        (wiki / "profile").mkdir()
        (wiki / "profile/profile-discord-1.md").write_text(PROFILE_PAGE, encoding="utf-8")
        self.wiki, self.exp = wiki, exp
        for obj, k, v in ((ctxsvc, "WIKI", wiki), (ctxsvc, "_idx", {}), (ctxsvc, "_lesson_rel", {}), (ctxsvc, "board", None),
                          (ctxsvc, "EXP", exp), (ctxsvc, "SCORES", exp / "scores.json"), (ctxsvc, "PROFILE", ""),
                          (memvote, "EXP", exp), (memvote, "SCORES", exp / "scores.json"), (memvote, "VOTES", exp / "votes.jsonl"),
                          (memvote, "PUSH", exp / "push.jsonl"), (memvote, "LOCK", exp / ".lock"), (memvote, "WIKI", wiki),
                          (memvote, "ROLES", self.d / "roles"), (forum_scores, "WIKI", wiki)):
            p = patch.object(obj, k, v)
            p.start()
            self.addCleanup(p.stop)
        p = patch.dict(os.environ, {"FORUM_SCORES": str(exp / "scores.json")})
        p.start()
        self.addCleanup(p.stop)
        forum_scores._cache.clear()
        if ctxsvc.lead:
            p = patch.object(ctxsvc.lead, "PLAYBOOK", None)
            p.start()
            self.addCleanup(p.stop)

    def paths(self, text):
        return [w["path"] for w in ctxsvc.context({"key": "discord:1", "text": text})["wiki"]]

    def profile(self, text="随便聊聊", sender="discord-1"):
        req = {"key": "discord:1", "text": text}
        if sender is not None:
            req["sender"] = sender
        return [w for w in ctxsvc.context(req)["wiki"] if w["path"].startswith("【懂你")]

    def test_profile_only_when_configured(self):
        self.assertFalse([p for p in self.paths("随便聊聊") if p.startswith("【懂你")])
        with patch.object(ctxsvc, "PROFILE", "profile"):
            got = self.profile()
        self.assertEqual(len(got), 1)
        self.assertIn("喜欢短汇报", got[0]["desc"])
        self.assertNotIn("旧说法", got[0]["desc"])  # 只推「## 现状」，历史不推
        self.assertIn("鲸鱼娘", got[0]["path"])  # 页头「# 懂你：<名字>」

    def test_profile_not_pushed_without_sender(self):
        """没有发送人（定时任务、队友 bot 的轮次）就不推，不拿别人的顶上。"""
        with patch.object(ctxsvc, "PROFILE", "profile"):
            self.assertEqual(self.profile(sender=None), [])
            self.assertEqual(self.profile(sender=""), [])

    def test_profile_off_when_not_configured(self):
        """GATE_PROFILE 为空 = 不推画像：#1160 前那一页（tooling/me.md）也不许退回旧语义推上来。"""
        with patch.object(ctxsvc, "PROFILE", ""):
            self.assertEqual(self.profile(), [])
            self.assertTrue((self.wiki / "tooling/me.md").exists())  # 旧那一页还在盘上，只是不推

    def test_profile_not_pushed_without_page(self):
        """目录配了、这个人还没页：不推；别人有页也不顶上来。"""
        with patch.object(ctxsvc, "PROFILE", "profile"):
            self.assertEqual(self.profile(sender="discord-2"), [])
            self.assertEqual(len(self.profile(sender="discord-1")), 1)

    def test_lesson_only_on_topic(self):
        hit = ctxsvc.lesson_hits("嘉立创下单板厚参数怎么选")
        self.assertEqual([e[2] for e in hit], ["- 经验：嘉立创下单前先核对板厚和层数参数"])
        self.assertEqual(ctxsvc.lesson_hits("今天天气不错"), [])

    def test_titles_and_ids_then_vote_hint(self):
        out = ctxsvc.context({"key": "discord:1", "text": "嘉立创下单板厚参数怎么选"})["wiki"]
        page = next(w for w in out if w["path"].endswith("rule-candidates-recurrence.md"))
        self.assertRegex(page["desc"], r"\| \d+: 嘉立创下单前先核对板厚和层数参数 \[#[0-9a-f]{10}\]")
        self.assertEqual(out[-1]["path"], "【记忆投票（每轮必做）】")
        self.assertIn("memvote.py", out[-1]["desc"])
        log = [json.loads(x) for x in (self.exp / "push.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertTrue(log[-1]["refs"])

    def test_no_vote_hint_without_memvote(self):
        with patch.object(ctxsvc, "MEMVOTE", self.d / "none.py"):
            self.assertNotIn("【记忆投票（每轮必做）】", self.paths("嘉立创下单板厚参数怎么选"))

    def test_self_report_is_citation_outcome_is_vote(self):
        line = "- 经验：发版前先看流水线有没有旧 run 在跑"
        cid = ctxsvc.exp_id("tooling/rule-candidates-recurrence.md", line)
        h = cid.rpartition("#")[2]
        with patch.dict(os.environ, {"CC_PROJECT": "a"}):
            self.assertEqual(memvote.main(["+" + h]), 0)
            self.assertEqual(memvote.main(["+" + h]), 0)  # 每次报都记一行引用，不去重
        rows = [json.loads(x) for x in (self.exp / "votes.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([(r["by"], r["id"]) for r in rows], [("self", cid), ("self", cid)])
        self.assertFalse((self.exp / "scores.json").exists())  # 引用不动分数
        memvote.record("b", [(cid, 1)], by="night")  # 模型代投不算票
        forum_scores._cache.clear()
        self.assertEqual(forum_scores.counts(cid), (1, 0))  # 只剩自带的那个赞
        memvote.outcome([(cid, 1)], key="discord:1")
        memvote.outcome([(cid, 1)], key="discord:1")  # 成功逐行累加
        forum_scores._cache.clear()
        self.assertEqual(forum_scores.counts(cid), (3, 0))
        for _ in range(8):
            memvote.outcome([(cid, -1)])
        forum_scores._cache.clear()
        self.assertTrue(forum_scores.collapsed(cid))  # 赞 3 踩 8：低于 -4 折叠
        hits = [("tooling/rule-candidates-recurrence.md", 9, line), ("tooling/rule-candidates-recurrence.md", 7, "- 别的")]
        self.assertEqual(forum_scores.rerank(hits)[-1][2], line)  # 沉底，不删

    def test_lessons_read_split_subpages(self):
        # 拆页后：主页 0 条经验，挪进同名目录，子页在旁边；每条 rel/行号是它真实所在的子页
        (self.wiki / "tooling/rule-candidates-recurrence.md").unlink()
        d = self.wiki / "tooling/rules/rule-candidates-recurrence"
        d.mkdir(parents=True)
        (d / "rule-candidates-recurrence.md").write_text("# 教训表\n\n## 关键事实\n- 主页普通事实\n", encoding="utf-8")
        (d / "wait.md").write_text("# 等待\n\n## 关键事实\n- 经验：长命令先后台启动\n  - 11-08 前台等了很久\n", encoding="utf-8")
        (d / "forum.md").write_text("# 论坛\n- 经验：发版前先看旧 run\n  - 11-09 旧 run 挡住\n  - 11-10 又挡住\n", encoding="utf-8")
        got = {(r, n): (ln, c) for r, n, ln, c, _ in ctxsvc.lessons()}
        base = "tooling/rules/rule-candidates-recurrence/"
        self.assertEqual(set(got), {(base + "wait.md", 4), (base + "forum.md", 2)})
        self.assertEqual(got[(base + "forum.md", 2)][1], 2)

    def test_lessons_main_page_without_subpages(self):
        got = ctxsvc.lessons()
        self.assertEqual(len(got), 2)
        self.assertEqual({r for r, *_ in got}, {"tooling/rule-candidates-recurrence.md"})


if __name__ == "__main__":
    unittest.main()
