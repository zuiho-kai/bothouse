"""形态 B 第二步（rh/discord_body.py）：主人对板子叫映射了 Discord bot 的角色 → 以 webhook 身份发进 Discord；
bot 的回复经 cc-connect 钩子（/rh/discord/hook）回到板子念。真 hub + 真 host + 假小智板子 + 本机假 webhook 服务器，不出声、
不碰真 Discord。

覆盖：叫名字 → 发进 webhook（正文带 <@bot_id> 和「主人对着板子说的」、用户名「板子」、只允许 @ 这个 bot）、不进自建频道、
日志不带 webhook 地址；闭麦时不发；relay 关着走旧路；叫产品名走旧路；钩子：对应 project 的回复才念、非本频道 / 没等待的不念、
和 /rh/discord/say 重复的只念一次（谁先到念谁）；播放开关关着（半夜不出声）钩子送来的也只记日志。
"""
from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

import aiohttp
from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import discord_body as dbody
from rh import wake as wakemod
from tests.test_discord_body import BOT_A, BOT_B, CHANNEL, DiscordBase
from tests.test_hub import wait_for
from tests.test_xiaozhi import DEV_A

# 语音唤醒词：角色 a / b / c 叫「小橘」「鲸鱼娘」「彩虹猫」（test_device.ROLES 的名字是单个字母，拼音匹配认不出）
WORDS = wakemod.Words([("a", ["小橘"]), ("b", ["鲸鱼娘"]), ("c", ["彩虹猫"])], product=["小家"])
SECRET = "webhooks/1234/s3cr3t-token"


class FakeWebhook:
    """本机假 Discord webhook：收 POST、记 body。带 ?wait=true 时像 Discord 一样回 200 和这条消息（含 ID），否则回 204。"""

    def __init__(self, status=204):
        self.status, self.got, self.ids = status, [], []

    async def _post(self, req):
        self.got.append(await req.json())
        if self.status == 204 and req.query.get("wait") == "true":
            self.ids.append(str(7000 + len(self.got)))
            return web.json_response({"id": self.ids[-1]})
        return web.Response(status=self.status)

    async def start(self):
        app = web.Application()
        app.router.add_post("/api/" + SECRET, self._post)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.url = f"http://127.0.0.1:{port}/api/{SECRET}"
        return self

    async def close(self):
        await self.runner.cleanup()


class RelayBase(DiscordBase):
    async def start_relay(self, play=True, relay=True, status=204, **kw):
        self.hook_srv = await FakeWebhook(status).start()
        await self.start_body(play=play, relay=relay, webhook=self.hook_srv.url, **kw)
        self.host.words = WORDS

    async def heard(self, text):
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, text)

    async def hook(self, project, content, session_key=f"discord:{CHANNEL}", event="message.sent", triggers=None):
        """triggers 不给 = 旧 cc-connect（钩子不带触发消息 ID）；给了 = extra.trigger_message_ids。"""
        body = {"event": event, "timestamp": "2026-10-19T20:00:00+08:00", "project": project, "session_key": session_key,
                "platform": "discord", "content": content}
        if triggers is not None:
            body["extra"] = {"trigger_message_ids": triggers}
        async with aiohttp.ClientSession() as s:
            async with s.post(f"http://127.0.0.1:{self.xz.port}{dbody.HOOK_PATH}", json=body) as r:
                self.assertEqual(r.status, 200)
                return (await r.json())["result"]

    def user_rows(self):
        return self.rows(author_kind="user")

    async def asyncTearDown(self):
        if hasattr(self, "hook_srv"):
            await self.hook_srv.close()
        await super().asyncTearDown()


class ToDiscord(RelayBase):
    async def test_named_goes_to_webhook_not_hub(self):
        await self.start_relay()
        await self.heard("小橘，今天怎么样")
        await wait_for(lambda: self.hook_srv.got, what="webhook 收到")
        body = self.hook_srv.got[0]
        self.assertEqual(body["username"], "板子")
        self.assertTrue(body["content"].startswith(f"<@{BOT_A}> "), body["content"])
        self.assertIn("主人对着板子说的", body["content"])
        self.assertIn("语音转文字", body["content"])
        self.assertTrue(body["content"].endswith("小橘，今天怎么样"), body["content"])
        self.assertEqual(body["allowed_mentions"], {"parse": [], "users": [BOT_A]})
        await wait_for(lambda: any("等她回" in s for s in self.log), what="日志记下等她回")
        await asyncio.sleep(0.3)
        self.assertEqual(self.user_rows(), [])   # 没进自建频道
        self.assertFalse(any(SECRET in s for s in self.log))   # 地址（带 token）不进日志

    async def test_two_bots_named(self):
        await self.start_relay()
        await self.heard("小橘和鲸鱼娘，你们看看")
        await wait_for(lambda: self.hook_srv.got, what="webhook 收到")
        body = self.hook_srv.got[0]
        self.assertTrue(body["content"].startswith(f"<@{BOT_A}> <@{BOT_B}> "), body["content"])
        self.assertEqual(body["allowed_mentions"]["users"], [BOT_A, BOT_B])

    async def test_unmapped_role_and_product_name_go_to_hub(self):
        """角色 c 没映射 bot、「小家」是产品名：照旧进自建频道，webhook 不收。"""
        await self.start_relay()
        await self.heard("彩虹猫，在吗")
        await wait_for(lambda: len(self.user_rows()) == 1, what="自建频道收到")
        await self.heard("小家，在吗")
        await wait_for(lambda: len(self.user_rows()) == 2, what="自建频道收到第二句")
        await asyncio.sleep(0.2)
        self.assertEqual(self.hook_srv.got, [])

    async def test_muted_not_sent(self):
        await self.start_relay()
        await self.heard("闭麦")
        self.assertFalse(self.host.mic_on)
        await self.heard("小橘，这句不该发")
        await asyncio.sleep(0.3)
        self.assertEqual(self.hook_srv.got, [])
        self.assertEqual(self.user_rows(), [])
        # 收音那边挡住了；say_as_user 直接被调也挡（第二道）
        self.host.say_as_user("小橘，直接调", ["a"])
        await asyncio.sleep(0.3)
        self.assertEqual(self.hook_srv.got, [])
        self.assertTrue(any("闭麦中，这句不发进 Discord" in s for s in self.log))

    async def test_relay_off_uses_hub(self):
        await self.start_relay(relay=False)
        await self.heard("小橘，走旧路")
        await wait_for(lambda: len(self.user_rows()) == 1, what="自建频道收到")
        await asyncio.sleep(0.2)
        self.assertEqual(self.hook_srv.got, [])

    async def test_webhook_error_logged_no_pending(self):
        await self.start_relay(status=500)
        await self.heard("小橘，发不出去")
        await wait_for(lambda: any("发进 Discord 失败" in s for s in self.log), what="日志记失败")
        self.assertEqual(await self.hook("pa", "不该念的回复"), "not_waiting")
        self.assertFalse(any(SECRET in s for s in self.log))


class FromDiscord(RelayBase):
    async def ask(self, text="小橘，今天怎么样"):
        n = sum("等她回" in s for s in self.log)
        await self.heard(text)
        await wait_for(lambda: sum("等她回" in s for s in self.log) > n, what="等她回")

    async def test_hook_reply_spoken_then_gate_copy_dropped(self):
        await self.start_relay()
        a = await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.hook("pa", "今天挺好的。"), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完")
        self.assertEqual(a.jsons(type="tts", state="sentence_start")[0]["text"], "今天挺好的。")
        self.assertEqual([v for _, v in self.synth.calls], ["va"])
        # gate 那条路晚些送来同一条：不念第二遍
        self.assertEqual(await self.say(BOT_A, "今天挺好的。"), "dup")
        # 她再发一条（没在等了）：不念
        self.assertEqual(await self.hook("pa", "再补一句。"), "not_waiting")
        await asyncio.sleep(0.3)
        self.assertEqual(len(a.jsons(type="tts", state="start")), 1)

    async def test_gate_first_then_hook_dropped(self):
        await self.start_relay()
        a = await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.say(BOT_A, "先从 gate 来。"), "queued")
        self.assertEqual(await self.hook("pa", "先从 gate 来。"), "dup")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完")
        await asyncio.sleep(0.3)
        self.assertEqual(len(a.jsons(type="tts", state="start")), 1)
        self.assertEqual(self.body.waiting(), set())   # 等待已清

    async def test_same_text_twice_same_path_both_spoken(self):
        """同一条路连着两次同样的话（她真说了两遍）照念；只有另一条路的同一条才算重复。"""
        await self.start_relay()
        a = await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.hook("pa", "好的。"), "queued")
        await self.ask("小橘，再来")
        self.assertEqual(await self.hook("pa", "好的。"), "queued")
        await wait_for(lambda: len(a.jsons(type="tts", state="stop")) == 2, what="两句都念完")

    async def test_long_reply_gate_truncated_still_dedup(self):
        """长回复：gate 只有结尾 600 字（开头半句被截）；钩子有全文。按结尾比，仍认出是同一条。"""
        await self.start_relay()
        await self.board(DEV_A)
        await self.ask()
        full = "。".join(f"第{i}句很长很长的内容" for i in range(80)) + "。"
        self.assertGreater(len(full), 600)
        self.assertEqual(await self.hook("pa", full), "queued")
        self.assertEqual(await self.say(BOT_A, full[-600:], truncated=True), "dup")

    async def test_other_channel_unmapped_not_waiting(self):
        await self.start_relay()
        a = await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.hook("pa", "别的频道", session_key="discord:999"), "other_channel")
        self.assertEqual(await self.hook("longniang", "没映射的 bot"), "unmapped")
        self.assertEqual(await self.hook("pb", "没在等的 bot"), "not_waiting")
        self.assertEqual(await self.hook("pa", "别的事件", event="session.start"), "ignored")
        await asyncio.sleep(0.3)
        self.assertEqual(a.jsons(type="tts"), [])
        self.assertEqual(self.synth.calls, [])
        self.assertIn((BOT_A, CHANNEL), self.body.waiting())   # 还在等橘

    async def test_trigger_id_exact_match(self):
        """新 cc-connect 钩子带触发消息 ID：只有回的是板子那条才念；同频道里回别的消息的不念，哪怕还在等她（审查建议 1）。"""
        await self.start_relay()
        await self.board(DEV_A)
        await self.ask()
        mid, = self.hook_srv.ids
        self.assertIn(f"消息 {mid}", next(s for s in self.log if "等她回" in s))
        self.assertEqual(await self.hook("pa", "回别人的话。", triggers=["8888"]), "not_waiting")
        self.assertIn((BOT_A, CHANNEL), self.body.waiting())   # 没被别的话消耗掉
        self.assertEqual(await self.hook("pb", "鲸鱼娘回这条。", triggers=[mid]), "not_waiting")   # 这条没 @ 她
        self.assertEqual(await self.hook("pa", "回板子的话。", triggers=["8888", mid]), "queued")
        self.assertEqual(self.body.waiting(), set())
        self.assertEqual(await self.hook("pa", "同一条又来一次。", triggers=[mid]), "not_waiting")

    async def test_two_bots_one_message_each_matched(self):
        await self.start_relay()
        await self.board(DEV_A)
        n = sum("等她回" in s for s in self.log)
        await self.heard("小橘和鲸鱼娘，你们看看")
        await wait_for(lambda: sum("等她回" in s for s in self.log) > n, what="等她回")
        mid, = self.hook_srv.ids
        self.assertEqual(await self.hook("pa", "橘回。", triggers=[mid]), "queued")
        self.assertEqual(self.body.waiting(), {(BOT_B, CHANNEL)})
        # 对上了（不是 not_waiting），只是测试里鲸鱼娘（角色 b）没接板子
        self.assertEqual(await self.hook("pb", "鲸鱼回。", triggers=[mid]), "no_board")
        self.assertEqual(self.body.waiting(), set())

    async def test_old_hook_without_id_expires(self):
        """旧 cc-connect 不带 ID：按 (bot, 频道) 对，但只认 PENDING_TTL 之内的等待。"""
        await self.start_relay()
        await self.board(DEV_A)
        await self.ask()
        for p in self.body._pending.values():
            p["at"] -= dbody.PENDING_TTL + 1
        self.assertEqual(await self.hook("pa", "很久以后在这个频道说的别的话。"), "not_waiting")
        await self.ask("小橘，再问一句")
        self.assertEqual(await self.hook("pa", "这次及时回了。"), "queued")

    async def test_session_key_with_user(self):
        """share_session_in_channel = false 时 session_key 是 discord:<频道>:<用户>（审查建议 7）。"""
        await self.start_relay()
        await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.hook("pa", "回了。", session_key=f"discord:{CHANNEL}:42"), "queued")
        self.assertEqual(dbody.channel_of(f"discord:{CHANNEL}"), CHANNEL)
        self.assertEqual(dbody.channel_of(f"discord:{CHANNEL}:42"), CHANNEL)
        self.assertEqual(dbody.channel_of("telegram:1"), "")
        self.assertEqual(dbody.channel_of("discord:"), "")

    async def test_relay_error_logged_without_secret(self):
        """relay 协程里任何异常都记日志（Host 用 run_coroutine_threadsafe 调，不记就被吞掉），日志不带 webhook token。"""
        await self.start_relay()

        async def boom(text, bots=()):
            raise RuntimeError(f"bad {self.hook_srv.url}")
        self.body._dest = boom
        await self.heard("小橘，会出错")
        await wait_for(lambda: any("出错（RuntimeError" in s for s in self.log), what="出错日志")
        self.assertFalse(any("s3cr3t" in s for s in self.log))

    async def test_play_off_hook_only_logs(self):
        """半夜不出声 = [discord] play 关着：钩子那条路送来的回复同样只记日志。"""
        await self.start_relay(play=False)
        a = await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.hook("pa", "半夜的回复。"), "off")
        await asyncio.sleep(0.3)
        self.assertEqual(a.jsons(type="tts"), [])
        self.assertEqual(self.synth.calls, [])
        self.assertTrue(any("开关关着" in s for s in self.log))

    async def test_pause_stops_hook_reply(self):
        await self.start_relay(synth_secs=3.0)
        a = await self.board(DEV_A)
        await self.ask()
        self.assertEqual(await self.hook("pa", "很长的一句。"), "queued")
        await wait_for(lambda: a.audio(), what="板子开始念")
        await self.heard("暂停")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子停下")

    async def test_hook_only_loopback(self):
        await self.start_relay()
        req = type("R", (), {"remote": "fe80::1"})()
        with self.assertRaises(web.HTTPForbidden):
            await self.body._hook(req)


class Config(unittest.TestCase):
    def test_parse(self):
        from tests.test_qwen import load
        c = load('[discord]\nrelay = true\nchannel = "42"\n[[discord.bots]]\nbot_id = "1"\nrole = "a"\nproject = "p"')
        self.assertTrue(c.discord_relay)
        self.assertEqual(c.discord_channel, "42")
        self.assertEqual(c.discord_bots[0].project, "p")
        self.assertFalse(load("").discord_relay)
        self.assertEqual(load('[[discord.bots]]\nbot_id = "1"\nrole = "a"').discord_bots[0].project, "")
        with self.assertRaises(ValueError):
            load('[discord]\nrelay = true')   # 开了 relay 要有频道
        with self.assertRaises(ValueError):
            load('[discord]\nrelay = "yes"')
        with self.assertRaises(ValueError):
            load('[discord]\nchannel = "abc"')
        with self.assertRaises(ValueError):
            load('[[discord.bots]]\nbot_id = "1"\nrole = "a"\nproject = "p"\n[[discord.bots]]\nbot_id = "2"\nrole = "b"\nproject = "p"')

    def test_relay_content(self):
        self.assertEqual(dbody.relay_content(["1", "2"], "你好"), "<@1> <@2> （主人对着板子说的，语音转文字）你好")


if __name__ == "__main__":
    unittest.main()
