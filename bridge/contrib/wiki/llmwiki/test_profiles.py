"""懂你画像每人一页（profiles.py + gate ctxsvc.profile_items，#1160）：python3 -I contrib/wiki/llmwiki/test_profiles.py"""
import json, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent / "gate"))
import profiles  # noqa: E402


def rec(ts, text, sid, name):
    return json.dumps({"v": 1, "ts": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts)), "channel": "discord:9",
                       "text": text, "speaker": name, "speaker_id": sid, "platform": "discord"}, ensure_ascii=False)


class Profiles(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.store, self.wiki = Path(d.name) / "store", Path(d.name) / "wiki"
        (self.store / "people").mkdir(parents=True)
        now = time.time() - 60
        (self.store / "people" / "discord-1.jsonl").write_text("\n".join([
            rec(now, "你这还是现象，我要根因", "1", "owner"), rec(now, "你这还是现象，我要根因", "1", "owner"),  # 两个 bot 各记一份
        ]) + "\n")
        (self.store / "people" / "discord-2.jsonl").write_text(
            rec(now, "[replying to 橘: 旧话*]\n感觉声音不是很自然 可以用豆包的api", "2", "zzzx0757") + "\n")

    def ask(self, prompt):
        self.prompts.append(prompt)
        if "豆包" in prompt:
            return {"lines": [{"section": "审美口味", "text": "他对声音自然度敏感，所以配音先挑自然的", "id": "U1", "quote": "声音不是很自然"}]}
        return {"lines": [{"section": "判断标准", "text": "他认根因，所以修到上游", "id": "U1", "quote": "我要根因"}]}

    def test_each_person_own_page_and_words(self):
        self.prompts = []
        words = profiles.people_words(0, time.time(), self.store)
        self.assertEqual(len(words["discord-1"][1]), 1)  # 同一条的两份只算一次
        self.assertEqual(words["discord-2"][1][0][2], "感觉声音不是很自然 可以用豆包的api")  # 引用的旧话不算他的
        done, files = profiles.run(self.wiki, 0, time.time(), self.ask, lambda m: None, root=self.store)
        self.assertEqual(set(done), {"discord-1", "discord-2"})
        a = (self.wiki / profiles.page_rel("discord-1")).read_text()
        b = (self.wiki / profiles.page_rel("discord-2")).read_text()
        self.assertIn("我要根因", a)
        self.assertNotIn("豆包", a)
        self.assertIn("# 懂你：zzzx0757", b)
        self.assertNotIn("根因", b)
        self.assertTrue(all("我要根因" not in p for p in self.prompts if "zzzx0757" in p))  # 他的页只喂他的话

    def test_push_by_sender(self):
        import ctxsvc
        self.prompts = []
        profiles.run(self.wiki, 0, time.time(), self.ask, lambda m: None, root=self.store)
        old = ctxsvc.PROFILE
        ctxsvc.PROFILE = profiles.PROFILE_DIR
        try:
            a = ctxsvc.profile_items([self.wiki], "discord-1")
            b = ctxsvc.profile_items([self.wiki], "discord-2")
            self.assertIn("我要根因", a[0]["desc"])
            self.assertIn("声音不是很自然", b[0]["desc"])
            self.assertNotIn("根因", b[0]["desc"])
            # 别的平台同一套：QQ 的发送人只拿到他那页
            (self.wiki / profiles.page_rel("qq-1234567890")).write_text("# 懂你：qq用户\n\n## 现状\n### 判断标准\n- 他要快，所以先给结论（11-07「快点」）\n")
            q = ctxsvc.profile_items([self.wiki], "qq-1234567890")
            self.assertIn("qq用户", q[0]["path"])
            self.assertNotIn("根因", q[0]["desc"])
            self.assertEqual(ctxsvc.profile_items([self.wiki], "qq-999"), [])
            self.assertEqual(ctxsvc.profile_items([self.wiki], "discord-3"), [])  # 没他的页：不推，不拿别人的顶上
            self.assertEqual(ctxsvc.profile_items([self.wiki], ""), [])  # cron、定时：没有发送人
            self.assertEqual(ctxsvc.profile_items([self.wiki], "../x"), [])
        finally:
            ctxsvc.PROFILE = old


if __name__ == "__main__":
    unittest.main()
