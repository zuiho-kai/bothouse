"""记忆论坛夜间结算（score_night.py）和写入时过时检测（wiki 的 invalidate.py）：python3 -I contrib/gate/test_score_night.py
模型调用都换成假的，wiki、推送记录、票全在临时目录。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
LLMWIKI = HERE.parent / "wiki" / "llmwiki"
_tmp = tempfile.TemporaryDirectory()
WIKI = Path(_tmp.name) / "wiki"
(WIKI / "bin").mkdir(parents=True)
for f in ("invalidate.py", "lossless.py"):  # 同 setup_wiki.py：llmwiki/*.py 装进主 wiki 的 bin/
    (WIKI / "bin" / f).write_bytes((LLMWIKI / f).read_bytes())
os.environ["GATE_WIKI"] = str(WIKI)
for k in ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):  # score_night 自己提交 wiki
    os.environ[k] = "t@t" if "EMAIL" in k else "t"
os.environ["MEMVOTE_DIR"] = str(Path(_tmp.name) / "exp")
(Path(_tmp.name) / "exp").mkdir()
sys.path.insert(0, str(HERE))
import memvote, score_night, forum_scores  # noqa: E402

PAGE = "---\nname: p\ndescription: d\nscope: s\n---\n# P\n## 关键事实\n- 发版用 A 流水线\n- 群里叫橘\n"


def git(*a):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=WIKI, check=True, capture_output=True)


class T(unittest.TestCase):
    def setUp(self):
        exp = Path(os.environ["MEMVOTE_DIR"])
        for f in exp.iterdir():
            f.unlink()
        (WIKI / "tooling").mkdir(exist_ok=True)
        (WIKI / "tooling/p.md").write_text(PAGE, encoding="utf-8")
        if not (WIKI / ".git").exists():
            git("init", "-q")
        git("add", "-A")
        git("commit", "-qm", "base", "--allow-empty")
        self.exp = exp
        self.lines = PAGE.split("\n")
        self.h = [score_night._hash(l) for l in ("- 发版用 A 流水线", "- 群里叫橘")]
        push = [
            {"t": "2026-11-03 10:00:00", "key": "discord:1", "bot": "maomao", "user": True, "q": "发版怎么走",
             "refs": [f"tooling/p.md:8#{self.h[0]}"]},
            {"t": "2026-11-03 10:05:00", "key": "discord:1", "bot": "maomao", "user": True, "q": "不对，发版现在用 B 流水线了",
             "refs": [f"tooling/p.md:9#{self.h[1]}"]},
            {"t": "2026-11-03 10:10:00", "key": "discord:1", "bot": "maomao", "user": True, "q": "好的谢谢", "refs": []},
        ]
        (exp / "push.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in push), encoding="utf-8")
        memvote.cite("maomao", [(f"tooling/p.md#{self.h[0]}", 1)], key="discord:1")
        rows = [json.loads(x) for x in (exp / "votes.jsonl").read_text(encoding="utf-8").splitlines()]
        rows[0]["t"] = "2026-11-03 10:01:00"  # 引用落在第一轮里（这轮开始到用户下一句之间）
        (exp / "votes.jsonl").write_text(json.dumps(rows[0], ensure_ascii=False) + "\n", encoding="utf-8")
        forum_scores._cache.clear()

    def judge(self, batch, prompt, fmt, schema):  # 假模型：next 以「不对」开头算纠正
        return [{"i": i, "corrected": t["next"].startswith("不对"), "repeat": False} for i, t in enumerate(batch)]

    def test_corrected_turn_is_failure_and_overturns(self):
        asked = []

        def ask(prompt):  # 假的过时判断：纠正那句推翻了组里第 0 条旧行
            asked.append(prompt)
            return json.dumps({"results": [{"g": 0, "n": 0, "contradicted_facts": [0]}]})

        with patch.object(score_night, "judge", self.judge), patch.object(score_night.invalidate, "night_ask", ask), \
                patch.object(forum_scores, "path", lambda: self.exp / "scores.json"):
            score_night.main()
            votes = [json.loads(x) for x in (self.exp / "votes.jsonl").read_text(encoding="utf-8").splitlines()]
            got = [(r["id"], r["vote"]) for r in votes if r["by"] == "outcome"]
            # 第一轮引用了 A 流水线那条，用户下一句是纠正 → 失败一次
            self.assertEqual(got, [(f"tooling/p.md#{self.h[0]}", -1)])
            forum_scores._cache.clear()
            self.assertEqual(forum_scores.counts(f"tooling/p.md#{self.h[0]}"), (1, 1))
        self.assertEqual(len(asked), 1)
        text = (WIKI / "tooling/p.md").read_text(encoding="utf-8")
        body, hist = text.split("## 历史")
        self.assertIn("- 发版用 A 流水线", hist)  # 原样挪进历史，不删
        self.assertNotIn("- 发版用 A 流水线", body)
        log = subprocess.run(["git", "log", "-1", "--format=%s"], cwd=WIKI, capture_output=True, text=True).stdout
        self.assertIn("score_night", log)
        st = json.loads((self.exp / "score-state.json").read_text())
        self.assertGreater(st["since"], 0)

    def test_dry_writes_nothing(self):
        with patch.object(score_night, "judge", self.judge), \
                patch.object(score_night.invalidate, "night_ask", lambda p: '{"results": []}'):
            score_night.main(dry=True)
        votes = (self.exp / "votes.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(votes), 1)
        self.assertFalse((self.exp / "score-state.json").exists())
        self.assertNotIn("## 历史", (WIKI / "tooling/p.md").read_text(encoding="utf-8"))


class Invalidate(unittest.TestCase):
    """ingest 每轮验收前：这次新写的行 vs 同页旧行，被推翻的挪进「## 历史」。"""

    def setUp(self):
        (WIKI / "tooling").mkdir(exist_ok=True)
        (WIKI / "tooling/p.md").write_text(PAGE, encoding="utf-8")
        if not (WIKI / ".git").exists():
            git("init", "-q")
        git("add", "-A")
        git("commit", "-qm", "base", "--allow-empty")
        sys.path.insert(0, str(WIKI / "bin"))
        import invalidate
        self.inv = invalidate

    def test_new_line_moves_overturned_old_line(self):
        (WIKI / "tooling/p.md").write_text(PAGE + "- 发版改用 B 流水线\n", encoding="utf-8")
        seen = []

        def ask(prompt):
            seen.append(prompt)
            return 'ok {"results": [{"g": 0, "n": 0, "contradicted_facts": [0]}]}'

        moved, calls, pairs = self.inv.run(WIKI, ask=ask, log=lambda m: None)
        self.assertEqual((moved, calls), (1, 1))
        self.assertIn("EXISTING FACTS", seen[0])
        text = (WIKI / "tooling/p.md").read_text(encoding="utf-8")
        self.assertTrue(text.rstrip().endswith("- 发版用 A 流水线"))
        self.assertIn("- 群里叫橘", text.split("## 历史")[0])

    def test_nothing_new_no_call(self):
        self.assertEqual(self.inv.run(WIKI, ask=lambda p: self.fail("不该调模型"), log=lambda m: None), (0, 0, []))


if __name__ == "__main__":
    unittest.main()
