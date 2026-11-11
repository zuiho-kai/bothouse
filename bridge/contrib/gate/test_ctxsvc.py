"""ctxsvc 查询清洗、推页格式、wiki 路径可配的测试，不加载模型：python3 -I contrib/gate/test_ctxsvc.py"""
import re
import json, sys, tempfile, unittest
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


def vps_page(d):
    """make_wiki 里 vps.md 那页推出来的样子：desc 照旧，另带 head/sep/rows，rows 的 id 是行尾编号（ctxsvc.only_new 按它去重）。"""
    row = "6: 代理端口 7890" + ctxsvc.exp_tag("infra/vps.md", "- 代理端口 7890")
    return {"path": (d / "infra/vps.md").as_posix(), "desc": "VPS 一览 | " + row,
            "head": "VPS 一览", "sep": " | ", "rows": [{"id": "#9fbdf5b7eb", "text": row, "group": ""}]}


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
        # 推送记录写进临时目录；没装 memvote 时不附投票提示（投票和画像、经验的推送在下面单独测）
        exp = tempfile.TemporaryDirectory()
        self.addCleanup(exp.cleanup)
        for k, v in (("EXP", Path(exp.name)), ("MEMVOTE", Path(exp.name) / "none.py"), ("PROFILE", "")):
            p = patch.object(ctxsvc, k, v)
            p.start()
            self.addCleanup(p.stop)
        if ctxsvc.lead:  # 这里只测 wiki 页；主角色工作手册的注入在 test_lead_playbook.py
            self.old_pb, ctxsvc.lead.PLAYBOOK = ctxsvc.lead.PLAYBOOK, None

    def tearDown(self):
        ctxsvc.WIKI, ctxsvc._idx = self.old, {}
        ctxsvc.BOTS, ctxsvc._bots_src = None, None
        ctxsvc.board = self.old_board
        if ctxsvc.lead:
            ctxsvc.lead.PLAYBOOK = self.old_pb

    def test_query_reply_uses_own_words(self):
        # 自己的话够长：引用块不参与检索，语气词去掉；短回复（「对」「继续」）仍带引用当上下文
        own = REPLY.strip()[REPLY.strip().rfind("]\n") + 2:].strip()
        want = ctxsvc.denoise(own)
        self.assertEqual(ctxsvc.query(REPLY), want)
        self.assertEqual(ctxsvc.query("（队友状态，系统自动附上，不用回应）\n- 写手：在忙\n\n" + REPLY), want)
        self.assertNotIn("[replying to", want)
        short = "[replying to 主管: 没卡死，一直在干活]\n继续"
        self.assertEqual(ctxsvc.query(short), short)

    def test_query_drops_swear_words(self):
        self.assertEqual(ctxsvc.query("推送的一坨屎").strip(), "推送的")
        self.assertEqual(ctxsvc.query("操作步骤"), "操作步骤")  # 单字「操」不删
        self.assertEqual(ctxsvc.query("傻逼"), "傻逼")  # 整句只有骂词：原样搜

    def test_evidence_lines_not_items(self):
        self.assertFalse(ctxsvc.is_item("  - 10-31 17:46 #频道「你重新自查一下，还有什么问题」"))
        self.assertFalse(ctxsvc.is_item("    - 11-09 8f75cea9「你就说三条，然后具体描述呢」"))
        self.assertTrue(ctxsvc.is_item("- 10-31 用户定：整套自查一次修完、一起汇报"))
        self.assertTrue(ctxsvc.is_item("  - 实现在 score_night.py，备份 bak-1107"))

    def test_with_prev_rare_content_words_only(self):
        with patch.object(ctxsvc, "rare_toks", lambda t, n=ctxsvc.PREV_TOKS: "美股 推荐"):
            self.assertEqual(ctxsvc.with_prev("妖股追涨", ["为什么没看你推荐美股"]), "妖股追涨 美股 推荐")
        self.assertTrue(ctxsvc.FRAG_CH.search("么没") and ctxsvc.FRAG_CH.search("你推"))
        self.assertFalse(ctxsvc.FRAG_CH.search("美股"))

    def test_bridge_messages_not_user(self):
        for t in ("现在是整点，想想爸爸", "接着做 #1474 注入对照", "橘 额度冷却，现在由你接手：#1", "你把活标成完成了"):
            self.assertFalse(ctxsvc.exp_is_user(t), t)
        self.assertTrue(ctxsvc.exp_is_user("接着做这个吧"))

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
            self.assertEqual(got, {"wiki": [vps_page(Path(d))]})

    def test_utf8_wiki_with_cp936_default(self):
        read_text = Path.read_text

        def cp936_read_text(path, encoding=None, errors=None, **kwargs):
            return read_text(path, encoding=encoding or "cp936", errors=errors, **kwargs)

        with tempfile.TemporaryDirectory() as d:
            make_wiki(d)
            ctxsvc.WIKI, ctxsvc._idx = Path(d), {}
            # Emulate the default before pathlib resolves it; works on Python 3.9 and in UTF-8 mode.
            with patch.object(Path, "read_text", cp936_read_text):
                got = ctxsvc.match_wiki("代理端口多少")
            self.assertEqual(got, [vps_page(Path(d))])

    def test_utf8_bom_preserves_description(self):
        with tempfile.TemporaryDirectory() as d:
            make_wiki(d, encoding="utf-8-sig")
            ctxsvc.WIKI, ctxsvc._idx = Path(d), {}
            got = ctxsvc.match_wiki("代理端口多少")
            self.assertEqual(got, [vps_page(Path(d))])

    def test_only_new_by_entry_id_and_epoch(self):
        # 去重只在 ctxsvc 按（key, bot, epoch）记条目编号（用户 11-03「按标题为粒度…出现过就不再推这个标题，除非开了新会话」）：
        # 同页的新条照推，推过的条同一代号不再推，换代号整页重推
        with tempfile.TemporaryDirectory() as d:
            make_wiki(d)
            ctxsvc.WIKI, ctxsvc._idx = Path(d), {}
            req = {"key": "discord:only-new", "bot": "a", "text": "代理端口多少", "epoch": "e1"}
            first = vps_page(Path(d))
            self.assertEqual(ctxsvc.context(req), {"wiki": [first]})
            with (Path(d) / "infra" / "vps.md").open("a", encoding="utf-8") as f:
                f.write("- 代理端口 7891 备用\n")
            ctxsvc._idx = {}
            row = "7: 代理端口 7891 备用" + ctxsvc.exp_tag("infra/vps.md", "- 代理端口 7891 备用")
            new = {"id": row.rpartition(" [")[2][:-1], "text": row, "group": ""}
            self.assertEqual(ctxsvc.context(req), {"wiki": [dict(first, desc="VPS 一览 | " + row, rows=[new])]},
                             "同页的新条照推，推过的不带")
            self.assertEqual(ctxsvc.context(req), {"wiki": []}, "同一代号：推过的不再推")
            self.assertEqual(ctxsvc.context(dict(req, bot="b"))["wiki"][0]["rows"], first["rows"] + [new], "别的角色另记")
            self.assertEqual(ctxsvc.context(dict(req, epoch="e2")), {"wiki": [dict(first, desc=first["desc"] + " | " + row,
                                                                               rows=first["rows"] + [new])]},
                             "新会话代号：整页重推")

    def test_whole_blocks_become_catalog_and_changes_push_only_changed_lines(self):
        # 用户 11-04「做」：整块正文的材料只推「标题 — 一句话 [#编号]」，正文按编号取；内容变了只补变的行
        body = "说明这块是什么\n" + "\n".join(f"- 第 {i} 条做法，写得比较长一点免得太短" for i in range(12))
        req = {"key": "discord:doc", "bot": "a", "epoch": "d1"}
        got = ctxsvc.only_new({"wiki": [{"path": "【常驻做法 abc123】", "desc": body}]}, req)["wiki"]
        self.assertEqual([w["path"] for w in got], ["【取正文】", "【常驻做法 abc123】"])
        self.assertIn("说明这块是什么（全文 13 行）", got[1]["desc"])
        cid = re.search(r"\[#([0-9a-f]{8})\]$", got[1]["desc"]).group(1)
        self.assertIn("第 11 条做法", (ctxsvc.store_dir() / f"{cid}.md").read_text(encoding="utf-8"), "正文存进正文库")
        self.assertEqual(ctxsvc.only_new({"wiki": [{"path": "【常驻做法 abc123】", "desc": body}]}, req)["wiki"], [], "不变不重推")
        changed = body.replace("第 3 条做法", "第 3 条做法改过")
        got = ctxsvc.only_new({"wiki": [{"path": "【常驻做法 def456】", "desc": changed}]}, req)["wiki"]
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["path"], "【常驻做法 有变动】")
        self.assertEqual(got[0]["desc"].split("\n")[1:], ["- 第 3 条做法改过，写得比较长一点免得太短"], "只补改了的那行")
        self.assertIn("删了 1 行", got[0]["desc"])
        self.assertEqual([(w["path"], w["desc"]) for w in ctxsvc.only_new({"wiki": [{"path": "【短块】", "desc": "短"}]}, req)["wiki"]],
                         [("【短块】", "短")], "短块原样给")

    def test_profile_pushed_whole_not_catalog(self):
        # #1318：懂你画像整页推（折成标题角色不取，11-10 隔离实测新手照样只拿到一句话）；同一版一个会话只推一次
        body = "这条消息是他发的\n" + "\n".join(f"- 他刚入行，讲东西多举例子第 {i} 条，写长一点免得太短" for i in range(8))
        req = {"key": "cloud_web:room-1", "bot": "", "epoch": "p1"}
        item = {"path": "【懂你 阿博 04b176】", "desc": body}
        got = ctxsvc.only_new({"wiki": [item]}, req)["wiki"]
        self.assertEqual([w["path"] for w in got], ["【懂你 阿博 04b176】"], "不加【取正文】，不折")
        self.assertIn("第 7 条", got[0]["desc"])
        self.assertEqual(ctxsvc.only_new({"wiki": [item]}, req)["wiki"], [], "同一版不重推")

    def test_board_pushed_whole_not_catalog(self):
        # #1372：任务板整块推（11-10 agentm 板上写着「已启动 GPU3/6」，折成标题后主角色看不到，用户问进度它去服务器重查）
        body = "本频道的事和等用户的事（接手前先看这里；增改结束用 board 命令）\n" + "\n".join(
            f"#4{i} 两PR联合分析 · 实际双卡任务已启动GPU3/6；远端PID522193；导入初始化中，尚无采样数据" for i in range(3))
        req = {"key": "discord:1569261647846178877", "bot": "", "epoch": "b1"}
        item = {"path": "【任务板 bd3c00】", "desc": body}
        got = ctxsvc.only_new({"wiki": [item]}, req)["wiki"]
        self.assertEqual([w["path"] for w in got], ["【任务板 bd3c00】"], "不加【取正文】，不折")
        self.assertIn("已启动GPU3/6", got[0]["desc"])
        self.assertEqual(ctxsvc.only_new({"wiki": [item]}, req)["wiki"], [], "同一版不重推")

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
            out = ctxsvc.context({"text": "代理端口多少", "bot": "proj-a"})["wiki"]
            got = [w["path"] for w in out]
            self.assertEqual(got[0], (main / "notes/port.md").as_posix())
            self.assertTrue(1 < len(got) <= 1 + ctxsvc.TOP_PAGES)
            self.assertTrue(all(p.startswith(wa.as_posix()) for p in got[1:]))
            self.assertEqual(sum(len(w["rows"]) for w in out), ctxsvc.TURN_ROWS, "一轮最多推 TURN_ROWS 条")

    def test_turn_cap_and_no_heading(self):
        with tempfile.TemporaryDirectory() as d:
            main, wa, _ = self._team(d)
            (wa / "notes" / "h.md").write_text("# 代理端口\n## 代理端口 现状\n" + "".join(f"- 代理端口 7890 第{i}条说明\n" for i in range(9)), encoding="utf-8")
            req = {"text": "代理端口多少", "bot": "proj-a", "key": "k:cap", "epoch": "e1"}
            out = ctxsvc.context(req)["wiki"]
            texts = [r["text"] for w in out for r in w.get("rows", [])]
            self.assertEqual(len(texts), ctxsvc.TURN_ROWS)
            self.assertFalse(any("#" in t.split(":", 1)[1].split("[")[0] for t in texts), texts)
            again = ctxsvc.context(req)["wiki"]  # 第一轮超额没推的，下一轮接着推
            self.assertTrue(again and all(r["text"] not in texts for w in again for r in w.get("rows", [])))

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


    def test_dsh_member_role_wiki(self):
        with tempfile.TemporaryDirectory() as d:
            main, wa, _ = self._team(d)
            # DSH 成员：bots.json 键是裸 id（core/setup_dsh_wiki.go），/context 带来的是 dsh:<id>（dsh/collab/gate-context.mjs）
            ctxsvc.BOTS.write_text(json.dumps({"m-x": {"kind": "dsh", "workdir": str(Path(d) / "a-work")}}), encoding="utf-8")
            ctxsvc._bots_src = None
            got = [w["path"] for w in ctxsvc.context({"text": "代理端口多少", "bot": "dsh:m-x"})["wiki"]]
            self.assertEqual(got, [(main / "notes/port.md").as_posix(), (wa / "notes/port.md").as_posix()])

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
