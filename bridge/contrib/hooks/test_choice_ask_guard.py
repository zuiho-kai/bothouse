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

    def test_todo_line_triggers_judge(self):
        self.assertTrue(cag.maybe_asking("【要你做的】看一下成片"))
        for m in ("【要你做的】没有。", "要你做的：无", "要你做的：没有"):
            self.assertFalse(cag.maybe_asking(m), m)

    def test_self_route_blocks_without_model(self):
        """11-10：回复让用户放文件、跑命令 → 桥的同一份规则（report check --self-route）判退回，不调模型，退回话带换路。"""
        import tempfile
        d = tempfile.mkdtemp()
        fake = os.path.join(d, "bothouse")
        with open(fake, "w") as f:
            f.write(f"#!{sys.executable}\nimport sys\nt = sys.stdin.read()\n"
                    "if '放进' in t: print('不通过'); print('- 「要你做的」让用户自己动手（放进），先换路'); sys.exit(1)\n")
        os.chmod(fake, 0o755)
        env = dict(os.environ, PATH="/nonexistent", CC_BIN=fake, HOME=d)
        p = {"hook_event_name": "Stop", "stop_hook_active": False,
             "last_assistant_message": "请把更新后的规则文件和 gate 放进 /tmp/iso.O9CP9P/home/.bothouse/collaboration/。"}
        out = json.loads(subprocess.run([sys.executable, "-I", os.path.join(HERE, "choice-ask-guard.py")],
                                        input=json.dumps(p), capture_output=True, text=True, env=env).stdout)
        self.assertEqual(out["decision"], "block")
        self.assertIn("换路", out["reason"])
        # 引号里转述别人的话不算
        p["last_assistant_message"] = "截图里它写了「请把文件放进去」，这类现在会被拦。"
        self.assertEqual(subprocess.run([sys.executable, "-I", os.path.join(HERE, "choice-ask-guard.py")],
                                        input=json.dumps(p), capture_output=True, text=True, env=env).stdout.strip(), "")

    def test_go_ask_direction_passes(self):
        """11-10 #1364：新路线/换方向用户还没选，go_ask_pass 直接放行，不调模型（用户定：换方向才问你）。"""
        import intent_judge as ij
        draft = "这一轮只是讨论方案，我没动任何代码。这是条新路线，你还没选，所以等你定了再开工。"
        why = ij.go_ask_pass(draft, [])
        self.assertIsNotNone(why)
        self.assertIn("换方向", why)


if __name__ == "__main__":
    unittest.main()
