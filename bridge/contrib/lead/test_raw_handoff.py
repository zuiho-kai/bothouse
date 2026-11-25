"""交工作区只给原话，主角色写的只作参考（用户 11-21「你不要指定说做什么，把我们原文给他，让他自己判断」；
11-24 批的四处：硬拦去掉、开工提示、交回模板按原话逐条、后续纠正只追加新原话）。"""
import datetime as dt, json, os, subprocess, sys, tempfile, time, unittest
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
_loader = SourceFileLoader("ws_handoff", str(HERE / "ws-handoff"))
wsh = module_from_spec(spec_from_loader("ws_handoff", _loader))
_loader.exec_module(wsh)
_source = wsh._source

LEAD_NOTES = ("# 交接\n\n## 总目标\n把页面改好\n\n## 用户原话\n- 11-24 13:09「把首页那句话改掉」\n\n"
              "## 范围\n- 改：首页标题\n- 不改：无\n\n### 细项\n```\n## 围栏里的不是标题\n```\n")
DUMP = ("# 聊天频道 discord:42 讨论原文\n# 说明\n\n### 11-24 13:09 zuiho\n把首页那句话改掉\n\n"
        "### 11-24 13:10 主角色（程序只留了她问用户的问句）\n是改标题吗？\n（她这条其余是提议和说明，程序没放进来）\n\n"
        "### 11-24 13:12 zuiho\n" + "长" * 80 + "\n\n")


class RawHandoffTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.notes = self.tmp / "h.md"

    def write(self, text, dump=None):
        self.notes.write_text(text, encoding="utf-8")
        if dump is not None:
            Path(_source.dump_path(str(self.notes))).write_text(dump, encoding="utf-8")
        return str(self.notes)

    def test_only_user_words_passes(self):  # 主角色不写总目标、范围、对象核对也能交
        with patch.object(wsh._handoff_rules, "ds_lead", return_value=False):
            self.assertIsNone(wsh.check_notes("# 交接\n\n## 用户原话\n- 11-24「把首页那句话换一下」\n", "首页那句话换一下"))
        self.assertFalse(hasattr(wsh, "object_gate"))

    def test_fold_moves_lead_sections_under_reference(self):
        path = self.write(LEAD_NOTES + f"\n## {wsh.SOURCE}\n- 聊天频道：discord:42\n\n## 交回骨架\n```\n[report]\n```\n")
        self.assertTrue(wsh.fold_lead_notes(path))
        text = self.notes.read_text(encoding="utf-8")
        ref = text.index(f"## {_source.LEAD_SAYS}")
        self.assertLess(text.index("## 用户原话"), text.index(f"## {wsh.SOURCE}"))
        self.assertLess(text.index(f"## {wsh.SOURCE}"), ref)
        self.assertLess(ref, text.index("### 总目标"))
        self.assertLess(ref, text.index("### 主角色写的范围"))
        self.assertLess(text.index("### 主角色写的范围"), text.index("## 交回骨架"))
        self.assertIn("#### 细项", text)
        self.assertIn("\n## 围栏里的不是标题\n", text)  # 围栏里的照原样
        heads = [ln.lstrip("#").strip() for ln in text.replace("## 围栏里的不是标题", "").splitlines() if ln.startswith("#")]
        self.assertFalse([h for h in heads if h.startswith("范围")])  # 桥不再按主角色拆的范围出骨架
        self.assertNotIn("\n## 总目标", text)
        self.assertIn("- 改：首页标题", text)  # 内容一字不少
        self.assertFalse(wsh.fold_lead_notes(path))  # 重复跑不变
        self.assertEqual(text, self.notes.read_text(encoding="utf-8"))

    def test_fold_keeps_plain_handoff(self):
        path = self.write("# 交接\n\n## 用户原话\n- x\n")
        self.assertFalse(wsh.fold_lead_notes(path))
        self.assertNotIn(_source.LEAD_SAYS, self.notes.read_text(encoding="utf-8"))
        self.assertFalse(wsh.fold_lead_notes(str(self.tmp / "missing.md")))

    def test_fold_appends_to_existing_reference(self):
        path = self.write(f"## 用户原话\n- x\n\n## {_source.LEAD_SAYS}\n我先说一句\n\n## 做法\n先改 A\n")
        self.assertTrue(wsh.fold_lead_notes(path))
        text = self.notes.read_text(encoding="utf-8")
        self.assertEqual(text.count(f"## {_source.LEAD_SAYS}"), 1)
        self.assertLess(text.index("我先说一句"), text.index("### 做法"))
        self.assertNotIn(wsh.FOLD_NOTE, text)

    def kickoff(self, path, **kw):
        with patch.object(wsh, "kickoff_existing", return_value=None), patch.object(wsh, "kickoff_maps", return_value=""), \
                patch.object(wsh, "cc_bin", return_value="bothouse"), patch.object(wsh._team, "project", return_value="proj"):
            cmd = wsh.timer_cmd("discord:9", path, "改首页", 7, **kw)
        return cmd[cmd.index("--prompt") + 1]

    def test_kickoff_follows_user_words(self):
        path = self.write(LEAD_NOTES, DUMP)
        prompt = self.kickoff(path, chat="discord:42")
        self.assertTrue(prompt.startswith("你是工作区频道里的主角色，从主频道接手一整块大活：改首页（任务板 #7）。"))
        self.assertIn("照用户原话做，范围你从原话和现场自己定", prompt)
        self.assertNotIn("只做交接里写成", prompt)
        self.assertIn("我理解做完是这样", prompt)
        self.assertIn("bothouse send -p proj -s discord:42 --stdin", prompt)
        self.assertIn("原话里的词指什么", prompt)
        self.assertLess(prompt.index("【讨论原文"), prompt.index("工作区开工："))  # 讨论原文紧跟首句
        self.assertIn("主角色的话只留了她问用户的问句，她的提议没放进来】", prompt)
        self.assertIn("是改标题吗？", prompt)
        self.assertIn("原话没说定、要你自己选的做法（选哪个工具、哪种方案、走哪条路）不写成做完，单列成拿不准的选项并标推荐", prompt)

    def test_resume_kickoff_has_no_understanding_line(self):
        path = self.write(LEAD_NOTES, DUMP)
        said = _source.relay_text([("11-24 15:00", "zuiho", "标题别动，改副标题")], "用户说改副标题")
        prompt = self.kickoff(path, answer=said, chat="discord:42")
        self.assertNotIn("我理解做完是这样", prompt)
        self.assertNotIn("答复：", prompt)
        self.assertLess(prompt.index("「标题别动，改副标题」"), prompt.index(f"{_source.LEAD_SAYS}：用户说改副标题"))
        self.assertNotIn("我理解做完是这样", self.kickoff(path))  # 不知道聊天频道也不发

    def test_skeleton_lists_each_user_sentence(self):
        path = self.write(LEAD_NOTES, DUMP)
        done = subprocess.CompletedProcess([], 0, "[report] #7 背景：（待填）\n细节：\n入口自验：（待填）\n", "")
        with patch.object(wsh, "cc_bin", return_value="bothouse"), patch.object(wsh.subprocess, "run", return_value=done):
            self.assertTrue(wsh.append_skeleton(path, 7))
        text = self.notes.read_text(encoding="utf-8")
        sk = text[text.index("## 交回骨架"):]
        self.assertIn("用户原话逐条：", sk)
        self.assertIn("- 「把首页那句话改掉」—— （待填", sk)
        self.assertEqual(sk.count("把首页那句话改掉"), 1)  # 交接里引的同一句不重复列
        self.assertIn("- 「" + "长" * 80 + "」—— （待填", sk)  # 长句原话全文照列，不截断
        self.assertNotIn("是改标题吗", sk)  # 主角色的问句不进逐条
        self.assertNotIn("每条「改」都要逐条写到", sk)

    def test_relay_text(self):
        fresh = [("11-24 15:00", "zuiho", "标题别动")]
        out = _source.relay_text(fresh, "用户让改副标题")
        self.assertLess(out.index("「标题别动」"), out.index(f"{_source.LEAD_SAYS}：用户让改副标题"))
        raw = _source.BRIDGE_RAW[0] + "标题别动"
        self.assertEqual(_source.relay_text(fresh, raw), raw)  # 桥原样转的用户话不标参考、不重复列
        self.assertEqual(_source.relay_text([], ""), "")

    def test_append_new_adds_only_later_user_words(self):
        now = dt.datetime.now().astimezone()
        sess = self.tmp / "sessions"
        (sess / "proj_ab.history").mkdir(parents=True)
        (sess / "proj_ab.json").write_text(json.dumps({"user_sessions": {"discord:42": ["s1"]},
                                                       "sessions": {"s1": {"agent_session_id": "x"}}}))
        path = self.write("## 用户原话\n- x\n", "# 聊天频道 discord:42 讨论原文\n\n")
        self.assertEqual(_source.append_new(str(self.tmp / "none.md"), "discord:42", "proj"), [])  # 没导过原话的旧交接不导
        past = time.time() - 600
        os.utime(_source.dump_path(path), (past, past))
        (sess / "proj_ab.history" / "s1.jsonl").write_text("\n".join(json.dumps(m, ensure_ascii=False) for m in [
            {"role": "user", "content": "（最新，回这条）\n上次导出前说的", "timestamp": (now - dt.timedelta(minutes=30)).isoformat()},
            {"role": "user", "content": "（最新，回这条）\n标题别动", "timestamp": (now - dt.timedelta(minutes=2)).isoformat()},
            {"role": "assistant", "content": "好，改副标题", "timestamp": (now - dt.timedelta(minutes=1)).isoformat()}]) + "\n")
        with patch.dict(os.environ, {"CC_DATA_DIR": str(self.tmp)}):
            fresh = _source.append_new(path, "discord:42", "proj")
            self.assertEqual([t for _, _, t in fresh], ["标题别动"])
            dump = Path(_source.dump_path(path)).read_text(encoding="utf-8")
            self.assertIn("# 追加：", dump)
            self.assertNotIn("好，改副标题", dump)  # 主角色的新话只留问句，这条没有问句
            self.assertIn(_source._LEAD_NONE, dump)
            self.assertIn("好，改副标题", Path(_source.lead_path(path)).read_text(encoding="utf-8"))  # 全文在她那份里
            self.assertNotIn("上次导出前说的", dump)
            self.assertEqual(_source.append_new(path, "discord:42", "proj"), [])  # 再跑不重复导
        self.assertIn(("", "x"), _source.user_words(path))
        self.assertIn("标题别动", [t for _, t in _source.user_words(path)])


if __name__ == "__main__":
    unittest.main()
