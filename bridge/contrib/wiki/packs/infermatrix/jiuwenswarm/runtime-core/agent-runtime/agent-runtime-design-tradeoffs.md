---
name: agent-runtime-design-tradeoffs
description: Runtime 生命周期与协调的设计取舍：AgentRuntime 一次性、宿主决定生命期，PreparedSessionProvision 租约把结果与最终提交分开，send_session_message 跨会话异步投递；含设计推断标注、关联功能与验证入口
metadata:
  scope: 收 service.py 与 session_provisioner.py 相关的三条取舍，来源另含 test_runtime_session_coordinator.py、test_runtime_session_provisioner.py；公共入口见 jiuwenswarm-runtime，执行模型见 jiuwenswarm-runtime-session-1，交互与取消见 jiuwenswarm-runtime-control
---
# Runtime 生命周期与协调的设计取舍

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/design-tradeoffs.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/session_provisioner.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_runtime_session_provisioner.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_runtime_session_coordinator.py
- 本页解释该组件的设计选择、代价与适用边界。基线为 `f0a69728c96b`。收益和替代方案分析标为**设计推断**，不把推断当成作者历史意图，也不代替规则页。

### 同一公共 Runtime，宿主决定生命期

- AgentRuntime 注释明确它是 one-shot：CLI 每条命令使用一份，AgentServer 使用服务生命期的一份。**设计推断**：复用公共执行语义，同时允许两种宿主部署；代价是资源初始化与关闭的频率不同，不能把相同 API 当作相同的生命周期策略。
- 源码依据：[jiuwenswarm/runtime/service.py:L296–L328](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L296-L328)。

### 租约把结果与最终提交分开

- PreparedSessionProvision 暴露不可变结果、状态和 commit_timing，finalizer 留在 owning Provisioner。**设计推断**：调用方可以按各自交付流程安排提交，同时不接管底层清理实现；代价是 prepare 后必须处理显式终态，取消和异常分支需要理解租约状态。
- 源码依据：[jiuwenswarm/runtime/session_provisioner.py:L264–L344](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/session_provisioner.py#L264-L344)。

### 跨会话消息异步投递

- send_session_message 注释解释异步交付避免两个会话等待彼此模型执行；暂停交互保留当前交互 owner。**设计推断**：消除这类同步互等，同时保护当前控制归属；代价是调用返回执行快照不代表目标模型轮次已完成，需要另外观察执行状态。
- 源码依据：[jiuwenswarm/runtime/service.py:L791–L805](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L791-L805)。

### API、配置与数据流入口

- 公共入口见[[jiuwenswarm-runtime]]（Runtime 架构），执行模型见[[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Session 协调器），交互与取消见[[jiuwenswarm-runtime-control]]（控制输入）。

### 关联功能

- 公共 API 被 [[gateway-channels-overview]]（进程式 CLI） 复用；[[login-auth-overview]]（登录凭据）、[[observability-overview]]（轨迹存储） 与 [[cron-scheduling-overview]]（Cron） 依赖不同的会话边界。

### 怎样验证

- [tests/unit_tests/runtime/test_runtime_session_provisioner.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_runtime_session_provisioner.py#L1-L25)
- [tests/unit_tests/runtime/test_runtime_session_coordinator.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_runtime_session_coordinator.py#L1-L25)
- 这些入口用于查找既有验证范围；源码阅读没有替代运行测试或真实服务验证。
