"""板子收音（rh/board_mic.py）：假小智板子上传 Opus，主机解码后走和 Mac 麦克风同一条收音链路。
真 hub + 真 host + 假板子，假转文字（按收到的音频长短判断），不出声。

覆盖：协议头去掉；Ogg 封装能被 ffmpeg 解出同样长的音频；一次只听一块板子；板子停了补静音让一句收尾；
叫名字才进频道且只让被叫到的回答（回答在她的板子上推）；「暂停」停下；闭麦后不进频道；没绑定的板子不收；
Mac 和板子都听见同一句只处理一次（两路转成不同的字、口令、唤醒模型听到的都算）；板子断开不卡事件循环、重连后还能听；
闭麦后从板子说「开麦」能恢复；解码器退了重开并记日志。
"""
from __future__ import annotations

import asyncio
import io
import shutil
import threading
import time
import unittest
import wave

from rh import board_mic as bm
from rh import kws as kwsmod
from rh import voice as voicemod
from rh import wake as wakemod
from rh import xiaozhi as xz
from tests.test_discord_body import tone_wav
from tests.test_hub import wait_for
from tests.test_xiaozhi import DEV_A, DEV_X, XiaozhiBase

FFMPEG = shutil.which(xz.find_ffmpeg())


def wav_secs(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav)) as w:
        return w.getnframes() / w.getframerate()


class FakeASR:
    """有声音就回 text；记下每次收到的音频长度。"""

    def __init__(self, text="A，你好"):
        self.text, self.calls, self.when = text, [], []   # when：每次转写的时刻（≈ 那句切出的时刻）

    def transcribe(self, wav):
        self.calls.append(wav_secs(wav))
        self.when.append(time.time())
        return self.text, 0.9


class FakeSpotter:
    """假唤醒模型：每次 reset 后第 at 个有声帧报一次 label（真模型在词说完约半秒后报）。"""

    def __init__(self, label: str, action: str, at: int = 10):
        self.label, self.action, self.at, self.n, self.hits = label, action, at, 0, []

    def reset(self):
        self.n = 0

    def feed(self, frame):
        if voicemod.rms(frame) < 1000:
            return []
        self.n += 1
        if self.n != self.at:
            return []
        self.hits.append(kwsmod.Hit(self.label, self.action, None, time.time(), wakemod.Term(self.label)))
        return [self.hits[-1]]


class FakeDec:
    """假解码器：一包解出一帧；alive 可以被测试拨成 False。"""
    made: list["FakeDec"] = []

    def __init__(self, on_pcm):
        self.on_pcm, self.ok, self.closed = on_pcm, True, False
        FakeDec.made.append(self)

    def feed(self, pk):
        self.on_pcm(b"\x01\x00" * bm.FRAME_SAMPLES)
        return True

    def alive(self):
        return self.ok

    def close(self):
        self.closed = True


class Unit(unittest.TestCase):
    def test_unframe_roundtrip(self):
        for v in (1, 2, 3):
            self.assertEqual(xz.unframe(xz.frame(b"opus!", v), v), b"opus!")
        self.assertEqual(xz.unframe(b"\x00\x02" + bytes(14), 2), b"")   # 太短 / 不是音频帧
        self.assertEqual(xz.unframe(bytes([1, 0, 0, 1, 9]), 3), b"")    # type=1 不是 Opus

    def test_one_board_at_a_time_and_tail_silence(self):
        now = [100.0]
        fed = []

        class Dec:
            def __init__(self, on_pcm):
                self.on_pcm = on_pcm

            def feed(self, pk):
                fed.append(pk)
                self.on_pcm(b"\x01\x00" * bm.FRAME_SAMPLES)   # 一包解出一帧

            def alive(self):
                return True

            def close(self):
                pass

        mic = bm.BoardMic(decoder=Dec, log=lambda s: None, clock=lambda: now[0])
        mic.on_packet("a", b"x")
        mic.on_packet("b", b"y")             # a 刚说过：b 先不听
        self.assertEqual(fed, [b"x"])
        now[0] += bm.OWNER_IDLE_SEC + 0.1
        mic.on_packet("b", b"z")             # a 停了够久：换 b
        self.assertEqual(fed, [b"x", b"z"])
        stop = threading.Event()
        frames = []
        for f in mic.frames(stop):
            frames.append(f)
            if len(frames) == 2 + bm.TAIL_FRAMES:
                break
        self.assertEqual(frames[0], b"\x01\x00" * bm.FRAME_SAMPLES)
        self.assertEqual(frames[2:], [bytes(bm.FRAME_BYTES)] * bm.TAIL_FRAMES)   # 后面补静音

    def test_dead_decoder_reopened_with_log(self):
        FakeDec.made.clear()
        log = []
        mic = bm.BoardMic(decoder=FakeDec, log=log.append)
        mic.on_packet("a", b"x")
        FakeDec.made[0].ok = False   # ffmpeg 死了
        mic.on_packet("a", b"y")
        self.assertEqual(len(FakeDec.made), 2)
        self.assertTrue(any("解码器 ffmpeg 退了，重开" in s for s in log), log)
        mic.close()
        self.assertTrue(all(d.closed for d in FakeDec.made))

    @unittest.skipUnless(FFMPEG, "没有 ffmpeg")
    def test_on_end_returns_fast_and_mic_reusable(self):
        """板子断开：on_end 立刻返回（事件循环里调），ffmpeg 在后台退出；之后同一个 BoardMic 还能收下一块板子。"""
        mic = bm.BoardMic(log=lambda s: None)
        for pk in xz.encode_opus(tone_wav(0.5)):
            mic.on_packet("a", pk)
        dec = mic._dec
        t = time.monotonic()
        mic.on_end("a")
        self.assertLess(time.monotonic() - t, 0.2)
        end = time.monotonic() + 3
        while dec.alive() and time.monotonic() < end:
            time.sleep(0.02)
        self.assertFalse(dec.alive())
        self.assertFalse(mic._q.empty())   # 断开前解出来的帧还在
        mic.on_packet("a", xz.encode_opus(tone_wav(0.2))[0])
        self.assertIsNot(mic._dec, dec)
        t = time.monotonic()
        mic.close()
        self.assertLess(time.monotonic() - t, bm.CLOSE_WAIT_SEC)

    @unittest.skipUnless(FFMPEG, "没有 ffmpeg")
    def test_ogg_stream_decodes_same_length(self):
        pk = xz.encode_opus(tone_wav(1.2))
        got, done = [], threading.Event()
        s = bm.OpusStream(lambda b: got.append(b))
        for p in pk:
            s.feed(p)
        s.close()
        pcm = b"".join(got)
        self.assertAlmostEqual(len(pcm) / 2 / 16000, 1.2, delta=0.07)
        self.assertGreater(voicemod.rms(pcm[16000:16000 + bm.FRAME_BYTES]), 1000)   # 解出来的是那段音，不是静音


@unittest.skipUnless(FFMPEG, "没有 ffmpeg")
class ThroughHost(XiaozhiBase):
    async def start_with_mic(self, text="A，你好", kws=None, words=None, **kw):
        await self.start_host(**kw)
        if words is not None:
            self.host.words = words
        self.asr = FakeASR(text)
        self.mic = bm.BoardMic(log=self.log.append)
        self.xz.on_mic, self.xz.on_mic_end = self.mic.on_packet, self.mic.on_end
        on_voice, on_kws = self.host.voice_from("board")
        self.listener = voicemod.Listener(self.asr, on_voice, lambda stop: [self.mic.frames(stop)],
                                          log=self.log.append, playing=self.host.spoken_between, timed=True,
                                          urgent=self.host.words.stop_word, muted=lambda: not self.host.mic_on,
                                          kws=kws, on_kws=on_kws)
        self.listener.start()

    async def mac_says(self, text, kws=None):
        """Mac 麦克风那路也听到板子刚听到的那句：直接调它的 on_voice（像转写线程那样在线程里），
        这句的结束时刻取板子那句切出后 0.2 秒（远场比近场切得晚一点）。"""
        mac_voice, _ = self.host.voice_from("mac")
        t1 = self.asr.when[-1] + 0.2 if self.asr.when else time.time()
        await asyncio.get_running_loop().run_in_executor(None, lambda: mac_voice(text, t1 - 1.0, t1, kws=kws))
        await asyncio.sleep(0.5)

    def stopped_msgs(self):
        return [r for r in self.rows(author_kind="system") if "停下了" in r["text"]]

    async def asyncTearDown(self):
        if hasattr(self, "listener"):
            self.listener.stop()
            self.mic.close()
        await super().asyncTearDown()

    async def test_named_reply_goes_to_board(self):
        await self.start_with_mic("A，你好", max_turns=2)
        a = await self.board(DEV_A)
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.2)))
        await wait_for(lambda: self.rows(author_kind="user"), timeout=8, what="板子收音进频道")
        self.assertEqual(self.rows(author_kind="user")[0]["text"], "A，你好")
        # 转文字收到的是板子上传的那一句：1.2 秒，加切句器句首多带的和句尾等的静音
        extra = (voicemod.PREROLL_MS + voicemod.END_SILENCE_MS) / 1000 + 0.1
        self.assertTrue(1.1 <= self.asr.calls[0] <= 1.2 + extra, self.asr.calls)
        await wait_for(lambda: any(r["status"] == "done" for r in self.rows(author_kind="role")), timeout=8,
                       what="被叫到的说完")   # 叫了名字只她回，没有「到上限」的系统消息
        self.assertEqual({r["author"] for r in self.rows(author_kind="role")}, {"a"})   # 只有被叫到的回答
        self.assertTrue(a.audio())                                                      # 回答推回了她的板子
        self.assertTrue(any("[wake] 叫到 a" in s for s in self.log))

    async def test_unnamed_ignored(self):
        await self.start_with_mic("今天天气不错")
        a = await self.board(DEV_A)
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: self.asr.calls, timeout=8, what="转了文字")
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(author_kind="user"), [])
        self.assertTrue(any("没叫名字" in s for s in self.log))

    async def test_pause_word_stops_board(self):
        await self.start_with_mic("暂停", max_turns=3, synth_secs=5.0)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(lambda: a.audio(), what="板子在播")
        await a.speak_into_mic(xz.encode_opus(tone_wav(0.8)))
        await wait_for(lambda: a.jsons(type="tts", state="stop"), timeout=8, what="板子听到暂停后停下")
        self.assertTrue(any("听到安全词" in s for s in self.log))

    async def test_muted_not_posted(self):
        await self.start_with_mic("A，你好")
        a = await self.board(DEV_A)
        self.host.mic_on = False
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: self.asr.calls, timeout=8, what="闭麦中只为认开麦转文字")
        await asyncio.sleep(0.3)
        self.assertEqual(self.rows(author_kind="user"), [])

    async def test_unbound_board_not_heard(self):
        await self.start_with_mic("A，你好")
        x = await self.board(DEV_X, wait_online=False)
        await x.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await asyncio.sleep(1.5)
        self.assertEqual(self.mic.packets, 0)
        self.assertEqual(self.asr.calls, [])

    async def test_same_sentence_from_mac_and_board_once(self):
        await self.start_with_mic("A，你好")
        a = await self.board(DEV_A)
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: self.rows(author_kind="user"), timeout=8, what="板子那路进频道")
        await self.mac_says("A，你好")
        self.assertEqual(len(self.rows(author_kind="user")), 1)
        self.assertTrue(any("另一路已处理" in s for s in self.log))

    async def test_same_sentence_different_words_once(self):
        """两路 ASR 把同一句转成不同的同音字（「鲸鱼娘在吗」「金玉良在吗」，按字只有 0.4 像）：换成标准写法后算同一句，只进一次。"""
        words = wakemod.Words([("a", ["小橘"]), ("b", ["鲸鱼娘"]), ("c", ["C"])])
        await self.start_with_mic("鲸鱼娘在吗", words=words, max_turns=1)
        a = await self.board(DEV_A)
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: self.rows(author_kind="user"), timeout=8, what="板子那路进频道")
        await self.mac_says("金玉良在吗")
        self.assertEqual([r["text"] for r in self.rows(author_kind="user")], ["鲸鱼娘在吗"])
        self.assertTrue(any("mac 也听到这句，另一路已处理" in s for s in self.log), self.log)

    async def test_pause_different_words_executes_once(self):
        """板子转出「暂停」、Mac 转出「赞停一下」（按字不像）：都是暂停口令，只停一次、频道里只有一条「停下了」。"""
        await self.start_with_mic("暂停", max_turns=3, synth_secs=5.0)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(lambda: a.audio(), what="板子在播")
        await a.speak_into_mic(xz.encode_opus(tone_wav(0.8)))
        await wait_for(lambda: a.jsons(type="tts", state="stop"), timeout=8, what="板子听到暂停后停下")
        await wait_for(lambda: self.stopped_msgs(), what="频道里有「停下了」")
        await self.mac_says("赞停一下")
        self.assertEqual(len(self.stopped_msgs()), 1)
        self.assertTrue(any("mac 也听到口令，另一路已处理" in s for s in self.log), self.log)

    async def test_kws_pause_from_board_once_across_paths(self):
        """板子那路的唤醒模型听到「暂停」当场停；板子自己的转写、Mac 的唤醒模型、Mac 的转写都不再执行第二遍。"""
        spotter = FakeSpotter("暂停", wakemod.PAUSE)
        await self.start_with_mic("暂停", kws=spotter, max_turns=3, synth_secs=5.0)
        a = await self.board(DEV_A)
        await self.post("话题")
        await wait_for(lambda: a.audio(), what="板子在播")
        await a.speak_into_mic(xz.encode_opus(tone_wav(0.8)))
        await wait_for(lambda: a.jsons(type="tts", state="stop"), timeout=8, what="板子听到暂停后停下")
        self.assertTrue(any("听到安全词，停下（认出：kws" in s for s in self.log), self.log)
        await wait_for(lambda: any("已由唤醒模型执行" in s for s in self.log), timeout=8, what="板子那路转写不再执行")
        _, mac_kws = self.host.voice_from("mac")
        hit = kwsmod.Hit("暂停", wakemod.PAUSE, None, spotter.hits[0].t + 0.1, wakemod.Term("暂停"))   # 远场晚 0.1 秒听到
        await asyncio.get_running_loop().run_in_executor(None, mac_kws, hit)
        self.assertEqual(hit.done, wakemod.PAUSE)   # Mac 的唤醒模型也听到：标成已执行
        self.assertTrue(any("mac 的唤醒模型也听到「暂停」" in s for s in self.log), self.log)
        await self.mac_says("暂停", kws=[hit])        # Mac 的转写带着这个 hit：不执行
        await self.mac_says("暂停一下")               # Mac 的转写没带 hit：按口令去重，也不执行
        self.assertEqual(len(self.stopped_msgs()), 1)
        self.assertTrue(any("mac 也听到口令，另一路已处理" in s for s in self.log), self.log)

    async def test_unmute_from_board_restores(self):
        """闭麦后从板子说「开麦」（转成「开买」也算）：恢复收音，之后叫名字的话又进频道。"""
        await self.start_with_mic("开买")
        a = await self.board(DEV_A)
        self.host.mic_on = False
        await a.speak_into_mic(xz.encode_opus(tone_wav(0.8)))
        await wait_for(lambda: self.host.mic_on, timeout=8, what="板子说开麦后恢复")
        self.assertTrue(any("[wake] 开麦（认出：asr" in s for s in self.log), self.log)
        self.assertEqual(self.rows(author_kind="user"), [])   # 「开麦」本身不进频道
        self.asr.text = "A，你好"
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: self.rows(author_kind="user"), timeout=8, what="开麦后叫名字的话进频道")

    async def test_board_disconnect_does_not_stall_loop_and_reconnects(self):
        """板子断开：主机事件循环不被卡住（原来等 ffmpeg 退出要 2 秒）；换一块板子连上来照样能听。"""
        await self.start_with_mic("A，你好", max_turns=1)
        a = await self.board(DEV_A)
        await a.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: self.rows(author_kind="user"), timeout=8, what="板子那路进频道")
        gaps, ticking = [], True

        async def tick():
            last = time.monotonic()
            while ticking:
                await asyncio.sleep(0.01)
                now = time.monotonic()
                gaps.append(now - last)
                last = now
        ticker = asyncio.create_task(tick())
        await a.close()
        await wait_for(lambda: any("收音的板子 a → 无" in s for s in self.log), what="板子断开后解码器摘下")
        await asyncio.sleep(0.3)
        ticking = False
        await ticker
        self.assertLess(max(gaps), 0.5, gaps)
        self.assertTrue(any("的板子 " in s and "断开" in s for s in self.log), self.log)
        a2 = await self.board(DEV_A)
        self.boards_.remove(a)
        await a2.speak_into_mic(xz.encode_opus(tone_wav(1.0)))
        await wait_for(lambda: len(self.rows(author_kind="user")) == 2, timeout=8, what="重连后的板子那路进频道")


if __name__ == "__main__":
    unittest.main()
