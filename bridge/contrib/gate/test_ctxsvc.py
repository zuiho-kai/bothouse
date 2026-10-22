"""ctxsvc 查询清洗、推页格式、wiki 路径可配的测试，不加载模型：python3 -I contrib/gate/test_ctxsvc.py"""
import sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxsvc

REPLY = "[replying to 主管: 没卡死，一直在干活]\n正在读 engine.go\n\n你给他插入一下啊"


def make_wiki(d):
    p = Path(d) / "infra"
    p.mkdir()
    (p / "README.md").write_text("x")
    (p / "vps.md").write_text("---\nname: vps\ndescription: VPS 一览\n---\n# T\n- 代理端口 7890\n")
    (Path(d) / "data").mkdir()   # 没有 README.md 的目录不算 wiki 页
    (Path(d) / "data" / "x.md").write_text("- 代理端口 7890 也在这里\n")


class T(unittest.TestCase):
    def setUp(self):
        self.old = ctxsvc.WIKI

    def tearDown(self):
        ctxsvc.WIKI, ctxsvc._idx = self.old, None

    def test_query_keeps_reply_quote(self):
        self.assertEqual(ctxsvc.query(REPLY), REPLY.strip())
        self.assertEqual(ctxsvc.query("（队友状态，系统自动附上，不用回应）\n- 写手：在忙\n\n" + REPLY), REPLY.strip())

    def test_query_drops_blocks(self):
        t = ("（队友状态，系统自动附上，不用回应）\n- 写手：在忙\n\n"
             "（可能相关的 wiki 页，需要时去读）\n- ~/wiki/infra/vps.md — VPS\n\n"
             "统计怎么空了")
        self.assertEqual(ctxsvc.query(t), "统计怎么空了")
        t = "（频道里你上次看到之后的消息）\n写手：代理挂了\n\n（最新，回这条）\n看看 gate"
        self.assertEqual(ctxsvc.query(t), "看看 gate")

    def test_match_wiki_format(self):
        with tempfile.TemporaryDirectory() as d:
            make_wiki(d)
            ctxsvc.WIKI, ctxsvc._idx = Path(d), None
            got = ctxsvc.context({"key": "discord:1", "text": "代理端口多少"})
            self.assertEqual(got, {"wiki": [{"path": str(Path(d) / "infra/vps.md"),
                                             "desc": "VPS 一览 | 6: - 代理端口 7890"}]})

    def test_wiki_off_or_missing(self):
        ctxsvc.WIKI, ctxsvc._idx = None, None
        self.assertEqual(ctxsvc.context({"text": "代理端口"}), {"wiki": []})
        ctxsvc.WIKI = Path(tempfile.mkdtemp()) / "nope"
        self.assertEqual(ctxsvc.context({"text": "代理端口"}), {"wiki": []})

    def test_home_shown_as_tilde(self):
        ctxsvc.WIKI = Path.home() / "wiki-test-not-created"
        self.assertEqual(ctxsvc._shown("a/b.md"), "~/wiki-test-not-created/a/b.md")

    def test_role_wiki_first_and_only_its_own(self):
        with tempfile.TemporaryDirectory() as d:
            old = ctxsvc.SETUP_DIR
            ctxsvc.SETUP_DIR, ctxsvc.WIKI, ctxsvc._idx = Path(d), None, None
            try:
                (Path(d) / "wikis" / "coder").mkdir(parents=True)
                make_wiki(Path(d) / "wikis" / "coder")
                (Path(d) / "wikis" / "writer").mkdir()
                own = ctxsvc.context({"text": "代理端口", "bot": "coder"})["wiki"]
                self.assertTrue(own and "wikis/coder/infra/vps.md" in own[0]["path"].replace("\\", "/"))
                self.assertEqual(ctxsvc.context({"text": "代理端口", "bot": "writer"})["wiki"], [])
            finally:
                ctxsvc.SETUP_DIR = old


if __name__ == "__main__":
    unittest.main()
