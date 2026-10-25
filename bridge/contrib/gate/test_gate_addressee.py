"""gate.py「没 @ 的消息该归谁」（addressee）的规则测试，不加载模型、不联网：python3 -I contrib/gate/test_gate_addressee.py
测别的版本（如修前的 gate.py）：GATE_PY=<路径> python3 -I contrib/gate/test_gate_addressee.py

用户原话：2026-10-22「核心要区分一下，让jev判断，是给谁回的」；2026-10-23「没艾特他，怎么他在说话」。
假 jev 照真模型的行为挑「最后一位说话的 AI」（真模型 8 个情景全对见 gate.py ADDR_SUFFIX 注释）。"""
import importlib.machinery, importlib.util, json, os, re, sys, tempfile, threading, time, types, unittest
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# 测试用团队：名字照用户的真实团队（症状发生在这套名字上），Discord ID 是假的
IDS = {"": "1001", "longniang": "1002", "jingyu": "1003", "caihongmao": "1004", "minimax": "1005"}
TEAM = {"lead": {"name": "橘", "aliases": ["猫猫", "Claude橘", "maomao"], "id": IDS[""]},
        "subs": {"longniang": {"name": "龙娘", "aliases": [], "id": IDS["longniang"]},
                 "jingyu": {"name": "鲸鱼娘", "aliases": ["鲸鱼", "大肥鱼"], "id": IDS["jingyu"]},
                 "caihongmao": {"name": "彩虹猫", "aliases": [], "id": IDS["caihongmao"]},
                 "minimax": {"name": "岚汐", "aliases": ["闪片"], "id": IDS["minimax"]}}}
CHAT = "discord:999"


def load_gate(config_toml=None):
    """临时 GATE_SETUP_DIR（不读本机 ~/.cc-connect）+ 假 scorer（GATE_MODEL=fake 走本机打分器那条路，拿到的是假的）。"""
    fake = types.ModuleType("scorer")

    class Scorer:
        def __init__(self, *a, **k):
            pass

        def prepare(self, *a, **k):
            return self

    fake.Scorer = Scorer
    sys.modules["scorer"] = fake
    d = Path(tempfile.mkdtemp())
    (d / "gate-team.json").write_text(json.dumps(TEAM, ensure_ascii=False), encoding="utf-8")
    if config_toml is not None:
        (d / "config.toml").write_text(config_toml, encoding="utf-8")
    os.environ["GATE_SETUP_DIR"] = str(d)
    os.environ["GATE_LOG"] = str(d / "gate.jsonl")
    os.environ["GATE_MODEL"] = "fake"
    os.environ["BOTHOUSE_DATA_DIR"] = str(d)
    for k in ("GATE_JEV", "GATE_TEAM", "GATE_LEAD_FILE", "GATE_WIKI"):
        os.environ.pop(k, None)
    for m in ("gate", "lead", "ctxsvc"):
        sys.modules.pop(m, None)
    src = os.environ.get("GATE_PY") or str(HERE / "gate.py")
    loader = importlib.machinery.SourceFileLoader("gate", src)
    g = importlib.util.module_from_spec(importlib.util.spec_from_loader("gate", loader))
    sys.modules["gate"] = g
    loader.exec_module(g)
    g._test_data_dir = d
    return g


gate = load_gate()
SC = lambda choice, n: types.SimpleNamespace(choice=choice, probs=[0] * n)


class Base(unittest.TestCase):
    REPORT = "【结论】新版宣传片发上来了。@ 不回的修复已经换上，这条发出去十秒后五个 bot 会重启"

    def setUp(self):
        self.calls = []

        def score(text, **k):
            self.calls.append(text)
            m = re.search(r"最后一位说话的 AI：(\S+?)（", text)
            keys = [k for k in gate.lead.KEYS if m and gate.lead.NAME[k] == m.group(1)]
            return SC(gate.lead.KEYS.index(keys[0]) if keys else len(gate.lead.KEYS), 6)

        names = ("addr_task", "recent_messages", "team_recent", "team_online", "named_task", "sub_task", "ADDR_DEADLINE")
        self.saved = {n: getattr(gate, n, None) for n in names}
        self.saved_tasks = dict(gate.tasks)
        self.saved_current = gate.lead.current
        gate.addr_task = types.SimpleNamespace(score=score)
        reply = types.SimpleNamespace(score=lambda *a, **k: SC(2, 4))
        gate.tasks.update({k: reply for k in gate.tasks})
        gate.named_task = types.SimpleNamespace(score=lambda *a, **k: types.SimpleNamespace(choice=0, probs=[1, 0]))
        gate.sub_task = types.SimpleNamespace(score=lambda *a, **k: SC(0, 3))
        gate.team_recent = lambda chat: []
        self.online = set(gate.lead.KEYS)
        gate.team_online = lambda k, chat: k in self.online
        getattr(gate, "_addr_cache", {}).clear()  # getattr：GATE_PY 指向修前的版本时也能跑到断言
        getattr(gate, "_talk", {}).clear()
        gate.current_task.clear()

    def tearDown(self):
        for n, v in self.saved.items():
            setattr(gate, n, v)
        gate.tasks.clear(); gate.tasks.update(self.saved_tasks)
        gate.lead.current = self.saved_current

    def history(self, msgs):
        gate.recent_messages = lambda chat, limit: list(msgs)

    def clear(self):
        getattr(gate, "_addr_cache", {}).clear()

    def all_route(self, content, mentioned=(), **kw):
        self.clear()
        return {b: gate.route({"content": content, "mentioned": b in mentioned, "busy": False,
                               "session_key": CHAT, **kw}, b)[0] for b in gate.lead.KEYS}

    def replied(self, r):
        return [b for b, a in r.items() if a in ("reply", "insert", "abort")]

    def jev_timeout(self, lead_key="jingyu"):
        """主角色设成 lead_key，jev 每次都卡过截止（真 jev 的 2.5s 超时、网络慢）。"""
        gate.lead.current = lambda: lead_key
        gate.ADDR_DEADLINE = 0.05
        gate.addr_task = types.SimpleNamespace(score=lambda *a, **k: (time.sleep(0.3), SC(5, 6))[1])

    def route_plain(self, text):
        """主角色鲸鱼娘攒了 24 条没回（gate.jsonl 里抢答那次的样子），橘正忙，其余空闲。"""
        self.clear()
        return {b: gate.route({"content": text, "mentioned": False, "busy": b == "",
                               "buffered": ["x"] * 24 if b == "jingyu" else [], "session_key": CHAT}, b)
                for b in gate.lead.KEYS}


class Symptom(Base):
    """验收第一条：用户没 @ 鲸鱼娘（主角色）、正在和另一个角色对话时，鲸鱼娘不开口，归正在对话的那位。"""

    def test_lead_silent_while_user_talks_to_other(self):
        # 2026-10-23 09:26:16 用户回复橘；09:26:52 没 @ 的一句 jev 超时，归了主角色鲸鱼娘，她攒满条数抢答
        gate.lead.current = lambda: "jingyu"
        self.history([(30, "", [], "龙娘的声音，我也不会再去试十几条")])
        first = self.all_route("[replying to Claude橘: ] 怎么声音换了一个人啊，橘的那个")
        self.assertEqual(self.replied(first), [""], first)
        self.jev_timeout()
        r = self.route_plain("但是你成片就很正常，不是这个声音")
        self.assertEqual(self.replied({b: v[0] for b, v in r.items()}), [""], r)
        self.assertEqual(r["jingyu"][0], "context", r["jingyu"])
        self.assertIn("jev 超时", r[""][1])


class Addressee(Base):
    def test_shared_lead_file_switches_unmentioned_route(self):
        self.history([])
        state = gate._test_data_dir / "lead.json"
        state.write_text(json.dumps({"lead": "longniang"}), encoding="utf-8")
        routed = self.all_route("没有点名的消息")
        self.assertEqual(self.replied(routed), ["longniang"], routed)
        state.unlink()
        routed = self.all_route("没有点名的消息")
        self.assertEqual(self.replied(routed), [""], routed)

    def test_legacy_lead_file_migrates_once_and_new_file_wins(self):
        self.history([])
        state = gate._test_data_dir / "lead.json"
        legacy = gate._test_data_dir / "gate-lead.json"
        legacy.write_text(json.dumps({"lead": "maomao"}), encoding="utf-8")
        self.assertEqual(gate.lead.current(), "")
        self.assertEqual(json.loads(state.read_text(encoding="utf-8"))["lead"], "")
        state.write_text(json.dumps({"lead": "longniang"}), encoding="utf-8")
        self.assertEqual(gate.lead.current(), "longniang")
        state.write_text(json.dumps({"lead": "maomao"}), encoding="utf-8")
        self.assertEqual(gate.lead.current(), "")

    def test_gate_setup_dir_is_shared_product_data_dir_without_bridge_env(self):
        src = HERE / "lead.py"
        old_setup, old_product = os.environ.get("GATE_SETUP_DIR"), os.environ.pop("BOTHOUSE_DATA_DIR", None)
        try:
            os.environ["GATE_SETUP_DIR"] = str(gate._test_data_dir)
            loader = importlib.machinery.SourceFileLoader("lead_setup_path_test", str(src))
            mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("lead_setup_path_test", loader))
            loader.exec_module(mod)
            mod.configure(TEAM)
            self.assertEqual(mod.LEAD_FILE, gate._test_data_dir / "lead.json")
        finally:
            if old_setup is None:
                os.environ.pop("GATE_SETUP_DIR", None)
            else:
                os.environ["GATE_SETUP_DIR"] = old_setup
            if old_product is not None:
                os.environ["BOTHOUSE_DATA_DIR"] = old_product

    def test_follow_lead_report(self):  # 接着橘的汇报不 @ 说一句 → 只有橘回
        self.history([(30, "", [], self.REPORT), (400, None, [], "宣传片再改一版")])
        self.assertEqual(self.replied(self.all_route("修复推到代码仓，子agent做")), [""])

    def test_follow_jingyu(self):  # 接着鲸鱼娘的话 → 只有鲸鱼娘回
        self.history([(20, "jingyu", [], "要我继续查慢的原因吗？"), (300, "", ["jingyu"], "先停一下")])
        self.assertEqual(self.replied(self.all_route("继续查吧")), ["jingyu"])

    def test_follow_sub_while_lead_is_other(self):  # 收件人不是主角色时主角色也只收上下文
        self.history([(40, "longniang", [], "第 3 项要改接口，你定一下要不要做")])
        r = self.all_route("第三项也做")
        self.assertEqual(self.replied(r), ["longniang"])
        self.assertEqual({a for b, a in r.items() if b != "longniang"}, {"context"})

    def test_no_context_goes_to_lead(self):  # 完全没上下文 → 主角色回，不调模型
        self.history([])
        self.assertEqual(self.replied(self.all_route("今天天气怎么样")), [gate.lead.current()])
        self.assertEqual(self.calls, [])

    def test_model_unsure_goes_to_lead(self):  # 有上下文但判不出 → 主角色
        self.history([(30, None, [], "写一下周报")])
        self.assertEqual(self.replied(self.all_route("你们觉得今晚吃什么好")), [gate.lead.current()])

    def test_one_model_call_for_five_bots(self):  # 五个 bot 问同一条只算一次，结论一致
        self.history([(30, "", [], self.REPORT)])
        self.all_route("修复推到代码仓")
        self.assertEqual(len(self.calls), 1)

    def test_unsure_letter_follows_team_size(self):  # 团队几个人就几个选项，下一个字母是「看不出」
        self.assertEqual(gate.ADDR_LETTERS, "ABCDE")
        self.assertEqual(gate.ADDR_UNSURE, "F")

    def test_merged_burst_shares_decision(self):  # 空闲的 bot 把连发合并成一条，忙的 bot 分条问：按最后一条对齐
        self.history([(30, "jingyu", [], "要发布吗？")])
        self.clear()
        busy = gate.route({"content": "发吧", "busy": True, "session_key": CHAT}, "jingyu")[0]
        idle = gate.route({"content": "等等\n发吧", "parts": [{"content": "等等"}, {"content": "发吧"}],
                           "session_key": CHAT}, "")[0]
        self.assertEqual((busy, idle), ("reply", "context"))
        self.assertEqual(len(self.calls), 1)

    def test_mention_and_reply_unchanged(self):  # 有 @、回复某人、点名、命令的消息照旧，不经过 jev
        self.history([(20, "jingyu", [], "要我继续查吗？")])
        at_lead = lambda b: ("看看这个", True) if b == "" else (f"<@{IDS['']}> 看看这个", False)
        cases = [lambda b: (f"<@{IDS['longniang']}> 看看这个", False) if b != "longniang" else ("看看这个", True), at_lead,
                 lambda b: ("[replying to 龙娘: 第 3 项]\n做吧", False), lambda b: ("龙娘，帮我看看", False),
                 lambda b: ("/status", False)]
        fake = gate.addr_task
        for case in cases:
            run = lambda: {b: gate.route({"content": case(b)[0], "mentioned": case(b)[1], "session_key": CHAT}, b)[0]
                           for b in gate.lead.KEYS}
            self.clear(); on = run()
            gate.addr_task = None; off = run(); gate.addr_task = fake
            self.assertEqual(on, off, case("")[0])
        self.assertEqual(self.calls, [])

    def test_reply_goes_to_replied_member(self):  # 回复谁的消息就是在跟谁说：只有她回（引用里的名字不算叫别人）
        self.history([])
        self.assertEqual(self.replied(self.all_route("[replying to 龙娘: 鲸鱼娘说的那个]\n做吧")), ["longniang"])
        self.assertEqual(self.replied(self.all_route("[replying to Claude橘: 龙娘写的]\n嗯嗯，可以")), [""])

    def test_burst_mention_then_image(self):  # 「@橘 这个你怎么看」+图拆两条、合并后图在最后：按文字那条判，只有橘回，不经 jev
        self.history([(20, "jingyu", [], "要我继续查吗？")])
        gate.sub_task = types.SimpleNamespace(score=lambda *a, **k: SC(1, 3))
        self.clear()
        r = {}
        for b in gate.lead.KEYS:
            text = "这个你怎么看" if b == "" else f"<@{IDS['']}> 这个你怎么看"
            r[b] = gate.route({"content": text, "mentioned": b == "", "busy": True, "has_images": True, "session_key": CHAT,
                               "parts": [{"content": text, "mentioned": b == ""}, {"content": "", "mentioned": False}]}, b)[0]
        self.assertEqual(self.replied(r), [""])
        self.assertEqual(self.calls, [])

    def test_attach_only_goes_to_jev(self):  # 只发图、没 @、没文字：交 jev 判，接着鲸鱼娘的话就只有鲸鱼娘接
        self.history([(20, "jingyu", [], "截图发我看看？")])
        r = self.all_route("", has_images=True)
        self.assertEqual(self.replied(r), ["jingyu"])
        self.assertEqual(len(self.calls), 1)
        self.assertIn(gate.ATTACH_ONLY_MSG, self.calls[0])

    def test_attach_only_judged_lead_or_unsure(self):  # jev 判给主角色或没上下文：主角色照常接（插入/回复）
        lead_key = gate.lead.current()
        self.history([(20, lead_key, [], "图发上来我看")])
        self.assertEqual(self.replied(self.all_route("", has_images=True)), [lead_key])
        self.history([])
        self.assertEqual(self.replied(self.all_route("", has_files=True)), [lead_key])

    def test_offline_addressee_goes_to_lead(self):  # 判给的 bot 下线/不在本频道 → 交主角色，正好一位回
        self.history([(20, "jingyu", [], "要我继续查慢的原因吗？")])
        self.online = set(gate.lead.KEYS) - {"jingyu"}
        self.assertEqual(self.replied(self.all_route("继续查吧")), [gate.lead.current()])

    def test_merged_and_single_agree(self):  # 合并与逐条两种请求：适用判断和结论一致
        self.history([(30, "jingyu", [], "要发布吗？")])
        for first in ("busy", "idle"):  # 谁先到都一样
            self.clear(); self.calls.clear()
            busy = lambda: gate.route({"content": "发吧", "busy": True, "session_key": CHAT}, "jingyu")[0]
            idle = lambda: gate.route({"content": "鲸鱼娘 等等\n发吧", "busy": False, "session_key": CHAT,
                                       "parts": [{"content": "鲸鱼娘 等等"}, {"content": "发吧"}]}, "")[0]
            if first == "busy":
                r = (busy(), idle())
            else:
                i = idle(); r = (busy(), i)
            self.assertEqual(r, ("reply", "context"), first)
            self.assertEqual(len(self.calls), 1, first)
        self.clear(); self.calls.clear()
        lid = IDS["longniang"]
        merged = gate.route({"content": f"<@{lid}> 看下\n发吧", "session_key": CHAT,
                             "parts": [{"content": f"<@{lid}> 看下"}, {"content": "发吧"}]}, "caihongmao")
        single = gate.route({"content": "发吧", "busy": True, "session_key": CHAT}, "caihongmao")
        self.assertEqual(merged[0], single[0])
        self.assertIn("jev", merged[1]); self.assertIn("jev", single[1])
        # 前面那条 @ 的是龙娘本人：龙娘照被 @ 的规则回，不因最后一条判给鲸鱼娘丢掉
        r = gate.route({"content": "看下\n发吧", "mentioned": True, "session_key": CHAT,
                        "parts": [{"content": "看下", "mentioned": True}, {"content": "发吧"}]}, "longniang")
        self.assertEqual(r[0], "reply")

    def test_timeout_all_waiters_get_none(self):  # 打分卡住：到截止所有等待方都拿 None（交主角色），之后算完的丢弃
        self.history([(30, None, [], "要发布吗？")])  # 只有用户的话：没有在进行的对话
        release = threading.Event()
        gate.addr_task = types.SimpleNamespace(score=lambda text, **k: (release.wait(5), SC(2, 6))[1])
        self.addCleanup(release.set)
        gate.ADDR_DEADLINE = 0.3
        out = {}
        req = lambda b: {"content": "发吧", "busy": False, "session_key": CHAT}
        ts = [threading.Thread(target=lambda b=b: out.__setitem__(b, gate.addressee(req(b), b))) for b in gate.lead.KEYS]
        t0 = time.time()
        for t in ts: t.start()
        for t in ts: t.join(3)
        self.assertLess(time.time() - t0, 1.5)
        self.assertEqual({b: r[:2] for b, r in out.items()}, {b: (None, "jev 超时") for b in gate.lead.KEYS})
        release.set(); time.sleep(0.1)  # 算完的结果不覆盖
        self.assertEqual(gate.addressee(req(""), "")[:2], (None, "jev 超时"))
        gate.ADDR_DEADLINE = 0.2; release.clear()  # 路由层：超时 → 主角色走主规则、其余 context，正好一位回
        self.assertEqual(self.replied(self.all_route("发吧")), [gate.lead.current()])
        release.set()

    def test_self_removal_exact_only(self):  # 去掉本条只删原文相同的一条，历史里是本条子串的旧消息留着
        seen = []
        gate.addr_task = types.SimpleNamespace(score=lambda text, **k: seen.append(text) or SC(5, 6))
        self.history([(1, None, [], "继续查吧"), (10, None, [], "继续"), (20, "jingyu", [], "要我继续查吗？")])
        gate._judge_addressee(CHAT, "继续查吧")
        self.assertIn("用户：继续\n", seen[0])
        self.assertNotIn("用户：继续查吧", seen[0])


class Talk(Base):
    """对话延续：jev 判不出时接着用户正在说话的那位（2026-10-23）。"""

    def test_no_ongoing_talk_still_goes_to_lead(self):  # 没有在进行的对话（或已过窗口）：jev 判不出照旧归主角色
        self.history([(30, None, [], "写一下周报")])
        self.assertEqual(self.replied(self.all_route("你们觉得今晚吃什么好")), [gate.lead.current()])
        gate._talk[CHAT] = ("longniang", time.time() - gate.LAST_FRESH_SECS - 1)
        self.assertEqual(self.replied(self.all_route("你们觉得今晚吃什么好")), [gate.lead.current()])

    def test_unaddressed_insert_not_talk(self):  # 主角色按「只有附件」自己插话：用户没在跟她说，不记成对话（审查第 4 条）
        self.jev_timeout()
        gate.lead.current = lambda: ""
        self.history([])
        self.clear()
        a, _, _ = gate.route({"content": "", "busy": True, "has_images": True, "session_key": CHAT}, "")
        self.assertEqual(a, "insert")
        self.assertNotIn(CHAT, gate._talk)
        gate.lead.current = lambda: "jingyu"
        r = self.route_plain("但是你成片就很正常")
        self.assertEqual(self.replied({b: v[0] for b, v in r.items()}), ["jingyu"], r)

    def test_lead_buffer_reply_not_talk(self):  # 主角色因「攒满 6 条」回了一句不算对话；jev 判给她的算
        self.history([])
        gate.addr_task = None  # 关掉 addressee，只看主角色自己的规则
        self.clear()
        a, why, _ = gate.route({"content": "随便聊聊", "buffered": ["x"] * 5, "session_key": CHAT}, gate.lead.current())
        self.assertEqual(a, "reply", why)
        self.assertNotIn(CHAT, gate._talk)

    def test_jev_unsure_beats_talk(self):  # jev 明确答「看不出 / 对大家说的」：以 jev 为准，不改写成接着对话的那位（审查第 2 条）
        gate._talk[CHAT] = ("longniang", time.time() - 60)
        self.history([(60, "longniang", [], "脚本写好了")])
        gate.addr_task = types.SimpleNamespace(score=lambda *a, **k: (self.calls.append(a), SC(len(gate.lead.KEYS), 6))[1])
        r = self.all_route("大家怎么看？")
        self.assertEqual(self.replied(r), [gate.lead.current()], r)

    def test_no_history_still_asks_jev(self):  # 拉不到历史、没有队友状态，但记得正在和龙娘说：把它交给 jev 判（审查第 2 条）
        gate._talk[CHAT] = ("longniang", time.time() - 60)
        self.history([])
        r = self.all_route("那你接着弄")
        self.assertEqual(len(self.calls), 1)
        self.assertIn("最后一位说话的 AI：龙娘", self.calls[0])
        self.assertEqual(self.replied(r), ["longniang"], r)

    def test_recipient_no_extra_model(self):  # 判给 sub 后不再串 judge / tier 模型，jev 1s 时整条在 gate_timeout_ms 3000 内（审查第 1 条）
        self.history([(20, "jingyu", [], "要我继续查吗？")])
        slow = lambda r: types.SimpleNamespace(score=lambda *a, **k: (time.sleep(1.0), r)[1])
        gate.addr_task = types.SimpleNamespace(score=lambda *a, **k: (time.sleep(1.0), SC(gate.lead.KEYS.index("jingyu"), 6))[1])
        gate.tasks.update({k: slow(SC(2, 4)) for k in gate.tasks})
        saved_tier = gate.tier_task
        gate.tier_task = slow(SC(1, 2))
        try:
            self.clear()
            req = {"content": "那你接着往下看看后端那边的情况，顺手瞧瞧还有哪里不对劲", "busy": False, "session_key": CHAT}
            t = time.time()
            a, why, _ = gate.route(req, "jingyu")
            tier = gate.tier_of(req, model=": 判给我；" not in why)
            took = time.time() - t
        finally:
            gate.tier_task = saved_tier
        self.assertEqual(a, "reply", why)
        self.assertIsNone(tier[0], tier)
        self.assertLess(took, 2.0, took)  # 只剩 jev 那一次（1s）

    def test_bot_report_counts_as_talk(self):  # 龙娘主动来报结果（_talk 里没有她），下一条没 @ 且 jev 超时 → 只有龙娘接
        self.jev_timeout()
        gate._talk[CHAT] = ("", time.time() - 600)  # 橘 10 分钟前接过用户的话，龙娘 20 秒前才发言：取较新的
        self.history([(20, "longniang", [], "活做完了，三个测试都过了"), (600, None, [], "龙娘去把测试补上")])
        r = self.route_plain("那合进去吧")
        self.assertEqual(self.replied({b: v[0] for b, v in r.items()}), ["longniang"], r)

    def test_bot_talk_window_and_bot_to_bot(self):  # 最后发言的 bot 超过窗口、或那条是 @ 别的 bot：不算，照旧归主角色
        self.jev_timeout()
        self.history([(gate.LAST_FRESH_SECS + 5, "longniang", [], "活做完了")])
        self.assertEqual(self.replied({b: v[0] for b, v in self.route_plain("那合进去吧").items()}), ["jingyu"])
        self.history([(20, "longniang", [""], "橘，我做完了")])
        self.assertEqual(self.replied({b: v[0] for b, v in self.route_plain("那合进去吧").items()}), ["jingyu"])

    def test_offline_talker_not_followed(self):  # 正在对话的那位下线了：不接给她，照旧归主角色
        self.jev_timeout()
        gate._talk[CHAT] = ("", time.time() - 10)
        self.online = set(gate.lead.KEYS) - {""}
        self.history([])
        self.assertEqual(self.replied({b: v[0] for b, v in self.route_plain("那合进去吧").items()}), ["jingyu"])


class Stop(Base):
    """她正忙、用户没 @ 她只说一句停止词：jev 判给她或超时兜底给她，都要 abort 打断手上那一轮（用户原话「我说暂停，还要等个40分钟」）。
    词表同 core/gate_local.go:29 localStopWords。"""

    def ask(self, text, busy=True, bot="longniang"):
        self.clear()
        return gate.route({"content": text, "mentioned": False, "busy": busy, "session_key": CHAT}, bot)

    def test_busy_stop_jev_judged_aborts(self):  # jev 判给正忙的龙娘
        for text in ("暂停", "停一下", "别做了", "Stop", "pause!", "暂停。", " 停一下！"):
            self.history([(30, "longniang", [], "我在跑脚本")])
            a, why = self.ask(text)[:2]
            self.assertEqual(a, "abort", (text, why))
            self.assertIn("rule: 停止词", why)

    def test_busy_stop_jev_timeout_aborts(self):  # jev 超时，兜底交给正在对话的龙娘
        self.jev_timeout()
        gate._talk[CHAT] = ("longniang", time.time() - 30)
        self.history([(30, "longniang", [], "我在跑脚本")])
        a, why = self.ask("暂停")[:2]
        self.assertEqual(a, "abort", why)
        self.assertIn("jev 超时", why)

    def test_busy_lead_stop_aborts(self):  # 判给的是正忙的主角色橘，同样打断
        self.history([(30, "", [], "我在跑脚本")])
        self.assertEqual(self.ask("别做了", bot="")[0], "abort")

    def test_not_stop_or_not_busy_unchanged(self):  # 不忙、句子里只是含停止词、停止词只在引用里：照旧 reply
        self.history([(30, "longniang", [], "我在跑脚本")])
        self.assertEqual(self.ask("暂停", busy=False)[:2], ("reply", "jev: 判给我；rule: jev 判给我"))
        self.assertEqual(self.ask("暂停的那个脚本结果呢")[0], "reply")
        self.assertEqual(self.ask("[replying to 龙娘: 暂停]\n继续跑")[0], "reply")


@unittest.skipIf(sys.version_info < (3, 11), "config.toml 要 tomllib（Python 3.11+）")
class Config(unittest.TestCase):
    """token、用户 ID、team_status_dir 都从 cc-connect 现有的 config.toml 读；bot 认法用团队文件。"""
    TOML = """
[[projects]]
name = "jingyu"
team_status_dir = "{team}"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "sub-token"
allow_from = "42,43"

[[projects]]
name = "maomao"
team_status_dir = "{team}"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "${{GATE_TEST_LEAD_TOKEN}}"
allow_from = "42"

[[projects]]
name = "someone-else"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "not-ours"
allow_from = "*"
"""

    @classmethod
    def setUpClass(cls):
        cls.team = Path(tempfile.mkdtemp())
        os.environ["GATE_TEST_LEAD_TOKEN"] = "lead-token"
        cls.g = load_gate(cls.TOML.format(team=cls.team))
        global gate
        cls.prev, gate = gate, cls.g

    @classmethod
    def tearDownClass(cls):
        global gate
        gate = cls.prev
        os.environ.pop("GATE_TEST_LEAD_TOKEN", None)

    def test_reads_existing_config(self):
        g = self.g
        self.assertEqual(g.TEAM_DIR, self.team)
        self.assertEqual(g.USER_IDS, {"42", "43"})   # 不在团队里的 project 不读
        self.assertEqual(g._discord_token(), "lead-token")  # 主角色优先；${VAR} 从环境变量取

    def test_token_not_cached_on_failure(self):
        g = self.g
        old_cfg, old_tok = g.CC_CONFIG, g._dc["token"]
        try:
            g.CC_CONFIG, g._dc["token"] = Path("/nonexistent-gate-config.toml"), None
            self.assertEqual(g._discord_token(), "")
            self.assertIsNone(g._dc["token"])
        finally:
            g.CC_CONFIG, g._dc["token"] = old_cfg, old_tok

    def test_team_online_reads_status_file(self):  # 真读 <team_status_dir>/<project>.json：过期或没有本频道 → 不在线
        g = self.g
        now = datetime.now(timezone.utc).isoformat()
        stale = datetime.fromtimestamp(time.time() - 120, timezone.utc).isoformat()
        (self.team / "jingyu.json").write_text(json.dumps({"project": "jingyu", "updated": now, "sessions": [{"key": "discord:999:u1"}]}))
        (self.team / "longniang.json").write_text(json.dumps({"project": "longniang", "updated": stale, "sessions": [{"key": "discord:999:u1"}]}))
        (self.team / "maomao.json").write_text(json.dumps({"project": "maomao", "updated": now, "sessions": [{"key": "discord:111", "busy": True, "task": "写周报"}]}))
        self.assertTrue(g.team_online("jingyu", CHAT))
        self.assertFalse(g.team_online("longniang", CHAT))   # 超过 60 秒没更新
        self.assertFalse(g.team_online("", CHAT))            # 没有本频道（主角色的 project 名在 lead 的 aliases 里）
        self.assertFalse(g.team_online("caihongmao", CHAT))  # 没有文件
        self.assertEqual(len(g.team_recent("discord:111")), 1)

    def test_recent_messages_names(self):  # 用户按 allow_from 认；bot 按团队文件 id 认，没写 id 的按用户名
        g = self.g
        data = [{"content": "做吧", "author": {"id": "42"}, "timestamp": "2026-10-23T01:00:00.123+00:00"},
                {"content": "路过", "author": {"id": "77", "username": "路人"}},
                {"content": "好了", "author": {"id": "1003", "bot": True}, "mentions": [{"id": "9", "username": "龙娘", "bot": True}]},
                {"content": "?", "author": {"id": "8", "bot": True, "username": "别家bot"}}]
        old = g._discord_get
        g._discord_get = lambda path: data
        try:
            out = g.recent_messages(CHAT, 10)
        finally:
            g._discord_get = old
        self.assertEqual([(w, to, t) for _, w, to, t in out], [(None, [], "做吧"), ("路人", [], "路过"), ("jingyu", ["longniang"], "好了")])


class CoMention(unittest.TestCase):
    """同一条消息同时 @ 主角色和队友：主角色回 context 等队友交回（core/gate_comention_test.go 期望 context）。"""
    LEAD_AT = "@橘(你) "  # core 把被问的 bot 自己的 @ 换成「@名字(你)」，其余 @ 保留 <@id>

    def lead(self, **req):
        return gate._decide_lead(req, "", model=False)[0]

    def test_single_message(self):
        self.assertEqual(self.lead(content=self.LEAD_AT + f"<@{IDS['longniang']}> 帮我算", mentioned=True), "context")

    def test_lead_only(self):
        self.assertEqual(self.lead(content=self.LEAD_AT + "帮我算", mentioned=True), "reply")

    def test_bot_mentions_lead(self):  # 队友交回 @ 主角色、顺带 @ 别人：是叫主角色本人
        self.assertEqual(self.lead(content=f"【龙娘】好了 <@{IDS['jingyu']}>", mentioned=True, from_bot=True), "reply")

    def test_reply_to_lead(self):  # 回复主角色的消息时同时 @ 队友：在跟主角色说
        c = f"[replying to Claude橘: 要不要做]\n{self.LEAD_AT}<@{IDS['caihongmao']}> 做"
        self.assertEqual(self.lead(content=c, mentioned=True), "reply")

    def test_burst_parts(self):  # 合并连发：@ 了主角色的每一条都同时 @ 队友才算；有一条只 @ 主角色就是叫她本人
        both = {"content": self.LEAD_AT + f"<@{IDS['longniang']}> 写个 X", "mentioned": True}
        sub_only = {"content": f"<@{IDS['longniang']}> 快点"}
        self.assertEqual(self.lead(content="x", mentioned=True, parts=[both, sub_only]), "context")
        lead_only = {"content": "你盯一下", "mentioned": True}
        self.assertEqual(self.lead(content="x", mentioned=True, parts=[sub_only, lead_only]), "reply")

    def test_switched_lead(self):  # 主角色换成龙娘：@ 橘也算「别的成员」
        self.assertTrue(gate.co_mention({"content": "@龙娘(你) " + f"<@{IDS['']}> 一起看", "mentioned": True}, "longniang"))
        self.assertFalse(gate.co_mention({"content": "@龙娘(你) " + f"<@{IDS['longniang']}> 看", "mentioned": True}, "longniang"))

    def test_no_ids_configured(self):  # 团队文件没写 id：不做同时 @ 判定，认不出的 <@id> 当没 @ 队友，照原规则 reply
        saved = dict(gate.lead.ID)
        gate.lead.ID.clear()
        try:
            self.assertIsNone(gate._other_mention(""))
            self.assertEqual(self.lead(content=self.LEAD_AT + "<@42> 帮我算", mentioned=True), "reply")
            self.assertEqual(self.lead(content=self.LEAD_AT + "帮我算", mentioned=True), "reply")
        finally:
            gate.lead.ID.update(saved)


class NoConfig(unittest.TestCase):
    def test_no_config_assumes_online(self):  # 没有 config.toml / 没配 team_status_dir：不知道谁在线，按在线算；频道里的人都算用户
        self.assertIsNone(gate.TEAM_DIR)
        self.assertIsNone(gate.USER_IDS)
        self.assertTrue(gate.team_online("jingyu", CHAT))


class LeadParse(unittest.TestCase):
    """一句话切主：「你现在是主bot」这类说法以前解析不出来，gate 回 None，切主不生效。"""

    def parse(self, text, me="jingyu", mentioned=True, **kw):
        return gate.lead.parse({"mentioned": mentioned, **kw}, text, me)

    def test_is_lead_sentences_switch(self):
        for text in ("你现在是主bot", "你是主bot", "现在你是主bot", "你当主bot", "你现在是主角色",
                     "你是主 AI", "你以后就是主机器人", "你现在是主Bot"):
            with self.subTest(text=text):
                self.assertEqual(self.parse(text), "jingyu")

    def test_named_switch_with_bot_noun(self):
        for text in ("鲸鱼现在是主bot", "主bot换成鲸鱼", "把主bot切到鲸鱼", "主AI换成龙娘"):
            with self.subTest(text=text):
                self.assertIn(self.parse(text, me="", mentioned=False), ("jingyu", "longniang"))
        self.assertEqual(self.parse("主AI换成龙娘", me="", mentioned=False), "longniang")

    def test_not_a_switch(self):
        for text in ("你是主bot吗", "你是不是主bot", "橘是主bot", "龙娘是主bot", "你是主力", "你是主意",
                     "这个主bot是谁", "你是主bot，对吧", "你不是主bot", "你才是主bot", "你又不是主bot"):
            with self.subTest(text=text):
                self.assertIsNone(self.parse(text))

    def test_from_bot_never_switches(self):
        self.assertIsNone(self.parse("你现在是主bot", from_bot=True))

    def test_existing_sentences_still_switch(self):
        self.assertEqual(self.parse("你当主角色"), "jingyu")
        self.assertEqual(self.parse("你来当主"), "jingyu")
        self.assertEqual(self.parse("让龙娘当主", me="", mentioned=False), "longniang")


if __name__ == "__main__":
    unittest.main()
