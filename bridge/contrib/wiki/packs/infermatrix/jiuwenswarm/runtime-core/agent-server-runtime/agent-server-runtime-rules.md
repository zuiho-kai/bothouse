---
name: agent-server-runtime-rules
description: "agent-server-runtime 审查规则 JW-WS-AUDIT-1a：agent_ws_server._handle_stream_impl 的 stream_audit 只做请求本地、有界的 chat.reasoning/chat.delta 计数，不得改变或过滤响应块；来源 PR #7625"
metadata:
  scope: 只收规则 JW-WS-AUDIT-1a 一条；目录入口归 agent-server-runtime-overview，逐文件接口记录归 agent-server-runtime-contracts-01
---
# agent-server-runtime 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7625
- 置信度（confidence）：high
- [JW-WS-AUDIT-1a] AgentServer 流审计限定请求本地计数，不能改变响应块
  - 触发：修改 xiaoyi_0.2.4.beta3 agent_ws_server._handle_stream_impl 的 stream_audit。
  - 强制：计数状态限定本次请求，样本数量与长度有界；只观察 chat.reasoning/chat.delta，保持原始流处理与交付顺序；有计数帧才用既有 logger 记录轮级汇总。
  - 验收：交替帧和空流分别检查计数、样本上限、汇总条件与响应块不变；任何新增异常隔离以实际代码与测试为据。^[PR #7625]

## 决策与踩坑

- [JW-WS-AUDIT-1a] 禁止：从计数逻辑修改、过滤 chunk；为逐块诊断新增长期日志输出；将这一实现写成与小艺字典相同的 64 条淘汰机制或声称已有独立 try/except。
