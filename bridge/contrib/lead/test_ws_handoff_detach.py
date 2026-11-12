"""交活被打断：调用方回合结束连进程组一起杀掉时，交活照样在后台跑完；没交成就在交活频道补一句。
来源：用户 2026-11-12「修复隔壁问题，gpt老是丢失任务」（agentm 那轮 ws-handoff 跑到第 24 秒被回合结束关进程连带杀掉）。
桥是假脚本，全在临时目录里跑。"""
import json, os, signal, subprocess, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class DetachTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "setup").mkdir()
        bindir = self.tmp / "bin"
        bindir.mkdir()
        self.calls = self.tmp / "calls.jsonl"
        fake = bindir / "cc-connect"
        # timer add 慢 2 秒（模拟交活要几十秒），FAIL_TIMER 时报错；每次调用跑完才记一行
        fake.write_text(f"#!{sys.executable}\nimport json,os,sys,time\n"
                        "if sys.argv[1:2]==['timer']: time.sleep(2)\n"
                        f"open({str(self.calls)!r},'a').write(json.dumps(sys.argv[1:])+'\\n')\n"
                        "if sys.argv[1:2]==['timer'] and os.environ.get('FAIL_TIMER'): sys.exit('bridge down')\n"
                        "print('Timer created: t1')\n")
        fake.chmod(0o755)
        self.notes = self.tmp / "notes.md"
        self.notes.write_text("# 用户原话\n- 做\n# 总目标\n# 范围\n改：测试\n不改：无\n# 已查过什么\n无（没查过）\n# 进度\n# 相关改动\n冲突：无\n# 规矩\n# 参照实现\n无（新建）\n", encoding="utf-8")
        self.env = {"PATH": f"{bindir}:/usr/bin:/bin", "HOME": str(self.tmp), "GATE_SETUP_DIR": str(self.tmp / "setup"),
                    "BOARD_DIR": str(self.tmp / "board"), "BOTHOUSE_DATA_DIR": str(self.tmp / "data"),
                    "CC_BIN": str(fake), "CC_PROJECT": "lead-proj", "WS_CHANNEL": "900", "CC_SESSION_KEY": "test:100"}

    def calls_of(self, sub):
        rows = [json.loads(l) for l in self.calls.read_text().splitlines()] if self.calls.exists() else []
        return [c for c in rows if c[:1] == [sub] or c[:2] == ["timer", sub]]

    def killed_mid_run(self, **env):
        """像回合结束那样：命令起来 1 秒后连整个进程组杀掉，再等后台跑完。"""
        p = subprocess.Popen([sys.executable, "-I", str(HERE / "ws-handoff"), str(self.notes), "测一件活", "--short", "测试"],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             env={**self.env, **env}, start_new_session=True)
        time.sleep(1)
        os.killpg(p.pid, signal.SIGKILL)
        p.wait()
        time.sleep(4)

    def test_killed_caller_still_hands_off(self):
        self.killed_mid_run()
        self.assertTrue(self.calls_of("add"), "叫醒工作区的 timer add 应在后台跑完")
        self.assertFalse(self.calls_of("send"))

    def test_killed_caller_failure_is_told_in_chat(self):
        self.killed_mid_run(FAIL_TIMER="1")
        sent = self.calls_of("send")
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][sent[0].index("-s") + 1], "test:100")
        self.assertIn("没交出去", sent[0][sent[0].index("--message") + 1])

    def test_inline_old_behaviour_loses_it(self):
        # 改前（同进程跑）：被杀就没了，叫醒没发、也没人补报
        self.killed_mid_run(WS_HANDOFF_INLINE="1")
        self.assertFalse(self.calls_of("add"))
        self.assertFalse(self.calls_of("send"))

    def test_foreground_still_reports(self):
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), str(self.notes), "测一件活", "--short", "测试"],
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("任务板 #", r.stderr)
        self.assertTrue(r.stdout.startswith("Timer created"), r.stdout)
        r = subprocess.run([sys.executable, "-I", str(HERE / "ws-handoff"), str(self.notes), "测一件活", "--short", "测试", "--force"],
                           capture_output=True, text=True, env={**self.env, "FAIL_TIMER": "1"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ws-handoff:", r.stderr.splitlines()[-1])  # 失败原因照常打到前台（临时目录在 /tmp 时是 /tmp 检查先拦）
        self.assertFalse(self.calls_of("send"))  # 前台还在就让它自己看到，不补报


if __name__ == "__main__":
    unittest.main()
