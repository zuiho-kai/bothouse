---
name: feature-permissions-2
description: 工具权限与安全治理功能入口（下）：策略综合与 ask 降级为 deny 的设计推断、与 Agent Loop/模式/人类团队成员的关联、工作区内外路径、normal 与 strict、持久审批的验证步骤
metadata:
  scope: 只收设计取舍、数据流与关联功能、怎样验证三节；职责、接口与配置入口归 feature-permissions-1，实现级证据归 feature-depth-permissions
---
# 工具权限与安全治理 的职责、接口与配置（2/2）

## 关键事实

- 拆分说明：本页是源页 `feature-permissions.md` 的第 2/2 部分；第 1 部分 [[feature-permissions-1]]
- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-permissions.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01

### 设计取舍

- **设计推断**：策略综合工具、参数、路径与持久审批决定 allow、ask、deny，提供比只按工具名配置更细的边界；代价是规则顺序和覆盖层必须明确。不能提供审批交互的频道可能将 ask 降为 deny，客户端按钮不是服务端权限判断的替代。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L1–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L1-L274)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L1–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L1-L351)；
  - [docs/zh/工具权限与安全防护.md:L1–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%B7%A5%E5%85%B7%E6%9D%83%E9%99%90%E4%B8%8E%E5%AE%89%E5%85%A8%E9%98%B2%E6%8A%A4.md#L1-L366)。

### 数据流与关联功能

- 权限系统综合工具名称、参数、工作区和策略决定 allow、ask 或 deny。频道与宿主会影响审批能力，客户端的确认界面与服务端策略判定需要同时查证。 联调时结合[[feature-harness]]（Agent Loop 与 Rail 装配）、[[feature-modes]]（Agent、Code 与 Team 模式）、[[feature-human-team]]（人类团队成员与人工协作）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L1–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L1-L274)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L1–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L1-L351)；
  - [docs/zh/工具权限与安全防护.md:L1–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%B7%A5%E5%85%B7%E6%9D%83%E9%99%90%E4%B8%8E%E5%AE%89%E5%85%A8%E9%98%B2%E6%8A%A4.md#L1-L366)。

### 怎样验证

- 用工作区内外路径、明确拒绝规则和持久审批分别验证策略结果；覆盖 normal 与 strict 及 action 与 severity 的优先级。再通过不同频道检查 ask 的交互、取消和降级，核对持久目录信任是否按预期生效。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L1–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L1-L274)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L1–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L1-L351)；
  - [docs/zh/工具权限与安全防护.md:L1–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%B7%A5%E5%85%B7%E6%9D%83%E9%99%90%E4%B8%8E%E5%AE%89%E5%85%A8%E9%98%B2%E6%8A%A4.md#L1-L366)。
