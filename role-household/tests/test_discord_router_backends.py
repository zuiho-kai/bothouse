"""选频道的三种后端、开关、启动自检、开机预热、本机冒充 jev 的接口（rh/discord_route.py、rh/discord_body.py、tools/jev_local.py）。

用户 2026-10-20：「那些用户都要可配置的，并且jev开关，写上允许llm模型或者jev模型，没有就按完全匹配允许口音，
本身我们现在有的jev也是llm冒充的」。

全用假的：本机假 Discord（tests/test_discord_route.FakeDiscord）、本机假 jev 服务、假 LLM、假 scorer；
不出声、不碰真 Discord、不加载真模型。

覆盖：
- 读音匹配（NameMatcher）：频道名、别名、同音/近音字（口音）；两个频道一样像 → 不猜；没配模型时按它选，进那个频道。
- llm 出错 / 答非选项 → 退到读音匹配，再不行进默认频道；模型答「原地」就是原地（不再去匹配）。
- jev：请求体按 System One choice 题的格式（state、model、questions.channel.criteria 用字母），key 走 Bearer，
  接口路径可配；jev 回的选项映射到频道；jev 出错退到读音匹配。
- 配置：backend 只能 llm/jev；auto_channel 开关（不写 = 配了模型就开；false = 只进默认；true 没模型 = 读音匹配）；
  aliases 格式；jev 不收 prefill。
- 预热：Router.warm 用长超时调一次模型，失败只记日志。
- 启动自检：token、默认频道、webhook 所属频道对 → 没问题；token 错、webhook 属于别的频道、默认频道看不到 → 报出来；
  连不上 → 只警告。
- tools/jev_local.answer：按 gate scorer 的概率回 System One 格式；同一前缀只 prepare 一次；不是 choice 题报错。
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import config as cfgmod
from rh import discord_body as dbody
from rh import discord_route as route
from rh.config import DiscordSettings, LLMEndpoint
from tests.test_discord_body import BOT_A, CHANNEL
from tests.test_discord_route import GUILD, QUANT, XOPS, FakeDiscord, FakeLLM, RouteBase
from tests.test_xiaozhi import DEV_A

CHANS = [{"id": CHANNEL, "name": "创业", "topic": ""}, {"id": QUANT, "name": "量化团队", "topic": "量化交易"},
         {"id": XOPS, "name": "x-运营", "topic": ""}]


class Matcher(unittest.TestCase):
    def test_name_alias_and_accent(self):
        m = route.NameMatcher({QUANT: ["量化", "模拟盘"]})
        self.assertEqual(m.match("帮我看看量化团队跑得怎么样", CHANS), (QUANT, "量化团队"))
        self.assertEqual(m.match("帮我看看量化那边", CHANS), (QUANT, "量化"))          # 别名
        self.assertEqual(m.match("亮化那边跑完没", CHANS), (QUANT, "量化"))            # 同音字（语音转错）
        self.assertEqual(m.match("良化那边跑完没", CHANS)[0], QUANT)                    # n/l、声调不同也算（同 wake.py）
        self.assertEqual(m.match("去x运营发一下", CHANS), (XOPS, "x-运营"))             # 名字里的标点不影响
        self.assertIsNone(m.match("今天天气怎么样", CHANS))

    def test_tie_is_no_match(self):
        chans = [{"id": "1", "name": "研究"}, {"id": "2", "name": "运营"}]
        self.assertIsNone(route.NameMatcher().match("研究一下运营", chans))
        # 一长一短：取长的
        chans = [{"id": "1", "name": "量化"}, {"id": "2", "name": "量化日志"}]
        self.assertEqual(route.NameMatcher().match("看看量化日志", chans)[0], "2")


class RouterChoose(unittest.TestCase):
    def test_no_model_uses_matcher(self):
        r = route.Router(None, None, route.NameMatcher({QUANT: ["量化"]}))
        self.assertEqual(r.choose("看看量化那边", CHANS, CHANNEL), (QUANT, "读音匹配「量化」"))
        self.assertEqual(r.choose("你好呀", CHANS, CHANNEL), (route.DEFAULT, "读音没匹配上"))
        self.assertEqual(r.choose("创业那边", CHANS, CHANNEL)[0], route.DEFAULT)   # 默认频道自己不当匹配候选
        self.assertEqual(r.backend, "读音匹配")
        self.assertEqual(r.name("新开一个频道专门聊招聘"), "招聘")   # 没模型起名：按「专门做 X」

    def test_llm_failure_falls_back_to_matcher(self):
        r = route.Router(FakeLLM([RuntimeError("down"), "zz", "A"]), None, route.NameMatcher({QUANT: ["量化"]}))
        pick, why = r.choose("量化那边怎么样", CHANS, CHANNEL)
        self.assertEqual(pick, QUANT)
        self.assertIn("模型出错 RuntimeError", why)
        pick, why = r.choose("量化那边怎么样", CHANS, CHANNEL)
        self.assertEqual(pick, QUANT)
        self.assertIn("答的不是选项", why)
        self.assertEqual(r.choose("量化那边怎么样", CHANS, CHANNEL), (route.DEFAULT, "A"))   # 模型答原地就是原地


class FakeJev:
    """本机假 jev System One 服务：记下请求，按脚本回选项。"""

    def __init__(self, answers):
        self.answers, self.got = list(answers), []

    async def handle(self, req):
        self.got.append((req.path, req.headers.get("Authorization"), await req.json()))
        a = self.answers.pop(0)
        if isinstance(a, int):
            return web.Response(status=a)
        q = (await req.json())["questions"]
        name = next(iter(q))
        return web.json_response({"model": "jev-latest", "answers": {name: {
            "type": "choice", "choice": a, "confidence": 0.9, "probabilities": {a: 0.9}}},
            "usage": {"input_tokens": 1, "output_tokens": 1}})

    async def start(self, path="/v1/systemone"):
        app = web.Application()
        app.router.add_post(path, self.handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        return self


class Jev(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        await self.jev.runner.cleanup()

    async def choose(self, router, text):
        return await asyncio.get_running_loop().run_in_executor(None, router.choose, text, CHANS, CHANNEL)

    async def test_request_shape_and_mapping(self):
        self.jev = await FakeJev(["C", "A"]).start("/custom/systemone")
        cli = route.JevClient(LLMEndpoint(url=self.jev.url, model="jev-latest"), "sk", "/custom/systemone")
        r = route.Router(None, cli)
        self.assertEqual(await self.choose(r, "看看量化那边"), (QUANT, "C"))
        self.assertEqual(await self.choose(r, "你好"), (route.DEFAULT, "A"))
        path, auth, body = self.jev.got[0]
        self.assertEqual((path, auth), ("/custom/systemone", "Bearer sk"))
        self.assertEqual(body["model"], "jev-latest")
        self.assertEqual(body["state"], "主人说：「看看量化那边」")
        q = body["questions"]["channel"]
        self.assertEqual(q["type"], "choice")
        self.assertEqual(list(q["criteria"]), ["A", "B", "C", "D"])
        self.assertIn("#量化团队：量化交易", q["criteria"]["C"])
        self.assertEqual(r.backend, "jev jev-latest")
        self.assertEqual(r.name("开个频道专门做固件"), "固件")   # jev 不生成，起名按规则

    async def test_jev_error_falls_back_to_matcher(self):
        self.jev = await FakeJev([500, "Z"]).start()
        cli = route.JevClient(LLMEndpoint(url=self.jev.url, model="m"))
        r = route.Router(None, cli, route.NameMatcher({QUANT: ["量化"]}))
        pick, why = await self.choose(r, "亮化那边怎么样")
        self.assertEqual(pick, QUANT)
        self.assertIn("模型出错 HTTPError", why)
        pick, why = await self.choose(r, "你好")
        self.assertEqual((pick, why), (route.DEFAULT, "答的不是选项 'Z'，读音没匹配上"))

    async def test_warm(self):
        self.jev = await FakeJev(["A", 500]).start()
        r = route.Router(None, route.JevClient(LLMEndpoint(url=self.jev.url, model="m")))
        log = []
        await asyncio.get_running_loop().run_in_executor(None, r.warm, log.append)
        self.assertIn("预热好了", log[-1])
        await asyncio.get_running_loop().run_in_executor(None, r.warm, log.append)
        self.assertIn("预热失败", log[-1])
        route.Router().warm(log.append)   # 没模型：什么都不做
        self.assertEqual(len(log), 2)


class WarmTimeout(unittest.TestCase):
    def test_warm_uses_long_timeout(self):
        seen = []

        class L(FakeLLM):
            def complete(self, system, user, max_tokens, timeout=None):
                seen.append(timeout)
                return "A"
        route.Router(L()).warm()
        self.assertEqual(seen, [route.WARM_TIMEOUT])
        route.Router(L()).choose("x", CHANS, CHANNEL)
        self.assertEqual(seen[-1], None)   # 平时用接口自己的超时（ROUTER_TIMEOUT）


class MatcherEndToEnd(RouteBase):
    async def test_no_model_routes_by_name(self):
        """没配模型：这句话里有「量化」（别名，语音转成「亮化」）→ 进量化团队频道，主机给它建 webhook。"""
        await self.start_route(router=route.Router(None, None, route.NameMatcher({QUANT: ["量化"]})))
        await self.board(DEV_A)
        await self.ask("小橘，帮我看看亮化那边跑怎么样了")
        self.assertEqual(self.dc.posts_to(f"/channels/{QUANT}/webhooks"), [{"name": "板子"}])
        self.assertEqual(self.body.waiting(), {(BOT_A, QUANT)})
        await self.ask("小橘你好呀")
        self.assertEqual(self.body.waiting(), {(BOT_A, QUANT), (BOT_A, CHANNEL)})
        self.assertTrue(any("读音匹配「量化」" in s for s in self.log))


class SelfCheck(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dc = await FakeDiscord().start()

    async def asyncTearDown(self):
        await self.dc.close()

    def body(self, token="tok", webhook="100", channel=CHANNEL, guild=GUILD):
        st = DiscordSettings(api=self.dc.base, guild=guild, webhooks_file="")
        api = route.DiscordAPI(self.dc.base, token, 5.0) if token else None
        url = f"{self.dc.base}/webhooks/{webhook}/wtok" if webhook else ""
        b = dbody.DiscordBody([], [], None, None, None, relay=True, webhook=url, channel=channel, settings=st, api=api,
                              log=lambda s: None)
        self.addCleanup(b.close)
        return b

    async def test_good(self):
        self.assertEqual(await self.body().selfcheck(), ([], []))
        self.assertEqual(await self.body(token="").selfcheck(), ([], []))   # 只有 webhook 也能核

    async def test_bad(self):
        bad, _ = await self.body(token="wrong").selfcheck()
        self.assertEqual(len(bad), 1)
        self.assertIn("token", bad[0])
        self.dc.webhook_channels["200"] = QUANT
        bad, _ = await self.body(webhook="200").selfcheck()
        self.assertEqual(len(bad), 1)
        self.assertIn(f"属于频道 {QUANT}", bad[0])
        bad, _ = await self.body(webhook="404").selfcheck()
        self.assertIn("webhook", bad[0])
        bad, _ = await self.body(channel="999", webhook="").selfcheck()
        self.assertIn("看不到这个频道", bad[0])
        bad, _ = await self.body(guild="888", webhook="").selfcheck()
        self.assertIn("不在 [discord] guild = 888", bad[0])
        for b in bad:
            self.assertNotIn("wtok", b)

    async def test_unreachable_only_warns(self):
        await self.dc.close()
        bad, warn = await self.body().selfcheck()
        self.assertEqual(bad, [])
        self.assertEqual(len(warn), 2)
        self.assertFalse(any("wtok" in w for w in warn))
        self.dc = await FakeDiscord().start()


class Config(unittest.TestCase):
    def write(self, discord: str) -> cfgmod.Config:
        f = Path(tempfile.mkdtemp()) / "roles.toml"
        f.write_text('[meeting]\nmax_turns_per_topic = 1\nchars_per_sec = 5.0\n[brain]\nmodel = "x"\ntimeout_sec = 1\n'
                     '[[roles]]\nid = "a"\nname = "A"\npersona = "p"\n'
                     '[discord]\nrelay = true\nchannel = "42"\n' + discord + '\n[[discord.bots]]\nbot_id = "1"\nrole = "a"\n')
        return cfgmod.load(f)

    def build(self, c, env=None):
        b = dbody.build(c, env if env is not None else {"DISCORD_BOT_TOKEN": "tok"}, boards=None, synth=None, lock=None,
                        log=lambda s: None)
        self.addCleanup(b.close)
        return b

    def test_backends(self):
        b = self.build(self.write('guild = "7"\n[discord.router]\nbackend = "jev"\nurl = "http://j"\nmodel = "jev-latest"\n'
                                  'key_env = "JK"\nendpoint = "/v2/x"\naliases = {"5" = ["量化"]}\n'),
                       {"DISCORD_BOT_TOKEN": "tok", "JK": "k"})
        self.assertIsNone(b.router.llm)
        self.assertEqual((b.router.jev.key, b.router.jev.endpoint, b.router.jev.ep.model), ("k", "/v2/x", "jev-latest"))
        self.assertEqual(b.router.matcher.aliases, {"5": ["量化"]})
        b = self.build(self.write('guild = "7"\n[discord.router]\nurl = "http://l"\nmodel = "m"\n'))   # 不写 backend = llm
        self.assertIsNotNone(b.router.llm)
        self.assertIsNone(b.router.jev)

    def test_auto_channel_switch(self):
        # 不写 auto_channel、没配模型、有 guild 和 token：读音匹配默认开（审查第 4 条）
        self.assertEqual(self.build(self.write('guild = "7"\n')).router.backend, "读音匹配")
        # 没 guild：只进默认频道
        self.assertIsNone(self.build(self.write('')).router)
        # 写 true、没配模型：读音匹配
        r = self.build(self.write('guild = "7"\nauto_channel = true\n')).router
        self.assertEqual((r.llm, r.jev, r.backend), (None, None, "读音匹配"))
        # 写 false：配了模型也只进默认频道
        self.assertIsNone(self.build(self.write('guild = "7"\nauto_channel = false\n'
                                                '[discord.router]\nurl = "http://l"\nmodel = "m"\n')).router)
        # 开着但没 token：列不了频道，只进默认
        self.assertIsNone(self.build(self.write('guild = "7"\nauto_channel = true\n'), {"RH_DISCORD_WEBHOOK": "http://x"}).router)

    def test_bad(self):
        for bad in ('auto_channel = true', 'guild = "7"\nauto_channel = "yes"',
                    'guild = "7"\n[discord.router]\nbackend = "gpt"', 'guild = "7"\n[discord.router]\nendpoint = "v1"',
                    'guild = "7"\n[discord.router]\naliases = ["量化"]', 'guild = "7"\n[discord.router]\naliases = {"x" = ["a"]}',
                    'guild = "7"\n[discord.router]\naliases = {"5" = "量化"}',
                    'guild = "7"\n[discord.router]\nbackend = "jev"\nurl = "http://j"\nmodel = "m"\nprefill = "x"'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.write(bad)


class Template(unittest.TestCase):
    def test_router_block_uncommented_parses(self):
        """照模板去掉 [discord.router] 那段的 #（再打开 guild、auto_channel）就能加载；backend 换成 jev 也行。"""
        import re
        text = (ROOT / "roles.example.toml").read_text()
        a = text.index("# [discord.router]")
        b = text.index("\n\n", a)
        block = "\n".join(re.sub(r"^# ((?:\[discord\.router\])|(?:\w+ = .*))$", r"\1", ln)
                         for ln in text[a:b].splitlines())
        text = text[:a] + block + text[b:]
        text = text.replace('# guild = "000000000000000000"', 'guild = "000000000000000000"')
        d = Path(tempfile.mkdtemp())
        (d / "roles.toml").write_text(text)
        c = cfgmod.load(d / "roles.toml")
        st = c.discord
        self.assertTrue(st.auto)
        self.assertEqual((st.router_backend, st.router.url, st.router_endpoint), ("llm", "http://127.0.0.1:1234/v1", "/v1/systemone"))
        self.assertEqual(st.channel_aliases, {"000000000000000004": ["量化", "模拟盘"]})
        (d / "roles.toml").write_text(text.replace('backend = "llm"', 'backend = "jev"').replace("prefill = ", "# prefill = "))
        self.assertEqual(cfgmod.load(d / "roles.toml").discord.router_backend, "jev")


def _load_jev_local():
    spec = importlib.util.spec_from_file_location("jev_local", ROOT / "tools" / "jev_local.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class JevLocal(unittest.TestCase):
    """tools/jev_local.py 的协议部分（不加载 mlx 模型：假 scorer）。"""

    def test_answer(self):
        jl = _load_jev_local()
        prepared = []

        class Sc:
            def __init__(self, choice, probs):
                self.choice, self.probs = choice, probs

        class Task:
            def score(self, text):
                self.text = text
                return Sc(2, [0.1, 0.1, 0.8])

        class Scorer:
            def prepare(self, prefix, options, prefill):
                prepared.append((prefix, options, prefill))
                return Task()
        tasks = jl.Tasks(Scorer())
        req = {"state": "主人说：「量化」", "model": "x", "questions": {"channel": {
            "type": "choice", "instructions": "选频道", "criteria": {"A": "原地", "B": "新建", "C": "#量化团队"}}}}
        out = jl.answer(req, tasks)
        self.assertEqual(out["answers"]["channel"]["choice"], "C")
        self.assertEqual(out["answers"]["channel"]["probabilities"], {"A": 0.1, "B": 0.1, "C": 0.8})
        jl.answer(req, tasks)
        self.assertEqual(len(prepared), 1)   # 前缀一样只 prepare 一次
        self.assertIn("C #量化团队", prepared[0][0])
        self.assertEqual(prepared[0][1:], (["A", "B", "C"], jl.PREFILL))
        with self.assertRaises(ValueError):
            jl.answer({"questions": {"q": {"type": "noul", "instructions": "x"}}}, tasks)
        # 主机的 JevClient 能直接读它的回复
        self.assertEqual(json.loads(json.dumps(out))["answers"]["channel"]["choice"], "C")


if __name__ == "__main__":
    unittest.main()
