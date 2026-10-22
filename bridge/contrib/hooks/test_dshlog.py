#!/usr/bin/env python3
"""Tests of dshlog.py (DSH session logs, plain or zstd) and of its readers wiki/export.py and tools/peek.py.
The zstd logs are written by node's zlib, one frame per record as DSH's dsh-session-persistence-jsonl appends
them; the zstd tests are skipped when node has no zlib zstd. Which decoder runs depends on the Python: 3.14 uses
compression.zstd, an older one with the zstandard module uses that, else node.
Run: python3 -I bridge/contrib/hooks/test_dshlog.py"""
import importlib.util, json, os, shutil, subprocess, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRIB = os.path.dirname(HERE)


def load(name, path, env=None):
    old = {k: os.environ.get(k) for k in (env or {})}
    os.environ.update(env or {})
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


dshlog = load("dshlog", os.path.join(HERE, "dshlog.py"))


def node_zstd():
    node = shutil.which("node")
    if not node:
        return False
    r = subprocess.run([node, "-e", "process.exit(require('zlib').zstdCompressSync ? 0 : 1)"], capture_output=True)
    return r.returncode == 0


HAVE_ZSTD = node_zstd()


def zstd_frames(lines):
    """One zstd frame per line (each with its newline), concatenated."""
    js = ("const z=require('zlib'),fs=require('fs');const ls=JSON.parse(fs.readFileSync(0,'utf8'));"
          "process.stdout.write(Buffer.concat(ls.map(l=>z.zstdCompressSync(l+'\\n'))))")
    return subprocess.run(["node", "-e", js], input=json.dumps(lines).encode(), capture_output=True, check=True).stdout


def session_lines(sid, cwd, depth=0):
    t = 1792647860000
    recs = [{"type": "session", "version": 4, "id": sid, "cwd": cwd, "delegationDepth": depth},
            {"type": "turn/start", "seq": 0, "time": t, "data": {"turn": 1}},
            {"type": "user/message", "seq": 1, "time": t + 1,
             "data": {"content": [{"type": "text", "text": "跑一下 echo hi"}], "source": {"kind": "user"}}},
            {"type": "tool/call", "seq": 2, "time": t + 2,
             "data": {"callId": "c1", "name": "bash", "arguments": json.dumps({"command": "echo hi"})}},
            {"type": "tool/result", "seq": 3, "time": t + 3,
             "data": {"message": {"toolCallId": "c1", "content": [{"type": "text", "text": "hi"}], "isError": False}}},
            {"type": "assistant/message", "seq": 4, "time": t + 4,
             "data": {"message": {"content": [{"type": "text", "text": "输出是 hi。"}]}}},
            {"type": "turn/end", "seq": 5, "time": t + 5, "data": {"turn": 1}}]
    return [json.dumps(r, ensure_ascii=False) for r in recs]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.home = os.path.join(self.tmp, "dsh")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write(self, sid, lines, zstd, cwd_slug="-work", raw=None):
        d = os.path.join(self.home, "sessions", cwd_slug, sid)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "session.v4.jsonl" + (".zstd" if zstd else ""))
        with open(p, "wb") as f:
            f.write(raw if raw is not None else zstd_frames(lines) if zstd else ("\n".join(lines) + "\n").encode())
        return p


class ReadLines(Base):
    def test_plain(self):
        lines = session_lines("s1", "/work")
        p = self.write("s1", lines, zstd=False)
        self.assertEqual(dshlog.read_lines(p), lines)
        self.assertEqual(dshlog.read_lines(p, head=True), lines[:1])

    @unittest.skipUnless(HAVE_ZSTD, "node without zlib zstd")
    def test_zstd_many_frames(self):
        lines = session_lines("s1", "/work")
        p = self.write("s1", lines, zstd=True)
        with open(p, "rb") as f:
            self.assertEqual(f.read().count(b"\x28\xb5\x2f\xfd"), len(lines))  # one frame per line
        self.assertEqual(dshlog.read_lines(p), lines)
        self.assertEqual(dshlog.read_lines(p, head=True), lines[:1])

    @unittest.skipUnless(HAVE_ZSTD, "node without zlib zstd")
    def test_zstd_last_frame_still_being_written(self):
        lines = session_lines("s1", "/work")
        whole = zstd_frames(lines)
        last = zstd_frames(lines[-1:])
        p = self.write("s1", lines, zstd=True, raw=whole[: len(whole) - len(last) // 2])
        self.assertEqual(dshlog.read_lines(p), lines[:-1])

    @unittest.skipUnless(HAVE_ZSTD, "node without zlib zstd")
    def test_zstd_broken_frame_keeps_what_came_before(self):
        lines = session_lines("s1", "/work")
        p = self.write("s1", lines, zstd=True, raw=zstd_frames(lines[:2]) + b"\x28\xb5\x2f\xfd" + b"\xff" * 40)
        self.assertEqual(dshlog.read_lines(p), lines[:2])

    def test_bad_files_do_not_raise(self):
        cases = {"garbage": b"not zstd at all\n" * 10, "empty": b"", "magic only": b"\x28\xb5\x2f\xfd"}
        for name, raw in cases.items():
            p = self.write(name.replace(" ", "-"), [], zstd=True, raw=raw)
            self.assertEqual(dshlog.read_lines(p), [], name)
            self.assertEqual(dshlog.read_lines(p, head=True), [], name)
        self.assertEqual(dshlog.read_lines(os.path.join(self.tmp, "missing.jsonl.zstd")), [])
        self.assertEqual(dshlog.read_lines(os.path.join(self.tmp, "missing.jsonl")), [])
        p = self.write("badutf8", [], zstd=False, raw=b'{"type":"session"}\n\xff\xfe\n')
        self.assertEqual(len(dshlog.read_lines(p)), 2)


class Find(Base):
    @unittest.skipUnless(HAVE_ZSTD, "node without zlib zstd")
    def test_mixed_directory(self):
        a = self.write("a", session_lines("a", "/work"), zstd=False)
        b = self.write("b", session_lines("b", "/work"), zstd=True)
        c = self.write("c", session_lines("c", "/other"), zstd=True, cwd_slug="-other")
        self.assertEqual(dshlog.session_logs(self.home), sorted([a, b, c]))
        self.assertEqual(dshlog.session_file(self.home, "a"), a)
        self.assertEqual(dshlog.session_file(self.home, "b"), b)
        self.assertIsNone(dshlog.session_file(self.home, "nope"))
        self.assertIsNone(dshlog.session_file(self.home, ""))

    @unittest.skipUnless(HAVE_ZSTD, "node without zlib zstd")
    def test_both_encodings_in_one_session_the_newer_wins(self):
        old = self.write("s", session_lines("s", "/work"), zstd=False)
        new = self.write("s", session_lines("s", "/work"), zstd=True)
        t = time.time()
        os.utime(old, (t - 60, t - 60))
        os.utime(new, (t, t))
        self.assertEqual(dshlog.session_logs(self.home), [new])
        self.assertEqual(dshlog.session_file(self.home, "s"), new)
        os.utime(old, (t + 60, t + 60))
        self.assertEqual(dshlog.session_logs(self.home), [old])

    def test_no_sessions(self):
        self.assertEqual(dshlog.session_logs(self.home), [])


@unittest.skipUnless(HAVE_ZSTD, "node without zlib zstd")
class Readers(Base):
    """wiki/export.py and tools/peek.py give the same result for a plain log and its zstd copy."""

    def pair(self):
        plain = Base.write(self, "p", session_lines("p", "/work"), zstd=False, cwd_slug="-plain")
        packed = Base.write(self, "z", session_lines("p", "/work"), zstd=True, cwd_slug="-zstd")
        bad = Base.write(self, "bad", [], zstd=True, raw=b"junk", cwd_slug="-bad")
        return plain, packed, bad

    def test_export(self):
        exp = load("export", os.path.join(CONTRIB, "wiki", "export.py"),
                   {"WIKI_BOTS": os.path.join(self.tmp, "no-bots.json"), "WIKI_TRANSCRIPTS": self.tmp})
        plain, packed, bad = self.pair()
        self.assertEqual(exp.dsh_meta(plain), exp.dsh_meta(packed))
        self.assertEqual(exp.dsh_meta(bad), {})
        recs = exp.dsh_records(plain, "/work")
        self.assertTrue(any(r["type"] == "user" for r in recs), recs)
        self.assertEqual(exp.dsh_records(packed, "/work"), recs)
        self.assertEqual(exp.dsh_records(bad, "/work"), [])
        found = exp.dsh_sessions(self.home, "/work")
        self.assertEqual(list(found), ["p"])  # same id twice: one of them; the broken file is skipped
        self.assertIn(str(found["p"]), (plain, packed))

    @unittest.skipIf(sys.version_info < (3, 11), "peek needs tomllib (Python 3.11+)")
    def test_peek(self):
        peek = load("peek", os.path.join(CONTRIB, "tools", "peek.py"))
        plain, packed, bad = self.pair()
        self.assertEqual(peek.dsh_steps(packed), peek.dsh_steps(plain))
        self.assertEqual([s[2:] for s in peek.dsh_steps(packed)], [("bash", "echo hi")])
        self.assertEqual(peek.dsh_turn(packed), peek.dsh_turn(plain))
        self.assertEqual(peek.dsh_steps(bad), [])
        t = time.time()
        os.utime(plain, (t - 60, t - 60))
        os.utime(packed, (t, t))
        bot = {"kind": "dsh", "work_dir": "/work", "opts": {"env": {"DSH_HOME": self.home}}, "env": {}}
        self.assertEqual(peek.session_for(bot), packed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
