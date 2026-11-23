"""#1924 新检查先只记录、回放量过误拦才拦；整条替换回复要带原稿。全部在临时目录里跑，不连线上桥。"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest

HERE = Path(__file__).resolve().parent
# 11-23 18:55 被旧文案检查整条换掉的配图方案原文开头（会话 42cdec13，桥日志 draft_runes=647 replace=true）
DRAFT_1855 = ("这版稿子我看了。现在的图是拼凑出来的：被 P 掉的人只剩一团马赛克，成员栏里没有 WorkSwarm，派活那张也看不到"
              "帖子和工作区，几张图之间没有一条连起来的线。下面是方案，你说「做」我再动手。")
FAKE_BLOCK = 'import json\nprint(json.dumps({"decision": "block", "reason": "fake says no"}))\n'
FAKE_REPLACE = ('import json, sys\np = json.load(sys.stdin)\n'
                'print(json.dumps({"bothouse_replace": "文案检查没过，草稿没发出。", "draft": %r, '
                '"bothouse_check": "fake-replace"}, ensure_ascii=False))\n' % DRAFT_1855)
PASS = "import sys\nsys.stdin.read()\n"


class GateTrialsTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="gt", dir="/tmp"))  # 短路径：unix socket 有长度上限
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.hooks = self.dir / "hooks"
        self.hooks.mkdir()
        for f in ("run.py", "gate_trials.py", "gate-trials.json", "dshlog.py"):
            shutil.copy(HERE / f, self.hooks / f)
        (self.hooks / "fake-new.py").write_text(FAKE_BLOCK)
        self.role = self.dir / "role"
        (self.role / ".claude").mkdir(parents=True)
        (self.role / ".claude" / "settings.json").write_text("{}")
        self.log = self.dir / "gt.tsv"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith(("CC_", "BOTHOUSE_", "CLAUDE_", "DSH_", "GATE_"))}
        self.env.update(HOME=str(self.dir), GATE_TRIALS_LOG=str(self.log))

    def registry(self, **checks):
        reg = json.loads((HERE / "gate-trials.json").read_text(encoding="utf-8"))
        reg["checks"] = {k: {"replays": [{"replayed": n, "wrong": w}]} for k, (n, w) in checks.items()}
        (self.hooks / "gate-trials.json").write_text(json.dumps(reg), encoding="utf-8")

    def stop(self, hook, text="随便一条回复"):
        tr = self.dir / "t.jsonl"
        tr.write_text(json.dumps({"type": "user", "message": {"content": "hi"}}) + "\n" +
                      json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}},
                                 ensure_ascii=False) + "\n", encoding="utf-8")
        payload = {"hook_event_name": "Stop", "session_id": "s1", "transcript_path": str(tr),
                   "cwd": str(self.role), "stop_hook_active": False}
        return subprocess.run([sys.executable, "-I", str(self.hooks / "run.py"), "--role", str(self.role), hook],
                              input=json.dumps(payload), capture_output=True, text=True, env=self.env, timeout=20)

    def test_new_check_only_logs_until_replay_passes(self):
        r = self.stop("fake-new")
        self.assertEqual((r.returncode, r.stdout), (0, ""))  # 没登记：只记录不拦
        self.assertIn("fake-new\tobserve", self.log.read_text(encoding="utf-8"))
        self.registry(**{"fake-new": (30, 2)})  # 拦错 2 条，超线
        self.assertEqual(self.stop("fake-new").stdout, "")
        self.registry(**{"fake-new": (29, 0)})  # 回放不到 30 条
        self.assertEqual(self.stop("fake-new").stdout, "")
        self.registry(**{"fake-new": (30, 1)})  # 达标：拦
        self.assertEqual(json.loads(self.stop("fake-new").stdout)["decision"], "block")

    def test_legacy_hooks_still_block(self):
        (self.hooks / "bash-guard.py").write_text(FAKE_BLOCK)
        self.assertEqual(json.loads(self.stop("bash-guard").stdout)["decision"], "block")

    def test_legacy_list_is_frozen(self):
        # 往后新加的检查不能塞进旧名单绕过回放：要拦就补回放记录（gate_trials.py replay --record）
        reg = json.loads((HERE / "gate-trials.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(reg["legacy"]), ["bash-guard", "choice-ask-guard", "codemap-fill", "codemap-inject",
                                                 "deliver-check", "dispatch-review-guard", "param-source-guard",
                                                 "subagent-ctx-hook", "wiki-context"])

    def test_1855_draft_counted_as_misfire_of_copy_gate(self):
        reg = json.loads((HERE / "gate-trials.json").read_text(encoding="utf-8"))
        rec = reg["checks"]["copy-gate"]["replays"][-1]
        self.assertGreaterEqual(rec["wrong"], 1)
        self.assertTrue(rec["wrong_samples"][0].startswith(DRAFT_1855[:40]))
        sys.path.insert(0, str(HERE))
        import gate_trials
        self.assertFalse(gate_trials.may_block("copy-gate", reg))

    def test_replay_tool_counts_hits(self):
        texts = self.dir / "texts.jsonl"
        texts.write_text("\n".join(json.dumps(t, ensure_ascii=False) for t in ["a", DRAFT_1855]), encoding="utf-8")
        env = dict(self.env, GATE_TRIALS_REGISTRY=str(self.hooks / "gate-trials.json"))
        r = subprocess.run([sys.executable, "-I", str(self.hooks / "gate_trials.py"), "replay", "fake-new", "--hook",
                            str(self.hooks / "fake-new.py"), "--texts", str(texts), "--record", "--wrong", "1"],
                           capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("回放 2 条，命中 2 条，标为拦错 1 条", r.stdout)
        rec = json.loads((self.hooks / "gate-trials.json").read_text(encoding="utf-8"))["checks"]["fake-new"]["replays"][-1]
        self.assertEqual((rec["replayed"], rec["blocked"], rec["wrong"]), (2, 2, 1))

    def bridge(self):
        """假桥：在 CC_DATA_DIR/run/api.sock 上收 POST /stop-blocked，返回收到的 body 列表。"""
        (self.dir / "data" / "run").mkdir(parents=True)
        path = str(self.dir / "data" / "run" / "api.sock")
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(path)
        srv.listen(4)
        srv.settimeout(5)
        got = []

        def serve():
            try:
                while True:
                    c, _ = srv.accept()
                    data = b""
                    while b"\r\n\r\n" not in data or len(data.split(b"\r\n\r\n", 1)[1]) < int(
                            data.split(b"Content-Length: ")[1].split(b"\r\n")[0]):
                        data += c.recv(65536)
                    got.append(json.loads(data.split(b"\r\n\r\n", 1)[1]))
                    c.sendall(b"HTTP/1.0 200 OK\r\n\r\nok")
                    c.close()
            except OSError:
                pass
        threading.Thread(target=serve, daemon=True).start()
        self.addCleanup(srv.close)
        self.env.update(CC_DATA_DIR=str(self.dir / "data"), CC_SESSION_KEY="discord:test")
        return got

    def test_replace_needs_replay_and_keeps_original(self):
        (self.hooks / "deliver-check.py").write_text(FAKE_REPLACE)
        (self.hooks / "choice-ask-guard.py").write_text(PASS)
        got = self.bridge()
        self.stop("choice-ask-guard", DRAFT_1855)  # 没量过：不替换，原稿照发，只记一行
        self.assertEqual(got, [])
        self.assertIn("fake-replace\tobserve-replace", self.log.read_text(encoding="utf-8"))
        self.registry(**{"fake-replace": (30, 0)})
        self.stop("choice-ask-guard", DRAFT_1855)
        self.assertEqual(len(got), 1)
        self.assertTrue(got[0]["replace"].startswith("文案检查没过，草稿没发出。"))
        self.assertIn(DRAFT_1855, got[0]["replace"])  # 用户能看到原稿


if __name__ == "__main__":
    unittest.main()
