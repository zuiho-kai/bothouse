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
        g.sub_task = g.tasks[me]  # 忙时被叫按 SUB_PROMPT 判（busy_action），D = 要她停
        d = lambda c, m, b: g.decide({"content": c, "mentioned": m, "busy": b, "session_key": "t:1"}, me)[0]
        self.assertEqual(d("暂停", True, True), "abort")
        self.assertEqual(d(g.NAMES[me][0] + " 暂停", False, True), "abort")
        self.assertEqual(d("暂停", True, False), "reply")

    def test_busy_intent_combines_with_no_insert(self):
        """忙时按意思（sub_task 四选一）合成动作：要她停 → 打断；等她回话 → 插得进就照常、插不进（no_insert）就打断；
        补充 → 插话（插不进由 cc-connect 排队），不打断。用户 2026-10-30「我给你用jev，就是让你智能化」。"""
        g = load_gate()
        sub = next(iter(g.SUBS))
        pick = {}
        g.sub_task = types.SimpleNamespace(score=lambda text, **k: types.SimpleNamespace(choice=pick["c"], probs=[0] * 4))
        def d(c, no_insert, choice, content=None):
            pick["c"] = choice
            req = {"content": content or f"[replying to {g.SUBS[sub]}: 好]\n{c}", "mentioned": False, "busy": True,
                   "session_key": "t:1", "no_insert": no_insert}
            return g.decide_sub(req, sub)[0]
        self.assertEqual(d("怎么那么简单功能改那么久", True, 2), "abort")   # 催她、插不进：打断后回
        self.assertEqual(d("你卡在哪了，先回我", True, 2), "abort")
        self.assertEqual(d("你卡在哪了，先回我", False, 2), "reply")      # 插得进：照常回（插进这一轮）
        self.assertEqual(d("顺便把 X 也改了", True, 1), "reply")          # 补充：不打断，插不进由 cc-connect 排队
        self.assertEqual(d("暂停", False, 3), "abort")
        # 没叫她、和手上的任务相关：补充 → insert，等她回话且插不进 → abort，无关 → context
        g.current_task[(sub, "t:1")] = "修登录页"
        self.assertEqual(d("", True, 1, content="登录页按钮也要改"), "insert")
        self.assertEqual(d("", True, 2, content="登录页好了没"), "abort")
        self.assertEqual(d("", True, 0, content="晚饭吃啥"), "context")

    def test_busy_interjection_keeps_task(self):  # 忙时插话不覆盖她手上的任务，打断后换成新的这句
        g = load_gate()
        sub = next(iter(g.SUBS))
        seen = []
        def score(text, **k):
            seen.append(text)
            return types.SimpleNamespace(choice=pick, probs=[0] * 4)
        g.sub_task = types.SimpleNamespace(score=score)
        name = g.SUBS[sub]
        pick = 1
        g.decide_sub({"content": f"{name}，把登录页修一下", "busy": False, "session_key": "t:1"}, sub)
        g.decide_sub({"content": f"[replying to {name}: 好]\n顺便看下注册页", "busy": True, "session_key": "t:1"}, sub)
        self.assertIn("正在做的任务：「" + name + "，把登录页修一下」", seen[-1])
        self.assertEqual(g.current_task[(sub, "t:1")], name + "，把登录页修一下")
        pick = 3
        g.decide_sub({"content": f"[replying to {name}: 好]\n别弄了，先查日志", "busy": True, "session_key": "t:1"}, sub)
        self.assertEqual(g.current_task[(sub, "t:1")], "别弄了，先查日志")

    def test_single_role_decide_always_replies(self):
        """单角色（gate-team.json 没有 subs）：不打分；忙时被 @ 叫停/改做回 abort，其余 reply，没 jev 也一样。"""
        d = Path(tempfile.mkdtemp())
        (d / "team.json").write_text(json.dumps({"lead": {"name": "C酱"}, "subs": {}}))
        g = load_gate(team=str(d / "team.json"))
        g.route = lambda *a, **k: self.fail("single role /decide must not judge")
        srv = ThreadingHTTPServer(("127.0.0.1", 0), g.H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            cases = [({"content": "好的", "mentioned": False, "busy": False}, "reply"),
                     ({"content": "你好", "mentioned": True, "busy": True}, "reply"),
                     ({"content": "暂停", "mentioned": True, "busy": True}, "abort"),  # 忙时 @ 叫停：打断
                     ({"content": "停", "mentioned": True, "busy": True}, "abort"),
                     ({"content": "别做了，改做Y", "mentioned": True, "busy": True}, "abort"),
                     ({"content": "暂停", "mentioned": False, "busy": True}, "reply")]  # 没 @：照旧回
            for no_jev in (False, True):  # 没装 jev 也要能打断
                if no_jev:
                    g.SCORER_KIND = "none"
                for body, want in cases:
                    req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}/decide", json.dumps(body).encode(),
                                                 {"Content-Type": "application/json"})
                    r = urllib.request.urlopen(req, timeout=5)
                    self.assertEqual((r.status, json.loads(r.read())["action"]), (200, want), (no_jev, body))
        finally:
            srv.shutdown()
            srv.server_close()

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
