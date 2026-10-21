"""切换器的 /context 转发和 sync_gate.sh 的打包清单（不连 SSH、不加载模型）：python3 -I contrib/gate/test_gate_switch.py"""
import ast, importlib, json, os, re, sys, tempfile, threading, unittest, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

TMP = Path(tempfile.mkdtemp())
os.environ["GATE_SETUP_DIR"] = str(TMP)  # 不读本机 ~/.cc-connect 里向导写的文件
os.environ["GATE_TEAM"] = str(HERE / "team.example.json")
os.environ["SWITCH_LOG"] = str(TMP / "switch.jsonl")
switch = importlib.import_module("gate_switch")


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
    """假的远端闸门：/context 回一页 wiki，记下收到的请求。"""
    seen = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        Upstream.seen.append((self.path, json.loads(body or b"{}")))
        out = json.dumps({"wiki": [{"path": "notes/gate.md", "desc": "闸门说明"}]}).encode()
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

    def test_gpu_mode_forwards_context_to_the_remote_gate(self):
        req = {"key": "discord:1", "text": "闸门怎么配", "bot": "sub1"}
        out = post(self.port, "/context?bot=sub1", req)
        self.assertEqual(out, {"wiki": [{"path": "notes/gate.md", "desc": "闸门说明"}]})
        self.assertEqual(Upstream.seen, [("/context?bot=sub1", req)])

    def test_gate_off_answers_no_pages(self):
        switch.state["upstream_ok"] = False
        self.assertEqual(post(self.port, "/context", {"key": "k", "text": "t"}), {"wiki": []})
        self.assertEqual(Upstream.seen, [])

    def test_failed_forward_answers_no_pages_and_keeps_the_gate_up(self):
        dead = serve(Upstream)
        dead_port = dead.server_address[1]
        dead.shutdown()
        dead.server_close()
        switch.CONFIG["tunnel_port"] = dead_port
        self.assertEqual(post(self.port, "/context", {"key": "k", "text": "t"}), {"wiki": []})
        self.assertTrue(switch.state["upstream_ok"], "/context 失败不应把闸门判成断开")

    def test_unknown_paths_are_still_404(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            post(self.port, "/nope", {})
        self.assertEqual(caught.exception.code, 404)

    def test_context_requests_are_logged_with_their_route(self):
        switch.state["upstream_ok"] = False
        post(self.port, "/context", {"key": "k", "text": "t"})
        last = json.loads(Path(os.environ["SWITCH_LOG"]).read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual((last["event"], last["route"], last["pages"]), ("context", "off", 0))


if __name__ == "__main__":
    unittest.main()
