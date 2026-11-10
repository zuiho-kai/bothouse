---
name: feature-depth-im-wecom
description: 企业微信频道实现深读：WecomConfig 默认值与工作空间回退、保活循环不以 is_connected 退出、start 守卫与 send 未连接跳过、atomic_write_unique 本地回落、AttachmentPersistError 传播、whitespace delta 单测、send 签名与 CHAT_PROCESSING_STATUS 拦截
metadata:
  scope: 只收企业微信频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-wecom
---
# 企业微信 频道：实现深读

## 现状

- [[feature-im-wecom]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **WecomConfig 默认值与工作空间回退** WecomConfig 默认 ws_url="wss://openws.work.weixin.qq.com"、enable_streaming=True、max_download_size=100MB、download_timeout=60、workspace_dir=""；_run_client 中 workspace_dir 为空时回退到 get_agent_workspace_dir()，且 ws_url 仅在非空时传入 WSClient。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L46–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L46-L66),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1374–L1418](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L1374-L1418)
- **保活循环不以 is_connected 作为退出条件** 设计推断（非作者历史意图）：
- _run_client 连接后进入仅依赖 self._running 的睡眠循环，注释说明短暂断线时 SDK 会内部重连，若此处退出会触发 finally 主动 disconnect 打断重连。收益是容忍网络抖动；代价是真实失联时该任务自身不退出，恢复依赖 SDK 内部机制（设计推断：该权衡依据代码内注释，属于文档性证据）。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1426–L1446](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L1426-L1446)
- **start() 通过依赖/配置/重入守卫后调度 _run_client 任务并驻留；send() 未连接时记 warning 跳过** WECOM_AVAILABLE 为真、bot_id 与 secret 齐备且未在运行时，start() 置 _running=True、记录运行循环并 create_task 调度 _run_client（name=wecom-channel），随后 while _running 每 1 秒 sleep 驻留；所示行仅证明任务已调度，不证明连接已建立。
  - send() 在 _ws_client 缺失或 is_connected 为假时记 warning 后返回，chat.file/chat.media 转 _send_file_message。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1448–L1468](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L1448-L1468),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1134–L1164](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L1134-L1164)
- **本地回落依赖 upload_storage.atomic_write_unique 独占落盘；
  - WECOM_AVAILABLE 为假时 start() 不启动** wecom_file_service 导入并调用 server/runtime/attachments 的 atomic_write_unique：_persist_downloaded_file 在 _persist_hook 为 None 的本地回落分支写入 workspace_dir 下 wecom_files/downloads/<category>，同名文件取 stem-N 不覆盖，返回 {path,name,size}；
  - WECOM_AVAILABLE 为假时 start() 记 error（日志提示 pip install wecom-aibot-sdk）并返回。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L13–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py#L13-L24),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L135–L157](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py#L135-L157),
  - [jiuwenswarm/server/runtime/attachments/upload_storage.py:L84–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/attachments/upload_storage.py#L84-L93),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1450–L1452](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L1450-L1452)
- **钩子落盘失败时 AttachmentPersistError 原样上抛、其余 Exception 包装；下载超时或其他异常仅记日志返回 None** _persist_hook 存在时，钩子抛出的 AttachmentPersistError 原样 re-raise，其他 Exception 包装为 AttachmentPersistError(str(exc)) from exc 后上抛，二者均不走本地写盘回落；
  - 下载路径里 asyncio.TimeoutError 与其他 Exception 仅记 error 并 return None，AttachmentPersistError 则继续传播。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L139–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py#L139-L153),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L255–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py#L255-L262)
- **whitespace delta 测试运行真实 WecomChannel.send 并断言精确回复调用** test_wecom_does_not_resend_unchanged_content_for_whitespace_delta 以 WecomConfig(enabled=True, enable_streaming=True) 构造真实 channel 并注入 _FakeWecomClient，
  - await channel.send(...) 两次（"Hello" 与 " "）后断言 client.reply_calls == [({"headers": {}}, "stream-1", "Hello", False)]。
- 来源：[tests/unit_tests/channel/test_im_stream_whitespace.py:L84–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_im_stream_whitespace.py#L84-L103)
- **send 的签名、未连接守卫与 CHAT_PROCESSING_STATUS 拦截分支** WecomChannel.send 为协程，接受 msg: Message 与 keyword-only 的 routing_target: RoutingTarget | None = None，返回注解 None。未持有 is_connected 为真的 ws client 时记录 'WecomChannel 未连接，跳过发送' 并返回；
  - event_type == CHAT_PROCESSING_STATUS 且 payload 为 dict 时 await _handle_processing_status_event 后返回，不外发。docstring 仅称 resolved/delivery 为 team 分发元数据（经 msg.metadata 取投递信息、暂不直接消费），未提及 routing_target。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1134–L1155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py#L1134-L1155)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-wecom.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L46-L66
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1374-L1418
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1426-L1446；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_im_stream_whitespace.py:L84-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1448-L1468
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1134-L1164
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L13-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L135-L157
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/attachments/upload_storage.py:L84-L93；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1450-L1452
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L139-L153
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py:L255-L262
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py:L1134-L1155
- 源页字段（feature）：im-wecom
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/wecom/*
