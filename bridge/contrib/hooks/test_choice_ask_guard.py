"""choice-ask-guard 离线测试：只测不调模型的部分（要不要调模型、只拦一次、判断器不可用时放行）。
模型判断本身用真实案例回放验收（#827），不进单元测试：要花钱、要网络。"""
import importlib.util, json, os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("cag", os.path.join(HERE, "choice-ask-guard.py"))
cag = importlib.util.module_from_spec(spec)
sys.path.insert(0, HERE)
spec.loader.exec_module(cag)


def run(msg, active=False, env=None):
    p = {"hook_event_name": "Stop", "last_assistant_message": msg, "stop_hook_active": active}
    out = subprocess.run([sys.executable, "-I", os.path.join(HERE, "choice-ask-guard.py")],
                         input=json.dumps(p), capture_output=True, text=True, env=env).stdout
    return json.loads(out)["decision"] if out.strip() else ""


class ChoiceAskGuard(unittest.TestCase):
    def test_maybe_asking(self):
        for m in ("要不要改口袋？请你定。", "方案一走 VPS，方案二走本地", "用 A 还是 B?"):
            self.assertTrue(cag.maybe_asking(m), m)
        for m in ("修好了，已经验过。", "你问的「要不要」是指什么", "> 要不要改口袋？\n我决定改口袋。"):
            self.assertFalse(cag.maybe_asking(m), m)

    def test_only_once(self):
        self.assertEqual(run("要不要改？", active=True), "")

    def test_judge_unavailable_passes(self):
        env = dict(os.environ, PATH="/nonexistent", HOME=os.environ.get("TMPDIR", "/tmp"))
        self.assertEqual(run("要不要改口袋？请你定。", env=env), "")


if __name__ == "__main__":
    unittest.main()
