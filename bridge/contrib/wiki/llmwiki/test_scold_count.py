#!/usr/bin/env python3 -I
"""scold_count.record() 的最小单测：模型用桩（ask=），临时目录当 wiki，不调 claude、不碰真 wiki。"""
import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import scold_count as sc

DAY = "2026-11-23"  # 周一，2026-W48
ITEMS = [
    {"id": "U1", "day": "11-23", "src": "ab12cd34", "text": "你到底有没有自己再看一遍呢"},
    {"id": "U2", "day": "11-23", "src": "09:15 #后宅", "text": "可以，快走"},
    {"id": "U3", "day": "11-23", "src": "ab12cd34", "text": "我让你抄他学他，\t怎么还是\n老一套"},
]
LABELS = {"U1": ("交前没比", "没自己看就交"), "U2": (sc.NONE, ""), "U3": ("转述走样", "没照参考")}


def stub(calls=None):
    """桩：照 LABELS 回；U2 之外再漏回一条编号以外的、和一个标签表以外的类（都该按不算）。"""
    def ask(lines):
        if calls is not None:
            calls.append(lines)
        got = [{"id": i, "class": LABELS[i][0], "why": LABELS[i][1]} for i in (l.split(":")[0] for l in lines) if i in LABELS]
        return got + [{"id": "U99", "class": "交前没比", "why": "编出来的编号"}], 0.001
    return ask


class Record(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.wiki = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def ledger(self):
        return (self.wiki / sc.LEDGER_REL).read_text(encoding="utf-8").splitlines()

    def page(self):
        return (self.wiki / sc.PAGE_REL).read_text(encoding="utf-8")

    def test_writes_ledger_rows(self):
        res = sc.record(ITEMS, DAY, wiki=self.wiki, ask=stub())
        self.assertEqual(res["error"], "")
        self.assertEqual((res["new"], res["none"]), (2, 1))
        rows = self.ledger()
        self.assertEqual(rows[0], sc.HEADER)
        self.assertEqual(rows[1], "2026-11-23\t2026-W48\t交前没比\t你到底有没有自己再看一遍呢\tab12cd34\t没自己看就交")
        # 原话里的制表符、换行压成空格，一条还是一行六列；「不算」和模型编的编号不进表
        self.assertEqual(rows[2], "2026-11-23\t2026-W48\t转述走样\t我让你抄他学他， 怎么还是 老一套\tab12cd34\t没照参考")
        self.assertEqual(len(rows), 3)
        self.assertIn(sc.LEDGER_REL, res["files"])

    def test_page_gets_the_day_line(self):
        res = sc.record(ITEMS, DAY, wiki=self.wiki, ask=stub())
        line = ("- 2026-11-23（2026-W48 累计）：没实物就开工 0、转述走样 1、交前没比 1、认可的被改 0；当日新记 2 条、不算 1 条；"
                "本周最多：转述走样 → 收紧「交接附原话/对照件」、交前没比 → 收紧「对照件闸」")
        self.assertEqual(res["line"], line)
        text = self.page()
        self.assertTrue(text.startswith(sc.PAGE.rstrip("\n")))  # 页不在：照模板建，原文一行不少
        self.assertEqual(text.splitlines()[-1], line)  # 加在「关键事实」节末尾
        self.assertIn(sc.PAGE_REL, res["files"])

    def test_same_sentence_is_not_counted_twice(self):
        sc.record(ITEMS, DAY, wiki=self.wiki, ask=stub())
        ledger, page = self.ledger(), self.page()
        res = sc.record(ITEMS, DAY, wiki=self.wiki, ask=stub())  # 同一晚重跑（反思重试）
        self.assertEqual(res["new"], 0)
        self.assertEqual(self.ledger(), ledger)
        self.assertEqual(res["files"], [sc.PAGE_REL])  # 明细表没动；页上当天那行的「新记」变 0，旧行挪进历史
        self.assertIn("累计）：没实物就开工 0、转述走样 1、交前没比 1、认可的被改 0；当日新记 0 条", self.page())
        for old in page.splitlines():  # 旧行一行不丢（lossless）
            self.assertIn(old, self.page().splitlines())

    def test_next_day_adds_to_the_week(self):
        sc.record(ITEMS, DAY, wiki=self.wiki, ask=stub())
        more = [{"id": "U1", "day": "11-24", "src": "ef56ab78", "text": "你有没有看过"}]
        res = sc.record(more, "2026-11-24", wiki=self.wiki, ask=stub())
        self.assertEqual(res["new"], 1)
        self.assertIn("- 2026-11-24（2026-W48 累计）：没实物就开工 0、转述走样 1、交前没比 2、认可的被改 0；当日新记 1 条、不算 0 条；"
                      "本周最多：交前没比 → 收紧「对照件闸」", self.page())
        self.assertEqual(len(self.ledger()), 4)

    def test_model_error_records_nothing(self):
        def boom(lines):
            raise TimeoutError("90s")
        res = sc.record(ITEMS, DAY, wiki=self.wiki, ask=boom)
        self.assertIn("TimeoutError", res["error"])
        self.assertEqual(res["files"], [])
        self.assertFalse((self.wiki / sc.LEDGER_REL).exists())
        self.assertFalse((self.wiki / sc.PAGE_REL).exists())


if __name__ == "__main__":
    unittest.main()
