---
name: runtime-agent-adapter-overview
description: runtime-agent-adapter 目录入口：agent_adapter 源码接口记录页与 Agent adapter 运行时规则页的导览（Code 模型路由、Deep 停止轮提醒、团队群聊载荷）
metadata:
  scope: 只收本目录的入口说明；规则归 runtime-agent-adapter-rules，逐文件接口记录归 runtime-agent-adapter-contracts-01 与 runtime-agent-adapter-contracts-02
---
# runtime-agent-adapter

## 现状

- 理解本 owner 的源码职责、接口和集成边界时查这里。源码接口记录是静态契约；功能语义、配置和取舍沿功能页查证。通用审查方法不放在这里。
- [[runtime-agent-adapter-contracts-01]]（runtime-agent-adapter 源码接口与集成边界 01）
- [[runtime-agent-adapter-contracts-02]]（runtime-agent-adapter 源码接口与集成边界 02）
- [[runtime-agent-adapter-rules]]（Agent adapter 运行时规则） — Code profile 的模型路由与后台 memory 初始化、Deep 停止轮提醒、团队群聊载荷及 accepted/回合生命周期。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/runtime-agent-adapter/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-09
