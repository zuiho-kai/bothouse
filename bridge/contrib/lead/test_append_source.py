"""ws-handoff append_source：交接自动附聊天频道讨论原文（用户 11-21「我是说之后给工作区都要这样做」）。
桥把会话记录挪到 sessions/<项目>_*.history/<会话 id>.jsonl 后，只读内嵌 history 的旧写法导出是 0 条。"""
import datetime as dt, json, os, sys, tempfile, unittest
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
_loader = SourceFileLoader("ws_handoff", str(HERE / "ws-handoff"))
wsh = module_from_spec(spec_from_loader("ws_handoff", _loader))
_loader.exec_module(wsh)


class AppendSourceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        now = dt.datetime.now().astimezone()
        self.t1 = (now - dt.timedelta(minutes=20)).isoformat()
        self.t2 = (now - dt.timedelta(minutes=19)).isoformat()
        old = (now - dt.timedelta(days=5)).isoformat()
        sess = self.tmp / "sessions"
        (sess / "proj_ab.history").mkdir(parents=True)
        (sess / "proj_ab.json").write_text(json.dumps({
            "user_sessions": {"discord:42": ["s1", "s2"]},
            "sessions": {"s1": {"agent_session_id": "x"},
                         "s2": {"history": [{"role": "user", "content": "内嵌的旧条", "timestamp": self.t2}]}}}))
        (sess / "proj_ab.history" / "s1.jsonl").write_text("\n".join(json.dumps(m, ensure_ascii=False) for m in [
            {"role": "user", "content": "[17:50] zuiho: 都做吧", "timestamp": self.t1},
            {"role": "assistant", "content": "好，我交出去。要不要连首页一起？", "timestamp": self.t1},
            {"role": "user", "content": "窗口外的旧话", "timestamp": old}]) + "\nnot json\n")
        self.handoff = self.tmp / "h.md"
        self.handoff.write_text("# 交接\n## 用户原话\n- x\n## 总目标\ny\n", encoding="utf-8")
        os.environ["CC_DATA_DIR"] = str(self.tmp)

    def test_reads_history_dir_and_keeps_lead_asks_only(self):
        dump = wsh.append_source(str(self.handoff), "discord:42", project="proj")
        self.assertTrue(dump)
        text = Path(dump).read_text(encoding="utf-8")
        self.assertIn("，3 条）", text)
        self.assertLess(text.index("都做吧"), text.index("要不要连首页一起？"))
        self.assertIn("都做吧", text)
        self.assertIn("内嵌的旧条", text)
        self.assertNotIn("窗口外的旧话", text)
        self.assertIn("主角色（程序只留了她问用户的问句）\n要不要连首页一起？\n", text)  # 主角色的话只留问句
        self.assertNotIn("好，我交出去", text)
        lead = Path(wsh._source.lead_path(str(self.handoff)))
        self.assertIn("主角色（只作参考）\n好，我交出去。要不要连首页一起？", lead.read_text(encoding="utf-8"))  # 全文另存
        h = self.handoff.read_text(encoding="utf-8")
        self.assertIn("讨论原文：", h)
        self.assertIn("主角色的话只留了她问用户的问句", h)
        self.assertIn(f"主角色的话全文：{lead}", h)


if __name__ == "__main__":
    unittest.main()
