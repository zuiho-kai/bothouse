"""角色小家第一幕① 事件通道（rh/discord_body.py on_agent_event、rh/host.py agent_event、rh/dial.py hold）。

用户原话：「我现在基本不在电脑前面了」；派活要求：Discord 里某个角色（cc-connect 驱动）这一轮出错、一轮做完、等用户批准时，
角色小家这边能知道——出错 / 等批准：一句短话在该角色的板子上念、表盘切到现有状态之一；做完：表盘回空闲、不念。
网页复用 hub 现有消息列表（系统消息），不另做界面。

2026-10-20 大厅刷屏修复，用户原话：「你这什么狗屎，你是怎么验收过的，这叫对齐么」（每个 bot 回一句就往大厅塞一条「做完了」）。
派活要求（对齐 Discord，Discord 上没有这种刷屏）：做完不往 hub 发任何消息，只回空闲、清状态；出错只在真正需要人管时发一条——
cc-connect 自己在重试的（容量 at capacity、prompt is too long 换新会话重试）不发，同一 bot 同一轮只发一条，
文案短且人话（「鲸鱼娘那边出错了，没回上话」），原始报错不进正文；等批准保留。

cc-connect 钩子（~/code/cc-connect maomao 分支 core/hooks.go:20-30）：error、permission.requested、message.sent，
载荷 {event, timestamp, project, session_key, platform, content, error, extra}（core/hooks.go HookEvent）。
真 hub + 真 host + 假小智板子 + 假合成，不出声。
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rh import discord_body as dbody
from tests.test_discord_body import BOT_A, DiscordBase
from tests.test_hub import wait_for
from tests.test_xiaozhi import DEV_A

OTHER = "discord:424242"   # 板子没往这个频道说过话：和「念回板子那句」无关，事件照样要报


class EventBase(DiscordBase):
    async def event(self, event, project="pa", content="", error="", extra=None, session_key=OTHER):
        body = {"event": event, "timestamp": "2026-10-20T20:00:00+08:00", "project": project,
                "session_key": session_key, "platform": "discord", "content": content}
        if error:
            body["error"] = error
        if extra is not None:
            body["extra"] = extra
        async with aiohttp.ClientSession() as s:
            async with s.post(f"http://127.0.0.1:{self.xz.port}{dbody.HOOK_PATH}", json=body) as r:
                self.assertEqual(r.status, 200)
                return (await r.json())["result"]

    def system_texts(self):
        return [m["text"] for m in self.rows(author_kind="system")]

    def dial_states(self, board):
        return [d["state"] for d in board.jsons(type="rh_dial") if "state" in d]


class Error(EventBase):
    async def test_error_spoken_listed_dial_red(self):
        """出错：板子念一句短话（角色 a 的音色）、网页列表多一条、表盘停在 interrupted（红圈）。"""
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        self.assertEqual(await self.event("error", error="agent process exited"), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完出错那句")
        said = a.jsons(type="tts", state="sentence_start")[0]["text"]
        self.assertIn("出错", said)
        self.assertEqual([v for _, v in self.synth.calls], ["va"])
        self.assertEqual(self.local.played, [])   # 不走 Mac 喇叭
        await wait_for(lambda: self.system_texts() == ["A那边出错了，没回上话"], what="网页列表出现一条人话出错")
        self.assertNotIn("agent process exited", said)   # 原始报错不进正文、不念
        await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="表盘停在红圈")
        await asyncio.sleep(3.0)   # 不是 2.5 秒一闪：等到下一个事件才变
        self.assertEqual(self.dial_states(a)[-1], "interrupted")


class Permission(EventBase):
    async def test_permission_spoken_listed_dial_thinking(self):
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        # 正文同 cc-connect core/i18n.go MsgPermissionPrompt（中文），要批准的操作在代码块里
        prompt = "⚠️ **权限请求**\n\nAgent 想要使用 **Bash**:\n\n```\nrm -rf build\n```\n\n回复 **允许** / **拒绝** / **允许所有**（本次会话不再提醒）。"
        got = await self.event("permission.requested", content=prompt, extra={"tool_name": "Bash"})
        self.assertEqual(got, "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完等批准那句")
        said = a.jsons(type="tts", state="sentence_start")[0]["text"]
        self.assertIn("批准", said)
        await wait_for(lambda: any("批准" in t and "Bash" in t and "rm -rf build" in t for t in self.system_texts()),
                       what="网页列表出现等批准事件（带要批准的操作）")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["thinking"], what="表盘停在思考中")


class Done(EventBase):
    async def test_done_not_listed_idle_not_spoken(self):
        """做完：不往网页发任何消息（大厅刷屏修复）、表盘回空闲、不念。"""
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        await self.event("permission.requested", content="Tool: Bash", extra={"tool_name": "Bash"})
        await wait_for(lambda: self.dial_states(a)[-1:] == ["thinking"], what="表盘思考中")
        n_tts = len(a.jsons(type="tts", state="start"))
        # 别的频道的回复：和板子无关（on_sent 照旧 other_channel），但「做完」照样报
        self.assertEqual(await self.event("message.sent", content="做好了，测试全绿。"), "other_channel")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="表盘回空闲")
        await asyncio.sleep(0.5)
        self.assertEqual([t for t in self.system_texts() if "批准" not in t], [])   # 做完不进大厅
        self.assertEqual(len(a.jsons(type="tts", state="start")), n_tts)   # 做完不念


class Rules(EventBase):
    async def test_play_off_listed_not_spoken(self):
        """半夜不出声（[discord] play 关）：网页照样列出，板子不念、连合成都不做。"""
        await self.start_body(play=False)
        a = await self.board(DEV_A)
        self.assertEqual(await self.event("error", error="boom"), "off")
        await wait_for(lambda: any("出错" in t for t in self.system_texts()), what="网页列表出现")
        await asyncio.sleep(0.3)
        self.assertEqual(a.jsons(type="tts"), [])
        self.assertEqual(self.synth.calls, [])

    async def test_unmapped_project_ignored(self):
        await self.start_body(play=True)
        self.assertEqual(await self.event("error", project="nobody", error="boom"), "unmapped")
        await asyncio.sleep(0.3)
        self.assertEqual(self.system_texts(), [])

    async def test_event_does_not_break_reply_dedup(self):
        """钩子念过的回复，gate 那条路晚到仍判重复：中间插一条事件不能把去重记录冲掉。"""
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        self.assertEqual(self.body.submit(BOT_A, "今天挺好的。", source="hook"), "queued")
        self.assertEqual(await self.event("error", error="boom"), "queued")
        self.assertEqual(self.body.submit(BOT_A, "今天挺好的。", source="gate"), "dup")
        await wait_for(lambda: len(a.jsons(type="tts", state="stop")) >= 2, what="两句念完")


# ---------- 代码审查裁决（2026-10-20）后的补充 ----------
import json  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from rh.config import DiscordBot  # noqa: E402
from tests.test_discord_body import BOTS  # noqa: E402
from tests.test_discord_relay import RelayBase  # noqa: E402

BOT_A2 = DiscordBot("333", "botA2", "a", "pa2")   # 同一个角色 a 绑第二个 project（另一个 bot / 频道）


class HoldBase(EventBase):
    async def start_hold(self, bots=BOTS, **kw):
        """表盘读队友状态文件（rh/dial.py read_busy）：临时目录，不开轮询线程，测试里手动 refresh_busy。"""
        self.team = self.dir / "team"
        self.team.mkdir(exist_ok=True)
        await self.start_body(play=True, bots=bots, dial_kw={"bots": bots, "team_dir": self.team, "busy_poll": None}, **kw)

    async def busy(self, project, on):
        up = datetime.now(timezone.utc).isoformat()
        (self.team / f"{project}.json").write_text(json.dumps({"updated": up, "sessions": [{"busy": on}]}))
        await asyncio.get_running_loop().run_in_executor(None, self.host.dial.refresh_busy)

    def rows_with(self, word):
        return [t for t in self.system_texts() if word in t]


class Review1Clear(HoldBase):
    async def test_no_reply_after_permission_cleared_by_busy_to_idle(self):
        """等批准后这一轮静默结束（NO_REPLY，没有 message.sent）：忙变闲时清掉思考中。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        await self.busy("pa", True)
        await self.event("permission.requested", content="x", extra={"tool_name": "Bash"})
        await wait_for(lambda: self.dial_states(a)[-1:] == ["thinking"], what="表盘思考中")
        await self.busy("pa", False)
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="忙变闲后回待机")

    async def test_error_without_message_sent_cleared_by_next_turn(self):
        """出错后没有 message.sent：出错这一轮结束（忙变闲）红圈还留着，下一轮结束（再一次忙变闲）清掉。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        await self.busy("pa", True)
        await self.event("error", error="boom")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="红圈")
        await self.busy("pa", False)
        await asyncio.sleep(0.3)
        self.assertEqual(self.dial_states(a)[-1], "interrupted")
        await self.busy("pa", True)
        await self.busy("pa", False)
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="下一轮结束后回待机")

    async def test_agent_closed_clears(self):
        await self.start_hold()
        a = await self.board(DEV_A)
        await self.event("error", error="boom")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="红圈")
        n = len(self.system_texts())
        self.assertEqual(await self.event("agent.closed"), "cleared")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="会话关掉后回待机")
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.system_texts()), n)   # 会话关掉不进网页


class Review2Projects(HoldBase):
    async def test_other_project_does_not_clear_and_worst_wins(self):
        await self.start_hold(bots=BOTS + [BOT_A2])
        a = await self.board(DEV_A)
        await self.event("error", project="pa", error="boom")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="红圈")
        await self.event("permission.requested", project="pa2", content="x", extra={"tool_name": "Bash"})
        await asyncio.sleep(0.5)
        self.assertEqual(self.dial_states(a)[-1], "interrupted")   # 出错 > 等批准
        await self.event("message.sent", project="pa2", content="另一个频道做完了")
        await asyncio.sleep(0.3)
        self.assertEqual(self.dial_states(a)[-1], "interrupted")   # 别的 project 做完不清这个的出错
        await self.event("message.sent", project="pa", content="这个也做完了")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="都清掉后回待机")

    async def test_permission_held_while_other_project_done(self):
        await self.start_hold(bots=BOTS + [BOT_A2])
        a = await self.board(DEV_A)
        await self.event("permission.requested", project="pa", content="x", extra={"tool_name": "Bash"})
        await wait_for(lambda: self.dial_states(a)[-1:] == ["thinking"], what="思考中")
        await self.event("message.sent", project="pa2", content="别处做完")
        await asyncio.sleep(0.3)
        self.assertEqual(self.dial_states(a)[-1], "thinking")


class Review3Mute(EventBase):
    async def test_events_spoken_while_muted(self):
        """闭麦 = 不收音；Discord 回应照念（tests/test_discord_body.py 闭麦中照念），事件同样念。"""
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        await asyncio.get_running_loop().run_in_executor(None, self.host.on_voice, "闭麦")
        self.assertFalse(self.host.mic_on)
        self.assertEqual(await self.event("error", error="boom"), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="闭麦中照念")


class Review4Repeat(HoldBase):
    async def test_repeated_error_once_until_message_sent(self):
        await self.start_hold()
        a = await self.board(DEV_A)
        self.assertEqual(await self.event("error", error="capacity"), "queued")
        self.assertEqual(await self.event("error", error="capacity"), "repeat")
        self.assertEqual(await self.event("error", error="capacity again"), "repeat")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="念完")
        await asyncio.sleep(0.5)
        self.assertEqual(len(a.jsons(type="tts", state="start")), 1)
        self.assertEqual(len(self.rows_with("出错")), 1)
        await self.event("message.sent", content="好了")
        self.assertEqual(await self.event("error", error="new"), "queued")
        await wait_for(lambda: len(self.rows_with("出错")) == 2, what="做完之后的新出错照报")

    async def test_failing_turns_report_once_until_reply(self):
        """大厅刷屏修复：一轮接一轮都失败（线上鲸鱼娘 4 分钟连报 4 条 503/429，每轮结束忙变闲都把记号清了）：
        只报第一条；她真回上话（message.sent）或会话关掉后再出错才再报。"""
        await self.start_hold()
        await self.board(DEV_A)
        for i in range(3):
            await self.busy("pa", True)
            got = await self.event("error", error="unexpected status 503 Service Unavailable")
            self.assertEqual(got, "queued" if i == 0 else "repeat")
            await self.busy("pa", False)
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.rows_with("出错")), 1)
        await self.event("message.sent", content="好了")
        self.assertEqual(await self.event("error", error="e2"), "queued")


class Review5Null(EventBase):
    async def test_null_fields_no_none(self):
        await self.start_body(play=False)
        await self.board(DEV_A)
        body = {"event": "permission.requested", "project": "pa", "content": None, "error": None,
                "extra": {"tool_name": "Bash"}}
        for b in (body, {**body, "event": "error"}, {**body, "event": "message.sent", "session_key": None}):
            async with aiohttp.ClientSession() as s:
                async with s.post(f"http://127.0.0.1:{self.xz.port}{dbody.HOOK_PATH}", json=b) as r:
                    self.assertEqual(r.status, 200)
        await wait_for(lambda: len(self.system_texts()) == 2, what="两条")
        await asyncio.sleep(0.3)
        self.assertEqual(self.system_texts(), ["A在等你批准 Bash", "A那边出错了，没回上话"])   # 做完不进网页


class Review6Log(EventBase):
    async def test_log_says_event(self):
        await self.start_body(play=True)
        await self.board(DEV_A)
        await self.event("error", error="boom")
        await wait_for(lambda: any("排队" in s for s in self.log), what="排队日志")
        line = next(s for s in self.log if "排队" in s)
        self.assertIn("事件", line)
        self.assertNotIn("回应", line)


class ReviewMore(EventBase):
    async def test_board_offline_not_spoken_but_listed(self):
        await self.start_body(play=True)
        self.assertEqual(await self.event("error", error="boom"), "no_board")
        await wait_for(lambda: any("出错" in t for t in self.system_texts()), what="网页照列")
        await asyncio.sleep(0.3)
        self.assertEqual(self.synth.calls, [])
        self.assertEqual(self.local.played, [])   # 不退回 Mac 喇叭

    async def test_mac_speaker_silent_for_all_three(self):
        await self.start_body(play=True)
        a = await self.board(DEV_A)
        await self.event("permission.requested", content="x", extra={"tool_name": "Bash"})
        await self.event("error", error="boom")
        await self.event("message.sent", content="好了")
        await wait_for(lambda: len(a.jsons(type="tts", state="stop")) >= 2, what="两句念完")
        await wait_for(lambda: len(self.system_texts()) == 2, what="两条")
        self.assertEqual(self.local.played, [])


class ReplyAndDone(RelayBase):
    async def test_reply_to_board_spoken_and_done_listed(self):
        """message.sent 既是回板子那句（念出来）又是「做完」（表盘最后回待机；不进网页）。"""
        await self.start_relay()
        a = await self.board(DEV_A)
        n = sum("等她回" in s for s in self.log)
        await self.heard("小橘，今天怎么样")
        await wait_for(lambda: sum("等她回" in s for s in self.log) > n, what="等她回")
        mid = self.hook_srv.ids[-1]
        self.assertEqual(await self.hook("pa", "今天挺好的。", triggers=[mid]), "queued")
        await wait_for(lambda: a.jsons(type="tts", state="stop"), what="板子念完回复")
        self.assertEqual(a.jsons(type="tts", state="sentence_start")[0]["text"], "今天挺好的。")
        await wait_for(lambda: [d["state"] for d in a.jsons(type="rh_dial") if "state" in d][-1:] == ["idle"],
                       what="表盘回待机")
        await asyncio.sleep(0.3)
        self.assertFalse(any("做完" in m["text"] for m in self.rows(author_kind="system")))
        self.assertEqual(self.local.played, [])


class Review7EarlyError(HoldBase):
    async def test_error_before_busy_seen_kept_after_idle(self):
        """复审：轮询要晚几秒才看到「忙」；出错先于「看到忙」到达时，这一轮结束（忙变闲）红圈仍要留着。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        await self.busy("pa", False)   # 上一轮已结束（空闲）
        await self.event("error", error="capacity")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="红圈")
        await asyncio.sleep(0.05)
        await self.busy("pa", True)    # 轮询这时才看到忙
        await self.busy("pa", False)   # 这一轮结束
        await asyncio.sleep(0.3)
        self.assertEqual(self.dial_states(a)[-1], "interrupted")
        await self.busy("pa", True)    # 下一轮结束才清
        await self.busy("pa", False)
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="下一轮结束后回待机")


class NoSpam(HoldBase):
    """大厅刷屏修复（2026-10-20，见文件头用户原话）。"""

    async def test_many_done_post_nothing(self):
        await self.start_hold()
        a = await self.board(DEV_A)
        for i in range(5):
            await self.event("message.sent", content=f"第 {i} 句回复")
        await asyncio.sleep(0.5)
        self.assertEqual(self.system_texts(), [])
        self.assertEqual(a.jsons(type="tts"), [])

    async def test_capacity_retry_not_posted(self):
        """cc-connect 自己在重试（core/capacity_retry.go 容量重试、core/handoff.go 上下文太长换新会话）：不发、不念、表盘不变红。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        for err in ("Selected model is at capacity. Please try a different model.",
                    "API Error: prompt is too long: 210000 tokens > 200000 maximum"):
            self.assertEqual(await self.event("error", error=err), "retrying")
        await asyncio.sleep(0.5)
        self.assertEqual(self.system_texts(), [])
        self.assertEqual(a.jsons(type="tts"), [])
        self.assertNotIn("interrupted", self.dial_states(a))
        # 重试中的不占「这一轮已报过」：重试完真失败了照报一条
        self.assertEqual(await self.event("error", error="exceeded retry limit, last status: 429 Too Many Requests"), "queued")
        await wait_for(lambda: self.system_texts() == ["A那边出错了，没回上话"], what="真出错报一条")

    async def test_one_error_per_turn_human_text(self):
        await self.start_hold()
        await self.board(DEV_A)
        await self.busy("pa", True)
        for _ in range(3):
            await self.event("error", error="exceeded retry limit, last status: 429 Too Many Requests")
        await asyncio.sleep(0.5)
        self.assertEqual(self.system_texts(), ["A那边出错了，没回上话"])
        self.assertFalse(any("429" in t or "exceeded" in t for t in self.system_texts()))


class ReviewSpam2(HoldBase):
    """大厅刷屏修复的代码审查（2026-10-20）。用户原话：「你这什么狗屎，你是怎么验收过的，这叫对齐么」；
    要和 Discord 一致：不刷屏，出错时只说一句人话，或者不显示。"""

    async def test_three_failing_turns_dial_stays_red_one_post(self):
        """审查复现：连续 3 轮 503。只报一条、只念一句，但每一轮结束后表盘都还是红圈（repeat 也要 hold 表盘）；
        之后一轮正常结束（没出错）才回待机。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        for i in range(3):
            await self.busy("pa", True)
            got = await self.event("error", error="unexpected status 503 Service Unavailable")
            self.assertEqual(got, "queued" if i == 0 else "repeat")
            if i == 0:   # 念完那句（念的时候表盘是 speaking）
                await wait_for(lambda: a.jsons(type="tts", state="stop"), what="念完")
                await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="念完回红圈")
            await self.busy("pa", False)
            await asyncio.sleep(0.2)
            self.assertEqual(self.dial_states(a)[-1], "interrupted", f"第 {i + 1} 轮结束后表盘回空闲了")
        await asyncio.sleep(0.3)
        self.assertEqual(len(a.jsons(type="tts", state="start")), 1)
        self.assertEqual(self.system_texts(), ["A那边出错了，没回上话"])
        await self.busy("pa", True)    # 下一轮没出错、正常结束
        await self.busy("pa", False)
        await wait_for(lambda: self.dial_states(a)[-1:] == ["idle"], what="正常一轮结束后回待机")

    async def test_silent_reply_turn_clears_marker(self):
        """bot 静默回复（NO_REPLY，没有 message.sent）：这一轮没出错、正常结束，也清掉「出错已报」记号，下一次真出错照报。"""
        await self.start_hold()
        await self.board(DEV_A)
        await self.busy("pa", True)
        self.assertEqual(await self.event("error", error="503"), "queued")
        await self.busy("pa", False)
        await self.busy("pa", True)    # 静默回复的一轮：没有 message.sent，也没出错
        await self.busy("pa", False)
        await self.busy("pa", True)
        self.assertEqual(await self.event("error", error="503"), "queued")
        await self.busy("pa", False)
        await wait_for(lambda: len(self.rows_with("出错")) == 2, what="静默回复之后的新出错照报")

    async def test_marker_per_project(self):
        """一个角色绑两个 project：pa 这一轮出错，pa2 正常结束，不清 pa 的记号。"""
        await self.start_hold(bots=BOTS + [BOT_A2])
        await self.board(DEV_A)
        await self.busy("pa", True)
        self.assertEqual(await self.event("error", project="pa", error="503"), "queued")
        await self.busy("pa", False)
        await self.busy("pa", True)
        self.assertEqual(await self.event("error", project="pa", error="503"), "repeat")
        await self.busy("pa", False)
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.rows_with("出错")), 1)

    async def test_prompt_too_long_gave_up_reported(self):
        """cc-connect 上下文太长：第一次换新会话重跑（core/handoff.go retryFreshOnPromptTooLong），不报；
        新会话也太长时它不再重试、直接放弃（freshRetried）——钩子上就是紧接着第二条 prompt is too long，按普通出错报一句人话。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        err = "API Error: 400 prompt is too long: 1227574 tokens > 1048576 maximum"
        await self.busy("pa", True)
        self.assertEqual(await self.event("error", error=err), "retrying")
        self.assertEqual(await self.event("error", error=err), "queued")
        await self.busy("pa", False)
        await wait_for(lambda: self.system_texts() == ["A那边出错了，没回上话"], what="放弃后报一句人话")
        await wait_for(lambda: self.dial_states(a)[-1:] == ["interrupted"], what="红圈")
        self.assertFalse(any("prompt" in t for t in self.system_texts()))
        self.assertEqual(await self.event("error", error=err), "repeat")   # 之后再来也只报这一次

    async def test_prompt_too_long_retry_succeeded(self):
        """换新会话重跑成功（message.sent）或这一轮正常结束：下一次太长又是第一次，照旧不报。"""
        await self.start_hold()
        a = await self.board(DEV_A)
        err = "prompt is too long: 210000 tokens > 200000 maximum"
        self.assertEqual(await self.event("error", error=err), "retrying")
        await self.event("message.sent", content="好了")
        self.assertEqual(await self.event("error", error=err), "retrying")
        await self.busy("pa", True)
        await self.busy("pa", False)   # 太长那一轮结束
        await self.busy("pa", True)
        await self.busy("pa", False)   # 下一轮正常结束
        self.assertEqual(await self.event("error", error=err), "retrying")
        await asyncio.sleep(0.3)
        self.assertEqual(self.system_texts(), [])
        self.assertNotIn("interrupted", self.dial_states(a))
