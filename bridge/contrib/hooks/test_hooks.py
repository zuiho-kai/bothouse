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

    def test_generic_switch_without_claude_directory(self):
        for cli in ("kimi", "qoder", "iflow"):
            role = os.path.join(self.tmp, "role-" + cli)
            os.makedirs(role)
            p = subprocess.run([sys.executable, "-I", RUN, "--role", role, "off", "bash-guard"], capture_output=True, text=True, env=self.env)
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertTrue(os.path.isfile(os.path.join(role, ".bothouse", "conest-hooks.json")))
            self.assertFalse(os.path.exists(os.path.join(role, ".claude")))

    # ---- Gemini CLI payloads (https://geminicli.com/docs/hooks/reference) ----
    def gemini(self, event, **kw):
        p = {"session_id": "g1", "transcript_path": "/tmp/gemini-session.json", "cwd": self.tmp,
             "hook_event_name": event, "timestamp": "2026-10-23T10:00:00Z"}
        p.update(kw)
        return p

    def test_gemini_before_tool_denies(self):
        out = self.run_hook("bash-guard", self.gemini("BeforeTool", tool_name="run_shell_command",
                                                      tool_input={"command": "sleep 120", "is_background": False}))
        d = json.loads(out)
        self.assertEqual(d.get("decision"), "deny", out)
        self.assertIn("sleep", d.get("reason", ""))

    def test_gemini_before_tool_allows(self):
        out = self.run_hook("bash-guard", self.gemini("BeforeTool", tool_name="run_shell_command",
                                                      tool_input={"command": "ls -la"}))
        self.assertEqual(out, "")
        # a Gemini tool no hook matches still passes
        out = self.run_hook("bash-guard", self.gemini("BeforeTool", tool_name="google_web_search",
                                                      tool_input={"query": "x"}))
        self.assertEqual(out, "")

    def test_gemini_background_arg(self):
        # Gemini's run_shell_command says is_background, Claude Code's Bash says run_in_background
        out = self.run_hook("bash-guard", self.gemini("BeforeTool", tool_name="run_shell_command",
                                                      tool_input={"command": "sleep 120", "is_background": True}))
        self.assertEqual(json.loads(out).get("decision"), "deny", out)  # background without a timeout

    def test_gemini_after_agent_blocks(self):
        # AfterAgent -> Stop: fix-claim-guard/promise-guard read the turn from prompt/prompt_response
        out = self.run_hook("promise-guard", self.gemini("AfterAgent", prompt="改一下 foo",
                                                         prompt_response="改好了，我等你回来。", stop_hook_active=False))
        d = json.loads(out) if out else {}
        self.assertIn(d.get("decision"), (None, "deny"), out)  # never a Claude Code "block" leaking through
        if out:
            self.assertIn("reason", d)

    def test_gemini_output_context(self):
        # Gemini takes hookSpecificOutput.additionalContext on BeforeAgent and AfterTool, not on BeforeTool
        import importlib.util
        spec = importlib.util.spec_from_file_location("conest_run", os.path.join(HERE, "run.py"))
        run = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(run)
        out = json.dumps({"hookSpecificOutput": {"additionalContext": "hint"}})
        for ev in ("BeforeAgent", "AfterTool"):
            self.assertEqual(json.loads(run.gemini_output(out, ev)), {"hookSpecificOutput": {"additionalContext": "hint"}})
        self.assertEqual(run.gemini_output(out, "BeforeTool"), "")
        self.assertNotIn("subagent", run.GEMINI_NAMES)

    # ---- Qoder CLI payloads (https://docs.qoder.com/cli/hooks): Claude Code's shape, no translation ----
    def qoder(self, event, **kw):
        p = {"session_id": "q1", "transcript_path": "", "cwd": self.tmp, "hook_event_name": event,
             "permission_mode": "default"}
        p.update(kw)
        return p

    def test_qoder_pretooluse_denies(self):
        out = self.run_hook("bash-guard", self.qoder("PreToolUse", tool_name="Bash",
                                                    tool_input={"command": "sleep 120"}))
        self.assertTrue(self.denied(out), out)  # passed straight through, Claude Code's own decision field

    def test_qoder_pretooluse_allows(self):
        out = self.run_hook("bash-guard", self.qoder("PreToolUse", tool_name="Bash",
                                                    tool_input={"command": "ls -la"}))
        self.assertEqual(out, "")

    # ---- iFlow CLI payloads (hooks doc: env vars + the same JSON on stdin) ----
    def iflow(self, event, **kw):
        p = {"session_id": "i1", "cwd": self.tmp}
        p.update(kw)
        return p

    def iflow_env(self, event, **kw):
        e = dict(self.env, IFLOW_HOOK_EVENT_NAME=event, IFLOW_SESSION_ID="i1", IFLOW_CWD=self.tmp)
        e.update({k: v for k, v in kw.items() if k.startswith("IFLOW_")})
        return e

    def test_iflow_pretooluse_denies(self):
        # its doc's tool name is run_shell_command ("Common Tool Name Reference"), args in IFLOW_TOOL_ARGS
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "bash-guard"],
                           input=json.dumps(self.iflow("PreToolUse")),
                           capture_output=True, text=True, timeout=30, cwd=self.tmp,
                           env=self.iflow_env("PreToolUse", IFLOW_TOOL_NAME="run_shell_command",
                                              IFLOW_TOOL_ARGS=json.dumps({"command": "sleep 120"})))
        self.assertEqual(r.returncode, 2, r.stderr)  # iFlow blocks on a non-zero exit code only
        self.assertIn("sleep", r.stderr)
        self.assertEqual(r.stdout.strip(), "")

    def test_iflow_pretooluse_allows(self):
        # the same fields may also arrive in the stdin JSON (the doc's examples read data["tool_input"])
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "bash-guard"],
                           input=json.dumps(self.iflow("PreToolUse", tool_name="run_shell_command",
                                                       tool_input={"command": "ls -la"})),
                           capture_output=True, text=True, timeout=30, cwd=self.tmp,
                           env=self.iflow_env("PreToolUse"))
        self.assertEqual((r.returncode, r.stdout.strip()), (0, ""), r.stderr)

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

    def test_stop_claim_replay_20261023(self):
        """2026-10-23 误拦回放（用户要求「改成不拦」）：将来时/条件、讲别人修好的不拦，自己报已修完仍拦。"""
        import importlib.util
        spec = importlib.util.spec_from_file_location("fcg", os.path.join(HERE, "fix-claim-guard.py"))
        fcg = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fcg)
        for t in ("改完重跑一遍，修好以后发新版时 Windows 测试拿不到草稿里的包的问题就没了。",
                  "派人去修的时候发现已经有人先修好了，两个分支上都有，还没验证。",
                  "七件事进度：\n1. 草稿包 ✅ 已推上去\n2. 打包空间 ✅ 已推上去",
                  "龙娘说她修完了，我还没验。", "子 agent 修好了一版，待我核对。", "要等 CI 跑完才算修好。",
                  "还没有修完", "等修完再测", "修完再跑", "修完后发版", "别再说“修好了”"):
            self.assertFalse(fcg.claims(t), t)
        for t in ("mac 打包空间不够那一处也已经并行修完、推上去了。", "已修复，登录正常了。", "全部修复，可以发了。", "问题修好了。"):
            self.assertTrue(fcg.claims(t), t)
        recs = [{"type": "turn/start", "time": 1792587556252, "data": {"turn": 1}},
                {"type": "user/message", "time": 1792587556287, "data": {"source": {"kind": "user"},
                                                                        "content": [{"type": "text", "text": "打包失败了，修一下"}]}},
                {"type": "assistant/message", "time": 1792587562000, "data": {"message": {"role": "assistant", "content": [
                    {"type": "text", "text": "派人去修的时候发现已经有人先修好了，两个分支上都有。"}]}}},
                {"type": "hook/invoked", "time": 1792587562001, "data": {"turn": 1, "point": "Stop", "handlerId": "claude-code:Stop:1"}}]
        self.session("stop3", recs)
        p = {"hook_event_name": "Stop", "session_id": "stop3", "transcript_path": "", "stop_hook_active": False}
        self.assertEqual(self.run_hook("fix-claim-guard", p), "")

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
        with open(os.path.join(role, ".bothouse", "conest-hooks.json")) as f:  # the file a person can edit too
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
        with open(os.path.join(role, ".bothouse", "conest-hooks.json")) as f:
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
        # Only the payload file_path is outside free dirs. The test never writes it;
        # all real fixtures stay under the caller's isolated HOME, including /tmp.
        base = tempfile.mkdtemp(prefix=".conest-test-ingest-", dir=os.path.expanduser("~"))
        role = os.path.join(base, "ingestrole")
        work = os.path.join(role, "wiki", ".ingest-work")
        os.makedirs(work, exist_ok=True)
        roles = os.path.join(self.hooks, "dsh-roles.json")
        with open(roles, "w") as f:
            json.dump({role: {"hooks": ["dispatch-review-guard"], "dsh_home": self.env["DSH_HOME"]}}, f)
        self.session("ingest1", [], compress=False)
        p = {"hook_event_name": "PreToolUse", "session_id": "ingest1", "transcript_path": "", "tool_name": "write",
             "cwd": work, "tool_input": {"file_path": "/work/ingest/draft.md", "content": "x"}}
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


    def test_new_wait_rules_through_installed_runner(self):
        for tool, command, blocked in (("Bash", "sleep 60", True), ("Bash", "sleep 5", False),
                                       ("bash", "sleep 5", True)):
            payload = {"hook_event_name": "PreToolUse", "tool_name": tool,
                       "tool_input": {"command": command}, "transcript_path": ""}
            self.assertEqual(self.denied(self.run_hook("bash-guard", payload)), blocked)

    def test_dsh_log_read_only_when_needed(self):
        # run.py reuses dsh-cc-compat.add_fields: the log is read for bash/job_output only, dsh_busy for sleep/wait only
        import importlib.util
        spec = importlib.util.spec_from_file_location("compat", os.path.join(self.hooks, "dsh-cc-compat.py"))
        compat = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(compat)
        lines = ['{"type":"turn/start","data":{"turn":1}}']
        for name, inp, reads, busy in (("edit", {"path": "x"}, 0, False), ("read", {"path": "x"}, 0, False),
                                       ("bash", {"command": "ls"}, 1, False), ("bash", {"command": "sleep 5"}, 1, True),
                                       ("job_output", {"job_id": "j", "wait": True}, 1, True),
                                       ("job_output", {"job_id": "j"}, 1, False)):
            calls = []
            p = {"hook_event_name": "PreToolUse", "tool_input": inp}
            compat.add_fields(p, name, False, lambda: calls.append(1) or lines)
            self.assertEqual(len(calls), reads, name)
            self.assertEqual("dsh_busy" in p, busy, (name, inp))
        # the current call not in the log yet (DSH writes in 200ms batches): read up to twice more
        calls = []
        compat.add_fields({"hook_event_name": "PreToolUse", "tool_use_id": "c9", "tool_input": {"command": "ls"}},
                          "bash", False, lambda: calls.append(1) or lines)
        self.assertEqual(len(calls), 3)
        p = {"hook_event_name": "PreToolUse", "tool_input": {"command": "sleep 5"}}
        compat.add_fields(p, "bash", False, lambda: 1 / 0)
        self.assertNotIn("dsh_busy", p)
        self.assertNotIn("dsh_turn", p)

    def test_dsh_broken_log_passes(self):
        # a record busy()/turn_calls() cannot parse: no extra fields, the hook still runs, exit 0
        self.session("broken1", [{"type": "turn/start", "data": {"turn": 1}}, {"type": "job/registered", "data": [1]},
                                 {"type": "assistant/message", "data": [1]}])
        for cmd, blocked in (("sleep 5", True), ("ls", False), ("pkill -f x", True)):
            r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "bash-guard"],
                               input=json.dumps({"hook_event_name": "PreToolUse", "session_id": "broken1",
                                                 "transcript_path": "", "tool_name": "bash",
                                                 "tool_input": {"command": cmd}}),
                               capture_output=True, text=True, env=self.env, timeout=30)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertNotIn("Traceback", r.stderr)
            self.assertEqual(self.denied(r.stdout.strip()), blocked, (cmd, r.stdout))

    def test_lessons_without_wiki_search_hit(self):
        wiki = os.path.join(self.tmp, "lessons-wiki")
        os.makedirs(wiki, exist_ok=True)
        with open(os.path.join(wiki, "rule-candidates-recurrence.md"), "w") as f:
            f.write("## 关键事实\n- 先核事实：3 次\n  - 10-22 abcdef12「先核实再回复」\n")
        env = dict(self.env, GATE_WIKI=wiki)
        p = {"hook_event_name": "UserPromptSubmit", "session_id": "lessons-test", "prompt": "hello"}
        self.assertIn("教训表", self.run_hook("wiki-context", p, env))
        self.assertEqual(self.run_hook("wiki-context", p, env), "")
        self.assertEqual(self.run_hook("wiki-context", dict(p, session_id="ingest"), dict(env, WIKI_INGEST="1")), "")

    def test_research_dispatch_keeps_configurable_directory(self):
        p = {"hook_event_name": "PreToolUse", "tool_name": "Agent", "cwd": "/project",
             "tool_input": {"prompt": "【免审:调研】查官方说明"}, "transcript_path": "/missing"}
        env = dict(self.env, HOOK_RESEARCHER_DIRS="/project")
        self.assertTrue(self.denied(self.run_hook("dispatch-review-guard", p, env)))
        p["tool_input"]["subagent_type"] = "researcher"
        self.assertEqual(self.run_hook("dispatch-review-guard", p, env), "")


    # ---- Antigravity (agy): run.py --agy <event> ----
    def run_agy(self, name, event, payload, role):
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--conest-hook", "--role", role,
                            "--agy", event, name], input=json.dumps(payload), capture_output=True, text=True,
                           env=self.env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_agy_pretooluse_bash(self):
        role = tempfile.mkdtemp(dir=self.tmp)
        p = {"conversationId": "agy1", "workspacePaths": [role], "transcriptPath": "/nonexistent", "stepIdx": 2,
             "modelName": "m", "toolCall": {"name": "run_command",
                                             "args": {"CommandLine": "sleep 120", "WaitMsBeforeAsync": 2000}}}
        out = self.run_agy("bash-guard", "PreToolUse", p, role)
        self.assertEqual(out["decision"], "deny", out)
        self.assertTrue(out["reason"], out)
        p["toolCall"]["args"]["CommandLine"] = "ls"
        self.assertEqual(self.run_agy("bash-guard", "PreToolUse", p, role), {"decision": "allow"})
        os.makedirs(os.path.join(role, ".claude"), exist_ok=True)
        with open(os.path.join(role, ".claude", "conest-hooks.json"), "w") as f:
            json.dump({"off": ["all"]}, f)
        p["toolCall"]["args"]["CommandLine"] = "sleep 120"
        self.assertEqual(self.run_agy("bash-guard", "PreToolUse", p, role), {"decision": "allow"})

    def test_agy_every_pass_prints_allow(self):
        # agy's "decision" is Required: the passing exits (missing hook script, WIKI_INGEST, a crash) print allow too
        role = tempfile.mkdtemp(dir=self.tmp)
        p = {"conversationId": "agy2", "workspacePaths": [role], "toolCall": {"name": "run_command", "args": {}}}
        self.assertEqual(self.run_agy("no-such-hook", "PreToolUse", p, role), {"decision": "allow"})
        env = self.env
        try:
            self.env = dict(env, WIKI_INGEST="1")
            self.assertEqual(self.run_agy("bash-guard", "PreToolUse", p, role), {"decision": "allow"})
        finally:
            self.env = env
        r = subprocess.run([sys.executable, "-I", os.path.join(self.hooks, "run.py"), "--conest-hook", "--role", role,
                            "--agy", "PreToolUse", "bash-guard"], input=json.dumps({"workspacePaths": 5, "toolCall": 7}),
                           capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual((r.returncode, json.loads(r.stdout)), (0, {"decision": "allow"}), r.stderr)

    def test_agy_payload_and_answer(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("agyrun", os.path.join(self.hooks, "run.py"))
        run = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(run)
        got = run.agy_payload({"conversationId": "c", "workspacePaths": ["/w"], "transcriptPath": "/t",
                               "toolCall": {"name": "run_command", "args": {"CommandLine": "ls"}}}, "PreToolUse")
        self.assertEqual((got["hook_event_name"], got["session_id"], got["cwd"], got["transcript_path"],
                          got["tool_name"], got["tool_input"]["command"]),
                         ("PreToolUse", "c", "/w", "/t", "Bash", "ls"))
        self.assertEqual(run.agy_answer("PreToolUse", 2, "", "no\n")[0], {"decision": "deny", "reason": "no"})
        deny = json.dumps({"hookSpecificOutput": {"permissionDecision": "deny", "permissionDecisionReason": "r"}})
        self.assertEqual(run.agy_answer("PreToolUse", 0, deny, "")[0], {"decision": "deny", "reason": "r"})
        self.assertEqual(run.agy_answer("Stop", 0, json.dumps({"decision": "block", "reason": "x"}), "")[0],
                         {"decision": "continue", "reason": "x"})
        self.assertEqual(run.agy_answer("Stop", 0, "", "")[0], {"decision": "allow"})

    def test_agy_stop_blocks_once(self):
        role = tempfile.mkdtemp(dir=self.tmp)
        tr = os.path.join(role, "transcript_full.jsonl")
        steps = [
            {"step_index": 0, "type": "USER_INPUT", "created_at": "2026-10-23T01:26:14Z",
             "content": "<USER_REQUEST>\n登录报错了，修一下\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>"},
            {"step_index": 1, "type": "PLANNER_RESPONSE", "created_at": "2026-10-23T01:26:15Z",
             "tool_calls": [{"name": "run_command", "args": {"CommandLine": "ls"}}]},
            {"step_index": 2, "type": "PLANNER_RESPONSE", "created_at": "2026-10-23T01:26:16Z", "content": "已修复，登录正常了。"},
        ]
        with open(tr, "w", encoding="utf-8") as f:
            f.write("\n".join(json.dumps(x, ensure_ascii=False) for x in steps) + "\n")
        p = {"conversationId": "agystop", "workspacePaths": [role], "transcriptPath": tr, "executionNum": 0,
             "terminationReason": "model_stop", "fullyIdle": True}
        out = self.run_agy("fix-claim-guard", "Stop", p, role)
        self.assertEqual(out["decision"], "continue", out)
        self.assertTrue(out["reason"])
        self.assertEqual(self.run_agy("fix-claim-guard", "Stop", p, role), {"decision": "allow"})  # once per turn


if __name__ == "__main__":
    unittest.main()
