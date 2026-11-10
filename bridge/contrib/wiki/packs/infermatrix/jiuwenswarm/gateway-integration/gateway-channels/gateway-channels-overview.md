---
name: gateway-channels-overview
description: Gateway 与频道目录入口：CLI 频道与进程式 CLI 频道两页的定位、触发词与 PR 命中表（jiuwenswarm/channels 下源码入口）、专题与功能知识页清单
metadata:
  scope: 只收本目录的入口导览、代码快速入口表与专题页清单；审查规则见 gateway-channels-rules，进程式 CLI 机器执行见 jiuwenswarm-process-cli-machine，设计取舍见 gateway-channels-design-tradeoffs
---
# Gateway 与频道

## 现状

- [[jiuwenswarm-channels-cli]]（CLI 频道（jiuwenswarm/channels/cli）） — `jiuwenswarm chat` 的连接握手（connection.ack）、chat.send 请求与 agent_ref、SIGINT 中断、team/plan 终止判定和 human/JSON/JSONL 三种渲染。
- [[jiuwenswarm-channels-process-cli]]（进程式 CLI 频道（process_cli）） — REPL 每命令一个 worker 与斜杠命令、app.run 会话操作提交时机、机器模式的 SessionLease/Agent 绑定与停机顺序。
- 两页都覆盖 `jiuwenswarm/channels/` 下的频道实现；Gateway 自身的网络协议与路由不在这里。

### 代码快速入口（Direct）

<!-- kb-init:quick-map -->

- 触发词：cli、chat、命令行、CLI 频道、gateway client、websocket、tui、renderer、jsonl、spinner、SIGINT、受信目录。PR 描述或改动命中下表一行时，先读该行的规则，再读页面其余部分。

| PR 描述在做什么 | 精确规则 | 第一批 live 源码 |
|---|---|---|
| cli、chat、命令行、CLI 频道、gateway client、websocket、tui、renderer、jsonl、spinner、SIGINT、… | 入口 | `jiuwenswarm/channels/`、`jiuwenswarm/channels/cli/`、`jiuwenswarm/channels/process_cli/` |

- [[gateway-channels-rules]]（Process CLI 频道（jiuwenswarm/channels/process_cli）审查规则）

### 专题入口

- [[jiuwenswarm-process-cli-machine]]（进程式 CLI 机器执行、会话租约与停机） — 一次性执行的跨进程所有权、完成证据与清理边界。
- [[gateway-channels-design-tradeoffs]]（CLI 与会话结果交付的设计取舍） — 设计选择、收益与代价，以及 API、配置和关联功能入口。
- [[feature-process-cli]]（机器执行与本地 CLI 功能知识）
- [[feature-cli]]（交互式命令行 功能知识）
- [[feature-ssh]]（SSH 频道与远程终端 功能知识）
- [[feature-im-feishu]]（飞书 频道 功能知识）
- [[feature-im-wechat]]（微信 频道 功能知识）
- [[feature-im-wecom]]（企业微信 频道 功能知识）
- [[feature-im-dingtalk]]（钉钉 频道 功能知识）
- [[feature-im-xiaoyi]]（小艺 频道 功能知识）
- [[feature-im-slack]]（Slack 频道 功能知识）
- [[feature-im-telegram]]（Telegram 频道 功能知识）
- [[feature-im-discord]]（Discord 频道 功能知识）
- [[feature-im-whatsapp]]（WhatsApp 频道 功能知识）
- [[channels-cli-overview]]（channels-cli）
- [[channels-process-cli-overview]]（channels-process-cli）
- [[gateway-overview]]（gateway）
- [[gateway-channel-manager-overview]]（gateway-channel-manager）
- [[gateway-cron-overview]]（gateway-cron）
- [[gateway-health-check-overview]]（gateway-health-check）
- [[gateway-heartbeat-overview]]（gateway-heartbeat）
- [[gateway-hooks-overview]]（gateway-hooks）
- [[gateway-im-pipeline-overview]]（gateway-im-pipeline）
- [[gateway-message-handler-overview]]（gateway-message-handler）
- [[gateway-routing-overview]]（gateway-routing）
- [[feature-depth-process-cli]]（机器执行与本地 CLI：实现深读）
- [[feature-depth-cli]]（交互式命令行：实现深读）
- [[feature-depth-ssh]]（SSH 频道与远程终端：实现深读）
- [[feature-depth-im-feishu]]（飞书 频道：实现深读）
- [[feature-depth-im-wechat]]（微信 频道：实现深读）
- [[feature-depth-im-wecom]]（企业微信 频道：实现深读）
- [[feature-depth-im-dingtalk]]（钉钉 频道：实现深读）
- [[feature-depth-im-xiaoyi]]（小艺 频道：实现深读）
- [[feature-depth-im-slack]]（Slack 频道：实现深读）
- [[feature-depth-im-telegram]]（Telegram 频道：实现深读）
- [[feature-depth-im-discord]]（Discord 频道：实现深读）
- [[feature-depth-im-whatsapp]]（WhatsApp 频道：实现深读）
- [[knowledge-gateway-channels]]（Gateway Web 频道处理器（channel_manager/web/app_web_handlers.py））
- [[gateway-channels-knowledge]]（进程式 CLI 频道（process_cli）：REPL、worker 与会话操作）
- [[feature-channel-security-review-slash-command]]（/security-review 安全审查斜杠命令与 git 预执行）
- [[feature-gateway-config-hot-reload]]（Gateway Config-Save Hot Reload（_on_config_saved：agent.reload_config 重试、重启兜底与副作用））
- [[feature-gateway-health-check]]（Gateway HealthCheck 周期探活服务 (jiuwenswarm/gateway/health_check)）
- [[feature-gateway-server-multi-route-ws]]（GatewayServer 多路由 WebSocket 宿主与会话/请求路由表）
- [[feature-im-attachment-persist-hook-969909e1]]（IM Attachment Persist Hook (E2A + HTTP Bridge) — ChannelManager wiring）
- [[feature-im-channel-hot-reconfig]]（IM Channel Hot Reconfiguration (_apply_channel_config lifecycle across 11 channels)）
- [[feature-locale-conf-rpc]]（界面语言配置 RPC（preferred_language）— Gateway Web Handler）
- [[feature-thirdagent-list-switch]]（3rdagent.list / 3rdagent.switch 第三方智能体切换）
- [[feature-at-file-reference-inlining-b1a822e1]]（@path 文件引用内联与 @agent 提及解析（MessageHandler））
- [[gateway-channels-scripts-overview]]（scripts）
- [[feature-depth-at-file-reference-inlining-b1a822e1]]（@path 文件引用内联与 @agent 提及解析：实现深读）
- [[feature-depth-channel-security-review-slash-command]]（/security-review 安全审查斜杠命令与 git 预执行：实现深读）
- [[feature-depth-gateway-config-hot-reload]]（Gateway Config-Save Hot Reload (agent.reload_config retry, restart fallback, browser/proactive side effects)：实现深读）
- [[feature-depth-gateway-health-check]]（Gateway HealthCheck 周期探活服务：实现深读）
- [[feature-depth-gateway-server-multi-route-ws]]（GatewayServer 多路由 WebSocket 宿主与会话/请求路由表：实现深读）
- [[feature-depth-im-attachment-persist-hook-969909e1]]（IM Attachment Persist Hook (E2A + HTTP Bridge)：实现深读）
- [[feature-depth-im-channel-hot-reconfig]]（IM Channel Hot Reconfiguration (_apply_channel_config lifecycle across 11 channels)：实现深读）
- [[feature-depth-locale-conf-rpc]]（界面语言配置 RPC（preferred_language）：实现深读）
- [[feature-depth-thirdagent-list-switch]]（3rdagent.list / 3rdagent.switch 第三方智能体切换：实现深读）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-09
