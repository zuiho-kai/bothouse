"""板子的话按意思进哪个频道、新建频道、按频道建 webhook、朗读摘要（rh/discord_route.py + rh/discord_body.py）。
真 hub + 真 host + 假小智板子 + 本机假 Discord（REST + webhook）+ 假模型，不出声、不碰真 Discord、不建真频道。

覆盖：
- 选频道：假模型选现有频道 → 那个频道没 webhook 就建一个、ID 写进放行文件、这句发进那个频道；回复按 (bot, 频道) 对账；
  选默认 → 用配好的默认 webhook；选新建 → 调建频道接口（名字从这句话取）再发进去，下一句不粘在新频道；
  create_channels 关着 → 进默认频道；模型出错 / 答非选项 → 默认频道；同一频道第二次不再建 webhook，存的文件 0600。
- 摘要：只念摘要不念全文；模型失败退第一句；短的原样念；频道里的文字不动（不往 Discord 发编辑）；
  没在等的回复（不是回主人的话）不做摘要。
- ChatLLM：OpenAI 兼容请求体（模型名、预填、key）。
- 配置：roles.example.toml 能加载、按模板最少配置只进默认频道；缺可选项退回现状（只进默认频道、念全文）；
  relay 开着又没 webhook 没 token 报错；[discord] 写错的键报错。
- 候选频道：exclude_channels 和 bot 看不到 / 不能发言的频道不进候选；新建前找同名频道复用、同时只建一个。
- 放行文件：先写放行再存、末尾补换行、写不进去不用这个 webhook、启动对账补上缺的 ID。
"""
from __future__ import annotations

import asyncio
import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

import aiohttp
from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import config as cfgmod
from rh import discord_body as dbody
from rh import discord_route as route
from rh.config import DiscordSettings, LLMEndpoint
from tests.test_discord_body import BOT_A, CHANNEL
from tests.test_discord_relay import WORDS, RelayBase
from tests.test_hub import wait_for
from tests.test_xiaozhi import DEV_A

GUILD = "777"
QUANT, XOPS, QLOG, HIDDEN = "500", "600", "700", "800"
ROLE_BOT = "55"
CHANNELS = [{"id": CHANNEL, "name": "创业", "type": 0, "position": 0, "topic": "角色小家"},
            {"id": QUANT, "name": "量化团队", "type": 0, "position": 1, "topic": "量化交易团队"},
            {"id": "501", "name": "一个分类", "type": 4, "position": 2},
            {"id": XOPS, "name": "x-运营", "type": 0, "position": 3},
            {"id": QLOG, "name": "量化日志", "type": 0, "position": 4, "topic": "量化团队的机器日志"},
            # bot 的身份组被拒看这个频道
            {"id": HIDDEN, "name": "私密", "type": 0, "position": 5,
             "permission_overwrites": [{"id": ROLE_BOT, "type": 0, "allow": "0", "deny": str(route.VIEW_CHANNEL)}]}]
# @everyone（ID = 服务器 ID）能看能说；bot 身份组没有额外权限
ROLES = [{"id": GUILD, "permissions": str(route.VIEW_CHANNEL | route.SEND_MESSAGES)}, {"id": ROLE_BOT, "permissions": "0"}]


class FakeDiscord:
    """本机假 Discord：列频道、建频道、建 webhook、执行 webhook。记下每个请求（方法、路径、正文）。"""

    def __init__(self):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.channels = [dict(c) for c in CHANNELS]
        self.next_id = 900
        self.create_delay = 0.0

    async def _any(self, req: web.Request):
        body = await req.json() if req.can_read_body else None
        path = req.path.removeprefix("/api/v10")
        self.calls.append((req.method, path, body))
        if not path.startswith("/webhooks/") and req.headers.get("Authorization") != "Bot tok":
            return web.Response(status=401)
        if req.method == "GET" and path == f"/guilds/{GUILD}/channels":
            return web.json_response(self.channels)
        if req.method == "GET" and path == f"/guilds/{GUILD}/roles":
            return web.json_response(ROLES)
        if req.method == "GET" and path.startswith(f"/guilds/{GUILD}/members/"):
            return web.json_response({"roles": [ROLE_BOT]})
        if req.method == "POST" and path == f"/guilds/{GUILD}/channels":
            self.next_id += 1
            c = {"id": str(self.next_id), "name": body["name"], "type": body["type"], "position": 9}
            self.channels.append(c)
            return web.json_response(c)
        if req.method == "POST" and path == f"/guilds/{GUILD}/channels" and self.create_delay:
            await asyncio.sleep(self.create_delay)
        if req.method == "POST" and path.startswith("/channels/") and path.endswith("/webhooks"):
            self.next_id += 1
            return web.json_response({"id": str(self.next_id), "token": f"wtok{self.next_id}", "name": body["name"]})
        if req.method == "POST" and path.startswith("/webhooks/"):
            if req.query.get("wait") == "true":   # 像 Discord 一样回这条消息
                self.next_id += 1
                return web.json_response({"id": str(self.next_id)})
            return web.Response(status=204)
        return web.Response(status=404)

    async def start(self):
        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", self._any)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/api/v10"
        return self

    async def close(self):
        await self.runner.cleanup()

    def posts_to(self, prefix: str) -> list[dict]:
        return [b for m, p, b in self.calls if m == "POST" and p.startswith(prefix)]

    def channel_lists(self) -> int:
        return len([c for c in self.calls if c[0] == "GET" and c[1] == f"/guilds/{GUILD}/channels"])

    def executed(self) -> list[tuple[str, dict]]:
        """执行 webhook 的请求：(webhook ID, 正文)。"""
        return [(p.split("/")[2], b) for m, p, b in self.calls if m == "POST" and p.startswith("/webhooks/")]


class FakeLLM:
    """假模型：按 system 提示词里是选频道、起名还是摘要，回脚本里的答案（可以是异常）。"""

    def __init__(self, route_answers=(), name="板子固件", summary="摘要：都好了。"):
        self.route_answers = list(route_answers)
        self.name, self.summary = name, summary
        self.calls: list[tuple[str, str]] = []
        self.systems: list[tuple[str, str]] = []

    def complete(self, system, user, max_tokens):
        kind = "route" if "只答一个字母" in system else "name" if "频道名" in system else "summary"
        self.calls.append((kind, user))
        self.systems.append((system, user))
        ans = {"route": lambda: self.route_answers.pop(0), "name": lambda: self.name,
               "summary": lambda: self.summary}[kind]()
        if isinstance(ans, Exception):
            raise ans
        return ans


class RouteBase(RelayBase):
    async def start_route(self, answers=(), create=True, summary_llm=None, default_webhook=True, exclude=(QLOG,), **kw):
        self.dc = await FakeDiscord().start()
        self.tmp = Path(tempfile.mkdtemp())
        self.settings = DiscordSettings(api=self.dc.base, guild=GUILD, webhooks_file=str(self.tmp / "hooks.json"),
                                        allow_bots_file=str(self.tmp / "allow.txt"), create_channels=create,
                                        exclude_channels=list(exclude))
        self.llm = FakeLLM(answers)
        api = route.DiscordAPI(self.dc.base, "tok", 5.0)
        default = f"{self.dc.base}/webhooks/100/defaulttok" if default_webhook else ""
        await self.start_body(relay=True, webhook=default, settings=self.settings, api=api,
                              router=route.Router(self.llm),
                              summarizer=route.Summarizer(summary_llm, self.settings.summary_chars, dbody.speakable), **kw)
        self.host.words = WORDS

    async def ask(self, text):
        n = sum("等她回" in s for s in self.log)
        await self.heard(text)
        await wait_for(lambda: sum("等她回" in s for s in self.log) > n or any("没发出去" in s for s in self.log),
                       what="发出去")

    async def asyncTearDown(self):
        if hasattr(self, "dc"):
            await self.dc.close()
        await super().asyncTearDown()


class Routing(RouteBase):
    async def test_existing_channel_gets_webhook_and_reply_matched_by_channel(self):
        await self.start_route(["C"])   # A 默认、B 新建、C = 第一个非默认文字频道（量化团队）
        a = await self.board(DEV_A)
        await self.ask("小橘，帮我看看我那个量化那边跑怎么样了")
        self.assertEqual(self.dc.posts_to(f"/channels/{QUANT}/webhooks"), [{"name": "板子"}])
        (wid, body), = self.dc.executed()
        self.assertNotEqual(wid, "100")   # 不是默认频道的 webhook
        self.assertEqual(body["username"], "板子")
        self.assertTrue(body["content"].startswith(f"<@{BOT_A}> "))
        self.assertEqual(body["allowed_mentions"]["users"], [BOT_A])   # 只 @ 被叫到的 bot
        self.assertEqual((self.tmp / "allow.txt").read_text(), f"{wid}\n")   # 放行名单只多了主机建的这个 ID
        saved = json.loads((self.tmp / "hooks.json").read_text())
        self.assertEqual(saved[QUANT]["id"], wid)
        self.assertEqual(stat.S_IMODE(os.stat(self.tmp / "hooks.json").st_mode), 0o600)
        self.assertEqual(self.body.waiting(), {(BOT_A, QUANT)})
        # 回复对账按频道：默认频道里她的话不算，量化频道里的才念
        self.assertEqual(await self.hook("pa", "默认频道的别的话。"), "not_waiting")
        self.assertEqual(await self.hook("pa", "跑完了。", session_key=f"discord:{QUANT}"), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完")
        self.assertFalse(any("wtok" in s for s in self.log))   # webhook token 不进日志
        # 选频道的提示词里有频道名和说明，分类不算
        prompt = [u for k, u in self.llm.calls if k == "route"]
        self.assertEqual(prompt, ["主人说：「小橘，帮我看看我那个量化那边跑怎么样了」"])

    async def test_second_time_reuses_webhook(self):
        await self.start_route(["C", "C"])
        await self.ask("小橘，量化今天怎么样")
        await self.ask("小橘，量化亏了多少")
        self.assertEqual(len(self.dc.posts_to(f"/channels/{QUANT}/webhooks")), 1)
        self.assertEqual(len({w for w, _ in self.dc.executed()}), 1)
        self.assertEqual(len(self.dc.executed()), 2)
        self.assertEqual(self.dc.channel_lists(), 1)   # 频道列表有缓存

    async def test_default_uses_configured_webhook(self):
        await self.start_route(["A"])
        await self.ask("小橘你好呀")
        self.assertEqual([w for w, _ in self.dc.executed()], ["100"])
        self.assertEqual(self.dc.posts_to("/channels/"), [])
        self.assertFalse((self.tmp / "allow.txt").exists())
        self.assertEqual(self.body.waiting(), {(BOT_A, CHANNEL)})

    async def test_model_error_or_bad_answer_goes_default(self):
        await self.start_route([RuntimeError("down"), "zz"])
        await self.ask("小橘，帮我看看")
        await self.ask("小橘，再看看")
        self.assertEqual([w for w, _ in self.dc.executed()], ["100", "100"])
        self.assertTrue(any("出错 RuntimeError" in s for s in self.log))
        self.assertTrue(any("答的不是选项" in s for s in self.log))

    async def test_new_channel_created_then_not_sticky(self):
        await self.start_route(["B", "A"])
        await self.ask("小橘，新建一个频道专门做板子固件")
        made = self.dc.posts_to(f"/guilds/{GUILD}/channels")
        self.assertEqual(made, [{"name": "板子固件", "type": 0}])
        new_id = self.dc.channels[-1]["id"]
        self.assertEqual(len(self.dc.posts_to(f"/channels/{new_id}/webhooks")), 1)
        (wid, body), = self.dc.executed()
        self.assertTrue(body["content"].endswith("小橘，新建一个频道专门做板子固件"))
        self.assertEqual(self.body.waiting(), {(BOT_A, new_id)})
        self.assertIn(wid, (self.tmp / "allow.txt").read_text().split())
        # 下一句照常按意思选（这次模型答 A），不粘在新频道（审稿第 2 条）
        await self.ask("小橘，今天天气怎么样")
        self.assertEqual(self.dc.executed()[-1][0], "100")
        # 建之前强制刷新了一次列表（找同名）；新频道进了缓存：第二次选频道没再列
        self.assertEqual(self.dc.channel_lists(), 2)

    async def test_new_but_create_off_goes_default(self):
        await self.start_route(["B"], create=False)
        await self.ask("小橘，新开一个频道")
        self.assertEqual(self.dc.posts_to(f"/guilds/{GUILD}/channels"), [])
        self.assertEqual([w for w, _ in self.dc.executed()], ["100"])

    async def test_default_without_configured_webhook_is_created(self):
        await self.start_route(["A"], default_webhook=False)
        await self.ask("小橘你好")
        self.assertEqual(len(self.dc.posts_to(f"/channels/{CHANNEL}/webhooks")), 1)
        self.assertEqual(self.body.waiting(), {(BOT_A, CHANNEL)})

    async def test_candidates_skip_excluded_and_invisible(self):
        """日志子频道（exclude_channels）、bot 看不到的频道不进候选（审查建议 2）。"""
        await self.start_route(["A"])
        await self.ask("小橘，看看量化那边")
        prompt = next(system for system, _ in self.llm.systems if "只答一个字母" in system)
        self.assertIn("#量化团队", prompt)
        self.assertNotIn("量化日志", prompt)
        self.assertNotIn("私密", prompt)
        self.assertIn("#x-运营", prompt)

    async def test_new_channel_same_name_reused(self):
        """已有同名频道（上次建频道超时其实建成了、别人建过）：直接用，不再建（审查建议 5）。"""
        await self.start_route(["B"])
        self.dc.channels.append({"id": "950", "name": "板子固件", "type": 0, "position": 9})   # 缓存里还没有
        await self.ask("小橘，新开个频道专门做板子固件")
        self.assertEqual(self.dc.posts_to(f"/guilds/{GUILD}/channels"), [])
        self.assertEqual(self.body.waiting(), {(BOT_A, "950")})
        self.assertTrue(any("已有同名频道" in s for s in self.log))

    async def test_two_new_channel_requests_create_once(self):
        """同一句被语音触发两次，两个都判出新建：只建一个，第二句进同一个频道。"""
        await self.start_route(["B", "B"])
        self.dc.create_delay = 0.3
        n = sum("等她回" in s for s in self.log)
        await asyncio.gather(self.heard("小橘，新开个频道专门做板子固件"), self.heard("小橘，新开个频道专门做板子固件"))
        await wait_for(lambda: sum("等她回" in s for s in self.log) >= n + 2, what="两句都发出去")
        self.assertEqual(len(self.dc.posts_to(f"/guilds/{GUILD}/channels")), 1)
        new_id = self.dc.channels[-1]["id"]
        self.assertEqual({c for _, c in self.body.waiting()}, {new_id})
        self.assertEqual(len(self.dc.posts_to(f"/channels/{new_id}/webhooks")), 1)


class Summary(RouteBase):
    LONG = ("好，查完了。量化那边今天的回放跑完了，第三条线年化 18%，回撤 31%，比基线差。"
            "我已经把结果写进 NEXT.md，并且在 QUEUE.md 里标成已证伪。下一步明天跑第四条。")

    async def reply(self, summary_llm, text=LONG):
        await self.start_route(["A"], summary_llm=summary_llm)
        a = await self.board(DEV_A)
        await self.ask("小橘，量化怎么样")
        n = len(self.dc.calls)
        self.assertEqual(await self.hook("pa", text), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完")
        self.assertEqual(len(self.dc.calls), n)   # 频道里的文字不动：没往 Discord 发任何东西
        return a.jsons(type="tts", state="sentence_start")[0]["text"]

    async def test_speaks_summary_not_full_text(self):
        raw = "**量化**回放跑完了，这条线不行，明天跑下一条。"
        llm = FakeLLM(summary=raw)
        said = await self.reply(llm)
        self.assertEqual(said, dbody.speakable(raw))   # 摘要里的记号也去掉
        self.assertNotIn("*", said)
        self.assertEqual([(t, v) for t, v in self.synth.calls], [(said, "va")])
        self.assertEqual([u for k, u in llm.calls if k == "summary"], [self.LONG])

    async def test_failure_falls_back_to_first_sentence(self):
        said = await self.reply(FakeLLM(summary=TimeoutError("slow")))
        self.assertEqual(said, "好，查完了。")
        self.assertTrue(any("第一句（TimeoutError）" in s for s in self.log))

    async def test_no_model_full_text(self):
        """没配摘要模型 = 念全文（和没有摘要功能时一样，审查建议 4）。"""
        await self.reply(None)
        self.assertEqual("".join(t for t, _ in self.synth.calls), dbody.speakable(self.LONG))   # 合成按句切

    async def test_short_reply_as_is(self):
        llm = FakeLLM(summary="不该用")
        self.assertEqual(await self.reply(llm, "跑完了，挺好。"), "跑完了，挺好。")
        self.assertEqual([k for k, _ in llm.calls if k == "summary"], [])

    async def test_not_waiting_not_summarized(self):
        llm = FakeLLM(summary="不该用")
        await self.start_route(["A"], summary_llm=llm)
        await self.board(DEV_A)
        self.assertEqual(await self.hook("pa", self.LONG), "not_waiting")   # 她在群里和别人说的
        await asyncio.sleep(0.2)
        self.assertEqual([k for k, _ in llm.calls if k == "summary"], [])


class Units(unittest.TestCase):
    def test_router_options_and_name(self):
        r = route.Router(FakeLLM())
        chans = [{"id": CHANNEL, "name": "创业", "topic": ""}, {"id": QUANT, "name": "量化团队", "topic": "量化\n交易"}]
        opts, keys = r.options(chans, CHANNEL)
        self.assertEqual(keys, [route.DEFAULT, route.NEW, QUANT])
        self.assertIn("（#创业）", opts)
        self.assertIn("C #量化团队：量化 交易", opts)
        self.assertEqual(route.Router(FakeLLM(name="「出海 研究」频道")).name("x"), "出海-研究")
        self.assertEqual(route.Router(FakeLLM(name=RuntimeError())).name("再开一个频道吧，专门聊招聘"), "招聘")
        self.assertEqual(route.Router(FakeLLM(name="")).name("开个频道"), route.NAME_FALLBACK)

    def test_first_sentence(self):
        self.assertEqual(route.first_sentence("第一句。第二句。"), "第一句。")
        self.assertEqual(route.first_sentence("没有句号"), "没有句号")

    def test_read_key(self):
        d = Path(tempfile.mkdtemp())
        (d / "k.json").write_text('{"api_key": "j"}')
        (d / "k.txt").write_text("plain\n")
        self.assertEqual(route.read_key({"K": "e"}, LLMEndpoint(key_env="K", key_file=str(d / "k.json"))), "e")
        self.assertEqual(route.read_key({}, LLMEndpoint(key_env="K", key_file=str(d / "k.json"))), "j")
        self.assertEqual(route.read_key({}, LLMEndpoint(key_file=str(d / "k.txt"))), "plain")
        self.assertEqual(route.read_key({}, LLMEndpoint(key_file=str(d / "none"))), "")


class Store(unittest.TestCase):
    """放行文件（审查建议 3）。"""

    def test_newline_added_when_user_edited(self):
        d = Path(tempfile.mkdtemp())
        (d / "allow.txt").write_text("111")   # 用户手改过，末尾没换行
        st = route.WebhookStore(str(d / "hooks.json"), str(d / "allow.txt"))
        st.add("c1", "222", "http://x/webhooks/222/t")
        self.assertEqual((d / "allow.txt").read_text().split("\n"), ["111", "222", ""])

    def test_allow_failure_stores_nothing(self):
        d = Path(tempfile.mkdtemp())
        (d / "allow.txt").mkdir()   # 写不进去
        st = route.WebhookStore(str(d / "hooks.json"), str(d / "allow.txt"))
        with self.assertRaises(OSError):
            st.add("c1", "222", "http://x/webhooks/222/t")
        self.assertEqual(st.url("c1"), "")
        self.assertFalse((d / "hooks.json").exists())

    def test_reconcile_adds_missing(self):
        d = Path(tempfile.mkdtemp())
        st = route.WebhookStore(str(d / "hooks.json"), "")
        st.add("c1", "222", "u1")
        st.add("c2", "333", "u2")
        (d / "allow.txt").write_text("222\n")
        st2 = route.WebhookStore(str(d / "hooks.json"), str(d / "allow.txt"))
        self.assertEqual(st2.reconcile(), ["333"])
        self.assertEqual(st2.reconcile(), [])
        self.assertEqual((d / "allow.txt").read_text(), "222\n333\n")


class Perms(unittest.TestCase):
    def test_can_post(self):
        V, S = route.VIEW_CHANNEL, route.SEND_MESSAGES
        roles = {GUILD: V | S, "r1": 0, "adm": route.ADMINISTRATOR}
        plain = {"id": "1"}
        self.assertTrue(route.can_post(plain, GUILD, roles, ["r1"], "u"))
        deny_everyone = {"id": "2", "overwrites": [{"id": GUILD, "allow": "0", "deny": str(V)}]}
        self.assertFalse(route.can_post(deny_everyone, GUILD, roles, ["r1"], "u"))
        role_allows = {"id": "3", "overwrites": [{"id": GUILD, "allow": "0", "deny": str(V)},
                                                 {"id": "r1", "allow": str(V), "deny": "0"}]}
        self.assertTrue(route.can_post(role_allows, GUILD, roles, ["r1"], "u"))
        member_denies_send = {"id": "4", "overwrites": [{"id": "u", "allow": "0", "deny": str(S)}]}
        self.assertFalse(route.can_post(member_denies_send, GUILD, roles, ["r1"], "u"))
        self.assertTrue(route.can_post(deny_everyone, GUILD, roles, ["adm"], "u"))   # 管理员不受覆盖影响


class ChatLLMHTTP(unittest.IsolatedAsyncioTestCase):
    async def test_openai_compatible_request(self):
        got = []

        async def chat(req):
            got.append((req.headers.get("Authorization"), await req.json()))
            return web.json_response({"choices": [{"message": {"role": "assistant", "content": " C\n"}}]})
        app = web.Application()
        app.router.add_post("/v1/chat/completions", chat)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        try:
            url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/v1"
            llm = route.ChatLLM(LLMEndpoint(url=url, model="m", prefill="<think></think>"), key="sk")
            out = await asyncio.get_running_loop().run_in_executor(None, llm.complete, "sys", "user", 4)
        finally:
            await runner.cleanup()
        self.assertEqual(out, "C")
        auth, body = got[0]
        self.assertEqual(auth, "Bearer sk")
        self.assertEqual(body["model"], "m")
        self.assertEqual(body["max_tokens"], 4)
        self.assertEqual([m["role"] for m in body["messages"]], ["system", "user", "assistant"])
        self.assertEqual(body["messages"][2]["content"], "<think></think>")


class ConfigCheck(unittest.TestCase):
    def test_example_loads(self):
        c = cfgmod.load(ROOT / "roles.example.toml")
        st = c.discord
        # guild、router、summary 在模板里是注释掉的：照「最少配置」填完就是只进默认频道、念全文（审查建议 6）
        self.assertEqual(st.guild, "")
        self.assertEqual(st.username, "板子")
        self.assertEqual(st.router.url, "")
        self.assertEqual(st.summary.url, "")
        self.assertEqual(st.summary_chars, 40)
        self.assertFalse(st.create_channels)
        self.assertTrue(Path(st.webhooks_file).is_absolute())   # 相对 roles.toml 所在目录
        self.assertEqual(Path(st.allow_bots_file).parent, ROOT / "data")
        self.assertEqual(c.discord_bots[0].project, "bot-a")

    def test_example_minimal_only_default_channel(self):
        """按 docs「最少配置」打开模板（relay + 默认 webhook，甚至给了 token）：不列频道、不选频道，所有话进默认频道。"""
        c = cfgmod.load(ROOT / "roles.example.toml")
        c.discord_relay = True
        body = self.build(c, {"RH_DISCORD_WEBHOOK": "http://x/webhooks/1/t", "DISCORD_BOT_TOKEN": "tok"})
        try:
            self.assertIsNone(body.router)
            self.assertIsNone(body.channels)
            self.assertIsNone(body.summarizer.llm)
            self.assertEqual(asyncio.run(body._dest("小橘，帮我看看我那个量化那边跑怎么样了")),
                             (c.discord_channel, "默认频道"))
            self.assertEqual(asyncio.run(body._dest("小橘，新建一个频道专门做板子固件")), (c.discord_channel, "默认频道"))
            long = "第一句话就挺长的了，后面还有很多很多内容。" * 3
            self.assertEqual(body.summarizer.brief(long), (long, "full"))
        finally:
            body.close()

    def test_repo_config_loads(self):
        c = cfgmod.load(ROOT / "roles.toml")
        self.assertTrue(c.discord.router.url)
        # 本机 roles.toml 配了日志子频道不进候选；只查形状，不在仓库里写真实频道 ID
        self.assertTrue(c.discord.exclude_channels)
        self.assertTrue(all(x.isdigit() for x in c.discord.exclude_channels))
        self.assertEqual(c.discord.router.prefill, "<think>\n\n</think>\n\n")

    def write(self, discord: str) -> cfgmod.Config:
        f = Path(tempfile.mkdtemp()) / "roles.toml"
        f.write_text('[meeting]\nmax_turns_per_topic = 1\nchars_per_sec = 5.0\n[brain]\nmodel = "x"\ntimeout_sec = 1\n'
                     '[[roles]]\nid = "a"\nname = "A"\npersona = "p"\n' + discord)
        return cfgmod.load(f)

    def build(self, c, env):
        return dbody.build(c, env, boards=None, synth=None, lock=None, log=lambda s: None)

    def test_missing_optional_falls_back_to_today(self):
        c = self.write('[discord]\nrelay = true\nchannel = "42"\n[[discord.bots]]\nbot_id = "1"\nrole = "a"\n')
        self.assertEqual(c.discord.guild, "")
        self.assertEqual(c.discord.router.url, "")
        body = self.build(c, {"RH_DISCORD_WEBHOOK": "http://x/webhooks/1/t"})
        try:
            self.assertIsNone(body.router)
            self.assertIsNone(body.api)
            self.assertIsNone(body.channels)
            self.assertIsNone(body.summarizer.llm)   # 念全文
            self.assertEqual(body.summarizer.brief("第一句话就挺长的了，后面还有很多很多内容。" * 3)[1], "full")
            self.assertEqual(body.webhook, "http://x/webhooks/1/t")
        finally:
            body.close()
        with self.assertRaises(SystemExit):   # relay 开着，既没默认 webhook 也没 token
            self.build(c, {})

    def test_full_config_builds_router_and_summary(self):
        c = self.write('[discord]\nrelay = true\nchannel = "42"\nguild = "7"\ncreate_channels = true\n'
                       '[discord.router]\nurl = "http://r/v1"\nmodel = "m"\nkey_env = "K"\n'
                       '[discord.summary]\nurl = "http://s/v1"\nmodel = "n"\nchars = 30\n'
                       '[[discord.bots]]\nbot_id = "1"\nrole = "a"\n')
        body = self.build(c, {"DISCORD_BOT_TOKEN": "tok", "K": "k"})
        try:
            self.assertIsNotNone(body.router)
            self.assertEqual(body.router.llm.key, "k")
            self.assertEqual(body.summarizer.chars, 30)
            self.assertEqual(body.summarizer.llm.ep.model, "n")
            self.assertIsNotNone(body.channels)
        finally:
            body.close()
        # router 配了但没 token：不选频道（只进默认），有 webhook 照样能发
        body = self.build(c, {"RH_DISCORD_WEBHOOK": "http://x"})
        try:
            self.assertIsNone(body.router)
        finally:
            body.close()

    def test_token_file(self):
        d = Path(tempfile.mkdtemp())
        (d / "s.env").write_text("DISCORD_BOT_TOKEN=fromfile\n")
        c = self.write(f'[discord]\nrelay = true\nchannel = "42"\ntoken_file = "{d / "s.env"}"\n'
                       '[[discord.bots]]\nbot_id = "1"\nrole = "a"\n')
        body = self.build(c, {})
        try:
            self.assertEqual(body.api.token, "fromfile")
        finally:
            body.close()

    def test_bad_values(self):
        for bad in ('guild = "abc"', 'create_channels = "yes"', 'create_channels = true',
                    '[discord.router]\nurl = "http://x"', '[discord.router]\nurll = "x"',
                    '[discord.summary]\nchars = 0', 'create_channel = true', 'guild_id = "1"',
                    '[discord.router]\nexclude_channels = "1"', '[discord.router]\nexclude_channels = ["abc"]'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.write('[discord]\n' + bad + '\n')


if __name__ == "__main__":
    unittest.main()
