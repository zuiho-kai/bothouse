"""eta_guard：预计时间/定时长于 15 分钟要实测依据；经 run.py 的各 CLI 入口同样生效。"""
import importlib.util
import json
import os
from datetime import datetime
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).parent
RUN = HERE / "run.py"
spec = importlib.util.spec_from_file_location("eta_guard", HERE / "eta_guard.py")
eta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eta)
NOW = datetime(2026, 11, 1, 10, 50)


class Text(unittest.TestCase):
    def test_blocks_unfounded_estimates(self):
        # 前三句是 2026-11-01 用户点名的那类：#875 工作区报「约 30–40 分钟」、橘转「大约半小时」
        for s in ["工作区预计还要约 30–40 分钟", "大约半小时后交回", "我设了一个提醒，1 小时后回来看",
                  "渲染大概要一个半小时", "三张小样我四十分钟后回来看", "about 40 minutes left",
                  "明早我再看", "下午 6 点前交", "没有实测依据，大约半小时后交回"]:
            with self.subTest(s=s):
                self.assertIsNotNone(eta.check(s, NOW))

    def test_passes_measured_external_past_short(self):
        for s in ["第三版在后台渲染，大约 10 分钟", "15 分钟内交回",
                  "按实测：4 块 × 8 分钟 ÷ 1 并行 ≈ 32 分钟", "在等 CI，大约 20 分钟",
                  "等你确认后大约一小时能完", "这件实际花了 40 分钟", "每 10 分钟看一次",
                  "48 小时出货", "这个链接 25 分钟内有效", "用户原话「一个小时之后看看」",
                  "0:20 前后报错", "原帖发了半天左右", "看门会每 10 分钟催一次"]:
            with self.subTest(s=s):
                self.assertIsNone(eta.check(s, NOW))


class Commands(unittest.TestCase):
    def test_timers(self):
        self.assertIsNotNone(eta.check_shell('bothouse timer add --delay 30m --prompt "回来看进度"', NOW))
        self.assertIsNotNone(eta.check_shell('later 883 1h "回来看"', NOW))
        self.assertIsNotNone(eta.check_shell('bothouse timer add --at "2026-11-01T12:00" --prompt "看"', NOW))
        self.assertIsNone(eta.check_shell('bothouse timer add --delay 10m --prompt "回来看"', NOW))
        self.assertIsNone(eta.check_shell('bothouse timer add --delay 30m --prompt "等 CI 跑完看结果"', NOW))
        self.assertIsNone(eta.check_shell('bothouse cron add --cron "0 6 * * *" --prompt "每天看"', NOW))

    def test_text_commands(self):
        self.assertIsNotNone(eta.check_shell('cd x && board update 883 "预计一小时做完" 2>&1 | tail -1', NOW))
        self.assertIsNotNone(eta.check_shell("ws-up --notes n.md \"还要\n大约 40 分钟\"", NOW))
        self.assertIsNone(eta.check_shell('grep -n 30m file; echo "大约一小时"', NOW))

    def test_handoff_file_progress_only(self):
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write("# t\n## 用户原话\n- 定个半小时，一个小时等待\n## 进度\n- 预计还要一小时\n")
        self.addCleanup(os.unlink, f.name)
        self.assertIsNotNone(eta.check_shell(f'ws-handoff {f.name} "任务"', NOW))
        Path(f.name).write_text("# t\n## 用户原话\n- 预计还要一小时\n## 进度\n- 未开始\n")
        self.assertIsNone(eta.check_shell(f'ws-handoff {f.name} "任务"', NOW))


class AllCLIs(unittest.TestCase):
    """同一份钩子经 run.py 在每家 CLI 的载荷下都拦。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.env = dict(os.environ, HOME=str(root), DSH_HOME=str(root / "dsh"), GATE_WIKI="off")
        for k in ("CC_PROJECT", "CC_SESSION_KEY", "BOTHOUSE_DATA_DIR", "HOOK_PROXY"):
            self.env.pop(k, None)

    def call(self, name, payload, cli=""):
        args = [sys.executable, "-I", str(RUN)] + (["--" + cli] if cli else []) + [name]
        r = subprocess.run(args, input=json.dumps(payload), text=True, capture_output=True, env=self.env, timeout=10)
        return r.returncode, json.loads(r.stdout or "{}")

    def test_timer_denied(self):
        cmd = 'bothouse timer add --delay 40m --prompt "回来看"'
        for cli, event, tool in [("", "PreToolUse", "Bash"), ("codex", "PreToolUse", "Bash"),
                                 ("grok", "PreToolUse", "run_terminal_command"),
                                 ("", "BeforeTool", "run_shell_command"), ("", "PreToolUse", "bash")]:
            with self.subTest(cli=cli, tool=tool):
                code, out = self.call("bash-guard", {"hook_event_name": event, "tool_name": tool,
                                                     "tool_input": {"command": cmd}}, cli)
                decision = out.get("decision") or out["hookSpecificOutput"]["permissionDecision"]
                self.assertEqual(decision, "deny")

    def test_reply_blocked_at_stop(self):
        reply = "工作区在跑，大约半小时后交回。"
        for cli, payload in [("", {"hook_event_name": "Stop", "last_assistant_message": reply}),
                             ("codex", {"hook_event_name": "Stop", "last_assistant_message": reply}),
                             ("grok", {"hook_event_name": "Stop", "last_assistant_message": reply}),
                             ("", {"hook_event_name": "AfterAgent", "prompt": "进度？", "prompt_response": reply})]:
            with self.subTest(cli=cli, event=payload["hook_event_name"]):
                code, out = self.call("fix-claim-guard", payload, cli)
                self.assertIn(out.get("decision"), ("block", "deny"), out)


if __name__ == "__main__":
    unittest.main()
