---
name: feature-gateway-health-check
description: Gateway HealthCheck 周期探活服务概览：HealthCheckConfig 字段与 heartbeat 迁移、GatewayHealthCheckService 生命周期与 health_check.get_conf/set_conf RPC、E2A 探活与条件回传 HEALTH_CHECK_RELAY、active_hours 跨午夜、日志可观测性取舍
metadata:
  scope: 探活服务的配置、运行时更新、职责边界、Web RPC 契约、探活行为与迁移取舍；_tick 与 update_conf 的逐步实现和单测断言归 feature-depth-gateway-health-check
---
# Gateway HealthCheck 周期探活服务 (jiuwenswarm/gateway/health_check)

## 现状

- **配置项与运行时更新**
- `HealthCheckConfig` 字段：`interval_seconds`（探活间隔秒，MUST > 0）、`timeout_seconds`（单次超时，可选，>0 才生效，否则不包 wait_for）、`channel_id`（默认 `__health_check__`）、`relay_channel_id`（回传 channel，如 "web"，从 .env 的 `HEARTBEAT_RELAY_CHANNEL_ID` 读取，为 None 则不回传）、
  - `active_hours`（`{"start": "HH:MM", "end": "HH:MM"}`，None 表示始终生效）。模块级文档说明配置已从 config.yaml 的 `heartbeat` 段迁移到 `health_check` 段，环境变量保留 `HEARTBEAT_RELAY_CHANNEL_ID` 旧名以不断裂运维。`normalize_active_hours` 处理 YAML 中未加引号的 22:00 被解析为 60 进制数字的问题，转回 "HH:MM"。
  - Web 端 `health_check.set_conf` 处理器校验 params 后调用 `set_health_check_conf` 并经 `update_health_check_in_config` 写回 config.yaml。
- Sources / 来源：[jiuwenswarm/gateway/health_check/health_check.py:L76–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L76-L92),
  - [jiuwenswarm/gateway/health_check/health_check.py:L45–L62](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L45-L62),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3944–L3957](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3944-L3957)
- **验证入口**
- 所示片段中未包含测试文件；可观察的验证途径是运行时日志与代码内状态：模块文档指出成功打 INFO「Gateway health check OK」、失败打 WARNING，代码检查用 `last_tick_ok`/`last_tick_at`。超时路径（`asyncio.TimeoutError`）与通用异常路径分别记录 WARNING 并置 `last_tick_ok=False`。
- Sources / 来源：[jiuwenswarm/gateway/health_check/health_check.py:L124–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L124-L126),
  - [jiuwenswarm/gateway/health_check/health_check.py:L266–L277](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L266-L277)
- **职责边界与数据流**
- HealthCheck 模块承接旧 `gateway/heartbeat/heartbeat.py` 的探活能力，与新 Heartbeat 任务（线程续跑，`gateway/heartbeat/` 下的 models/store/scheduler/controller）严格区分；探活只验证 AgentServer 请求链路，不再读取 `HEARTBEAT.md` 或执行用户任务。
  - `_tick` 用 `e2a_from_agent_fields` 构造 E2A 信封，经 `AgentServerClient.send_request` 发往 AgentServer（可选 `asyncio.wait_for` 超时）。回传是有条件的：仅当配置了 `relay_channel_id` 且注入了 `message_handler` 时，才以 `EventType.HEALTH_CHECK_RELAY` 的 event Message 经 `publish_robot_messages` 回传到指定 channel；
  - 模块 docstring 提到默认 web，但配置字段 `relay_channel_id` 默认为 None（不回传）。
- Sources / 来源：[jiuwenswarm/gateway/health_check/health_check.py:L3–L12](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L3-L12),
  - [jiuwenswarm/gateway/health_check/health_check.py:L192–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L192-L207),
  - [jiuwenswarm/gateway/health_check/health_check.py:L242–L260](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L242-L260)
- **迁移兼容与可观测性取舍**
- 模块从旧 `heartbeat.py` 探活逻辑迁移而来：环境变量沿用旧名 `HEARTBEAT_RELAY_CHANNEL_ID`、relay payload 保留 `heartbeat` 别名字段、Web RPC 中 `heartbeat.get_conf`/`set_conf` 与 `health_check.*` 共享同一处理器，均以兼容旧运维侧与消费者为目的（该兼容范围仅限 get_conf/set_conf，`heartbeat.job.*` 任务方法是独立的另一组方法）。
  - 代价是命名双轨：文档明确探活只做连通性检查、不再读取 `HEARTBEAT.md` 或执行用户任务，与新 Heartbeat 任务系统严格区分。可观测性选择日志 + 内部状态而非向 Channel 主动告警：成功打 INFO、失败/超时打 WARNING，循环异常被捕获记日志而不终止循环；Web 端 set_conf 写回 config.yaml 失败仅记 WARNING，写回成功后才调度清除 agent 配置缓存。
- Sources / 来源：[jiuwenswarm/gateway/health_check/health_check.py:L3–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L3-L18),
  - [jiuwenswarm/gateway/health_check/health_check.py:L242–L260](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L242-L260),
  - [jiuwenswarm/gateway/health_check/health_check.py:L266–L277](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L266-L277),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3944–L3957](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3944-L3957),
  - [tests/unit_tests/gateway/test_app_web_handlers.py:L379–L393](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_web_handlers.py#L379-L393)
- **服务生命周期与 Web RPC 契约**
- 模块通过 `jiuwenswarm.gateway.health_check` 包对外导出 `GatewayHealthCheckService`、`HealthCheckConfig`、`IHealthCheck` 等符号。`IHealthCheck` 抽象接口定义异步 `start()`/`stop()` 与 `is_running()` 三个生命周期方法；
  - `GatewayHealthCheckService(agent_client, config, message_handler=None)` 是其实现，另暴露 `last_tick_ok`（True/False/None）与 `last_tick_at` 只读属性及 `get_health_check_conf()`/`set_health_check_conf(every=, target=, active_hours=)`。
  - Web 侧注册 `health_check.get_conf`/`health_check.set_conf` RPC（`heartbeat.get_conf`/`set_conf` 是同一处理器的别名），服务不可用时返回 `SERVICE_UNAVAILABLE`，`every` 非法时抛 `ValueError` 映射为 `BAD_REQUEST`。
- Sources / 来源：[jiuwenswarm/gateway/health_check/__init__.py:L10–L28](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/__init__.py#L10-L28),
  - [jiuwenswarm/gateway/health_check/health_check.py:L95–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L95-L115),
  - [jiuwenswarm/gateway/health_check/health_check.py:L318–L340](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L318-L340),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3867–L3890](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L3867-L3890)
- **支持的探活行为与依赖关系**
- GatewayHealthCheckService 提供固定间隔的 AgentServer 连通性探活：`_run_loop` 每轮先 `asyncio.sleep(interval_seconds)` 再执行一次 `_tick`，`_tick` 用 `e2a_from_agent_fields` 构造以 `HealthCheckConfig.channel_id`（默认 `__health_check__`，可配置）为标识、携带 `HEALTH_CHECK_PROMPT` 的 E2A 信封，经 `AgentServerClient.send_request` 发送，
  - `timeout_seconds` > 0 时才包 `asyncio.wait_for`；该探活只验证请求链路，不读取或执行任何用户任务文件。成功后仅当配置了 `relay_channel_id` 且注入了 `message_handler` 时，才把响应内容以 `EventType.HEALTH_CHECK_RELAY` 的 event Message（payload 同时含 `health_check` 与已废弃的 `heartbeat` 别名字段）经 `publish_robot_messages` 回传到指定 channel；
  - `active_hours` 支持跨午夜区间（start > end 时按 `now >= start or now < end` 判断）。
- Sources / 来源：[jiuwenswarm/gateway/health_check/health_check.py:L166–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L166-L207),
  - [jiuwenswarm/gateway/health_check/health_check.py:L242–L260](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L242-L260),
  - [jiuwenswarm/gateway/health_check/health_check.py:L305–L313](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L305-L313)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-gateway-health-check.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L76-L92；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L45-L62
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3944-L3957；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L124-L126
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L266-L277；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L3-L12
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L192-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L242-L260
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L3-L18；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_web_handlers.py:L379-L393
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/__init__.py:L10-L28；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L95-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L318-L340；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L3867-L3890
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L166-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/health_check/health_check.py:L305-L313
- 源页字段（feature）：gateway-health-check
- 入口（entry_points）：jiuwenswarm/gateway/health_check/__init__.py；jiuwenswarm/gateway/health_check/health_check.py
- 源页字段（source_globs）：jiuwenswarm/gateway/health_check/__init__.py；jiuwenswarm/gateway/health_check/health_check.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
