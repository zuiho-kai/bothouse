---
name: feature-depth-im-discord
description: Discord 频道实现深读：_handle_discord_message 守卫与 CHAT_SEND 派发、DiscordChannelConfig 默认值、discord.py 可选导入、send() 静默返回与异常处理、文档手动验证（未执行）
metadata:
  scope: 只收 Discord 频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-discord
---
# Discord 频道：实现深读

## 现状

- [[feature-im-discord]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **消息回调契约** _handle_discord_message 处理完一条用户文本后构造 type="req"、req_method=ReqMethod.CHAT_SEND 的 Message：若 _on_message_cb 不为 None 则以其返回值接管投递（调用方需处理返回协程，代码用 asyncio.iscoroutine 检测并 await），否则默认走 self.bus.route_user_message(req)。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L190–L217](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L190-L217)
- **入站回调 _handle_discord_message：守卫（非 bot、is_allowed、guild/channel 过滤仅限服务器消息）通过后派发 req** 依次守卫 _running、作者非 bot、author_id 通过 is_allowed、channel 非空；服务器消息须匹配 guild_id/channel_id（配置空串不限制），DM 仅当 block_dm=True 时拒绝并加 🚫。
  - content 非空后加 👀，以 session_id=discord_{channel_id}_{author_id} 构造 CHAT_SEND 的 Message，经 _on_message_cb（未注册则 await bus.route_user_message）派发。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L142–L217](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L142-L217)
- **DiscordChannelConfig 默认 enabled=False、block_dm=False、allow_from=[]；guild_id/channel_id 空串不限制且不过滤 DM** dataclass 默认：enabled=False、bot_token/application_id/guild_id/channel_id 均为空串、block_dm=False、allow_from=[]。guild_id/channel_id 仅对服务器消息（guild_id 非空）生效，DM 不受二者限制，只在 block_dm=True 时被忽略并加 🚫；
  - 文档字段表默认值与代码一致。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L25–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L25-L33),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L163–L176](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L163-L176),
  - [docs/zh/海外频道.md:L143–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L143-L151)
- **discord.py 为 try-import 可选依赖：ImportError 时 start() 记录 "Discord SDK not installed. Run: pip install discord.py" 后直接返回** try 导入 discord 成功则 DISCORD_AVAILABLE=True；ImportError 时置 False 且 discord=None，模块仍可导入。start() 首个分支在 not DISCORD_AVAILABLE 时 logger.error 该消息并 return，不构造 client、不抛异常。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L16–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L16-L22),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L58–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L58-L61)
- **send()：客户端缺失/已关闭或空内容静默返回；缺目标频道、fetch 或发送异常记 warning 后返回** self._client 为 None 或 is_closed() 时直接 return，_extract_outgoing_text 为空同样 return，二者无日志(L117-122)；目标频道 id 为 None 记 'send skipped: missing target channel id' 后返回，fetch_channel 与 channel.send 异常各记 warning 后返回，不向调用方抛出(L124-140)。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L116–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L116-L140)
- **文档化手动验证：条件式预期 👀 反应与智能体回复（未执行）** 文档中的人工验收步骤（本轮未执行）：
- docs/zh/海外频道.md §8「验证」为手动流程：在已配置频道或私信发送一条短消息；若 Bot 在该场景有添加反应权限，用户消息上应出现 👀；模型与下游配置正确时，应收到智能体回复。该流程为既有文档记载，未执行。
- 来源：[docs/zh/海外频道.md:L285–L289](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L285-L289)
- **send 捕获普通 Exception 仅告警不重抛且返回 None 的取舍** 设计推断（非作者历史意图）：
- 客户端/内容/目标守卫通过后 await channel.send；fetch_channel 与 send 抛 Exception 时仅记 warning 后返回，不向调用方重抛，且 send 返回类型为 None。推断：收益是这些普通异常不沿此入口传播，代价是调用方不能凭正常返回确认投递成功；send 抛错也不证明消息未送达。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L116–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py#L116-L140)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-discord.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L190-L217
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L142-L217
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L25-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L163-L176；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/海外频道.md:L143-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L16-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L58-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py:L116-L140；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/海外频道.md:L285-L289
- 源页字段（feature）：im-discord
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/discord/discord_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/discord/*
