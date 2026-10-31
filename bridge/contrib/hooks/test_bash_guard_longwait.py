#!/usr/bin/env python3
"""bash-guard 规则 10（子 agent 前台 timeout 压到 290 秒）和 perl/python 里的 while … sleep 轮询。"""
import json, os, subprocess, sys, unittest

GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bash-guard.py")


def run(cmd, timeout=None, sub=True, atype="general-purpose", bg=False, dsh=False):
    inp = {"command": cmd}
    if timeout:
        inp["timeout"] = timeout
    if bg:
        inp["run_in_background"] = True
    d = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": inp, "cwd": "/tmp", "session_id": "t"}
    if sub:
        d.update(agent_id="a1", agent_type=atype)
    if dsh:
        d["dsh"] = True
    out = subprocess.run([sys.executable, "-I", GUARD], input=json.dumps(d), capture_output=True, text=True,
                         timeout=20).stdout
    if '"deny"' in out:
        return "deny"
    if "updatedInput" in out:
        return json.loads(out)["hookSpecificOutput"]["updatedInput"]
    return None


class T(unittest.TestCase):
    def test_sub_timeout_capped(self):
        cmd = "cd /tmp/p && (time ./run.sh) > /tmp/p/integ.log 2>&1; tail -c 2500 /tmp/p/integ.log"
        self.assertEqual(run(cmd, 600000), {"command": cmd, "timeout": 290000})

    def test_not_capped(self):
        self.assertIsNone(run("python3 job.py", 600000, atype="long-task"))
        self.assertIsNone(run("python3 x.py", 600000, sub=False))
        self.assertIsNone(run("python3 x.py", 120000))
        self.assertIsNone(run("python3 x.py", 290000))
        self.assertIsNone(run("perl -e 'alarm shift; exec @ARGV' 1800 python3 x.py > l 2>&1", 600000, bg=True))
        self.assertIsNone(run("python3 x.py", 600000, dsh=True))

    def test_other_rules_still_deny(self):
        self.assertEqual(run("pkill -f foo", 600000), "deny")

    def test_inline_poll_denied(self):
        self.assertEqual(run("cd /tmp/r; perl -e 'alarm 290; while(1){@f=glob(\"n_*.png\"); last if @f>=6; sleep 5}'; cat log*"), "deny")
        self.assertEqual(run("python3 -c 'import time,os\nwhile not os.path.exists(\"done\"): time.sleep(10)'"), "deny")
        self.assertEqual(run("until grep -q done /tmp/x.log; do sleep 20; done; cat /tmp/x.log"), "deny")

    def test_loops_without_sleep_pass(self):
        self.assertIsNone(run("ls | while read f; do echo $f; done"))
        self.assertIsNone(run("cat > w.py <<'EOF'\nwhile True:\n    time.sleep(1)\nEOF\npython3 -c 'print(1)'"))


if __name__ == "__main__":
    unittest.main()
