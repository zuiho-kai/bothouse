"""语音口令：唤醒词、安全词、闭麦/开麦、角色不说话、叫谁只有谁回。秒级，假大脑、假 ASR，不录音、不调 claude。

用户 2026-10-19：「首先就是重复的太多了」「我没有一个闭麦按钮，或者我希望可以语音闭麦」
「我明明没在说话好像，然后给我那个来了几句」「你可能指定跟他们说他们才会应你，否则就当不存在」「有个呃安全词啊去暂停声音」。
"""
from __future__ import annotations

import asyncio
import sys
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import voice
from rh import wake
from rh.brain import PASS, Cancelled, ClaudeBrain
from rh.config import Role, load
from rh.host import Host
from rh.meeting import Meeting
from tests.test_hub import AUTH, TOKEN, HubBase, async_playwright, wait_for
from tests.test_voice import LOUD, SILENT, frames

ROLES = [Role("ju", "橘", "p"), Role("jing", "鲸鱼娘", "p"), Role("mao", "彩虹猫", "p")]
# 同 roles.toml：橘的语音唤醒词是「小橘」（用户 2026-10-19「小橘怎么样」「就这样吧，小橘和小家」），打字照旧认「橘」。
WORDS = wake.Words([(r.id, [r.name]) for r in ROLES], product=["小家"], voice={"ju": ["小橘"]})

# logs/host-device-20261019-001650.log 里用户没在说话时进了频道的假句子（置信度 0.59-0.85）。
FAKE = ["我就给他们", "你有必要吗我操你啊", "不能保护工作。", "我应该感谢这条路。", "好吧会儿。"]
# 同一批日志（logs/host-*.log「听到」行）里其余转写：都没叫名字，现在都不该进频道。
HEARD = ["不要", "能听到吗 ？", "你是我最爱的。", "晚安 ，宝宝。", "我是说。", "怎么判断收到邮件有没有 ？",
         "没问题了 ，那就可以了。", "回家回家回家我家我家", "你刚刚是在排练吗 ？还有什么东西 ？",
         "等一下先停一停我换个话题。", "测试一下语音输入你们听得到我说话吗 ？",
         "大家好 ，我们来聊聊周末去哪里玩比较好。"]


class WordsTest(unittest.TestCase):
    def test_fake_sentences_ignored(self):
        for t in FAKE + HEARD:
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.IGNORE, t)

    def test_asr_homophones_wake_right_role(self):
        """2026-10-19 实测 ASR 把名字转成的同音字（say/Qwen 合成人声过 gateway）。"""
        cases = {"小菊 ，你觉得呢 ？": ["ju"], "小局在吗 ？": ["ju"], "我问一下小橘。": ["ju"],
                 "金鱼娘今天天气怎么样 ？": ["jing"], "金玉娘今天天气怎么样 ？": ["jing"],
                 "彩虹猫讲个笑话。": ["mao"], "彩虹猫和小橘你们看呢": ["ju", "mao"]}
        for t, who in cases.items():
            h = WORDS.classify(t, muted=False)
            self.assertEqual((h.action, h.targets), (wake.SAY, who), t)
        h = WORDS.classify("小佳 ，我们聊聊吧。", muted=False)
        self.assertEqual((h.action, h.targets), (wake.SAY, None))   # 产品名：轮流

    def test_nl_and_nasal_loose(self):
        """用户 2026-10-19「你应该比较宽的就是nl，有没有g都能识别」：真机「鲸鱼娘在吗」被转成「金玉良在吗」
        （logs/utter-20261019-145817/150201-894.wav、150219-590.wav）。n/l 当一样，前后鼻音当一样，口令也一样。"""
        for t in ("金玉良在吗 ？", "金鱼良在吗", "鲸鱼娘在吗", "鲸鱼良在吗", "金鱼娘在吗"):
            h = WORDS.classify(t, muted=False)
            self.assertEqual((h.action, h.targets), (wake.SAY, ["jing"]), t)
        self.assertEqual(WORDS.classify("赞停", muted=False).action, wake.PAUSE)    # zan/zang、ting/tin
        self.assertEqual(WORDS.classify("彩红猫讲个笑话", muted=False).targets, ["mao"])
        # 用户早先「别被一句金鱼叫醒，烦」：只有半个名字、或别的 jin/liang 词，放宽后也不叫醒
        for t in ("金鱼", "金鱼缸", "鲸鱼", "尽量", "我养了条金鱼", "鲸鱼很大", "尽量早点来", "金鱼缸里有两条金鱼"):
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.IGNORE, t)
        # ong 不并进 an/en：「彩含猫」不算彩虹猫
        self.assertEqual(WORDS.classify("彩含猫", muted=False).action, wake.IGNORE)

    def test_correct_homophones_to_standard(self):
        """用户 2026-10-19：「我预期他是应该可以帮我转成我们比较适配的，不是直接显示傻逼金玉良」。
        按拼音认出的那几个字换成标准写法，其它字不动；没命中的不换。"""
        cases = {"金玉良在吗": "鲸鱼娘在吗", "小菊你好": "小橘你好", "金鱼缸": "金鱼缸",
                 "彩红猫和金鱼良": "彩虹猫和鲸鱼娘", "小佳 ，必卖": "小家 ，闭麦", "赞停": "暂停",
                 "开买": "开麦", "我养了条金鱼": "我养了条金鱼", "abc 金玉良!": "abc 鲸鱼娘!"}
        for raw, want in cases.items():
            self.assertEqual(WORDS.correct(raw), want, raw)

    def test_ju_misheard_as_common_chars_not_added(self):
        """2026-10-19 离线仿真里「橘」还被转成「姐」「鱼」「徐」（/tmp/rhaec/diag/REPORT.md 4.2）。
        这几个不是同音字、「姐」「鱼」日常很常见，不加：没叫她时被叫醒正违背用户「否则就当不存在」。
        真同音的「菊」按拼音已经算上（语音唤醒词现在是「小橘」，所以是「小菊」）。"""
        h = WORDS.classify("小菊，你最近在看什么书？", muted=False)
        self.assertEqual((h.action, h.targets), (wake.SAY, ["ju"]))
        for t in ("姐，你最近在看什么书？", "鱼，你最近在看什么书？", "徐，你最近在看什么书？",
                  "我姐今天来吃饭", "晚上吃鱼吧"):
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.IGNORE, t)

    def test_voice_wake_is_xiaoju(self):
        """用户 2026-10-19「橘作为首字在音韵不好发言」「小橘怎么样」「就这样吧，小橘和小家」：
        语音叫「小橘」（同音「小菊」也算）才叫醒橘；单说「橘」、日常「结局」不叫醒；「小家」仍是产品名；打字「橘」照旧点到橘。"""
        for t in ("小橘在吗", "小菊在吗"):
            h = WORDS.classify(t, muted=False)
            self.assertEqual((h.action, h.targets), (wake.SAY, ["ju"]), t)
        for t in ("橘在吗", "结局不太好"):
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.IGNORE, t)
        h = WORDS.classify("小家，今天天气怎么样", muted=False)
        self.assertEqual((h.action, h.targets), (wake.SAY, None))
        self.assertEqual(WORDS.typed_targets("橘你看呢"), ["ju"])
        self.assertEqual(WORDS.typed_targets("小橘你看呢"), ["ju"])

    def test_single_char_name_needs_tone(self):
        """橘只有一个字：声调也要对，「一句话」「举手」不叫醒她。"""
        for t in ("我说一句话", "举手发言", "剧情不错"):
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.IGNORE, t)

    def test_commands(self):
        for t in ("暂停", "暂停一下。"):
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.PAUSE, t)
        for t in ("闭麦", "必卖。", "碧麦", "必卖吧。"):
            self.assertEqual(WORDS.classify(t, muted=False).action, wake.MUTE, t)
        # 闭麦期间只认开麦、暂停、闭麦（后两个停下正在念的 Discord 回应）：叫名字不算
        for t in ("开麦。", "开买", "开卖吧"):
            self.assertEqual(WORDS.classify(t, muted=True).action, wake.UNMUTE, t)
        self.assertEqual(WORDS.classify("暂停", muted=True).action, wake.PAUSE)
        self.assertEqual(WORDS.classify("闭麦", muted=True).action, wake.MUTE)
        for t in ("彩虹猫讲个笑话", "小家你好"):
            self.assertEqual(WORDS.classify(t, muted=True).action, wake.IGNORE, t)
        # 调音量（用户 2026-10-19「我通过语音让它调大」）：不用叫名字；叫了名字只调她的；闭麦中不认
        for t in ("大声点", "声音大一点", "大点声"):
            self.assertEqual(WORDS.classify(t, muted=False), wake.Heard(wake.LOUDER, None), t)
        for t in ("小声点", "声音小一点吧"):
            self.assertEqual(WORDS.classify(t, muted=False), wake.Heard(wake.QUIETER, None), t)
        self.assertEqual(WORDS.classify("小橘大声点", muted=False), wake.Heard(wake.LOUDER, ["ju"]))
        self.assertEqual(WORDS.classify("大声点", muted=True).action, wake.IGNORE)
        self.assertTrue(WORDS.stop_word("必卖"))
        self.assertTrue(WORDS.stop_word("暂停"))
        self.assertFalse(WORDS.stop_word("开麦"))

    def test_typed_by_exact_name(self):
        self.assertEqual(WORDS.typed_targets("彩虹猫讲个笑话"), ["mao"])
        self.assertIsNone(WORDS.typed_targets("这个结局怎么样"))   # 打字不按拼音
        self.assertIsNone(WORDS.typed_targets("小家你好"))

    def test_config(self):
        from tests.local_config import need_local
        cfg = load(need_local(self))
        w = wake.Words.from_config(cfg)
        self.assertEqual((cfg.wake_product, w.pause, w.mute, w.unmute), (["小家"], "暂停", "闭麦", "开麦"))
        self.assertEqual(w.classify("金鱼娘你好", muted=False).targets, ["jing"])
        self.assertEqual(w.classify("小橘在吗", muted=False).targets, ["ju"])
        self.assertEqual(w.classify("橘在吗", muted=False).action, wake.IGNORE)
        self.assertEqual(w.typed_targets("橘在吗"), ["ju"])
        self.assertEqual(next(r.name for r in cfg.roles if r.id == "ju"), "橘")


class ScriptBrain:
    """按顺序返回准备好的话，用完就返回 PASS。"""

    def __init__(self, *lines: str, delay: float = 0.0):
        self.lines, self.calls, self.delay = list(lines), 0, delay
        self._cancel = threading.Event()

    def reply(self, new_messages: str) -> str:
        self.calls += 1
        self._cancel.clear()
        if self._cancel.wait(self.delay):
            raise Cancelled()
        return self.lines.pop(0) if self.lines else PASS

    def cancel(self) -> None:
        self._cancel.set()


def meeting(brains, max_turns=6):
    return Meeting(ROLES, brains, max_turns, 1000.0, sleep_scale=0.01)


class MeetingTest(unittest.TestCase):
    def test_only_named_role_replies_once(self):
        brains = {r.id: ScriptBrain("说一句", "再说一句") for r in ROLES}
        m = meeting(brains)
        m.user_say("彩虹猫讲个笑话", only=["mao"])
        m.wait_idle(5)
        said = [(x.author, x.text) for x in m.messages if x.author != "user"]
        self.assertEqual(said, [("mao", "说一句")])            # 没有系统消息“到上限”
        self.assertEqual([brains[r].calls for r in ("ju", "jing", "mao")], [0, 0, 1])

    def test_goodnight_not_repeated(self):
        """截图场景：橘道了晚安，鲸鱼娘、彩虹猫不说话 -> 话题结束，不再问橘、不再轮流说晚安。"""
        brains = {"ju": ScriptBrain("行，那就这样，早点睡。"), "jing": ScriptBrain(PASS), "mao": ScriptBrain(f"{PASS}")}
        m = meeting(brains)
        m.user_say("没问题了，那就可以了。")
        m.wait_idle(5)
        self.assertEqual([x.author for x in m.messages], ["user", "ju"])
        self.assertEqual([brains[r].calls for r in ("ju", "jing", "mao")], [1, 1, 1])

    def test_all_pass_from_start(self):
        brains = {r.id: ScriptBrain() for r in ROLES}
        m = meeting(brains)
        m.user_say("嗯")
        m.wait_idle(5)
        self.assertEqual([x.author for x in m.messages], ["user"])
        self.assertEqual([b.calls for b in brains.values()], [1, 1, 1])

    def test_pass_variants(self):
        from rh.meeting import is_pass
        for t in (PASS, f"{PASS}。", "跳过", "（跳过）", ""):
            self.assertTrue(is_pass(t), t)
        self.assertFalse(is_pass("我跳过早饭了"))

    def test_think_reported(self):
        brains = {r.id: ScriptBrain("一句") for r in ROLES}
        m = meeting(brains, max_turns=3)
        seen = []
        m.on_think = seen.append
        m.user_say("话题")
        m.wait_idle(5)
        self.assertEqual([s for s in seen if s], ["ju", "jing", "mao"])
        self.assertIsNone(seen[-1])

    def test_prompt_mentions_pass(self):
        b = ClaudeBrain(ROLES[0], ["鲸鱼娘", "彩虹猫"], "haiku", 10, Path("/tmp/rh-test-brain"))
        self.assertIn(PASS, b.system_prompt())
        self.assertIn("晚安", b.system_prompt())


class FakeConfASR:
    def __init__(self, text, conf):
        self.text, self.conf = text, conf

    def transcribe(self, wav):
        return self.text, self.conf


class ListenerUrgent(unittest.TestCase):
    def run_one(self, text, conf, spoken=()):
        got = []
        voice.Listener(FakeConfASR(text, conf), got.append, lambda stop: [frames([(LOUD, 900), (SILENT, 900)])],
                       log=lambda s: None, playing=lambda t0, t1: list(spoken), urgent=WORDS.stop_word).run()
        return got

    def test_low_confidence_stop_word_passes(self):
        """单说「闭麦」实测转成「必卖」置信度 0.38：口令不按置信度丢。"""
        self.assertEqual(self.run_one("必卖。", 0.38), ["必卖。"])
        self.assertEqual(self.run_one("我就给他们", 0.38), [])     # 不是口令照旧丢

    def test_stop_word_over_role_voice(self):
        """角色在说时喊暂停，转出的字混着她的话：不当回声丢。"""
        role = "晚安啦明天要是还有事就来找我"
        self.assertEqual(self.run_one("暂停晚安啦明天要是", 0.9, [role]), ["暂停晚安啦明天要是"])

    def test_role_saying_stop_word_is_echo(self):
        role = "要不先暂停一下，大家喝口水"
        self.assertEqual(self.run_one("要不先暂停一下", 0.9, [role]), [])


class HostVoice(HubBase):
    """主机 + hub：语音口令端到端（hub 真起，假大脑，假语音直接调 host.on_voice）。"""

    async def start(self, brains, chars_per_sec=1000.0):
        self.m = Meeting(ROLES, brains, 6, chars_per_sec)
        self.logs = []
        self.host = Host(self.m, self.url, TOKEN, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2,
                         words=WORDS, log=self.logs.append)
        self.task = asyncio.create_task(self.host.run())
        await wait_for(self.host.connected.is_set, what="角色主机连上")

    async def asyncTearDown(self):
        self.host.stop()
        await asyncio.wait_for(self.task, 5)
        await asyncio.get_running_loop().run_in_executor(None, self.m.wait_idle, 5)
        await super().asyncTearDown()

    async def voice(self, text):
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, text)

    async def test_unnamed_ignored_named_only_she_replies(self):
        await self.start({r.id: ScriptBrain("一句", "两句") for r in ROLES})
        for t in FAKE:
            await self.voice(t)
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(), [])                      # 频道里不冒句子
        await self.voice("彩虹猫讲个笑话")
        await wait_for(lambda: any(r["status"] == "done" for r in self.rows()), what="彩虹猫说完")
        await asyncio.sleep(0.3)
        self.assertEqual([(r["author"], r["status"]) for r in self.rows()], [("user", "user"), ("mao", "done")])

    async def test_voice_homophone_corrected_in_channel(self):
        """频道里显示标准写法「鲸鱼娘在吗」，不是转写原样的「金玉良在吗」；日志另记原文。"""
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.voice("金玉良在吗")
        await wait_for(lambda: any(r["status"] == "done" for r in self.rows()), what="鲸鱼娘说完")
        self.assertEqual([r["text"] for r in self.rows(author_kind="user")], ["鲸鱼娘在吗"])
        self.assertTrue(any("金玉良在吗" in x and "原文" in x for x in self.logs))

    async def test_tail_after_pause_follows_named_sentence(self):
        """一句话被停顿切成两段：后半段紧跟着（FOLLOW_SEC 内）就算对同一个人说；隔久了不算。"""
        from rh.host import FOLLOW_SEC
        await self.start({r.id: ScriptBrain("一句", "两句") for r in ROLES})
        loop = asyncio.get_running_loop()
        t = time.time()
        await loop.run_in_executor(None, self.host.on_voice, "彩虹猫，我看已经有声音了", t - 3, t - 1)
        await loop.run_in_executor(None, self.host.on_voice, "你们再跑还是怎么样", t - 1 + FOLLOW_SEC / 2, t + 1)
        await loop.run_in_executor(None, self.host.on_voice, "我就给他们", t + 1 + FOLLOW_SEC * 2, t + 5)
        await wait_for(lambda: len(self.rows(author_kind="user")) == 2, what="两段进频道")
        await wait_for(lambda: any(r["status"] == "done" for r in self.rows()), what="彩虹猫说完")
        await asyncio.sleep(0.3)
        self.assertEqual([r["text"] for r in self.rows(author_kind="user")], ["彩虹猫，我看已经有声音了", "你们再跑还是怎么样"])
        self.assertEqual({r["author"] for r in self.rows(author_kind="role")}, {"mao"})

    async def test_typed_named_only_she_replies(self):
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.post("鲸鱼娘你在吗")
        await wait_for(lambda: any(r["status"] == "done" for r in self.rows()), what="鲸鱼娘说完")
        await asyncio.sleep(0.3)
        self.assertEqual([r["author"] for r in self.rows(author_kind="role")], ["jing"])

    async def test_pause_stops_and_nobody_continues(self):
        # 每字 0.2 秒：一句「我说两句话测试一下」约 2 秒，够在她说的时候喊停
        await self.start({r.id: ScriptBrain("我说两句话测试一下", "再说两句话测试一下") for r in ROLES},
                         chars_per_sec=5.0)
        await self.voice("小家，聊聊天气")
        await wait_for(lambda: any(r["status"] == "speaking" for r in self.rows()), what="有人在说")
        t0 = time.time()
        await self.voice("暂停")
        await wait_for(lambda: not any(r["status"] == "speaking" for r in self.rows()), what="停下")
        self.assertLess(time.time() - t0, 1.0)
        await asyncio.sleep(1.0)
        roles = self.rows(author_kind="role")
        self.assertEqual([r["status"] for r in roles], ["interrupted"])   # 没人接着说
        self.assertTrue(any("暂停" in r["text"] for r in self.rows(author_kind="system")))
        self.assertFalse(any(r["text"] == "暂停" for r in self.rows(author_kind="user")))   # 安全词不进频道当话题

    async def test_voice_mute_and_unmute(self):
        await self.start({r.id: ScriptBrain("我说两句话测试一下") for r in ROLES}, chars_per_sec=5.0)
        watcher = await self.web_client(); await self.recv(watcher)
        await self.voice("小家，聊聊天气")
        await wait_for(lambda: any(r["status"] == "speaking" for r in self.rows()), what="有人在说")
        await self.voice("必卖")                               # ASR 把闭麦转成必卖
        await wait_for(lambda: not any(r["status"] == "speaking" for r in self.rows()), what="停下")
        await wait_for(lambda: not self.hub.mic_on(), what="云端闭麦")
        talk = lambda: [r for r in self.rows() if r["author_kind"] != "system"]
        n = len(talk())
        for t in ("彩虹猫讲个笑话", "暂停", "小家你好"):
            await self.voice(t)
        await asyncio.sleep(0.3)
        self.assertEqual(len(talk()), n)                       # 闭麦期间说的话不进频道（暂停照样生效，只发系统消息）
        self.assertFalse(self.host.mic_on)                     # 暂停不开麦
        await self.voice("开卖")
        await wait_for(self.hub.mic_on, what="云端开麦")
        self.assertTrue(self.host.mic_on)
        # 网页收到了开关推送
        got = []
        while True:
            try:
                ev = await self.recv(watcher, timeout=0.3)
            except asyncio.TimeoutError:
                break
            if ev["type"] == "mic":
                got.append(ev["on"])
        self.assertEqual(got, [False, True])

    async def test_web_button_mutes_host(self):
        await self.start({r.id: ScriptBrain("我说两句话测试一下") for r in ROLES}, chars_per_sec=5.0)
        await self.voice("小家，聊聊天气")
        await wait_for(lambda: any(r["status"] == "speaking" for r in self.rows()), what="有人在说")
        async with self.http.post(self.url + "/api/mic", json={"on": False}, headers=AUTH) as r:
            self.assertEqual(r.status, 200)
        await wait_for(lambda: not self.host.mic_on, what="主机闭麦")
        await wait_for(lambda: not any(r["status"] == "speaking" for r in self.rows()), what="停下")
        await self.voice("橘你好")
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.rows(author_kind="user")), 1)

    async def test_mic_state_survives_hub_restart(self):
        await self.start({r.id: ScriptBrain() for r in ROLES})
        async with self.http.post(self.url + "/api/mic", json={"on": False}, headers=AUTH) as r:
            self.assertEqual(await r.json(), {"on": False})
        async with self.http.post(self.url + "/api/mic", json={"on": "no"}, headers=AUTH) as r:
            self.assertEqual(r.status, 400)
        self.host.stop()
        await asyncio.wait_for(self.task, 5)
        await self.stop_hub()
        await self.start_hub()
        ws = await self.web_client()
        self.assertIs((await self.recv(ws))["mic"], False)
        await self.start({r.id: ScriptBrain() for r in ROLES})
        self.assertFalse(self.host.mic_on)

    async def test_thinking_pushed_and_cleared(self):
        await self.start({r.id: ScriptBrain("一句", delay=0.5) for r in ROLES})
        watcher = await self.web_client(); await self.recv(watcher)
        await self.voice("鲸鱼娘你好")
        seen = []
        while not (seen and seen[-1] is None):
            ev = await self.recv(watcher, timeout=3)
            if ev["type"] == "thinking":
                seen.append(ev["role"])
        self.assertEqual(seen, ["jing", None])


@unittest.skipIf(async_playwright is None, "没装 playwright")
class MicButton(HubBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.pw = await async_playwright().start()
        self.browser = await self.pw.chromium.launch()
        self.page = await self.browser.new_page()

    async def asyncTearDown(self):
        await self.browser.close()
        await self.pw.stop()
        await super().asyncTearDown()

    async def test_button_toggles_and_shows_state(self):
        await self.page.goto(f"{self.url}/#token={TOKEN}")
        await self.page.wait_for_function("document.getElementById('meta').textContent === '已连接'", timeout=5000)
        self.assertEqual(await self.page.text_content("#mic"), "闭麦")
        await self.page.click("#mic")
        await self.page.wait_for_selector("#mic.off", timeout=5000)
        self.assertFalse(self.hub.mic_on())
        self.assertIn("开麦", await self.page.text_content("#mic"))
        # 语音那边开麦（主机 POST），网页按钮跟着变
        async with self.http.post(self.url + "/api/mic", json={"on": True}, headers=AUTH):
            pass
        await self.page.wait_for_selector("#mic:not(.off)", timeout=5000)
        self.assertEqual(await self.page.text_content("#mic"), "闭麦")


if __name__ == "__main__":
    unittest.main()
