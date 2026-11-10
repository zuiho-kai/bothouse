---
name: feature-permissions-1
description: 工具权限与安全治理功能入口（上）：allow/ask/deny 综合判定的职责与边界、JiuwenSwarmPermissionInterruptRail 的声明入口、permissions.file_guard.* 示例配置键与生效条件
metadata:
  scope: 只收职责与边界、接口与调用入口、配置入口与生效条件三节；设计取舍、关联功能与验证步骤归 feature-permissions-2，实现级证据归 feature-depth-permissions
---
# 工具权限与安全治理 的职责、接口与配置（1/2）

## 关键事实

- 拆分说明：本页是源页 `feature-permissions.md` 的第 1/2 部分；第 2 部分 [[feature-permissions-2]]
- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-permissions.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/工具权限与安全防护.md
- 源页字段（feature）：permissions
- 入口（entry_points）：jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py；jiuwenswarm/server/*；jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/promptRouting.ts
  - jiuwenswarm/agents/harness/common/rails/permissions/audit.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/before_tool.py；jiuwenswarm/agents/harness/common/rails/permissions/auto_config.py
  - jiuwenswarm/agents/harness/common/rails/permissions/auto_decision.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/deny_response.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/deterministic.py
  - jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/domain_grant_audit.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/models.py；jiuwenswarm/agents/harness/common/rails/permissions/persistent_audit.py
  - jiuwenswarm/agents/harness/common/rails/permissions/auto_permission_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/lifecycle.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/reviewer_execution.py
  - jiuwenswarm/channels/web/frontend/src/components/ChatPanel/AutoReviewerStatus.tsx；jiuwenswarm/channels/cli/_terminal.py；jiuwenswarm/channels/cli/chat.py；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/common/config.py
  - jiuwenswarm/agents/harness/common/tools/file_delivery_policy.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/domain_manual.py
  - jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/manual_authorization.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/invocation_context.py；jiuwenswarm/agents/harness/common/rails/permissions/native_path_context.py
  - jiuwenswarm/agents/harness/common/rails/permissions/__init__.py；jiuwenswarm/agents/harness/common/rails/permissions/openjiuwen_contract.py；jiuwenswarm/server/runtime/extension_package_manager.py；jiuwenswarm/agents/harness/common/rails/permissions/permission_compose.py
  - jiuwenswarm/server/runtime/agent_adapter/permission_continuation.py；jiuwenswarm/agents/harness/common/rails/permissions/execution_provider_contract.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/PermissionWarningDialog.tsx
  - jiuwenswarm/agents/harness/common/rails/permissions/permissions_layers.py；jiuwenswarm/agents/harness/common/rails/interrupt/permission_options.py；jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py
  - jiuwenswarm/agents/harness/common/rails/permissions/permissions_config_rpc.py；jiuwenswarm/agents/harness/common/rails/permissions/permissions_persist.py；jiuwenswarm/server/runtime/agent_manager.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
  - jiuwenswarm/agents/harness/common/rails/permissions/protected_paths.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/readonly_tool_bindings.py；jiuwenswarm/agents/harness/common/rails/permissions/auto_reviewer.py
  - jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/reviewer_audit.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/reviewer_override_consume.py
  - jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/reviewer_override_gate.py；jiuwenswarm/agents/harness/common/rails/permissions/reviewer_redaction.py；jiuwenswarm/agents/harness/common/rails/permissions/reviewer_route.py
  - jiuwenswarm/agents/harness/common/rails/permissions/reviewer_stream_metadata.py；jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/reviewer_metadata.py；jiuwenswarm/agents/harness/common/rails/permissions/root_ask_user.py
  - jiuwenswarm/agents/harness/common/rails/permissions/root_context_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/root_context.py；jiuwenswarm/agents/harness/common/rails/permissions/root_permission_queue.py
  - jiuwenswarm/agents/harness/common/rails/permissions/root_permission_queue_rail.py；jiuwenswarm/runtime/permission_catalog.py；jiuwenswarm/agents/harness/common/rails/permissions/send_file_approval_scope.py
  - jiuwenswarm/agents/harness/common/rails/permissions/send_file_path_guard.py；jiuwenswarm/agents/harness/common/rails/permissions/session_deny.py；jiuwenswarm/server/runtime/agent_adapter/permission_runtime_state.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
  - jiuwenswarm/agents/harness/common/tools/bash_tool_safety.py；jiuwenswarm/agents/swarm/providers/member_rails.py；jiuwenswarm/agents/harness/team/rails/team_permission_policy_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/tool_capabilities.py
  - jiuwenswarm/agents/harness/common/rails/permissions/tool_decision_facts.py；jiuwenswarm/agents/harness/common/rails/permissions/tool_invocation_key.py；jiuwenswarm/agents/harness/common/rails/permissions/trusted_search_urls.py
  - jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/permissions.ts；jiuwenswarm/agents/harness/common/rails/permissions/url_safety.py
  - jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/AuthorizationPrompt.tsx；jiuwenswarm/channels/web/frontend/src/components/InteractionSlot/InteractionSlot.css；jiuwenswarm/agents/harness/common/workspace_paths.py；jiuwenswarm/server/front/connection.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 权限系统综合工具名称、参数、工作区和策略决定 allow、ask 或 deny。频道与宿主会影响审批能力，客户端的确认界面与服务端策略判定需要同时查证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L1–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L1-L274)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L1–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L1-L351)；
  - [docs/zh/工具权限与安全防护.md:L1–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%B7%A5%E5%85%B7%E6%9D%83%E9%99%90%E4%B8%8E%E5%AE%89%E5%85%A8%E9%98%B2%E6%8A%A4.md#L1-L366)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `JiuwenSwarmPermissionInterruptRail [update_config, set_trusted_dirs, installed_permission_config, resolve_interrupt, before_tool_call]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L1–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L1-L274)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L1–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L1-L351)；
  - [docs/zh/工具权限与安全防护.md:L1–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%B7%A5%E5%85%B7%E6%9D%83%E9%99%90%E4%B8%8E%E5%AE%89%E5%85%A8%E9%98%B2%E6%8A%A4.md#L1-L366)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `permissions.file_guard.enabled`、`permissions.file_guard.defaults.read`、`permissions.file_guard.defaults.write`、`permissions.file_guard.defaults.exec`、`permissions.file_guard.workspace.read`、`permissions.file_guard.workspace.write`、`permissions.file_guard.workspace.exec`、
  - `permissions.file_guard.paths`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L1–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L1-L274)；
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L1–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L1-L351)；
  - [docs/zh/工具权限与安全防护.md:L1–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%B7%A5%E5%85%B7%E6%9D%83%E9%99%90%E4%B8%8E%E5%AE%89%E5%85%A8%E9%98%B2%E6%8A%A4.md#L1-L366)。
