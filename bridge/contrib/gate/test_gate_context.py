"""gate.py 的 /context 路由和团队文件（不加载模型：用假 scorer 顶替）：python3 -I contrib/gate/test_gate_context.py"""
import importlib, json, os, sys, tempfile, threading, types, unittest, urllib.error, urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load_gate(team=None, wiki=None, model="fake"):
    fake = types.ModuleType("scorer")

    class Scorer:
        def __init__(self, *a, **k):
            pass

        def prepare(self, *a, **k):
            return self

    fake.Scorer = Scorer
    sys.modules["scorer"] = fake
    os.environ["GATE_SETUP_DIR"] = tempfile.mkdtemp()  # 不读本机 ~/.cc-connect 里向导写的文件
    os.environ.pop("GATE_JEV", None)
    if model:
        os.environ["GATE_MODEL"] = model  # 没有 jev 时用显式的本机模型打分；拿到的是上面的假 scorer
    else:
        os.environ.pop("GATE_MODEL", None)  # 没 jev 也没本机模型：不打分，只供 /context、/lead
    for k, v in (("GATE_TEAM", team), ("GATE_WIKI", wiki)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    for m in ("gate", "ctxsvc"):
        sys.modules.pop(m, None)
    g = importlib.import_module("gate")
    g.lead.PLAYBOOK = None  # 这里只测 wiki 页；主角色工作手册的注入在 test_lead_playbook.py
    return g


class T(unittest.TestCase):
    def test_default_team_is_example(self):
        g = load_gate()
        ex = json.loads((HERE / "team.example.json").read_text(encoding="utf-8"))
        self.assertEqual(g.LEAD, ex["lead"]["name"])
        self.assertEqual(set(g.SUBS), set(ex["subs"]))
        self.assertNotIn("橘", g.PROMPT)   # 提示词里的占位名字换成了当前团队

    def test_team_file_and_context_route(self):
        d = Path(tempfile.mkdtemp())
        (d / "team.json").write_text(json.dumps({"lead": {"name": "C酱"}, "subs": {"gge": {"name": "G哥"}}}))
        w = d / "wiki"
        (w / "infra").mkdir(parents=True)
        (w / "infra" / "README.md").write_text("x", encoding="utf-8")
        (w / "infra" / "vps.md").write_text("---\ndescription: VPS 一览\n---\n- 代理端口 7890\n", encoding="utf-8")
        g = load_gate(team=str(d / "team.json"), wiki=str(w))
        self.assertEqual((g.LEAD, g.SUBS), ("C酱", {"gge": "G哥"}))
        srv = ThreadingHTTPServer(("127.0.0.1", 0), g.H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}/context",
                                         json.dumps({"key": "discord:1", "text": "代理端口多少"}).encode(),
                                         {"Content-Type": "application/json"})
            out = json.loads(urllib.request.urlopen(req, timeout=5).read())
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertEqual(out, {"wiki": [{"path": (w / "infra/vps.md").as_posix(), "desc": "VPS 一览 | 4: - 代理端口 7890"}]})

    def test_busy_mention_lead_pause_aborts(self):  # 主角色被 @ 或叫名字、正忙、「暂停」→ abort；不忙 → reply
        g = load_gate()
        me = g.lead.current()
        g.tasks[me] = types.SimpleNamespace(score=lambda *a, **k: types.SimpleNamespace(choice=3, probs=[0, 0, 0, 1]))
        d = lambda c, m, b: g.decide({"content": c, "mentioned": m, "busy": b, "session_key": "t:1"}, me)[0]
        self.assertEqual(d("暂停", True, True), "abort")
        self.assertEqual(d(g.NAMES[me][0] + " 暂停", False, True), "abort")
        self.assertEqual(d("暂停", True, False), "reply")

    def test_no_jev_serves_context_and_lead_not_decide(self):
        """干净机器没填 jev：gate 照样起，/context 有 wiki，/lead 能用，/decide 回 503 让 cc-connect 按 gate_fallback 兜底。"""
        d = Path(tempfile.mkdtemp())
        w = d / "wiki"
        (w / "infra").mkdir(parents=True)
        (w / "infra" / "README.md").write_text("x", encoding="utf-8")
        (w / "infra" / "vps.md").write_text("---\ndescription: VPS 一览\n---\n- 代理端口 7890\n", encoding="utf-8")
        g = load_gate(wiki=str(w), model="")
        self.assertEqual(g.SCORER_KIND, "none")
        srv = ThreadingHTTPServer(("127.0.0.1", 0), g.H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()

        def post(path, body):
            req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}{path}", json.dumps(body).encode(),
                                         {"Content-Type": "application/json"})
            try:
                r = urllib.request.urlopen(req, timeout=5)
                return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read() or b"{}")
        try:
            code, ctx = post("/context", {"key": "discord:1", "text": "代理端口多少"})
            self.assertEqual(code, 200)
            self.assertEqual([x["path"] for x in ctx["wiki"]], [(w / "infra/vps.md").as_posix()])
            code, ld = post("/lead", {"action": "get"})
            self.assertEqual((code, ld["ok"]), (200, True))
            code, _ = post("/decide", {"content": "你好", "mentioned": False, "busy": False})
            self.assertEqual(code, 503)
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
