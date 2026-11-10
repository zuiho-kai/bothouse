---
name: feature-depth-im-wechat
description: 微信频道实现深读：start 先加载凭据再进入轮询、start 幂等与上抛、发送策略模块常量 hard_max=10/content_part_limit=9/interval_sec=0.5、send 与 _send_message 的守卫、可重试 WechatSendMessageError 暂存、CHAT_TOOL_CALL 下发条件、扫码接入手动检查（未执行）
metadata:
  scope: 只收微信频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-wechat
---
# 微信 频道：实现深读

## 现状

- [[feature-im-wechat]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **启动链路：start 先加载凭据再进入轮询** WechatChannel.start 启动时先创建带 long_poll_timeout_sec+5 总超时的 aiohttp 会话，随后同步 await WechatChannel._load_or_login_credentials；后者按配置 bot_token → 本地凭据文件 → 扫码登录的顺序解析凭据，未配置且 auto_login=false 时抛 RuntimeError 使启动失败，成功后 start 才创建 _poll_loop 任务。
- 调用路径：`jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py`（`WechatChannel.start`） → `jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py`（`WechatChannel._load_or_login_credentials`）
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L407–L447](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L407-L447),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L911–L974](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L911-L974)
- **start 的生命周期契约** WechatChannel.start 是幂等防护的入口：self._running 已置位时仅告警并返回；正常路径完成凭据加载后用 asyncio.create_task 启动名为 "wechat-channel-poll" 的轮询任务，并以 while self._running: await asyncio.sleep(1) 保持存活。登录阶段任何异常都会被记录后 re-raise，调用方必须处理启动失败。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L407–L447](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L407-L447)
- **发送策略为模块级常量（hard_max=10, content_part_limit=9, interval_sec=0.5），start() 启动时记录** 发送上限在导入时固化为模块常量（所示片段未从用户配置读取）：MAX_MESSAGES_SEND_TO_WECHAT=10、WECHAT_CONTENT_SEND_LIMIT=max(1,10-1)、WECHAT_SEND_INTERVAL_SEC=0.5；
  - start() 以 hard_max/content_part_limit/interval_sec 记录该策略，轮询 HTTP 会话超时为 config.long_poll_timeout_sec+5（实例配置）。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L26–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L26-L34),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L413–L414](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L413-L414),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L438–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L438-L443)
- **依赖 start() 创建的 aiohttp 会话：send() 未就绪仅告警返回，_send_message 无会话抛 RuntimeError** start() 创建 total=config.long_poll_timeout_sec+5 的 aiohttp.ClientSession（L413-414）；send() 在无会话或无 config.bot_token 时仅告警并返回（L474-476）；
  - _send_message 先经 _require_http，会话为 None 时抛 RuntimeError("WechatChannel HTTP client is not initialized")（L466-470、L1111-1112）。两处守卫条件不同，互不覆盖 bot_token。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L407–L414](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L407-L414),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L466–L470](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L466-L470),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L472–L476](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L472-L476),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L1111–L1113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L1111-L1113)
- **start() 登录失败记日志后上抛且不创建轮询任务；可重试 WechatSendMessageError 转为暂存+繁忙提示** start() 中 _load_or_login_credentials 抛错时 logger.exception 后原样 raise，轮询任务不会创建；bot_token 为空且 auto_login=false 的登录准备分支抛 RuntimeError("WechatChannel 未配置 bot_token，且 auto_login=false")。
  - 发送分片循环中 WechatSendMessageError 且 ret 属于 WECHAT_SENDMESSAGE_RETRYABLE_RETS 时，暂存剩余分片、下发繁忙提示并 return，其余 ret 上抛。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L422–L431](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L422-L431),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L969–L971](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L969-L971),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L637–L647](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L637-L647)
- **WechatChannel CHAT_TOOL_CALL：仅 enable_streaming 时下发，限额触发时暂存不送达** 设计推断（非作者历史意图）：
- send 在 _http 与 bot_token 就绪后处理 CHAT_TOOL_CALL：非流式直接 return（少发过程消息，代价是工具过程不可见）；流式合并已积累 delta 与工具文本，但限额触发时仅 _stash_overflow_content 暂存并 return，进入 helper 后仍需 user_id 与 context_token 才真正送达。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L472–L585](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L472-L585),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L612–L649](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py#L612-L649)
- **个人微信扫码接入的文档化手动检查（NOT EXECUTED，仅断言二维码出现）** 文档中的人工验收步骤（本轮未执行）：
- 文档化人工步骤（NOT EXECUTED，本轮未执行）：先在微信「我→设置→关于微信→版本更新」升级至最新版，再在前端「频道」→「微信」启用微信配置并保存，页面出现二维码，随后用手机微信「扫一扫」扫描完成接入。仅覆盖二维码展示与扫码入口，不含消息收发或认证成功的断言。
- 来源：[docs/zh/国内频道.md:L585–L601](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L585-L601)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-wechat.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L407-L447
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L911-L974
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L26-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L413-L414
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L438-L443
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L422-L431
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L969-L971
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L637-L647
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L407-L414
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L466-L470
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L472-L476
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L1111-L1113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L472-L585
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py:L612-L649；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/国内频道.md:L585-L601
- 源页字段（feature）：im-wechat
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/wechat/wechat_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/wechat/*
