#!/usr/bin/env python3 -I
"""Seconds-fast checks of ingest.py / lint.py on fake data (temp git repos, fake transcripts); no model calls.

  python3 -I bin/test_ingest.py
"""
from unittest import mock
import json, os, re, sqlite3, subprocess, sys, tempfile, time, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# never the real session record: a test that reaches sessionlog.sync() reads and writes a temp store
os.environ["AGENT_SESSIONS_DIR"] = tempfile.mkdtemp(prefix="sessionlog-test-")
os.environ["WIKI_BRIDGE_CONFIG"] = "/nonexistent-bridge-config"  # the four fallback bots, not the machine's roster
os.environ["WIKI_CC_CONNECT"] = "/nonexistent-cc-connect"  # never the machine's Discord tokens: no test reads Discord
import ingest as I
I.DISCORD_SOURCE = False  # these tests feed bridge text; the Discord source has its own tests (DiscordSource)
I.ASSISTANT = "橘"
I.BOTS.clear()
I.BOTS.update({"橘": ("Claude橘", "橘"), "龙娘": ("龙娘",), "鲸鱼娘": ("鲸鱼娘",), "彩虹猫": ("彩虹猫",)})
I.ASSISTANT_NAMES = I.BOTS[I.ASSISTANT]
I.TEAMMATES = tuple(n for bot, names in I.BOTS.items() if bot != I.ASSISTANT for n in names)
I.USER_NAMES = ("zuiho_kai",)
I.BRIDGE_DIRS = ("im-bridge", *I.BRIDGE_DIRS)
# every test logs to a temp file: a class without Fake's setUp (Speakers) wrote its 「reflect h: skipped … missing.toml」
# lines into the real ~/wiki/.ingest.log on 2026-10-23 (and read them back from there)
_LOG_DIR = tempfile.mkdtemp(prefix="ingest-test-log-")
I.ROLES_TOML = Path(_LOG_DIR) / "roles.toml"
I.ROLES_TOML.write_text('[[roles]]\nname = "橘"\n[[roles]]\nname = "龙娘"\n[[roles]]\nname = "鲸鱼娘"\n')
I.LOG = Path(_LOG_DIR) / "ingest.log"


def tearDownModule():
    subprocess.run(["rm", "-rf", _LOG_DIR])


import lint
import sessionlog

PAGE = """---
name: {name}
description: d
metadata:
  scope: s
---

# T
## 现状
{body}
"""


def sh(cwd, *cmd):
    subprocess.run(cmd, cwd=cwd, check=True, capture_output=True)


def jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def user(text, ts="2026-10-17T01:00:00Z"):
    return {"type": "user", "timestamp": ts, "message": {"content": text}}


def claude(text, ts="2026-10-17T01:00:01Z"):
    return {"type": "assistant", "timestamp": ts, "message": {"content": [{"type": "text", "text": text}]}}


class Fake(unittest.TestCase):
    """A temp wiki git repo (WIKI = REPO) and a temp transcript root."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wikitest-"))
        self.w, self.root = self.tmp / "wiki", self.tmp / "projects"
        (self.w / "tooling").mkdir(parents=True)
        (self.w / "log.md").write_text("# log\n")
        (self.w / "MEMORY.md").write_text("- [tooling](tooling/README.md) — t\n")
        sh(self.w, "git", "init", "-q")
        sh(self.w, "git", "config", "user.email", "t@t")
        sh(self.w, "git", "config", "user.name", "t")
        self.keep = {k: getattr(I, k) for k in ("WIKI", "REPO", "WORK", "ROOT", "HOSTS", "LOG", "STATE", "USAGE")}
        self.invalidate = mock.patch.object(I.invalidate, "run", return_value=[])
        self.invalidate.start()
        I.WIKI = I.REPO = self.w
        I.ROOT, I.HOSTS, I.LOG = self.root, self.tmp / "hosts", self.tmp / "ingest.log"
        I.USAGE = self.tmp / "usage.tsv"
        I.STATE = self.tmp / "s.sqlite"  # never the real .ingest.sqlite (Candidates' I.state() wrote its fails there)

    def tearDown(self):
        self.invalidate.stop()
        for k, v in self.keep.items():
            setattr(I, k, v)
        subprocess.run(["rm", "-rf", str(self.tmp)])

    def page(self, rel, body):
        p = self.w / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(PAGE.format(name=p.stem, body=body))

    def commit(self, msg):
        sh(self.w, "git", "add", "-A")
        sh(self.w, "git", "commit", "-qm", msg)
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.w, capture_output=True, text=True).stdout.strip()


class Speakers(unittest.TestCase):
    BLOCK = ("（频道里你上次看到之后的消息，按时间顺序；这是真实记录，先读它再回答）\n"
             "[10:00] zuiho_kai: 没问题，同时增加sop\n[10:01] Claude橘: 好\n[10:02] 鲸鱼娘（bot）: 嗯\n\n"
             "（最新，回这条）\n你看一下")

    def test_gate_notes_are_not_user_words(self):
        # 4ea4ab33 L443 (dream fc2e847 quoted the note as the user's), 61f4a58f L3, 65f1e083 L3: the gate's notes
        rec = ("[Bridge identity — current responder]\nYour conversation name is \"橘\".\n[Request and reference material]\n"
               "（队友状态，系统自动附上，不用回应）\n鲸鱼娘：在#创业忙了 3 分钟 「修复」\n\n"
               "（可能相关的 wiki 页，需要时去读）\n- ~/wiki/x.md — x\n\n"
               "（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）\n"
               "[replying to Claude橘: 已经派人去查，分四块：\n- 24 小时指数期权\n\n*claude-opus-5-5 · out 2.5k\n~/im-bridge/claude*]\n什么进度")
        self.assertEqual(I.speakers(rec), [("USER", "什么进度")])
        latest = "（最新，回这条）\n（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）\n你干活"
        self.assertEqual(I.speakers(latest), [("USER", "你干活")])
        err = ("（最新，回这条）\n（队友 鲸鱼娘 报错了。你是负责人：查原因，告诉用户，必要时换人接手）\n"
               "【鲸鱼娘】❌ 错误: acp: prompt did not complete successfully")
        self.assertEqual(I.speakers(err), [("TEAM 鲸鱼娘", "【鲸鱼娘】❌ 错误: acp: prompt did not complete successfully")])

    def test_nested_handoff_end_is_not_the_end(self):
        # 61f4a58f L3 (shape kept, text shortened): the handoff copies an old record that holds an earlier handoff's
        # 「（交接结束）」 (its head cut by "…"); the lazy match stopped there and the rest of the copy came out as USER
        rec = ("[Bridge identity — current responder]\nYour conversation name is \"橘\".\n[Request and reference material]\n"
               "（队友状态，系统自动附上，不用回应）\n龙娘：空闲\n\n"
               "（新会话。上一个会话 3dec0286 已换掉（用户发了 /new）。下面是从旧会话记录里原样取的交接）\n\n"
               "## 之后的对话（按时间顺序，只含文字，不含工具输出）\n"
               "[10-21 21:17 消息] …lder/wiki-media 都在同一目录。）\n"
               "[10-21 20:02 你] 【结论】视频已经转写完。\n\n【要你做的】无。\n（交接结束）\n\n"
               "（频道里你上次看到之后的消息，按时间顺序，都是本条消息之前的旧消息；这是真实记录，先读它再回答）\n"
               "[21:17，不到 1 分钟前] Claude橘（你这个账号，但不是你在会话里写的，如定时任务输出）: ⏰ 核对下载\n\n"
               "（定时任务，回这条）\n检查甲骨文 merge.log\n"
               "[10-22 10:00 消息] …e is \"橘\" (project \"maomao\"), as configured by the operator.\n"
               "[Request and reference material]\n（最新，回这条）\n[replying to Claude橘: ]\n"
               "[10-22 10:07 你] 【结论】都停了。\n\n【要你做的】无。\n（交接结束）\n\n"
               "（频道里你上次看到之后的消息，按时间顺序，都是本条消息之前的旧消息；这是真实记录，先读它再回答）\n"
               "[02:11] zuiho_kai: 写一个稿子\n\n"
               "（最新，回这条）\n（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）\n你干活")
        self.assertEqual(I.speakers(rec), [("补漏 USER", "写一个稿子"), ("USER", "你干活")])

    def test_handoff_cut_does_not_anchor_on_entry_lines(self):
        # review 2026-10-23 /tmp/rv-bridge2/repro.py A–F: the cut ends at the last 「（交接结束）」 that a block header follows
        h = ("（新会话。上一个会话 abc 已换掉（/new）。下面是交接）\n\n## 之后的对话（按时间顺序，只含文字，不含工具输出）\n"
             "[10-21 20:01 消息] 旧的用户话\n[10-21 20:02 你] 旧的回复\n（交接结束）\n\n")
        said = "你看这句：\n[10-20 09:00 你] 我说过要改\n为什么没改"
        self.assertEqual(I.speakers(h + said), [("USER", said)])  # A: the user pastes an entry-like line
        self.assertEqual(I.speakers(h + "（最新，回这条）\n" + said), [("USER", said)])  # A2
        own = "上次的：\n[10-20 09:00 你] 好\n（交接结束）\n后面是要求"  # B: entry-like line and an own end line
        self.assertEqual(I.speakers(h + "（最新，回这条）\n" + own), [("USER", own)])
        hc = ("（新会话。上一个会话 abc 已换掉（/new）。下面是交接）\n\n## 之后的对话\n[10-21 20:01 消息] 交接块怎么结尾\n"
              "[10-21 20:02 你] 最后一行是\n（交接结束）\n这样桥就知道到头了\n（交接结束）\n\n")
        self.assertEqual(I.speakers(hc + "（最新，回这条）\n好的"), [("USER", "好的")])  # C: an end line in the last entry
        hd = ("（新会话。上一个会话 abc 已换掉（/new）。下面是交接）\n\n## 旧会话 10-21 20:00 压缩时自动生成的摘要\n"
              "讨论了交接块，结尾是\n（交接结束）\n然后改了 ingest\n\n（交接结束）\n\n")
        self.assertEqual(I.speakers(hd + "（最新，回这条）\n好的"), [("USER", "好的")])  # D: an end line in the summary
        # no end line at all: up to the first block header; no header either: kept whole
        self.assertEqual(I.speakers("（新会话。上一个会话 abc 已换掉）\n[10-21 20:02 你] 好\n\n（最新，回这条）\n好的"),
                         [("USER", "好的")])
        self.assertEqual(I.speakers("（新会话。我自己写的开头\n好的"), [("USER", "（新会话。我自己写的开头\n好的")])

    def test_saved_trailer_only_as_its_own_paragraph(self):
        # E: acp's image-only stand-in (agent/acp/session.go:799/:802) is not the user's words
        self.assertEqual(I.speakers("User sent image(s).\n\n(Image files saved locally: /tmp/a.png)"), [])
        # F: the user's own sentence ending in an ASCII-paren look-alike stays
        f = "看这个 (Files saved locally, please read them: 是什么意思)"
        self.assertEqual(I.speakers("（最新，回这条）\n" + f), [("USER", f)])
        self.assertEqual(I.speakers("看图\n\n(Images also saved locally: /a.png)\n\n(Files saved locally, please read"
                                    " them: /b.pdf)"), [("USER", "看图")])
        self.assertEqual(I.speakers("(Files saved locally, please read them: /b.pdf)"), [])

    def test_users_own_handoff_end_line_is_kept(self):
        # review 2026-10-23 (/tmp/rv-bridge/repro.py case 1): the user writes a line 「（交接结束）」 in the first turn after
        # a handoff; the greedy match ate everything before it
        h = "（新会话。上一个会话 abc 已换掉（/new）。下面是交接）\n## 之后的对话\n[10-21 20:02 你] 好\n（交接结束）\n\n"
        self.assertEqual(I.speakers(h + "（最新，回这条）\n我先贴一段：\n（交接结束）\n后面是我的要求"),
                         [("USER", "我先贴一段：\n（交接结束）\n后面是我的要求")])

    def test_teammate_name_with_regex_chars(self):
        # a team_name like 「C++娘」 went into the 【名字】 pattern unescaped: re.error on every speakers() call
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "config.toml"
            cfg.write_text('[[projects]]\nteam_name = "C++娘"\n[[projects]]\nteam_name = \'(单引号\'\n')
            bots = I.load_bots(cfg)
        self.assertIn("C++娘", bots)
        self.assertIn("(单引号", bots)
        old = I.TEAMMATES
        I.TEAMMATES = old + ("C++娘", "(单引号")
        try:
            self.assertEqual(I.speakers("（最新，回这条）\n【C++娘】做完了"), [("TEAM C++娘", "【C++娘】做完了")])
            self.assertEqual(I.speakers("（最新，回这条）\n你看看"), [("USER", "你看看")])
        finally:
            I.TEAMMATES = old

    def test_saved_locally_notes_are_cut(self):
        # bridge agent/claudecode/session.go:1171/:1174 and agent/acp/session.go:802 append these to the prompt;
        # 鲸鱼娘's commit 0695717 had to strip one from a quote by hand
        rec = ("（最新，回这条）\n这张图里的按钮颜色不对\n\n"
               "(Images also saved locally: /Users/u/im-bridge/claude/.cc-connect/attachments/img_1_0.jpg, /x/img_1_1.png)")
        self.assertEqual(I.speakers(rec), [("USER", "这张图里的按钮颜色不对")])
        acp = "看一下\n\n(Image files saved locally: /tmp/a/img_2_0.png)\n\n(Files saved locally, please read them: /tmp/a/v.mp4)"
        self.assertEqual(I.speakers(acp), [("USER", "看一下")])
        self.assertEqual(I.speakers("Please analyze the attached image(s).\n\n(Images also saved locally: /tmp/img.png)"), [])
        # only a trailer: a mention mid-text is the user's
        mid = "日志里写着 (Images also saved locally: /tmp/x.png) 这是啥"
        self.assertEqual(I.speakers(mid), [("USER", mid)])
        src = "[Image: source: /private/tmp/claude-501/p/s/images/1.png, original 1200x5574, displayed at 431x2000.]\n这是截图"
        self.assertEqual(I.speakers(src), [("USER", "这是截图")])
        self.assertEqual(I.speakers(src, bridge=False), [("USER", "这是截图")])

    def test_empty_message_stand_in_is_dropped(self):
        # backfill.go's 「（空消息或只有附件）」 for an empty channel message; seen as zuiho_kai's, 岚汐's and self lines
        rec = ("（频道里你上次看到之后的消息，按时间顺序；这是真实记录，先读它再回答）\n"
               "[11:06，8 分钟前] 岚汐（你这个账号，但不是你在会话里写的，如定时任务输出）: （空消息或只有附件）\n"
               "[11:07] zuiho_kai: （空消息或只有附件）\n[11:08] zuiho_kai: 暂停一下\n\n"
               "（最新，回这条）\n你看一下")
        self.assertEqual(I.speakers(rec), [("补漏 USER", "暂停一下"), ("USER", "你看一下")])

    def test_attachment_note_is_cut(self):
        # backfill.go:318-335 appends 「（附图 N 张（已随本条附上））」 to the line (3d74d365:2 alone, bd358a8e:2 after text)
        rec = ("（频道里你上次看到之后的消息，按时间顺序，都是本条消息之前的旧消息；这是真实记录，先读它再回答）\n"
               "[10:01，12 分钟前] zuiho_kai: （附图 5 张（已随本条附上））\n"
               "[10:02，11 分钟前] zuiho_kai: @龙娘 你定位一下newapi那边（附图 1 张（已随本条附上））\n"
               "[10:03，10 分钟前] zuiho_kai: 两张图（附图 1 张（已随本条附上）；1 张图片未附上（超出图片预算））\n"
               "[10:04，9 分钟前] zuiho_kai: 我说（附图 2 张）是这样\n\n"
               "（最新，回这条）\n你看一下")
        self.assertEqual(I.speakers(rec), [("补漏 USER", "@龙娘 你定位一下newapi那边"), ("补漏 USER", "两张图"),
                                           ("补漏 USER", "我说（附图 2 张）是这样"), ("USER", "你看一下")])

    def test_roster_comes_from_bridge_config(self):
        # 岚汐 joined 2026-10-22 as a [[projects]] team_name; df0cd8be:12 had 「【岚汐】❌ 错误…」 come out as USER
        with tempfile.TemporaryDirectory() as d:
            cfg = Path(d) / "config.toml"
            cfg.write_text('[[projects]]\nname = "maomao"\nteam_name = "橘"\n\n[[projects]]\nname = "minimax"\n'
                           'team_name = "岚汐"\n')
            self.assertEqual(I.load_bots(cfg)["岚汐"], ("岚汐",))
            self.assertEqual(I.load_bots(cfg)["橘"], ("橘",))
            self.assertEqual(I.load_bots(Path(d) / "missing.toml"), I.BOTS_FALLBACK)
            out = json.loads(ingest_with(d, "import json; print(json.dumps([I.TEAMMATES, I.speakers("
                                            "'（最新，回这条）\\n（队友 岚汐 报错了。你是负责人：查原因，告诉用户，必要时换人接手）\\n"
                                            "【岚汐】❌ 错误: json-rpc -32603: Internal error')]))", bridge_config=cfg))
        self.assertEqual(out, [["橘", "岚汐"],
                               [["TEAM 岚汐", "【岚汐】❌ 错误: json-rpc -32603: Internal error"]]])

    def test_bare_hex_key_is_redacted(self):
        # df0cd8be:5 「@鲸鱼娘 <64 hex> 是这个key么」 (fake key here); a 40-hex git hash stays
        key, sha = "0123456789abcdef" * 4, "6a1c126" + "0" * 33
        got = I.SECRET.sub(lambda m: (m.group(3) or "") + "[REDACTED]", f"@鲸鱼娘 {key} 是这个key么 commit {sha}")
        self.assertEqual(got, f"@鲸鱼娘 [REDACTED] 是这个key么 commit {sha}")

    def test_discord_token_any_first_letter_is_redacted(self):
        # review 2026-10-23 #5: bot ids grew past the M/N range; an O-led token (fake here) leaked
        for c in "MNO":
            tok = c + "TQ3MjE1MzYxNDYxNDgyMjk0Mg" + ".Gabcde." + "x" * 38
            self.assertEqual(I.SECRET.sub("[REDACTED]", "key " + tok), "key [REDACTED]")

    def test_household_prompt_keeps_the_users_lines(self):
        # review 2026-10-23 #4: role-household (rh/meeting.py:203-224) prompts over `claude -p`; its 「用户说「…」」 /
        # 「用户：…」 lines are the user's voice or typed words, the roles' lines are not (real formats, ju/mao/jing)
        rec = ("[频道新消息]\n用户说「@橘 换版验收：只回一句「平台通了」就行」\n橘说「我是橘」\n用户说「两行\n第二行」\n"
               "鲸鱼娘说「哼……」（话没说完就被用户打断了）\n\n轮到你了。只输出你要说的话本身")
        self.assertEqual([x for x in I.said_by(I.PROGRAM, rec) if x[0] == "USER"],
                         [("USER", "@橘 换版验收：只回一句「平台通了」就行"), ("USER", "两行\n第二行")])
        rec = "[频道新消息]\n用户：猫和狗？\n橘：猫。\n用户：等下\n鲸鱼娘：猫啦\n\n轮到你（彩虹猫）发言了，直接说你要说的话。"
        got = I.said_by(I.PROGRAM, rec)
        self.assertEqual([t for l, t in got if l == "USER"], ["猫和狗？", "等下"])
        self.assertTrue(all("猫啦" not in t and "猫。" not in t for l, t in got if l == "USER"))
        # meeting.py always closes 「…」: a known speaker's line starts a message only after the one before it closed
        # (a line in the user's text that starts 「橘说「」 stays theirs); a dispatched brief quoting 用户说「…」 stays SYSTEM
        self.assertEqual(I.said_by(I.PROGRAM, "[频道新消息]\n用户说「没关上\n橘说「我的」\n\n轮到你")[1],
                         ("USER", "没关上\n橘说「我的"))
        self.assertEqual(I.said_by(I.PROGRAM, "【免审:调研】\n用户说「改」"), [("SYSTEM", "【免审:调研】\n用户说「改」")])
        with tempfile.TemporaryDirectory() as d:
            q = Path(d) / "-Users-zuiho-code-role-household-data-sessions-ju" / "h.jsonl"
            jsonl(q, [dict(user("[频道新消息]\n用户说「晚安」\n鲸鱼娘说「哼」\n\n轮到你了。"), entrypoint="sdk-cli")])
            self.assertEqual(I.dialog(q, 0)["said"], ["晚安"])

    def test_review3_household_closed_speaker_set(self):
        # review 2026-10-23 B (/tmp/rv-dream3/p.py E–J): speakers are 「用户」 (meeting.py:135) and roles.toml's [[roles]]
        # names only; a message runs to the next speaker line (or a note, or the closing 「\n\n轮到你」)
        H = lambda r: I.said_by(I.PROGRAM, r)
        U = lambda r: [t for l, t in H(r) if l == "USER"]
        self.assertEqual(U("[频道新消息]\n用户说「看这个\n注意：别删\n好了」\n橘说「嗯」\n\n轮到你了。"), ["看这个\n注意：别删\n好了"])  # E
        self.assertEqual(U("[频道新消息]\n用户说「总结下」\n橘说「好的\n用户：要猫\n鲸鱼娘：要狗」\n\n轮到你了。"), ["总结下"])  # F
        self.assertEqual(U("[频道新消息]\n用户说「他说「好」\n然后呢」\n橘说「嗯」\n\n轮到你了。"), ["他说「好」\n然后呢"])  # G
        self.assertEqual(H("[频道新消息]\n（你上次想说「用户：哈」，但用户先开口了，这句没说出去，大家都没听到。）\n用户说「停」\n\n轮到你了。"),
                         [("SYSTEM", "[频道新消息]\n（你上次想说「用户：哈」，但用户先开口了，这句没说出去，大家都没听到。）"),
                          ("USER", "停"), ("SYSTEM", "轮到你了。")])  # H
        self.assertEqual(U("[频道新消息]\n用户：一\n（你上一句只说出了「啊」就被用户打断了，后面的大家没听到。）\n\n轮到你"), ["一"])  # I
        self.assertEqual(U("[频道新消息]\n用户说「段一\n\n段二」\n橘说「嗯」\n\n轮到你了。"), ["段一\n\n段二"])  # J
        # no 12-char cap and no guessing: an unknown name is text, a long role name from roles.toml is a speaker
        self.assertEqual(U("[频道新消息]\n用户说「一」\n路人甲说「二」\n\n轮到你了。"), ["一」\n路人甲说「二"])
        with tempfile.TemporaryDirectory() as d:
            toml = Path(d) / "roles.toml"
            toml.write_text('[meeting]\nname = "会议"\n[[roles]]\nid = "x"\nname = "一个名字很长很长很长的角色啊"\n'
                            '[[discord.bots]]\nname = "Claude橘"\n')
            with mock.patch.multiple(I, ROLES_TOML=toml, _household_names=None):
                self.assertEqual(I.household_names(), ["用户", "一个名字很长很长很长的角色啊"])
                self.assertEqual(U("[频道新消息]\n用户说「一」\n一个名字很长很长很长的角色啊说「用户说「假」\n第二行」\n\n轮到你了。"), ["一"])
                # old format, multi-line, the user's text with a 「名字：」-like line that is not a speaker
                self.assertEqual(U("[频道新消息]\n用户：一\nClaude橘：不是说话人\n\n二\n一个名字很长很长很长的角色啊：嗯\n\n轮到你"),
                                 ["一\nClaude橘：不是说话人\n\n二"])
            # unreadable or no role: an error, not a silent guess
            toml.write_text('[meeting]\nname = "x"\n')
            for path in (toml, Path(d) / "missing.toml"):
                with mock.patch.multiple(I, ROLES_TOML=path, _household_names=None):
                    with self.assertRaises(I.HouseholdError):
                        H("[频道新消息]\n用户说「一」\n\n轮到你了。")
            # only the session with a household prompt fails, logged; the others go on (review 2026-10-23 third pass)
            hp = Path(d) / "-Users-zuiho-code-role-household-data-sessions-ju" / "h.jsonl"
            jsonl(hp, [dict(user("[频道新消息]\n用户说「晚安」\n\n轮到你了。", "2026-10-21T00:00:00Z"), entrypoint="sdk-cli")])
            np = Path(d) / "p" / "n.jsonl"
            jsonl(np, [user("普通会话", "2026-10-21T00:00:00Z"), claude("好", "2026-10-21T00:00:01Z")])
            with mock.patch.multiple(I, ROLES_TOML=Path(d) / "missing.toml", _household_names=None,
                                     transcripts=lambda **kw: {"h": hp, "n": np}):
                t0 = I.daypack.ts_of("2026-10-20T00:00:00Z")
                got = I.day_sessions(t0, t0 + 3 * 86400)
                self.assertEqual([x[0] for x in got], ["n"])
                self.assertIn("普通会话", got[0][3]["user"])
                self.assertIn("reflect h: skipped, a role-household prompt in it can't be read", I.LOG.read_text())
                for ex in ((hp, 0), (np, 0)):
                    if ex[0] is hp:
                        with self.assertRaises(I.HouseholdError):
                            I.extract(*ex)
                    else:
                        self.assertIn("普通会话", I.extract(*ex)["text"])
            # the user's interrupted message: the said part, without the cut note
            self.assertEqual(U("[频道新消息]\n用户说「说到……」（话没说完就被用户打断了）\n橘说「嗯」\n\n轮到你了。"), ["说到……"])
            # 「轮到你」 inside the user's text: only the last 「\n\n轮到你」 is brain.py's
            self.assertEqual(U("[频道新消息]\n用户说「a\n\n轮到你了吗」\n\n轮到你了。"), ["a\n\n轮到你了吗"])

    def test_channel_lines_are_tagged(self):
        got = I.speakers(self.BLOCK)
        self.assertIn(("补漏 USER", "没问题，同时增加sop"), got)
        self.assertIn(("补漏 CLAUDE", "好"), got)
        self.assertIn(("补漏 TEAM 鲸鱼娘", "嗯"), got)
        self.assertIn(("USER", "你看一下"), got)

    def test_channel_lines_with_age_are_parsed(self):
        # conest bridge/core/backfill.go:265 historyPrefix writes "[15:04，N 分钟前] who: "; lines taken from
        # ~/.claude/projects im-bridge sessions on 2026-10-23. Before the fix every such line was dropped
        rec = ("（频道里你上次看到之后的消息，按时间顺序；这是真实记录，先读它再回答）\n"
               "[21:59，不到 1 分钟前] zuiho_kai: @鲸鱼娘 这个暂时由你接手，等他额度恢复了，再由他接手\n"
               "[22:02，不到 1 分钟前] 鲸鱼娘（bot）: 好的主人\n"
               "[13:30，89 分钟前] Claude橘（你这个账号，但不是你在会话里写的，如定时任务输出）: ♻️ 空闲 1.3 小时\n"
               "[14:01，546 分钟前] zuiho_kai（bot）: 冒名的 bot\n"
               "[11:06，1 分钟前] zuiho_kai: 第二行\n续行\n\n"
               "（最新，回这条）\n你看一下")
        self.assertEqual(I.speakers(rec), [
            ("补漏 USER", "@鲸鱼娘 这个暂时由你接手，等他额度恢复了，再由他接手"),
            ("补漏 TEAM 鲸鱼娘", "好的主人"), ("补漏 CLAUDE", "♻️ 空闲 1.3 小时"),
            ("补漏 OTHER zuiho_kai（bot）", "冒名的 bot"), ("补漏 USER", "第二行\n续行"), ("USER", "你看一下")])

    def test_channel_reply_marker_still_parsed(self):
        got = I.speakers("（频道里你上次看到之后的消息）\n[10:00] zuiho_kai: [回复 彩虹猫：hi] 说中文\n\n（最新，回这条）\nx")
        self.assertIn(("补漏 USER→彩虹猫", "说中文"), got)

    def test_extract_and_dialog(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "im-bridge" / "s.jsonl"
            jsonl(p, [claude("前一条"), user(self.BLOCK)])
            self.assertIn("补漏 USER: 没问题，同时增加sop", I.extract(p, 0)["text"])
            dl = I.dialog(p, 0)
            self.assertIn("没问题，同时增加sop", dl["user"])  # dream's view unchanged
            self.assertIn("你看一下", dl["said"])
            self.assertNotIn("补漏", dl["text"])

    def test_who_wrote_a_terminal_turn(self):
        # 2026-10-23: a `claude -p` brief (97ff5383 【已审:…】), the /compact summary (706ffc2b) and pasted text were
        # quoted as the user's words
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "-Users-zuiho" / "s.jsonl"
            jsonl(p, [dict(user("我打的\n\n<pasted_content id=\"72df\">\n助手写的稿\n</pasted_content id=\"72df\">\n\n 重写"),
                           entrypoint="cli", origin={"kind": "human"}),
                      dict(user("This session is being continued from a previous conversation. 用户说「假」"),
                           entrypoint="cli", isCompactSummary=True),
                      dict(user("你好"), entrypoint="cli"),
                      dict(user("后台任务完成"), entrypoint="cli", origin={"kind": "task-notification"})])
            self.assertEqual(I.dialog(p, 0)["said"], ["我打的", "重写", "你好"])
            text = I.extract(p, 0)["text"]
            self.assertIn("PASTED: 助手写的稿", text)
            self.assertIn("SYSTEM: 后台任务完成", text)
            self.assertNotIn("假", text)
            q = Path(d) / "-Users-zuiho-wiki-wt-x" / "t.jsonl"
            jsonl(q, [dict(user("【已审:/x.md】\n\n用户原话：「改」"), entrypoint="sdk-cli")])
            self.assertEqual(I.dialog(q, 0)["said"], [])
            self.assertIn("SYSTEM: 【已审:/x.md】", I.extract(q, 0)["text"])
            b = Path(d) / "im-bridge" / "b.jsonl"  # a bridge session is sdk-cli throughout: its blocks decide
            jsonl(b, [dict(user("（最新，回这条）\n好"), entrypoint="sdk-cli")])
            self.assertEqual(I.dialog(b, 0)["said"], ["好"])
            # review 2026-10-23 #1 (/tmp/rv-dream/probe4.py): a turn that starts with a paste block (ac9c303c,
            # 3b1d8634) is the user's, not a CLI tag
            r = Path(d) / "-Users-zuiho-proj" / "r.jsonl"
            jsonl(r, [dict(user('\n\n<pasted_content id="4dda">\n助手旧表格\n</pasted_content id="4dda">\n\n 可以，那他默认为什么要放cpu'),
                           entrypoint="cli", origin={"kind": "human"}),
                      dict(user("<command-name>/clear</command-name>"), entrypoint="cli", origin={"kind": "human"})])
            self.assertEqual(I.dialog(r, 0)["said"], ["可以，那他默认为什么要放cpu"])
            text = I.extract(r, 0)["text"]
            self.assertIn("PASTED: 助手旧表格", text)
            self.assertIn("USER: 可以，那他默认为什么要放cpu", text)
            self.assertNotIn("command-name", text)

    def test_old_records_ask_the_native_log(self):
        # records synced before sessionlog kept entry/origin/compact: native_source() reads the line at `src`
        with tempfile.TemporaryDirectory() as d:
            native = Path(d) / "native.jsonl"
            jsonl(native, [dict(user("【免审:调研】查"), entrypoint="sdk-cli"), dict(user("真话"), entrypoint="cli")])
            ends = [len(l) for l in native.read_bytes().splitlines(keepends=True)]
            store = Path(d) / "store"
            rec = lambda t, src: sessionlog.record(role="橘", runtime="claudecode", dir="in", text=t, via="reader",
                                                  session="ss", src=src, ts="2026-10-17T01:00:00Z")
            jsonl(store / "ss.jsonl", [rec("【免审:调研】查", ends[0]), rec("真话", ends[0] + ends[1])])
            (store / ".progress.json").write_text(json.dumps({"ss": {"path": str(native), "done": sum(ends)}}))
            I._NATIVE.clear()
            self.assertEqual(I.dialog(store / "ss.jsonl", 0)["said"], ["真话"])

    def test_context_explains_label(self):
        self.assertIn("补漏 <label>", I.CONTEXT)
        self.assertIn("补漏 <标签>", I.SOP_INGEST)
        self.assertIn("补漏 <标签>", I.SOP_REVIEW)


class Todo(Fake):
    """② unanswered proposals: lint rejects them in 待办; SOPs no longer ask for them."""

    def readme(self, *names):
        (self.w / "tooling" / "README.md").write_text("".join(f"- [{n}]({n}.md) — x\n" for n in names))

    def errs(self):
        lint.WIKI = self.w
        return [e for e in lint.check()[0] if "unanswered" in e]

    def test_lint(self):
        self.readme("a", "b", "c")
        self.page("tooling/a.md", "- x\n## 待办\n- 是否 X：已提议，用户未答复（2026-10-12）。\n- 查 Y：用户 10-16 同意，未做。")
        self.page("tooling/b.md", "- 未删、待用户定（已提议，用户未答复）\n## 待办\n- 候选出现 5 次；dream 建议，用户未答复。")
        self.page("tooling/c.md", "## 待办\n- wisart 点数是否需要定期核对：未答复。\n- 给龙娘加缓存：橘提议，用户未答复。\n"
                                 "- 稿中未写，未答复（2026-10-15）。")
        e = self.errs()
        self.assertEqual(sum("tooling/a.md" in x for x in e), 1)
        self.assertFalse(any("tooling/b.md" in x for x in e))  # 现状 line and dream candidate: not flagged
        self.assertEqual(sum("tooling/c.md" in x for x in e), 3)

    def test_sops(self):
        for sop in (I.SOP_INGEST, I.SOP_REVIEW):
            self.assertNotIn("一行待办「是否 X：已提议，用户未答复」", sop)
            self.assertIn("未答复提议", sop)


class Quotes(Fake):
    """④ quotes the pages give to the user are checked against the USER lines."""

    def test_attribution(self):
        q = I.user_quotes
        self.assertEqual(q("用户答「没问题」并要求增加 SOP"), ["没问题"])
        self.assertEqual(q("（2026-10-14，用户：「C 小心」）"), ["C 小心"])
        self.assertEqual(q("「好的」（用户原话）"), ["好的"])
        self.assertEqual(q("用户说「a」，橘回「b」"), ["a"])
        self.assertEqual(q("发版需用户说「发版」"), [])
        self.assertEqual(q("用户昵称一律改「家里人」"), [])
        self.assertEqual(q("被用户否决：两次写错时间（10:00 写「凌晨三点半」"), [])
        self.assertEqual(q("用户让橘写「X」"), [])
        self.assertEqual(q("用户说「原话一」和「伪造二」"), ["原话一", "伪造二"])

    def test_bad_quotes(self):
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        o = self.root / "-Users-zuiho" / "bbbbbbbb-2.jsonl"
        jsonl(s, [claude("要不要这样"), user("可以，以后关闭这种傻逼审核，默认开"), user("都做，ABCD 全改，c小心"), user("c小心")])
        jsonl(o, [user("早先说过的话")])
        old = lambda: "页面里已有「旧引文」"
        bad = I.bad_quotes(["用户说「以后关闭这种傻逼审核，默认开」", "用户：「C 小心」",  # exact / case+space
                            "用户说「以后关闭这种审核，默认开」",  # edited: bad
                            "用户说「旧引文」",  # already on the wiki: moved, not new
                            "用户 10-15 bbbbbbbb 说「早先说过的话」",  # cited session
                            "用户说「从没说过」"], old, [s])
        self.assertEqual(bad, ["「以后关闭这种审核，默认开」", "「从没说过」"])
        jsonl(s, [user("版本 v1.2"), user("保留甲"), user("删除乙"), user("先这样…再那样")])
        self.assertEqual(I.bad_quotes(["用户说「版本 v12」", "用户说「保留甲删除乙」", "用户说「删除乙…保留甲」",
                                       "用户说「先这样…再那样」", "用户说「版本 v1.2」"], lambda: "", [s]),
                         ["「版本 v12」", "「保留甲删除乙」", "「删除乙…保留甲」"])

    def test_null_text_record(self):
        p = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(p, [{"type": "user", "message": None}, {"type": "assistant", "message": {"content": [{"type": "text", "text": None}]}},
                  user("好")])
        self.assertEqual(I.dialog(p, 0)["said"], ["好"])
        self.assertIn("USER: 好", I.extract(p, 0)["text"])

    def test_page_checks_end_to_end(self):
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("就这样定了")])
        (self.w / "tooling" / "README.md").write_text("- [a](a.md) — x\n")
        self.page("tooling/a.md", "- 正式包是 `pywebview`（0.2.8.beta1）。\n- 旧行")
        self.commit("base")
        self.page("tooling/a.md", "- 用户说「就这么定了」\n- 新行")
        err = I.page_checks("ingest aaaaaaaa", [s])
        self.assertIn("「就这么定了」", err)
        self.assertIn("removed line(s)", I.LOG.read_text())  # the pywebview line: logged, not rejected
        self.page("tooling/a.md", "- 用户说「就这样定了」\n- 正式包是 `pywebview`（0.2.8.beta1）。")
        self.assertEqual(I.page_checks("ingest aaaaaaaa", [s]), "")

    def test_claim_needs_users_quote(self):
        """Every new fact carries a quote the user really said (2026-11-09:
        「记忆条目得带原话逐字依据，再核一遍，我现在只记来源和时间，太松」)."""
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("头像限额改成 2，换头像不用等代办"), claude("好，那就改成两个"), user("好")])
        (self.w / "tooling" / "README.md").write_text("- [a](a.md) — x\n")
        self.page("tooling/a.md", "- 旧行")
        self.commit("base")

        def check(body):
            self.page("tooling/a.md", body)
            try:
                return I.page_checks("ingest aaaaaaaa", [s])
            finally:
                self.page("tooling/a.md", "- 旧行")

        self.assertEqual(check("- 用户要求头像限额改成 2，换头像不用等代办：「头像限额改成 2，换头像不用等代办」\n"), "")
        self.assertIn("没有引文", check("- 头像限额是 2，换头像不用等代办（来源：会话 aaaaaaaa）。\n"))
        self.assertIn("没有引文", check("- 用户要求头像限额改成 2，换头像不用等代办。\n"))  # source+time only
        self.assertIn("不是这条会话里用户的话",
                      check("- 用户要求头像限额改成 2：「头像限额改成 3，换头像不用等代办」\n"))  # one char changed
        self.assertIn("不是这条会话里用户的话", check("- 用户说「好，那就改成两个」\n"))  # the bot's words
        self.assertIn("没有引文", check("- 用户同意把头像限额降到 2（G哥提，用户同意按此修）。\n"))
        self.assertEqual(check("- 用户这条要求的原话与场景见 [[user-requests]]。\n"), "")  # pointer to the words
        self.assertEqual(check("- 用户说「好」（用户原话），限额两个。\n"), "")  # 「好」is the whole message

    def test_every_fact_needs_quote(self):
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("头像限额改成 2，换头像不用等代办"), claude("好，那就改成两个")])
        self.page("tooling/a.md", "- 旧行")
        self.commit("base")
        for line in ("- 头像限额是 2（来源：会话 aaaaaaaa）。",
                     "- 头像限额是 2，依据：「好，那就改成两个」。",
                     "- 头像限额是 2，依据：「头像限额改成 3」。"):
            with self.subTest(line=line):
                self.page("tooling/a.md", line)
                self.assertTrue(I.page_checks("ingest aaaaaaaa", [s]))
        self.page("tooling/a.md", "- 头像限额是 2，依据：「头像限额改成 2」。")
        self.assertEqual(I.page_checks("ingest aaaaaaaa", [s]), "")

    def test_pointer_must_be_whole_line(self):
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("头像限额改成 2")])
        self.page("tooling/a.md", "- 旧行")
        self.commit("base")
        for line in ("- 用户要求头像限额为 2，原话见 [[user-requests]]。",
                     "- 头像限额为 2，原话见 [[user-requests]]。",
                     "- 原话说明头像限额为 2，见 [[user-requests]]。"):
            with self.subTest(line=line):
                self.page("tooling/a.md", line)
                self.assertIn("没有引文", I.page_checks("ingest aaaaaaaa", [s]))
        for line in ("- 原话见 [[user-requests]]。", "- 用户这条要求的原话与场景见 [[user-requests]]。"):
            with self.subTest(pointer=line):
                self.page("tooling/a.md", line)
                self.assertEqual(I.page_checks("ingest aaaaaaaa", [s]), "")

    def test_quote_length_uses_normalized_words(self):
        for q in ("好！！！", "好 ， ！", "c 小心！", "好…呀"):
            with self.subTest(quote=q):
                self.assertFalse(I.quote_ok(q, I.heard(["好吧c小心呀"])))
        self.assertFalse(I.quote_ok("好…呀", I.heard(["好"])))
        self.assertFalse(I.quote_ok("…！！！", I.heard(["好"])))
        self.assertTrue(I.quote_ok("好！！！", I.heard(["发送人：某人\n好"])))
        self.assertTrue(I.quote_ok("c 小心！", I.heard(["c小心"])))
        self.assertTrue(I.quote_ok("头像…两个", I.heard(["头像限额改成两个"])))

    def test_body_key_value_requires_quote(self):
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("头像限额改成 2")])
        self.page("tooling/a.md", "- 旧行")
        self.commit("base")
        for body in ("限额: 2", "limit: 2", "---\n限额: 2\n---"):
            with self.subTest(body=body):
                self.page("tooling/a.md", body)
                self.assertIn("没有引文", I.page_checks("ingest aaaaaaaa", [s]))
        self.page("tooling/a.md", "限额: 2，依据：「头像限额改成 2」。")
        self.assertEqual(I.page_checks("ingest aaaaaaaa", [s]), "")

    def test_index_link_with_fact_requires_quote(self):
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("头像限额改成 2")])
        self.page("tooling/a.md", "- 旧行")
        self.commit("base")
        for path in ("tooling/a.md", "tooling/README.md", "MEMORY.md"):
            with self.subTest(path=path):
                p = self.w / path
                before = p.read_text() if p.exists() else ""
                p.write_text(before + "\n- [配置](config.md)：头像限额已改为2。\n")
                self.assertIn("没有引文", I.page_checks("ingest aaaaaaaa", [s]))
                p.write_text(before + "\n- [配置](config.md)：头像限额已改为2，依据：「头像限额改成 2」。\n")
                self.assertEqual(I.page_checks("ingest aaaaaaaa", [s]), "")
                p.write_text(before)

    def test_structural_exemptions_use_file_context(self):
        self.page("tooling/a.md", "- 旧行")
        self.commit("base")
        self.page("tooling/a.md", "# 配置\n## 限额\n- 旧行")
        p = self.w / "tooling/a.md"
        p.write_text(p.read_text().replace("description: d", "description: 配置索引"))
        (self.w / "tooling/README.md").write_text("# 目录\n- [配置](a.md)\n")
        with (self.w / "MEMORY.md").open("a") as f:
            f.write("- [配置](tooling/a.md)\n")
        self.assertEqual(I.page_checks("ingest", []), "")
        for body in ("#限额改为2", "- [配置](config.md)", "```markdown\n# 限额改为2\n```"):
            with self.subTest(body=body):
                self.page("tooling/a.md", body)
                self.assertIn("没有引文", I.page_checks("ingest", []))

    def test_lost_lines(self):
        gone = I.lost_lines(["- 正式包是 PyInstaller + `pywebview`（0.2.8.beta1）", "- 端口 8080 改了", "- 全是中文"],
                            "页面写着 PyInstaller")
        self.assertEqual(gone, ["- 正式包是 PyInstaller + `pywebview`（0.2.8.beta1）"])
        self.assertEqual(I.lost_lines(["  modified: 2026-10-16T11:00:50.044Z", "- [x](x.md) — `y`"], ""), [])


class StoreBase(Fake):
    """~/wiki without config.json reads the unified session record (sessionlog): Claude Code sessions read there give
    the model the same text as read in place, progress moves over once, other runtimes and bridge records come in."""

    def setUp(self):
        super().setUp()
        I.ROOT = None
        self.store = self.tmp / "store"
        self.store.mkdir()
        (self.store / "sources.json").write_text(json.dumps({"readers": [
            {"reader": "claudecode", "role": "橘", "roots": [str(self.root), str(self.tmp / "archive")],
             "hosts": str(self.tmp / "hosts")}]}))
        self.env = os.environ.get("AGENT_SESSIONS_DIR")
        os.environ["AGENT_SESSIONS_DIR"] = str(self.store)

    def tearDown(self):
        os.environ["AGENT_SESSIONS_DIR"] = self.env
        super().tearDown()

    def bridge_session(self):
        s = self.root / "-Users-zuiho-im-bridge-claude" / "aaaaaaaa-1.jsonl"
        jsonl(s, [dict(user("（队友状态，系统自动附上，不用回应）\n龙娘：在忙\n\n（最新）\n以后都这样"), cwd="/Users/zuiho/im-bridge/claude"),
                  claude("好"), {"type": "ai-title", "aiTitle": "标题"},
                  dict(user("<command-name>/clear</command-name>"), cwd="/Users/zuiho/im-bridge/claude"),
                  dict(user("【龙娘】我写完了"), cwd="/Users/zuiho/im-bridge/claude"), claude("收到")])
        return s


class StoreMode(StoreBase):
    def test_same_text_as_in_place(self):
        s = self.bridge_session()
        I.sync_sessions()
        p = I.transcripts()["aaaaaaaa-1"]
        self.assertNotEqual(p, s)
        a, b = I.extract(s, 0), I.extract(p, 0)
        self.assertEqual((a["text"], a["prompts"], a["cwd"], a["title"]), (b["text"], b["prompts"], b["cwd"], b["title"]))
        self.assertIn("USER: 以后都这样", b["text"])
        self.assertIn("TEAM 龙娘: 【龙娘】我写完了", b["text"])  # as speakers() always labelled it
        self.assertNotIn("队友状态", b["text"])
        da, db_ = I.dialog(s, 0), I.dialog(p, 0)
        self.assertEqual((da["text"], da["said"], da["days"]), (db_["text"], db_["said"], db_["days"]))

    def test_offsets_move_once(self):
        s = self.bridge_session()
        cut = len(s.read_bytes().splitlines(keepends=True)[0]) + len(s.read_bytes().splitlines(keepends=True)[1])
        I.STATE = self.tmp / "s.sqlite"
        db = I.state()
        for t in ("ingested", "reviewed", "dreamed"):
            db.execute(f"insert into {t} values (?,?,?)", ("aaaaaaaa-1", cut, time.time()))
        db.execute("insert into dreamed values ('__start__', 0, 1)")
        db.commit()
        I.prepare()
        db = I.state()
        p = I.transcripts()["aaaaaaaa-1"]
        moved = db.execute("select offset from ingested").fetchone()[0]
        self.assertEqual(I.extract(p, moved)["text"], I.extract(s, cut)["text"])
        self.assertEqual({r[0] for r in db.execute("select offset from reviewed union select offset from dreamed "
                                                   "where id != '__start__'")}, {moved})
        db.execute("update ingested set offset=1")  # a second prepare must not move offsets again
        db.commit()
        I.prepare()
        self.assertEqual(I.state().execute("select offset from ingested").fetchone()[0], 1)

    def test_busy_session_every_idle_min(self):
        # user 2026-10-22「半小时力度的总结到wiki」: a session that never goes idle still goes in every IDLE_MIN
        self.bridge_session()
        I.sync_sessions()
        p = I.transcripts()["aaaaaaaa-1"]
        I.STATE = self.tmp / "s.sqlite"
        db = I.state()
        os.utime(p)  # written just now: not idle
        db.execute("insert into ingested values (?,?,?)", ("aaaaaaaa-1", 1, time.time() - 60))
        self.assertEqual(list(I.ready(db)), [])  # ingested a minute ago
        db.execute("update ingested set at=?", (time.time() - I.IDLE_MIN * 60 - 1,))
        self.assertEqual(list(I.ready(db)), [p])  # last ingest a half hour back
        db.execute("update ingested set offset=?", (p.stat().st_size,))
        self.assertEqual(list(I.ready(db)), [])  # nothing new: nothing to do

    def test_live_and_other_runtimes(self):
        self.bridge_session()
        old = self.tmp / "archive" / "-Users-zuiho" / "bbbbbbbb-2.jsonl"
        jsonl(old, [user("归档里的")])
        I.sync_sessions()
        self.assertEqual(set(I.transcripts(live=True)), {"aaaaaaaa-1"})  # an archived-only session: not day work
        self.assertEqual(set(I.transcripts(hosts=True)), {"aaaaaaaa-1", "bbbbbbbb-2"})
        # a runtime no reader covers, recorded by the bridge: the platform's names say who spoke
        rec = lambda **k: sessionlog.record(role="橘", runtime="openclaw", channel="discord:9", via="bridge",
                                            ts="2026-10-20T01:00:00.000Z", **k)
        for r in (rec(dir="in", text="<@1> 帮我看看", speaker="zuiho_kai"), rec(dir="in", text="我来", speaker="龙娘"),
                  rec(dir="in", text="路人话", speaker="someone"), rec(dir="out", text="看了", speaker="橘")):
            sessionlog.append(r)
        [bridge] = [p for sid, p in I.transcripts().items() if sid.endswith("discord-9")]
        self.assertEqual(I.extract(bridge, 0)["text"].split("\n\n"),
                         ["USER: <@1> 帮我看看", "TEAM 龙娘: 我来", "OTHER someone: 路人话", "CLAUDE: 看了"])
        self.assertEqual(I.dialog(bridge, 0)["said"], ["<@1> 帮我看看"])


class StoreModeReview(StoreBase):
    """review 2026-10-20 #2 #3 #7: sync failure, the two offset-moving branches, bridge records in time order."""

    def test_sync_failure_does_not_move(self):
        s = self.bridge_session()
        I.STATE = self.tmp / "s.sqlite"
        db = I.state()
        db.execute("insert into ingested values (?,?,?)", ("aaaaaaaa-1", 100, time.time()))
        db.commit()

        def broken(*a, **k):
            raise OSError("store not writable")
        keep = sessionlog.sync
        sessionlog.sync = broken
        try:
            I.prepare()
        finally:
            sessionlog.sync = keep
        db = I.state()
        self.assertFalse(I.offsets_moved(db))  # moved later, after a sync that worked
        self.assertEqual(db.execute("select offset from ingested").fetchone()[0], 100)
        I.prepare()
        self.assertTrue(I.offsets_moved(I.state()))

    def test_review_converts_unmoved_host_offsets(self):
        """A host whose ingest.py still keeps Claude Code offsets (no meta table): review reads from the same place
        in the record."""
        native = self.tmp / "hosts" / "n150" / "projects" / "-home-x" / "cccccccc-3.jsonl"
        jsonl(native, [user("早就整理过的话"), user("今天新说的话")])
        cut = len(native.read_bytes().splitlines(keepends=True)[0])
        hdb = sqlite3.connect(self.tmp / "hosts" / "n150" / "ingest.sqlite")
        hdb.execute("create table ingested(id text primary key, offset int, at real)")
        hdb.execute("insert into ingested values ('cccccccc-3', ?, 0)", (native.stat().st_size,))
        hdb.commit()
        hdb.close()
        I.STATE = self.tmp / "s.sqlite"
        db = I.state()
        db.execute("insert into reviewed values ('cccccccc-3', ?, 0)", (cut,))  # Mac reviewed the first line already
        db.commit()
        (self.w / "tooling" / "README.md").write_text("- [a](a.md) — x\n")
        self.page("tooling/a.md", "- 旧")
        self.commit("ingest cccccccc")
        I.prepare()  # imports the mirrored host log, moves the Mac's own offsets
        seen = {}

        def fake_pass(label, instruction, context=None, check=None, **k):
            seen["context"] = context
            return True
        keep = I.model_pass
        I.model_pass = fake_pass
        try:
            I.review(I.state(), time.time() + 60)
        finally:
            I.model_pass = keep
        self.assertIn("context", seen, "review read nothing of the host's new line")
        self.assertIn("今天新说的话", seen["context"])
        self.assertNotIn("早就整理过的话", seen["context"])  # the host's end offset, moved: nothing past the end
        rec = I.transcripts(hosts=True)["cccccccc-3"]
        self.assertEqual(I.state().execute("select offset from reviewed").fetchone()[0], rec.stat().st_size)

    def test_extract_cwd_where_delta_starts(self):
        s = self.root / "-Users-zuiho" / "dddddddd-4.jsonl"
        jsonl(s, [dict(user("一"), cwd="/A"), dict(user("二"), cwd="/B"), dict(user("三"), cwd="/B"),
                  dict(user("四"), cwd="/B")])
        I.sync_sessions()
        p = I.transcripts()["dddddddd-4"]
        sizes = [len(l) for l in s.read_bytes().splitlines(keepends=True)]
        for n in (1, 2, 3):  # after the line before the change, after the change, later
            off = sum(sizes[:n])
            self.assertEqual(I.extract(p, sessionlog.store_offset(p, off))["cwd"], I.extract(s, off)["cwd"], n)

    def test_bridge_records_in_time_order(self):
        rec = lambda ts, **k: sessionlog.record(role="橘", runtime="openclaw", channel="discord:9", via="bridge", ts=ts, **k)
        sessionlog.append(rec("2026-10-20T01:00:05.000Z", dir="out", text="答", speaker="橘"))  # hook finished first
        sessionlog.append(rec("2026-10-20T01:00:00.000Z", dir="in", text="问", speaker="zuiho_kai"))
        [p] = [p for sid, p in I.transcripts().items() if sid.endswith("discord-9")]
        self.assertEqual(I.extract(p, 0)["text"].split("\n\n"), ["USER: 问", "CLAUDE: 答"])
        self.assertEqual(I.dialog(p, 0)["text"], "USER [10-20]: 问")  # no reply shown before the question it answers


class Review(Fake):
    """③ review sees the day's pages whole, the diff and the deletions; only pages the day changed."""

    def test_review_context(self):
        (self.w / "tooling" / "README.md").write_text("- [a](a.md) — x\n- [b](b.md) — x\n- [c](c.md) — x\n")
        self.page("tooling/a.md", "- 早间提议 routine 暂停全部\n- 0.2.8.beta1 正式包是 `pywebview`")
        self.page("tooling/b.md", "- 不相关页")
        self.page("tooling/c.md", "- 另一会话的页")
        self.commit("base")
        time.sleep(1.1)
        since = time.time() - 0.5
        self.page("tooling/a.md", "- 早间提议 routine 暂停全部\n- 早间提议只去掉旧项：用户定")
        self.commit("ingest aaaaaaaa")
        self.page("tooling/c.md", "- 另一会话写的")
        self.commit("ingest cccccccc")
        s = self.root / "-Users-zuiho" / "aaaaaaaa-1.jsonl"
        jsonl(s, [user("以后早上不需要显示之前没完成的东西")])
        I.STATE = self.tmp / "s.sqlite"
        db = I.state()
        db.execute("insert into ingested values (?,?,?)", (s.stem, s.stat().st_size, time.time()))
        db.execute("insert into reviewed values (?,?,?)", (s.stem, 0, since))
        db.commit()
        seen = {}

        def fake_pass(label, instruction, context=None, check=None, **k):
            seen.update(label=label, context=context, check=check)
            return True
        keep = I.model_pass
        I.model_pass = fake_pass
        try:
            I.review(db, time.time() + 60)
        finally:
            I.model_pass = keep
        c = seen["context"]
        pages = c[c.index("=== DAY PAGES"):c.index("=== END DAY PAGES")]
        self.assertIn("--- tooling/a.md", pages)
        self.assertIn("早间提议 routine 暂停全部", pages)  # the unchanged line that contradicts the new one
        self.assertNotIn("tooling/b.md", pages)  # not changed today: not sent
        self.assertNotIn("tooling/c.md", pages)  # another batch's session
        self.assertIn("+- 早间提议只去掉旧项：用户定", c)
        dels = c[c.index("=== DAY DELETIONS"):]
        self.assertIn("pywebview", dels)
        self.assertIsNotNone(seen["check"])
        self.assertIn("pages/writes/deletions", I.LOG.read_text())


class ReviewScope(Fake):
    """review may only change the lines the day's ingest wrote (CLAUDE.md "review only corrects those lines"):
    f80f125 dropped a whole 「## 待办」 section of older lines. An old line removed must stay on a page or go to log.md."""

    def setUp(self):
        super().setUp()
        self.page("tooling/a.md", "- 旧事实\n## 待办\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做")
        self.commit("base")
        self.page("tooling/a.md", "- 旧事实\n- 当天写的行：说错了\n## 待办\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做")
        self.shas = [self.commit("ingest aaaaaaaa")]

    def test_old_section_dropped_rejected(self):
        self.page("tooling/a.md", "- 旧事实\n- 当天写的行：说错了")
        err = I.review_check(self.shas)
        self.assertIn("REVIEW 3b: 2 line(s)", err)
        self.assertIn("旧待办甲", err)
        self.assertIn("只有 TRANSCRIPT 写明它已不成立时才移到 log.md", err)  # 3c's wording for the fix round
        self.assertNotIn("当天写的行", err)

    def test_old_lines_moved_to_log_pass(self):
        self.page("tooling/a.md", "- 旧事实\n- 当天写的行：说错了")
        with open(self.w / "log.md", "a") as f:
            f.write("## [2026-10-19] review | aaaaaaaa t\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做\n")
        self.assertEqual(I.review_check(self.shas), "")

    def test_old_line_moved_to_other_page_pass(self):
        self.page("tooling/a.md", "- 旧事实\n- 当天写的行：说错了")
        self.page("tooling/b.md", "## 待办\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做")
        self.assertEqual(I.review_check(self.shas), "")

    def test_old_line_rewritten_rejected(self):
        self.page("tooling/a.md", "- 旧事实（已改写）\n- 当天写的行：说错了\n## 待办\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做")
        self.assertIn("- 旧事实", I.review_check(self.shas))

    def test_old_line_rewritten_on_renamed_page_rejected(self):
        (self.w / "tooling" / "a.md").unlink()
        self.page("tooling/c.md", "- 旧事实（已改写）\n- 当天写的行：说错了\n## 待办\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做")
        err = I.review_check(self.shas)
        self.assertIn("REVIEW 3b: 1 line(s)", err)
        self.assertIn("- 旧事实", err)

    def test_only_day_lines_changed_pass(self):
        self.page("tooling/a.md", "- 旧事实\n- 当天写的行：改正后\n## 待办\n- 旧待办甲：用户同意，未做\n- 旧待办乙：用户同意，未做")
        (self.w / "tooling" / "a.md").write_text((self.w / "tooling" / "a.md").read_text()
                                                 .replace("description: d", "description: 改过的描述"))
        self.assertEqual(I.review_check(self.shas), "")  # frontmatter (NOT_FACT) changes with every edit


class Dream(Fake):
    """⑤ one session counts once per candidate; quotes are checked on the subpages too."""

    def test_counts(self):
        p = self.w / "tooling" / "rule-candidates-proposals.md"
        p.write_text("## 待办\n- 报数前先算预期：出现 3 次（10-15 6dae8210「a」；10-15 6dae8210「b」；10-16 adc86d8f「c」）\n"
                     "- 真实路径：出现 2 次\n  - 10-16 d4c8708a「x」\n\n  - 10-16 ba5d7fad「y」\n- 没列会话：出现 10 次\n")
        known = {"6dae8210", "adc86d8f", "d4c8708a", "ba5d7fad"}
        err = I.dream_counts(known)
        self.assertIn("「出现 3 次」 but 2 distinct", err)
        self.assertNotIn("真实路径", err)
        self.assertNotIn("没列会话", err)
        self.assertIn("同一 sid8 对同一条规则只算 1 次", I.SOP_DREAM)

    def test_misquotes_covers_subpages(self):
        s = self.root / "-Users-zuiho" / "6dae8210-1.jsonl"
        jsonl(s, [claude("x"), user("以后这种问题你先看要符合预期么")])
        (self.w / "tooling" / "rule-candidates-proposals.md").write_text("## 待办\n")
        self.commit("base")
        (self.w / "tooling" / "rule-candidates-proposals.md").write_text(
            "## 待办\n- 报数：出现 1 次（10-17 6dae8210「我从没这么说」）\n")
        self.assertIn("我从没这么说", I.misquotes({}))


class Split(Fake):
    """split_check counts every new <domain>/<name>.md lint counts; split_pass also gets over-budget pages."""

    def test_split_check_counts_dotted_names(self):
        (self.w / "tooling" / "README.md").write_text("- [a](a.md) — x\n")
        self.page("tooling/a.md", "- x")
        self.commit("base")
        self.page("tooling/topic.v2.md", "- y")
        self.page("tooling/topic.v3.md", "- z")
        self.assertIn("tooling/topic.v2.md, tooling/topic.v3.md", I.split_check(["tooling/a.md"]))
        (self.w / "tooling" / "topic.v2.md").unlink()
        (self.w / "tooling" / "topic.v3.md").unlink()
        self.page("tooling/a/a.md", "- x")
        self.page("tooling/a/b.md", "- y")
        self.assertEqual(I.split_check(["tooling/a.md"]), "")

    def test_split_check_rejects_family_names(self):  # a part named a-* beside a would be merged back by family_pass
        (self.w / "tooling" / "README.md").write_text("- [a](a.md) — x\n")
        self.page("tooling/a.md", "- x")
        self.commit("base")
        self.page("tooling/a/a.md", "- x")
        self.page("tooling/a/a-b.md", "- y")
        self.assertIn("family name(s): tooling/a/a-b.md", I.split_check(["tooling/a.md"]))

    def test_split_of_overview_does_not_nest(self):  # tooling/a/a.md splits into tooling/a/, never tooling/a/a/
        (self.w / "tooling" / "a").mkdir(parents=True)
        (self.w / "tooling" / "a" / "README.md").write_text("- [a](a.md) — x\n")
        self.page("tooling/a/a.md", "- x")
        self.commit("base")
        self.assertEqual(I.split_home("tooling/a/a.md"), "tooling/a/")
        self.page("tooling/a/a/a.md", "- x")
        self.page("tooling/a/a/c.md", "- y")
        err = I.split_check(["tooling/a/a.md"])
        self.assertIn("nested page(s): tooling/a/a/a.md, tooling/a/a/c.md", err)
        for f in ("a.md", "c.md"):
            (self.w / "tooling" / "a" / "a" / f).unlink()
        self.page("tooling/a/c.md", "- y")
        self.assertEqual(I.split_check(["tooling/a/a.md"]), "")

    def test_family_merge_stays_below_split_line(self):  # a merge that would reach SPLIT_AT is not made
        import consolidate as C
        n = int(lint.PAGE_LINES * lint.SPLIT_AT)
        (self.w / "tooling" / "README.md").write_text("# tooling\n\n- [a](a.md) — 甲\n- [a-b](a-b.md) — 甲的切片\n")
        self.page("tooling/a.md", "\n".join(f"- 甲{i}" for i in range(n // 2)))
        self.page("tooling/a-b.md", "\n".join(f"- 乙{i}" for i in range(n // 2)))
        self.commit("base")
        r = C.Run(self.w)
        self.assertEqual(r.families(), 0)
        self.assertTrue((self.w / "tooling" / "a-b.md").exists())
        self.assertTrue(C.fits("x\n" * n))  # 143/159 < 0.9: split_pass leaves it
        self.assertFalse(C.fits("x\n" * (n + 1)))  # 144/159 ≥ 0.9: split_pass would split it

    def test_consolidate_skip_leaves_page_alone(self):  # --skip: a page with someone's uncommitted edit is not written
        import consolidate as C
        (self.w / "tooling" / "README.md").write_text("# tooling\n\n- [a](a.md) — 甲\n- [a-b](a-b.md) — 甲的切片\n"
                                                      "- [c](c.md) — 丙\n- [c-d](c-d.md) — 丙的切片\n")
        for name in ("a", "a-b", "c", "c-d"):
            self.page(f"tooling/{name}.md", f"- {name} 事实")
        self.commit("base")
        r = C.Run(self.w, {"tooling/a-b.md"})
        self.assertEqual(r.families(), 1)  # c-d → c only
        self.assertTrue((self.w / "tooling" / "a-b.md").exists())
        self.assertFalse((self.w / "tooling" / "c-d.md").exists())
        self.assertFalse(r.move_contents("tooling", "misc"))  # a skipped page never moves

    def test_split_pass_merges_family_first(self):  # SOP v2: X-*.md folds into X.md before any split
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("# tooling\n\n- [a](a.md) — 甲\n- [a-b](a-b.md) — 甲的切片\n")
        self.page("tooling/a.md", "- 甲主页事实")
        self.page("tooling/a-b.md", "- 甲切片事实")
        self.commit("base")
        I.STATE = self.tmp / "s.sqlite"
        keep = I.model_pass, I.sync_work
        I.model_pass, I.sync_work = (lambda *a, **k: True), lambda: None
        try:
            I.split_pass(I.state())
        finally:
            I.model_pass, I.sync_work = keep
        self.assertFalse((self.w / "tooling" / "a-b.md").exists())
        self.assertIn("甲切片事实", (self.w / "tooling" / "a.md").read_text())

    def test_split_pass_skips_page_at_max_depth(self):
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        d = "tooling/" + "/".join(f"s{i}" for i in range(I.MAX_DEPTH - 1))
        parent = "tooling"
        for part in d.split("/")[1:]:
            (self.w / parent).mkdir(parents=True, exist_ok=True)
            (self.w / parent / "README.md").write_text(f"- [{part}]({part}/README.md) — 子\n")
            parent += "/" + part
        (self.w / d / "README.md").parent.mkdir(parents=True, exist_ok=True)
        (self.w / d / "README.md").write_text("- [big](big.md) — x\n")
        self.page(d + "/big.md", "\n".join(f"- fact {i}" for i in range(lint.PAGE_LINES - 5)))
        self.commit("base")
        I.STATE = self.tmp / "s.sqlite"
        seen = []
        keep = I.model_pass, I.sync_work
        I.model_pass, I.sync_work = (lambda label, *a, **k: seen.append(label) or True), lambda: None
        try:
            I.split_pass(I.state())
        finally:
            I.model_pass, I.sync_work = keep
        self.assertEqual(seen, [])
        self.assertIn("at MAX_DEPTH", I.LOG.read_text())

    def test_write_over_budget_is_accepted_then_split(self):  # 不遗忘: crossing the budget never rejects the write
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("# tooling\n\n- [big](big.md) — x\n")
        old = [f"- 旧事实 {i}" for i in range(120)]  # below the split line: split_pass leaves it
        self.page("tooling/big.md", "## 关键事实\n" + "\n".join(old))
        self.commit("base")
        new = [f"- 新事实 {i}" for i in range(24)]  # one write crosses the early split threshold
        self.page("tooling/big.md", "## 关键事实\n" + "\n".join(old + new))
        text = (self.w / "tooling" / "big.md").read_text()
        self.assertGreater(len(text.splitlines()), lint.PAGE_LINES * lint.WARN)
        self.assertEqual(I.lint_errors(), "")  # acceptance's lint check (A1) passes
        self.assertNotIn("compress", "\n".join(lint.check(self.w)[2]))
        self.commit("write")
        self.assertTrue(all(l in (self.w / "tooling" / "big.md").read_text() for l in old + new))
        I.STATE = self.tmp / "s.sqlite"
        seen = []
        keep = I.model_pass, I.sync_work
        I.model_pass, I.sync_work = (lambda label, prompt, *a, **k: seen.append(prompt) or True), lambda: None
        try:
            I.split_pass(I.state())
        finally:
            I.model_pass, I.sync_work = keep
        self.assertEqual(len(seen), 1)
        self.assertIn("tooling/big.md:", seen[0])

    def test_split_pass_takes_over_budget_page(self):
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("- [big](big.md) — x\n")
        self.page("tooling/big.md", "\n".join(f"- fact {i}" for i in range(lint.PAGE_LINES + 10)))
        self.commit("base")
        I.STATE = self.tmp / "s.sqlite"
        seen = []

        def fake_pass(label, instruction, **k):
            seen.append((label, instruction))
            return True
        keep = I.model_pass, I.sync_work
        I.model_pass, I.sync_work = fake_pass, lambda: None
        try:
            I.split_pass(I.state())
        finally:
            I.model_pass, I.sync_work = keep
        self.assertEqual([l for l, _ in seen], ["split"])
        self.assertIn("tooling/big.md", seen[0][1])

    def test_split_pass_fingerprints_full_path(self):
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("- [big](big:v2.md) — x\n")
        self.page("tooling/big:v2.md", "\n".join(f"- fact {i}" for i in range(lint.PAGE_LINES + 10)))
        self.commit("base")
        I.STATE = self.tmp / "s.sqlite"
        db = I.state()

        def rejected(label, instruction, **k):
            I.LAST_REJECTED = True
            return False
        keep = I.model_pass, I.sync_work
        I.model_pass, I.sync_work = rejected, lambda: None
        try:
            I.split_pass(db)
        finally:
            I.model_pass, I.sync_work = keep
            I.LAST_REJECTED = False
        self.assertEqual([p for p, in db.execute("select page from restructured")], ["tooling/big:v2.md"])


GROUPS = {"subdomains": [{"name": "alpha", "desc": "甲组：p0–p6 与 a.b", "pages": [f"p{i}.md" for i in range(7)] + ["a.b.md"]},
                         {"name": "beta", "desc": "乙组：p7–p12 与 c:d", "pages": [f"p{i}.md" for i in range(7, 13)] + ["c:d.md"]}]}


class Tree(Fake):
    """lint walks subdomains: README entries may link <sub>/README.md; a directory without README.md is data."""

    def build(self):
        (self.w / "tooling" / "README.md").write_text("# tooling\n\n- [sub](sub/README.md) — 子域\n- [top](top.md) — t\n")
        (self.w / "tooling" / "sub").mkdir()
        (self.w / "tooling" / "sub" / "README.md").write_text("# tooling/sub — 子域\n\n- [x.y](x.y.md) — x\n- [c:d](c:d.md) — c\n")
        self.page("tooling/top.md", "- 见 [[x.y]] 与 [[c:d]]，还有 [[nowhere]]")
        self.page("tooling/sub/x.y.md", "- x")
        self.page("tooling/sub/c:d.md", "\n".join(f"- fact {i}" for i in range(lint.PAGE_LINES - 12)))
        (self.w / "tooling" / "media").mkdir()
        (self.w / "tooling" / "media" / "2026-10.md").write_text("# 目录\nno frontmatter\n")
        lint.WIKI = self.w

    def test_subdomain_ok(self):
        self.build()
        errs, _, warns = lint.check()
        self.assertEqual(errs, [])
        self.assertFalse(any("[[x.y]]" in w or "[[c:d]]" in w for w in warns))  # pages in a subdomain resolve
        self.assertTrue(any("[[nowhere]]" in w for w in warns))
        self.assertTrue(any(w.startswith("tooling/sub/c:d.md: ") and " lines, " in w for w in warns))

    def test_subdomain_errors(self):
        self.build()
        self.page("tooling/sub/orphan.md", "- o")
        (self.w / "tooling" / "loose").mkdir()
        (self.w / "tooling" / "loose" / "README.md").write_text("- [z](z.md) — z\n")
        (self.w / "tooling" / "sub" / "README.md").write_text(
            "".join(f"- [n{i}](n{i}.md) — x\n" for i in range(lint.MAX_TOPICS + 1)) + "- [x.y](x.y.md) — x\n- [c:d](c:d.md) — c\n")
        e = "\n".join(lint.check()[0])
        self.assertIn("tooling/sub/orphan.md: orphan page", e)
        self.assertIn("tooling/loose", e)  # a README'd directory nobody lists
        self.assertIn(f"tooling/sub/README.md: {lint.MAX_TOPICS + 3} topics > {lint.MAX_TOPICS}", e)
        self.assertNotIn("media", e)  # data directory without README: not a subdomain

    def test_split_pass_sees_subdomain_pages(self):
        self.build()
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        self.commit("base")
        I.STATE = self.tmp / "s.sqlite"
        seen = []

        def fake_pass(label, instruction, **k):
            seen.append((label, instruction))
            return True
        keep = I.model_pass, I.sync_work
        I.model_pass, I.sync_work = fake_pass, lambda: None
        try:
            I.split_pass(I.state())
        finally:
            I.model_pass, I.sync_work = keep
        self.assertEqual([l for l, _ in seen], ["split"])
        self.assertIn("tooling/sub/c:d.md", seen[0][1])
        self.assertNotIn("域空位", seen[0][1])  # SOP v2: a split goes into the page's own directory, no slot used

    def test_split_check_counts_per_subdomain(self):
        self.build()
        self.commit("base")
        self.page("tooling/sub/c:d.v2.md", "- y")
        self.page("tooling/sub/c:d.v3.md", "- z")
        err = I.split_check(["tooling/sub/c:d.md"])
        self.assertIn("tooling/sub/c:d.v2.md, tooling/sub/c:d.v3.md", err)  # sibling slices: refused
        self.page("tooling/sub/c:d/c:d.md", "- x")  # under the page's own directory: fine
        self.assertNotIn("c:d/c:d.md", I.split_check(["tooling/sub/c:d.md"]))

    def test_prompts_multilevel(self):
        for sop in (I.SOP_INGEST, I.SOP_REVIEW, I.SOP_LINT, I.SOP_SPLIT):
            self.assertNotIn("<domain>/*.md", sop)
        self.assertNotIn("thin domains to merge", I.LINT)
        self.assertNotIn("接近预算的域按子主题拆分", I.SOP_LINT)

    def test_dream_pages_in_subdomain(self):
        (self.w / "tooling" / "rules").mkdir()
        s = self.root / "-Users-zuiho" / "6dae8210-1.jsonl"
        jsonl(s, [claude("x"), user("以后这种问题你先看要符合预期么")])
        (self.w / "tooling" / "rules" / "rule-candidates-proposals.md").write_text("## 待办\n")
        self.commit("base")
        (self.w / "tooling" / "rules" / "rule-candidates-proposals.md").write_text(
            "## 待办\n- 报数：出现 3 次（10-17 6dae8210「我从没这么说」）\n")
        self.assertIn("我从没这么说", I.misquotes({}))
        self.assertIn("「出现 3 次」 but 1 distinct", I.dream_counts({"6dae8210"}))
        # Discord / cloud_web citations count too: one per channel per day, alongside sessions
        (self.w / "tooling" / "rules" / "rule-candidates-proposals.md").write_text(
            "## 待办\n- 报数：出现 2 次\n  - 10-17 6dae8210「a」；10-22 14:03 #ju「b」；10-22 15:00 #ju「c」；"
            "10-22 15:01 私聊·Claude橘「d」；10-23 09:00 云端·大厅「e」\n")
        self.assertIn("「出现 2 次」 but 4 distinct", I.dream_counts({"6dae8210"}))
        self.assertEqual(I.occurrences("10-22 14:03 #dream 应该怎么做「x」；10-22 16:00 #dream 应该怎么做「y」", set()),
                         {"10-22 #dream 应该怎么做"})


class DomainBase(Fake):
    """A full README is split into subdomains: the model only groups, the script moves and checks."""

    def setUp(self):
        super().setUp()
        self.keep2 = {k: getattr(I, k) for k in ("SPLIT_ENGINE", "runner", "STATE")}
        I.WORK, I.STATE, I.SPLIT_ENGINE = self.w / ".ingest-work", self.tmp / "s.sqlite", "fake"
        (self.w / ".gitignore").write_text(".ingest-work/\n__pycache__/\n")
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        names = [f"p{i}" for i in range(13)] + ["a.b", "c:d"]
        (self.w / "tooling" / "README.md").write_text("# tooling — 工具\n\n规则见 CLAUDE.md。\n\n" +
                                                      "".join(f"- [{n}]({n}.md) — 页 {n}\n" for n in names))
        for n in names:
            self.page(f"tooling/{n}.md", f"- 页 {n}，见 [[c:d]] 和 [[a.b]]")
        (self.w / "tooling" / "media").mkdir()
        (self.w / "tooling" / "media" / "2026-10.md").write_text("# 目录\n")
        self.base = self.commit("base")
        self.orig = {n: (self.w / "tooling" / f"{n}.md").read_bytes() for n in names}
        self.calls = []

    def tearDown(self):
        for k, v in self.keep2.items():
            setattr(I, k, v)
        super().tearDown()

    def fake(self, *outs, edit=None):
        """Engine "fake": answers the i-th call with outs[i] (the last one repeats)."""
        def run(instruction, stdin="", label="?", context=None):
            self.calls.append(instruction)
            if edit:
                edit()
            return True, outs[min(len(self.calls), len(outs)) - 1], 0
        real = self.keep2["runner"]
        I.runner = lambda name: run if name == "fake" else real(name)

    def head(self):
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.w, capture_output=True, text=True).stdout.strip()

class DomainSplit(DomainBase):
    def test_split_moves_pages_unchanged(self):
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        t = self.w / "tooling"
        self.assertEqual(lint.entries(t / "README.md"), ["- [alpha](alpha/README.md) — 甲组：p0–p6 与 a.b",
                                                         "- [beta](beta/README.md) — 乙组：p7–p12 与 c:d"])
        self.assertIn("规则见 CLAUDE.md。", (t / "README.md").read_text())  # non-entry lines kept
        self.assertEqual((t / "alpha" / "a.b.md").read_bytes(), self.orig["a.b"])
        self.assertEqual((t / "beta" / "c:d.md").read_bytes(), self.orig["c:d"])
        self.assertIn("- [c:d](c:d.md) — 页 c:d", lint.entries(t / "beta" / "README.md"))
        self.assertFalse((t / "p0.md").exists())
        self.assertTrue((t / "media" / "2026-10.md").exists())  # data directory untouched
        lint.WIKI = self.w
        errs, _, warns = lint.check()
        self.assertEqual(errs, [])
        self.assertFalse(any("has no page" in w for w in warns))
        self.assertIn("restructure | split-domain tooling", (self.w / "log.md").read_text())
        self.assertIn("c:d.md", self.calls[0])
        self.assertEqual(subprocess.run(["git", "status", "--porcelain"], cwd=self.w, capture_output=True,
                                        text=True).stdout.strip(), "")
        db = I.state()
        self.assertIn("tooling/README.md", [p for p, in db.execute("select page from restructured")])

    def test_model_edits_discarded(self):
        def scribble():
            (I.WIKI / "tooling" / "p0.md").write_text("model edited this")
        self.fake(json.dumps(GROUPS, ensure_ascii=False), edit=scribble)
        I.split_pass(I.state())
        self.assertEqual((self.w / "tooling" / "alpha" / "p0.md").read_bytes(), self.orig["p0"])

    def test_bad_grouping_reverted_then_skipped(self):
        bad = json.loads(json.dumps(GROUPS))
        bad["subdomains"][1]["pages"].remove("c:d.md")  # a page left out
        self.fake(json.dumps(bad))
        I.split_pass(I.state())
        self.assertEqual(self.head(), self.base)
        self.assertEqual(len(self.calls), 2)  # first answer + one retry with the errors
        self.assertIn("c:d.md", self.calls[1])
        self.assertTrue((self.w / "tooling" / "c:d.md").exists())
        self.assertIn("REVERTED", I.LOG.read_text())
        I.split_pass(I.state())  # README unchanged since the rejected pass: not offered again
        self.assertEqual(len(self.calls), 2)

    def test_check_failure_reverted(self):
        real = I.domain_check

        def tamper(*a, **k):
            (I.WIKI / "tooling" / "alpha" / "p0.md").write_text("changed")
            return real(*a, **k)
        I.domain_check = tamper
        try:
            self.fake(json.dumps(GROUPS, ensure_ascii=False))
            I.split_pass(I.state())
        finally:
            I.domain_check = real
        self.assertEqual(self.head(), self.base)
        self.assertEqual((self.w / "tooling" / "p0.md").read_bytes(), self.orig["p0"])
        self.assertIn("tooling/p0.md", I.LOG.read_text())

    def test_name_taken_by_data_dir(self):
        bad = json.loads(json.dumps(GROUPS))
        bad["subdomains"][0]["name"] = "media"
        self.fake(json.dumps(bad))
        I.split_pass(I.state())
        self.assertEqual(self.head(), self.base)

    def test_make_room(self):
        self.fake("not json", json.dumps(GROUPS, ensure_ascii=False))
        self.assertEqual(I.make_room("tooling"), 0)  # the retry round got valid groups
        self.assertTrue((self.w / "tooling" / "beta" / "README.md").exists())
        self.assertEqual(len(self.calls), 2)

    def test_acceptance_merging_subdomain_is_lossless_checked(self):  # SOP v2: merging back is allowed, losing lines is not
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        t = self.w / "tooling"
        for p in (t / "alpha").glob("*.md"):
            if p.name != "README.md":
                p.rename(t / p.name)
        (t / "alpha" / "README.md").unlink()
        (t / "README.md").write_text("- [beta](beta/README.md) — b\n" +
                                     "".join(f"- [{n}]({n}.md) — x\n" for n in [f"p{i}" for i in range(7)] + ["a.b"]))
        I.WIKI = self.w
        errs = I.acceptance()
        self.assertNotIn("subdomain README(s) deleted", errs)
        self.assertIn("LOSSLESS", errs)  # the rewritten README dropped its 「规则见 CLAUDE.md。」 line


class SplitFixes(DomainBase):
    """Code review 2026-10-18 A, B, E, F of the domain split."""

    def test_malformed_groups_rejected_not_crash(self):  # A: unhashable JSON values
        bad = {"subdomains": [{"name": "alpha", "desc": "x", "pages": [{"p": "p0.md"}]},
                              {"name": ["beta"], "desc": "y", "pages": "p1.md"}]}
        self.fake(json.dumps(bad))
        I.split_pass(I.state())  # must not raise
        self.assertEqual(self.head(), self.base)
        self.assertEqual(len(self.calls), 2)  # a failed check like any other: one retry with the errors
        self.assertIn("REVERTED", I.LOG.read_text())
        I.split_pass(I.state())  # rejected and README unchanged: fingerprinted, not offered again
        self.assertEqual(len(self.calls), 2)

    def test_engine_timeout_is_a_call_failure(self):  # A: TimeoutExpired from codex()/claude()
        real_run = subprocess.run

        def run(cmd, *a, **k):
            if cmd[0] in ("codex", "claude"):
                raise subprocess.TimeoutExpired(cmd, k.get("timeout"))
            return real_run(cmd, *a, **k)
        keep = I.subprocess.run, I.CODEX_CHAIN, I.AFTER_CODEX
        I.subprocess.run, I.CODEX_CHAIN, I.AFTER_CODEX, I.SPLIT_ENGINE = run, ["m1"], ["haiku"], "codex:high"
        try:
            I.split_pass(I.state())  # must not raise
        finally:
            I.subprocess.run, I.CODEX_CHAIN, I.AFTER_CODEX = keep
        self.assertEqual(self.head(), self.base)
        log = I.LOG.read_text()
        self.assertIn("not fingerprinted", log)  # a call failure: retried next run
        self.assertIn("timeout", log)

    def test_structural_block_skips_model(self):  # F: no grouping can fix these
        t = self.w / "tooling" / "README.md"
        t.write_text(t.read_text().replace("- [p0](p0.md) — 页 p0", "- [p0](p1.md) — 页 p0 链到 p1"))
        self.commit("dup link")
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        I.split_pass(I.state())
        self.assertEqual(self.calls, [])
        self.assertEqual(I.LOG.read_text().count("split-domain: tooling can't be split"), 2)  # logged every run

    def test_structural_block_link_elsewhere(self):  # F: an entry linking into another directory
        (self.w / "other").mkdir()
        t = self.w / "tooling" / "README.md"
        t.write_text(t.read_text().replace("(p0.md)", "(../other/p0.md)"))
        self.commit("link elsewhere")
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        self.assertEqual(self.calls, [])
        self.assertIn("can't be split", I.LOG.read_text())

    def test_nested_full_domain_moved_by_parent(self):  # A: a full child README moved by its parent's split
        t = self.w / "tooling"
        (t / "deep").mkdir()
        (t / "deep" / "README.md").write_text("# tooling/deep\n\n" + "".join(f"- [q{i}](q{i}.md) — q\n" for i in range(15)))
        for i in range(15):
            self.page(f"tooling/deep/q{i}.md", "- q")
        (t / "README.md").write_text((t / "README.md").read_text().replace("- [p0](p0.md) — 页 p0\n",
                                                                         "- [deep](deep/README.md) — 深\n"))
        (t / "p0.md").unlink()
        self.commit("nested")
        g = json.loads(json.dumps(GROUPS))
        g["subdomains"][0]["pages"][0] = "deep/README.md"
        self.fake(json.dumps(g, ensure_ascii=False))
        I.split_pass(I.state())  # must not raise
        self.assertTrue((t / "alpha" / "deep" / "README.md").exists())
        log = I.LOG.read_text()
        self.assertIn("split-domain: tooling/alpha/deep has 15/15 topics", log)  # handled at its new path, same run
        self.assertNotIn("skip tooling/deep", log)

    def test_acceptance_allows_top_level_merge(self):  # E: merging thin top-level domains stays legal
        (self.w / "MEMORY.md").write_text("- [tooling](tooling/README.md) — t\n- [thin](thin/README.md) — 薄\n")
        (self.w / "thin").mkdir()
        (self.w / "thin" / "README.md").write_text("- [z](z.md) — z\n")
        self.page("thin/z.md", "- z")
        self.commit("thin")
        I.WIKI = self.w
        (self.w / "thin" / "z.md").rename(self.w / "tooling" / "z.md")
        (self.w / "thin" / "README.md").unlink()
        (self.w / "thin").rmdir()
        (self.w / "MEMORY.md").write_text("- [tooling](tooling/README.md) — t\n")
        t = self.w / "tooling" / "README.md"
        t.write_text(t.read_text().replace("- [p0](p0.md) — 页 p0\n", "") + "- [z](z.md) — z\n")
        (self.w / "tooling" / "p0.md").unlink()
        self.assertNotIn("subdomain", I.acceptance())

    def test_acceptance_rejects_lost_line(self):  # SOP v2: a page line on no page any more is rolled back
        self.page("tooling/p0.md", "- 甲事实仍在\n- 乙事实要删")
        self.commit("p0")
        I.WIKI = self.w
        self.page("tooling/p0.md", "- 甲事实仍在")
        self.assertIn("乙事实要删", I.acceptance())
        self.page("tooling/p0.md", "- 甲事实仍在\n\n## 历史\n- 乙事实要删")  # moved to 历史 verbatim: kept
        self.assertNotIn("LOSSLESS", I.acceptance())

    def test_acceptance_rejects_subdomain_swap(self):  # E: delete one subdomain README, create another
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        I.WIKI = self.w
        t = self.w / "tooling"
        (t / "gamma").mkdir()
        for p in (t / "alpha").glob("*.md"):
            if p.name != "README.md":
                p.rename(t / "beta" / p.name)
        (t / "alpha" / "README.md").unlink()
        (t / "gamma" / "README.md").write_text("# tooling/gamma — new\n")
        errs = I.acceptance()
        self.assertNotIn("subdomain README(s) deleted", errs)  # SOP v2: no merge-back ban; lint still rejects the swap
        self.assertIn("subdomain alpha/README.md", errs)

    def test_day_pages_follow_moves(self):  # B: a page moved by a split after the day's ingest wrote it
        I.REPO = I.WIKI = self.w
        self.page("tooling/p0.md", "- 白天写的")
        sha = self.commit("ingest aaaaaaaa")
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        I.WIKI = self.w
        pages = I.day_pages([sha])
        self.assertEqual(len(pages), 1)
        self.assertTrue(pages[0].startswith("--- tooling/alpha/p0.md\n"))
        self.assertIn("白天写的", pages[0])

    def test_day_pages_follow_rewrite_then_move(self):  # B: rewritten (compress) after the ingest, then moved
        I.REPO = I.WIKI = self.w
        self.page("tooling/p1.md", "- 白天写的")
        sha = self.commit("ingest bbbbbbbb")
        self.page("tooling/p1.md", "\n".join(f"- 压缩后改写的第 {i} 行，和原来完全不同" for i in range(30)))
        self.commit("compress")
        self.fake(json.dumps(GROUPS, ensure_ascii=False))
        I.split_pass(I.state())
        I.WIKI = self.w
        pages = I.day_pages([sha])
        self.assertEqual([p.split("\n")[0] for p in pages], ["--- tooling/alpha/p1.md"])


class Alerts(Fake):
    """User 2026-10-28 「理论上日志整理报错我要感知」: SKIPPED and a reason rejecting 3 batches in a row send one
    plain-text `cc-connect send` (mocked here), once per reason a day."""
    LINT = "lint: tooling/README.md:12: link to missing page x.md"

    def setUp(self):
        super().setUp()
        self.sent, self.keep2 = [], (I.HOME, I.DREAM_NOTIFY, I.model_pass, I.MAX_FAILS, I.subprocess.run, I.candidates_note)
        I.HOME, I.DREAM_NOTIFY, I.MAX_FAILS = self.w, "maomao discord:1", 99  # REPO is HOME: a real send (mocked)
        I.candidates_note = lambda text: ""
        I.subprocess.run = lambda cmd, **k: (self.sent.append(cmd) if cmd[0] == "cc-connect" else 1/0) or \
            subprocess.CompletedProcess(cmd, 0, "Message sent successfully.", "")
        self.n = 0

    def tearDown(self):
        I.HOME, I.DREAM_NOTIFY, I.model_pass, I.MAX_FAILS, I.subprocess.run, I.candidates_note = self.keep2
        super().tearDown()

    def batch(self, *errs):
        """One failed batch of one new session whose engine passes are rejected with errs."""
        def fake(label, prompt, **k):
            for e in errs:
                I.REJECT_REASONS.append(e)
            return False
        I.model_pass = fake
        self.n += 1
        I.ingest_batches(I.state(), [{"id": f"sess{self.n:04d}x", "end": 1, "path": "x.jsonl", "title": "t", "cwd": "/",
                                       "date": "2026-10-28", "text": "USER: hi"}], ["haiku"])

    def test_skipped_sends_once_a_day(self):
        I.MAX_FAILS = 1
        self.batch(self.LINT)
        self.batch(self.LINT)
        skipped = [c for c in self.sent if "放弃了 1 个会话" in c[-1]]
        self.assertEqual(len(skipped), 1, self.sent)
        self.assertEqual(skipped[0][:6], ["cc-connect", "send", "-p", "maomao", "-s", "discord:1"])
        self.assertIn("link to missing page", skipped[0][-1])

    def test_same_reason_three_batches_sends_once(self):
        self.batch(self.LINT)
        self.batch(self.LINT.replace("12", "13"))  # moved a line: same reason
        self.assertEqual(self.sent, [])
        self.batch(self.LINT.replace("12", "40"))
        self.assertEqual(len(self.sent), 1)
        self.assertIn("连续 3 批被同一原因拒绝", self.sent[0][-1])
        self.assertIn("已影响 3 个会话", self.sent[0][-1])
        self.batch(self.LINT)
        self.batch(self.LINT)
        self.assertEqual(len(self.sent), 1)  # same day: not again

    def test_streak_broken_by_other_reason(self):
        self.batch(self.LINT)
        self.batch(self.LINT)
        self.batch("model failed")
        self.batch(self.LINT)
        self.assertEqual(self.sent, [])

    def test_different_reasons_each_send(self):
        other = "lossless: 3 line(s) gone"
        for _ in range(3):
            self.batch(self.LINT)
        for _ in range(3):
            self.batch(other)
        self.assertEqual(len(self.sent), 2)
        self.assertIn("link to missing page", self.sent[0][-1])
        self.assertIn("lossless", self.sent[1][-1])

    def test_failed_send_only_logs_and_retries(self):
        I.subprocess.run = lambda cmd, **k: subprocess.CompletedProcess(cmd, 1, "", "no active session")
        for _ in range(3):
            self.batch(self.LINT)  # no exception
        self.assertIn("FAILED no active session", I.LOG.read_text())
        self.assertFalse(I.alerted(I.state(), "streak:" + I.reasons_of([self.LINT]).pop()))  # tried again next batch

    def test_trial_copy_only_logs(self):
        I.HOME = self.tmp / "elsewhere"
        for _ in range(3):
            self.batch(self.LINT)
        self.assertEqual(self.sent, [])
        self.assertIn("alert skipped (trial copy", I.LOG.read_text())


class CrashedCheck(Fake):
    """2026-10-28: page_checks raised (discord_said read a removed ~/.cc-connect/config.toml) after the model was paid,
    the process died, nothing counted a failure and launchd re-ran the same batch every 30 minutes. Now a script error
    in acceptance fails that batch (worktree reverted, fails +1, one alert a day, traceback logged) and the run goes on."""

    def setUp(self):
        super().setUp()
        names = ("WORK", "runner", "page_checks", "subprocess", "HOME", "DREAM_NOTIFY", "MAX_FAILS", "candidates_note")
        self.keep2 = {k: getattr(I, k) for k in names}
        I.WORK = self.w / ".ingest-work"
        (self.w / ".gitignore").write_text(".ingest-work/\n__pycache__/\n")
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n")
        self.page("tooling/big.md", "- 甲 `a1`")
        self.base = self.commit("base")
        self.calls, self.sent = [], []

        def run(instruction, stdin="", label="?", context=None):
            self.calls.append(label)
            self.page_at(I.WORK / "tooling" / "big.md", "- 甲 `a1`\n- 乙 新写的")
            return True, "done", 0
        I.runner = lambda name: run

        def boom(label, sources):
            raise FileNotFoundError(2, "No such file or directory", "/x/.cc-connect/config.toml")
        I.page_checks = boom
        sent = self.sent

        class Sub:  # alert's `cc-connect send` recorded, git and the rest real
            def __getattr__(self, k):
                return getattr(subprocess, k)

            def run(self, cmd, **k):
                if cmd[0] == "cc-connect":
                    sent.append(cmd)
                    return subprocess.CompletedProcess(cmd, 0, "Message sent successfully.", "")
                return subprocess.run(cmd, **k)
        I.subprocess = Sub()
        I.HOME, I.DREAM_NOTIFY, I.MAX_FAILS = self.w, "maomao discord:1", 99
        I.candidates_note = lambda text: ""

    def tearDown(self):
        for k, v in self.keep2.items():
            setattr(I, k, v)
        super().tearDown()

    def page_at(self, p, body):
        p.write_text(PAGE.format(name=p.stem, body=body))

    def test_crash_in_acceptance_fails_batch_alerts_and_goes_on(self):
        db = I.state()
        items = [{"id": f"sess{n:04d}x", "end": 1, "path": f"{n}.jsonl", "title": "t", "cwd": "/", "date": "2026-10-28",
                  "text": "USER: hi"} for n in (1, 2)]
        for it in items:  # one batch each (batches_of packs by size): two runs of the batch loop
            I.ingest_batches(db, [it], ["fake", "fake2"])  # no exception
        self.assertEqual(len(self.calls), 2)  # each batch: one engine; the crash is not the model's, fake2 not paid
        fails = dict(db.execute("select id, n from fails").fetchall())
        self.assertEqual(fails, {"sess0001x": 1, "sess0002x": 1})
        self.assertEqual(db.execute("select count(*) from ingested").fetchone()[0], 0)
        self.assertEqual(len(self.sent), 1, self.sent)  # once a day per error type
        self.assertIn("脚本出错（FileNotFoundError", self.sent[0][-1])
        self.assertEqual(self.sent[0][:6], ["cc-connect", "send", "-p", "maomao", "-s", "discord:1"])
        log = I.LOG.read_text()
        self.assertIn("CRASHED", log)
        self.assertIn("Traceback (most recent call last)", log)
        self.assertNotIn("新写的", (I.WORK / "tooling" / "big.md").read_text())  # worktree rolled back
        self.assertEqual(subprocess.run(["git", "status", "--porcelain"], cwd=I.WORK, capture_output=True,
                                        text=True).stdout, "")
        self.assertEqual(self.head(), self.base)

    def head(self):
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.w, capture_output=True, text=True).stdout.strip()


class Candidates(Fake):  # SOP v2 #7: ingest hands the model the pages search finds for the batch
    def test_prompt_names_candidate_pages(self):
        (self.w / "tooling" / "README.md").write_text("- [tailscale](tailscale.md) — 组网\n")
        self.page("tooling/tailscale.md", "- Tailscale 出口节点在 VPS 上，端口 41641 已放行")
        self.commit("tailscale")
        seen = []
        keep = I.model_pass
        I.model_pass = lambda label, prompt, **k: seen.append(prompt) or False
        try:
            I.ingest_batches(I.state(), [{"id": "abcdef0123", "end": 1, "path": "x.jsonl", "title": "t", "cwd": "/",
                                           "date": "2026-10-25", "text": "USER: Tailscale 出口节点换到新的 VPS 了"}],
                             ["claude"])
        finally:
            I.model_pass = keep
        self.assertIn("先改候选页，候选都不对才新建", seen[0])
        self.assertIn("- tooling/tailscale.md", seen[0])

    def test_no_hits_no_block(self):
        self.assertEqual(I.candidates_note("完全无关的内容 zzqqxx"), "")


class LintNames(Fake):
    """D: [[name]] resolves by file name at any depth, so two pages may not share one."""

    def test_same_name_in_two_directories(self):
        (self.w / "tooling" / "README.md").write_text("- [x](x.md) — x\n- [sub](sub/README.md) — s\n")
        (self.w / "tooling" / "sub").mkdir()
        (self.w / "tooling" / "sub" / "README.md").write_text("- [x](x.md) — x\n- [y](y.md) — y\n")
        self.page("tooling/x.md", "- x")
        self.page("tooling/sub/x.md", "- x2")
        self.page("tooling/sub/y.md", "- y")
        (self.w / "CLAUDE.md").write_text("# schema\n")
        (self.w / "tooling" / "media").mkdir()
        (self.w / "tooling" / "media" / "y.md").write_text("data\n")  # data directory: not a page
        lint.WIKI = self.w
        e = "\n".join(lint.check()[0])
        self.assertIn("tooling/sub/x.md", e)
        self.assertIn("tooling/x.md", e)
        self.assertNotIn("y.md", e)
        self.assertNotIn("CLAUDE", e)


class LintBaseline(Fake):
    """Acceptance rejects only the lint errors a pass adds; errors already on HEAD are logged, not blamed
    (10-27: one old error rejected every batch, ~$100 in fix rounds). The sample error is a META line: an over-long line
    is no longer an error acceptance sees (it wraps it first, MechanicalWrap)."""

    def setUp(self):
        super().setUp()
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("# tooling\n\n- [a](a.md) — 甲\n- [b](b.md) — 乙\n")
        self.page("tooling/a.md", "- 旧事实，不声称已上线")
        self.page("tooling/b.md", "- 乙事实")
        self.commit("base with an old lint error")
        self.assertIn("tooling/a.md", I.lint_errors())  # HEAD itself fails lint

    def test_old_error_does_not_reject(self):
        self.page("tooling/a.md", "- 新事实一\n- 新事实二\n- 旧事实，不声称已上线")  # old error, line number moved
        errs = I.acceptance()
        self.assertNotIn("bookkeeping", errs)
        self.assertEqual(I.new_lint_errors(), "")
        self.assertIn("already on HEAD", I.LOG.read_text())

    def test_new_error_still_rejects(self):
        self.page("tooling/b.md", "- 乙事实\n- 新事实，不声称已上线")
        errs = I.new_lint_errors()
        self.assertIn("tooling/b.md", errs)
        self.assertNotIn("tooling/a.md", errs)
        self.assertIn("tooling/b.md", I.acceptance())

    def test_second_error_of_same_kind_on_same_page_rejects(self):
        self.page("tooling/a.md", "- 旧事实，不声称已上线\n- 又一条，不声称已修好")
        self.assertEqual(I.new_lint_errors().count("tooling/a.md"), 1)

    def test_dead_lint_still_rejects(self):
        (self.w / "bin" / "lint.py").write_text("raise SystemExit('boom')\n")
        self.assertIn("boom", I.new_lint_errors())


class Deliver(Fake):
    """A pass's commit conflicts with a commit someone made on the same page while it ran: the conflicted files are
    merged in the same pass and delivered (dispatch 2026-10-18 「在同一轮里当场合并后送达」); a merge that fails
    acceptance is dropped as before."""

    def setUp(self):
        super().setUp()
        self.keep2 = {k: getattr(I, k) for k in ("runner",)}
        I.WORK = self.w / ".ingest-work"
        (self.w / ".gitignore").write_text(".ingest-work/\n__pycache__/\n")
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n")
        self.page("tooling/big.md", "- 甲 `a1`\n- 乙 `b1`")
        self.commit("base")
        self.calls = []

    def tearDown(self):
        for k, v in self.keep2.items():
            setattr(I, k, v)
        super().tearDown()

    def split_and_collide(self):
        """Call 1: the pass moves 乙 to a new page in WORK; meanwhile another session edits 乙 in the real wiki."""
        t = I.WORK / "tooling"
        self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
        self.page_at(t / "part.md", "- 乙 `b1`")
        (t / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n- [part](part.md) — 拆出的乙\n")
        with open(I.WORK / "log.md", "a") as f:
            f.write("\n## [2026-10-18] restructure | split big\n- 乙 移到 part\n")
        self.page("tooling/big.md", "- 甲 `a1`\n- 乙 `b1`，别人更新 `b2`")
        self.other = self.commit("other session")

    def page_at(self, p, body):
        p.write_text(PAGE.format(name=p.stem, body=body))

    def fake(self, *edits):
        def run(instruction, stdin="", label="?", context=None):
            self.calls.append((label, instruction))
            edits[len(self.calls) - 1]()
            return True, "done", 0
        real = self.keep2["runner"]
        I.runner = lambda name: run if name == "fake" else real(name)

    def run_pass(self):
        return I.model_pass("split", "SPLIT big", engine="fake", kind="restructure", max_delete=120)

    def test_conflict_is_merged_and_delivered_same_pass(self):
        def merge():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "- 乙 `b1`，别人更新 `b2`")
        self.fake(self.split_and_collide, merge)
        self.assertEqual(self.run_pass(), "changed")
        self.assertEqual(len(self.calls), 2)
        self.assertIn("tooling/big.md", self.calls[1][1])  # only the conflicted file is handed to the model
        big, part = ((self.w / "tooling" / n).read_text() for n in ("big.md", "part.md"))
        self.assertIn("别人更新 `b2`", part)  # the other session's change, folded into the page the split made
        self.assertIn("乙 见 [[part]]", big)  # the pass's own result
        self.assertNotIn("<<<<<<<", big + part)
        r = subprocess.run(["git", "merge-base", "--is-ancestor", self.other, "HEAD"], cwd=self.w)
        self.assertEqual(r.returncode, 0)  # the other commit stays in the history, under the pass's
        self.assertEqual(subprocess.run(["git", "status", "--porcelain"], cwd=self.w, capture_output=True,
                                        text=True).stdout, "")
        self.assertIn("merged", I.LOG.read_text())

    def test_merge_failing_acceptance_is_dropped(self):
        def drop_theirs():  # resolves the markers but loses the other session's change
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
        def keep_markers():
            pass
        for merge in (drop_theirs, keep_markers):
            with self.subTest(merge=merge.__name__):
                subprocess.run(["git", "reset", "-q", "--hard", self.base_sha()], cwd=self.w, check=True)
                self.calls = []
                self.fake(self.split_and_collide, merge)
                self.assertIs(self.run_pass(), False)
                self.assertEqual(len(self.calls), 2)
                head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=self.w, capture_output=True, text=True).stdout
                self.assertEqual(head.strip(), self.other)  # nothing of the pass reached the wiki
                self.assertFalse((self.w / "tooling" / "part.md").exists())
                self.assertEqual(subprocess.run(["git", "status", "--porcelain"], cwd=self.w, capture_output=True,
                                                text=True).stdout, "")
                last = [l for l in I.LOG.read_text().splitlines() if "NOT DELIVERED" in l][-1]
                self.assertIn("tooling/big.md", last)  # the full name of the conflicted file
                self.assertFalse(I.LAST_REJECTED)  # like any undelivered pass: redone on a later run

    def only_work_split(self):
        """Call 1 without a collision: the pass's commit applies cleanly to the real wiki."""
        t = I.WORK / "tooling"
        self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
        self.page_at(t / "part.md", "- 乙 `b1`")
        (t / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n- [part](part.md) — 拆出的乙\n")

    def git_out(self, *a):
        return subprocess.run(["git", *a], cwd=self.w, capture_output=True, text=True)

    def side_conflict(self, how):
        """Someone else's unfinished git operation in the real wiki, conflicted on an unrelated file scratch.txt."""
        (self.w / "scratch.txt").write_text("- x\n")
        self.commit("other base")
        sh(self.w, "git", "checkout", "-q", "-b", "side")
        (self.w / "scratch.txt").write_text("- y\n")
        self.commit("side")
        sh(self.w, "git", "checkout", "-q", "-")
        if how == "stash":  # an unmerged file with no MERGE_HEAD / CHERRY_PICK_HEAD
            (self.w / "scratch.txt").write_text("- z\n")
            sh(self.w, "git", "stash", "-q")
            (self.w / "scratch.txt").write_text("- w\n")
            self.commit("main")
            self.git_out("stash", "pop")
        else:
            (self.w / "scratch.txt").write_text("- z\n")
            self.commit("main")
            self.git_out(*(["merge", "side"] if how == "merge" else ["cherry-pick", "side"]))
        self.assertTrue(self.git_out("ls-files", "-u").stdout)

    def test_someone_elses_unfinished_git_operation_is_left_alone(self):
        for how, marker in (("merge", "MERGE_HEAD"), ("cherry-pick", "CHERRY_PICK_HEAD"), ("stash", None)):
            with self.subTest(how=how):
                self.tearDown()
                self.setUp()
                self.side_conflict(how)
                self.fake(self.only_work_split)
                self.assertIs(self.run_pass(), False)
                self.assertEqual(len(self.calls), 1)  # no merge call: nothing conflicts with the pass's commit
                if marker:  # their operation is still going, not aborted by us
                    self.assertTrue((self.w / ".git" / marker).exists())
                self.assertTrue(self.git_out("ls-files", "-u").stdout)
                last = [l for l in I.LOG.read_text().splitlines() if "NOT DELIVERED" in l][-1]
                self.assertNotIn("conflicts in", last)
                self.assertIn("scratch.txt" if how == "stash" else marker, last)

    def test_merge_editing_other_files_is_dropped(self):
        def merge():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "- 乙 `b1`，别人更新 `b2`")
            (I.WORK / "MEMORY.md").write_text("- [tooling](tooling/README.md) — t，顺手改了\n")
        self.fake(self.split_and_collide, merge)
        self.assertIs(self.run_pass(), False)
        self.assertIn("MEMORY.md", [l for l in I.LOG.read_text().splitlines() if "outside" in l][-1])

    def test_merge_touching_real_wiki_is_noted(self):
        def merge():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "- 乙 `b1`，别人更新 `b2`")
            (self.w / "tooling" / "stray.md").write_text("model wrote into the real wiki\n")
        self.fake(self.split_and_collide, merge)
        self.run_pass()
        self.assertIn("changed during the merge", I.LOG.read_text())

    def test_unreadable_file_drops_the_merge(self):
        def merge():
            (I.WORK / "tooling" / "big.md").write_bytes(b"\xff\xfe not utf-8\n")
        self.fake(self.split_and_collide, merge)
        self.assertIs(self.run_pass(), False)  # no exception: the batch is redone on a later run
        last = [l for l in I.LOG.read_text().splitlines() if "NOT DELIVERED" in l][-1]
        self.assertIn("tooling/big.md", last)

    def test_line_the_newer_commit_deleted_must_not_come_back(self):
        def collide():  # the pass moves 乙 to part.md; meanwhile someone deletes 乙 as stale
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "- 乙 `b1`")
            (t / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n- [part](part.md) — 拆出的乙\n")
            self.page("tooling/big.md", "- 甲 `a1`，乙已过时删掉")
            self.other = self.commit("other session")
        def merge():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`，乙已过时删掉\n- 乙 见 [[part]]")
        self.fake(collide, merge)
        self.assertIs(self.run_pass(), False)
        self.assertIn("deleted", [l for l in I.LOG.read_text().splitlines() if "NOT DELIVERED" in l][-1])

    def test_kept_line_must_be_in_the_merged_pages_not_anywhere(self):
        self.page("tooling/far.md", "- 乙 `b1`，别人更新 `b2`")  # the same line on an unrelated page
        (self.w / "tooling" / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n- [far](far.md) — 远\n")
        self.commit("far")
        def collide():
            self.split_and_collide()
            (I.WORK / "tooling" / "README.md").write_text(
                "# tooling — 工具\n\n- [big](big.md) — 大页\n- [far](far.md) — 远\n- [part](part.md) — 拆出的乙\n")
        def merge():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
        self.fake(collide, merge)
        self.assertIs(self.run_pass(), False)

    def test_auto_merged_file_of_this_pass_is_checked_too(self):
        def collide():  # also edits README apart from the pass's change: git merges README by itself
            self.split_and_collide()
            sh(self.w, "git", "reset", "-q", "--soft", "HEAD~1")
            (self.w / "tooling" / "README.md").write_text("# tooling — 工具与脚本\n\n- [big](big.md) — 大页\n")
            self.other = self.commit("other session")
        def merge():  # resolves big.md, but rewrites README and drops the other session's new heading
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "- 乙 `b1`，别人更新 `b2`")
            (t / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n- [part](part.md) — 拆出的乙\n")
        self.fake(collide, merge)
        self.assertIs(self.run_pass(), False)
        self.assertIn("工具与脚本", [l for l in I.LOG.read_text().split("\n2026") if "NOT DELIVERED" in l][-1])

    def test_structure_line_they_deleted_may_stay_on_a_new_page(self):
        self.page("tooling/big.md", "- 甲 `a1`\n## 待办\n- 乙 `b1`")
        self.commit("base 2")
        def collide():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "## 待办\n- 乙 `b1`")
            (t / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n- [part](part.md) — 拆出的乙\n")
            self.page("tooling/big.md", "- 甲 `a1`\n- 乙 `b1`，别人更新 `b2`")
            self.other = self.commit("other session")
        def merge():
            t = I.WORK / "tooling"
            self.page_at(t / "big.md", "- 甲 `a1`\n- 乙 见 [[part]]")
            self.page_at(t / "part.md", "## 待办\n- 乙 `b1`，别人更新 `b2`")
        self.fake(collide, merge)
        self.assertEqual(self.run_pass(), "changed")

    def test_own_cherry_pick_left_by_a_killed_run_is_undone(self):
        real = I.git
        def killed(*a, **k):  # the run dies between its conflicting cherry-pick and the abort
            if a[:2] == ("cherry-pick", "--abort") and k.get("cwd") == I.REPO:
                raise KeyboardInterrupt
            return real(*a, **k)
        self.fake(self.split_and_collide,
                  lambda: (I.WORK / "tooling" / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页，下一轮\n"))
        I.git = killed
        try:
            with self.assertRaises(KeyboardInterrupt):
                self.run_pass()
        finally:
            I.git = real
        self.assertTrue((self.w / ".git" / "CHERRY_PICK_HEAD").exists())
        self.assertEqual(len(self.calls), 1)  # killed before any merge call
        self.assertEqual(self.run_pass(), "changed")
        self.assertFalse((self.w / ".git" / "CHERRY_PICK_HEAD").exists())
        self.assertNotIn("<<<<<<<", (self.w / "tooling" / "big.md").read_text())
        self.assertIn("下一轮", (self.w / "tooling" / "README.md").read_text())

    def base_sha(self):
        return subprocess.run(["git", "rev-list", "--max-parents=0", "HEAD"], cwd=self.w, capture_output=True,
                              text=True).stdout.strip()


# the reply that got through as a success: replay dream.log 2026-10-19 15:59 (gpt-6.1-sol resumed after luna's 503; on the
# relay it had no exec tool, only the Computer Use MCP, and did nothing), shortened to its deciding lines
GAVE_UP_REPLY = """这轮**没有完成原任务**。交接时尚未写入文件；随后自动审批未批准访问终端、文本编辑、访达、Pebrel 和 Chrome。

- 修改：无。
- 已有规则仍犯：尚未完成逐条归档，本轮新增次数不能可靠报告。
- 核对用户说法：0 项完成；没有改动 CLAIMS 行。

- A1 lint ok：**fail**，未能运行。
- A2 新记录有原话证据：**pass**，本轮无新记录。
- A5 每条纠正有去处：**fail**，尚未归档。
- A7 CLAIMS 逐项核对并记日志：**fail**，尚未完成。

自动审批给出的原因仅是这些应用“未获批准访问”。要继续完成，请在下一轮提供可用的文件编辑与命令执行工具。"""
DONE_REPLY = """log.md: 追加 dream 条目 — 无新模式
共核对 26 项，修正 1 项。
A1：pass，lint ok。 A2：pass。 A3：pass。 A4：pass。 A5：pass。 A6：pass。 A7：pass，26 项均已核对。"""


class GaveUp(Fake):
    """A reply that says the work was not done is a failed call (replay dream.log 2026-10-19 15:59: it was accepted as a
    success), and a resumed codex session runs with the same sandbox as the fresh one."""

    def setUp(self):
        super().setUp()
        self.keep2 = {k: getattr(I, k) for k in ("runner", "USAGE", "CODEX_CHAIN", "AFTER_CODEX", "LAST_ENGINE")}
        I.WORK, I.USAGE = self.w / ".ingest-work", self.tmp / "usage.tsv"
        (self.w / ".gitignore").write_text(".ingest-work/\n__pycache__/\n")
        (self.w / "bin").mkdir()
        (self.w / "bin" / "lint.py").write_text((Path(lint.__file__)).read_text())
        (self.w / "tooling" / "README.md").write_text("# tooling — 工具\n\n- [big](big.md) — 大页\n")
        self.page("tooling/big.md", "- 甲 `a1`")
        self.base = self.commit("base")
        self.cmds, self.replies, self.real_run = [], {}, subprocess.run

    def tearDown(self):
        for k, v in self.keep2.items():
            setattr(I, k, v)
        super().tearDown()

    def fake_codex(self, cmd, *a, **k):
        """subprocess.run for `codex exec`: answers by model with self.replies[model] (text → that reply in the -o file;
        None → rc 1 with a capacity error, like luna's 503 on 2026-10-19 15:53)."""
        if cmd[0] != "codex":
            return self.real_run(cmd, *a, **k)
        self.cmds.append(cmd)
        model, out = cmd[cmd.index("-m") + 1], cmd[cmd.index("-o") + 1]
        reply = self.replies[model]
        if reply is None:
            return subprocess.CompletedProcess(cmd, 1, '{"type":"thread.started","thread_id":"t1"}\n'
                                               '{"type":"error","message":"Selected model is at capacity"}\n', "")
        Path(out).write_text(reply)
        return subprocess.CompletedProcess(cmd, 0, '{"type":"thread.started","thread_id":"t1"}\n'
                                           '{"type":"turn.completed","usage":{"input_tokens":1}}\n', "")

    def test_gave_up_rules(self):
        """Only a reply that says it did no work at all (no tools) is a failed call."""
        self.assertEqual(I.gave_up(GAVE_UP_REPLY), "没有完成原任务")  # the 15:59 reply
        self.assertEqual(I.gave_up("这轮没做完。要继续完成，请在下一轮提供可用的文件编辑与命令执行工具。"), "请在下一轮提供")
        self.assertEqual(I.gave_up(DONE_REPLY), "")
        self.assertEqual(I.gave_up("A1：pass\n修改：无（页面已是最新）"), "")  # nothing to change is a result
        # an A-line fail alone is not: on main it is accepted as the script's acceptance decides (~/wiki/.ingest.log 2750)
        self.assertEqual(I.gave_up("- A6 **fail（部分）**：`discord-roles-ops` 超过 4000 字"), "")

    def test_resume_runs_with_the_same_sandbox(self):
        self.replies = {"m1": DONE_REPLY}
        from unittest import mock
        with mock.patch.object(I.subprocess, "run", self.fake_codex):
            ok, _, _, tid = I.codex("do", "", "t", "ctx", model="m1")
            self.assertTrue(ok and tid == "t1")
            I.codex("", I.RESUME_PROMPT, "t", model="m1", resume=tid)
        fresh, resumed = self.cmds
        self.assertEqual(fresh[:2], ["codex", "exec"])
        self.assertEqual(resumed[:4], ["codex", "exec", "resume", "t1"])

        def opts(c):  # everything but the subcommand, the result file and the fresh start's -C
            c = [x for x in c if not x.startswith(tempfile.gettempdir())]
            return [x for i, x in enumerate(c) if x not in ("-o", "-C") and c[i - 1] not in ("-o", "-C")][2:]
        self.assertEqual(opts(fresh), opts(resumed)[2:])
        self.assertIn('sandbox_mode="workspace-write"', resumed)
        self.assertEqual(resumed.count("-c"), fresh.count("-c"))

    def test_gave_up_reply_moves_to_the_next_model(self):
        """luna 503 → resume on sol, which only says it could not work → sol failed, astra fresh (the old code took
        sol's reply as a success: no retry, no next engine)."""
        self.replies = {"m1": None, "m2": GAVE_UP_REPLY, "m3": DONE_REPLY}
        from unittest import mock
        with mock.patch.object(I.subprocess, "run", self.fake_codex), \
                mock.patch.multiple(I, CODEX_CHAIN=["m1", "m2", "m3"], AFTER_CODEX=[]):
            ok = I.model_pass("dream 1 sessions", "DREAM", context="t", engine="codex:high",
                              kind="dream", max_delete=40)
        self.assertEqual(ok, True)  # m3's pass changed nothing: a success
        self.assertEqual(I.LAST_ENGINE, "codex:m3")
        self.assertEqual([c[2] for c in self.cmds], ["-m", "resume", "-m"])  # m1 fresh, m2 resumed, m3 fresh
        self.assertEqual([c[c.index("-m") + 1] for c in self.cmds], ["m1", "m2", "m3"])
        log = I.LOG.read_text()
        self.assertIn("m1 at capacity, resuming on m2", log)
        self.assertIn("reply says the work was not done (「没有完成原任务」)", log)
        self.assertIn("m2 failed without capacity error, starting m3 fresh", log)
        self.assertNotIn("REVERTED", log)

    def test_gave_up_reply_is_a_failed_call_on_any_engine(self):
        calls = []

        def run(instruction, stdin="", label="?", context=None):
            calls.append(label)
            return True, GAVE_UP_REPLY, 0
        real = self.keep2["runner"]
        I.runner = lambda name: run if name == "fake" else real(name)
        ok = I.model_pass("dream 1 sessions", "DREAM", context="t", engine="fake", kind="dream", max_delete=40)
        self.assertFalse(ok)
        self.assertFalse(I.LAST_REJECTED)  # a failed call, not a rejected result: retried next run
        self.assertEqual(calls, ["dream 1 sessions"])  # no fix round on a reply that did nothing
        log = I.LOG.read_text()
        self.assertIn("treated as a failed call", log)
        self.assertIn("REVERTED: model failed", log)

    def test_a_line_fail_is_accepted_as_on_main(self):
        """A reply that did the work but reports an A-line fail (~/wiki/.ingest.log line 2750, a page at its budget) is
        not a failed call: accepted as the script's acceptance decides, no fix round, as on main."""
        calls = []

        def run(instruction, stdin="", label="?", context=None):
            calls.append(label)
            return True, "- A1：pass\n- A6 **fail（部分）**：`discord-roles-ops` 超过 4000 字，压缩后宅改版 A–D 时删掉了几个仍然成立的细节", 0
        real = self.keep2["runner"]
        I.runner = lambda name: run if name == "fake" else real(name)
        ok = I.model_pass("ingest x", "INGEST", context="t", engine="fake", kind="ingest", max_delete=40)
        self.assertEqual(ok, True)
        self.assertEqual(calls, ["ingest x"])
        self.assertNotIn("REVERTED", I.LOG.read_text())


class MainLoop(unittest.TestCase):
    def test_queue_after_lint_or_nightly_reruns_as_day_ingest(self):
        """Sessions queued during a --lint/--nightly run are ingested next round, with day engines; no second lint/dream."""
        from unittest import mock
        for flag in ("--lint", "--nightly"):
            with tempfile.TemporaryDirectory() as d, self.subTest(flag=flag):
                d = Path(d)
                queue, calls = d / "queue", []

                def dream(*x):
                    calls.append("dream")
                    if calls.count("dream") > 1:
                        raise AssertionError("second dream")  # old code: lint/nightly forever
                    queue.write_text("queued-sid\n")  # a session closed while this run held the lock

                def ready(db, only=None, closed=()):
                    calls.append(("ready", set(closed)))
                    return []

                real_run = I.run
                runs = []

                def run(a, engines=None):
                    runs.append(engines)
                    return real_run(a, engines)

                old_wiki = I.WIKI
                with mock.patch.multiple(I, LOCK=d / "lock", QUEUE=queue, MIRROR_TO=None, pull=lambda: None, prepare=lambda: None,
                                         push=lambda: None, state=lambda: sqlite3.connect(":memory:"),
                                         lint_pass=lambda db: calls.append("lint_pass"), ready=ready, run=run, dream=dream,
                                         split_pass=lambda *x: None, review=lambda *x: calls.append("review")), \
                        mock.patch.object(sys, "argv", ["ingest.py", flag]), \
                        mock.patch.dict(os.environ, {"WIKI_INGEST": ""}):
                    try:
                        I.main()
                    finally:
                        I.WIKI = old_wiki
                once = ["lint_pass", "dream"] if flag == "--lint" else ["dream", "review"]
                self.assertEqual([c for c in calls if isinstance(c, str)], once)
                self.assertEqual(calls[-1], ("ready", {"queued-sid"}))  # last round ingests the queue
                self.assertEqual(runs[-1], None)  # day engines, not NIGHT_ENGINE


def ingest_with(wiki, code, bridge_config="/nonexistent-bridge-config"):
    """Run `code` in a fresh python that imports ingest with WIKI_DIR=wiki (config is read at import); its stdout.
    The bot roster is read from bridge_config (default: none, so the four fallback bots)."""
    env = {**os.environ, "WIKI_DIR": str(wiki)}
    for k in [k for k in env if k.startswith("WIKI_") and k not in ("WIKI_DIR",)]:
        env.pop(k)  # engine overrides from the caller's shell would mask the config under test
    env["WIKI_BRIDGE_CONFIG"] = str(bridge_config)
    r = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(Path(I.__file__).parent)!r});"
                        f"import ingest as I\n{code}"], env=env, capture_output=True, text=True)
    if r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout


ROLE_CONFIG = {"home": "~/wiki-helper", "assistant": "helper",
               "transcripts": "~/sessions/helper", "hosts": "",
               "rule_files": ["~/rules/helper.md"], "dream_dir": "misc", "rule_review_page": "rule-candidates",
               "pref_pages": ["prefs/*.md"], "dream_notify": "test-project discord:1",
               "bots": {"helper": ["Helper"], "peer": ["Peer"], "other": ["Other"]},
               "ingest_engine": "codex:high", "fallback_engine": "codex:high"}


class PersonaDefaults(unittest.TestCase):
    """No config.json uses the generic assistant identity and disables personal destinations."""

    def test_defaults_are_generic(self):
        with tempfile.TemporaryDirectory() as d:
            out = json.loads(ingest_with(d, "import json; print(json.dumps([I.ASSISTANT_NAMES, I.TEAMMATES, I.DREAM_PAGE, "
                                            "I.DREAM_NOTIFY, str(I.ROOT), str(I.HOSTS), I.ENGINE, I.AFTER_CODEX, I.CODEX_CHAIN]))"))
        self.assertEqual(out, [["assistant"], [], "tooling/rule-candidates.md",
                               "", "None", "/nonexistent-wiki-hosts", "haiku", ["agy", "haiku"],
                               ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]])

    def test_prompts_render_without_personal_identity(self):
        for name in ("SOP_INGEST", "SOP_REVIEW", "SOP_LINT", "SOP_DREAM"):
            text = getattr(I, name)
            self.assertNotIn("{assistant}", text)
            self.assertFalse([k for k in I.PERSONA if k in text], name)
        self.assertIn("CLAUDE = 助手（assistant）。", I.SOP_INGEST)
        self.assertIn("常驻", I.SOP_DREAM)

    def test_every_token_is_used(self):
        """A token no prompt uses means a prompt was reworded and a teammate silently gets 橘's text there."""
        text = "".join(getattr(I, n) for n in ("SOP_INGEST", "SOP_REVIEW", "SOP_LINT", "SOP_DREAM"))
        for k, v in I.PERSONA.items():
            self.assertIn(v, text, k)

    def test_unknown_config_key_fails(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "config.json").write_text(json.dumps({"languag": "zh"}))
            with self.assertRaises(AssertionError):
                ingest_with(d, "pass")


class TeammateConfig(unittest.TestCase):
    """A configured wiki uses its own identity, paths, roster and notification destination."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.w = Path(self.tmp.name)
        (self.w / "config.json").write_text(json.dumps(ROLE_CONFIG, ensure_ascii=False))

    def tearDown(self):
        self.tmp.cleanup()

    def test_paths_engines_names(self):
        out = json.loads(ingest_with(self.w, "import json; print(json.dumps([I.ASSISTANT_NAMES, I.TEAMMATES, I.DREAM_PAGE, "
                                     "I.DREAM_NOTIFY, str(I.ROOT), list(I.HOSTS.glob('*')), I.ENGINE, I.AFTER_CODEX, "
                                     "str(I.STATE), str(I.HOME)]))"))
        self.assertEqual(out, [["Helper"], ["Peer", "Other"], "misc/rule-candidates.md",
                               "test-project discord:1",
                               str(Path.home() / "sessions/helper"), [], "codex:high",
                               ["agy", "haiku"],  # same fallback chain as 橘: codex, then agy, then Claude (haiku)
                               str(self.w / ".ingest.sqlite"), str(Path.home() / "wiki-helper")])

    def test_prompts_name_her(self):
        out = json.loads(ingest_with(self.w, "import json; print(json.dumps([I.SOP_INGEST, I.SOP_REVIEW, I.SOP_LINT, I.SOP_DREAM]))"))
        ing, rev, lin, dream = out
        for t in out:
            self.assertNotIn("助手（橘）", t)
            self.assertNotIn("~/.claude/CLAUDE.md", t)
            self.assertNotIn("两份", t)
            self.assertNotIn("tooling/", t)
        self.assertIn("CLAUDE = 助手（helper）。TEAM <名字> = 队友机器人（peer、other）。", ing)
        self.assertIn("CLAUDE = 助手（helper）", rev)
        self.assertIn("`~/rules/helper.md`", dream)
        self.assertIn("misc/README.md", dream)
        self.assertIn("prefs/*.md", dream)
        self.assertIn("只读 `~/rules/helper.md`，不改它。", lin)
        self.assertIn("rule-candidates.md", lin)

    def test_examples_never_name_her_as_someone_else(self):
        for who, cfg in (("peer", {"assistant": "peer"}), ("other", {"assistant": "other"})):
            (self.w / "config.json").write_text(json.dumps({**ROLE_CONFIG, **cfg}, ensure_ascii=False))
            dream = json.loads(ingest_with(self.w, "import json; print(json.dumps(I.SOP_DREAM))"))
            self.assertNotIn(f"USER→{who}", dream, who)
            self.assertNotIn(f"TEAM {who}", dream, who)
            self.assertNotIn(f"比如回{who}", dream, who)

    def test_speakers_from_her_side(self):
        text = ("（频道里你上次看到之后的消息，按时间顺序；这是真实记录，先读它再回答）\n[13:28] Peer（bot）: 先查日志\n"
                "[13:29] Helper（bot）: 我看过了\n\n（最新，回这条）\n【Peer】你来改\n")
        out = json.loads(ingest_with(self.w, f"import json; print(json.dumps(I.speakers({text!r})))"))
        self.assertEqual(out, [["补漏 TEAM Peer", "先查日志"], ["补漏 CLAUDE", "我看过了"], ["TEAM Peer", "【Peer】你来改"]])

    def test_memory_index_block_dropped(self):
        """cc-connect's fresh-context MEMORY.md block (memoryindex.go) is context, not the user's words."""
        text = ("（你的记忆 wiki 目录页 ~/wiki-helper/MEMORY.md，新会话系统自动附上，不用回应）\n"
                "- [prefs](prefs/README.md) — 偏好\n\n（最新，回这条）\n今天玩什么")
        out = json.loads(ingest_with(self.w, f"import json; print(json.dumps(I.speakers({text!r})))"))
        self.assertEqual(out, [["USER", "今天玩什么"]])

    def test_old_state_db_is_used_as_is(self):
        """The teammates' .ingest.sqlite (written by their own copy) has the same tables: offsets carry over."""
        db = sqlite3.connect(self.w / ".ingest.sqlite")
        for t in ("ingested", "reviewed", "dreamed"):
            db.execute(f"create table {t}(id text primary key, offset int, at real)")
        db.execute("create table fails(id text primary key, n int)")
        db.execute("create table restructured(page text primary key, sha text, at real)")
        db.execute("insert into ingested values ('00f6ee91-01a14954', 46897, 1.0)")
        db.commit()
        db.close()
        out = ingest_with(self.w, "db = I.state(); print(db.execute('select offset from ingested').fetchall())")
        self.assertEqual(out.strip(), "[(46897,)]")

    def test_dream_notify_goes_to_her_and_trial_copy_only_logs(self):
        log = self.w / ".ingest.log"
        ingest_with(self.w, "I.dream_page = lambda: 'misc/rule-candidates.md'; I.notify_dream()")
        line = log.read_text()
        self.assertIn("dream notify skipped (trial copy", line)  # this temp dir is not her home: no real timer
        self.assertIn("'-p', 'test-project', '-s', 'discord:1'", line)
        self.assertIn("~/wiki-helper/misc/rule-candidates.md", line)
        self.assertIn("常驻 helper.md 不要自己改", line)


class LosslessSplit(unittest.TestCase):
    """A line over lint.BODY_LINE split by wrap() is kept (lossless's split-line rule); a dropped sentence or one changed
    character is still lost. missing() (acceptance, pre-commit) and lost() (page rewrites) agree."""
    LONG = ("- 开局瘦身（2026-10-28，用户原话「修一下」）：交互打 hi 从约 45.5k 降到 35.4k（真实界面状态栏验过）。"
            + "两周会话统计后关掉零调用的，" * 30 + "codegraph MCP 去掉 `alwaysLoad`（改按需加载）。备份 `*.bak`。")

    def check(self, new_lines, kept):
        import lossless
        old = f"# P\n## 关键事实\n- 甲\n{self.LONG}\n- 乙\n"
        new = "# P\n## 关键事实\n- 甲\n" + "\n".join(new_lines) + "\n- 乙\n"
        miss = lossless.missing({"infra/p.md": old}, {"infra/p.md": new, "infra/q.md": "- 别页\n"})
        lost = lossless.lost(old, new, "infra/p.md")
        self.assertEqual(miss == [], kept, miss)
        self.assertEqual(lost == [], kept, lost)
        if not kept:
            self.assertEqual(miss, [("infra/p.md", self.LONG)])
            self.assertEqual(lost, [self.LONG])

    def test_wrap_split_kept(self):
        parts = I.wrap(self.LONG)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(x) <= lint.BODY_LINE for x in parts))
        self.check(parts, True)
        self.check([w for x in ["  " + self.LONG] for w in I.wrap(x)], True)  # an indented sub-bullet too

    def test_sentence_dropped_lost(self):
        parts = I.wrap(self.LONG)
        self.check(parts[:-1], False)
        self.check([p.replace("瘦身", "瘦了") for p in parts], False)  # one character changed
        self.check([p.replace("45.5k", "45.k") for p in parts], False)  # one character deleted


class MechanicalWrap(DomainBase):
    """2026-10-28: models split over-long old lines by hand, reworded them, and lossless reverted three batches in a
    row. lint.wrap_pages / lint.py --wrap split them by code, verbatim; acceptance runs it first."""
    LONG = LosslessSplit.LONG

    def test_wrap_pages_verbatim_and_lint_clean(self):
        import lossless
        fence = "```\n" + "x" * 400 + "\n```"
        self.page("tooling/p1.md", f"- 甲\n{self.LONG}\n{fence}")
        old = lossless.corpus(None, self.w)
        self.assertEqual(lint.wrap_pages(self.w), ["tooling/p1.md"])
        text = (self.w / "tooling" / "p1.md").read_text()
        self.assertIn("x" * 400, text)  # a code block is never cut
        self.assertTrue(text.startswith("---\nname: p1\n"))  # frontmatter untouched
        self.assertEqual(lossless.missing(old, lossless.corpus(None, self.w)), [])
        errs = lint.check(self.w)[0]
        long = [e for e in errs if "p1.md: body line" in e and "chars >" in e]
        self.assertEqual(len(long), 1, errs)  # only the code line is left over-long
        self.assertIn("is 400 chars", long[0])
        self.assertEqual(lint.wrap_pages(self.w), [])  # idempotent

    def test_catalog_without_readme_untouched(self):  # refs/media/2026-10.md: a script-written index, not pages
        row = "- att-1 | 2026-10-14 | 附件 | " + "说明，" * 120 + " | /Volumes/x/att-1/"
        (self.w / "tooling" / "media" / "2026-10.md").write_text(f"# 目录\n{row}\n")
        self.assertEqual(lint.wrap_pages(self.w), [])
        self.assertIn(row, (self.w / "tooling" / "media" / "2026-10.md").read_text())

    def test_acceptance_wraps_before_judging(self):
        self.page("tooling/p1.md", f"- 甲\n{self.LONG}")
        self.commit("long line on HEAD")
        I.WIKI = self.w
        self.page("tooling/p2.md", f"- 页 p2，见 [[c:d]] 和 [[a.b]]\n{self.LONG.replace('开局', '收尾')}")  # a pass adds a long line
        errs = I.acceptance()
        self.assertNotIn("LOSSLESS", errs)
        self.assertNotIn("p2.md: body line", errs)
        self.assertTrue(all(len(l) <= lint.BODY_LINE for l in (self.w / "tooling" / "p2.md").read_text().splitlines()))
        self.assertTrue(all(len(l) <= lint.BODY_LINE for l in (self.w / "tooling" / "p1.md").read_text().splitlines()))

    def test_hand_split_with_reworded_text_still_lost(self):  # the check is not loosened: a reworded split is lost
        self.page("tooling/p1.md", f"- 甲\n{self.LONG}")
        self.commit("long line on HEAD")
        I.WIKI = self.w
        parts = lint.wrap(self.LONG)
        self.page("tooling/p1.md", "- 甲\n" + "\n".join([parts[0].replace("瘦身", "减重")] + parts[1:]))
        self.assertIn("LOSSLESS", I.acceptance())

    def test_cli_flag(self):
        self.page("tooling/p1.md", f"- 甲\n{self.LONG}")
        r = subprocess.run([sys.executable, "-I", str(Path(lint.__file__)), "--wrap", "--root", str(self.w)],
                           capture_output=True, text=True)
        self.assertIn("tooling/p1.md", r.stdout)
        self.assertEqual(r.stderr, "")
        self.assertNotIn("p1.md: body line", r.stdout)


class TeammateShims(unittest.TestCase):
    """The teammates' bin/ingest.py and bin/lint.py are byte copies of bin/teammate/: one code, no fork."""
    SHIMS = Path(I.__file__).resolve().parent / "teammate"

    def test_shim_refuses_old_tool(self):
        """A shim must refuse a configured shared tool that lacks the required marker."""
        with tempfile.TemporaryDirectory() as d:
            old = Path(d) / "ingest.py"
            old.write_text("# old tool without SHARED_TOOL\n")
            wiki = Path(d) / "wiki"
            (wiki / "bin").mkdir(parents=True)
            (wiki / "bin" / "ingest.py").write_bytes((self.SHIMS / "ingest.py").read_bytes())
            r = subprocess.run([sys.executable, "-I", str(wiki / "bin" / "ingest.py")],
                               env={**os.environ, "WIKI_BIN": d}, input="", capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("is not the shared tool", r.stderr)

    def test_lint_that_prints_nothing_but_fails_is_a_failure(self):
        """lint_errors: exit ≠ 0 with an empty stdout (a shim refusing a non-shared tool, a crash) is not a pass."""
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "bin").mkdir()
            old = I.WIKI
            try:
                I.WIKI = Path(d)
                (Path(d) / "bin" / "lint.py").write_text("import sys; sys.exit('not the shared tool')\n")
                self.assertIn("not the shared tool", I.lint_errors())
                (Path(d) / "bin" / "lint.py").write_text("import sys; sys.exit(3)\n")
                self.assertEqual(I.lint_errors(), "lint exit 3")
                (Path(d) / "bin" / "lint.py").write_text("print('lint ok')\n")
                self.assertEqual(I.lint_errors(), "")  # 橘's normal path unchanged
                (Path(d) / "bin" / "lint.py").write_text("import sys; print('x: bad'); sys.exit(1)\n")
                self.assertEqual(I.lint_errors(), "x: bad")
            finally:
                I.WIKI = old

    def test_shim_runs_shared_lint_on_its_own_wiki(self):
        with tempfile.TemporaryDirectory() as d:
            w = Path(d)
            (w / "bin").mkdir()
            for f in ("ingest.py", "lint.py", "search.py"):
                (w / "bin" / f).write_bytes((self.SHIMS / f).read_bytes())
            (w / "MEMORY.md").write_text("- [x](x/README.md) — x\n")
            r = subprocess.run([sys.executable, "-I", str(w / "bin" / "lint.py")], capture_output=True, text=True,
                               env={**os.environ, "WIKI_BIN": str(self.SHIMS.parent)})
            self.assertIn("x/README.md missing", r.stdout)  # checked the temp wiki, not ~/wiki
            (w / "x").mkdir()
            (w / "x" / "README.md").write_text("- [p](p.md) — p\n")
            (w / "x" / "p.md").write_text("---\nname: p\ndescription: d\n---\n# P\n## 现状\n- 龙娘的外出频道编号\n")
            r = subprocess.run([sys.executable, "-I", str(w / "bin" / "search.py"), "外出频道"], capture_output=True,
                               text=True, env={**os.environ, "WIKI_BIN": str(self.SHIMS.parent)})
            self.assertIn(f"{w.resolve()}/x/p.md:7  - 龙娘的外出频道编号", r.stdout, r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=1)
