#!/usr/bin/env python3
"""End-to-end tests of the hooks through run.py, with Claude Code payloads and DSH payloads (the shape
@deepseek-ai/dsh-hooks-claude-code sends: lower-case tool names, transcript_path ""). A DSH session log is
written to a temporary DSH_HOME, zstd-compressed in several frames like DSH's default
(dsh-session-persistence-jsonl), when node with zlib zstd is available.
Run: python3 -I bridge/contrib/hooks/test_hooks.py"""
import json, os, shutil, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "run.py")
GATE = os.path.join(os.path.dirname(HERE), "gate")


def node_zstd():
    node = shutil.which("node")
    if not node:
        return False
    r = subprocess.run([node, "-e", "process.exit(require('zlib').zstdCompressSync ? 0 : 1)"], capture_output=True)
    return r.returncode == 0


class Hooks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.hooks = os.path.join(cls.tmp, "hooks")  # an installed copy, as "bothouse setup hooks on" makes
        shutil.copytree(HERE, cls.hooks)
        for f in ("ctxsvc.py", "wiki_search.py"):
            shutil.copy(os.path.join(GATE, f), cls.hooks)
        cls.env = dict(os.environ, HOME=cls.tmp, DSH_HOME=os.path.join(cls.tmp, "dsh"), GATE_WIKI="off")
        for k in ("CC_PROJECT", "HOOK_PROXY", "HOOK_FREE_DIRS", "HOOK_REVIEWS_DIR", "HOOK_RESEARCHER_DIRS"):
            cls.env.pop(k, None)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def run_hook(self, name, payload, env=None, cwd=None):
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), name], input=json.dumps(payload),
                           capture_output=True, text=True, env=env or self.env, timeout=30, cwd=cwd)
        self.assertIn(r.returncode, (0, 2), r.stderr)
        return r.stdout.strip()

    def denied(self, out):
        return bool(out) and json.loads(out).get("hookSpecificOutput", {}).get("permissionDecision") == "deny"

    def session(self, sid, recs, depth=0, compress=True):
        d = os.path.join(self.env["DSH_HOME"], "sessions", "-work", sid)
        os.makedirs(d, exist_ok=True)
        lines = [json.dumps({"type": "session", "version": 4, "id": sid, "cwd": "/work", "delegationDepth": depth})]
        lines += [json.dumps(r, ensure_ascii=False) for r in recs]
        if compress and node_zstd():
            # one frame for the header, one per later record: DSH writes one frame per append batch
            js = ("const z=require('zlib'),fs=require('fs');const ls=JSON.parse(fs.readFileSync(0,'utf8'));"
                  "fs.writeFileSync(process.argv[1],Buffer.concat(ls.map(l=>z.zstdCompressSync(l+'\\n'))))")
            subprocess.run(["node", "-e", js, os.path.join(d, "session.v4.jsonl.zstd")], input=json.dumps(lines),
                           text=True, check=True)
        else:
            with open(os.path.join(d, "session.v4.jsonl"), "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")

    # ---- bash-guard ----
    def test_bash_guard_both_clis(self):
        for tool in ("Bash", "bash"):
            out = self.run_hook("bash-guard", {"hook_event_name": "PreToolUse", "session_id": "s1", "transcript_path": "",
                                               "tool_name": tool, "tool_input": {"command": "pkill -f x"}})
            self.assertTrue(self.denied(out), (tool, out))
            self.assertIn("pkill -f", out)
        out = self.run_hook("bash-guard", {"hook_event_name": "PreToolUse", "tool_name": "bash", "tool_input": {"command": "ls"}})
        self.assertEqual(out, "")

    def test_download_rule_needs_proxy_setting(self):
        p = {"hook_event_name": "PreToolUse", "tool_name": "bash", "tool_input": {"command": "wget https://example.com/x.bin"}}
        self.assertEqual(self.run_hook("bash-guard", p), "")
        self.assertTrue(self.denied(self.run_hook("bash-guard", p, dict(self.env, HOOK_PROXY="http://127.0.0.1:7890"))))

    # ---- dispatch-review-guard ----
    def test_dispatch_review_both_clis(self):
        for tool, inp in (("Agent", {"prompt": "改一下 foo"}), ("subagent", {"prompt": "改一下 foo"}),
                          ("workflow", {"script": "agent('改一下 foo')"})):
            out = self.run_hook("dispatch-review-guard", {"hook_event_name": "PreToolUse", "transcript_path": "",
                                                          "tool_name": tool, "tool_input": inp})
            self.assertTrue(self.denied(out), (tool, out))
            ok = dict(inp)
            key = "script" if tool == "workflow" else "prompt"
            ok[key] = "【免审:小改动】" + ok[key]
            self.assertEqual(self.run_hook("dispatch-review-guard", {"hook_event_name": "PreToolUse", "tool_name": tool,
                                                                     "tool_input": ok}), "", tool)

    def test_main_session_edit(self):
        p = {"hook_event_name": "PreToolUse", "session_id": "main1", "transcript_path": "", "tool_name": "write",
             "tool_input": {"file_path": "/work/app.py", "content": "x"}}
        self.session("main1", [], compress=False)
        self.assertTrue(self.denied(self.run_hook("dispatch-review-guard", p)))
        self.session("child1", [], depth=1, compress=False)  # a DSH subagent: allowed, as a Claude Code subagent is
        self.assertEqual(self.run_hook("dispatch-review-guard", dict(p, session_id="child1")), "")

    # ---- param-source-guard ----
    def test_param_source_both_clis(self):
        for tool, inp in (("Write", {"file_path": "/w/a.py", "content": "limit = 40\n"}),
                          ("write", {"file_path": "/w/a.py", "content": "limit = 40\n"}),
                          ("edit", {"file_path": "/w/a.py", "old_string": "a", "new_string": "limit = 40"}),
                          ("str_replace_editor", {"command": "create", "path": "/w/a.py", "file_text": "limit = 40\n"})):
            out = self.run_hook("param-source-guard", {"hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": inp})
            self.assertTrue(self.denied(out), (tool, out))
        out = self.run_hook("param-source-guard", {"hook_event_name": "PreToolUse", "tool_name": "write",
                                                   "tool_input": {"file_path": "/w/a.py", "content": "limit = 40  # 来源：用户原话\n"}})
        self.assertEqual(out, "")

    # ---- Stop: fix-claim-guard over a DSH log ----
    def test_stop_dsh_log_blocks_once(self):
        recs = [
            {"type": "turn/start", "time": 1792587556252, "data": {"turn": 1}},
            {"type": "user/message", "time": 1792587556287, "data": {"source": {"kind": "user"},
                                                                    "content": [{"type": "text", "text": "登录报错了，修一下"}]}},
            {"type": "assistant/message", "time": 1792587561461, "data": {"message": {"role": "assistant", "content": [
                {"type": "tool-call", "id": "c1", "name": "bash", "arguments": "{\"command\": \"ls\"}"}]}}},
            {"type": "tool/result", "time": 1792587561497, "data": {"message": {"toolCallId": "c1", "isError": False,
                                                                               "content": [{"type": "text", "text": "a"}]}}},
            {"type": "assistant/message", "time": 1792587562000, "data": {"message": {"role": "assistant", "content": [
                {"type": "text", "text": "已修复，登录正常了。"}]}}},
            # what DSH writes just before it runs a Stop hook; run.py waits for it (the log lags behind)
            {"type": "hook/invoked", "time": 1792587562001, "data": {"turn": 1, "point": "Stop", "handlerId": "claude-code:Stop:1"}},
        ]
        self.session("stop1", recs)
        p = {"hook_event_name": "Stop", "session_id": "stop1", "transcript_path": "", "stop_hook_active": False}
        out = self.run_hook("fix-claim-guard", p)
        self.assertTrue(out and json.loads(out)["decision"] == "block", out)
        self.assertEqual(self.run_hook("fix-claim-guard", p), "")  # same turn: only once, like Claude Code
        self.session("stop2", recs, depth=1)
        self.assertEqual(self.run_hook("fix-claim-guard", dict(p, session_id="stop2")), "")  # subagent: no Stop

    # ---- switch: run.py off|on|status, what the agent runs when its user asks in chat ----
    def test_switch(self):
        role = os.path.join(self.tmp, "role")
        os.makedirs(os.path.join(role, ".claude", "sub"), exist_ok=True)
        with open(os.path.join(role, ".claude", "settings.json"), "w") as f:
            f.write("{}")
        sub = os.path.join(role, ".claude", "sub")  # the agent may have cd'ed below the role directory

        def sw(*args):
            r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), *args], capture_output=True,
                               text=True, env=self.env, cwd=sub, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            return json.loads(r.stdout)

        kill = {"hook_event_name": "PreToolUse", "tool_name": "bash", "tool_input": {"command": "pkill -f x"}}
        agent = {"hook_event_name": "PreToolUse", "tool_name": "subagent", "tool_input": {"prompt": "改一下 foo"}}
        bash_ok = lambda: not self.denied(self.run_hook("bash-guard", kill, cwd=role))  # DSH: no cwd in the payload
        cc_kill = dict(kill, tool_name="Bash", cwd=role)  # Claude Code: cwd in the payload
        self.assertFalse(bash_ok())
        st = sw("off")
        self.assertEqual(st["on"], [])
        self.assertTrue(bash_ok())
        self.assertEqual(self.run_hook("bash-guard", cc_kill), "")
        self.assertEqual(self.run_hook("dispatch-review-guard", agent, cwd=role), "")
        st = sw("on")
        self.assertEqual(st["off"], [])
        self.assertFalse(bash_ok())
        self.assertTrue(self.denied(self.run_hook("bash-guard", cc_kill)))
        st = sw("off", "dispatch-review-guard")
        self.assertEqual(st["off"], ["dispatch-review-guard"])
        self.assertEqual(self.run_hook("dispatch-review-guard", agent, cwd=role), "")
        self.assertFalse(bash_ok())  # one hook off leaves the others on
        st = sw("on", "dispatch-review-guard")
        self.assertTrue(self.denied(self.run_hook("dispatch-review-guard", agent, cwd=role)))
        st = sw("off")
        st = sw("on", "bash-guard")  # from "all off", one back on
        self.assertEqual(st["on"], ["bash-guard"])
        self.assertFalse(bash_ok())
        self.assertEqual(self.run_hook("dispatch-review-guard", agent, cwd=role), "")
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "off", "nope"], capture_output=True,
                           text=True, env=self.env, cwd=sub)
        self.assertNotEqual(r.returncode, 0)
        with open(os.path.join(role, ".claude", "conest-hooks.json")) as f:  # the file a person can edit too
            self.assertEqual(json.load(f), {"off": sorted(set(st["off"]))})
        # bash-guard lets the switch command itself through
        self.assertEqual(self.run_hook("bash-guard", {"hook_event_name": "PreToolUse", "tool_name": "bash",
            "tool_input": {"command": "python3 " + os.path.join(self.hooks, "run.py") + " off"}}, cwd=self.tmp), "")

    # ---- review fixes: missing script, --role, DSH without its environment, --dsh-global ----
    def test_missing_hook_script_passes(self):
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--conest-hook", "gone-guard"],
                           input="{}", capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)  # exit 2 would block every tool call
        self.assertIn("missing", r.stderr)

    def test_switch_role_from_other_dir(self):
        role = os.path.join(self.tmp, "role3")
        os.makedirs(os.path.join(role, ".claude"), exist_ok=True)
        with open(os.path.join(role, ".claude", "settings.json"), "w") as f:
            f.write("{}")
        elsewhere = os.path.join(self.tmp, "repo", "sub")  # the agent cd'ed into another repo with its own settings
        os.makedirs(os.path.join(self.tmp, "repo", ".claude"), exist_ok=True)
        with open(os.path.join(self.tmp, "repo", ".claude", "settings.json"), "w") as f:
            f.write("{}")
        os.makedirs(elsewhere, exist_ok=True)
        env = {k: v for k, v in self.env.items() if k != "CLAUDE_PROJECT_DIR"}  # Bash tool: no CLAUDE_PROJECT_DIR
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--role", role, "off", "bash-guard"],
                           capture_output=True, text=True, env=env, cwd=elsewhere, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["role_dir"], role)
        with open(os.path.join(role, ".claude", "conest-hooks.json")) as f:
            self.assertEqual(json.load(f), {"off": ["bash-guard"]})
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "repo", ".claude", "conest-hooks.json")))
        kill = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "pkill -f x"}}
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--conest-hook", "--role", role,
                            "bash-guard"], input=json.dumps(kill), capture_output=True, text=True, env=env, cwd=elsewhere)
        self.assertEqual(r.stdout.strip(), "")  # the hook reads the role's switch too

    def test_dsh_without_env_or_log(self):
        env = {k: v for k, v in self.env.items() if k != "DSH_HOME"}  # DSH strips DSH_* from tool processes
        p = {"hook_event_name": "PreToolUse", "session_id": "nolog", "transcript_path": "", "tool_name": "write",
             "tool_input": {"file_path": "/work/app.py", "content": "x"}}
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "dispatch-review-guard"],
                           input=json.dumps(p), capture_output=True, text=True, env=env, timeout=30)
        self.assertFalse(self.denied(r.stdout.strip()), r.stdout)  # no log: not denied as the main session's edit
        self.assertIn("not found", r.stderr)
        # --dsh-home given in the command: the log is found and the main-session rule applies
        self.session("withhome", [], compress=False)
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--dsh-home", self.env["DSH_HOME"],
                            "dispatch-review-guard"], input=json.dumps(dict(p, session_id="withhome")),
                           capture_output=True, text=True, env=env, timeout=30)
        self.assertTrue(self.denied(r.stdout.strip()), r.stdout + r.stderr)

    def test_dsh_global_only_in_roles(self):
        role, other = os.path.join(self.tmp, "dshrole"), os.path.join(self.tmp, "stranger")
        os.makedirs(os.path.join(role, "deep"), exist_ok=True)
        os.makedirs(other, exist_ok=True)
        roles = os.path.join(self.hooks, "dsh-roles.json")
        with open(roles, "w") as f:
            json.dump({role: {"hooks": ["bash-guard"], "dsh_home": self.env["DSH_HOME"]}}, f)
        kill = {"hook_event_name": "PreToolUse", "tool_name": "bash", "tool_input": {"command": "pkill -f x"}}
        try:
            def run(name, cwd):
                r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--conest-hook",
                                    "--dsh-global", name], input=json.dumps(kill), capture_output=True, text=True,
                                   env=self.env, cwd=cwd, timeout=30)
                return r.stdout.strip()
            self.assertTrue(self.denied(run("bash-guard", os.path.join(role, "deep"))))
            self.assertEqual(run("bash-guard", other), "")  # a repository that is not a bothouse role
            self.assertEqual(run("param-source-guard", role), "")  # hook not on for this role
        finally:
            os.unlink(roles)

    def test_wiki_ingest_passes(self):
        # the wiki's ingest in DSH (cwd <role>/wiki/.ingest-work): the role's hooks must not refuse its scratch writes
        # the role sits outside dispatch-review-guard's free dirs (/tmp, /private/tmp, ~/.claude), as a real role does:
        # on Linux mkdtemp is under /tmp, where every write passes anyway and the "refused without the flag" half
        # failed (CI on main 6ae16ce). The real home (not the test's HOME) is never a free dir; removed below.
        base = tempfile.mkdtemp(prefix=".conest-test-ingest-", dir=os.path.expanduser("~"))
        role = os.path.join(base, "ingestrole")
        work = os.path.join(role, "wiki", ".ingest-work")
        os.makedirs(work, exist_ok=True)
        roles = os.path.join(self.hooks, "dsh-roles.json")
        with open(roles, "w") as f:
            json.dump({role: {"hooks": ["dispatch-review-guard"], "dsh_home": self.env["DSH_HOME"]}}, f)
        self.session("ingest1", [], compress=False)
        p = {"hook_event_name": "PreToolUse", "session_id": "ingest1", "transcript_path": "", "tool_name": "write",
             "cwd": work, "tool_input": {"file_path": os.path.join(work, "draft.md"), "content": "x"}}
        try:
            def run(env):
                return subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--conest-hook",
                                       "--dsh-global", "dispatch-review-guard"], input=json.dumps(p),
                                      capture_output=True, text=True, env=env, cwd=work, timeout=30).stdout.strip()
            self.assertTrue(self.denied(run(self.env)))  # without the flag the role's guard refuses it
            self.assertEqual(run(dict(self.env, WIKI_INGEST="1")), "")
        finally:
            os.unlink(roles)
            shutil.rmtree(base)

    # ---- wiki-context ----
    def test_wiki_context(self):
        p = {"hook_event_name": "UserPromptSubmit", "session_id": "w1", "prompt": "代理端口是多少"}
        self.assertEqual(self.run_hook("wiki-context", p), "")  # GATE_WIKI=off: silent
        wiki = os.path.join(self.tmp, "wiki")
        os.makedirs(os.path.join(wiki, "infra"))
        for f, t in (("MEMORY.md", "- infra\n"), ("infra/README.md", "# infra\n"),
                     ("infra/vps.md", "---\ndescription: VPS 一览\n---\n- 代理端口 7890，走 http\n")):
            with open(os.path.join(wiki, f), "w", encoding="utf-8") as fh:
                fh.write(t)
        env = dict(self.env, GATE_WIKI=wiki)
        out = self.run_hook("wiki-context", p, env)
        self.assertIn("infra/vps.md", out)
        self.assertEqual(self.run_hook("wiki-context", p, env), "")  # same page, same session: once
        self.assertEqual(self.run_hook("wiki-context", dict(p, session_id="w2"), dict(env, CC_PROJECT="bot")), "")


if __name__ == "__main__":
    unittest.main()
