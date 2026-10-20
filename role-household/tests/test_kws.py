"""本地唤醒模型（rh/kws.py）和转文字并联：任一认出即生效、叫谁只有谁回、闭麦只认开麦、暂停当场打断。
假唤醒模型、假 ASR，不录音、不出声、不调 claude；最后一组用真模型（有模型文件才跑）测词表能加载。

用户 2026-10-19：「还是没反应，我说了个鲸鱼娘在吗？他没有反应」「你可能指定跟他们说他们才会应你，否则就当不存在」
「有个呃安全词啊去暂停声音」「我希望可以语音闭麦」。
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import kws, voice, wake
from rh.config import load
from rh.host import Host
from rh.meeting import Meeting
from tests.test_hub import TOKEN, HubBase, wait_for
from tests.test_voice import LOUD, SILENT, frames
from tests.test_wake import ROLES, WORDS, ScriptBrain


def hit(label: str, t: float | None = None) -> kws.Hit:
    action, role = {e[0]: (e[1], e[2]) for e in kws.entries(WORDS)}[label]
    return kws.Hit(label, action, role, time.time() if t is None else t, wake.Term(label))


class FakeSpotter:
    """第 at 帧时报一次 label（真模型在词说完约半秒后报，这里放在有声段中间）。"""

    def __init__(self, label: str | None, at: int = 20):
        self.label, self.at, self.n = label, at, 0

    def reset(self):
        self.n = 0

    def feed(self, frame):
        self.n += 1
        return [hit(self.label)] if self.label and self.n == self.at else []


class CountASR:
    def __init__(self, text, conf=0.9, order=None):
        self.text, self.conf, self.calls, self.order = text, conf, 0, order

    def transcribe(self, wav):
        self.calls += 1
        if self.order is not None:
            self.order.append("asr")
        return self.text, self.conf


class EntriesTest(unittest.TestCase):
    def test_from_roles_toml(self):
        """词表从 roles.toml 来：橘用 wake「小橘」，别的角色用名字，加产品名和三个口令；单字「橘」不在里面。"""
        from tests.local_config import need_local
        got = kws.entries(wake.Words.from_config(load(need_local(self))))
        self.assertEqual(got, [("小橘", "say", "ju"), ("鲸鱼娘", "say", "jing"), ("彩虹猫", "say", "mao"),
                               ("小家", "say", None), ("暂停", "pause", None), ("闭麦", "mute", None),
                               ("开麦", "unmute", None)])

    def test_keyword_lines(self):
        """关键词行和离线评估用的 /tmp/kws/scripts/kw.txt 写法一样；单个词另调时加 :score #threshold。"""
        from tests.local_config import need_local
        model = load(need_local(self)).wake_kws_model
        tokens = Path(model) / "tokens.txt"
        if not tokens.is_file():
            self.skipTest("没下载本地唤醒模型（README「本地唤醒模型」）")
        # 用户 2026-10-19「你应该比较宽的就是nl，有没有g都能识别」：鲸鱼娘按 jing/jin × niang/nian/liang/lian 多写几行，标签都是原词
        jing = [f"j {a} y ú {b} @鲸鱼娘" for a in ("īng", "īn") for b in ("n iáng", "n ián", "l iáng", "l ián")]
        self.assertEqual(kws.keyword_lines(["鲸鱼娘", "小橘"], str(tokens), {}), jing + ["x iǎo j ú @小橘"])
        self.assertEqual(kws.keyword_lines(["鲸鱼娘"], str(tokens), {"鲸鱼娘": (2.0, 0.1)})[:2],
                         ["j īng y ú n iáng :2 #0.1 @鲸鱼娘", "j īng y ú n ián :2 #0.1 @鲸鱼娘"])

    def test_variants(self):
        """变体规则同 rh/wake.py：n<->l、前后鼻音；ong 不动；juan 不变 juang；去重、原样排第一。"""
        self.assertEqual(kws.variants("彩虹猫"), [kws.ppinyin("彩虹猫")])
        self.assertEqual(kws.variants("闭麦"), [kws.ppinyin("闭麦")])
        self.assertEqual(len(kws.variants("鲸鱼娘")), 8)
        self.assertEqual(kws.variants("娟"), [["j", "uān"]])
        self.assertIn(["h", "uāng"], kws.variants("欢"))


class ListenerKWS(unittest.TestCase):
    def run_one(self, asr, label, spoken=(), muted=False, save_dir=None, order=None):
        got, seen = [], []

        def on_text(text, t0, t1, kws=None, muted=False):
            got.append((text, [h.label for h in kws or []]) + (("闭麦",) if muted else ()))

        def on_kws(h):
            seen.append(h.label)
            if order is not None:
                order.append("kws")

        voice.Listener(asr, on_text, lambda stop: [frames([(LOUD, 900), (SILENT, 900)])], log=lambda s: None,
                       playing=lambda t0, t1: list(spoken), urgent=WORDS.stop_word, timed=True,
                       kws=FakeSpotter(label), on_kws=on_kws, muted=lambda: muted, save_dir=save_dir).run()
        return got, seen

    def test_kws_name_rescues_dropped_sentence(self):
        """转文字没认出名字、置信度又低（本来会丢掉）：唤醒模型听到了鲸鱼娘，这句照样交给主机，带着听到的词。"""
        got, seen = self.run_one(CountASR("经济能在吗", 0.30), "鲸鱼娘")
        self.assertEqual(seen, ["鲸鱼娘"])
        self.assertEqual(got, [("经济能在吗", ["鲸鱼娘"])])
        got, _ = self.run_one(CountASR("经济能在吗", 0.30), None)
        self.assertEqual(got, [])   # 没有唤醒模型命中：照旧按置信度丢

    def test_kws_hit_in_role_voice_is_echo(self):
        """角色自己念到「鲸鱼娘」时唤醒模型听到它：当回声，不算叫她。"""
        got, seen = self.run_one(CountASR("经济能在吗", 0.30), "鲸鱼娘", spoken=["我是鲸鱼娘，今天好困"])
        self.assertEqual((got, seen), ([], []))

    def test_on_kws_before_asr(self):
        """暂停、闭麦要当场停住：唤醒模型的命中在这句转文字之前就交给主机。"""
        order = []
        self.run_one(CountASR("暂停", order=order), "暂停", order=order)
        self.assertEqual(order[:2], ["kws", "asr"])

    def test_muted_asr_only_for_unmute(self):
        """闭麦中：照样转文字（唤醒模型漏了「开麦」时靠它补），但不存音频，交给主机时标明是闭麦中切出的，只用来认开麦。"""
        asr = CountASR("开麦", 0.3)
        with tempfile.TemporaryDirectory() as d:
            got, _ = self.run_one(asr, None, muted=True, save_dir=Path(d) / "u")
            self.assertEqual((got, asr.calls), ([("开麦", [], "闭麦")], 1))
            self.assertFalse((Path(d) / "u").exists())

    def test_muted_state_taken_when_cut(self):
        """闭麦中切出、排在队里的句子，开麦后才轮到转写：仍按闭麦中处理（只认开麦、不存音频），私话不进频道。"""
        got, state = [], {"muted": True}
        with tempfile.TemporaryDirectory() as d:
            li = voice.Listener(CountASR("彩虹猫讲个笑话"), lambda text, t0, t1, kws=None, muted=False: got.append((text, muted)),
                                lambda stop: [], log=lambda s: None, timed=True, kws=FakeSpotter(None),
                                muted=lambda: state["muted"], save_dir=Path(d) / "u")
            item = li._stamp(LOUD * 50)
            state["muted"] = False
            li.handle(*item)
            self.assertEqual(got, [("彩虹猫讲个笑话", True)])
            self.assertFalse((Path(d) / "u").exists())

    def test_kws_unmute_while_on_no_fast_path(self):
        """开麦状态下唤醒模型误报「开麦」（主机不执行、done 为空）：不算叫了名字，低置信度的句子照旧丢掉。"""
        got, _ = self.run_one(CountASR("开卖", 0.30), "开麦")
        self.assertEqual(got, [])

    def test_saves_each_sentence(self):
        with tempfile.TemporaryDirectory() as d:
            self.run_one(CountASR("我就给他们", 0.3), None, save_dir=Path(d))
            wavs = list(Path(d).glob("*.wav"))
            self.assertEqual(len(wavs), 1)
            self.assertGreater(voice.wav_secs(wavs[0].read_bytes()), 1.0)


class HostKWS(HubBase):
    """主机 + hub：唤醒模型命中和转文字一起进 host（hub 真起，假大脑）。"""

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

    async def call(self, fn, *a, **kw):
        await asyncio.get_running_loop().run_in_executor(None, lambda: fn(*a, **kw))

    async def said(self, text, *labels):
        """一句话：先像读麦线程那样把命中交给 on_kws，再像转写线程那样带着命中交给 on_voice。"""
        hits = [hit(x) for x in labels]
        for h in hits:
            await self.call(self.host.on_kws, h)
        t = time.time()
        await self.call(self.host.on_voice, text, t - 2, t, kws=hits)

    async def replied(self):
        await wait_for(lambda: any(r["status"] == "done" for r in self.rows()), what="有人说完")
        await asyncio.sleep(0.3)
        return [r["author"] for r in self.rows(author_kind="role")]

    async def test_asr_missed_name_only_kws_named_replies(self):
        """「鲸鱼娘在吗」转成「经济能在吗」（拼音也比不上）：唤醒模型听到鲸鱼娘，只有鲸鱼娘回。"""
        await self.start({r.id: ScriptBrain("一句", "两句") for r in ROLES})
        await self.said("经济能在吗", "鲸鱼娘")
        self.assertEqual(await self.replied(), ["jing"])
        self.assertEqual([r["text"] for r in self.rows(author_kind="user")], ["经济能在吗"])
        self.assertTrue(any("叫到 jing（认出：kws" in s for s in self.logs), self.logs)

    async def test_empty_text_uses_heard_word(self):
        """转文字什么都没转出：拿唤醒模型听到的词当这句话，被叫到的照样回。"""
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.said("", "鲸鱼娘")
        self.assertEqual(await self.replied(), ["jing"])
        self.assertEqual([r["text"] for r in self.rows(author_kind="user")], ["鲸鱼娘"])

    async def test_kws_name_beats_product_from_asr(self):
        """转文字只认出产品名（会大家轮流回），唤醒模型听到了鲸鱼娘：只让鲸鱼娘回。"""
        await self.start({r.id: ScriptBrain("一句", "两句") for r in ROLES})
        await self.said("小家，经济能在吗", "鲸鱼娘")
        self.assertEqual(await self.replied(), ["jing"])
        self.assertTrue(any("（认出：都有" in s for s in self.logs), self.logs)

    async def test_asr_only_still_works(self):
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.said("彩虹猫讲个笑话")
        self.assertEqual(await self.replied(), ["mao"])
        self.assertTrue(any("叫到 mao（认出：asr" in s for s in self.logs), self.logs)

    async def test_nothing_named_nobody_replies(self):
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.said("我就给他们")
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(), [])

    async def test_kws_pause_interrupts_once(self):
        """唤醒模型听到「暂停」当场停住正在说的；这句转完文字也认出暂停，不再执行第二遍（只发一条系统消息）。"""
        await self.start({r.id: ScriptBrain("我说两句话测试一下", "再说两句话测试一下") for r in ROLES},
                         chars_per_sec=5.0)
        await self.said("小家，聊聊天气")
        await wait_for(lambda: any(r["status"] == "speaking" for r in self.rows()), what="有人在说")
        h = hit("暂停")
        t0 = time.time()
        await self.call(self.host.on_kws, h)
        await wait_for(lambda: not any(r["status"] == "speaking" for r in self.rows()), what="停下")
        self.assertLess(time.time() - t0, 1.0)
        await self.call(self.host.on_voice, "暂停", time.time() - 1, time.time(), kws=[h])
        await asyncio.sleep(1.0)
        self.assertEqual([r["status"] for r in self.rows(author_kind="role")], ["interrupted"])
        self.assertEqual(len([r for r in self.rows(author_kind="system") if "暂停" in r["text"]]), 1)
        self.assertTrue(any("（认出：kws）" in s for s in self.logs) and any("（认出：都有）" in s for s in self.logs),
                        self.logs)

    async def test_kws_mute_only_unmute_counts(self):
        """唤醒模型听到「闭麦」：停下、闭麦；闭麦期间唤醒模型听到别的词、转文字听到别的话都不进频道；听到「开麦」恢复。"""
        await self.start({r.id: ScriptBrain("我说两句话测试一下") for r in ROLES}, chars_per_sec=5.0)
        await self.said("小家，聊聊天气")
        await wait_for(lambda: any(r["status"] == "speaking" for r in self.rows()), what="有人在说")
        await self.said("闭麦", "闭麦")
        await wait_for(lambda: not any(r["status"] == "speaking" for r in self.rows()), what="停下")
        await wait_for(lambda: not self.hub.mic_on(), what="云端闭麦")
        n = len(self.rows(author_kind="user")) + len(self.rows(author_kind="role"))
        await self.said("鲸鱼娘在吗", "鲸鱼娘")
        await self.said("暂停", "暂停")   # 闭麦中暂停照样生效（只停下、发系统消息），仍闭麦
        await self.said("小家你好", "小家")
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.rows(author_kind="user")) + len(self.rows(author_kind="role")), n)
        self.assertFalse(self.host.mic_on)
        self.assertFalse(self.hub.mic_on())
        await self.call(self.host.on_kws, hit("开麦"))
        await wait_for(self.hub.mic_on, what="云端开麦")
        await self.said("鲸鱼娘在吗", "鲸鱼娘")
        await wait_for(lambda: len(self.rows(author_kind="user")) == 2, what="开麦后进频道")


    async def test_muted_sentence_never_enters_room(self):
        """闭麦中切出的句子开麦后才转完：不进频道；转文字认出「开麦」时照样开麦（唤醒模型漏了也能叫开）。"""
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.said("彩虹猫讲个笑话")
        await wait_for(lambda: len(self.rows(author_kind="user")) == 1, what="开麦时进频道")
        t = time.time()
        await self.call(self.host.on_voice, "彩虹猫讲个笑话", t - 2, t, kws=[], muted=True)
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.rows(author_kind="user")), 1)
        self.assertFalse(any("讲个笑话" in s and "闭麦中" in s for s in self.logs), self.logs)
        await self.said("闭麦")
        await wait_for(lambda: not self.hub.mic_on(), what="云端闭麦")
        await self.call(self.host.on_voice, "开麦", t - 2, t, kws=[], muted=True)
        await wait_for(self.hub.mic_on, what="转文字认出开麦")


    async def test_voice_unmute_persists_to_hub(self):
        """语音闭麦、开麦都写回 hub：主机重启后 ready 帧带回的是最后一次语音的开关（唤醒模型和转文字两路都算）。"""
        await self.start({r.id: ScriptBrain("一句") for r in ROLES})
        await self.said("闭麦", "闭麦")
        await wait_for(lambda: not self.hub.mic_on(), what="语音闭麦写回 hub")
        await self.said("开麦", "开麦")
        await wait_for(self.hub.mic_on, what="唤醒模型开麦写回 hub")
        await self.said("闭麦")
        await wait_for(lambda: not self.hub.mic_on(), what="转文字闭麦写回 hub")
        t = time.time()
        await self.call(self.host.on_voice, "开麦", t - 2, t, kws=[], muted=True)
        await wait_for(self.hub.mic_on, what="转文字开麦写回 hub")
        # 重启主机：从 hub 的 ready 帧读回开麦
        self.host.stop()
        await asyncio.wait_for(self.task, 5)
        self.host = Host(self.m, self.url, TOKEN, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2,
                         words=WORDS, log=self.logs.append)
        self.host.mic_on = False
        self.task = asyncio.create_task(self.host.run())
        await wait_for(self.host.connected.is_set, what="重启后连上")
        self.assertTrue(self.host.mic_on)


class RealModel(unittest.TestCase):
    def test_loads_roles_toml_words(self):
        """真模型按 roles.toml 生成词表能加载，喂静音不报词。"""
        from tests.local_config import need_local
        cfg = load(need_local(self))
        if not cfg.wake_kws_model or not Path(cfg.wake_kws_model, "tokens.txt").is_file():
            self.skipTest("没下载本地唤醒模型（README「本地唤醒模型」）")
        sp = kws.Spotter(wake.Words.from_config(cfg), cfg.wake_kws_model)
        self.assertEqual(sp.labels, ["小橘", "鲸鱼娘", "彩虹猫", "小家", "暂停", "闭麦", "开麦"])
        self.assertEqual(sum((sp.feed(SILENT) for _ in range(100)), []), [])


if __name__ == "__main__":
    unittest.main()
