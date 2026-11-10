---
name: feature-depth-heartbeat
description: 绑定会话的心跳续跑任务实现深读：网关代理 HeartbeatControllerProxy 的错误码到异常映射、_DEFAULT_LIMITS 资源限制默认值（每会话 5、全局 100）、delete_job 的 KeyError/取消失败 RuntimeError 守卫、controller 与 scheduler/store 联动、create 参数校验单测、未准入到期任务 skip_and_reschedule 不补跑的取舍
metadata:
  scope: 只收 heartbeat controller、models 与网关 proxy 的实现级证据；功能概览、schedule 与并发策略配置和验证步骤归 feature-heartbeat
---
# 绑定会话的心跳续跑任务：实现深读

## 现状

- [[feature-heartbeat]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **网关代理的错误码到异常映射** HeartbeatControllerProxy._request 把操作包装为 ReqMethod.HEARTBEAT_JOB 的 Message 经 agent_client 发送；响应失败时按 payload.code 映射异常：BAD_REQUEST→ValueError、FORBIDDEN→PermissionError、NOT_FOUND→KeyError、CONFLICT→RuntimeError、SERVICE_UNAVAILABLE→HeartbeatServiceUnavailableError。调用方需按这些异常类型处理失败。
- 来源：[jiuwenswarm/gateway/heartbeat/proxy.py:L25–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L25-L66)
- **资源限制默认值与 config 覆盖** controller 的 _DEFAULT_LIMITS 给出 max_active_jobs_per_session=5、max_active_jobs_global=100、min_interval_seconds=MIN_INTERVAL_SECONDS 等默认值，注释声明可被 config 覆盖；create_job 中 max_runs 缺省取 default_max_runs，source 缺省取 SOURCE_WEB_RPC（"web_rpc"）。
- 来源：[jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L71–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L71-L80),
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L278–L380](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L278-L380)
- **delete_job：无主任务抛 KeyError，有活跃 run 先取消，取消失败即中止删除** `_owned_job` 返回 None 即抛 KeyError('job not found')；`run_state.current_run_id` 非空时先 `await _scheduler.cancel_run(job_id, pause_schedule=True)`，cancel_status=='failed' 则抛 RuntimeError 且不删除；
  - 否则 `_store.delete_job` 后 `await _scheduler.reload()`，本地返回 `{'deleted': bool(deleted)}`。
- 来源：[jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L452–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L452-L479)
- **controller 守卫式联动 scheduler 与 store；网关代理仅持 agent_client 转发** controller 导入 HeartbeatSchedulerService 与 HeartbeatJobStore；delete_job 仅在 run_state.current_run_id 非空时调 _scheduler.cancel_run(pause_schedule=True)，cancel_status=="failed" 即抛 RuntimeError 中止，否则 _store.delete_job 后再 _scheduler.reload()。
  - 网关 HeartbeatControllerProxy.__init__ 只保存 agent_client，delete_job 经 self._request("delete", channel_id="web") 转发。
- 来源：[jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L47–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L47-L48),
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L453–L471](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L453-L471),
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L22–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L22-L23),
  - [jiuwenswarm/gateway/heartbeat/proxy.py:L133–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/heartbeat/proxy.py#L133-L146)
- **delete_job：无主任务 KeyError；cancel_status=='failed' 时 RuntimeError 且跳过 store 删除** delete_job 中 _owned_job 返回 None 抛 KeyError('job not found')；
  - guard：current_run_id 非空且 cancel_result['cancel_status']=='failed' 时，在 self._store.delete_job 之前抛 RuntimeError("cannot delete heartbeat job while its active run could not be cancelled")，任务保留在 store。
- 来源：[jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L453–L472](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py#L453-L472)
- **create 参数校验与新任务默认值有运行时断言测试** `test_web_rpc_create_requires_channel_and_session` 用 pytest.raises 断言 `ctrl.create_job`(source='web_rpc') 缺 channel_id/session_id 分别抛 'channel_id is required'/'session_id is required'；
  - `test_create_job_assigns_id_and_defaults` 断言 `store.create_job` 后 id 以 'hb_' 开头、status==STATUS_SCHEDULED、run_count==0、metadata['source']==SOURCE_AGENT_TOOL。
- 来源：[tests/unit_tests/agentserver/test_heartbeat_controller.py:L84–L90](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_heartbeat_controller.py#L84-L90),
  - [tests/unit_tests/agentserver/test_heartbeat_store.py:L46–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_heartbeat_store.py#L46-L58)
- **过会话/enabled/状态/queued/due 检查后未准入的到期任务：skip_and_reschedule 按 now 重算、不补跑** 设计推断（非作者历史意图）：
- _handle_job_tick 经 suspended 会话、enabled、状态、queued-run 与 due 检查（L318–338）后，未准入任务才调用 skip_and_reschedule(reason="resource_admission_limit_exceeded")，next_run_at=compute_next_run(job,now)：interval 得 now+max(60,interval_seconds)，过期 once 得 None，
  - cron 仅 next_cron_datetime 异常被捕获得 None（ZoneInfo 构造在 try 外）。推断：收益是默认 max_active_jobs_per_session=5、max_active_jobs_global=100 的准入控制，代价是该次到期执行被跳过且按 now 重算不补跑。
- 来源：[jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py:L262–L304](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py#L262-L304),
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py:L314–L351](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py#L314-L351),
  - [jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py:L605–L633](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py#L605-L633)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-heartbeat.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/heartbeat/proxy.py:L25-L66；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L71-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L278-L380；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L452-L479
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_heartbeat_controller.py:L84-L90；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_heartbeat_store.py:L46-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L453-L472；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L47-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py:L453-L471；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/heartbeat/proxy.py:L22-L23
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/heartbeat/proxy.py:L133-L146；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py:L262-L304
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py:L314-L351；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/heartbeat/scheduler.py:L605-L633
- 源页字段（feature）：heartbeat
- 入口（entry_points）：jiuwenswarm/agents/harness/code/rails/heartbeat/models.py；jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py；jiuwenswarm/gateway/heartbeat/proxy.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/code/rails/heartbeat/models.py；jiuwenswarm/agents/harness/code/rails/heartbeat/controller.py；jiuwenswarm/gateway/heartbeat/proxy.py
