"""#2200：ws-pass 放行视频附件时，每条视频前先发一行说明（版本名，没有就用文件名里的中文），
且上传前把含中文的文件名转成纯英文和数字（如 1148_A_chunguqin.mp4），避免 Discord 去掉中文变成 --A--Discord.mp4。"""
import json, os, re, subprocess, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERDICT = "逐条：两版配乐不同，画面清晰，放行给用户试听"
FAKE = r'''
import json, os, sys
from pathlib import Path
calls = Path(sys.argv[0]).parent / "calls.jsonl"
args = sys.argv[1:]
rec = {"args": args, "files": []}
i = 0
while i < len(args):
    if args[i] in ("--file", "--image") and i + 1 < len(args):
        p = args[i + 1]
        rec["files"].append({"flag": args[i], "path": p, "name": os.path.basename(p), "exists": os.path.isfile(p)})
        i += 2
    else:
        i += 1
open(calls, "a", encoding="utf-8").write(json.dumps(rec, ensure_ascii=False) + "\n")
'''


class PassVideoLabelASCIITest(unittest.TestCase):
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
        return [json.loads(l) for l in self.calls.read_text(encoding="utf-8").splitlines() if json.loads(l)["args"][0] == "send"]

    @staticmethod
    def msg_of(call):
        a = call["args"]
        return a[a.index("--message") + 1] if "--message" in a else ""

    def test_multi_video_auto_label_and_ascii_filename(self):
        r = self.run_pass("--id", "1148", "--verdict", VERDICT, str(self.vid_a), str(self.vid_b), "请对比试听两版")
        self.assertEqual(r.returncode, 0, r.stderr)
        sends = self.send_calls()
        # 主消息 + 每条视频各自带一行版本说明发送，共 3 次 send
        self.assertEqual(len(sends), 3, f"expected 3 sends (main + 2 videos), got {sends}")
        self.assertEqual(self.msg_of(sends[0]), "请对比试听两版")
        self.assertEqual(sends[0]["files"], [])

        # 每条视频前面有对应说明（从文件名里的中文/版本段提取）
        self.assertIn("纯古琴", self.msg_of(sends[1]))
        self.assertIn("A", self.msg_of(sends[1]))
        self.assertIn("箫弦乐", self.msg_of(sends[2]))
        self.assertIn("B", self.msg_of(sends[2]))

        # 每个视频上传文件名都是纯英文和数字（含任务号，无中文，文件真实可读，不重名）
        names = []
        for idx, call in enumerate(sends[1:], 1):
            self.assertEqual(len(call["files"]), 1, f"video {idx} should send 1 file: {call}")
            f = call["files"][0]
            self.assertTrue(f["exists"], f"staged ascii file missing: {f}")
            self.assertRegex(f["name"], r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.mp4$", f"non-ASCII filename: {f['name']}")
            self.assertTrue(f["name"].startswith("1148_"), f"expected board id prefix 1148_, got {f['name']}")
            names.append(f["name"])
        self.assertEqual(len(set(names)), 2, f"duplicate ascii filenames: {names}")

    def test_explicit_label_used_verbatim(self):
        r = self.run_pass(
            "--id", "1148", "--verdict", VERDICT,
            "--label", "A 版·纯古琴", "--label", "B 版·箫弦乐",
            str(self.vid_a), str(self.vid_b), "请对比试听两版",
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        sends = self.send_calls()
        self.assertEqual(len(sends), 3, sends)
        self.assertEqual(self.msg_of(sends[1]), "A 版·纯古琴")
        self.assertEqual(self.msg_of(sends[2]), "B 版·箫弦乐")
        for call in sends[1:]:
            self.assertRegex(call["files"][0]["name"], r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.mp4$")

    def test_pure_ascii_video_name_kept_with_label(self):
        ascii_vid = self.tmp / "1148_A_guqin.mp4"
        ascii_vid.write_bytes(b"\x00\x00\x00\x18ftypmp42")
        r = self.run_pass("--id", "1148", "--verdict", VERDICT, "--label", "A 版·纯古琴", str(ascii_vid), "给你看")
        self.assertEqual(r.returncode, 0, r.stderr)
        sends = self.send_calls()
        self.assertEqual(len(sends), 2, sends)
        self.assertEqual(self.msg_of(sends[1]), "A 版·纯古琴")
        self.assertEqual(sends[1]["files"][0]["name"], "1148_A_guqin.mp4")


if __name__ == "__main__":
    unittest.main()
