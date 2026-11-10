---
name: feature-depth-gateway-config-hot-reload
description: Gateway 热重载实现深读：_schedule_channel_config_retry 后台重试频道配置（2.0 秒起倍增、上限 60 秒、conf revision 校验、失败重置空配置）与 _schedule_gateway_restart 不 execv 的单测；_on_config_saved 的 reload_config 重试不在本页
metadata:
  scope: 频道配置重试任务与网关重启调度单测；_on_config_saved 的 agent.reload_config 重试、重启兜底与副作用归 feature-gateway-config-hot-reload
---
# Gateway Config-Save Hot Reload (agent.reload_config retry, restart fallback, browser/proactive side effects)：实现深读

## 现状

- [[feature-gateway-config-hot-reload]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **_schedule_channel_config_retry spawns a background _retry task that reapplies a failed channel config** 调用 _schedule_channel_config_retry 后创建名为 initial-channel-retry-<channel> 的 asyncio 任务：_retry 先 sleep 2.0s，若 channel_manager.get_conf_revision 仍等于 expected_revision 就 await set_conf 重放快照；
  - 成功记日志并 return，任务完成后从 channel_retry_tasks 集合移除。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3205–L3254](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3205-L3254)
- **Retry delay starts at 2.0s and doubles per failed attempt, capped at 60.0s** delay_seconds 初始 2.0；每次 set_conf 抛异常后 expected_revision 刷新且 delay_seconds = min(delay_seconds * 2, 60.0)，再 continue 进入下一轮。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3205–L3242](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3205-L3242)
- **Retry correctness depends on channel_manager's conf revision counter** _retry 通过 channel_manager.get_conf_revision(channel_name) 与 expected_revision 比较来取消，并用 channel_manager.set_conf 应用/回滚配置；注释说明 set_conf 在回调出错后会回滚可见快照，因此失败时还要 set_conf(channel_name, {}) 让变化检测器也回滚。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3211–L3241](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3211-L3241)
- **Revision mismatch cancels the retry; set_conf failure logs, resets to empty conf, and backs off** revision 不匹配时记 info 日志并 return（放弃重试）；set_conf 抛异常时记 warning，随后尝试 set_conf(channel_name, {})，若该重置也失败仅再记 warning，刷新 expected_revision 后按指数退避继续重试。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3211–L3242](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3211-L3242)
- **Background retry isolates optional channels but needs a revision guard against stale snapshots** 设计推断（非作者历史意图）：
- 推断：后台任务让失败的可选频道不阻塞启动（docstring 明示 'without delaying Web/Cron startup'），代价是必须靠 revision 比较防止用户在 Settings 改动后被旧启动快照复活配置；guard 缺失或 revision 未递增时会错误重放旧配置。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3197–L3216](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3197-L3216)
- **helper_unit test: _schedule_gateway_restart sets request event without execv** In tests/unit_tests/gateway/test_app_gateway_acp.py, the async test test_schedule_gateway_restart_sets_event_without_execv monkeypatches os.execv to record calls, constructs a GatewayRestartRequest,
  - calls _schedule_gateway_restart(restart_request, delay=0.0), then awaits restart_request.ready_event within 1.0s and asserts restart_request.requested is True and execv_calls == []. Coverage is limited to the restart-scheduling helper, not the agent.reload_config retry loop.
- 来源：[tests/unit_tests/gateway/test_app_gateway_acp.py:L175–L191](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/gateway/test_app_gateway_acp.py#L175-L191)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-gateway-config-hot-reload.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3205-L3254；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3205-L3242
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3211-L3241；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3211-L3242
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3197-L3216；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/gateway/test_app_gateway_acp.py:L175-L191
- 源页字段（feature）：gateway-config-hot-reload
- 入口（entry_points）：jiuwenswarm/gateway/app_gateway.py
- 源页字段（source_globs）：jiuwenswarm/gateway/app_gateway.py
