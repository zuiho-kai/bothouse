#!/usr/bin/env python3 -I
"""Seconds-fast checks of sessionlog.py (the unified session record) on temp stores and fake native logs.

  python3 -I bin/test_sessionlog.py
"""
import json, os, subprocess, sys, tempfile, time, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["AGENT_SESSIONS_DIR"] = tempfile.mkdtemp(prefix="sessionlog-test-")  # never the real store
import sessionlog as S


def jsonl(path, records, mode="w"):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, mode) as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def lines(path):
    return [json.loads(l) for l in Path(path).read_text().splitlines()]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sessionlog-"))
        self.store = self.tmp / "store"
        self.store.mkdir()
        self.cc = self.tmp / "projects"
        self.arch = self.tmp / "archive"

    def tearDown(self):
        subprocess.run(["rm", "-rf", str(self.tmp)])

    def sources(self, readers, bridge=None):
        (self.store / "sources.json").write_text(json.dumps({"readers": readers, "bridge": bridge or {}}))


class Record(Base):
    def test_fields_and_validation(self):
        r = S.record(role="橘", runtime="claudecode", dir="in", text="hi", channel="discord:1", session="s",
                     ts="2026-10-20T00:00:00.000Z", speaker="zuiho_kai")
        self.assertEqual(r, {"v": 1, "ts": "2026-10-20T00:00:00.000Z", "role": "橘", "channel": "discord:1",
                             "runtime": "claudecode", "session": "s", "dir": "in", "kind": "message", "text": "hi",
                             "via": "bridge", "speaker": "zuiho_kai"})
        for bad in ({"role": "", "runtime": "x", "dir": "in"}, {"role": "a", "runtime": "x", "dir": "up"},
                    {"role": "a", "runtime": "x", "dir": "in", "kind": "note"}):
            with self.assertRaises(ValueError):
                S.record(text="t", **bad)

    def test_append_bridge_file_and_cli(self):
        p = S.append(S.record(role="龙娘", runtime="codex", dir="out", text="回复", channel="discord:155"))
        self.assertEqual(p.parent, Path(os.environ["AGENT_SESSIONS_DIR"]) / "codex" / "bridge")
        self.assertRegex(p.name, r"^[0-9a-f]{8}-discord-155\.jsonl$")
        self.assertIsNotNone(lines(p)[0]["ts"])  # filled in at append
        out = subprocess.run([sys.executable, "-I", S.__file__, "append", "--role", "龙娘", "--runtime", "codex", "--dir",
                              "in", "--channel", "discord:155", "--speaker", "zuiho_kai"], input="原话",
                             capture_output=True, text=True, env={**os.environ})
        self.assertEqual(out.stdout.strip(), str(p))
        self.assertEqual([r["text"] for r in lines(p)], ["回复", "原话"])


class Hook(Base):
    ENV = {"CC_HOOK_EVENT": "message.received", "CC_HOOK_PROJECT": "longniang", "CC_HOOK_SESSION_KEY": "discord:155",
           "CC_HOOK_USER_NAME": "zuiho_kai", "CC_HOOK_USER_ID": "7271", "CC_HOOK_CONTENT": "你好",
           "CC_HOOK_TIMESTAMP": "2026-10-20T15:04:05+09:00"}
    CFG = {"bridge": {"longniang": {"role": "龙娘", "runtime": "codex"}}}

    def test_received(self):
        r = S.from_cc_connect(self.ENV, self.CFG)
        self.assertEqual((r["role"], r["runtime"], r["channel"], r["dir"], r["text"], r["speaker"], r["speaker_id"],
                          r["ts"], r["session"], r["via"]),
                         ("龙娘", "codex", "discord:155", "in", "你好", "zuiho_kai", "7271", "2026-10-20T06:04:05.000Z",
                          None, "bridge"))

    def test_sent_with_agent_env(self):
        r = S.from_cc_connect({**self.ENV, "CC_HOOK_EVENT": "message.sent", "CC_HOOK_AGENT": "codex2",
                               "CC_HOOK_AGENT_SESSION_ID": "01a1"}, self.CFG)
        self.assertEqual((r["dir"], r["speaker"], r["runtime"], r["session"]), ("out", "龙娘", "codex2", "01a1"))
        self.assertNotIn("speaker_id", r)

    def test_unmapped_project_and_skips(self):
        r = S.from_cc_connect({**self.ENV, "CC_HOOK_PROJECT": "openclaw-bot"}, self.CFG)
        self.assertEqual((r["role"], r["runtime"]), ("openclaw-bot", "unknown"))
        self.assertIsNone(S.from_cc_connect({**self.ENV, "CC_HOOK_EVENT": "agent.closed"}, self.CFG))
        self.assertIsNone(S.from_cc_connect({**self.ENV, "CC_HOOK_CONTENT": "  "}, self.CFG))

    def test_hook_command_writes(self):
        self.sources([], self.CFG["bridge"])
        env = {**os.environ, **self.ENV, "AGENT_SESSIONS_DIR": str(self.store)}
        subprocess.run([sys.executable, "-I", S.__file__, "hook"], env=env, check=True)
        [p] = (self.store / "codex" / "bridge").glob("*.jsonl")
        self.assertEqual(lines(p)[0]["text"], "你好")


def cc_user(text, ts="2026-10-20T01:00:00.000Z", cwd="/Users/x/proj", **kw):
    return {"type": "user", "timestamp": ts, "cwd": cwd, "message": {"role": "user", "content": text}, **kw}


def cc_assistant(blocks, ts="2026-10-20T01:00:01.000Z", cwd="/Users/x/proj"):
    return {"type": "assistant", "timestamp": ts, "cwd": cwd, "message": {"content": blocks}}


class ClaudeCode(Base):
    def setUp(self):
        super().setUp()
        self.sources([{"reader": "claudecode", "role": "橘", "roots": [str(self.cc), str(self.arch)]}])
        self.native = self.cc / "-Users-x-proj" / "aaaaaaaa-1111.jsonl"
        self.dest = self.store / "claudecode" / "native" / "aaaaaaaa-1111.jsonl"

    def test_convert_and_incremental(self):
        jsonl(self.native, [
            cc_user("第一句"),
            cc_assistant([{"type": "text", "text": "回答"}, {"type": "tool_use", "name": "Bash", "input": {"command": "x" * 500}},
                          {"type": "thinking", "thinking": "不记"}]),
            cc_user([{"type": "tool_result", "content": "工具输出不记"}]),
            cc_user("子 agent 的话", isSidechain=True),
            {"type": "ai-title", "aiTitle": "标题一"},
            {"type": "attachment", "timestamp": "2026-10-20T01:00:02.000Z", "cwd": "/Users/x/other",
             "attachment": {"type": "queued_command", "origin": {"kind": "human"},
                            "prompt": [{"type": "text", "text": "插话"}, {"type": "image"}]}},
        ])
        self.assertEqual(S.sync(root=self.store), 1)
        recs = lines(self.dest)
        self.assertEqual([(r["kind"], r["dir"], r["text"][:5]) for r in recs],
                         [("meta", None, ""), ("message", "in", "第一句"), ("message", "out", "回答"),
                          ("tool", "out", "xxxxx"), ("meta", None, ""), ("meta", None, ""), ("message", "in", "插话")])
        self.assertEqual(recs[0]["cwd"], "/Users/x/proj")
        self.assertEqual(len(recs[3]["text"]), 300)  # tool summary: ingest.py shows 300 chars of a call
        self.assertEqual(recs[4]["title"], "标题一")
        self.assertEqual(recs[5]["cwd"], "/Users/x/other")  # cwd recorded again when it changes
        self.assertTrue(recs[6]["queued"])
        self.assertTrue(all(r["role"] == "橘" and r["runtime"] == "claudecode" and r["session"] == "aaaaaaaa-1111"
                            and r["via"] == "reader" for r in recs))
        self.assertEqual(recs[-1]["src"], self.native.stat().st_size)
        self.assertEqual(S.sync(root=self.store), 0)  # nothing new
        jsonl(self.native, [cc_user("第二句", cwd="/Users/x/other")], mode="a")
        with open(self.native, "a") as f:
            f.write('{"type": "user", "message": {"content": "写了一半')  # half-written line: waits
        self.assertEqual(S.sync(root=self.store), 1)
        self.assertEqual([r["text"] for r in lines(self.dest)][-1], "第二句")
        self.assertEqual(len(lines(self.dest)), 8)
        self.assertEqual(self.dest.stat().st_mtime, self.native.stat().st_mtime)

    def test_who_wrote_a_user_turn(self):
        # what Claude Code records about a user turn's author (706ffc2b, 97ff5383 on 2026-10-22)
        jsonl(self.native, [cc_user("打的字", entrypoint="cli", origin={"kind": "human"}),
                            cc_user("【已审:x】派活", entrypoint="sdk-cli"),
                            cc_user("This session is being continued…", entrypoint="cli", isCompactSummary=True)])
        S.sync(root=self.store)
        recs = [r for r in lines(self.dest) if r["kind"] == "message"]
        self.assertEqual([(r.get("entry"), r.get("origin"), r.get("compact")) for r in recs],
                         [("cli", "human", None), ("sdk-cli", None, None), ("cli", None, True)])

    def test_rewritten_log_starts_over_and_archive(self):
        jsonl(self.native, [cc_user("很长的一句话" * 50)])
        S.sync(root=self.store)
        ino = self.dest.stat().st_ino
        jsonl(self.native, [cc_user("短")])  # smaller than what was read
        S.sync(root=self.store)
        self.assertEqual([r["text"] for r in lines(self.dest) if r["kind"] == "message"], ["短"])
        self.assertNotEqual(self.dest.stat().st_ino, ino)
        [s] = S.sessions(root=self.store)
        self.assertTrue(s.primary)
        arch = self.arch / self.native.parent.name / self.native.name
        arch.parent.mkdir(parents=True)
        os.rename(self.native, arch)  # Claude Code cleaned it up; the rsync archive keeps it
        S.sync(root=self.store)
        [s] = S.sessions(root=self.store)
        self.assertFalse(s.primary)
        self.assertEqual(s.native, str(arch))
        self.assertEqual(len(lines(self.dest)), 2)  # same bytes: nothing appended twice

    def test_store_offset(self):
        jsonl(self.native, [cc_user("一"), {"type": "progress"}, cc_user("二"), {"type": "progress"}])
        S.sync(root=self.store)
        sizes = [len(l) for l in self.native.read_bytes().splitlines(keepends=True)]
        recs = self.dest.read_bytes().splitlines(keepends=True)
        self.assertEqual(S.store_offset(self.dest, 0), 0)
        self.assertEqual(S.store_offset(self.dest, sizes[0]), len(recs[0]) + len(recs[1]))  # meta + 一
        self.assertEqual(S.store_offset(self.dest, sum(sizes[:2])), len(recs[0]) + len(recs[1]))
        self.assertEqual(S.store_offset(self.dest, sum(sizes)), self.dest.stat().st_size)

    def test_hosts(self):
        self.sources([{"reader": "claudecode", "role": "橘", "roots": [str(self.cc)], "hosts": str(self.tmp / "hosts")}])
        jsonl(self.native, [cc_user("本机")])
        jsonl(self.tmp / "hosts" / "n150" / "projects" / "-home-x" / "bbbbbbbb-2.jsonl", [cc_user("别的机器")])
        S.sync(root=self.store)
        self.assertEqual([s.id for s in S.sessions(root=self.store)], ["aaaaaaaa-1111"])
        self.assertEqual([(s.id, s.host) for s in S.sessions(root=self.store, hosts=True)],
                         [("aaaaaaaa-1111", None), ("bbbbbbbb-2", "n150")])


class Codex(Base):
    def rollout(self, home, sid, cwd, originator, items):
        p = home / "sessions" / "2026" / "10" / "20" / f"rollout-2026-10-20T13-02-33-{sid}.jsonl"
        meta = {"timestamp": "2026-10-20T04:02:36.310Z", "type": "session_meta",
                "payload": {"id": sid, "cwd": cwd, "originator": originator}}
        jsonl(p, [meta] + [{"timestamp": "2026-10-20T04:03:00.000Z", "type": "response_item", "payload": i} for i in items])
        return p

    def test_convert_and_filters(self):
        home = self.tmp / "codex"
        msg = lambda role, *texts: {"type": "message", "role": role, "content": [{"type": "input_text", "text": t} for t in texts]}
        self.rollout(home, "01a1aaaa-0000", "/w/longniang", "cc-connect-codex-agent", [
            msg("developer", "系统提示不记"),
            msg("user", "# AGENTS.md instructions for /w", "<environment_context>…</environment_context>"),
            msg("user", "<@1472> 你看看", "重复块", "重复块"),
            {"type": "reasoning", "summary": []},
            {"type": "function_call", "name": "exec", "arguments": json.dumps({"cmd": ["ls", "-la"]})},
            {"type": "function_call_output", "output": "不记"},
            {"type": "custom_tool_call", "name": "apply_patch", "input": 'x cmd: "cat \\"a b\\"" y'},
            msg("assistant", "好的。"),
        ])
        self.rollout(home, "01a1bbbb-0000", "/w/jingyu", "cc-connect-codex-agent", [msg("user", "别人的")])
        self.rollout(home, "01a1cccc-0000", "/w/longniang", "codex_exec", [msg("user", "探针")])
        self.sources([{"reader": "codex", "role": "龙娘", "homes": [str(home)], "cwd": "/w/longniang",
                       "originators": ["cc-connect-codex-agent"]}])
        S.sync(root=self.store)
        [s] = S.sessions(root=self.store)
        self.assertEqual((s.id, s.role, s.runtime, s.via), ("01a1aaaa-0000", "龙娘", "codex", "reader"))
        recs = lines(s.path)
        self.assertEqual([(r["kind"], r["dir"], r["text"]) for r in recs],
                         [("meta", None, ""), ("message", "in", "<@1472> 你看看\n\n重复块"), ("tool", "out", "ls -la"),
                          ("tool", "out", 'cat "a b"'), ("message", "out", "好的。")])
        self.assertEqual(recs[0]["cwd"], "/w/longniang")


class Private(Base):
    """review 2026-10-20 #5: the record holds everything said; only the owner may read it (dirs 0700, files 0600),
    whatever the umask, and a store made before this is tightened by the next sync."""

    def test_modes(self):
        old = os.umask(0o022)
        try:
            jsonl(self.cc / "-p" / "aaaaaaaa-1.jsonl", [cc_user("话")])
            self.sources([{"reader": "claudecode", "role": "橘", "roots": [str(self.cc)]}])
            self.store.chmod(0o755)
            (self.store / "sources.json").chmod(0o644)
            S.sync(root=self.store)
            os.environ["AGENT_SESSIONS_DIR"], keep = str(self.store), os.environ["AGENT_SESSIONS_DIR"]
            try:
                S.append(S.record(role="小爪", runtime="openclaw", dir="in", text="b", channel="discord:2"))
            finally:
                os.environ["AGENT_SESSIONS_DIR"] = keep
        finally:
            os.umask(old)
        bad = []
        for d, dirs, files in os.walk(self.store):
            for n in dirs:
                m = (Path(d) / n).stat().st_mode & 0o777
                bad += [f"{d}/{n} {m:o}"] if m != 0o700 else []
            for n in files:
                m = (Path(d) / n).stat().st_mode & 0o777
                bad += [f"{d}/{n} {m:o}"] if m != 0o600 else []
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o700)
        self.assertEqual(bad, [])


class CodexExec(Codex):
    """review 2026-10-20 #6: 龙娘's outings run through `codex exec` in her own work dir; wiki ingest passes run
    through it too, but under wiki/.ingest-work — the cwd must match exactly."""

    def test_exec_in_own_dir_only(self):
        home = self.tmp / "codex"
        m = {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "【外出·接着】"}]}
        self.rollout(home, "01a1e001-0000", "/w/longniang", "codex_exec", [m])
        self.rollout(home, "01a1e002-0000", "/w/longniang/wiki/.ingest-work", "codex_exec", [m])
        self.sources([{"reader": "codex", "role": "龙娘", "homes": [str(home)], "cwd": "/w/longniang",
                       "originators": ["cc-connect-codex-agent", "codex_cli_rs", "codex_exec"]}])
        S.sync(root=self.store)
        self.assertEqual([s.id for s in S.sessions(root=self.store)], ["01a1e001-0000"])


class Covered(Base):
    def test_bridge_hidden_when_a_reader_covers_it(self):
        self.sources([{"reader": "codex", "role": "龙娘", "homes": [str(self.tmp / "none")]}])
        os.environ["AGENT_SESSIONS_DIR"], keep = str(self.store), os.environ["AGENT_SESSIONS_DIR"]
        try:
            S.append(S.record(role="龙娘", runtime="codex", dir="in", text="a", channel="discord:1"))
            S.append(S.record(role="小爪", runtime="openclaw", dir="in", text="b", channel="discord:2"))
            got = [(s.runtime, s.via, s.role) for s in S.sessions()]
            self.assertEqual(got, [("openclaw", "bridge", "小爪")])  # 龙娘's codex log covers her bridge file
            self.assertEqual([s.role for s in S.sessions(role="小爪")], ["小爪"])
            self.assertEqual(S.sessions(role="龙娘"), [])
        finally:
            os.environ["AGENT_SESSIONS_DIR"] = keep


if __name__ == "__main__":
    unittest.main()
