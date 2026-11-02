"""codemap-inject 选图测试（交接路径里的词不算命中）。跑法：python3 -I test_codemap_inject.py"""
import importlib.util, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("ci", os.path.join(os.path.dirname(os.path.abspath(__file__)), "codemap-inject.py"))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class T(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        ci.MAP_DIR = self.dir
        Path(self.dir, "bridge.md").write_text("---\nkeywords: bothouse, cc-connect, 桥, 工作区\n---\n")
        Path(self.dir, "hw.md").write_text("---\nkeywords: kicad, 嘉立创, 丝印\n---\n")
        Path(self.dir, "one.md").write_text("---\nkeywords: jiuwen\n---\n")

    def names(self, prompt):
        return sorted(os.path.basename(p) for p in ci.pick(prompt))

    def test_path_words_ignored(self):
        p = "先读交接 /Users/zuiho/.bothouse/roles/maomao/notes/jlc-1101.md，在嘉立创里画丝印"
        self.assertEqual(self.names(p), ["hw.md"])

    def test_need_two_words(self):
        self.assertEqual(self.names("你是工作区里的子任务「料单」"), [])
        self.assertEqual(self.names("改 bothouse 桥的换新逻辑"), ["bridge.md"])

    def test_single_keyword_map(self):
        self.assertEqual(self.names("修 jiuwen 的双工"), ["one.md"])

    def test_url_ignored(self):
        self.assertEqual(self.names("审 https://github.com/zuiho-kai/bothouse/pull/1 的 cc-connect 改动"), [])

    def test_already_named_skipped(self):
        p = os.path.join(self.dir, "hw.md")
        self.assertEqual(self.names(f"先读 {p}，嘉立创 丝印"), [])

    def test_readme_without_keywords_ignored(self):
        Path(self.dir, "README.md").write_text("# 代码地图\n每张地图写一行 `keywords: a, b`\n")
        self.assertEqual(self.names("bothouse 桥 kicad 嘉立创"), ["bridge.md", "hw.md"])

    def test_hook_output(self):
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "codemap-inject.py")
        def run(tool, prompt):
            p = {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": {"prompt": prompt, "description": "d"}}
            env = dict(os.environ, CODEMAP_DIR=self.dir)
            return subprocess.run([sys.executable, "-I", script], input=json.dumps(p), capture_output=True, text=True,
                                  env=env, timeout=20).stdout
        out = json.loads(run("Agent", "改 bothouse 桥的换新逻辑"))["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "allow")
        self.assertTrue(out["updatedInput"]["prompt"].startswith("【代码地图】先读 " + os.path.join(os.path.realpath(self.dir), "bridge.md")))
        self.assertEqual(out["updatedInput"]["description"], "d")
        self.assertEqual(run("Agent", "随便聊聊"), "")
        self.assertEqual(run("Bash", "bothouse 桥"), "")


if __name__ == "__main__":
    unittest.main()
