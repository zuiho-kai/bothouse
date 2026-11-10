---
name: tui-client-knowledge
description: CliPiAppState（app-state.ts）应用状态中枢：auto-recap 与 PR watch 后台能力、/btw 覆盖层、生命周期与 request/sendMessage 出口（30000ms 超时、7MB 估算）、配置解析规则、远程路径与 agentos 模型注入取舍、SESSION_IN_USE 启动幂等
metadata:
  scope: 只收 app-state.ts 中 CliPiAppState 的行为、生命周期、配置解析、取舍与文档验收；该文件的声明索引归 tui-client-contracts-01，TUI 入口与命令功能知识归 feature-tui
---
# tui-client：CliPiAppState 应用状态中枢（app-state.ts）

## 现状

- **支持的行为与关联功能**
- 两类后台能力由本类承载：一是 auto-recap（用户空闲 5 分钟自动回顾，30 秒周期检查，用户发言后状态机重置为 idle）；二是 TUI 侧 PR watch——`startPrWatch(config)` 用注入的 sendMessage/isBusy/isConnected 构造 PrWatchController，轮次消息以 `logAsUser: false` 发送，watch 结束的 onStopped 回调清除运行内自动批准。
  - 另有 /btw 侧问覆盖层：独立于 transcript 渲染的 overlay 带(history/index/total)，支持前后切换与删除当前条目，用户发送新消息时整批清除。team 模式下 SwarmFlow 后台 run 被计入 cancellableWork，使 Esc/Ctrl+C 在 leader round 收尾后仍能中止后台 run。
- Sources / 来源：[jiuwenswarm/channels/tui/frontend/src/app-state.ts:L259–L269](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L259-L269),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1333–L1383](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1333-L1383),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1101–L1121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1101-L1121),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1980–L2050](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1980-L2050)
- **生命周期与后端出口**
- 生命周期为构造 → start() → stop()（清理各计时器、拒绝未决本地提问、退订并断开 WS）。对后端两类出口：request(method, params, timeoutMs) 走 requestAgentServer，默认 30000ms 超时，请求期间记录 activeCommandRequestId 供 Ctrl+C 立即取消，完成后清理；sendEventOnly 返回生成的请求 id，若启动会话创建未完成则排队到该 Promise 之后发送。sendMessage 在连接断开时返回 null；
  - 发送前用 JSON.stringify(...).length 与 7*1024*1024 比较——计量的是字符串长度而非字节数，且该估算不含 sendEventOnly 随后附加的 id、session_id 与路径字段；非 team 模式且流未结束时先发 chat.interrupt(cancel) 再 chat.send。
- Sources / 来源：[jiuwenswarm/channels/tui/frontend/src/app-state.ts:L733–L766](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L733-L766),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1573–L1662](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1573-L1662),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L2264–L2306](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L2264-L2306)
- **配置读取与解析规则**
- 构造时 loadTuiConfig 的 theme 字段覆盖当前主题（所示片段仅见 setCurrentThemeName 调用，未见落盘逻辑）。WS 连接建立后 fetchModelInfo 用 Promise.allSettled 并发 config.get / models.list / memory.status：config.get 被拒时 config 取 {} 并继续按默认值处理，而非进入外层 catch。解析规则：preferred_language 仅 trim+小写后等于 "en" 才为 en，其余一律 zh；
  - skill_evolution 接受布尔 true 或 trim+小写后的 "true"/"1"/"yes"/"on"/"enabled"，未知或缺失保持关闭；auto_recap_enabled 仅当严格不等于字符串 "false" 时视为开启（默认 true），并据此启停 auto-recap 定时器。
- Sources / 来源：[jiuwenswarm/channels/tui/frontend/src/app-state.ts:L696–L700](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L696-L700),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L776–L812](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L776-L812),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L212–L221](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L212-L221)
- **请求路径与模型注入的取舍**
- Inference / 设计推断（非作者历史意图）：
- 远程模式的路径隔离是有条件的：仅当 isRemote 与 remoteProjectDir 均为真值时，请求才改用服务器侧目录作为 project_dir/cwd 且不发送 trusted_dirs；任一不满足则回退本地 project_dir/cwd 与可信目录列表。agentos 备份模型选择请求级注入而非全局切换：chat.send 注入 model_name 时优先用后端 model_key（model_name#global_idx）以精确命中同名 agentos 条目，缺 key 才回退纯名（同名会被解析到 defaults，仅作兼容兜底）；
  - setModel 切回 defaults 时清空注入字段，启动默认模型路由保持不变。
- Sources / 来源：[jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1554–L1570](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1554-L1570),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L396–L409](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L396-L409),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L2280–L2287](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L2280-L2287)
- **文档验收与启动幂等**
- 使用指南开头声明「行为以仓库代码为准」，并记录多窗口同 --session 启动会被 Gateway 拒绝（SESSION_IN_USE）、显式 id 的 session.create 幂等且在 connection.ack 后由 initializeBootSession 放行、重连只执行一次；
  - 代码侧有对应机制：bootSessionHandled 幂等守卫注释（重连/重发不重试），以及启动期 "already active in another window" 瞬时错误识别函数与 100–800ms 重试延迟表常量——但所示片段只包含常量与识别函数，未展示执行重试的调用循环，实际重试次数不能据此确认。
- Sources / 来源：[docs/zh/TUI使用指南.md:L4–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L4-L24),
  - [docs/zh/TUI使用指南.md:L48–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L48-L57),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L98–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L98-L105),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L332–L339](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L332-L339)
- **CliPiAppState 的职责边界与生命周期**
- `CliPiAppState`（app-state.ts）是 TUI 前端的中央客户端状态类：它持有 WebSocket 客户端（`WsClient`）与会话、转录条目、流式状态、工具执行、team/workflow 等私有字段，通过 `onChange`/`getSnapshot` 对外暴露快照。构造函数注入 `wsClient` 与可选的 CLI 会话参数及监督端口（`supervision?.handoffPort` 等，缺省回退非托管实现）；
  - `start()` 订阅连接状态与帧回调、调用 `wsClient.connect()` 并启动状态栏轮询，`stop()` 依次通知 stop 订阅器、reject 未决本地问题、清理各定时器并断开连接。/switch 等公共契约端口（Handoff/TaskLifecycle/Reauthentication/UiLifecycle）既可在构造时注入，也可由 index.ts 通过 `setSupervisionPorts` 回填；未注入时 `getCommandContext` 对 `checkHandoff` 回退到 `NOT_SUPERVISED` 结果。
  - 注意 `getSnapshot` 中 `entries`、`toolExecutions`、workflow 嵌套对象为浅拷贝，内部对象引用仍与状态共享。
- Sources / 来源：[jiuwenswarm/channels/tui/frontend/src/app-state.ts:L665–L708](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L665-L708),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L710–L766](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L710-L766),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1537–L1547](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1537-L1547),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1131–L1144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L1131-L1144)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L259-L269；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1333-L1383
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1101-L1121；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1980-L2050
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L733-L766；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1573-L1662
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L2264-L2306；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L696-L700
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L776-L812；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L212-L221
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1554-L1570；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L396-L409
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L2280-L2287；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TUI使用指南.md:L4-L24
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TUI使用指南.md:L48-L57；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L98-L105
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L332-L339；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L665-L708
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L710-L766；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1537-L1547
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L1131-L1144
