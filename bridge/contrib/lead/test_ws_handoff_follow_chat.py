"""新活的归属频道建活时定一次：--follow 的旧活归哪就归哪，否则是跑命令的聊天频道；不再按成品文件名、交接正文猜。
来源：11-25 #1153（续改的活被记成测试频道的）、#2010（Fable：猜测层就是传错频道的来路）。假桥和池子沿用 test_ws_up 的 FAKE_POOL。"""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_ws_up import FAKE_POOL  # noqa: E402


class FollowChatTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "setup").mkdir()
        self.fake = self.tmp / "bothouse"
        self.fake.write_text(f"#!{sys.executable}\n" + FAKE_POOL)
        self.fake.chmod(0o755)
        Path(str(self.fake) + ".json").write_text(json.dumps({"ws": [
            {"id": "1", "name": "工作区1", "owner": "", "open": 0, "parked": 0},
            {"id": "2", "name": "工作区2", "owner": "", "open": 0, "parked": 0}]}))
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.tmp / "setup"),
                    "BOARD_DIR": str(self.tmp / "board"), "CC_BIN": str(self.fake), "CC_PROJECT": "lead-proj",
                    "WS_HANDOFF_WAIT": "1"}

    def note(self, n, said, title="交接"):
        p = self.tmp / f"{n}.md"
        p.write_text(f"# {title}\n\n## 用户原话\n{said}\n## 总目标\n## 范围\n改：x\n不改：无\n## 已查过什么\n无（没查过）\n## 进度\n"
                     "## 相关改动\n冲突：无\n## 规矩\n## 参照实现\n- bridge/contrib/lead/ws-up:1\n", encoding="utf-8")
        return str(p)

    def handoff(self, notes, task, short, chat, *extra):
        return subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), notes, task, "--short", short, *extra],
                              capture_output=True, text=True, env={**self.env, "CC_SESSION_KEY": chat})

    def items(self):
        f = self.tmp / "board" / "board.jsonl"
        return [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []

    def old_from_promo(self):
        """宣传频道（test:200）派的旧活，已交回、不在做。"""
        r = self.handoff(self.note("old", "- 用户：做一条短片"), "做一条代码艺术短片", "短片", "test:200")
        self.assertEqual(r.returncode, 0, r.stderr)
        return self.items()[0]

    def test_follow_takes_the_old_task_owner(self):
        old = self.old_from_promo()
        r = self.handoff(self.note("new", "- 用户：`字太小了`"), "放大短片字体", "放大字体", "test:100", "--follow", str(old["id"]))
        self.assertEqual(r.returncode, 0, r.stderr)
        new = [i for i in self.items() if i["id"] != old["id"]][0]
        self.assertEqual(new["chat"], "test:200")

    def test_file_name_is_not_a_guess_any_more(self):
        old = self.old_from_promo()
        said = f"- [15:24] 用户（回复频道里刚发的 `{old['id']}_A_chunguqin.mp4`）：`字太小了`"
        r = self.handoff(self.note("new", said), "放大字体", "放大字体", "test:100")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.items()[-1]["chat"], "test:100")  # 没写 --follow：就是这个频道的新活

    def test_named_other_channel_task_without_follow_is_refused(self):
        old = self.old_from_promo()
        r = self.handoff(self.note("new", "- 用户：`字太小了`"), f"续做 #{old['id']}：放大字体", "放大字体", "test:100")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(f"--follow {old['id']}", r.stderr)
        self.assertEqual(len(self.items()), 1)

    def test_follow_unknown_task_is_refused(self):
        r = self.handoff(self.note("new", "- 用户：x"), "做 x", "做x", "test:100", "--follow", "999")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("#999", r.stderr)
        self.assertEqual(self.items(), [])


if __name__ == "__main__":
    unittest.main()
