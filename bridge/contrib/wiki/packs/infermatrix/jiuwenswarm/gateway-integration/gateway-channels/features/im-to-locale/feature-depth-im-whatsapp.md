---
name: feature-depth-im-whatsapp
description: WhatsApp 频道实现深读：start 到 _reconnect_loop 启动链路与 5 秒重连、start 幂等守卫、WhatsAppChannelConfig 默认值（ws://127.0.0.1:19600/ws、node scripts/whatsapp-bridge.js）、send 两条静默守卫、enable_streaming 关闭时过滤 CHAT_DELTA、手动验证（未执行）
metadata:
  scope: 只收 WhatsApp 频道的逐函数实现细节与行为断言；职责、配置字段总览与验证建议归 feature-im-whatsapp
---
# WhatsApp 频道：实现深读

## 现状

- [[feature-im-whatsapp]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **启动链路：WhatsAppChannel.start 到重连循环** 调用方调用 WhatsAppChannel.start() 后，先按配置做守卫检查，置 self._running = True；若 auto_start_bridge 为真则 await self._start_bridge_process() 拉起本地桥进程，随后 asyncio.create_task 启动 self._reconnect_loop()（任务名 whatsapp-channel-connect）。
  - _reconnect_loop 在 while self._running 循环里反复 await self._connect_once()，任何非 CancelledError 异常仅记 warning，随后 asyncio.sleep(5) 再试。_connect_once 的实现不在提供的切片内，故链条止于 _reconnect_loop。
- 调用路径：`jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py`（`WhatsAppChannel.start`） → `jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py`（`WhatsAppChannel._reconnect_loop`）
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L67–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L67-L83),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L153–L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L153-L179),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L201–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L201-L209)
- **start() 的生命周期契约** start() 是幂等守卫式生命周期入口：已运行（self._running）时仅记 warning 并返回；config.enabled 为假或 bridge_ws_url 为空白时同样直接返回且不置位 _running。调用方义务是先确保 enabled=true 且 bridge_ws_url 非空，否则频道静默不启动（仅日志可见）。channel_id 属性恒返回 self.name（"whatsapp"）。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L67–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L67-L83),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L57–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L57-L58)
- **WhatsAppChannelConfig 默认值** enabled 默认 False（需显式开启），bridge_ws_url 默认 "ws://127.0.0.1:19600/ws"，auto_start_bridge 默认 False，bridge_command 默认 "node scripts/whatsapp-bridge.js"。auto_start_bridge 仅在其为真时使 start() 调 _start_bridge_process；
  - bridge_workdir 为空字符串时回退为 Path(__file__).resolve().parents[1]，bridge_env 逐项覆盖到 os.environ 副本之上。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L24–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L24-L33),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L162–L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L162-L168)
- **延迟导入 websockets 连本机 bridge（默认 ws://127.0.0.1:19600/ws），失败进入 5 秒重连循环** `_connect_once` 内 `import websockets` 并连接 `bridge_ws_url`（默认 `ws://127.0.0.1:19600/ws`）；异常被 `_reconnect_loop` 捕获记 warning 后 `asyncio.sleep(5)` 重试。`auto_start_bridge` 生效还需 `bridge_command` 非空，为空时只记 warning 不拉起进程。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L24–L30](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L24-L30),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L211–L219](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L211-L219),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L201–L209](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L201-L209),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L157–L160](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L157-L160)
- **send()：_ws 为 None 时静默 return；WhatsApp 未连接时告警后 return（两条守卫均在构帧之前）** send() 中，`self._ws is None` 的守卫直接 return 且不记任何日志；`not self._whatsapp_connected` 时记录 "WhatsAppChannel send skipped: WhatsApp not connected (state=%s)"（携带 _bridge_state）后 return。两条守卫都在构造 {"type":"send",...} 帧之前结束本次调用，本次调用不发送。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L107–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L107-L112),
  - [jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L129–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L129-L135)
- **文档化手动验证：项目根目录运行 `python -m jiuwenswarm.app`（NOT EXECUTED）** 文档中的人工验收步骤（本轮未执行）：
- docs/zh/海外频道.md 记录：在项目根目录运行 `python -m jiuwenswarm.app`，预期应用日志显示 `WhatsAppChannel` 已注册，频道先进入 `bridge_connected`，再按登录状态进入 `connecting`、`qr_pending` 或 `open`。显式标记 NOT EXECUTED：本次仅引用文档，未实际运行。
- 来源：[docs/zh/海外频道.md:L541–L552](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L541-L552)
- **WhatsApp send 关闭 enable_streaming 时仅过滤 event 型 CHAT_DELTA 的局部取舍** 设计推断（非作者历史意图）：
- `send` 在 `_ws` 为 None 或 `_whatsapp_connected` 为假时已先返回；仅当 `enable_streaming` 关闭且消息为 `type == "event"` 的 `EventType.CHAT_DELTA` 时才提前返回，空文本或无目标 jid 亦返回。推断收益：非流式下减少增量出站帧；代价：该场景不逐段下发增量内容，且此开关并非唯一发送条件。
- 来源：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L107–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L107-L135)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-im-whatsapp.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L67-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L153-L179
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L201-L209
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L57-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L24-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L162-L168
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L24-L30
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L211-L219
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L157-L160；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/海外频道.md:L541-L552
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L107-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L129-L135
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L107-L135
- 源页字段（feature）：im-whatsapp
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/*
