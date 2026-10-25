"""ctxsvc 查询清洗、推页格式、wiki 路径可配的测试，不加载模型：python3 -I contrib/gate/test_ctxsvc.py"""
import json, sys, tempfile, unittest
from pathlib import Path, PureWindowsPath
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxsvc

REPLY = "[replying to 主管: 没卡死，一直在干活]\n正在读 engine.go\n\n你给他插入一下啊"


def make_wiki(d):
    p = Path(d) / "infra"
    p.mkdir()
    (p / "README.md").write_text("x", encoding="utf-8")
    (p / "vps.md").write_text("---\nname: vps\ndescription: VPS 一览\n---\n# T\n- 代理端口 7890\n", encoding="utf-8")
    (Path(d) / "data").mkdir()   # 没有 README.md 的目录不算 wiki 页
    (Path(d) / "data" / "x.md").write_text("- 代理端口 7890 也在这里\n", encoding="utf-8")


class T(unittest.TestCase):
    def setUp(self):
        self.old = ctxsvc.WIKI
        # 这里只测 wiki 页；任务板注入在 test_board.py，置空免得读到本机默认 BOARD_DIR 的板子
        self.old_board, ctxsvc.board = ctxsvc.board, None
        if ctxsvc.lead:  # 这里只测 wiki 页；主角色工作手册的注入在 test_lead_playbook.py
            self.old_pb, ctxsvc.lead.PLAYBOOK = ctxsvc.lead.PLAYBOOK, None

    def tearDown(self):
        ctxsvc.WIKI, ctxsvc._idx = self.old, {}
        ctxsvc.BOTS, ctxsvc._bots_src = None, None
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
            ctxsvc.WIKI, ctxsvc._idx = Path(d), {}
            got = ctxsvc.context({"key": "discord:1", "text": "代理端口多少"})
            self.assertEqual(got, {"wiki": [{"path": (Path(d) / "infra/vps.md").as_posix(),
                                             "desc": "VPS 一览 | 6: - 代理端口 7890"}]})

    def test_utf8_wiki_with_cp936_default(self):
        with tempfile.TemporaryDirectory() as d:
            make_wiki(d)
            ctxsvc.WIKI, ctxsvc._idx = Path(d), {}
            # Emulate a Chinese Windows default on UTF-8 CI hosts too; explicit encodings still win.
            with patch("io.text_encoding", side_effect=lambda encoding, *args: encoding or "cp936"):
                got = ctxsvc.match_wiki("代理端口多少")
            self.assertEqual(got, [{"path": (Path(d) / "infra/vps.md").as_posix(),
                                   "desc": "VPS 一览 | 6: - 代理端口 7890"}])

    def test_wiki_off_or_missing(self):
        ctxsvc.WIKI, ctxsvc._idx = None, {}
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

    def _team(self, d):
        """主 wiki + bots.json 里两个同模型角色 a、b 各自的 wiki（a 用 workdir 默认路径，b 用 "wiki" 键）。"""
        d = Path(d)
        main, wa, wb = d / "main", d / "a-work" / "wiki", d / "b-wiki"
        for w, word in ((main, "主库"), (wa, "甲库"), (wb, "乙库")):
            (w / "notes").mkdir(parents=True)
            (w / "notes" / "README.md").write_text("x", encoding="utf-8")
            (w / "notes" / "port.md").write_text(f"---\ndescription: {word}\n---\n- 代理端口 7890 {word}\n", encoding="utf-8")
        bots = d / "bots.json"
        bots.write_text(json.dumps({"proj-a": {"kind": "claudecode", "workdir": str(d / "a-work")},
                                    "proj-b": {"kind": "claudecode", "workdir": str(d / "b-work"), "wiki": str(wb)}}),
                        encoding="utf-8")
        ctxsvc.WIKI, ctxsvc.BOTS, ctxsvc._idx, ctxsvc._bots_src = main, bots, {}, None
        return main, wa, wb

    def test_role_wiki_own_only_main_first(self):
        with tempfile.TemporaryDirectory() as d:
            main, wa, wb = self._team(d)
            got = [w["path"] for w in ctxsvc.context({"key": "discord:1", "text": "代理端口多少", "bot": "proj-a"})["wiki"]]
            self.assertEqual(got, [(main / "notes/port.md").as_posix(), (wa / "notes/port.md").as_posix()])
            got = [w["path"] for w in ctxsvc.context({"key": "discord:1", "text": "代理端口多少", "bot": "proj-b"})["wiki"]]
            self.assertEqual(got, [(main / "notes/port.md").as_posix(), (wb / "notes/port.md").as_posix()])
            self.assertEqual(set(ctxsvc._idx), {main, wa, wb})  # 每个根各自缓存，交替来问不重建

    def test_main_pages_not_crowded_out(self):
        with tempfile.TemporaryDirectory() as d:
            main, wa, _ = self._team(d)
            for i in range(5):  # 角色库命中更多更密，主 wiki 的页也照样在、在前
                (wa / "notes" / f"p{i}.md").write_text("- 代理端口 代理端口 代理端口 7890\n" * 3, encoding="utf-8")
            got = [w["path"] for w in ctxsvc.context({"text": "代理端口多少", "bot": "proj-a"})["wiki"]]
            self.assertEqual(got[0], (main / "notes/port.md").as_posix())
            self.assertEqual(len(got), 1 + ctxsvc.TOP_PAGES)
            self.assertTrue(all(p.startswith(wa.as_posix()) for p in got[1:]))

    def test_no_role_wiki_main_only(self):
        with tempfile.TemporaryDirectory() as d:
            main, _, _ = self._team(d)
            want = [(main / "notes/port.md").as_posix()]
            for bot in ("", "proj-unknown"):  # bot 空或不在 bots.json：只查主 wiki
                got = [w["path"] for w in ctxsvc.context({"text": "代理端口多少", "bot": bot})["wiki"]]
                self.assertEqual(got, want, bot)
            ctxsvc.BOTS, ctxsvc._bots_src = Path(d) / "nope.json", None  # 没有 bots.json
            got = [w["path"] for w in ctxsvc.context({"text": "代理端口多少", "bot": "proj-a"})["wiki"]]
            self.assertEqual(got, want)
            ctxsvc.BOTS = None
            self.assertEqual([w["path"] for w in ctxsvc.match_wiki("代理端口多少")], want)  # 终端 hook 的调法不变

    def test_same_wiki_searched_once(self):
        with tempfile.TemporaryDirectory() as d:
            main, _, _ = self._team(d)
            link = Path(d) / "main-link"
            link.symlink_to(main, target_is_directory=True)
            want = [(main / "notes/port.md").as_posix()]
            for w in (str(main), str(main) + "/", str(link)):  # 角色 wiki 就是主 wiki（原路径、带斜杠、软链接）
                with self.subTest(wiki=w):
                    ctxsvc.BOTS.write_text(json.dumps({"lead": {"workdir": d, "wiki": w}}), encoding="utf-8")
                    ctxsvc._bots_src = None
                    got = [x["path"] for x in ctxsvc.context({"text": "代理端口多少", "bot": "lead"})["wiki"]]
                    self.assertEqual(got, want)


    def test_wiki_off_skips_role_wiki(self):
        with tempfile.TemporaryDirectory() as d:
            self._team(d)
            ctxsvc.WIKI = None  # GATE_WIKI=off 或空：主 wiki 和角色 wiki 都不查
            for bot in ("proj-a", "proj-b"):
                self.assertEqual(ctxsvc.context({"text": "代理端口多少", "bot": bot}), {"wiki": []}, bot)

    def test_bad_role_wiki_field_main_only(self):
        with tempfile.TemporaryDirectory() as d:
            main, _, _ = self._team(d)
            want = [(main / "notes/port.md").as_posix()]
            for e in ({"wiki": 5}, {"workdir": 7}, {"wiki": ["x"]}):  # bots.json 手改坏了：跳过角色 wiki，主 wiki 照查
                with self.subTest(entry=e):
                    ctxsvc.BOTS.write_text(json.dumps({"a": e}), encoding="utf-8")
                    ctxsvc._bots_src = None
                    got = [x["path"] for x in ctxsvc.context({"text": "代理端口多少", "bot": "a"})["wiki"]]
                    self.assertEqual(got, want)


if __name__ == "__main__":
    unittest.main()
