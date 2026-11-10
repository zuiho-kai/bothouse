"""Targeted QQ quote admission, source isolation and real DSH write bypass checks.

Set QQ_TEST_ROOT to an existing isolated directory. Fixtures are retained, never removed.
The real-tools case also needs QQ_TEST_PROFILE and QQ_TEST_DSH_MODULES.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from memory_guard import MemoryStore, sandbox_overlay


class MemoryQuotes(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="case-", dir=os.environ["QQ_TEST_ROOT"])).resolve()
        self.memory = self.root / "workspace/memory"
        self.memory.mkdir(parents=True)
        self.people = self.root / "people"
        self.people.mkdir()
        self.runtime = self.root / "run"
        self.runtime.mkdir()
        self.record = {"v": 1, "ts": "2026-11-10T00:00:00.000Z", "channel": "qq:g:900",
                       "dir": "in", "kind": "message", "via": "bridge", "platform": "qq",
                       "project": "qq-fixture", "speaker": "fixture-person",
                       "speaker_id": "101", "text": "我喜欢喝乌龙茶"}
        self.records = [self.record,
                        {**self.record, "text": "她说：「我讨厌喝红茶」"},
                        {**self.record, "speaker_id": "202", "text": "我喜欢吃苹果"},
                        {**self.record, "channel": "qq:101", "text": "私聊秘密只在私聊"},
                        {**self.record, "channel": "qq:g:901", "text": "其他群里的个人偏好"},
                        {**self.record, "project": "other-role", "text": "其他角色收到的内容"},
                        {**self.record, "from_bot": True, "role": "assistant", "text": "我喜欢喝咖啡"}]
        self.source_file = self.people / "qq-101.jsonl"
        self.source_file.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in self.records))
        self.store = MemoryStore(self.memory, self.people, "qq-fixture", "qq:g:900")
        self.identity = next(iter(self.store.sources()))
        self.path = self.memory / "101.md"
        self.body = f"- 偏好乌龙茶；原话：「我喜欢喝乌龙茶」；来源：{self.identity}\n"

    def test_human_quote_persists_changed_and_bot_quote_leave_bytes_unchanged(self):
        self.store.request({"op": "write", "path": str(self.path), "content": self.body})
        for quote in ("我喜欢喝乌龙花", "我喜欢喝咖啡"):
            with self.subTest(quote=quote), self.assertRaises(ValueError):
                self.store.request({"op": "write", "path": str(self.path),
                                    "content": self.body.replace("原话：「我喜欢喝乌龙茶」", f"原话：「{quote}」")})
            self.assertEqual(self.path.read_text(), self.body)

    def test_source_identity_and_group_private_project_isolation(self):
        sources = self.store.sources()
        self.assertEqual([record["text"] for record in sources.values()],
                         ["我喜欢喝乌龙茶", "她说：「我讨厌喝红茶」", "我喜欢吃苹果"])
        for record, quote in ((self.records[1], "我讨厌喝红茶"),
                              (self.records[2], "我喜欢吃苹果"),
                              (self.records[3], "私聊秘密只在私聊"),
                              (self.records[4], "其他群里的个人偏好"),
                              (self.records[5], "其他角色收到的内容"),
                              (self.records[6], "我喜欢喝咖啡")):
            identity = hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            with self.subTest(quote=quote), self.assertRaises(ValueError):
                self.store.request({"op": "write", "path": str(self.path),
                                    "content": f"- 偏好；原话：「{quote}」；来源：{identity}\n"})
            self.assertFalse(self.path.exists())

    @unittest.skipUnless(sys.platform == "darwin" and os.environ.get("QQ_TEST_PROFILE"),
                         "requires the existing QQ macOS policy and installed DSH modules")
    def test_real_dsh_editor_and_shell_boundary(self):
        here = Path(__file__).resolve().parent
        profile = Path(os.environ["QQ_TEST_PROFILE"]).read_text()
        for prefix in ("/Users/zhaixinyang/agents-demo/.work/qq-sandbox",
                       "/Users/xinyangzhai/agents-demo/.work/qq-sandbox",
                       "/Volumes/AgentsWork/agents-demo/.work/qq-sandbox"):
            profile = profile.replace(prefix, str(self.root))
        profile_file = self.root / "qq-copy.sb"
        profile_file.write_text(profile)
        # Keep the injected bridge identifiers unchanged; the fixture environment
        # is built explicitly and contains no production credentials or CC vars.
        env = {"PATH": os.environ["PATH"], "HOME": str(self.root / "home"),
               "XDG_CONFIG_HOME": str(self.root / "config"), "XDG_DATA_HOME": str(self.root / "data"),
               "CC_PROJECT": "qq-fixture", "CC_SESSION_KEY": "qq:g:900",
               "QQ_TEST_WORKSPACE": str(self.memory.parent),
               "QQ_TEST_PEOPLE": str(self.people),
               "QQ_TEST_DSH_MODULES": os.environ["QQ_TEST_DSH_MODULES"]}
        result = subprocess.run([sys.executable, "-I", "-B", str(here / "memory_guard.py"),
                                 "--memory", str(self.memory), "--people", str(self.people),
                                 "--profile", str(profile_file), "--runtime", str(self.runtime),
                                 "--", "/opt/homebrew/bin/node", str(here / "test_tools.mjs")],
                                env=env, cwd=self.memory.parent, capture_output=True, text=True, timeout=45)
        (self.root / "stdout.log").write_text(result.stdout)
        (self.root / "stderr.log").write_text(result.stderr)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads((self.memory.parent / "result.json").read_text())
        self.assertTrue(receipt["acceptancePassed"])
        print(json.dumps({"fixture": str(self.root), **receipt}))


if __name__ == "__main__":
    unittest.main()
