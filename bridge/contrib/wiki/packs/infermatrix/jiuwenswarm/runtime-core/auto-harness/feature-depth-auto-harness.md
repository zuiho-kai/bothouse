---
name: feature-depth-auto-harness
description: Auto Harness 评测优化实现深读：AutoHarnessService 模型环境变量回退与 git 分支默认值、cancel_session_run 与 request_cancellation 取消路径、TaskStore.get_logs、Scheduler 的 auto_accept=True 耦合与取舍、生命周期单测断言
metadata:
  scope: 只收 Auto Harness 的逐点实现深读（配置、流程、API、依赖、失败、取舍、验证七类）；功能入口级知识归 feature-auto-harness，Package 与热激活的实现深读归 feature-depth-rsi-packages
---
# Auto Harness 评测优化：实现深读

## 现状

- [[feature-auto-harness]]（功能概览） · [[auto-harness-overview]]（owner 入口）
- **模型回退配置与环境变量** 当请求未携带 Model 时，AutoHarnessService._build_model_from_env 依次读取环境变量 API_KEY、API_BASE（回退 BASE_URL）、MODEL_NAME（回退 MODEL）；API_KEY 或 MODEL_NAME 缺失时记录 warning 并返回 None，否则以 temperature=0.95 构造 Model。
  - git 分支默认值方面：git_base_branch 未设置时默认 "develop"，且 pipeline_preference 为 EXTENDED_EVOLVE_PIPELINE 时强制 "develop"；git_remote 未设置时默认 "origin"。
- 来源：[jiuwenswarm/agents/harness/common/auto_harness/service.py:L961–L980](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/service.py#L961-L980),
  - [jiuwenswarm/agents/harness/common/auto_harness/service.py:L880–L958](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/service.py#L880-L958)
- **cancel_session_run：查无活跃运行返回 False，否则置 cancelled、停编排器（该调用无 try/except）与任务后局部返回 True** 适配器 interrupt(cancel) 在 _auto_harness_service 非空且 has_active_run(request.session_id) 为真时调用 cancel_session_run：置 active_run.cancelled=True，orchestrator 非空则调用其 cancel()（此处无异常保护），task 未 done 则 task.cancel()，
  - 最后局部返回 True；查无活跃运行时返回 False。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L13664–L13677](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L13664-L13677),
  - [jiuwenswarm/agents/harness/common/auto_harness/service.py:L2292–L2310](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/service.py#L2292-L2310)
- **TaskStore.get_logs：默认参数、未知任务守卫与 log_type == "current" 分支返回** 签名为 get_logs(task_id, log_type, history_index=-1, offset=0, limit=500)；task 不存在时返回 {"error": "任务不存在", "task_id": ...}。可见的 log_type == "current" 分支要求 task 的 current_execution_id，缺失时返回 {"error": "当前无正在执行的日志", "task_id": ...}；
  - 存在时经 asyncio.to_thread 读取 _runs_dir/<task_id>/<current_execution_id>/log.json，返回 logs、execution_id、type="current"、total_lines、is_running（status == "running"）、has_more（offset + len(logs) < total_lines）。
- 来源：[jiuwenswarm/agents/harness/common/auto_harness/task_store.py:L367–L406](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/task_store.py#L367-L406)
- **Scheduler/service/orchestrator/AgentServer 适配器的直接耦合** Scheduler 经 self._service.run() 复用 service 执行（注释明示定时运行无交互频道，故传 auto_accept=True）；service 的 chunk 来源耦合 orchestrator.run_session_stream；AgentServer deep 适配器在 interface_deep.py:16099 调用同一 run()。
- 来源：[jiuwenswarm/agents/harness/common/auto_harness/scheduler.py:L355–L358](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/scheduler.py#L355-L358),
  - [jiuwenswarm/agents/harness/common/auto_harness/service.py:L1808–L1809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/service.py#L1808-L1809),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L16099–L16099](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L16099-L16099)
- **request_cancellation：orchestrator.cancel() 抛 Exception 时仅记日志并继续取消 producer_task** 触发条件为 orchestrator 非 None 且其 cancel() 抛出 Exception；except 分支以 logger.exception 记录 "[AutoHarnessService] Orchestrator cancellation failed"，异常不向外传播，随后仍对未 done 的 producer_task 调用 cancel()。
- 来源：[jiuwenswarm/agents/harness/common/auto_harness/service.py:L1215–L1230](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/service.py#L1215-L1230)
- **定时运行固定 auto_accept=True：无人值守收益 vs 放弃人工确认（代价为推断）** 设计推断（非作者历史意图）：
- 定时运行因"无交互频道"固定 auto_accept=True（源码注释），文档称扩展包默认自动激活生效、无需用户手动确认；收益是无人值守自动闭环，代价是缺少人工确认关口——代价权衡为我的推断。
- 来源：[jiuwenswarm/agents/harness/common/auto_harness/scheduler.py:L355–L358](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_harness/scheduler.py#L355-L358),
  - [docs/zh/AutoHarness.md:L113–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L113-L113)
- **lifecycle 与 issue-runner 单测的运行时断言（未在本次执行）** @pytest.mark.asyncio 的 lifecycle 用例真实调用 service._settle_owned_run，断言 producer_task.done() 且 isinstance(producer_task.exception(), RuntimeError)；issue runner 用例断言 dry_run 时 service.queries==[]（这些是测试源码中的断言，本次未执行）。
- 来源：[tests/unit_tests/agentserver/test_auto_harness_service_lifecycle.py:L96–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_auto_harness_service_lifecycle.py#L96-L113),
  - [tests/unit_tests/auto_harness/test_gitcode_issue_runner.py:L134–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/auto_harness/test_gitcode_issue_runner.py#L134-L137)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/auto-harness/feature-depth-auto-harness.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/service.py:L961-L980；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/service.py:L880-L958
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/scheduler.py:L355-L358；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/service.py:L1808-L1809
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L16099-L16099；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/AutoHarness.md:L113-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_auto_harness_service_lifecycle.py:L96-L113；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/auto_harness/test_gitcode_issue_runner.py:L134-L137
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/service.py:L1215-L1230；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L13664-L13677
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/service.py:L2292-L2310；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_harness/task_store.py:L367-L406
- 源页字段（feature）：auto-harness
- 入口（entry_points）：jiuwenswarm/agents/harness/common/auto_harness/service.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/auto_harness/service.py；jiuwenswarm/agents/harness/common/auto_harness/*
