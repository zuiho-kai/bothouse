---
name: feature-im-channel-hot-reconfig
description: IM 频道热重配概览（英文标题）：_apply_channel_config 对 11 个频道键的差异驱动停启、_stop_channel 流程、feishu/feishu_enterprise 多实例、写配置前校验、频道启用判定与 WeChat 默认值
metadata:
  scope: 热重配循环、覆盖频道、参数校验、回调契约与启用判定；get_conf_revision、后台重试与 set_conf 回滚的实现细节归 feature-depth-im-channel-hot-reconfig
---
# IM Channel Hot Reconfiguration (_apply_channel_config lifecycle across 11 channels)

## 现状

- **Diff-driven stop/rebuild loop over channel_manager and IM adapters**
- Control flow: `_should_restart_channel` compares old vs new per-channel config dicts (restart when presence differs or contents differ) and union with `channel_manager.pop_channel_restart_pending()` for forced restarts;
  - only channels in `changed_channels` are torn down and rebuilt (app_gateway.py:2466-2473, 2550-2573).
  - Teardown is centralized in `_stop_channel`: cancel the asyncio task (5s wait, or background wait), `channel.stop()` with a 10s timeout, then `channel_manager.unregister_channel`; feishu/xiaoyi multi-app instances are discovered via `channel_manager.pop_channels_by_id`,
  - and digital-avatar adapters are unregistered/registered on `im_inbound`/`im_outbound` buses.
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L2466–L2517](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2466-L2517),
  - [jiuwenswarm/gateway/app_gateway.py:L2576–L2643](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2576-L2643)
- **支持的频道与实例形态**
- 重配循环覆盖 11 个频道键：feishu、feishu_enterprise、xiaoyi、dingtalk、telegram、whatsapp、discord、slack、wecom、wechat、ssh（app_gateway.py:2552-2564）。feishu 支持 `apps` 列表多实例，所有实例共享 channel_id "feishu"，各自 `asyncio.create_task(channel.start())` 且任务挂在 `channel.start_task` 上；
  - `group_digital_avatar` 为真时创建 FeishuIMPlatformAdapter 并注册到 im_inbound/im_outbound（app_gateway.py:2591-2643）。feishu_enterprise 以 bot_key→配置的映射管理，channel_id 为 `feishu_enterprise:{app_id}`，同样支持数字分身 adapter（app_gateway.py:2669-2721）。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L2552–L2564](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2552-L2564),
  - [jiuwenswarm/gateway/app_gateway.py:L2591–L2643](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2591-L2643),
  - [jiuwenswarm/gateway/app_gateway.py:L2669–L2721](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2669-L2721)
- **写配置前的参数校验**
- Web 处理器在写配置前做输入校验：非 dict 的 params 返回 `BAD_REQUEST`（如 feishu set_conf、whatsapp/discord/slack/wecom/wechat set_conf，app_web_handlers.py:4023-4031, 4277-4285）。
  - wechat set_conf 额外调用 `_validate_wechat_numeric_params`，在 `set_conf` 之前拒绝负数/0/极大值/浮点越界/非数字的数值参数并返回 `BAD_REQUEST`（app_web_handlers.py:4490-4500）。feishu set_conf 在持久化前先 `_normalize_feishu_conf` 归一化 apps（app_web_handlers.py:4040-4046）。
- Sources / 来源：[jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L4023–L4046](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L4023-L4046),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L4277–L4288](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L4277-L4288),
  - [jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L4490–L4503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py#L4490-L4503)
- **_apply_channel_config 回调契约**
- `_apply_channel_config(conf: dict)` 由 `_run` 协程定义并通过 `channel_manager.set_config_callback` 注册（app_gateway.py:3112），频道实例与 `_last_channels_conf` 等状态是 `_run` 的局部变量，经 nonlocal 声明修改（L2528-L2538），不是模块级状态。
  - 停止路径 `_stop_channel(channel, task, channel_name, background_wait=False)` 默认同步 `await asyncio.wait_for(task, timeout=5.0)` 等待取消、`channel.stop()` 以 10 秒超时（L2495, L2512）；`background_wait=True` 时改为 `asyncio.create_task(wait_cancel())` 后台等待，取消无需在 stop/unregister 之前完成（L2478-L2492, L2510-L2517）。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L2466–L2517](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2466-L2517),
  - [jiuwenswarm/gateway/app_gateway.py:L2528–L2538](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2528-L2538),
  - [jiuwenswarm/gateway/app_gateway.py:L3112–L3112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3112-L3112)
- **频道启用判定与 Wechat 默认值**
- `_is_channel_enabled(conf, required_fields)` 在 `enabled` 键存在时以其布尔值为准；键值为 None（如显式 enabled: null）时退化为检查必填字段是否全部非空（app_gateway.py:2519-2526）。
  - WeChat 块使用空的 required_fields 列表并填充默认值，如 `base_url` 默认 `https://ilinkai.weixin.qq.com`、`auto_login` 默认 True、`qrcode_poll_interval_sec` 2.0、`long_poll_timeout_sec` 45、backoff 1.0–30.0 秒、credential_file 默认 `~/.wx-ai-bridge/credentials.json`（L3008-3024）。
  - 注意 WhatsApp 不走 `_is_channel_enabled`，在 L2922-2926 内联判定（enabled 缺省时以 bridge_ws_url 非空为准）。
- Sources / 来源：[jiuwenswarm/gateway/app_gateway.py:L2519–L2526](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2519-L2526),
  - [jiuwenswarm/gateway/app_gateway.py:L3001–L3024](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L3001-L3024),
  - [jiuwenswarm/gateway/app_gateway.py:L2922–L2926](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2922-L2926)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-im-channel-hot-reconfig.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2466-L2517；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2576-L2643
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2552-L2564；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2591-L2643
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2669-L2721；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L4023-L4046
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L4277-L4288；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py:L4490-L4503
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2528-L2538；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3112-L3112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2519-L2526；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L3001-L3024
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py:L2922-L2926
- 源页字段（feature）：im-channel-hot-reconfig
- 入口（entry_points）：jiuwenswarm/gateway/app_gateway.py
- 源页字段（source_globs）：jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py
