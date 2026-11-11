#!/usr/bin/env python3
"""Review-size dispatch gate tests. Run: python3 -I ~/.claude/hooks/test_dispatch_review_guard.py"""
import importlib.util
import os
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dispatch-review-guard.py")
spec = importlib.util.spec_from_file_location("drg", HOOK)
drg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drg)


class T(unittest.TestCase):
    def test_wait_task_denied(self):
        # 用户 2026-10-28「不符合预期，超过5分钟缓存」
        for p in ("【免审:小改动】改完后用后台命令盯 ~/wiki/.ingest.log",
                  "【免审:小改动】等下一轮 ingest 真跑，下一轮开始后贴日志",
                  "【免审:调研】跑脚本，等它跑完再报结果",
                  "【免审:调研】监视进程直到退出"):
            with self.subTest(p=p), self.assertRaises(SystemExit):
                drg.check_agent(p, cwd="/tmp")

    def test_no_wait_allowed(self):
        for p in ("【免审:小改动】不干等，命令后台跑起来就交付",
                  "【免审:小改动】等不到就交日志路径，不要等",
                  "【免审:调研】等待由我查。用户原话「用后台命令盯 x.log」"):
            with self.subTest(p=p):
                drg.check_agent(p, cwd="/tmp")

    def test_pr_and_branch_target(self):
        self.assertEqual(drg.review_target("Review zuiho-kai/bothouse PR #433"), {
            "kind": "pr", "value": "433", "repo": "zuiho-kai/bothouse",
        })
        self.assertEqual(drg.review_target("复核分支：`fix/small-change`"), {
            "kind": "branch", "value": "fix/small-change", "repo": None,
        })
        self.assertIsNone(drg.review_target("Review the design"))

    def test_small_pr_is_denied(self):
        change = {"lines": 6, "paths": ["docs/guide.md"]}
        with patch.object(drg, "get_review_diff", return_value=change):
            with self.assertRaises(SystemExit):
                drg.check_agent("【审稿】Review PR #433。「请核对这个改动。」", cwd="/tmp")

    def test_large_pr_is_allowed(self):
        change = {"lines": 311, "paths": ["bridge/platform/discord/test.go"]}
        with patch.object(drg, "get_review_diff", return_value=change):
            drg.check_agent("【审稿】Review PR #435。「请核对这个改动。」", cwd="/tmp")

    def test_bridge_pr_is_allowed_even_when_small(self):
        change = {"lines": 11, "paths": ["bridge/contrib/gate/ctxsvc.py"]}
        with patch.object(drg, "get_review_diff", return_value=change):
            drg.check_agent("【审稿】Review PR #400。「请核对这个改动。」", cwd="/tmp")

    def test_online_and_money_paths_are_allowed_even_when_small(self):
        for path in ("deploy/prod/config.yml", "billing/pricing.py", "线上/发布配置.toml"):
            with self.subTest(path=path), patch.object(
                drg, "get_review_diff", return_value={"lines": 12, "paths": [path]}
            ):
                drg.check_agent("【审稿】Review PR #400。「请核对这个改动。」", cwd="/tmp")

    def test_unavailable_diff_fails_open_and_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = os.path.join(tmp, "dispatch-review-size.log")
            with patch.object(drg, "REVIEW_SIZE_LOG", log), patch.object(drg, "get_review_diff", return_value=None):
                drg.check_agent("【审稿】Review PR #999。「请核对这个改动。」", cwd="/tmp")
            with open(log, encoding="utf-8") as f:
                self.assertIn("diff_unavailable target=pr:999", f.read())

    def test_branch_git_diff_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):
                subprocess.run(["git", *args], cwd=tmp, check=True, capture_output=True)

            git("init", "-b", "main")
            git("config", "user.email", "test@example.invalid")
            git("config", "user.name", "Hook test")
            with open(os.path.join(tmp, "guide.md"), "w", encoding="utf-8") as f:
                f.write("base\n")
            git("add", "guide.md")
            git("commit", "-m", "base")
            git("checkout", "-b", "fix/small-change")
            with open(os.path.join(tmp, "guide.md"), "a", encoding="utf-8") as f:
                f.write("changed\n")
            git("commit", "-am", "small change")

            with patch.object(drg, "_branch_pr_record", return_value=None):
                change = drg.get_review_diff({
                    "kind": "branch", "value": "fix/small-change", "repo": None,
                }, tmp)
            self.assertEqual(change, {"lines": 1, "paths": ["guide.md"]})


if __name__ == "__main__":
    unittest.main()
