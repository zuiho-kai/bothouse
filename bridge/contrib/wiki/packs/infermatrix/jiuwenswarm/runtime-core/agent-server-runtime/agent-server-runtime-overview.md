---
name: agent-server-runtime-overview
description: agent-server-runtime 目录入口：何时查这里（owner 的职责、接口、配置与相关功能）、各功能知识与实现深读页（模式、权限、Agent Loop、Skill 自演进、TTSE、编码记忆、上下文、LSP、Worktree、心跳、SkillDev、主动推荐、Git Diff）、源码接口页、20 个子模块目录导航与审查规则入口
metadata:
  scope: 只收本目录的导航与触发说明；AgentServer WebSocket 边界正文归 knowledge-agent-server-runtime，审查规则归 agent-server-runtime-rules，逐文件接口记录归 agent-server-runtime-contracts-01
---
# agent-server-runtime

## 现状

- 理解该代码 owner 的职责、接口、配置与相关功能时查这里；通用审查方法不属于本目录。
- [[feature-modes]]（Agent、Code 与 Team 模式 功能知识）
- [[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理 功能知识）
- [[feature-harness]]（Agent Loop 与 Rail 装配 功能知识）
- [[feature-skill-evolution]]（Skill 自演进 功能知识）
- [[feature-ttse]]（FACT/TIP 双轨经验 功能知识）
- [[feature-coding-memory]]（Code 模式编码记忆 功能知识）
- [[feature-context]]（上下文压缩与卸载 功能知识）
- [[feature-lsp]]（LSP 代码智能 功能知识）
- [[feature-worktree]]（Worktree 隔离工作 功能知识）
- [[agent-server-runtime-contracts-01]]（agent-server-runtime 源码接口与集成边界 01）
- [[control-overview]]（control）
- [[control-repositories-overview]]（control-repositories）
- [[control-store-overview]]（control-store）
- [[front-overview]]（front）
- [[gateway-push-overview]]（gateway-push）
- [[agent-server-runtime-hooks-overview]]（hooks）
- [[personal-context-overview]]（personal-context）
- [[rsi-overview]]（rsi）
- [[runtime-agent-adapter-overview]]（runtime-agent-adapter）
- [[runtime-overview]]（runtime）
- [[runtime-attachments-overview]]（runtime-attachments）
- [[runtime-debug-trace-overview]]（runtime-debug-trace）
- [[runtime-gateway-adapter-overview]]（runtime-gateway-adapter）
- [[runtime-harmonyos-overview]]（runtime-harmonyos）
- [[runtime-marketplace-overview]]（runtime-marketplace）
- [[runtime-mcp-overview]]（runtime-mcp）
- [[runtime-session-overview]]（runtime-session）
- [[runtime-skill-overview]]（runtime-skill）
- [[sandbox-overview]]（sandbox）
- [[agent-server-runtime-utils-overview]]（utils）
- [[feature-heartbeat]]（绑定会话的心跳续跑任务功能知识）
- [[feature-skill-development]]（SkillDev 创建、评测与打包边界功能知识）
- [[feature-proactive-recommendation]]（主动推荐、频率限制与主 Agent 交付功能知识）
- [[knowledge-agent-server-runtime]]（AgentServer WebSocket 边界：Runtime、接口与配置） — 说明接口、配置与集成边界，关联源码和维护者文档。
- [[feature-depth-modes]]（Agent、Code 与 Team 模式：实现深读）
- [[feature-depth-harness]]（Agent Loop 与 Rail 装配：实现深读）
- [[feature-depth-ttse]]（FACT/TIP 双轨经验：实现深读）
- [[feature-depth-coding-memory]]（Code 模式编码记忆：实现深读）
- [[feature-depth-context]]（上下文压缩与卸载：实现深读）
- [[feature-depth-permissions]]（工具权限与安全治理：实现深读）
- [[feature-depth-lsp]]（LSP 代码智能：实现深读）
- [[feature-depth-worktree]]（Worktree 隔离工作：实现深读）
- [[feature-depth-heartbeat]]（绑定会话的心跳续跑任务：实现深读）
- [[feature-depth-skill-development]]（SkillDev 创建、评测与打包边界：实现深读）
- [[feature-depth-proactive-recommendation]]（主动推荐、频率限制与主 Agent 交付：实现深读）
- [[feature-depth-skill-evolution]]（Skill 自演进：实现深读）
- [[feature-workspace-git-diff]]（Workspace Git Diff 聚合（get_git_diff）与实时监控）
- [[feature-depth-workspace-git-diff]]（Workspace Git Diff Aggregation (get_git_diff)：实现深读）
- [[agent-server-runtime-rules]]（agent-server-runtime 审查规则） — AgentServer 流审计限定请求本地计数，不能改变响应块。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-09
