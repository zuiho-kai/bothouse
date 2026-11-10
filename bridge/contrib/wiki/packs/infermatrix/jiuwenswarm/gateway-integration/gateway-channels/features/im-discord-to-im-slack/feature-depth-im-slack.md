---
name: feature-depth-im-slack
description: Slack 频道实现深读：SlackChannel.start 生命周期契约、SlackChannelConfig 默认值与频道白名单、启动失败与事件去重、slack_bolt 可选导入、抑制 chat.delta 按 4000 分块、app_mention 去重单测（未执行）、CHAT_SEND 守卫
metadata:
  scope: 只收 Slack 频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-slack
---
# Slack 频道：实现深读

## 现状

- [[feature-im-slack]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **start 的生命周期契约与调用方义务** SlackChannel.start 要求调用方先装好 slack-bolt、设置 enabled=true 并提供非空 bot_token/app_token，任一不满足只记录日志后返回（不抛异常）。满足时创建 AsyncApp 注册 app_mention 与 message 两个事件处理器，用 AsyncSocketModeHandler.start_async() 建立连接；start_async 抛出的异常被记录后重新 raise，finally 中把 _running 置回 False。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L79–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L79-L112)
- **SlackChannelConfig 的默认值与生效条件** SlackChannelConfig 默认 enabled=False、bot_token/app_token 为空串、allow_from 与 allowed_channel_ids 为空列表、reply_in_thread=True。allowed_channel_ids 为空时非 DM 消息不做频道过滤，非空且非 DM 时要求 channel_id 在列表内，否则丢弃；reply_in_thread=True 时频道内回复统一挂在根线程 ts 上。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L40–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L40-L50),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L166–L251](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L166-L251)
- **启动失败与重复事件的行为** 缺 token 或 SDK 缺失时 start 只记日志、静默不启动；Socket Mode 连接失败会传播异常并把 _running 复位。运行中收到 subtype/bot 自身消息、未过 is_allowed 白名单、去重命中或剥离提及后文本为空的事件，均直接 return，不产生 Message。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L79–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L79-L112),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L166–L251](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L166-L251)
- **slack_bolt 为可选导入（缺失时频道不启动），routing 键为编译期耦合** AsyncApp/AsyncSocketModeHandler 以 try/except ImportError 导入并置 SLACK_AVAILABLE，缺失时 start() 记录 "Slack SDK not installed. Run: pip install slack-bolt" 后直接返回——模块仍可导入但频道不启动；模块另从 routing.keys/session_sharing 引入 SlackDeliveryTarget 与 RoutingTarget 作为投递寻址类型。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L19–L32](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L19-L32),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L79–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L79-L82)
- **抑制 chat.delta 仅发送按 4000 分块的最终文本：避免刷屏限流，放弃逐 Token 流式** 出站对 CHAT_DELTA 不产生 chat_postMessage 调用，最终文本按 _MAX_SLACK_TEXT_LENGTH=4000 分块（4100 字符拆成 4000+100 两次调用）；文档记载不发送逐 Token chat.delta 是为避免 Slack 频道刷屏和触发限流，代价是失去流式输出。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L35–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L35-L37),
  - [tests/unit_tests/channel/test_slack_channel.py:L181–L197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_slack_channel.py#L181-L197),
  - [docs/zh/海外频道.md:L349–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L349-L372)
- **asyncio 单测断言 app_mention 去重/会话与 socket 生命周期（本批未执行）** test_slack_channel.py 中 @pytest.mark.asyncio 用例实际调用 _handle_app_mention 两次并断言仅收到 1 条、session_id 为 slack_T1_C1_1710000000.000100；
  - lifecycle 用例 monkeypatch AsyncApp/AsyncSocketModeHandler 后断言 is_running、注册事件为 app_mention 与 message，stop 后 not is_running 且 closed。本批次未执行这些测试。
- 来源：[tests/unit_tests/channel/test_slack_channel.py:L43–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_slack_channel.py#L43-L56),
  - [tests/unit_tests/channel/test_slack_channel.py:L68–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_slack_channel.py#L68-L74),
  - [tests/unit_tests/channel/test_slack_channel.py:L266–L288](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_slack_channel.py#L266-L288)
- **守卫（含条件频道白名单）与去重通过后才构造 CHAT_SEND；回调存在才调用** 未运行、event/body 非字典、subtype/bot_id/bot_profile 任一为真值、缺用户/频道或用户不被允许即返回；非 DM 仅当 allowed_channel_ids 非空才校验频道。event_id 非空且已见过、或清洗后文本为空亦返回。之后 DM 按用户、非 DM 按线程组 session_id 构造 CHAT_SEND Message；回调存在才调用，结果为 coroutine 才 await。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L166–L249](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py#L166-L249)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-slack.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L79-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L40-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L166-L251
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L19-L32
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L79-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L35-L37；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_slack_channel.py:L181-L197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/海外频道.md:L349-L372；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_slack_channel.py:L43-L56
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_slack_channel.py:L68-L74；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_slack_channel.py:L266-L288
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py:L166-L249
- 源页字段（feature）：im-slack
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/slack/slack_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/slack/*
