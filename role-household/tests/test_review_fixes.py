"""代码审查 rh-onboarding（d6840a1）5 条的回归测试。全用假的：本机假 Discord、假模型服务，不出声、不发真实消息。

1. 向导 jev.json 的 top_logprobs、no_thinking 读进来：no_thinking 时请求带 chat_template_kwargs；按概率选选项；
   预热要真的答出选项才算好。
2. 启动自检：只有 401/403/404 算配错，429、5xx 只警告；几项检查并行，Discord 慢时不串行等。
3. backend 以 jev.json 为准：roles.toml 写 backend = "jev" 而 key_file 是向导文件 → 按 llm，并留一句说明。
4. 配了 guild 和 bot token、没写 auto_channel：读音匹配默认打开；配了 url 的线上配置照旧走 llm。
5. roles.toml 的 url 和 jev.json 的 url 不一样：拒绝加载（不把向导的 key 发到别的地址）。
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path

from aiohttp import web

from rh import config as cfgmod
from rh import discord_body as dbody
from rh import discord_route as route
from rh.config import DiscordSettings, LLMEndpoint
from tests.test_discord_body import CHANNEL
from tests.test_discord_route import GUILD, FakeDiscord, FakeLLM

ROOT = Path(__file__).resolve().parent.parent
WIZ = {"backend": "llm", "url": "http://m/v1", "model": "qwen", "api_key": "wk", "logprobs": True,
       "top_logprobs": 11, "no_thinking": True}


def write(discord: str, wizard: dict | None = None) -> cfgmod.Config:
    d = Path(tempfile.mkdtemp())
    if wizard is not None:
        (d / "jev.json").write_text(json.dumps(wizard))
    (d / "roles.toml").write_text(
        '[meeting]\nmax_turns_per_topic = 1\nchars_per_sec = 5.0\n[brain]\nmodel = "x"\ntimeout_sec = 1\n'
        '[[roles]]\nid = "a"\nname = "A"\npersona = "p"\n[discord]\nrelay = true\nchannel = "42"\n'
        + discord.replace("JEV", str(d / "jev.json")) + '\n[[discord.bots]]\nbot_id = "1"\nrole = "a"\n')
    return cfgmod.load(d / "roles.toml")


def build(c, env=None):
    log: list[str] = []
    b = dbody.build(c, {"DISCORD_BOT_TOKEN": "tok"} if env is None else env, boards=None, synth=None, lock=None,
                    log=log.append)
    return b, log


class WizardParams(unittest.TestCase):
    """第 1、3、5 条：读向导文件。"""

    def test_reads_top_logprobs_and_no_thinking(self):
        st = write('guild = "7"\n[discord.router]\nkey_file = "JEV"\n', WIZ).discord
        self.assertEqual((st.router.url, st.router.model), ("http://m/v1", "qwen"))
        self.assertEqual((st.router.top_logprobs, st.router.no_thinking), (11, True))

    def test_plain_key_file_unchanged(self):
        """线上那种 key_file（只有 api_key，没有 url）不是向导文件：不读概率参数，照旧按回复文字。"""
        st = write('guild = "7"\n[discord.router]\nurl = "http://g/v1"\nmodel = "m"\nkey_file = "JEV"\n',
                   {"api_key": "k", "language": "zh"}).discord
        self.assertEqual((st.router.top_logprobs, st.router.no_thinking, st.router_backend), (0, False, "llm"))

    def test_backend_from_wizard(self):
        c = write('guild = "7"\n[discord.router]\nbackend = "jev"\nkey_file = "JEV"\n', WIZ)
        self.assertEqual(c.discord.router_backend, "llm")
        b, log = build(c)
        try:
            self.assertIsNotNone(b.router.llm)
            self.assertIsNone(b.router.jev)
        finally:
            b.close()
        self.assertTrue(any("jev.json" in s and "llm" in s for s in log), log)

    def test_url_mismatch_rejected(self):
        with self.assertRaises(ValueError) as cm:
            write('guild = "7"\n[discord.router]\nurl = "http://other/v1"\nmodel = "x"\nkey_file = "JEV"\n', WIZ)
        self.assertIn("http://other/v1", str(cm.exception))
        self.assertNotIn("wk", str(cm.exception))
        # 同一个地址（末尾斜杠不同）照常用
        st = write('guild = "7"\n[discord.router]\nurl = "http://m/v1/"\nmodel = "x"\nkey_file = "JEV"\n', WIZ).discord
        self.assertEqual((st.router.model, st.router.top_logprobs), ("x", 11))


class FakeModel:
    """本机假 OpenAI 兼容服务：记下请求体，回脚本里的回复。"""

    def __init__(self, replies):
        self.replies, self.got = list(replies), []

    async def chat(self, req):
        self.got.append(await req.json())
        return web.json_response(self.replies.pop(0))

    async def start(self):
        app = web.Application()
        app.router.add_post("/v1/chat/completions", self.chat)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/v1"
        return self


def lp_reply(content, tops):
    return {"choices": [{"message": {"content": content},
                         "logprobs": {"content": [{"token": content, "top_logprobs":
                                                   [{"token": t, "logprob": l} for t, l in tops]}]}}]}


class PickByLogprobs(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        await self.m.runner.cleanup()

    async def run_(self, fn, *a):
        return await asyncio.get_running_loop().run_in_executor(None, fn, *a)

    async def test_no_thinking_and_top_logprobs(self):
        self.m = await FakeModel([lp_reply("<think>", [("<think>", -0.1), (" C", -1.0), ("A", -2.0)])]).start()
        llm = route.ChatLLM(LLMEndpoint(url=self.m.url, model="q", top_logprobs=11, no_thinking=True), "k")
        r = route.Router(llm)
        chans = [{"id": CHANNEL, "name": "创业"}, {"id": "500", "name": "量化团队"}]
        self.assertEqual(await self.run_(r.choose, "量化", chans, CHANNEL), ("500", "C"))
        body = self.m.got[0]
        self.assertEqual(body["chat_template_kwargs"], {"enable_thinking": False})
        self.assertEqual((body["max_tokens"], body["logprobs"], body["top_logprobs"]), (1, True, 11))

    async def test_plain_llm_request_unchanged(self):
        self.m = await FakeModel([{"choices": [{"message": {"content": "A"}}]}]).start()
        r = route.Router(route.ChatLLM(LLMEndpoint(url=self.m.url, model="q", prefill="<think></think>")))
        self.assertEqual((await self.run_(r.choose, "你好", [], CHANNEL))[0], route.DEFAULT)
        body = self.m.got[0]
        self.assertNotIn("chat_template_kwargs", body)
        self.assertNotIn("logprobs", body)
        self.assertEqual(body["max_tokens"], route.ROUTE_MAX_TOKENS)

    async def test_warm_needs_real_option(self):
        self.m = await FakeModel([lp_reply("<think>", [("<think>", -0.1), ("好", -0.5)]),
                                  lp_reply("A", [("A", -0.1)])]).start()
        r = route.Router(route.ChatLLM(LLMEndpoint(url=self.m.url, model="q", top_logprobs=20, no_thinking=True)))
        log = []
        await self.run_(r.warm, log.append)
        self.assertIn("预热失败", log[-1])
        self.assertIn("没答出选项", log[-1])
        await self.run_(r.warm, log.append)
        self.assertIn("预热好了", log[-1])

    async def test_warm_fake_llm_bad_answer(self):
        self.m = await FakeModel([]).start()
        log = []
        route.Router(FakeLLM(["zz"])).warm(log.append)
        self.assertIn("没答出选项", log[-1])


class SelfCheckStatus(unittest.IsolatedAsyncioTestCase):
    """第 2 条。"""

    async def asyncSetUp(self):
        self.dc = await FakeDiscord().start()

    async def asyncTearDown(self):
        await self.dc.close()

    def body(self):
        st = DiscordSettings(api=self.dc.base, guild=GUILD, webhooks_file="")
        b = dbody.DiscordBody([], [], None, None, None, relay=True, webhook=f"{self.dc.base}/webhooks/100/wtok",
                              channel=CHANNEL, settings=st, api=route.DiscordAPI(self.dc.base, "tok", 5.0),
                              log=lambda s: None)
        self.addCleanup(b.close)
        return b

    async def test_rate_limit_and_5xx_only_warn(self):
        self.dc.status_for = {"/users/@me": 429, "/channels/": 503, "/webhooks/": 500}
        bad, warn = await self.body().selfcheck()
        self.assertEqual(bad, [])
        self.assertEqual(len(warn), 2)   # token、webhook；频道和 token 同因（都没核成）只报一次
        self.assertTrue(all("HTTP" in w for w in warn))

    async def test_401_is_bad(self):
        self.dc.status_for = {"/users/@me": 401, "/channels/": 401}
        bad, _ = await self.body().selfcheck()
        self.assertEqual(len(bad), 1)   # token 错只报一条，不再连带说频道看不到
        self.assertIn("token", bad[0])

    async def test_checks_run_in_parallel(self):
        self.dc.delay = 0.5
        t0 = time.monotonic()
        self.assertEqual(await self.body().selfcheck(), ([], []))
        self.assertLess(time.monotonic() - t0, 1.2)   # 三项各 0.5 秒：串行要 1.5 秒


class AutoDefault(unittest.TestCase):
    """第 4 条。"""

    def test_guild_and_token_turn_on_matching(self):
        c = write('guild = "7"\n')
        b, _ = build(c)
        try:
            self.assertEqual(b.router.backend, "读音匹配")
        finally:
            b.close()
        b, _ = build(c, {"RH_DISCORD_WEBHOOK": "http://x"})   # 没 token：列不了频道，只进默认
        try:
            self.assertIsNone(b.router)
        finally:
            b.close()
        b, _ = build(write('guild = "7"\nauto_channel = false\n'))   # 明确关掉
        try:
            self.assertIsNone(b.router)
        finally:
            b.close()

    def test_url_config_still_llm(self):
        b, _ = build(write('guild = "7"\n[discord.router]\nurl = "http://g/v1"\nmodel = "m"\n'))
        try:
            self.assertIsNotNone(b.router.llm)
        finally:
            b.close()

    def test_template_only_key_file_line(self):
        """模板去掉 guild 和 key_file 两行的 #（不碰 auto_channel）就是向导模型选频道。"""
        text = (ROOT / "roles.example.toml").read_text()
        self.assertNotIn("\nauto_channel = false", text)
        d = Path(tempfile.mkdtemp())
        (d / "jev.json").write_text(json.dumps(WIZ))
        a = text.index("# [discord.router]")
        text = text[:a] + text[a:].replace("# [discord.router]", "[discord.router]", 1) \
            .replace('# key_file = "~/.cc-connect/jev.json"', f'key_file = "{d / "jev.json"}"', 1)
        text = text.replace('# guild = "000000000000000000"', 'guild = "000000000000000000"')
        (d / "roles.toml").write_text(text)
        st = cfgmod.load(d / "roles.toml").discord
        self.assertTrue(st.auto)
        self.assertEqual((st.router.url, st.router.no_thinking), ("http://m/v1", True))


if __name__ == "__main__":
    unittest.main()
