"""形态 B（rh/discord_body.py）：gate 转来的「bot 回应板子主人」的话，在映射角色的板子上念。
真 hub + 真 host + 假小智板子（tools/fake_xiaozhi.py），假合成、假大脑，不出声。

覆盖：开关关着只记日志不推板子；开着按 bot ID → 角色找音色和板子，假板子收到这句的音频；真 Opus 下收到的包和
直接编码同一段音频一模一样；没映射、板子不在线都不念且不退回 Mac 喇叭；暂停、闭麦停下并作废排队的；
和小家讨论共用发言锁不叠音；念的话进回声比对；只收本机来的请求；配置校验。
"""
from __future__ import annotations

import asyncio
import math
import shutil
import struct
import sys
import time
import unittest
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import discord_body as dbody
from rh import wake as wakemod
from rh import xiaozhi as xz
from rh.config import DiscordBot
from rh.device import DeviceSpeaker
from rh.host import Host
from rh.meeting import Meeting
from tests.test_device import ROLES, FakeLocal, FakeSynth, silent_wav
from tests.test_hub import TOKEN, wait_for
from tests.test_meeting import FakeBrain
from tests.test_xiaozhi import DEV_A, XiaozhiBase, fake_encoder

BOT_A, BOT_B, BOT_LONG = "111", "222", "999"   # BOT_LONG 不映射
BOTS = [DiscordBot(BOT_A, "botA", "a"), DiscordBot(BOT_B, "botB", "b")]


def tone_wav(secs: float, hz: float = 440.0, rate: int = 16000) -> bytes:
    """一段正弦波 WAV（每次生成都一样，用来比对板子收到的 Opus 包）。"""
    import io
    import wave
    n = int(secs * rate)
    pcm = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(n))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class ToneSynth:
    def __init__(self, secs=0.6):
        self.secs, self.calls = secs, []

    def synth(self, text, voice):
        self.calls.append((text, voice))
        return tone_wav(self.secs)


class DiscordBase(XiaozhiBase):
    async def start_body(self, play=True, synth=None, encoder=fake_encoder, max_turns=1, synth_secs=0.3, grace=5.0):
        brains = {r.id: FakeBrain(r.name) for r in ROLES}
        self.local = FakeLocal()
        self.speaker = DeviceSpeaker(FakeSynth(synth_secs), self.local, log=self.log.append, grace=grace)
        self.m = Meeting(ROLES, brains, max_turns, 1e6, tts=self.speaker)
        self.xz = xz.XiaozhiServer({DEV_A: "a"}, port=0, host="127.0.0.1", encoder=encoder, log=self.log.append)
        w = wakemod.Words([(r.id, [r.name]) for r in ROLES])
        self.host = Host(self.m, self.url, TOKEN, self.dir / "s.json", reconnect_min=0.05, reconnect_max=0.2,
                         speaker=self.speaker, boards=self.xz, words=w, log=self.log.append)
        from rh.dial import Dial
        self.host.dial = Dial(self.xz, ROLES, self.dir, log=self.log.append)
        self.synth = synth or FakeSynth(synth_secs)
        self.body = dbody.DiscordBody(BOTS, ROLES, self.xz, self.synth, self.m.lock, play=play, log=self.log.append,
                                      on_event=self.host.dial.event, grace=grace)
        self.host.discord = self.body
        self.xz.routes.append(self.body.route())
        self.task = asyncio.create_task(self.host.run())
        await wait_for(self.host.connected.is_set, what="角色主机连上")
        self.ota = f"http://127.0.0.1:{self.xz.port}{xz.OTA_PATH}"
        self.boards_ = []

    async def say(self, bot_id, text, truncated=False):
        async with aiohttp.ClientSession() as s:
            async with s.post(f"http://127.0.0.1:{self.xz.port}{dbody.SAY_PATH}",
                              json={"bot_id": bot_id, "text": text, "truncated": truncated}) as r:
                self.assertEqual(r.status, 200)
                return (await r.json())["result"]

    async def asyncTearDown(self):
        if hasattr(self, "body"):
            self.body.close()
        await super().asyncTearDown()


class Switch(DiscordBase):
    async def test_off_only_logs(self):
        """开关默认关：板子在线也不推任何音频，只记一行日志。"""
        await self.start_body(play=False)
        a = await self.board(DEV_A)
        self.assertEqual(await self.say(BOT_A, "你好，我是 A。"), "off")
        await asyncio.sleep(0.3)
        self.assertEqual(a.audio(), [])
        self.assertEqual(a.jsons(type="tts"), [])
        self.assertTrue(any("开关关着" in s for s in self.log))
        self.assertEqual(self.synth.calls, [])   # 关着连合成都不做

    async def test_on_plays_on_mapped_board_with_role_voice(self):
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        self.assertEqual(await self.say(BOT_A, "第一句。第二句！"), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完")
        self.assertEqual([v for _, v in self.synth.calls], ["va", "va"])   # 角色 a 的音色
        self.assertTrue(a.audio())
        self.assertEqual(a.jsons(type="tts", state="sentence_start")[0]["text"], "第一句。第二句！")
        self.assertEqual(self.local.played, [])   # 没走 Mac 喇叭
        await wait_for(lambda: any("念完" in s for s in self.log), what="日志念完")
        # 表盘跟着亮：speaking 再回 idle
        states = [d["state"] for d in a.jsons(type="rh_dial") if "state" in d]
        self.assertIn("speaking", states)
        await wait_for(lambda: [d["state"] for d in a.jsons(type="rh_dial")][-1] == "idle", what="表盘回待机")

    async def test_unmapped_and_offline_not_played(self):
        await self.start_body(play=True)
        self.assertEqual(await self.say(BOT_LONG, "龙娘的话"), "unmapped")
        self.assertEqual(await self.say(BOT_A, "板子没连"), "no_board")
        await asyncio.sleep(0.3)
        self.assertEqual(self.local.played, [])   # 板子不在不退回 Mac 喇叭
        self.assertEqual(self.synth.calls, [])

    async def test_only_loopback(self):
        await self.start_body(play=True)
        req = type("R", (), {"remote": "192.168.1.5"})()
        with self.assertRaises(dbody.web.HTTPForbidden):
            await self.body._http(req)


class Rules(DiscordBase):
    async def test_pause_stops_and_drops_queue(self):
        await self.start_body(play=True, synth_secs=3.0)
        a = await self.board(DEV_A)
        await self.say(BOT_A, "很长的一句。")
        await self.say(BOT_A, "排队的第二句。")
        await wait_for(lambda: a.audio(), what="板子开始念")
        t0 = time.monotonic()
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, "暂停")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子收到 tts stop")
        self.assertLess(time.monotonic() - t0, 1.0)
        await asyncio.sleep(0.5)
        self.assertEqual(len(a.jsons(type="tts", state="start")), 1)   # 第二句作废
        self.assertEqual([t for t, _ in self.synth.calls], ["很长的一句。"])

    async def test_mute_stops(self):
        await self.start_body(play=True, synth_secs=3.0)
        a = await self.board(DEV_A)
        await self.say(BOT_A, "很长的一句。")
        await wait_for(lambda: a.audio(), what="板子开始念")
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, "闭麦")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="闭麦后板子停下")
        self.assertFalse(self.host.mic_on)

    async def test_waits_for_household_speaker(self):
        """小家讨论里有人在说（拿着发言锁）：Discord 的话等她说完再念，不叠音。"""
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        got = self.m.lock.try_acquire("b")
        await self.say(BOT_A, "等一等。")
        await asyncio.sleep(0.3)
        self.assertEqual(a.audio(), [])
        self.m.lock.release("b", got[0])
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="锁放开后念完")

    async def test_spoken_counts_as_echo(self):
        await self.start_body(play=True, synth_secs=1.0)
        a = await self.board(DEV_A)
        await self.say(BOT_A, "回声比对用的话。")
        await wait_for(lambda: a.audio(), what="板子开始念")
        now = time.time()
        self.assertIn("回声比对用的话。", self.host.spoken_between(now - 1, now))


@unittest.skipUnless(shutil.which(xz.find_ffmpeg()), "没有 ffmpeg")
class RealOpusOnFakeBoard(DiscordBase):
    async def test_board_gets_exact_opus_of_synth(self):
        """真 Opus：假板子收到的包 = 直接把同一段合成音频编码出来的包（音频没丢、没乱序、没混进别的）。"""
        await self.start_body(play=True, synth=ToneSynth(0.6), encoder=xz.encode_opus)
        a = await self.board(DEV_A)
        await self.say(BOT_A, "一句话。")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), timeout=10, what="板子念完")
        self.assertEqual(a.audio(), xz.encode_opus(tone_wav(0.6)))


class Speakable(unittest.TestCase):
    def test_strips_code_links_mentions_marks(self):
        t = "**结论**：好了 <@1558553439942737962>\n```py\nprint(1)\n```\n看 https://x.y/z 。`a` | b"
        self.assertEqual(dbody.speakable(t), "结论 ：好了\n看 。 a b")

    def test_truncated_drops_first_half_sentence(self):
        self.assertEqual(dbody.speakable("前面被截掉的半句。完整的一句。", truncated=True), "完整的一句。")
        self.assertEqual(dbody.speakable("没有句末", truncated=True), "没有句末")

    def test_code_only_is_empty(self):
        self.assertEqual(dbody.speakable("```\nx\n```"), "")


class Config(unittest.TestCase):
    def test_parse_and_validate(self):
        from tests.test_qwen import load
        c = load('[discord]\nplay = true\n[[discord.bots]]\nbot_id = "123"\nname = "x"\nrole = "a"')
        self.assertTrue(c.discord_play)
        self.assertEqual(c.discord_bots[0].role, "a")
        self.assertFalse(load("").discord_play)   # 默认关
        with self.assertRaises(ValueError):
            load('[[discord.bots]]\nbot_id = "123"\nrole = "nobody"')
        with self.assertRaises(ValueError):
            load('[[discord.bots]]\nbot_id = "abc"\nrole = "a"')
        with self.assertRaises(ValueError):
            load('[discord]\nplay = "yes"')

    def test_repo_config_default_off(self):
        from rh import config
        c = config.load(ROOT / "roles.toml")
        self.assertFalse(c.discord_play)
        self.assertEqual({b.role for b in c.discord_bots}, {"ju", "jing", "mao"})


if __name__ == "__main__":
    unittest.main()
