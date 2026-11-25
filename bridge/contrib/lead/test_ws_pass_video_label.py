"""#2200：ws-pass 放行视频附件时不再在脚本侧自己实现版本说明和改名，统一把 --board-id 和可选 --label 传给桥 `send`，
由 Go 桥在一处处理每个视频前的说明行与纯英文数字文件名。"""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERDICT = "逐条：两版配乐不同，画面清晰，放行给用户试听"
FAKE = r'''
import json, sys
from pathlib import Path
open(Path(sys.argv[0]).parent / "calls.jsonl", "a", encoding="utf-8").write(json.dumps(sys.argv[1:], ensure_ascii=False) + "\n")
'''


class PassVideoLabelDelegationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ws-pass-video-"))
        self.setup = self.tmp / "setup"
        (self.setup / "team").mkdir(parents=True)
        bindir = self.tmp / "bin"
        bindir.mkdir()
        fake = bindir / "cc-connect"
        fake.write_text(f"#!{sys.executable}\n" + FAKE, encoding="utf-8")
        fake.chmod(0o755)
        self.calls = bindir / "calls.jsonl"
        self.env = {
            "PATH": f"{bindir}:/usr/bin:/bin",
            "HOME": str(self.tmp),
            "GATE_SETUP_DIR": str(self.setup),
            "BOTHOUSE_DATA_DIR": str(self.tmp / "data"),
            "CC_BIN": str(fake),
            "CC_PROJECT": "cjiang",
            "CC_SESSION_KEY": "discord:100",
        }
        self.notes = self.tmp / "handoff.md"
        self.notes.write_text("# 交接\n## 用户原话\n- 对比两版配乐\n## 总目标\n出两版\n", encoding="utf-8")
        (self.setup / "ws-handoff-last.json").write_text(json.dumps({"tasks": {
            str(self.notes): {"channel": "901", "chat": "discord:100", "task": "代码艺术隐喻短片", "board": [1148]}
        }}), encoding="utf-8")
        (self.setup / "team" / "board.jsonl").write_text(json.dumps({
            "id": 1148, "what": "代码艺术隐喻短片", "where": str(self.notes),
            "status": "已交回待验收", "who": "工作区10大豆包", "at": "11-25 15:00", "chat": "discord:100"
        }, ensure_ascii=False) + "\n", encoding="utf-8")
        self.vid_a = self.tmp / "词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4"
        self.vid_b = self.tmp / "词舟破晦-李清照三韵-B版箫弦乐-低清-Discord.mp4"
        self.vid_a.write_bytes(b"\x00\x00\x00\x18ftypmp42A")
        self.vid_b.write_bytes(b"\x00\x00\x00\x18ftypmp42B")

    def run_pass(self, *args):
        return subprocess.run(
            [sys.executable, "-I", str(HERE / "ws-pass"), *args],
            capture_output=True, text=True, env=self.env,
        )

    def send_calls(self):
        if not self.calls.exists():
            return []
        return [json.loads(l) for l in self.calls.read_text(encoding="utf-8").splitlines() if json.loads(l)[0] == "send"]

    def test_delegates_board_id_and_files_to_bridge(self):
        r = self.run_pass("--id", "1148", "--verdict", VERDICT, str(self.vid_a), str(self.vid_b), "请对比试听两版")
        self.assertEqual(r.returncode, 0, r.stderr)
        sends = self.send_calls()
        self.assertEqual(len(sends), 1, f"ws-pass should call bridge send once, got {sends}")
        a = sends[0]
        self.assertEqual(a[a.index("--board-id") + 1], "1148")
        self.assertEqual(a[a.index("--message") + 1], "请对比试听两版")
        files = [a[i + 1] for i, tok in enumerate(a) if tok == "--file"]
        self.assertEqual(files, [str(self.vid_a), str(self.vid_b)])

    def test_forwards_explicit_labels_to_bridge(self):
        r = self.run_pass(
            "--id", "1148", "--verdict", VERDICT,
            "--label", "A 版·纯古琴", "--label", "B 版·箫弦乐",
            str(self.vid_a), str(self.vid_b), "请对比试听两版",
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        sends = self.send_calls()
        self.assertEqual(len(sends), 1, sends)
        a = sends[0]
        labels = [a[i + 1] for i, tok in enumerate(a) if tok == "--label"]
        self.assertEqual(labels, ["A 版·纯古琴", "B 版·箫弦乐"])


if __name__ == "__main__":
    unittest.main()
