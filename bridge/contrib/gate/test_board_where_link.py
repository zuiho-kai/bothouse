"""#1350：路径栏原来是交接文件时，board update 给 PR 链接不覆盖交接路径；ws-pass 按交接仍找得到条目。"""
import importlib.machinery, importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = tempfile.mkdtemp(prefix="board-where-link-")
os.environ["BOARD_DIR"] = TMP
os.environ["BOARD_PR_REPO"] = "zuiho-kai/bothouse"
sys.path.insert(0, str(HERE))
import board  # noqa: E402


def load_ws_pass():
    sys.path.insert(0, str(HERE.parent / "lead"))
    ld = importlib.machinery.SourceFileLoader("ws_pass", str(HERE.parent / "lead" / "ws-pass"))
    spec = importlib.util.spec_from_loader("ws_pass", ld)
    m = importlib.util.module_from_spec(spec)
    ld.exec_module(m)
    return m


class WhereLink(unittest.TestCase):
    def setUp(self):
        self.notes = os.path.join(TMP, "handoff-x.md")
        Path(self.notes).write_text("# x\n", encoding="utf-8")
        Path(TMP, "board.jsonl").write_text(json.dumps(
            {"id": 7, "what": "活", "where": self.notes, "status": "进行中", "who": "工作区4橘", "at": "11-10 12:00"},
            ensure_ascii=False) + "\n", encoding="utf-8")

    def test_pr_link_keeps_handoff(self):
        url = "https://github.com/zuiho-kai/bothouse/pull/1487"
        board.update(7, "已交回待验收：PR #1487 等 CI", url)
        it = next(i for i in board.items() if i["id"] == 7)
        self.assertEqual(it["where"], self.notes)
        self.assertEqual(it["where_link"], url)
        self.assertEqual(board._where_prs(it), {1487})  # PR 合了照样自动收尾
        self.assertIn(url, board.fmt(it))
        self.assertEqual(load_ws_pass().board_id({}, self.notes), 7)

    def test_file_to_file_still_replaces(self):
        other = os.path.join(TMP, "handoff-y.md")
        Path(other).write_text("# y\n", encoding="utf-8")
        board.update(7, "改交接", other)
        it = next(i for i in board.items() if i["id"] == 7)
        self.assertEqual(it["where"], other)
        self.assertNotIn("where_link", it)


if __name__ == "__main__":
    unittest.main()
