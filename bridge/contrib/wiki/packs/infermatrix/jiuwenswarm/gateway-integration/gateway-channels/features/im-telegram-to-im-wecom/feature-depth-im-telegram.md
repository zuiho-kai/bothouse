---
name: feature-depth-im-telegram
description: Telegram 频道实现深读：配置默认值与启动门槛、_handle_message 群聊模式过滤与 telegram_{chat_id} 会话、send 的 chat_id 解析与 parse/entity 重试、python-telegram-bot 软依赖、session_id 不含 user_id 的取舍、三次 await 单测
metadata:
  scope: 只收 Telegram 频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-telegram
---
# Telegram 频道：实现深读

## 现状

- [[feature-im-telegram]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **配置默认值与启动门槛** TelegramChannelConfig 默认 enabled=False、bot_token 为空、allow_from=[]、parse_mode="Markdown"、group_chat_mode="mention"，与 docs/zh/海外频道.md 的配置表一致。enabled 与 bot_token 共同构成启动前置条件：start() 在 enabled=False 时打 warning 返回，在 bot_token 为空时打 error 返回。文档另说明 allow_from 为空列表时允许所有用户。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L39–L47](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L39-L47),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L92–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L92-L98),
  - [docs/zh/海外频道.md:L55–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L55-L61)
- **入站文本经 _handle_message 校验与群聊模式过滤后生成 telegram_{chat_id} 会话并下发** 文本更新进入 _handle_message：先校验 message/effective_user/effective_chat 与 is_allowed(str(user_id))，群聊按 group_chat_mode 分支（off 直接 return；mention 要求文本含 @{bot_username} 并移除该提及；reply 要求回复的是机器人消息），随后 set_reaction("👀")，
  - 以 f"telegram_{chat_id}" 生成 session_id 构造 Message，经 _on_message_cb（协程则 await）或 bus.route_user_message 下发。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L278–L394](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L278-L394)
- **send 按消息元数据或 telegram_ 前缀会话解析 chat_id，缺失即记告警并跳过** send(msg, *, routing_target=None) 返回 None：chat_id 先取 msg.metadata["chat_id"]，否则从 "telegram_" 前缀的 session_id 解析（int 失败返回 None）；chat_id 或 _extract_content 结果为空时仅 logger.warning 并跳过，不抛异常。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L157–L174](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L157-L174),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L208–L218](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L208-L218)
- **继承 BaseChannel 并软依赖 python-telegram-bot** TelegramChannel 声明继承 BaseChannel，__init__ 经 super() 复用基类的 config/bus 存储，start/stop 为基类抽象方法；python-telegram-bot 用 try 导入，失败时置 TELEGRAM_AVAILABLE=False，start() 记录 error 后直接返回、不启动。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L50–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L50-L68),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L21–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L21-L33),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L84–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L84-L90),
  - [jiuwenswarm/gateway/channel_manager/base.py:L129–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/base.py#L129-L153)
- **send(): 仅 parse/entity 类错误且 parse_mode 非空时重试一次；其余异常由 send() 外层 except 记日志** send() 内层 send_message 抛异常且 error_str 小写含 "parse" 或 "entity" 且 parse_mode 非空时，以 parse_mode=None 重发一次；否则重新 raise，被 send() 外层 except 记录 error 日志后正常返回。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L181–L203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L181-L203)
- **按 chat_id 确定性派生 session_id：省去映射缓存但不区分发送者（推断）** 设计推断（非作者历史意图）：
- 收益（推断）：session_id=f"telegram_{chat_id}" 就地派生，无需维护 chat→session 缓存，测试也断言 channel 无 _chat_sessions 属性；成本（推断）：该键只含 chat_id 不含 user_id，同一 chat 的不同发送者会得到相同 session_id。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L352–L371](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py#L352-L371),
  - [tests/unit_tests/channel/test_telegram_channel.py:L50–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_telegram_channel.py#L50-L58)
- **runtime 单测三次 await 真实 _handle_message，断言由 chat_id 派生 session_id 且无 _chat_sessions** test_telegram_channel.py 的 pytest.mark.asyncio 用例以 TelegramChannelConfig(enabled=True, group_chat_mode="all") 构造频道，用 _update()（SimpleNamespace 与 _FakeTelegramMessage）伪造 update，
  - 三次 await channel._handle_message 后断言 session_id 依次为 telegram_123456、telegram_-987654、telegram_123456，并断言 not hasattr(channel, "_chat_sessions")。
- 来源：[tests/unit_tests/channel/test_telegram_channel.py:L40–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_telegram_channel.py#L40-L58),
  - [tests/unit_tests/channel/test_telegram_channel.py:L18–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_telegram_channel.py#L18-L37)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-telegram.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L39-L47
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L92-L98；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/海外频道.md:L55-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L278-L394
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L157-L174
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L208-L218
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L50-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L21-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L84-L90；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/base.py:L129-L153
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L352-L371；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_telegram_channel.py:L50-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py:L181-L203；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_telegram_channel.py:L40-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_telegram_channel.py:L18-L37
- 源页字段（feature）：im-telegram
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/telegram/telegram_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/telegram/*
