---
name: feature-depth-digital-avatar
description: 群聊数字分身实现深读：AvatarPromptRail 对 owner_scopes ContextVar 的耦合、记忆工具拒绝路径、check_avatar_permission 契约与缺上下文一律 deny 的取舍、运行时单测
metadata:
  scope: 只收数字分身 Rail 与 owner 权限检查的钩子、分支与单测断言；功能概览归 feature-digital-avatar
---
# 群聊数字分身与 owner 权限：实现深读

## 现状

- [[feature-digital-avatar]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **Rail 对 owner_scopes ContextVar 的耦合** AvatarPromptRail 不持有自己的状态源，两个钩子都通过 TOOL_PERMISSION_CONTEXT.get() 读取 owner_scopes 模块设置的 PermissionContext；perm_ctx 为 None 时直接返回不注入。
  - 此外 current_permission_owner_scope 用 (channel_id, principal_user_id) 组成 "principal:{channel}:{user}" 令牌供 workspace 溯源，说明身份与工作区归属共用同一上下文，改动字段名会同时影响两处。
- 来源：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L43–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L43-L119),
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L104–L114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L104-L114)
- **受限记忆工具的拒绝路径** before_tool_call 中 enable_memory=False 且群聊数字分身时，write_memory/edit_memory/read_memory/memory_search/memory_get 五个工具全部经 _reject_tool 拒绝，返回 "[PERMISSION_DENIED] 记忆系统已禁用，禁止访问"；仅群聊数字分身（记忆可用）时只拒写工具，消息为 "[PERMISSION_DENIED] 群聊模式下禁止写入/编辑记忆文件"。
  - _reject_tool 置 ctx.extra["_skip_tool"]=True 并直接写 tool_result 与 ToolMessage，跳过真实执行。
- 来源：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L121–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L121-L161),
  - [jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L164–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L164-L170)
- **AvatarPromptRail.before_tool_call 回调：无 perm_ctx 直接返回；禁记忆时拒五种记忆工具，仅群聊分身时拒写入** 回调以 ctx.inputs.tool_name 为输入，TOOL_PERMISSION_CONTEXT.get() 为 None 时直接 return。
  - enable_memory=False 且 group_digital_avatar、avatar_mode 同真时，五种记忆工具（含 read_memory、memory_search、memory_get）被 _reject_tool："[PERMISSION_DENIED] 记忆系统已禁用，禁止访问"；否则 group_digital_avatar 且 avatar_mode 时仅 _MEMORY_WRITE_TOOLS 被拒："[PERMISSION_DENIED] 群聊模式下禁止写入/编辑记忆文件"。
- 来源：[jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L121–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/avatar_rail.py#L121-L161)
- **check_avatar_permission 契约：返回 allow/deny，ask 降级为 deny，调用方入口 setup、finally cleanup** check_avatar_permission(tool_name, tool_args, channel_id, session_id, *, permission_config, use_installed_permissions=False, installed_engine=None) 返回 "allow"/"deny"（ask 自动降级为 deny）；
  - 模块 docstring 要求入口调用 setup、finally 调 cleanup。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L117–L127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L117-L127),
  - [jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L7–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L7-L11)
- **owner_scopes 按 channel+principal 查找；空或非 dict 配置默认 allow** 工具级别按 owner_scopes[channel_id][principal_user_id] 查找，owner_scopes 为空或非 dict 时默认 allow；启用需在飞书频道配置打开 group_digital_avatar 开关并配置 my_user_id/bot_name。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L170–L181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L170-L181),
  - [docs/zh/国内频道.md:L211–L215](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L211-L215)
- **check_avatar_permission 缺上下文或引擎不可用时一律 deny 的收益与代价（推断）** 设计推断（非作者历史意图）：
- 事实：perm_ctx 为 None 或 principal_user_id 为空、以及 use_installed_permissions 下 installed_engine 缺可调用 evaluate_global_policy_directly 时，均 return "deny"。推断收益：无有效分身上下文的工具调用不会放行；推断代价：入口未 setup 上下文或缺 principal 的合法调用同样被一律拒绝。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L150–L160](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py#L150-L160)
- **运行时单测断言 owner scope 复位与场景钩子 owner_scopes 拒绝结果** test_setup_permission_context_uses_non_avatar_principal_metadata 断言 scope 为 principal:web:principal-42、cleanup 后为空；场景钩子测试断言返回 reject 与 [PERMISSION_DENIED] 该工具未被授权 (owner_scopes: deny)。
- 来源：[tests/unit_tests/agentserver/permissions/test_owner_scopes_context.py:L31–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_owner_scopes_context.py#L31-L50),
  - [tests/unit_tests/agentserver/permissions/test_installed_permission_snapshot.py:L92–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_installed_permission_snapshot.py#L92-L103)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-digital-avatar.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L43-L119；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L104-L114
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L121-L161；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/avatar_rail.py:L164-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L117-L127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L7-L11
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L170-L181；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/国内频道.md:L211-L215
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_owner_scopes_context.py:L31-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_installed_permission_snapshot.py:L92-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py:L150-L160
- 源页字段（feature）：digital-avatar
- 入口（entry_points）：jiuwenswarm/agents/harness/common/rails/avatar_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/rails/avatar_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/owner_scopes.py
