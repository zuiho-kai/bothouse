---
name: feature-video-agent-managed-task-service
description: Voice/Video Duplex Managed Agent Task Service：TaskService 公开入口与契约、构造参数与请求字段、command_id 幂等回执与取消行为、test_managed_tasks.py 覆盖的契约、重启时以 unknown 替代自动重放
metadata:
  scope: 只收 TaskService 持久队列、幂等与重启语义的功能概览；调度、校验与通知的实现证据归 feature-depth-video-agent-managed-task-service
---
# Voice/Video Duplex Managed Agent Task Service（持久队列、并发与不确定性语义）

## 现状

- **任务服务的公开入口与契约**
- `TaskService(store, executor, *, on_change, concurrency, notification_timeout)` 是核心构造入口，围绕一个注入的 Agent 执行器工作，与媒体/RPC 无关（模块 docstring 明示）。公开操作包括 `submit(owner, session, command_id, instruction, request)`、`get`、`list`、`modify`、`cancel`、`answer`、`reorder`、`snapshot`、`preempt` 和 `close`。
  - 生命周期上 `submit/get/list` 等都会先调用 `start()`：它通过 `portalocker` 独占租约文件，并把上一个进程遗留的 `running/cancelling/waiting_user` 任务标记为 `unknown`（"Execution ownership lost; tools were not replayed"），不自动重放。
  - 错误契约具体且可枚举：`submit` 校验 owner 为字符串、instruction 非空且 ≤16000 字符、`depends_on/resources` 各为 ≤32 个 ≤256 字符的非空字符串，否则 `ValueError`；`modify` 在 revision 不匹配或已有 successor 时抛 `TaskRevisionConflict`，`reorder` 在队列版本变化时抛 `QueueVersionConflict`。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L1–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L1-L16),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L34–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L34-L48),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L183–L236](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L183-L236),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L276–L279](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L276-L279)
- **构造参数与请求字段**
- 构造参数为 `TaskService(store, executor, *, on_change=None, concurrency=2, notification_timeout=2)`：concurrency 必须为正整数否则 `ValueError`，notification_timeout 限定 `on_change` 投递的 `asyncio.wait_for` 超时。任务 request 支持 `independent`（布尔）、`depends_on` 与 `resources`（各 ≤32 项、每项非空 ≤256 字符）；
  - `resources` 在提交时逐项 strip、反斜杠替换为 `/`、casefold 归一并去重，保存为排序列表。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L34–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L34-L48),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L193–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L193-L210)
- **幂等回执与取消行为**
- `submit` 以 command_id 查询回放记录，命中时返回既有任务并附 `reused: True`；`modify`、`cancel`、`answer` 命中回放时返回已存储的回执，`reorder` 则仅在显式传入 command_id 时才记录/回放。
  - 取消语义：`queued` 且无 `resume_answer` 的任务直接置 `cancelled`，其余非终态置 `cancelling` 并返回中文回执（"取消已受理，正在等待执行停止；尚未确认停止。" 等），随后异步调用 `executor.cancel` 并确认 `execution_settled` 后才落 `cancelled`。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L211–L235](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L211-L235),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L336–L374](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L336-L374),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L413–L428](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L413-L428)
- **test_managed_tasks.py 覆盖的关键契约**
- 测试通过可门控的假 Executor 驱动真实 TaskService。test_restart_does_not_replay_dispatched_effect 验证重启接管：close 后重开 store，运行中任务变 unknown、排队任务保持 queued，且重放的 submit 不会再次调用 executor。test_unconfirmed_stop_preserves_uncertainty 验证取消未确认（execution_settled 为假）时任务停在 cancelling、并发位不被释放。
  - test_queued_change_and_order_are_authoritative 验证队列版本的 reorder 冲突与排队中修改注入执行指令；test_running_changes_exact_binding_and_model_observation 与 test_context_write_failure_never_claims_success_or_replays 验证 checkpoint 的修改绑定、context_written/model_input_observed 状态迁移及写失败落 unknown。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L172–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py#L172-L194),
  - [jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L127–L144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py#L127-L144),
  - [jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L87–L106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py#L87-L106),
  - [jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L241–L267](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py#L241-L267)
- **重启时以“不确定”替代自动重放**
- Inference / 设计推断（非作者历史意图）：
- `start()` 接管独占租约后，把上一进程遗留的 `running/cancelling/waiting_user`（以及带 `resume_answer` 的排队任务）统一改写为 `unknown` 并记录错误 "Execution ownership lost; tools were not replayed"，同时把 `claimed` 的变更降级为 `unknown`，而不是重新派发。推断其取舍：代价是这些任务无法自动完成、需要用户重新介入；
  - 收益是避免对已经可能产生过工具副作用的执行做二次重放（对应测试 test_restart_does_not_replay_dispatched_effect 断言重开的替换服务不再调用 executor）。与容量策略一致地，`unknown` 任务不占并发额度但保留资源/依赖约束，即用吞吐换取确定性安全。
- Sources / 来源：[jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L55–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L55-L77),
  - [jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L86–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/backend/tasks/service.py#L86-L99),
  - [jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L172–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py#L172-L194)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-video-agent-managed-task-service.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L1-L16；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L34-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L183-L236；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L276-L279
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L193-L210；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L211-L235
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L336-L374；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L413-L428
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L172-L194
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L127-L144
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L87-L106
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/tests/backend/test_managed_tasks.py:L241-L267
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L55-L77；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/video_duplex/backend/tasks/service.py:L86-L99
- 源页字段（feature）：video-agent-managed-task-service
- 入口（entry_points）：jiuwenswarm/extensions/video_duplex/backend/tasks/service.py
- 源页字段（source_globs）：jiuwenswarm/extensions/video_duplex/backend/tasks/service.py；jiuwenswarm/extensions/video_duplex/backend/tasks/rail.py
