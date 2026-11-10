---
name: agentos-agentos-router-rules
description: "AgentOS registry_client.register_agent 与 router_client placement 补写规则 JW-AGENTOS-REG-1a：无 placement 时 address/node 留空，真实 IP 就绪后 PATCH（PR #7837、#7838）"
metadata:
  scope: 只收 JW-AGENTOS-REG-1a 一条规则；agentos_router 各文件的接口声明归 agentos-agentos-router-contracts-01，入口说明归 agentos-agentos-router-overview
---
# agentos-agentos-router 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/agentos-agentos-router/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7837；PR #7838
- 置信度（confidence）：high
- [JW-AGENTOS-REG-1a] 注册缺少 placement 时留空，真实 IP 就绪后再补写
  - 触发：修改 AgentOS registry_client.register_agent 或 router_client placement 补写。
  - 强制：首次 address 依次取 metadata/sandbox_meta 的实际 address，否则空字符串；node 缺失也留空。沙箱 running 后从运行信息读取 node_ip/sandbox_ip（含 ip_address 别名）再 PATCH。
  - 验收：无 placement 时首次 POST address/node 都为空，真实 placement 到达才 PATCH；两个同源镜像 PR 只算同一条结论。^[PR #7837]^[PR #7838]

## 决策与踩坑

- [JW-AGENTOS-REG-1a] 禁止：恢复 pending 等非 IP 占位值；把 instance_id 填进 address；探针未就绪时提前猜 IP。
