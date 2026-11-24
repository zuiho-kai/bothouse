"""讨论原文里主角色的话只留问句，她每条的全文另存 <交接>.主角色的话.md（_source._lead_asks、_lead_out、_write_dump）。
来源：用户 11-21「你不要指定说做什么，把我们原文给他，让他自己判断」；11-24 回放里主角色一条话先提议做法再问两个问题，
用户只答了问题，工作区把提议写成了「做完」，标「只作参考」挡不住。"""
import datetime as dt, json, os, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _source  # noqa: E402

LEAD = "我打算接 new-api 来做，顺手把旧表删掉。\n两个问题：要不要先备份？保留几天?\n```\nselect 1 where a = ?\n```\n1. 先改 A。"


class LeadAsksTest(unittest.TestCase):
    def test_keeps_only_question_sentences(self):
        self.assertEqual(_source._lead_asks(LEAD), "两个问题：要不要先备份？保留几天?")  # 提议、代码块、编号行都不留
        self.assertEqual(_source._lead_asks("好，我交出去。"), "")
        self.assertEqual(_source._lead_asks("先做 A。要不要连 B 一起？我倾向一起。"), "要不要连 B 一起？")
        self.assertEqual(_source._lead_asks("是这个意思吗？」"), "是这个意思吗？」")
        self.assertEqual(_source._lead_asks(""), "")

    def test_lead_out_splits_shown_and_full(self):
        msgs = [("2026-11-24T12:57:00+08:00", "zuiho", "把旧表清一下"),
                ("2026-11-24T12:58:00+08:00", _source._LEAD_WHO, LEAD),
                ("2026-11-24T12:59:00+08:00", "龙娘（bot）", "我觉得可以接 new-api？"),
                ("2026-11-24T13:00:00+08:00", _source._LEAD_WHO, "好，我交出去。"),
                ("2026-11-24T13:01:00+08:00", _source._LEAD_WHO, "保留七天行吗？")]
        shown, full = _source._lead_out(msgs)
        self.assertEqual(shown[0], msgs[0])  # 用户的话不动
        self.assertEqual(shown[2], msgs[2])  # 队友的话不动，带问号也不裁
        self.assertEqual(shown[1][1:], (_source._LEAD_ASK, "两个问题：要不要先备份？保留几天?\n" + _source._LEAD_CUT))
        self.assertEqual(shown[3][1:], (_source._LEAD_ASK, _source._LEAD_NONE))
        self.assertEqual(shown[4][1:], (_source._LEAD_ASK, "保留七天行吗？"))  # 整条都是问句：不加「其余没放进来」
        self.assertEqual(full, [msgs[1], msgs[3], msgs[4]])  # 全文一字不少
        self.assertFalse(any(_source.is_user(who, c) for _, who, c in shown if who == _source._LEAD_ASK))


class LeadFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.now = dt.datetime.now().astimezone()
        sess = self.tmp / "sessions"
        (sess / "proj_ab.history").mkdir(parents=True)
        (sess / "proj_ab.json").write_text(json.dumps({"user_sessions": {"discord:42": ["s1"]},
                                                       "sessions": {"s1": {"agent_session_id": "x"}}}))
        self.hist = sess / "proj_ab.history" / "s1.jsonl"
        self.notes = self.tmp / "h.md"
        self.notes.write_text("# 交接\n## 用户原话\n- x\n", encoding="utf-8")
        env = patch.dict(os.environ, {"CC_DATA_DIR": str(self.tmp)})
        env.start()
        self.addCleanup(env.stop)

    def say(self, *rows):
        """rows: (几分钟前, role, 内容)"""
        self.hist.write_text("\n".join(json.dumps(
            {"role": role, "content": c, "timestamp": (self.now - dt.timedelta(minutes=ago)).isoformat()},
            ensure_ascii=False) for ago, role, c in rows) + "\n")

    def test_append_source_writes_asks_and_full_text(self):
        self.say((20, "user", "（最新，回这条）\n把旧表清一下"), (19, "assistant", LEAD), (18, "user", "（最新，回这条）\n先备份，留七天"))
        dump = _source.append_source(str(self.notes), "discord:42", project="proj")
        self.assertEqual(dump, _source.dump_path(str(self.notes)))
        text = Path(dump).read_text(encoding="utf-8")
        lead = _source.lead_path(str(self.notes))
        self.assertTrue(lead.endswith("h.主角色的话.md"))
        self.assertIn("，3 条）", text)
        self.assertIn(f"{_source._LEAD_ASK}\n两个问题：要不要先备份？保留几天?\n{_source._LEAD_CUT}\n", text)
        self.assertNotIn("new-api", text)  # 提议不进讨论原文
        self.assertNotIn("select 1", text)
        self.assertIn("把旧表清一下", text)
        self.assertIn("先备份，留七天", text)
        self.assertIn(lead, text.splitlines()[1])  # 说明里写了全文在哪、什么时候才查
        self.assertIn("用户答了她的问句不等于同意她别的话", text.splitlines()[1])
        full = Path(lead).read_text(encoding="utf-8")
        self.assertIn("，1 条，程序导出）", full)
        self.assertIn(f"{_source._LEAD_WHO}\n{LEAD}\n", full)  # 全文原样
        self.assertIn("不是用户定的", full)
        h = self.notes.read_text(encoding="utf-8")
        self.assertIn(f"- 主角色的话全文：{lead}", h)
        self.assertIn("主角色的话只留了她问用户的问句", h)
        self.assertEqual([c for _, c in _source.user_words(str(self.notes))], ["把旧表清一下", "先备份，留七天", "x"])

    def test_append_new_keeps_asks_and_appends_full_text(self):
        path = str(self.notes)
        self.say((20, "user", "（最新，回这条）\n把旧表清一下"), (19, "assistant", "好，我交出去。"))
        dump, lead = Path(_source.append_source(path, "discord:42", project="proj")), Path(_source.lead_path(path))
        past = time.time() - 600
        os.utime(dump, (past, past))
        self.say((20, "user", "（最新，回这条）\n把旧表清一下"), (19, "assistant", "好，我交出去。"),
                 (3, "assistant", "那我改成直接删，不备份了。可以吗？"), (2, "user", "（最新，回这条）\n不行，先备份"),
                 (1, "assistant", "收到，照备份做。"))
        fresh = _source.append_new(path, "discord:42", "proj")
        self.assertEqual([c for _, _, c in fresh], ["不行，先备份"])  # 返回的只有用户的新话
        text = dump.read_text(encoding="utf-8")
        tail = text[text.index("# 追加："):]
        self.assertIn(f"{_source._LEAD_ASK}\n可以吗？\n{_source._LEAD_CUT}\n", tail)
        self.assertIn(f"{_source._LEAD_ASK}\n{_source._LEAD_NONE}\n", tail)  # 没问句的那条也留一行占位，看得出她说过话
        self.assertNotIn("直接删", text)
        self.assertNotIn("照备份做", text)
        full = lead.read_text(encoding="utf-8")
        self.assertIn("那我改成直接删，不备份了。可以吗？", full)
        self.assertIn("收到，照备份做。", full)
        self.assertEqual(full.count("好，我交出去。"), 1)  # 上次导过的不重复
        self.assertEqual(_source.append_new(path, "discord:42", "proj"), [])  # 再跑不重复导
        self.assertEqual(full, lead.read_text(encoding="utf-8"))

    def test_append_new_on_handoff_exported_before_this_change(self):
        path = str(self.notes)
        dump, lead = Path(_source.dump_path(path)), Path(_source.lead_path(path))
        dump.write_text(f"# 聊天频道 discord:42 讨论原文\n\n### 11-24 13:10 {_source._LEAD_WHO}\n我理解是改标题\n\n", encoding="utf-8")
        past = time.time() - 600
        os.utime(dump, (past, past))
        self.say((2, "assistant", "我再加个开关。"))
        self.assertEqual(_source.append_new(path, "discord:42", "proj"), [])
        self.assertIn("不是用户定的", lead.read_text(encoding="utf-8").splitlines()[1])  # 新建的那份也带说明
        self.assertIn("我再加个开关。", lead.read_text(encoding="utf-8"))
        self.assertNotIn("开关", dump.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
