"""rolewiki: per-role wikis, ingest and the nightly reflection with a mock engine (no model, no network)."""
import json, os, subprocess, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

PAGE = """<<<FILE misc/README.md
# misc

- [咖啡](coffee.md) — 用户喝什么咖啡
>>>END
<<<FILE misc/coffee.md
---
name: coffee
description: 用户只喝美式
metadata:
  scope: 用户的咖啡偏好
---
# 咖啡
## 关键事实
- 用户只喝美式
>>>END
<<<LOG
## [2026-10-22] ingest | coffee
- misc/coffee: 新建
>>>END"""


def reflection(quote, sid):
    return f"""<<<FILE self/daily-reflection.md
---
name: daily-reflection
description: 每晚的今日反思（问题、根因、改法 a/b）
metadata:
  scope: 每天一段反思和明早待办；规则候选在 rule-candidates
---
# 每日反思
## 关键事实
- 2026-10-21 反思
  - 用户纠正：10-21 {sid}「{quote}」；根因：没先查
    - 改法 a：先查再答
## 待办
>>>END
<<<LOG
## [2026-10-22] dream | 今日反思
- self/daily-reflection: 新增
>>>END"""


class RoleWiki(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        (self.data / "config.toml").write_text('[[projects]]\nname = "alpha"\n[projects.agent]\ntype = "claudecode"\n'
                                               '[[projects]]\nname = "beta"\n[projects.agent]\ntype = "acp"\n')
        self.env = {**os.environ, "ROLEWIKI_DATA": str(self.data), "CC_CONNECT_CONFIG": str(self.data / "config.toml")}

    def tearDown(self):
        self.tmp.cleanup()

    def run_rw(self, *args, reply=None, env=None):
        e = {**self.env, **(env or {})}
        if reply is not None:
            f = self.data / "reply.txt"
            f.write_text(reply)
            e["ROLEWIKI_ENGINE_CMD"] = f"{sys.executable} -c \"import sys;sys.stdin.read();print(open(r'{f}').read())\""
        return subprocess.run([sys.executable, "-I", str(HERE / "rolewiki.py"), *args], env=e, capture_output=True, text=True)

    def say(self, project, direction, text, uid="u1", ts="2026-10-21T10:00:00+00:00"):
        ev = "message.received" if direction == "in" else "message.sent"
        r = self.run_rw("hook", env={"CC_HOOK_EVENT": ev, "CC_HOOK_PROJECT": project, "CC_HOOK_CONTENT": text,
                                     "CC_HOOK_SESSION_KEY": "discord:1", "CC_HOOK_USER_ID": uid if direction == "in" else "",
                                     "CC_HOOK_TIMESTAMP": ts})
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_ensure_two_roles_two_wikis_and_lint(self):
        r = self.run_rw("ensure", "alpha", "beta")
        self.assertEqual(r.returncode, 0, r.stderr)
        for p in ("alpha", "beta"):
            self.assertTrue((self.data / "wikis" / p / "MEMORY.md").exists())
            self.assertEqual(self.run_rw("lint", p).stdout.strip(), "lint ok")

    def test_ingest_goes_into_own_wiki_only(self):
        self.say("alpha", "in", "我只喝美式")
        self.say("alpha", "out", "记住了")
        r = self.run_rw("ingest", "--project", "alpha", reply=PAGE)
        self.assertIn("ok", r.stdout, r.stderr)
        self.assertIn("美式", (self.data / "wikis/alpha/misc/coffee.md").read_text())
        self.assertFalse((self.data / "wikis/beta/misc/coffee.md").exists())
        self.assertIn("nothing new", self.run_rw("ingest", "--project", "alpha", reply=PAGE).stdout)

    def test_bad_output_is_reverted(self):
        self.say("alpha", "in", "随便聊聊")
        r = self.run_rw("ingest", "--project", "alpha", reply="<<<FILE stray.md\nx\n>>>END")
        self.assertNotIn(" ok", r.stdout)
        self.assertFalse((self.data / "wikis/alpha/stray.md").exists())

    def nightly(self, reply):
        now = time.mktime(time.strptime("2026-10-22 04:00", "%Y-%m-%d %H:%M"))
        st = {"alpha": {"nightly_at": now - 3 * 86400, "offsets": {}}}
        (self.data / "wikis").mkdir(exist_ok=True)
        (self.data / "wikis/.state.json").write_text(json.dumps(st))
        code = (f"import sys; sys.argv=['x']; sys.path.insert(0, r'{HERE}'); import rolewiki; "
                f"print(rolewiki.nightly('alpha', True, now={now}))")
        f = self.data / "reply.txt"
        f.write_text(reply)
        env = {**self.env, "ROLEWIKI_ENGINE_CMD": f"{sys.executable} -c \"import sys;sys.stdin.read();print(open(r'{f}').read())\""}
        return subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)

    def sid(self):
        sys.path.insert(0, str(HERE))
        import rolewiki
        return rolewiki.sid8("alpha", "discord:1")

    def test_nightly_writes_reflection_with_real_quote(self):
        self.say("alpha", "in", "先查一下再回答")
        self.say("alpha", "out", "好的我以后先查")
        r = self.nightly(reflection("先查一下再回答", self.sid()))
        self.assertIn("written", r.stdout, r.stderr)
        self.assertIn("先查一下再回答", (self.data / "wikis/alpha/self/daily-reflection.md").read_text())

    def test_assistant_words_as_user_quote_withdraw_the_page(self):
        self.say("alpha", "in", "先查一下再回答")
        self.say("alpha", "out", "好的我以后先查")
        r = self.nightly(reflection("好的我以后先查", self.sid()))  # the assistant's words passed off as the user's
        self.assertIn("withdrawn", r.stdout, r.stderr)
        self.assertNotIn("好的我以后先查", (self.data / "wikis/alpha/self/daily-reflection.md").read_text())

    def test_mini_toml_reads_provider(self):
        sys.path.insert(0, str(HERE))
        import rolewiki
        doc = rolewiki.mini_toml('[[projects]]\nname = "c"\n[projects.agent]\ntype = "claudecode"\n'
                                 '[projects.agent.options]\nprovider = "wizard-x"\n'
                                 '[[projects.agent.providers]]\nname = "wizard-x"\napi_key = "${K}"\nbase_url = "https://h/anthropic"\n')
        ag = doc["projects"][0]["agent"]
        self.assertEqual(ag["options"]["provider"], "wizard-x")
        self.assertEqual(ag["providers"][0]["base_url"], "https://h/anthropic")


if __name__ == "__main__":
    unittest.main()
