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
PROFILE = "---\nname: me\ndescription: 画像\n---\n# 懂你\n## 现状\n- 喜欢短汇报\n## 历史\n- 旧说法\n"


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
        (wiki / "tooling/me.md").write_text(PROFILE, encoding="utf-8")
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

    def test_profile_only_when_configured(self):
        self.assertFalse([p for p in self.paths("随便聊聊") if p.startswith("【懂你")])
        with patch.object(ctxsvc, "PROFILE", "tooling/me.md"):
            got = [w for w in ctxsvc.context({"key": "discord:1", "text": "随便聊聊"})["wiki"] if w["path"].startswith("【懂你")]
        self.assertEqual(len(got), 1)
        self.assertIn("喜欢短汇报", got[0]["desc"])
        self.assertNotIn("旧说法", got[0]["desc"])

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

    def test_vote_change_and_collapse(self):
        line = "- 经验：发版前先看流水线有没有旧 run 在跑"
        cid = ctxsvc.exp_id("tooling/rule-candidates-recurrence.md", line)
        h = cid.rpartition("#")[2]
        with patch.dict(os.environ, {"CC_PROJECT": "a"}):
            self.assertEqual(memvote.main(["-" + h]), 0)
            self.assertEqual(memvote.main(["+" + h]), 0)  # 改投：同一角色一条只算一票
        forum_scores._cache.clear()
        self.assertEqual(forum_scores.counts(cid), (2, 0))
        for v in "bcdefgh":
            memvote.record(v, [(cid, -1)])
        forum_scores._cache.clear()
        self.assertTrue(forum_scores.collapsed(cid))  # 赞 2 踩 7：低于 -4 折叠
        hits = [("tooling/rule-candidates-recurrence.md", 9, line), ("tooling/rule-candidates-recurrence.md", 7, "- 别的")]
        self.assertEqual(forum_scores.rerank(hits)[-1][2], line)  # 沉底，不删


if __name__ == "__main__":
    unittest.main()
