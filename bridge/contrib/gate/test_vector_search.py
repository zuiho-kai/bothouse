"""向量一路（vector_search.py）的测试，不加载模型，向量服务用假的：python3 -I contrib/gate/test_vector_search.py"""
import json, sys, tempfile, threading, time, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctxsvc, vector_search as vector, wiki_search as search


def make_wiki(d):
    p = Path(d) / "infra"
    p.mkdir()
    (p / "README.md").write_text("x", encoding="utf-8")
    (p / "vps.md").write_text("---\nname: vps\ndescription: VPS 一览\n---\n# T\n- 代理端口 7890 在东京机器上\n"
                              "- 东京机器的代理挂了先重启 clash\n- 家里 NAS 的备份每晚三点跑\n", encoding="utf-8")


class Fake:
    """假向量服务：/search 按 self.order（行文本）回键；/sync 记下收到的行。"""
    def __init__(self, ready=True):
        self.ready, self.order, self.rows, self.queries = ready, [], {}, []
        me = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path == "/sync":
                    me.rows = req["rows"]
                    out = {"ok": True}
                else:
                    me.queries.append(req["q"])
                    out = {"ready": me.ready, "ids": [vector.row_key(t) for t in me.order]}
                b = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def log_message(self, *a):
                pass
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"


class T(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.root = Path(d.name)
        make_wiki(self.root)
        self.idx = search.Index(self.root)
        vector._sent.clear()

    def wiki(self, q, need):
        exp = tempfile.TemporaryDirectory()
        self.addCleanup(exp.cleanup)
        with patch.object(ctxsvc, "WIKI", self.root), patch.object(ctxsvc, "_idx", {}), \
                patch.object(ctxsvc, "EXP", Path(exp.name)), patch.object(ctxsvc, "FORUM", None):
            return [h["desc"] for h in ctxsvc.match_wiki(q, need=need)]

    def test_off_is_keyword_only(self):
        # 开关关着（默认）：名单就是关键词的，推出来的和没有向量一路时一模一样
        with patch.object(vector, "URL", ""):
            self.assertEqual(vector.rank(self.idx, self.root, "东京 代理", "东京 代理", 10), self.idx.rank("东京 代理", 10))
            on = self.wiki("东京 代理", "东京 代理")
        with patch.object(ctxsvc, "vector", None):
            self.assertEqual(self.wiki("东京 代理", "东京 代理"), on)

    def test_on_merges_vector_list(self):
        # 开着：关键词一个词都不沾的行，向量排第一，也进名单（RRF 合并）；向量按这轮的话查，不带前两轮
        f = Fake()
        self.addCleanup(f.srv.shutdown)
        nas = vector.row_text("infra/vps.md", "- 家里 NAS 的备份每晚三点跑")
        f.order = [nas]
        with patch.object(vector, "URL", f.url):
            got = [self.idx.lines[i][2] for i in vector.rank(self.idx, self.root, "东京 代理 前两轮", "这轮", 10)]
        self.assertIn("- 家里 NAS 的备份每晚三点跑", got)
        self.assertEqual(f.queries, ["这轮"])
        kw = [self.idx.lines[i][2] for i in self.idx.rank("东京 代理 前两轮", 10)]
        self.assertNotIn("- 家里 NAS 的备份每晚三点跑", kw)
        # 两路都排前面的行在最前
        f.order = [vector.row_text("infra/vps.md", "- 东京机器的代理挂了先重启 clash"), nas]
        with patch.object(vector, "URL", f.url):
            top = self.idx.lines[vector.rank(self.idx, self.root, "东京 代理", "东京 代理", 10)[0]][2]
        self.assertEqual(top, "- 东京机器的代理挂了先重启 clash")
        # 全部行发给服务建表（后台发）
        for _ in range(50):
            if f.rows:
                break
            time.sleep(0.05)
        self.assertEqual(set(f.rows.values()), {vector.row_text(l[0], l[2]) for l in self.idx.lines})

    def test_not_ready_or_down_falls_back(self):
        # 表没建完、服务没起：这一轮只用关键词
        f = Fake(ready=False)
        self.addCleanup(f.srv.shutdown)
        f.order = [vector.row_text("infra/vps.md", "- 家里 NAS 的备份每晚三点跑")]
        kw = self.idx.rank("东京 代理", 10)
        with patch.object(vector, "URL", f.url):
            self.assertEqual(vector.rank(self.idx, self.root, "东京 代理", "东京 代理", 10), kw)
        with patch.object(vector, "URL", "http://127.0.0.1:1"):
            self.assertEqual(vector.rank(self.idx, self.root, "东京 代理", "东京 代理", 10), kw)


if __name__ == "__main__":
    unittest.main()
