#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "anti-spin-guard.py")

class TestAntiSpinGuard(unittest.TestCase):
    def run_hook(self, cmd):
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": cmd},
        }
        proc = subprocess.run(
            [sys.executable, SCRIPT],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
        )
        if proc.stdout.strip():
            return json.loads(proc.stdout)
        return None

    def test_short_timer_spin_polling_denied(self):
        bad_cmds = [
            'bothouse timer add --delay 1m --prompt "核对 Cursor 有没有新的额度回执"',
            'cc-connect timer add --delay 30s --prompt "检查官方用量恢复了没"',
            'bothouse timer add --delay 5m --prompt "check quota 429 status"',
        ]
        for cmd in bad_cmds:
            res = self.run_hook(cmd)
            self.assertIsNotNone(res, f"Expected denial for command: {cmd}")
            decision = res.get("hookSpecificOutput", {}).get("permissionDecision")
            self.assertEqual(decision, "deny")
            reason = res.get("hookSpecificOutput", {}).get("permissionDecisionReason", "")
            self.assertIn("anti-spin-guard", reason)

    def test_long_timer_allowed(self):
        cmd = 'bothouse timer add --delay 15m --prompt "核对 Cursor 额度回执"'
        res = self.run_hook(cmd)
        self.assertIsNone(res)

    def test_exec_or_poll_allowed(self):
        cmds = [
            'bothouse timer add --delay 1m --exec "check_quota.sh" --desc "check"',
            'bothouse cron add --poll --exec "check_quota.sh" --prompt "done"',
        ]
        for cmd in cmds:
            res = self.run_hook(cmd)
            self.assertIsNone(res, f"Expected allow for command: {cmd}")

    def test_non_polling_short_timer_allowed(self):
        cmd = 'bothouse timer add --delay 1m --prompt "叫醒大家开早会"'
        res = self.run_hook(cmd)
        self.assertIsNone(res)

if __name__ == "__main__":
    unittest.main()
