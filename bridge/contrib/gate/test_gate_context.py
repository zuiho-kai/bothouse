"""gate.py 的 /context 路由和团队文件（不加载模型：用假 scorer 顶替）：python3 -I contrib/gate/test_gate_context.py"""
import importlib, json, os, sys, tempfile, threading, types, unittest, urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load_gate(team=None, wiki=None):
    fake = types.ModuleType("scorer")

    class Scorer:
        def __init__(self, *a, **k):
            pass

        def prepare(self, *a, **k):
            return self

    fake.Scorer = Scorer
    sys.modules["scorer"] = fake
    os.environ["GATE_SETUP_DIR"] = tempfile.mkdtemp()  # 不读本机 ~/.cc-connect 里向导写的文件
    for k, v in (("GATE_TEAM", team), ("GATE_WIKI", wiki)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    for m in ("gate", "ctxsvc"):
        sys.modules.pop(m, None)
    return importlib.import_module("gate")


class T(unittest.TestCase):
    def test_default_team_is_example(self):
        g = load_gate()
        ex = json.loads((HERE / "team.example.json").read_text())
        self.assertEqual(g.LEAD, ex["lead"]["name"])
        self.assertEqual(set(g.SUBS), set(ex["subs"]))
        self.assertNotIn("橘", g.PROMPT)   # 提示词里的占位名字换成了当前团队

    def test_team_file_and_context_route(self):
        d = Path(tempfile.mkdtemp())
        (d / "team.json").write_text(json.dumps({"lead": {"name": "C酱"}, "subs": {"gge": {"name": "G哥"}}}))
        w = d / "wiki"
        (w / "infra").mkdir(parents=True)
        (w / "infra" / "README.md").write_text("x")
        (w / "infra" / "vps.md").write_text("---\ndescription: VPS 一览\n---\n- 代理端口 7890\n")
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
        self.assertEqual(out, {"wiki": [{"path": str(w / "infra/vps.md"), "desc": "VPS 一览 | 4: - 代理端口 7890"}]})

    def test_busy_mention_lead_pause_aborts(self):  # 主角色被 @ 或叫名字、正忙、「暂停」→ abort；不忙 → reply
        g = load_gate()
        me = g.lead.current()
        g.tasks[me] = types.SimpleNamespace(score=lambda *a, **k: types.SimpleNamespace(choice=3, probs=[0, 0, 0, 1]))
        d = lambda c, m, b: g.decide({"content": c, "mentioned": m, "busy": b, "session_key": "t:1"}, me)[0]
        self.assertEqual(d("暂停", True, True), "abort")
        self.assertEqual(d(g.NAMES[me][0] + " 暂停", False, True), "abort")
        self.assertEqual(d("暂停", True, False), "reply")


if __name__ == "__main__":
    unittest.main()
