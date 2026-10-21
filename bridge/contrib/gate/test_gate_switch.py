"""切换器在本机回答 /context，以及 sync_gate.sh 的打包清单（不连 SSH、不加载模型）：python3 -I contrib/gate/test_gate_switch.py"""
import ast, importlib, json, os, re, sys, tempfile, threading, unittest, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TMP = Path(tempfile.mkdtemp())
os.environ["GATE_SETUP_DIR"] = str(TMP)  # 不读本机 ~/.cc-connect 里向导写的文件
os.environ["GATE_TEAM"] = str(HERE / "team.example.json")
os.environ["SWITCH_LOG"] = str(TMP / "switch.jsonl")
# 本机 wiki（同 test_ctxsvc 的样例）：GATE_WIKI 在 ctxsvc 导入时读取
WIKI = TMP / "wiki"
(WIKI / "infra").mkdir(parents=True)
(WIKI / "infra" / "README.md").write_text("x")
(WIKI / "infra" / "vps.md").write_text("---\nname: vps\ndescription: VPS 一览\n---\n# T\n- 代理端口 7890\n")
os.environ["GATE_WIKI"] = str(WIKI)
switch = importlib.import_module("gate_switch")
ctxsvc = sys.modules["ctxsvc"]
PAGE = {"path": str(WIKI / "infra/vps.md"), "desc": "VPS 一览 | 6: - 代理端口 7890"}


def local_imports(module, seen=None):
    """module.py 直接或间接导入的、本目录里的模块名。"""
    seen = set() if seen is None else seen
    tree = ast.parse((HERE / f"{module}.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        names = [a.name for a in node.names] if isinstance(node, ast.Import) else \
            [node.module] if isinstance(node, ast.ImportFrom) and node.module and node.level == 0 else []
        for name in names:
            top = name.split(".")[0]
            if top not in seen and (HERE / f"{top}.py").exists():
                seen.add(top)
                local_imports(top, seen)
    return seen


class SyncManifest(unittest.TestCase):
    def test_sync_ships_every_local_module_gate_imports(self):
        script = (HERE / "sync_gate.sh").read_text(encoding="utf-8")
        shipped = set(re.findall(r'cp "\$HERE/[^"]+" "\$TMP/\$NAME/([\w.]+)"', script))
        m = re.search(r'^GATE_MODULES="([^"]*)"', script, re.M)
        self.assertIsNotNone(m, "sync_gate.sh 没有 GATE_MODULES 清单")
        shipped |= set(m.group(1).split())
        # scorer 在远端由 scorer_torch.py 改名提供
        needed = {f"{name}.py" for name in local_imports("gate")}
        self.assertTrue(needed, "gate.py 没有本地依赖？解析出错")
        self.assertEqual(sorted(needed - shipped), [], "sync_gate.sh 漏传了 gate.py 要用的模块")


class Upstream(BaseHTTPRequestHandler):
    """假的远端闸门：记下收到的请求（/context 不该到这里）。"""
    seen = []

    def do_POST(self):
        Upstream.seen.append(self.path)
        out = b'{"wiki": [{"path": "remote.md", "desc": "remote"}]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def post(port, path, obj):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(obj).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


class ContextRoute(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = serve(Upstream)
        cls.switch = serve(switch.H)
        cls.port = cls.switch.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.switch.shutdown()
        cls.upstream.shutdown()

    def setUp(self):
        Upstream.seen.clear()
        switch.CONFIG["tunnel_port"] = self.upstream.server_address[1]
        switch.state["upstream_ok"] = True
        ctxsvc.WIKI, ctxsvc._idx = WIKI, None

    def test_gpu_mode_answers_from_the_local_wiki_without_forwarding(self):
        out = post(self.port, "/context?bot=sub1", {"key": "discord:1", "text": "代理端口多少", "bot": "sub1"})
        self.assertEqual(out, {"wiki": [PAGE]})
        self.assertEqual(Upstream.seen, [], "/context 不该转给远端闸门")

    def test_gate_off_still_answers_from_the_local_wiki(self):
        switch.state["upstream_ok"] = False
        self.assertEqual(post(self.port, "/context", {"key": "k", "text": "代理端口"}), {"wiki": [PAGE]})

    def test_missing_wiki_answers_no_pages(self):
        ctxsvc.WIKI, ctxsvc._idx = TMP / "nope", None
        self.assertEqual(post(self.port, "/context", {"key": "k", "text": "代理端口"}), {"wiki": []})

    def test_lookup_error_answers_no_pages_and_keeps_the_gate_up(self):
        original = ctxsvc.context
        ctxsvc.context = lambda req: (_ for _ in ()).throw(OSError("disk"))
        try:
            self.assertEqual(post(self.port, "/context", {"key": "k", "text": "t"}), {"wiki": []})
        finally:
            ctxsvc.context = original
        self.assertTrue(switch.state["upstream_ok"])
        events = [json.loads(l) for l in Path(os.environ["SWITCH_LOG"]).read_text(encoding="utf-8").splitlines()]
        self.assertEqual([e["event"] for e in events[-2:]], ["context_error", "context"])

    def test_unknown_paths_are_still_404(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            post(self.port, "/nope", {})
        self.assertEqual(caught.exception.code, 404)

    def test_context_requests_are_logged_with_their_route(self):
        post(self.port, "/context", {"key": "k", "text": "代理端口"})
        last = json.loads(Path(os.environ["SWITCH_LOG"]).read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual((last["event"], last["route"], last["pages"]), ("context", "local", 1))


if __name__ == "__main__":
    unittest.main()
