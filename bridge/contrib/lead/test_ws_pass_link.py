"""#1371：任务板路径栏是 PR / 分支 / 提交链接时，ws-pass 放行和 ws-forward 打回照验收提示（--id）或链接都能认出这件活。
全在临时目录里跑真脚本，桥是假脚本记参数，不发真实消息。"""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
LINKS = {
    "pr": "https://github.com/zuiho-kai/bothouse/pull/1487",
    "branch": "https://github.com/zuiho-kai/bothouse/tree/feat/dsh-self-route-1365",
    "commit": "https://github.com/zuiho-kai/bothouse/commit/dcf97e8dca6ae78585cb94b95b7f7994ea1481f7",
}


class PassLinkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ws-pass-link-"))
        self.setup = self.tmp / "setup"
        (self.setup / "team").mkdir(parents=True)
        bindir = self.tmp / "bin"
        bindir.mkdir()
        self.calls = self.tmp / "calls.jsonl"
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\nimport json,sys\n"
                        f"open({str(self.calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\nprint('timer-1')\n")
        fake.chmod(0o755)
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.setup),
                    "BOTHOUSE_DATA_DIR": str(self.tmp / "data"), "CC_BIN": str(fake), "CC_PROJECT": "lead-proj",
                    "CC_SESSION_KEY": "test:100"}
        # 另一个角色交的活：主角色这边的 ws-handoff-last.json 里没有它（#1365 现场：龙娘自己交的工作区）
        self.notes = self.tmp / "other-role-handoff.md"
        self.notes.write_text("# 交接\n## 用户原话\n- 修\n", encoding="utf-8")
        (self.setup / "ws-handoff-last.json").write_text(json.dumps({"tasks": {
            "/n/a.md": {"channel": "901", "chat": "test:100", "task": "A", "board": [11]},
            "/n/b.md": {"channel": "902", "chat": "test:100", "task": "B", "board": [12]},
        }}), encoding="utf-8")

    def board(self, where, where_link=None, done=False):
        it = {"id": 1365, "what": "DSH 出口补检查", "where": where, "status": "已交回待验收", "who": "工作区2龙娘",
              "at": "11-10 16:36", "chat": "test:100", "ws_was": "test:903"}
        if where_link:
            it["where_link"] = where_link
        (self.setup / "team" / ("board-done.jsonl" if done else "board.jsonl")).write_text(
            json.dumps(it, ensure_ascii=False) + "\n", encoding="utf-8")

    def run_tool(self, name, *args):
        return subprocess.run([sys.executable, "-I", str(HERE / name), *args], capture_output=True, text=True, env=self.env)

    def sent(self):
        return [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def check(self, where, where_link=None, done=False):
        for how in (["--id", "1365"], ["--notes", where_link or where]):
            with self.subTest(how=how, where=where):
                self.board(where, where_link, done)
                self.calls.unlink(missing_ok=True)
                r = self.run_tool("ws-pass", *how, "--verdict", "逐条：用户原话那条做到，证据是截图和测试输出")
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertIn(["report", "pass", "--id", "1365"], [c[:4] for c in self.sent()])
                self.calls.unlink(missing_ok=True)
                r = self.run_tool("ws-forward", *how, "打回：缺入口自验")
                self.assertIn("已交回", r.stderr)  # 交回待验收的活：转话即打回，桥扣下的汇报不贴
                self.assertIn(["report", "reject", "--id", "1365"], [c[:4] for c in self.sent()])

    def test_link_only_in_where(self):
        # 路径栏整栏就是链接（没走 #1350 的保留逻辑：旧版 board.py、另一个角色交的活）
        for link in LINKS.values():
            self.check(link, done=True)

    def test_link_kept_beside_handoff(self):
        for link in LINKS.values():
            self.check(str(self.notes), link, done=True)

    def test_unknown_id_and_link(self):
        self.board(LINKS["branch"], done=True)
        r = self.run_tool("ws-pass", "--id", "9999", "--verdict", "逐条：用户原话那条做到，证据是截图")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("#9999", r.stderr)
        r = self.run_tool("ws-pass", "--notes", "https://github.com/x/y/pull/1", "--verdict", "逐条：用户原话那条做到，证据是截图")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--id", r.stderr)
        self.assertNotIn("https:/github.com", r.stderr)  # 不再把链接拼成相对路径

    def test_many_tasks_hint_names_ids(self):
        r = self.run_tool("ws-pass", "--verdict", "逐条：用户原话那条做到，证据是截图")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--id 11", r.stderr)
        self.assertIn("--id 12", r.stderr)


if __name__ == "__main__":
    unittest.main()
