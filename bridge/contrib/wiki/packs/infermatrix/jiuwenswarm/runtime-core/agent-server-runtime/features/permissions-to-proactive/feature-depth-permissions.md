---
name: feature-depth-permissions
description: 工具权限与安全治理实现深读：SendFilePathGuardEvaluator checker 构造失败与 workspace 解析失败的传播、permission_scene_hook 裁决、_persist_allow_always 分支、畸形 external_paths 失败关闭为 ask、before_tool_call 委托基类、策略合并取最严候选的取舍、DENY 桩结果单测
metadata:
  scope: 收 permission_interrupt_rail.py 与 policy_eval.py 的实现级证据，来源另含 send_file_path_guard.py、test_policy_eval.py；功能概览与 permissions.file_guard 示例配置键归 feature-permissions-1、feature-permissions-2
---
# 工具权限与安全治理：实现深读

## 现状

- [[feature-permissions-1]]、[[feature-permissions-2]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **checker 构造失败与 workspace 解析失败的传播** SendFilePathGuardEvaluator.evaluate 中 build_file_guard_checker 抛出的任何异常都被捕获并转为 reason 为 send_file_path_guard_checker_failed 的不可评估结果（不向调用方抛出）；
  - _sync_engine_workspace_root 在 resolver 抛 OSError/RuntimeError/TypeError/ValueError 时仅记 debug 日志并直接返回，不更新 engine 的 workspace 也不重建 file_guard。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/send_file_path_guard.py:L112–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/send_file_path_guard.py#L112-L123),
  - [jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L71–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L71-L82)
- **场景钩子裁决路径：仅当宿主暴露可调用 permission_scene_hook 时参与** 构造 PermissionSceneHookInput(ctx, tool_call, user_input=None, …) 后调用宿主钩子，可等待则 await；"approve" 映射 allow（reason=scene_hook_approved），"reject" 映射 deny（reason 默认 scene_hook_rejected），非元组或其余决策返回 None。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L158–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L158-L207)
- **_persist_allow_always：回调存在且有活动 attempt 才返回其布尔值，其余分支返回 False 或转交 super()** 设置了 _exact_persist_callback 且 _EXACT_PERSIST_ATTEMPT.get() 非 None 时，标记 attempt.attempted=True 并返回 bool(callback(normalized_name, dict(tool_args), accesses))；无活动 attempt 或回调抛 Exception 返回 False；
  - 未设回调转交 super()._persist_allow_always。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L180–L198](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L180-L198)
- **_evaluation_from_permission_result 对非 deny 级别在畸形 external_paths 上失败关闭为 ask** external_paths 非 list 或条目数超过 _MAX_EXTERNAL_PATHS（64）时 _validated_external_paths 返回 None；此时非 deny 级别在该函数返回值中被改写为 ask，reason="malformed_policy_external_paths"、source="fail_closed"。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L24–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L24-L30),
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L272–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L272-L281),
  - [jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L290–L294](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L290-L294)
- **before_tool_call：无非权限恢复时委托 openjiuwen 基类 PermissionInterruptRail 并标记权限中断请求** root_nonpermission_resume_from_context(ctx) 非 None 时 before_tool_call 直接返回；否则同步 workspace root 后 await super().before_tool_call(ctx)（基类来自 openjiuwen.harness.security 的 PermissionInterruptRail）；
  - 捕获 AbortError 且 cause.request 非 None 时调用 mark_permission_interrupt_request(ctx, request) 再原样 re-raise。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L14–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L14-L17),
  - [jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L260–L271](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py#L260-L271)
- **策略合并取最严候选：级别不弱于任一候选，但 reason 仅来自最严候选（推断）** 设计推断（非作者历史意图）：
- _strictest_evaluation 在 L332–L334 过滤 None 候选后按 {ALLOW:0, ASK:1, DENY:2}、未知级别按 1 取最严候选；L344–L346 显示返回的 PolicyEvaluation 的 level 与 reason 均取自该候选。推断收益：在该优先级比较下合并级别不弱于任一候选；推断代价：较宽候选的去重匹配规则（L335–L340 收集）不会体现在返回的 reason 字段。
- 来源：[jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L328–L346](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py#L328-L346)
- **DENY 桩结果下真实 OpenJiuwenPolicyEvaluator 的运行时测试（不触发确认回调）** test_policy_only_returns_deny_without_triggering_confirmation 用固定返回 DENY（reason="blocked by rule"、matched_rule="deny_readme"）的 FakeEngine 与 FakeRail 包裹真实 OpenJiuwenPolicyEvaluator；
  - await evaluate(_invocation())（read_file/README.md）后断言 level=="deny"、reason 与 matched_rule 透传、FakeRail.confirmation_calls==0、engine.calls 仅含 ("read_file", {"path": "README.md"})。覆盖限于所示桩策略结果，不证明真实规则引擎或用户确认界面。
- 来源：[tests/unit_tests/agentserver/permissions/test_policy_eval.py:L1–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_policy_eval.py#L1-L17),
  - [tests/unit_tests/agentserver/permissions/test_policy_eval.py:L20–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_policy_eval.py#L20-L80),
  - [tests/unit_tests/agentserver/permissions/test_policy_eval.py:L95–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/permissions/test_policy_eval.py#L95-L124)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-permissions.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/send_file_path_guard.py:L112-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L71-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L158-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L180-L198
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L14-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py:L260-L271
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L24-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L272-L281
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L290-L294
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py:L328-L346；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_policy_eval.py:L1-L17
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_policy_eval.py:L20-L80；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/permissions/test_policy_eval.py:L95-L124
- 源页字段（feature）：permissions
- 入口（entry_points）：jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py；jiuwenswarm/agents/harness/common/rails/permissions/policy_eval.py；jiuwenswarm/server/*
