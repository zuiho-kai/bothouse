"""jev 打分器和 gate 选打分器的顺序（假接口，不联网、不加载模型）：python3 -I contrib/gate/test_scorer_remote.py"""
import importlib, io, json, math, os, sys, tempfile, types, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import scorer_remote as sr  # noqa: E402


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener_with(top):
    seen = {}

    def op(req, timeout=None):
        seen["body"] = json.loads(req.data)
        seen["auth"] = req.headers.get("Authorization")
        return FakeResp(json.dumps({"choices": [{"logprobs": {"content": [{"top_logprobs": top}]}}]}).encode())
    return op, seen


class T(unittest.TestCase):
    def test_probs_from_top_logprobs(self):
        op, seen = opener_with([{"token": "B", "logprob": math.log(0.6)}, {"token": " A", "logprob": math.log(0.3)}, {"token": "x", "logprob": -5}])
        s = sr.RemoteScorer({"url": "http://m/v1/", "model": "qwen", "api_key": "k"}, opener=op)
        sc = s.prepare("问题", ["A", "B", "C"], prefill="答案：").score("消息")
        self.assertEqual(sc.choice, 1)
        self.assertAlmostEqual(sc.probs[0] + sc.probs[1], 1.0, places=2)
        self.assertEqual(sc.probs[2], 0.0)
        self.assertEqual(seen["body"]["max_tokens"], 1)
        self.assertTrue(seen["body"]["logprobs"])
        self.assertEqual(seen["auth"], "Bearer k")

    def test_no_option_or_error_raises_valueerror(self):
        op, _ = opener_with([{"token": "hello", "logprob": -0.1}])
        with self.assertRaises(ValueError):
            sr.RemoteScorer({"url": "http://m/v1"}, opener=op).prepare("", ["A", "B"]).score("x")

        def boom(*a, **k):
            raise TimeoutError()
        with self.assertRaises(ValueError):
            sr.RemoteScorer({"url": "http://m/v1"}, opener=boom).prepare("", ["A", "B"]).score("x")

    def test_adapts_to_server_limits_and_turns_thinking_off(self):
        import urllib.error
        bodies = []

        def op(req, timeout=None):
            body = json.loads(req.data)
            bodies.append(body)
            if body["top_logprobs"] > 11:
                raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(b'{"error": "top_logprobs must be at most 11"}'))
            return FakeResp(json.dumps({"choices": [{"logprobs": {"content": [{"top_logprobs": [{"token": "A", "logprob": -0.1}]}]}}]}).encode())
        s = sr.RemoteScorer({"url": "http://m/v1", "model": "qwen3-0.6b"}, opener=op)
        sc = s.prepare("问题", ["A", "B", "C"]).score("x")
        self.assertEqual(sc.choice, 0)
        self.assertEqual([b["top_logprobs"] for b in bodies], [20, 11])
        self.assertEqual(bodies[0]["chat_template_kwargs"], {"enable_thinking": False})
        self.assertEqual(s.top, 11)  # remembered for the next call

    def test_uses_params_from_jev_json(self):
        op, seen = opener_with([{"token": "B", "logprob": -0.1}])
        s = sr.RemoteScorer({"url": "http://m/v1", "top_logprobs": 11, "no_thinking": False}, opener=op)
        s.prepare("", ["A", "B"]).score("x")
        self.assertEqual(seen["body"]["top_logprobs"], 11)
        self.assertNotIn("chat_template_kwargs", seen["body"])

    def test_load_jev_requires_logprobs(self):
        d = Path(tempfile.mkdtemp())
        (d / "j.json").write_text(json.dumps({"url": "http://m/v1", "model": "x", "logprobs": False}))
        self.assertIsNone(sr.load_jev(d / "j.json"))
        (d / "j.json").write_text(json.dumps({"url": "http://m/v1", "model": "x", "logprobs": True}))
        self.assertEqual(sr.load_jev(d / "j.json")["model"], "x")
        self.assertIsNone(sr.load_jev(d / "missing.json"))


def load_gate(setup_dir, local_scorer=True, model=None):
    """setup_dir 里放向导写的文件；local_scorer=False 模拟没装 mlx；model = GATE_MODEL（None = 不设）。"""
    sys.modules.pop("scorer", None)
    if local_scorer:
        fake = types.ModuleType("scorer")

        class Scorer:
            def __init__(self, *a, **k):
                pass

            def prepare(self, *a, **k):
                return self
        fake.Scorer = Scorer
        sys.modules["scorer"] = fake
    else:
        sys.modules["scorer"] = None  # import scorer → ImportError
    os.environ["GATE_SETUP_DIR"] = str(setup_dir)
    for k in ("GATE_TEAM", "GATE_JEV", "GATE_WIKI", "GATE_MODEL"):
        os.environ.pop(k, None)
    if model is not None:
        os.environ["GATE_MODEL"] = model
    for m in ("gate", "ctxsvc"):
        sys.modules.pop(m, None)
    return importlib.import_module("gate")


class GateSelection(unittest.TestCase):
    def test_wizard_files_pick_team_and_jev(self):
        d = Path(tempfile.mkdtemp())
        (d / "gate-team.json").write_text(json.dumps({"lead": {"name": "鲸鱼娘", "aliases": ["whale"]},
                                                       "subs": {"juzi": {"name": "橘", "aliases": []}}}, ensure_ascii=False))
        (d / "jev.json").write_text(json.dumps({"url": "http://m/v1", "model": "q", "logprobs": True}))
        g = load_gate(d)
        self.assertEqual(g.LEAD, "鲸鱼娘")
        self.assertEqual(set(g.SUBS), {"juzi"})
        self.assertEqual(g.SCORER_KIND, "jev")

    def test_no_jev_exits_with_hint(self):  # 用户原话「这种直接报错，直接说没填jev模型，推荐本地下载0.6b或者用免费小模型」
        for jev in (None, {"url": "http://m/v1", "model": "q", "logprobs": False}):  # 没填 / 测试没拿到概率
            d = Path(tempfile.mkdtemp())
            if jev:
                (d / "jev.json").write_text(json.dumps(jev))
            with self.assertRaises(SystemExit) as cm:
                load_gate(d)
            msg = str(cm.exception.code)
            for want in ("没填 jev 模型", "硅基流动", "0.6B"):
                self.assertIn(want, msg)

    def test_explicit_gate_model_uses_local(self):
        self.assertEqual(load_gate(Path(tempfile.mkdtemp()), model="/models/q").SCORER_KIND, "local")

    def test_explicit_gate_model_without_local_scorer_exits(self):
        with self.assertRaises(SystemExit) as cm:
            load_gate(Path(tempfile.mkdtemp()), local_scorer=False, model="/models/q")
        self.assertIn("GATE_MODEL", str(cm.exception.code))


if __name__ == "__main__":
    unittest.main()
