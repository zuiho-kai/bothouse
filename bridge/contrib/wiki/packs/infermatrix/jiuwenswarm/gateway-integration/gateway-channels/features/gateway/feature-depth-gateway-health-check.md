---
name: feature-depth-gateway-health-check
description: HealthCheck 实现深读：start 防重入、_tick 构造 E2A 探活、update_conf 校验 every、HealthCheckConfig 默认值、_run_loop 异常处理、旧 heartbeat.relay 归一化单测、包导出符号
metadata:
  scope: 探活服务的函数级实现与单测断言；配置字段说明、Web RPC 与迁移兼容归 feature-gateway-health-check
---
# Gateway HealthCheck 周期探活服务：实现深读

## 现状

- [[feature-gateway-health-check]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **start 防重入后启动循环；_tick 在活跃时段构造 E2A 探活并标记成功状态** start 在 self._running 已为真时直接返回，否则置真并用 asyncio.create_task 启动 _run_loop 并打 INFO 日志（含 interval_seconds）。每次 _tick 先经 _is_active_now() 守卫，不活跃则打 debug 日志并返回；
  - 随后用毫秒时间戳加 secrets.token_hex(3) 生成 request_id 与 session_id，经 e2a_from_agent_fields 构造以 config.channel_id 为通道的探活信封（params 含 HEALTH_CHECK_PROMPT）。若 timeout_seconds 非 None 且 > 0 则用 asyncio.wait_for 包裹 agent_client.send_request，否则直接 await；成功后置 _last_tick_at 与 _last_tick_ok = True。
- 来源：[jiuwenswarm/gateway/health_check/health_check.py:L142–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L142-L150),
  - [jiuwenswarm/gateway/health_check/health_check.py:L177–L216](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L177-L216)
- **构造注入 agent_client/config/可选 message_handler；update_conf 校验 every 并按参数就地更新** __init__ 接受 agent_client、HealthCheckConfig 与可选 message_handler；update_conf 中 every 非 None 时要求 >0 否则抛 ValueError("health_check 'every' must be > 0")，target/active_hours 非 None 时写入 _config；三者全为 None 则直接返回不改状态。
- 来源：[jiuwenswarm/gateway/health_check/health_check.py:L128–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L128-L134),
  - [jiuwenswarm/gateway/health_check/health_check.py:L332–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L332-L351)
- **HealthCheckConfig 默认值：timeout_seconds/relay_channel_id/active_hours 默认 None，channel_id 默认 HEALTH_CHECK_CHANNEL_ID** interval_seconds 为必填 float；timeout_seconds 默认 None（文档注明可选、提供则 MUST > 0，_tick 仅在非 None 且 > 0 时套 asyncio.wait_for）；channel_id 默认常量 HEALTH_CHECK_CHANNEL_ID（文档注明默认 __health_check__）；
  - relay_channel_id 默认 None，文档说明从 .env 的 HEARTBEAT_RELAY_CHANNEL_ID 读取且为 None 则不回传；active_hours 默认 None 表示始终生效。模块文档说明配置已从 config.yaml 的 heartbeat 段迁移到 health_check 段，环境变量保留 HEARTBEAT_RELAY_CHANNEL_ID 等旧名。
- 来源：[jiuwenswarm/gateway/health_check/health_check.py:L76–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L76-L92),
  - [jiuwenswarm/gateway/health_check/health_check.py:L9–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L9-L18),
  - [jiuwenswarm/gateway/health_check/health_check.py:L200–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L200-L207)
- **循环吞掉普通异常继续运行，CancelledError 退出；update_conf 对 every<=0 抛 ValueError** _run_loop 捕获 asyncio.CancelledError 后 break 结束循环；其他 Exception 仅 logger.exception("Gateway health check loop error") 后继续下一轮。update_conf 在 every<=0 时抛 ValueError，由调用方处理。
- 来源：[jiuwenswarm/gateway/health_check/health_check.py:L166–L175](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L166-L175),
  - [jiuwenswarm/gateway/health_check/health_check.py:L336–L340](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L336-L340)
- **宽捕获换取循环存活，代价是单次探活失败仅以日志呈现（推断）** 设计推断（非作者历史意图）：
- 收益：_run_loop 对普通异常宽捕获使周期探活不会因一次 _tick 错误退出；成本：此类失败只通过 logger.exception 呈现，循环本身不重试加速也不上报（依据 shown 实现，属推断）。
- 来源：[jiuwenswarm/gateway/health_check/health_check.py:L166–L175](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L166-L175)
- **运行时测试断言旧 heartbeat.relay 在入口归一化为 HEALTH_CHECK_RELAY 并保留别名** test_legacy_health_check_relay_normalizes_at_gateway_ingress 实际调用 MessageHandler._response_to_message 并断言 message.event_type is EventType.HEALTH_CHECK_RELAY 且 payload 同时含 health_check.relay 与 heartbeat/health_check 双键（未在本会话执行）。
- 来源：[tests/unit_tests/gateway/test_heartbeat_contracts.py:L45–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_heartbeat_contracts.py#L45-L64)
- **构造注入 AgentServerClient，_tick 内延迟导入 e2a_from_agent_fields 构造信封** GatewayHealthCheckService 通过构造函数注入 agent_client: "AgentServerClient" 与 config；_tick 局部导入 jiuwenswarm.common.e2a.gateway_normalize.e2a_from_agent_fields 构造 E2A 信封后经 self._agent_client.send_request 发送。
  - 包 __init__ 从 health_check 模块再导出 HEALTH_CHECK_CHANNEL_ID、HEALTH_CHECK_OK、HEALTH_CHECK_PROMPT、GatewayHealthCheckService、HealthCheckConfig、IHealthCheck、normalize_active_hours。
- 来源：[jiuwenswarm/gateway/health_check/health_check.py:L128–L134](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L128-L134),
  - [jiuwenswarm/gateway/health_check/health_check.py:L177–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L177-L207),
  - [jiuwenswarm/gateway/health_check/__init__.py:L10–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/__init__.py#L10-L28)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-gateway-health-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L128-L134；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L332-L351
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L166-L175；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L336-L340
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_heartbeat_contracts.py:L45-L64；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L142-L150
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L177-L216；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L76-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L9-L18；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L200-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L177-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/__init__.py:L10-L28
- 源页字段（feature）：gateway-health-check
- 入口（entry_points）：jiuwenswarm/gateway/health_check/__init__.py；jiuwenswarm/gateway/health_check/health_check.py
- 源页字段（source_globs）：jiuwenswarm/gateway/health_check/__init__.py；jiuwenswarm/gateway/health_check/health_check.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
