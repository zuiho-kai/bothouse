"""ctxsvc 查询清洗、推页格式、wiki 路径可配的测试，不加载模型：python3 -I contrib/gate/test_ctxsvc.py"""
import sys, tempfile, unittest
from pathlib import Path, PureWindowsPath
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxsvc

REPLY = "[replying to 主管: 没卡死，一直在干活]\n正在读 engine.go\n\n你给他插入一下啊"


def make_wiki(d, encoding="utf-8"):
    p = Path(d) / "infra"
    p.mkdir()
    (p / "README.md").write_text("x", encoding="utf-8")
    (p / "vps.md").write_text("---\nname: vps\ndescription: VPS 一览\n---\n# T\n- 代理端口 7890\n", encoding=encoding)
    (Path(d) / "data").mkdir()   # 没有 README.md 的目录不算 wiki 页
    (Path(d) / "data" / "x.md").write_text("- 代理端口 7890 也在这里\n", encoding="utf-8")


class T(unittest.TestCase):
    def setUp(self):
        self.old = ctxsvc.WIKI
        # Windows temp directories may be inside the real home; keep path assertions independent.
        home = tempfile.TemporaryDirectory()
        self.addCleanup(home.cleanup)
        home_patch = patch.object(Path, "home", return_value=Path(home.name))
        home_patch.start()
        self.addCleanup(home_patch.stop)
        # 这里只测 wiki 页；任务板注入在 test_board.py，置空免得读到本机默认 BOARD_DIR 的板子
        self.old_board, ctxsvc.board = ctxsvc.board, None
        if ctxsvc.lead:  # 这里只测 wiki 页；主角色工作手册的注入在 test_lead_playbook.py
            self.old_pb, ctxsvc.lead.PLAYBOOK = ctxsvc.lead.PLAYBOOK, None

    def tearDown(self):
        ctxsvc.WIKI, ctxsvc._idx = self.old, None
        ctxsvc.board = self.old_board
        if ctxsvc.lead:
            ctxsvc.lead.PLAYBOOK = self.old_pb

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
            self.assertEqual(got, {"wiki": [{"path": (Path(d) / "infra/vps.md").as_posix(),
                                             "desc": "VPS 一览 | 6: - 代理端口 7890"}]})

    def test_utf8_wiki_with_cp936_default(self):
        read_text = Path.read_text

        def cp936_read_text(path, encoding=None, errors=None, **kwargs):
            return read_text(path, encoding=encoding or "cp936", errors=errors, **kwargs)

        with tempfile.TemporaryDirectory() as d:
            make_wiki(d)
            ctxsvc.WIKI, ctxsvc._idx = Path(d), None
            # Emulate the default before pathlib resolves it; works on Python 3.9 and in UTF-8 mode.
            with patch.object(Path, "read_text", cp936_read_text):
                got = ctxsvc.match_wiki("代理端口多少")
            self.assertEqual(got, [{"path": (Path(d) / "infra/vps.md").as_posix(),
                                   "desc": "VPS 一览 | 6: - 代理端口 7890"}])

    def test_utf8_bom_preserves_description(self):
        with tempfile.TemporaryDirectory() as d:
            make_wiki(d, encoding="utf-8-sig")
            ctxsvc.WIKI, ctxsvc._idx = Path(d), None
            got = ctxsvc.match_wiki("代理端口多少")
            self.assertEqual(got, [{"path": (Path(d) / "infra/vps.md").as_posix(),
                                   "desc": "VPS 一览 | 6: - 代理端口 7890"}])

    def test_wiki_off_or_missing(self):
        ctxsvc.WIKI, ctxsvc._idx = None, None
        self.assertEqual(ctxsvc.context({"text": "代理端口"}), {"wiki": []})
        ctxsvc.WIKI = Path(tempfile.mkdtemp()) / "nope"
        self.assertEqual(ctxsvc.context({"text": "代理端口"}), {"wiki": []})

    def test_home_shown_as_tilde(self):
        ctxsvc.WIKI = Path.home() / "wiki-test-not-created"
        self.assertEqual(ctxsvc._shown("a/b.md"), "~/wiki-test-not-created/a/b.md")

    def test_windows_paths_shown_with_forward_slashes(self):
        with patch.object(ctxsvc.Path, "home", return_value=PureWindowsPath("C:/Users/test")):
            for root, expected in (
                ("C:/Users/test/wiki", "~/wiki/infra/vps.md"),
                ("C:/Users/test-other/wiki", "C:/Users/test-other/wiki/infra/vps.md"),
                ("D:/wiki", "D:/wiki/infra/vps.md"),
            ):
                with self.subTest(root=root):
                    ctxsvc.WIKI = PureWindowsPath(root)
                    self.assertEqual(ctxsvc._shown("infra/vps.md"), expected)


if __name__ == "__main__":
    unittest.main()
