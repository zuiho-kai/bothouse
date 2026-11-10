---
name: feature-depth-im-channel-hot-reconfig
description: IM 频道热重配实现深读：get_conf_revision 默认 0、重试延迟 2.0 秒倍增上限 60 秒、重配与 ChannelManager 耦合、set_conf 失败回滚配置字典、后台重试取舍、_stop_channel 5 秒/10 秒超时
metadata:
  scope: revision 计数、重试、set_conf 回滚与 _stop_channel 的细节；11 个频道的覆盖范围、校验与启用判定归 feature-im-channel-hot-reconfig
---
# IM Channel Hot Reconfiguration (_apply_channel_config lifecycle across 11 channels)：实现深读

## 现状

- [[feature-im-channel-hot-reconfig]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **ChannelManager.get_conf_revision returns the per-channel write revision, defaulting to 0** get_conf_revision(channel_id) returns self._conf_revisions.get(channel_id, 0),
  - so callers reading a channel that has never had a configuration write recorded observe revision 0. The retry helper consumes this value to detect newer configuration writes.
- 来源：[jiuwenswarm/gateway/channel_manager/channel_manager.py:L362–L364](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L362-L364),
  - [jiuwenswarm/gateway/app_gateway.py:L3191–L3196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3191-L3196)
- **Retry delay starts at 2.0s and backs off doubling capped at 60.0s per failed attempt** Inside _retry, delay_seconds starts at 2.0;
  - after each failed set_conf it is updated to min(delay_seconds * 2, 60.0) and expected_revision is re-read from channel_manager.get_conf_revision before the next attempt.
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3205–L3242](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3205-L3242)
- **Reapply is coupled to ChannelManager pop/stop and adapter registries; retry is coupled to get_conf_revision** The feishu/xiaoyi apply branches call channel_manager.pop_channels_by_id and _stop_channel, and lazily import the platform connect module only inside the non-empty-apps branch,
  - keeping heavy platform dependencies off disabled paths. _schedule_channel_config_retry depends on channel_manager.get_conf_revision(channel_name); a differing revision makes the retry stale.
- 来源：[jiuwenswarm/gateway/app_gateway.py:L2579–L2586](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2579-L2586),
  - [jiuwenswarm/gateway/app_gateway.py:L2729–L2745](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2729-L2745),
  - [jiuwenswarm/gateway/app_gateway.py:L3210–L3212](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3210-L3212)
- **ChannelManager.set_conf rolls back its config dict and re-raises when the rebuild callback throws** set_conf increments the channel's revision and stores a merged config before awaiting the on_config_updated callback; if that callback raises,
  - the previous config dict is restored and the exception propagates to the caller. Only the manager's config dict is restored — the shown lines state no guarantee about already-stopped integrations.
- 来源：[jiuwenswarm/gateway/channel_manager/channel_manager.py:L366–L387](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L366-L387)
- **Detached retry isolates optional-channel failures without blocking startup, at the cost of resurrection risk handled only by revision checks** 设计推断（非作者历史意图）：
- Benefit (documented in the docstring): retrying one failed optional channel avoids delaying Web/Cron startup.
  - Cost (inference): a stale snapshot could resurrect a config the user disabled, mitigated only by comparing get_conf_revision to expected_revision each 2–60s cycle; the reset-to-empty set_conf on error is another extra write that can itself fail and only be logged.
- 来源：[jiuwenswarm/gateway/app_gateway.py:L3197–L3203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3197-L3203),
  - [jiuwenswarm/gateway/app_gateway.py:L3229–L3239](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3229-L3239)
- **_stop_channel cancels the channel task, awaits it with a 5s timeout (or in background), stops the channel with a 10s timeout, then unregisters it** 在 app_gateway.py 的 _stop_channel 中：若 task 非空则 task.cancel()，非 background_wait 分支用 asyncio.wait_for(task, timeout=5.0) 等待，
  - TimeoutError/CancelledError/其他异常均只记 warning 或 pass；随后对非空 channel 调 channel.stop()（timeout=10.0，超时或异常仅记日志），最后 channel_manager.unregister_channel(channel.channel_id)。该本地分支不保证停止一定成功——超时后仅记录日志并继续注销。
- 来源：[jiuwenswarm/gateway/app_gateway.py:L2475–L2517](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2475-L2517)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-channel-hot-reconfig.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/channel_manager.py:L362-L364；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3191-L3196
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3205-L3242；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2579-L2586
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2729-L2745；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3210-L3212
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3197-L3203；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3229-L3239
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/channel_manager.py:L366-L387；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2475-L2517
- 源页字段（feature）：im-channel-hot-reconfig
- 入口（entry_points）：jiuwenswarm/gateway/app_gateway.py
- 源页字段（source_globs）：jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
