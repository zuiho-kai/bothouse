---
name: gateway-health-check-contracts-01
description: gateway-health-check 源码接口与集成边界 01：gateway/health_check 下 __init__.py 与 health_check.py（HealthCheckConfig、IHealthCheck、GatewayHealthCheckService、normalize_active_hours）的声明
metadata:
  scope: 只收 gateway/health_check 两个文件的静态声明；模块入口归 gateway-health-check-overview
---
# gateway-health-check 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/health_check/__init__.py`**
- 源码对模块职责的说明：HealthCheck 模块，负责原 Heartbeat 的服务探活能力。。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.gateway.health_check.health_check import HEALTH_CHECK_CHAN`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/__init__.py#L1-L28)。
- **`jiuwenswarm/gateway/health_check/health_check.py`**
- 源码对模块职责的说明：HealthCheck(旧 Heartbeat 探活)— Gateway 内周期性向 AgentServer 发送探活请求.。
- 调用入口 `normalize_active_hours(active_hours)`；声明返回 `dict[str, str] / None`。
- `HealthCheckConfig` 定义类型边界。
- `IHealthCheck` 继承 `ABC`；方法入口：`start`, `stop`, `is_running`。
- `GatewayHealthCheckService` 继承 `IHealthCheck`；方法入口：`__init__`, `start`, `stop`, `is_running`, `last_tick_ok`, `last_tick_at`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import secrets`。
- 模块级配置或常量名称：`HEALTH_CHECK_CHANNEL_ID`, `HEALTH_CHECK_OK`, `HEALTH_CHECK_PROMPT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/health_check/health_check.py#L1-L368)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-health-check/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
