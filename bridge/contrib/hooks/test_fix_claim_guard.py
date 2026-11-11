#!/usr/bin/env python3
"""回放 2026-10-23 fix-claim-guard 误拦的句子（用户要求「改成不拦」），外加原有行为。
Run: python3 -I ~/.claude/hooks/test_fix_claim_guard.py"""
import importlib.util, json, os, subprocess, sys, tempfile, unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fix-claim-guard.py")
spec = importlib.util.spec_from_file_location("fcg", HOOK)
fcg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fcg)

PASS = [  # 不是自己宣称修完：不拦
    "改完重跑一遍，修好以后发新版时 Windows 测试拿不到草稿里的包的问题就没了。",
    "派人去修的时候发现已经有人先修好了，两个分支上都有，还没验证。",
    "七件事进度：\n1. 草稿包 ✅ 已推上去\n2. 打包空间 ✅ 已推上去",
    "龙娘说她修完了，我还没验。", "子 agent 修好了一版，待我核对。", "要等 CI 跑完才算修好。",
    "还没有修完", "等修完再测", "修完再跑", "修完后发版", "别再说“修好了”",
]
BLOCK = [  # 自己宣称修完：拦
    "mac 打包空间不够那一处也已经并行修完、推上去了。",
    "已修复，登录正常了。", "全部修复，可以发了。", "问题修好了。",
]

class T(unittest.TestCase):
    def test_pass(self):
        for t in PASS:
            self.assertFalse(fcg.claims(t), t)

    def test_block(self):
        for t in BLOCK:
            self.assertTrue(fcg.claims(t), t)

    def run_main(self, prompt, reply):
        with tempfile.TemporaryDirectory() as d:
            tp = os.path.join(d, "t.jsonl")
            with open(tp, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n")
                f.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": reply}]}},
                                   ensure_ascii=False) + "\n")
            r = subprocess.run([sys.executable, "-I", HOOK], capture_output=True, text=True, env=dict(os.environ, HOME=d),
                               input=json.dumps({"transcript_path": tp, "stop_hook_active": False, "last_assistant_message": reply}))
            return r.stdout.strip()

    def test_main(self):
        # 2026-10-25：0 文件轮次放行，拦截主路径改用两文件改动来测
        out = self.run_tools([("Edit", {"file_path": "/a/x.py", "old_string": "a", "new_string": "b"}),
                              ("Edit", {"file_path": "/a/y.py", "old_string": "a", "new_string": "b"})])
        self.assertEqual(json.loads(out)["decision"], "block")
        for t in PASS[:3]:
            self.assertEqual(self.run_main("打包失败了，修一下", t), "", t)
        self.assertEqual(self.run_main("打包失败了，修一下", BLOCK[0] + "\n入口 | 是否经过修复 | 核对结果\n打包 | 是 | 过"), "")
        self.assertEqual(self.run_main("为什么慢", BLOCK[0]), "")

    # 2026-10-25 用户批准「都做」：单文件小改动不拦
    def run_tools(self, tools, reply=BLOCK[0], prompt="打包失败了，修一下"):
        with tempfile.TemporaryDirectory() as d:
            tp = os.path.join(d, "t.jsonl")
            with open(tp, "w", encoding="utf-8") as f:
                f.write(json.dumps({"type": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n")
                for i, (name, inp) in enumerate(tools):
                    f.write(json.dumps({"type": "assistant", "message": {"content": [
                        {"type": "tool_use", "id": f"t{i}", "name": name, "input": inp}]}}, ensure_ascii=False) + "\n")
                    f.write(json.dumps({"type": "user", "message": {"content": [
                        {"type": "tool_result", "tool_use_id": f"t{i}", "content": "ok"}]}}) + "\n")
                f.write(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": reply}]}},
                                   ensure_ascii=False) + "\n")
            r = subprocess.run([sys.executable, "-I", HOOK], capture_output=True, text=True, env=dict(os.environ, HOME=d),
                               input=json.dumps({"transcript_path": tp, "stop_hook_active": False, "last_assistant_message": reply}))
            return r.stdout.strip()

    def blocked(self, out):
        return out != "" and json.loads(out)["decision"] == "block"

    def test_small_single_file_pass(self):
        edit = ("Edit", {"file_path": "/Users/x/im-bridge/bin/d10-fire", "old_string": "a = 1", "new_string": "a = 2"})
        self.assertEqual(self.run_tools([edit, ("Bash", {"command": "python3 test_d10_fire.py 2>&1 | tail -3"}),
                                         ("Bash", {"command": "echo x >> /tmp/log; cat > ~/im-bridge/claude/notes/a.md <<'E'\nE"})]), "")
        self.assertEqual(self.run_tools([("Bash", {"command": "sed -i '' 's/a/b/' /Users/x/bin/d10-fire"})]), "")

    def test_two_files_block(self):
        self.assertTrue(self.blocked(self.run_tools([
            ("Edit", {"file_path": "/a/x.py", "old_string": "a", "new_string": "b"}),
            ("Bash", {"command": "echo y >> /a/y.conf"})])))

    def test_60_lines_block(self):
        self.assertTrue(self.blocked(self.run_tools([
            ("Write", {"file_path": "/a/x.py", "content": "x = 1\n" * 60})])))

    def test_merge_block(self):
        self.assertTrue(self.blocked(self.run_tools([
            ("Edit", {"file_path": "/a/x.py", "old_string": "a", "new_string": "b"}),
            ("Bash", {"command": "gh pr merge 12 --squash"})])))

    def test_bad_transcript_block(self):  # 统计不出来照拦
        self.assertTrue(self.blocked(self.run_tools([("Edit", {"old_string": "a", "new_string": "b"})])))

    def test_60_replace_60_block(self):  # 60 行换 60 行按较大值算 60 行
        self.assertTrue(self.blocked(self.run_tools([
            ("Edit", {"file_path": "/a/x.py", "old_string": "a = 1\n" * 60, "new_string": "a = 2\n" * 60})])))

    # 2026-10-25（583b）：纯调研轮（0 文件）放行；能力/将来说法不算宣称
    def test_zero_files_pass(self):
        self.assertEqual(self.run_tools([("Bash", {"command": "grep -n foo /a/x.py"}),
                                         ("Read", {"file_path": "/a/x.py"})]), "")
        # 一次工具都没调就说修好了：没有可数的改动，照拦（仓库各 CLI 的 Stop 用例一直这么要求）
        self.assertIn("block", self.run_main("打包失败了，修一下", "我已修好"))

    def test_can_fix_not_claim(self):
        for t in ["各一小时内能修完", "一小时内能修完", "这两处可以修好", "明天可修复了", "可以马上修好"]:
            self.assertFalse(fcg.claims(t), t)

    def test_done_still_claim(self):
        for t in ["我已修好", "功能已修好", "可能已修好"]:
            self.assertTrue(fcg.claims(t), t)
        self.assertTrue(self.blocked(self.run_tools([
            ("Edit", {"file_path": "/a/x.py", "old_string": "a", "new_string": "b"}),
            ("Edit", {"file_path": "/a/y.py", "old_string": "a", "new_string": "b"})], reply="我已修好")))

if __name__ == "__main__":
    unittest.main()
