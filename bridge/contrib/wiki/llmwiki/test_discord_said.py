"""The user's words from Discord by time window (discord_said.py and its use in ingest.dream/reflect/dialog).
Nothing here reads Discord: listing and fetching are injected or patched (派活 2026-10-23「fetch 用注入的」)."""
from unittest import mock
import json, sqlite3, sys, tempfile, time, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir

from test_ingest import Fake, I, jsonl, user
import discord_said as D

UID = "727153614614822942"
T0 = 1_760_000_000.0


def msg(ts, text="", author=UID, att=()):
    iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + ".000000+00:00"
    return {"timestamp": iso, "content": text, "author": {"id": author}, "attachments": list(att)}


class BridgeConfig(unittest.TestCase):
    """2026-10-28 cc-connect → open-source bothouse: ~/.bothouse/config.toml, allow_from instead of admin_from, the
    token itself in the config. No config at all (another machine) is Unavailable, never FileNotFoundError."""

    def use(self, text):
        d = Path(tempfile.mkdtemp(prefix="discord-said-test-"))
        if text is not None:
            (d / "config.toml").write_text(text)
        p = mock.patch.object(D, "CONFIG", d / "config.toml")
        p.start()
        self.addCleanup(p.stop)

    def test_bothouse_shape(self):
        self.use('[[projects]]\n  name = "maomao"\n  team_name = "橘"\n  [[projects.platforms]]\n    type = "discord"\n'
                 '    [projects.platforms.options]\n      allow_bots = "1,2"\n      allow_from = "%s,99"\n'
                 '      token = "MTQ.literal"\n[[projects]]\n  team_name = "龙娘"\n  [[projects.platforms]]\n'
                 '    type = "discord"\n    [projects.platforms.options]\n      token = "MTQ.other"\n' % UID)
        self.assertEqual(D.user_id(), UID)
        self.assertEqual(D.tokens("橘", True), ["MTQ.literal", "MTQ.other"])
        self.assertEqual(D.tokens("龙娘", False), ["MTQ.other"])
        self.assertEqual(D.hubs("橘", True), {})  # no cloud_web platform: nothing to read, no hub token needed

    def test_no_config_is_unavailable(self):
        self.use(None)
        for f in (D.user_id, lambda: D.tokens("橘", True), lambda: D.hubs("橘", True),
                  lambda: D.said(T0, T0 + 1, "橘", True)):
            self.assertRaises(D.Unavailable, f)

    def test_default_path_prefers_bothouse_and_env_overrides(self):
        home = Path(tempfile.mkdtemp(prefix="discord-said-home-"))
        (home / ".cc-connect").mkdir()
        (home / ".cc-connect" / "config.toml").write_text("")
        env = {k: v for k, v in __import__("os").environ.items() if k not in ("WIKI_BRIDGE_CONFIG", "WIKI_CC_CONNECT")}
        with mock.patch.dict("os.environ", {**env, "HOME": str(home)}, clear=True):
            self.assertEqual(D._config_path(), home / ".cc-connect" / "config.toml")  # old machine: cc-connect
            (home / ".bothouse").mkdir()
            (home / ".bothouse" / "config.toml").write_text("")
            self.assertEqual(D._config_path(), home / ".bothouse" / "config.toml")
            with mock.patch.dict("os.environ", {"WIKI_BRIDGE_CONFIG": "/x/cfg.toml"}):
                self.assertEqual(D._config_path(), Path("/x/cfg.toml"))
            with mock.patch.dict("os.environ", {"WIKI_CC_CONNECT": "/y"}):
                self.assertEqual(D._config_path(), Path("/y/config.toml"))


class Said(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp(prefix="discord-said-test-"))
        (d / "config.toml").write_text(
            '[[projects]]\nteam_name = "橘"\nadmin_from = "%s"\n[[projects.platforms]]\ntype = "discord"\n'
            '[projects.platforms.options]\ntoken = "${TOK_A}"\n[[projects.platforms]]\ntype = "cloud_web"\n'
            '[projects.platforms.options]\ntoken = "${TOK_WEB}"\n'
            '[[projects]]\nteam_name = "龙娘"\n[[projects.platforms]]\ntype = "discord"\n'
            '[projects.platforms.options]\ntoken = "${TOK_B}"\n' % UID)
        (d / "secrets.env").write_text("TOK_A=a\nTOK_B=b\nTOK_WEB=w\n")
        p = mock.patch.object(D, "CONFIG", d / "config.toml")
        p.start()
        self.addCleanup(p.stop)

    def test_tokens(self):
        self.assertEqual(D.bot_tokens(), {"橘": "${TOK_A}", "龙娘": "${TOK_B}"})  # cloud_web's token is not a Discord bot
        self.assertEqual(D.tokens("橘", True), ["a", "b"])  # the main wiki: every bot's channels and DMs
        self.assertEqual(D.tokens("龙娘", False), ["b"])  # a sub's wiki: her own

    def test_window_author_commands_images_and_dedup(self):
        chans = {"a": [("g1", "#常规"), ("dm-a", "私聊·Claude橘")], "b": [("g1", "#常规"), ("dm-b", "私聊·龙娘")]}
        hist = {"g1": [msg(T0 - 1, "窗口前"), msg(T0, "第一句"), msg(T0 + 5, "队友说的", author="1"),
                       msg(T0 + 6, "/compact"), msg(T0 + 7, "/Users/x 看下这个"),
                       msg(T0 + 8, att=[{"content_type": "image/png"}]), msg(T0 + 100, "窗口后")],
                "dm-a": [msg(T0 + 9, "私聊一句")], "dm-b": [msg(T0 + 10, "对龙娘说")]}
        reads = []
        def fetch(ch, lo, hi, tok):
            reads.append(ch)
            return hist[ch]
        got = D.said(T0, T0 + 100, "橘", True, list_channels=lambda tok, uid, lo: chans[tok], fetch=fetch,
                     cloud=lambda *a: [D.Msg(T0 + 9.5, "cloud:1", "云端·大厅", "网页说的")])
        self.assertEqual([(m.name, m.text) for m in got],
                         [("#常规", "第一句"), ("#常规", "/Users/x 看下这个"), ("#常规", D.IMAGE),
                          ("私聊·Claude橘", "私聊一句"), ("云端·大厅", "网页说的"), ("私聊·龙娘", "对龙娘说")])
        self.assertEqual(reads.count("g1"), 1)  # a channel both bots see is read once

    def test_deleted_channel_is_empty_other_errors_unavailable(self):
        class E(Exception):
            def __init__(self, code):
                self.code = code
        page = mock.Mock()
        page.fetch.side_effect = E(404)
        with mock.patch.object(D, "_page", return_value=page):
            D.GONE.clear()
            self.assertEqual(D.history("x", T0, T0 + 1, "a"), [])
            self.assertEqual(D.GONE, {"x"})
            page.fetch.side_effect = E(500)
            with self.assertRaises(D.Unavailable):
                D.history("y", T0, T0 + 1, "a")
            page.fetch.side_effect = OSError("network")
            with self.assertRaises(D.Unavailable):
                D.history("y", T0, T0 + 1, "a")


    def test_archived_threads_every_page(self):
        def iso(t):
            return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".000000+00:00"
        pages = [{"threads": [{"id": str(i), "thread_metadata": {"archive_timestamp": iso(T0 + 300 - i)}}
                              for i in range(100)], "has_more": True},
                 {"threads": [{"id": "old", "thread_metadata": {"archive_timestamp": iso(T0 + 50)}},
                              {"id": "older", "thread_metadata": {"archive_timestamp": iso(T0 - 50)}}], "has_more": True}]
        asked = []
        def get(path, tok, data=None):
            asked.append(path)
            return pages[len(asked) - 1]
        with mock.patch.object(D, "_get", get):
            got = D.archived("c", "public", "a", T0)
        self.assertEqual(len(got), 101)  # past the first 100; stops at the first thread archived before lo
        self.assertEqual(len(asked), 2)
        self.assertIn("before=", asked[1])

    def test_cloud_web_by_sender_every_room_every_page(self):
        (D.CONFIG.parent / "config.toml").write_text((D.CONFIG.parent / "config.toml").read_text().replace(
            'token = "${TOK_WEB}"', 'token = "${TOK_WEB}"\nws_url = "wss://hub.example/cloud-web/ws?bot=maomao"'))
        (D.CONFIG.parent / "secrets.env").write_text("TOK_A=a\nTOK_B=b\nTOK_WEB=w\nRH_HUB_TOKEN=h\n")
        def m(i, ts, kind="user", text="话"):
            return {"id": i, "created_at": ts, "author_kind": kind, "text": text}
        pages = {"https://hub.example/api/rooms/1/messages?limit=200":
                     {"messages": [m(5, T0 + 3, text="新的一页"), m(6, T0 + 4, "role", "橘说的")], "has_more": True},
                 "https://hub.example/api/rooms/1/messages?limit=200&before=5":
                     {"messages": [m(3, T0 - 9, text="窗口前"), m(4, T0 + 1, text="第一页")], "has_more": True},
                 "https://hub.example/api/rooms/2/messages?limit=200":
                     {"messages": [m(9, T0 + 2, "system", "系统"), m(10, T0 + 2, text="/new")], "has_more": False}}
        auth = []
        def get(url, tok):
            auth.append((url.split("/api/")[1], tok))
            if url.endswith("/api/rooms?archived=1"):
                return [{"id": 1, "name": "大厅"}, {"id": 2, "name": "旧", "archived_at": T0}]
            return pages[url]
        with mock.patch.dict("os.environ"):
            for k in ("RH_HUB_TOKEN", "TOK_WEB"):
                __import__("os").environ.pop(k, None)
            got = D.cloud_said(T0, T0 + 100, "橘", True, get=get)
        self.assertEqual([(x.name, x.text) for x in got], [("云端·大厅", "新的一页"), ("云端·大厅", "第一页")])
        self.assertEqual(auth[0], ("rooms?archived=1", "h"))  # rooms: the web token; messages: the bot token
        self.assertTrue(all(t == "w" for _, t in auth[1:]))
        with self.assertRaises(D.Unavailable):
            D.cloud_said(T0, T0 + 100, "橘", True, get=mock.Mock(side_effect=OSError("network")))


    # ── review 2026-10-23 (派活「按代码审查结论修复」): each a regression test, fetch injected

    def test_one_bots_403_tries_the_next(self):
        def fetch(ch, lo, hi, tok):
            if tok == "a" or ch == "shut":
                raise D.Forbidden(ch)
            return [msg(T0, "b 读得到")]
        D.GONE.clear()
        got = D.said(T0, T0 + 100, "橘", True, list_channels=lambda tok, uid, lo: [("c1", "#c1"), ("shut", "#shut")],
                     fetch=fetch, cloud=lambda *a: [])
        self.assertEqual([m.text for m in got], ["b 读得到"])  # c1: bot a got 403, bot b read it
        self.assertEqual(D.GONE, {"shut"})  # only when every bot got 403
        D.GONE.clear()

    def test_history_403_is_forbidden_not_empty(self):
        class E(Exception):
            code = 403
        page = mock.Mock()
        page.fetch.side_effect = E()
        with mock.patch.object(D, "_page", return_value=page):
            with self.assertRaises(D.Forbidden):
                D.history("x", T0, T0 + 1, "a")

    def test_listing_cache_must_cover_hi(self):
        calls = []
        def channels(tok, uid, lo):
            calls.append(lo)
            return [] if len(calls) == 1 else [("new", "#new")]
        D._LISTED.clear()
        with mock.patch.object(D, "channels", channels), mock.patch.object(D.time, "time", return_value=T0 + 10):
            self.assertEqual(D._listed("a", UID, T0, T0 + 10), [])
            self.assertEqual(D._listed("a", UID, T0, T0 + 5), [])  # covered: listed after hi
            self.assertEqual(D._listed("a", UID, T0, T0 + 3600), [("new", "#new")])  # hours later: listed again
        self.assertEqual(len(calls), 2)
        D._LISTED.clear()

    def test_only_typed_messages_forwards_and_attachments(self):
        hist = [dict(msg(T0, "置顶了一条"), type=6), dict(msg(T0 + 1, "建帖"), type=18),
                dict(msg(T0 + 2, "回复一句"), type=19), msg(T0 + 3, "普通一句"),
                dict(msg(T0 + 4), message_snapshots=[{"message": {"content": "转发的原文"}}]),
                dict(msg(T0 + 5), message_snapshots=[{"message": {"content": "", "attachments": [{"content_type": "image/jpeg"}]}}]),
                msg(T0 + 6, att=[{"content_type": "application/pdf"}]),
                dict(msg(T0 + 7), message_snapshots=[{"message": {"content": "", "attachments": [], "sticker_items": [{}]}}])]
        got = D.said(T0, T0 + 100, "橘", False, list_channels=lambda tok, uid, lo: [("g", "#g")],
                     fetch=lambda *a: hist, cloud=lambda *a: [])
        self.assertEqual([m.text for m in got], ["回复一句", "普通一句", D.FORWARD, D.FORWARD, D.FILE, D.FORWARD])

    def test_slash_whitelist(self):
        for t in ("/compact", "/new", "/COMPACT", "/model sonnet", "/comp"):
            self.assertTrue(D.is_command(t), t)
        for t in ("/tmp 下面有啥", "/Users/x 看下", "/btw 你看下这个", "/code-review", "/", "/t x"):
            self.assertFalse(D.is_command(t), t)

    def test_cloud_attachment_only(self):
        (D.CONFIG.parent / "config.toml").write_text((D.CONFIG.parent / "config.toml").read_text().replace(
            'token = "${TOK_WEB}"', 'token = "${TOK_WEB}"\nws_url = "wss://hub.example/cloud-web/ws?bot=maomao"'))
        (D.CONFIG.parent / "secrets.env").write_text("TOK_A=a\nTOK_B=b\nTOK_WEB=w\nRH_HUB_TOKEN=h\n")
        def get(url, tok):
            if url.endswith("/api/rooms?archived=1"):
                return [{"id": 1, "name": "大厅"}]
            return {"messages": [{"id": 1, "created_at": T0, "author_kind": "user", "text": "",
                                  "attachments": [{"content_type": "image/png"}]},
                                 {"id": 2, "created_at": T0 + 1, "author_kind": "user", "text": ""}], "has_more": False}
        got = D.cloud_said(T0, T0 + 100, "橘", True, get=get)
        self.assertEqual([m.text for m in got], [D.IMAGE, D.EMPTY])

    def test_private_archived_threads_joined_and_403_logged(self):
        class E(Exception):
            code = 403
        asked = []
        def get(path, tok, data=None):
            asked.append(path)
            raise E()
        D.GONE.clear()
        with mock.patch.object(D, "_get", get):
            self.assertEqual(D.archived("c", "private", "a", T0), [])
        self.assertTrue(asked[0].startswith("/channels/c/users/@me/threads/archived/private?"))
        self.assertEqual(D.GONE, {"archived-private:c"})
        D.GONE.clear()


class InIngest(Fake):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(I, "DISCORD_SOURCE", True)
        p.start()
        self.addCleanup(p.stop)

    def db(self):
        db = sqlite3.connect(":memory:")
        db.execute("create table dreamed(id text primary key, offset int, at real)")
        db.execute("create table alerts(kind text primary key, day text)")
        return db

    def test_bridged_session_quotes_nothing(self):
        p = self.root / "bridge" / "aaaaaaaa.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        jsonl(p, [user("zuiho_kai: 这句只是背景", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))])
        with mock.patch.object(I, "bridged", return_value=True):
            d = I.dialog(p, 0, citations={})
        self.assertEqual((d["quotable"], d["said"]), ([], []))
        self.assertIn("频道 ", d["text"])

    def test_said_lines_cite_channel_and_time(self):
        cites = {}
        lines = I.said_lines([D.Msg(T0, "c1", "#常规", "以后先看原话")], cites)
        hm = time.strftime("%H:%M", time.localtime(T0))
        self.assertEqual(I.citation_text(cites["U1"]), f"{time.strftime('%m-%d', time.localtime(T0))} {hm} #常规「以后先看原话」")
        self.assertTrue(I.QUOTE.search(I.citation_text(cites["U1"])))  # the page budget step still finds it
        self.assertEqual(lines["c1"][1], [f"USER [{time.strftime('%m-%d', time.localtime(T0))} {hm}] U1: 以后先看原话"])

    def run_dream(self, words, model=True):
        db = self.db()
        db.execute("create table dream_window(at real)")
        db.execute("insert into dream_window values (?)", (T0,))
        seen = []
        def fake_words(lo, hi):
            seen.append((lo, hi))
            if isinstance(words, Exception):
                raise words
            return words
        with mock.patch.multiple(I, transcripts=lambda **kw: {}, discard=mock.DEFAULT, notify_dream=mock.DEFAULT,
                                 discord_words=fake_words), \
             mock.patch.object(I, "model_pass", return_value=model) as mp, \
             mock.patch.object(I, "reflect", return_value=False):
            I.dream(db, time.time() + 3600)
        return db.execute("select max(at) from dream_window").fetchone()[0], seen, mp

    def test_dream_window_moves_only_when_read(self):
        words = [D.Msg(T0 + 1, "c1", "#常规", "以后先看原话")]
        at, seen, mp = self.run_dream(words, model=False)
        self.assertEqual(seen[0][0], T0)  # starts where the last read window ended
        self.assertEqual(at, T0)  # failed: the start stays, no gap next night
        self.assertIn("以后先看原话", mp.call_args.kwargs["context"])
        at, seen, _ = self.run_dream(words, model=True)
        self.assertEqual(at, seen[0][1])  # passed: next window starts at this one's end
        at, seen, mp = self.run_dream([], model=True)
        self.assertEqual(at, seen[0][1])  # nothing said: the window is read
        mp.assert_not_called()

    def test_dream_skips_when_discord_unreadable(self):
        at, _, mp = self.run_dream(D.Unavailable("network"))
        self.assertEqual(at, T0)
        mp.assert_not_called()
        self.assertIn("dream: skipped, Discord history unavailable", I.LOG.read_text())

    def test_reflect_fails_without_discord(self):
        db = self.db()
        with mock.patch.multiple(I, transcripts=lambda **kw: {}, discord_words=mock.Mock(side_effect=D.Unavailable("x"))), \
             mock.patch.object(I, "model_pass") as mp:
            with self.assertRaises(D.Unavailable):
                I.reflect(db, time.time() + 3600)
        mp.assert_not_called()
        self.assertIsNone(db.execute("select max(at) from reflect_nights").fetchone()[0])


    def test_discord_item_header_is_citable(self):
        it = {"id": "discord:123", "head": "#常规", "title": "Discord #常规", "cwd": None, "date": "2026-10-23",
              "text": "USER [10-23 01:00] U1: x"}
        piece = I.batches_of([it])[0][0][1]
        self.assertTrue(piece.startswith("=== SESSION #常规 | "), piece[:40])
        self.assertNotIn("discord:", piece.split("\n")[0])

    def test_bridge_guessed_user_backs_no_candidate(self):
        p = self.root / "bridge" / "bbbbbbbb.jsonl"
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        jsonl(p, [user("zuiho_kai: 你又加了没要的开关", ts), user("zuiho_kai: 你又加了没要的开关！", ts)])
        cites = {}
        with mock.patch.object(I, "bridged", side_effect=lambda q: q.parent.name == "bridge"):
            d = I.dialog(p, 0, citations=cites)
            known = I.countable([p, self.root / "proj" / "cccccccc.jsonl"], {"bbbbbbbb": d["user"]})
        self.assertEqual((cites, d["user"], d["quotable"]), ({}, "", []))  # no U number, nothing quotable
        self.assertNotIn("bbbbbbbb", known)
        self.assertIn("cccccccc", known)
        block = "- 加了用户没要的开关：出现 N 次\n  - 10-23 bbbbbbbb「你又加了没要的开关」"
        self.assertEqual(I.occurrences(block, known), set())  # the bridge text counts nothing

    def test_quote_check_window_crosses_midnight(self):
        p = self.root / "bridge" / "dddddddd.jsonl"
        first = time.mktime(time.strptime("2026-10-23 00:00:30", "%Y-%m-%d %H:%M:%S"))
        iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))
        jsonl(p, [user("zuiho_kai: 别这样", iso(first))])
        said = [D.Msg(first - 40, "c", "#c", "别再加没要的开关")]  # 23:59:50 the night before
        asked = []
        def words(lo, hi):
            asked.append((lo, hi))
            return [m for m in said if lo <= m.ts < hi]
        with mock.patch.object(I, "bridged", return_value=True), mock.patch.object(I, "discord_words", words):
            bad = I.bad_quotes(["- 用户说「别再加没要的开关」"], lambda: "", [p])
        self.assertTrue(asked)
        self.assertEqual(bad, [])
        with mock.patch.object(I, "bridged", return_value=True), mock.patch.object(I, "discord_words", words), \
             mock.patch.object(I, "QUOTE_LEAD", 0):
            self.assertEqual(I.bad_quotes(["- 用户说「别再加没要的开关」"], lambda: "", [p]), ["「别再加没要的开关」"])  # the check bites


if __name__ == "__main__":
    unittest.main()
