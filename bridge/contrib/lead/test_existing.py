"""_existing.py：开工列出手里现成的东西（#1362）。"""
import os, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _existing  # noqa: E402


class ExistingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.script = self.tmp / "work" / "sync.py"
        self.script.parent.mkdir()
        self.script.write_text("x")
        old = self.tmp / "old.md"
        old.write_text(f"# 鱼小品音画对齐\n## 总目标\n仿片音画对齐、重配音\n脚本 {self.script}\n不在的 {self.tmp}/gone.py\n")
        other = self.tmp / "other.md"
        other.write_text("# 电池仓\n## 总目标\n外壳加高\n")
        self.recs = [{"id": 1288, "short": "去卡顿", "what": "仿片音画对齐去卡顿", "where": str(old), "status": "已完成",
                      "returned_at": "2026-11-09T01:00:00+00:00"},
                     {"id": 900, "short": "电池仓", "what": "外壳电池仓加高", "where": str(other),
                      "returned_at": "2026-11-01T01:00:00+00:00"}]
        sk = self.tmp / "skills" / "fish-sync"
        sk.mkdir(parents=True)
        (sk / "SKILL.md").write_text("---\nname: fish-sync\ndescription: 接手仿片的音画对齐、重配音、换人声\n---\n")
        self.skills = [self.tmp / "skills"]
        self.me = self.tmp / "new.md"
        self.me.write_text("# 交接\n## 用户原话\n- 仿片音画还是不同步，重配音\n## 总目标\n音画对齐\n")

    def rows(self, **kw):
        return _existing.listing(self.me.read_text(), "仿片音画对齐", str(self.me), records=self.recs,
                                 skill_dirs=self.skills, **kw)

    def test_lists_previous_task_files_and_skill(self):
        rows = self.rows()
        text = "\n".join(rows)
        self.assertIn("#1288", text)
        self.assertIn(str(self.script), text)  # 上一棒交接里写到、还在的文件
        self.assertNotIn("gone.py", text)  # 不在的不列
        self.assertNotIn("#900", text)  # 不相干的不列
        self.assertIn("fish-sync", text)

    def test_before_hides_later_tasks(self):
        before = _existing._ts("2026-11-05T00:00:00+00:00")
        self.assertNotIn("#1288", "\n".join(self.rows(before=before)))

    def test_cited_id_is_listed(self):
        self.me.write_text(self.me.read_text() + "## 参照实现\n- 接着 #900 做\n")
        self.assertIn("#900", "\n".join(self.rows()))

    def test_append_once(self):
        orig = _existing._board_records
        _existing._board_records = lambda: self.recs
        old_dirs = _existing.SKILL_DIRS
        _existing.SKILL_DIRS = self.skills
        try:
            a = _existing.append_to(str(self.me), "仿片音画对齐")
            b = _existing.append_to(str(self.me), "仿片音画对齐")
        finally:
            _existing._board_records, _existing.SKILL_DIRS = orig, old_dirs
        self.assertTrue(a)
        self.assertEqual(a, b)
        self.assertEqual(self.me.read_text().count(_existing.SECTION), 1)


class BoardRecordsTest(unittest.TestCase):
    def test_auto_pruned_is_not_a_previous_task(self):
        # #1492 P2：自动收起的暂停条目不是做完的活，不能当「上一棒…能用就接着用」列出来
        import types
        fake = types.SimpleNamespace(
            done_records=lambda: [{"id": 1, "where": "/a.md", "status": "已完成"},
                                  {"id": 2, "where": "/b.md", "status": "暂停", "auto_pruned": "暂停超过 7 天"}],
            items=lambda: [{"id": 3, "where": "/c.md"}])
        old = sys.modules.get("board")
        sys.modules["board"] = fake
        try:
            ids = [r["id"] for r in _existing._board_records()]
        finally:
            sys.modules.pop("board") if old is None else sys.modules.__setitem__("board", old)
        self.assertEqual(ids, [1, 3])


class ProposalTest(unittest.TestCase):
    """#1436：主角色要加东西、改机制时也列现成的（系统自带能力 + 做过的同类活）；平时不列。"""
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        fake = self.tmp / "bothouse"
        fake.write_text("#!/bin/sh\nprintf '# x\\n## 能做什么\\n- **大家记得同一件事**：共用一份 Wiki；面板里的「记忆论坛」给每条记忆打分排序。\\n## 别的\\n- **不列**：x\\n'\n")
        fake.chmod(0o755)
        self.cmd = str(fake)
        _existing._about[:] = [0.0, []]

    def test_lists_capabilities_when_proposing(self):
        rows = _existing.proposal_listing("你思考一下下一代更智能的架构，应该怎么搞", records=[], cmd=self.cmd)
        self.assertTrue(rows and "现成" in rows[0])
        self.assertTrue(any("记忆论坛" in r for r in rows))
        self.assertFalse(any("不列" in r for r in rows))

    def test_silent_otherwise(self):
        self.assertEqual(_existing.proposal_listing("今天吃什么", records=[], cmd=self.cmd), [])


if __name__ == "__main__":
    unittest.main()
