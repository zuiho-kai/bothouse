---
name: agent-runtime-overview
description: Agent 运行时与会话目录入口：何时查这里、不放什么（持久会话元数据归服务端 session 模块）、目录内容导航、代码快速入口表与验证入口（test_runtime_session_coordinator.py）、专题入口
metadata:
  scope: 只收本目录的导航、触发词与快速入口表；各页正文归 jiuwenswarm-runtime、jiuwenswarm-runtime-control、jiuwenswarm-runtime-execution、agent-runtime-design-tradeoffs、agent-runtime-knowledge、agent-runtime-rules、feature-depth-projects-sessions、feature-runtime-agent-definition-execution、feature-session-input-steering、feature-depth-runtime-agent-definition-execution、feature-depth-session-input-steering
---
# Agent 运行时与会话

## 现状

### 什么时候查这里

- 请求规范化、会话 provision，以及 generation、lane 排队、交互输入、取消与关闭协调。

### 不放什么

- 持久会话元数据由服务端 session 模块拥有；cron 产生定时工作、通道处理传输，分别查对应 component。

### 目录内容

- [[jiuwenswarm-runtime]]（共享 Agent Runtime（jiuwenswarm/runtime）） — 传输层无关的 Runtime：请求规范化、会话 create/switch/fork/delete、Plan 模式、模型/权限/MCP 目录
- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Runtime Session 协调器（jiuwenswarm/runtime/session/）） — 会话执行协调：准入与 generation、lane 排队、unary/流式执行、control 投递与心跳链、取消与关闭

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：runtime、AgentRuntime、session create/switch/fork、session.delete、plan mode、model catalog、permission snapshot、MCP reference、push handler、process CLI、agent definition、运行时。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| runtime、AgentRuntime、session create/switch/fork、session.delete、plan mode、model… | 入口 | `jiuwenswarm/runtime/agent_definition.py`、`jiuwenswarm/runtime/context.py`、`jiuwenswarm/runtime/events.py` |

### 验证入口

- `tests/unit_tests/runtime/test_runtime_session_coordinator.py` 覆盖进程内排序、控制输入、取消与关闭；Runtime 上层契约见共享 Runtime 页。

### 专题入口

- [[jiuwenswarm-runtime-control]]（Runtime 交互输入、执行取代与取消） — 协调等待交互的执行、补充输入、工作取代和子执行取消；会话注册、lane 调度与关闭由 Runtime Session 主页面说明。
- [[jiuwenswarm-runtime-execution]]（Runtime unary 与流式执行） — 提交去重、超时与取消、终态 owner 和流消费者提前退出。
- [[agent-runtime-design-tradeoffs]]（Runtime 生命周期与协调的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理 功能知识）
- [[agent-runtime-contracts-01]]（agent-runtime 源码接口与集成边界 01）
- [[feature-depth-projects-sessions]]（项目、会话与历史管理：实现深读）
- [[agent-runtime-knowledge]]（共享 Agent 运行时（jiuwenswarm/runtime/service.py AgentRuntime））
- [[feature-runtime-agent-definition-execution]]（声明式 root Agent 定义执行（invoke_agent/stream_agent））
- [[feature-session-input-steering]]（会话输入通道（steer/follow_up）与执行绑定 — 知识页）
- [[feature-depth-runtime-agent-definition-execution]]（声明式 root Agent 定义执行（invoke_agent/stream_agent）：实现深读）
- [[feature-depth-session-input-steering]]（Session Input Lane (steer/follow_up) and Execution Binding：实现深读）
- [[agent-runtime-rules]]（agent-runtime 审查规则） — Process CLI 能力覆盖只作用于本次 run，且不能削弱已安装 deny。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-09
