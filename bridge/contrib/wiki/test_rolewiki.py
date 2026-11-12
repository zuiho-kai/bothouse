#!/usr/bin/env python3
"""Tests of the per-role wiki pieces the setup wizard uses: export.py kinds (claudecode, dsh default home, a type with
no reader = diary only), the on/off switch and --list, setup_wiki.py from the plain template (main and role wiki), and
the nightly export's wait for the ingest lock (it must stop at the job's deadline instead of blocking forever).
Run: python3 -I bridge/contrib/wiki/test_rolewiki.py"""
import json, os, re, sqlite3, subprocess, sys, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class RoleWiki(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.bots = self.tmp / "bots.json"
        self.env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home), WIKI_BOTS=str(self.bots), WIKI_TRANSCRIPTS=str(self.tmp / "tr"),
                        LLM_WIKI_SRC=str(HERE / "template"), WIKI_DIR=str(self.home / "wiki"))
        self.env.pop("DSH_HOME", None)

    def run_py(self, script, *args):
        return subprocess.run([sys.executable, "-X", "utf8", "-I", str(HERE / script), *args], env=self.env, capture_output=True,
                              text=True, check=True).stdout

    def role(self, name, kind):
        wd = self.home / "roles" / name
        wd.mkdir(parents=True)
        all_ = json.loads(self.bots.read_text()) if self.bots.exists() else {}
        all_[name] = {"name": name, "project": name, "kind": kind, "workdir": str(wd)}
        self.bots.write_text(json.dumps(all_))
        return wd

    def test_claudecode_kind(self):
        wd = self.role("juzi", "claudecode")
        d = self.home / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(wd))
        d.mkdir(parents=True)
        lines = [{"type": "user", "timestamp": "2026-10-22T01:00:00.000Z", "message": {"role": "user", "content": "你好橘"}},
                 {"type": "assistant", "timestamp": "2026-10-22T01:00:01.000Z", "message": {"role": "assistant", "content": [
                     {"type": "text", "text": "在呢"}, {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}},
                 {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "x"}]}},
                 {"type": "user", "isSidechain": True, "message": {"role": "user", "content": "subagent"}}]
        (d / "abcdef12-3456.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines))
        self.run_py("export.py", "juzi")
        out = list((self.tmp / "tr" / "juzi" / "claude").glob("*.jsonl"))
        self.assertEqual(len(out), 1)
        recs = [json.loads(l) for l in out[0].read_text().splitlines()]
        self.assertEqual([r["type"] for r in recs], ["user", "assistant", "assistant"])
        self.assertEqual(recs[0]["message"]["content"], "你好橘")
        self.assertEqual(recs[2]["message"]["content"][0]["input"]["command"], "ls")

    def test_dsh_kind_default_home_and_diary_only(self):
        wd = self.role("whale", "dsh")
        s = self.home / ".dsh" / "sessions" / "x" / "sid1"
        s.mkdir(parents=True)
        recs = [{"type": "session", "id": "sid1", "cwd": str(wd), "delegationDepth": 0},
                {"type": "user/message", "time": 1761094800000, "data": {"source": {"kind": "user"}, "content": [{"type": "text", "text": "查一下天气"}]}},
                {"type": "assistant/message", "time": 1761094801000, "data": {"message": {"content": [{"type": "text", "text": "晴"}]}}}]
        (s / "session.v4.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in recs) + "\n")
        wd2 = self.role("cat", "gemini")  # no reader of its own: the diary only
        (wd2 / "diary.md").write_text("2026-10-22 10:00 今天学会了一个新梗\n")
        out = self.run_py("export.py", "--count")
        self.assertIn("whale {'codex': 0, 'agy': 0, 'claude': 0, 'dsh': 1, 'diary': 0}", out)
        self.assertIn("cat {'codex': 0, 'agy': 0, 'claude': 0, 'dsh': 0, 'diary': 1}", out)
        self.run_py("export.py", "whale")
        f = next((self.tmp / "tr" / "whale" / "dsh").glob("*.jsonl"))
        self.assertIn("查一下天气", f.read_text())

    def test_switch_and_list(self):
        self.role("whale", "codex")
        self.role("cat", "codex")
        self.run_py("export.py", "--switch", "cat", "wiki", "off")
        self.assertEqual([l.split()[0] for l in self.run_py("export.py", "--list").splitlines()], ["whale"])
        self.run_py("export.py", "--switch", "cat", "wiki", "on")
        self.assertEqual(len(self.run_py("export.py", "--list").splitlines()), 2)
        (self.home / "roles" / "whale" / "wiki").mkdir()
        self.run_py("export.py", "--switch", "whale", "dream", "off")
        self.assertIs(json.loads((self.home / "roles" / "whale" / "wiki" / "config.json").read_text())["dream"], False)

    def test_setup_from_template(self):
        self.env["WIKI_ENGINES"] = json.dumps({"ingest_engine": "haiku", "night_engine": "sonnet", "bogus": 1})
        self.run_py("setup_wiki.py", "--main", str(self.home / "wiki"), "主管")
        self.assertTrue((self.home / "wiki" / "bin" / "ingest.py").exists())
        self.assertIn("exists", self.run_py("setup_wiki.py", "--main", str(self.home / "wiki"), "主管"))
        self.role("whale", "dsh")
        self.run_py("setup_wiki.py", "whale")
        w = self.home / "roles" / "whale" / "wiki"
        cfg = json.loads((w / "config.json").read_text())
        self.assertEqual((cfg["ingest_engine"], cfg["night_engine"]), ("haiku", "sonnet"))
        self.assertNotIn("bogus", cfg)
        self.assertTrue((w / ".gitignore").exists() and (w / "experiences" / "README.md").exists())
        self.assertIn("exists", self.run_py("setup_wiki.py", "whale"))
        # the shared tool accepts the role wiki's config.json (no unknown keys)
        r = subprocess.run([sys.executable, "-X", "utf8", "-I", "-c", "import runpy,sys; sys.argv=['ingest.py','--help']; "
                            f"runpy.run_path({str(w / 'bin' / 'ingest.py')!r}, run_name='__main__')"],
                           env=self.env, capture_output=True, text=True)
        self.assertNotIn("unknown key", r.stdout + r.stderr)
        self.assertIn("usage", r.stdout, r.stderr)  # the tool ran: its config.json read, --help printed

    def test_setup_null_engines_and_half_made(self):
        self.env["WIKI_ENGINES"] = "null"  # Go's json.Marshal of a nil map
        self.run_py("setup_wiki.py", "--main", str(self.home / "wiki"), "主管")
        self.role("whale", "dsh")
        w = self.home / "roles" / "whale" / "wiki"
        self.run_py("setup_wiki.py", "whale")
        (w / "config.json").unlink()  # a crash after the template copy, before config.json
        self.assertNotIn("exists", self.run_py("setup_wiki.py", "whale"))
        self.assertTrue((w / "config.json").exists())

    def test_main_refuses_user_wiki_without_mark(self):
        # .git and bin/, no bin/ingest.py, no config.json, no .bothouse-main: not this program's, never removed
        w = self.home / "wiki"
        for p, c in {"bin/search.py": "# mine\n", ".git/HEAD": "ref: refs/heads/main\n", "a/README.md": "# a\n"}.items():
            (w / p).parent.mkdir(parents=True, exist_ok=True)
            (w / p).write_text(c)
        before = {str(p): p.read_bytes() for p in w.rglob("*") if p.is_file()}
        r = subprocess.run([sys.executable, "-X", "utf8", "-I", str(HERE / "setup_wiki.py"), "--main", str(w), "主管"],
                           env=self.env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(before, {str(p): p.read_bytes() for p in w.rglob("*") if p.is_file()})


    def test_main_for_lead(self):
        """--main with the lead project: the lead's wiki (her transcripts, her persona as rule file, its own home, the
        mark naming her); a role wiki made with WIKI_SHARED_BIN forwards there, with no ~/wiki at all."""
        wd = self.role("juzi", "claudecode")
        self.role("whale", "codex")
        main = self.tmp / "elsewhere" / "wiki"  # $WIKI_DIR, not ~/wiki
        self.env.update(WIKI_DIR=str(main), WIKI_TEAM=json.dumps(["Juzi", "Whale"]), WIKI_LEAD_PERSONA=str(wd / "CLAUDE.md"))
        self.run_py("setup_wiki.py", "--main", str(main), "Juzi", "juzi")
        cfg = json.loads((main / "config.json").read_text())
        self.assertEqual(cfg["transcripts"], str(self.tmp / "tr" / "juzi"))
        self.assertEqual((cfg["assistant"], cfg["home"], cfg["rule_files"]), ("Juzi", str(main), [str(wd / "CLAUDE.md")]))
        self.assertIn("Whale", cfg["bots"])
        self.assertEqual((main / ".bothouse-main").read_text().strip(), "juzi")
        r = subprocess.run([sys.executable, "-X", "utf8", "-I", str(main / "bin" / "ingest.py"), "--help"], env=self.env,
                           capture_output=True, text=True)
        self.assertIn("usage", r.stdout, r.stderr)  # config.json accepted (no unknown key)
        self.env["WIKI_SHARED_BIN"] = str(main / "bin")
        self.run_py("setup_wiki.py", "whale")
        w = self.home / "roles" / "whale" / "wiki"
        self.assertEqual((w / "bin" / ".shared-bin").read_text().strip(), str(main / "bin"))
        env = {k: v for k, v in self.env.items() if k not in ("WIKI_BIN", "WIKI_DIR")}  # an agent's shell
        self.assertFalse((self.home / "wiki").exists())
        r = subprocess.run([sys.executable, "-X", "utf8", "-I", str(w / "bin" / "search.py"), "分类"], env=env,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("not the shared tool", r.stdout + r.stderr)

    def test_dsh_engine(self):
        """ingest.py's dsh engine: the configured command, --profile headless, the overlay, the env file, stdin."""
        self.run_py("setup_wiki.py", "--main", str(self.home / "wiki"), "主管")
        self.role("whale", "dsh")
        # a Python fake run as [python, script], the shape the wizard writes (core/rolewiki.go: node + bin.js), so it
        # runs on Windows too, where a #!/bin/sh script cannot be started
        fake = self.tmp / "fake-dsh.py"
        fake.write_text("import os,sys\nprint('argv=' + ' '.join(sys.argv[1:])); print('key=' + os.environ.get('DSH_WIZARD_API_KEY', ''))\n"
                        "print(len(sys.stdin.buffer.read()))\n")
        envf = self.tmp / "whale.env"
        envf.write_text("DSH_WIZARD_API_KEY=sk-test\n")
        self.env["WIKI_ENGINES"] = json.dumps({"ingest_engine": "dsh", "night_engine": "dsh", "dsh_cmd": [sys.executable, str(fake)],
                                               "dsh_patch": "/p.yml", "dsh_env_file": str(envf)})
        self.run_py("setup_wiki.py", "whale")
        w = self.home / "roles" / "whale" / "wiki"
        code = ("import runpy,sys,json; sys.argv=['ingest.py']; g=runpy.run_path(sys.argv[0] if False else %r, run_name='x');"
                "ok,out,_=g['dsh']('do it','TRANSCRIPT',label='t'); print(json.dumps([ok,out]))") % str(self.home / "wiki" / "bin" / "ingest.py")
        r = subprocess.run([sys.executable, "-X", "utf8", "-I", "-c", code], env=dict(self.env, WIKI_DIR=str(w)), capture_output=True, text=True, cwd=w)
        self.assertTrue(r.stdout.strip(), r.stderr)
        ok, out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertTrue(ok, r.stderr)
        self.assertIn("argv=--profile headless --patch /p.yml -", out)
        self.assertIn("key=sk-test", out)


class SubWikiPy(unittest.TestCase):
    """sub-wiki.py (Mac, Linux and Windows alike): with a fake export.py --list of two bots, nightly runs each one's
    bin/ingest.py; hook-run finds the exported session by id; hook returns at once and runs hook-run detached;
    the old sub-wiki.sh entry forwards to it."""
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.dir = self.tmp / "prog"
        self.dir.mkdir()
        for f in ("sub-wiki.py", "sub-wiki.sh"):
            (self.dir / f).write_text((HERE / f).read_text())
        self.calls = self.tmp / "calls"
        lines = []
        for b in ("juzi", "whale"):
            w = self.tmp / "wikis" / b
            (w / "bin").mkdir(parents=True)
            (w / "bin" / "ingest.py").write_text(
                f"import sys\nopen({str(self.calls)!r}, 'a').write({b!r} + ' ' + ' '.join(sys.argv[1:]) + '\\n')\n")
            lines.append(f"{b} proj-{b} {w}")
        (self.dir / "export.py").write_text(
            "import sys\nif '--list' in sys.argv: print(" + repr("\n".join(lines)) + ")\n")
        self.env = dict(os.environ, WIKI_PYTHON=sys.executable, WIKI_TRANSCRIPTS=str(self.tmp / "tr"))
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.data = self.tmp / "data"
        self.env.update(HOME=str(self.home), USERPROFILE=str(self.home), BOTHOUSE_DATA_DIR=str(self.data))
        (self.dir / "llmwiki").mkdir()
        (self.dir / "llmwiki" / "manuals.py").write_text(
            f"import os\nopen({str(self.calls)!r}, 'a').write(os.environ['MANUALS_ROLE'] + ' manuals ' + os.environ['MANUALS_PENDING_DIR'] + '\\n')\n")

    def got(self):
        rows = self.calls.read_text().splitlines()
        offset = getattr(self, 'read_offset', 0)
        self.read_offset = len(rows)
        return rows[offset:]

    def run_py(self, *args):
        subprocess.run([sys.executable, "-X", "utf8", "-I", str(self.dir / "sub-wiki.py"), *args], env=self.env, check=True, timeout=30)
        return self.got()

    def test_nightly_runs_each_bot(self):
        self.assertEqual(self.run_py("nightly"), [
            "juzi --nightly", "whale --nightly",
        ])

    def test_hook_run_finds_session(self):
        d = self.tmp / "tr" / "whale" / "2026-10"
        d.mkdir(parents=True)
        (d / "abcd1234-sess-42.jsonl").write_text("")
        self.assertEqual(self.run_py("hook-run", "whale", "sess-42"), ["whale --session abcd1234-sess-42"])
        self.assertEqual(self.run_py("hook-run", "whale", "nope"), ["whale --pending"])

    def test_nightly_role_and_storage_without_agent_environment(self):
        """Cron has no CC_DATA_DIR; the installed scheduler owns <data_dir>/wiki."""
        self.env.pop("BOTHOUSE_DATA_DIR", None)
        self.env.pop("CC_DATA_DIR", None)
        for b in ("juzi", "whale"):
            p = self.tmp / "wikis" / b / "bin/ingest.py"
            p.write_text(f"import os\nopen({str(self.calls)!r}, 'a').write("
                         "os.environ['MANUALS_ROLE'] + ' ' + os.environ['BOTHOUSE_DATA_DIR'] + '\\n')\n")
        self.assertEqual(self.run_py("nightly"), [f"proj-juzi {self.dir.parent.resolve()}", f"proj-whale {self.dir.parent.resolve()}"])

    def test_hook_detaches(self):
        env = dict(self.env, CC_HOOK_PROJECT="proj-whale", CC_HOOK_AGENT_SESSION_ID="nope")
        subprocess.run([sys.executable, "-X", "utf8", "-I", str(self.dir / "sub-wiki.py"), "hook"], env=env, check=True, timeout=10)
        for _ in range(100):
            if self.calls.exists() and self.calls.read_text().endswith("\n"):
                break
            time.sleep(0.1)
        self.assertEqual(self.got(), ["whale --pending"])
        env["CC_HOOK_PROJECT"] = "other"  # a project outside bots.json: nothing runs
        subprocess.run([sys.executable, "-X", "utf8", "-I", str(self.dir / "sub-wiki.py"), "hook"], env=env, check=True, timeout=10)
        time.sleep(1)
        self.assertEqual(self.got(), [])

    def test_cron_skips_main_wiki_and_sets_wiki_dir(self):
        """The lead's main wiki (MAIN_MARK) is run by the cron job itself, not again here; each run gets WIKI_DIR."""
        (self.tmp / "wikis" / "juzi" / ".bothouse-main").write_text("juzi\n")
        w = self.tmp / "wikis" / "whale"
        (w / "bin" / "ingest.py").write_text(
            f"import os,sys\nopen({str(self.calls)!r}, 'a').write('whale ' + os.environ.get('WIKI_DIR', '') + '\\n')\n")
        self.assertEqual(self.run_py("nightly"), [f"whale {w}"])
        self.assertEqual(self.run_py("hook-run", "juzi", "nope"), ["juzi --pending"])  # the hook still runs her

    @unittest.skipIf(os.name == "nt", "no /bin/sh on Windows")
    def test_sh_forwards(self):
        subprocess.run(["/bin/sh", str(self.dir / "sub-wiki.sh"), "lint"], env=self.env, check=True, timeout=30)
        self.assertEqual(self.got(), ["juzi --lint", "whale --lint"])

    def test_export_failure_is_reported_and_ingest_still_runs(self):
        """export.py returns 1 (the nightly gave up waiting for the ingest lock): the run is reported in sub-wiki.log
        and each bot's ingest still runs on what is already there — no traceback, no bot skipped."""
        lines = "\n".join(f"{b} proj-{b} {self.tmp / 'wikis' / b}" for b in ("juzi", "whale"))
        (self.dir / "export.py").write_text(
            "import sys\nif '--list' in sys.argv: print(" + repr(lines) + ")\nelse: sys.exit(1)\n")
        self.assertEqual(self.run_py("nightly"), ["juzi --nightly", "whale --nightly"])
        self.assertIn("export failed (ingest still runs on what is there)", (self.dir / "sub-wiki.log").read_text())


class FileLock(unittest.TestCase):
    """llmwiki/filelock.py: an exclusive lock a second opener cannot take (fcntl on Mac/Linux, msvcrt on Windows)."""
    def setUp(self):
        sys.path.insert(0, str(HERE / "llmwiki"))
        import filelock
        self.lock = filelock.lock
        self.path = Path(tempfile.mkdtemp()) / ".ingest.lock"

    def test_exclusive(self):
        for mode in ("w", "a"):
            with open(self.path, mode) as a:
                self.lock(a)
                with open(self.path, mode) as b:
                    self.assertRaises(BlockingIOError, self.lock, b, False)
            with open(self.path, mode) as b:  # released on close
                self.lock(b, False)

    def test_other_process_waits(self):
        code = ("import sys, time; sys.path.insert(0, sys.argv[1]); import filelock\n"
                "f = open(sys.argv[2], 'w'); t = time.time(); filelock.lock(f); print(time.time() - t)")
        with open(self.path, "w") as a:
            self.lock(a)
            p = subprocess.Popen([sys.executable, "-X", "utf8", "-I", "-c", code, str(HERE / "llmwiki"), str(self.path)],
                                 stdout=subprocess.PIPE, text=True)
            time.sleep(1)
        waited = float(p.communicate(timeout=30)[0])
        self.assertGreater(waited, 0.5)


class ExportLockWait(unittest.TestCase):
    """export.py's wait for the wiki's ingest lock (#659). Nightly used to block on it with no ceiling: one stuck
    ingest run held the whole 30-minute job and the scheduler killed it with no round of work done. The wait now ends
    at the job's own deadline: the export returns a failure instead of blocking, and leaves the offsets alone."""
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home"
        self.wd = self.home / "roles" / "whale"
        self.wd.mkdir(parents=True)
        (self.wd / "diary.md").write_text("2026-10-22 10:00 今天学会了一个新梗\n")
        self.wiki = self.tmp / "wikis" / "whale"
        self.wiki.mkdir(parents=True)
        bots = self.tmp / "bots.json"
        bots.write_text(json.dumps({"whale": {"name": "whale", "project": "whale", "kind": "gemini",
                                             "workdir": str(self.wd), "wiki": str(self.wiki)}}))
        db = sqlite3.connect(self.wiki / ".ingest.sqlite")
        db.execute("create table ingested(id text primary key, offset int, at real)")
        db.execute("create table pending_parts(id text primary key, end int, chunk text, part int)")
        db.execute("insert into ingested values ('abcd1234-keep', 42, 0)")
        db.execute("insert into pending_parts values ('abcd1234-keep', 900, 'half', 1)")
        db.commit()
        db.close()
        self.env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home), WIKI_BOTS=str(bots),
                        WIKI_TRANSCRIPTS=str(self.tmp / "tr"), WIKI_DIR=str(self.wiki))
        for k in ("CC_JOB_DEADLINE", "WIKI_STOP_AT", "WIKI_INGEST"):
            self.env.pop(k, None)

    def hold(self, seconds):
        """Another process holding the ingest lock for `seconds` (an ingest run that will not let go)."""
        code = ("import sys, time; sys.path.insert(0, sys.argv[1]); import filelock\n"
                "f = open(sys.argv[2], 'w'); filelock.lock(f); print('locked', flush=True); time.sleep(float(sys.argv[3]))")
        p = subprocess.Popen([sys.executable, "-X", "utf8", "-I", "-c", code, str(HERE / "llmwiki"), str(self.wiki / ".ingest.lock"),
                              str(seconds)], stdout=subprocess.PIPE, text=True)
        self.addCleanup(p.stdout.close)
        self.addCleanup(p.wait, 30)
        self.addCleanup(p.kill)
        self.assertEqual(p.stdout.readline().strip(), "locked")
        return p

    def state(self):
        db = sqlite3.connect(self.wiki / ".ingest.sqlite")
        try:
            return (db.execute("select id, offset from ingested").fetchall(),
                    db.execute("select id, end, chunk, part from pending_parts").fetchall())
        finally:
            db.close()

    def test_nightly_stops_waiting_at_the_job_deadline(self):
        """The 03:00 case: an old ingest run holds the lock, the job has 3 seconds left. Export gives up there and
        fails the round instead of blocking until the scheduler kills it; offsets and pending parts stay untouched."""
        before = self.state()
        self.hold(60)  # outlives this test: the lock never becomes free
        env = dict(self.env, CC_JOB_DEADLINE=f"{time.time() + 3:.3f}")
        t = time.time()
        p = subprocess.run([sys.executable, "-X", "utf8", "-I", str(HERE / "export.py"), "whale"], env=env,
                           capture_output=True, text=True, timeout=60)
        waited = time.time() - t
        self.assertLess(waited, 15, "export.py should stop at the deadline, not at this test's timeout")
        self.assertEqual(p.returncode, 1)  # the round failed: sub-wiki.py says so and runs ingest on what is there
        self.assertIn("'busy': 1", p.stdout)
        self.assertIn("'failed': 1", p.stdout)
        self.assertIn("ingest lock still held at the job deadline", p.stderr)
        self.assertFalse((self.tmp / "tr" / "whale" / "diary").exists())  # nothing exported
        self.assertEqual(self.state(), before)

    def test_nightly_with_enough_budget_still_waits_and_exports(self):
        """Unchanged behaviour when the lock frees in time: the wait succeeds and the run exports as before."""
        self.hold(1)
        env = dict(self.env, CC_JOB_DEADLINE=f"{time.time() + 120:.3f}")
        p = subprocess.run([sys.executable, "-X", "utf8", "-I", str(HERE / "export.py"), "whale"], env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("'written': 1", p.stdout)
        self.assertNotIn("busy", p.stdout)
        self.assertIn("今天学会了一个新梗", next((self.tmp / "tr" / "whale" / "diary").glob("*.jsonl")).read_text())

    def test_day_run_does_not_wait(self):
        """--no-wait (the day runs, incl. the hook) keeps asking once: no budget spent, no failure counted."""
        self.hold(60)
        env = dict(self.env, CC_JOB_DEADLINE=f"{time.time() + 600:.3f}")
        t = time.time()
        p = subprocess.run([sys.executable, "-X", "utf8", "-I", str(HERE / "export.py"), "--no-wait", "whale"], env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertLess(time.time() - t, 10)
        self.assertEqual(p.returncode, 0)
        self.assertIn("'busy': 1", p.stdout)
        self.assertNotIn("'failed': 1", p.stdout)

    def test_old_llmwiki_without_budget_still_stops(self):
        """The copy the wizard installed before #648/#1562 has no llmwiki/budget.py: export.py must still cap the wait
        (its own NIGHT_WINDOW, the 30 minutes the nightly job already had) instead of failing at import."""
        old = self.tmp / "oldwiki"
        (old / "llmwiki").mkdir(parents=True)
        (old / "llmwiki" / "filelock.py").write_bytes((HERE / "llmwiki" / "filelock.py").read_bytes())
        (old / "export.py").write_bytes((HERE / "export.py").read_bytes())
        self.hold(60)
        probe = ("import sys, time; sys.path.insert(0, sys.argv[1]); import export\n"
                 "export.NIGHT_WINDOW = 2\n"  # the real one is 30 min; same code path, a test-sized value
                 "f = open(sys.argv[2], 'w'); t = time.time()\n"
                 "r = export.lock_or_busy(f, True)\n"
                 "print(export.budget, r, round(time.time() - t, 1))")
        p = subprocess.run([sys.executable, "-X", "utf8", "-I", "-c", probe, str(old), str(self.wiki / ".ingest.lock")],
                           env=self.env, capture_output=True, text=True, timeout=60)
        budget_seen, result, waited = p.stdout.split()
        self.assertEqual((budget_seen, result), ("None", "None"), p.stderr)  # no budget.py, gave up at its own cap
        self.assertLess(float(waited), 10)  # NIGHT_WINDOW=2s plus at most one poll, not the holder's 60s


if __name__ == "__main__":
    unittest.main()
