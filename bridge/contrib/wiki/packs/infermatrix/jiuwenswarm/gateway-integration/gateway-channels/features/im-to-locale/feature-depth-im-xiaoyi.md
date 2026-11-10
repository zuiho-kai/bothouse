---
name: feature-depth-im-xiaoyi
description: 小艺频道实现深读：XiaoYiPushService.send_push 布尔契约与 xiaoyi_claw/HMAC 签名分支、enabled 默认关闭与 ak/sk/agent_id 启动校验、XiaoyiChannel 构造耦合与 channel_id 回退、_fetch_from_url 超限与异常转换、provider 安装与恢复单测
metadata:
  scope: 只收小艺频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-xiaoyi
---
# 小艺 频道：实现深读

## 现状

- [[feature-im-xiaoyi]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **XiaoYiPushService.send_push 的布尔契约** send_push(text, push_text) 以 JSON-RPC 2.0 结果载荷 POST 到 PushConfig.push_url，30 秒总超时；HTTP 200 返回 True，非 200、aiohttp.ClientError 或其他异常都只记日志并返回 False，不抛出。调用方必须检查返回布尔值，不能假设推送已送达。
  - 签名方式按 config.mode 分叉：xiaoyi_claw 用 x-uid/x-api-key 头，否则用 X-Access-Key/X-Sign(HMAC-SHA256)/X-Ts。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py:L55–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py#L55-L132)
- **enabled 默认关闭与启动前置校验** 文档默认 `enabled: false`、`enable_streaming: true`，mode 固定 `xiaoyi_channel`；配置位于 ~/.jiuwenswarm/config/config.yaml 的 channels.xiaoyi.apps，保存后运行中服务自动重载。代码侧生效条件：XiaoyiChannel.start 在 enabled=False 时直接返回；mode == "xiaoyi_channel" 且 ak/sk/agent_id 任一为空时记 error 并返回，不建立任何连接。
  - 启用 push 时 api_id 与 push_id 需同时填写。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L386–L412](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L386-L412),
  - [docs/zh/国内频道.md:L67–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L67-L103)
- **XiaoYiPushService.send_push：mode=="xiaoyi_claw" 选定头部分支后 POST，status 200 才返回 True** send_push(text, push_text) 生成毫秒时间戳与 message_id，构造 jsonrpc 2.0 result 负载（apiId/pushId/pushText、kind "task"、status completed、含 push_text 文本 artifact）；
  - guard self.config.mode == "xiaoyi_claw" 时用 x-uid/x-api-key 头，否则用 X-Access-Key/X-Sign（来自 _generate_signature）/X-Ts；以 ClientTimeout(total=30) POST self.config.push_url，response.status == 200 记录日志并 return True，否则读取 body、记录错误日志并 return False。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py:L55–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py#L55-L132)
- **XiaoyiChannel.__init__ 耦合 XiaoyiChannelConfig 字段；channel_id 为空时 getter 回退类名 "xiaoyi"** __init__ 接收 XiaoyiChannelConfig，用 config.file_upload_url/api_key/uid 组装 file_upload_config，并保存 config.api_id/push_id；
  - channel_id 属性返回 self.config.channel_id or self.name，而 name 固定为 "xiaoyi"，即 channel_id 未配置（假值）时该属性返回 "xiaoyi"。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L298–L337](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L298-L337),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L363–L364](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L363-L364)
- **_fetch_from_url：超 max_bytes 抛 ValueError；ClientResponseError/TimeoutError 转链式 RuntimeError 上抛** 在 _fetch_from_url 内，content-length 或实际读取的 buffer 超过 max_bytes 时 raise ValueError("File too large: … (limit: …)")（两个 except 只匹配 ClientResponseError 与 TimeoutError，故该 ValueError 不被捕获）；
  - ClientResponseError 转 RuntimeError("HTTP {status}: {reason}")，asyncio.TimeoutError 转 RuntimeError("Download timeout after {timeout_ms}ms")，均 from 原异常向本函数调用方抛出。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/media.py:L109–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/media.py#L109-L154)
- **send_push 以记录日志并返回 False 代替抛错（推断）** 设计推断（非作者历史意图）：
- 收益（推断）：HTTP 状态非 200、`aiohttp.ClientError` 或其他异常都只被记录日志并返回 `False`，推送失败不会中断调用方；代价（推断）：调用方只拿到裸布尔值，无法区分失败原因，细节仅存在于日志中。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py:L119–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py#L119-L132)
- **异步运行时测试断言首次 start 安装 provider、最后一个 stop 后恢复 fallback provider** `test_provider_installs_on_first_start_and_restores_after_last_stop`（`pytest.mark.asyncio`）用真实 `XiaoyiChannel` 实例断言 `host_services.get_runtime_xiaoyi_channel("xiaoyi-first") is first`，`first.stop()` 后该 ID 变为 None 而 second 仍在，
  - 两个都 stop 并 `asyncio.sleep(0)` 后查询返回 `fallback` 对象。
- 来源：[tests/unit_tests/runtime/test_runtime_xiaoyi_host_provider.py:L40–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_runtime_xiaoyi_host_provider.py#L40-L49),
  - [tests/unit_tests/runtime/test_runtime_xiaoyi_host_provider.py:L59–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_runtime_xiaoyi_host_provider.py#L59-L83)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-xiaoyi.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py:L55-L132
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L386-L412；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/国内频道.md:L67-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py:L119-L132
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_runtime_xiaoyi_host_provider.py:L40-L49；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_runtime_xiaoyi_host_provider.py:L59-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L298-L337
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L363-L364
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/media.py:L109-L154
- 源页字段（feature）：im-xiaoyi
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/*
