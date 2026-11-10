---
name: feature-digital-avatar
description: 群聊数字分身与 owner 权限的职责边界、setup_permission_context 入口、group_digital_avatar / enable_memory / permissions.owner_scopes 配置、设计取舍与验证方法
metadata:
  scope: 只收群聊数字分身与 owner 权限的功能概览（职责、入口、配置、取舍、验证）；实现深读归 feature-depth-digital-avatar
---
# 群聊数字分身与 owner 权限的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-digital-avatar.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/avatar_rail.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/频道.md；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/国内频道.md
- 源页字段（feature）：digital-avatar
- 入口（entry_points）：jiuwenswarm/agents/harness/common/rails/avatar_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/rails/avatar_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py；jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_im_adapter.py
  - jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/gateway/im_pipeline/im_inbound.py；jiuwenswarm/gateway/im_pipeline/im_outbound.py；jiuwenswarm/gateway/routing/interaction_context.py
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 数字分身按请求上下文维护被代表用户与触发用户身份，AvatarPromptRail 在模型调用前注入身份及群聊规则，在工具调用前限制记忆行为。owner_scopes 从 channel 与 principal 选择权限范围，ContextVar 由请求入口设置并在 finally 清理，防止相邻请求共享身份。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L1–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L1-L348)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L1-L312)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 接口与调用入口（API）

- setup_permission_context(request) 将请求 metadata 转成 PermissionContext，cleanup_permission_context(token) 重置上下文。AvatarPromptRail 的 before_model_call 和 before_tool_call 消费 group_digital_avatar、avatar_mode、principal_user_id 与 enable_memory，维护 prompt section 并拦截受限制记忆工具。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L1–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L1-L348)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L1-L312)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 配置入口与生效条件

- 频道支持配置 group_digital_avatar 和 enable_memory；permissions.owner_scopes 按 channel 与 principal 区分授权。触发用户与被代表用户是不同身份，群聊模式与普通私聊会走不同场景。当前源码在群聊数字分身中禁止写记忆；enable_memory=false 且群聊数字分身时进一步禁止读取。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L1–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L1-L348)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L1-L312)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 设计取舍

- **设计推断**：请求局部身份与 owner 权限让同一 Agent 服务代表不同账号，同时限制群聊记忆污染；代价是身份映射、prompt 清理和工具策略必须一致。群聊场景缺少审批能力时 ask 可降为 deny，不能沿用 Web 宿主的交互可用性假设。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L1–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L1-L348)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L1-L312)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 数据流与关联功能

- 平台适配器保留群聊、principal 与触发用户字段，Host 设置上下文后由身份 Rail 和权限 Rail共同消费，最终回复交给对应频道。它关联长期记忆、工具审批和平台群聊配置；普通 Bot 回复与代表用户身份的数字分身需要分别验证。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L1–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L1-L348)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L1-L312)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 怎样验证

- 构造两个不同 principal 的连续及并发请求，核对 prompt、owner 权限与清理后的 ContextVar。分别检查私聊、群聊分身、enable_memory=false 与缺少审批界面，确认记忆读写限制和 ask 降级；本页未执行上游运行测试。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L1–L348](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L1-L348)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L1-L312)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。
