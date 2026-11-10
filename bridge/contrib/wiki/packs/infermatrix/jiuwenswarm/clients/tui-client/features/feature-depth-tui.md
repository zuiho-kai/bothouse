---
name: feature-depth-tui
description: TUI 对话与命令实现深读：--url 默认值与 TTY 检查、task-lifecycle-port 取消断言、closeUi 与 AppState.stop 退出清理、parseCliArgs 默认值、同 session 占用的有界重试
metadata:
  scope: 收 TUI 入口 index.ts 与 task-lifecycle-port 的实现深读，来源另含 app-state.ts；功能概览归 feature-tui，autofix 实现深读归 feature-depth-autofix
---
# TUI 对话与命令：实现深读

## 现状

- [[feature-tui]]（功能概览） · [[tui-client-overview]]（owner 入口）
- **--url 默认值与 TTY 检查覆盖** --url 在 parseArgs 中默认 "ws://127.0.0.1:19001/tui"，L92 再以 values.url ?? 同一默认值兜底。非交互环境（stdin/stdout 任一非 TTY）默认报错退出，但设置环境变量 JIUWENSWARM_TUI_HEADLESS（注释注明用于自动化测试）可跳过该检查。
- 来源：[jiuwenswarm/channels/tui/frontend/src/index.ts:L17–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L17-L29),
  - [jiuwenswarm/channels/tui/frontend/src/index.ts:L86–L92](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L86-L92)
- **task-lifecycle-port.test.mjs 断言断连与并发下的取消行为（针对 dist 构建）** 入口是 jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs：node 顶层断言脚本（无测试框架），从 ../dist/core/supervision/task-lifecycle-port.js 导入被测实现并以 MockDeps 注入依赖。
  - 用例 10 置 MockDeps.connectionAlive=false，断言 cancelAndWaitForIdle 立即以 CancelError.code==="CANCEL_CONNECTION_LOST" 拒绝且 deps.sentInterrupts.length===0（已断连时不发送 interrupt）；用例 9 断言首个 waiter 未决期间第二次调用立即 reject CANCEL_ALREADY_PENDING。此处仅描述断言所锻炼的行为，不宣称测试当次已运行通过。
- 来源：[jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs:L1–L4](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs#L1-L4),
  - [jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs:L176–L193](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs#L176-L193),
  - [jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs:L195–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs#L195-L210)
- **closeUi 正常退出：closed 防重入后先通知再清理，最后 process.exit(exitCode 默认 0)** closeUi 先检查 closed 守卫并置 closed=true，再 await user_exit 断连通知（错误被 catch 吞掉），随后 screen?.dispose、appState.stop()（若本地有挂起提问则以 "app stopped while awaiting input" reject，并 wsClient.disconnect()），最后 tui.stop() 与 process.exit(exitCode)。
- 来源：[jiuwenswarm/channels/tui/frontend/src/index.ts:L202–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L202-L244),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L733–L766](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L733-L766)
- **parseCliArgs 的默认值契约与 closeUi(exitCode=0) 的 closed 单次保证** `parseCliArgs` 返回旗标值对象：`url` 默认 `ws://127.0.0.1:19001/tui`、`token`/`user-id` 默认空串、`persist-session` 默认 `false`、`session` 无默认、`help` 短参 `-h`；文档旗标表的 `--url/--token` 默认值与此一致。`closeUi(exitCode = 0)` 首次调用置 `closed=true`，重复调用直接返回。
- 来源：[jiuwenswarm/channels/tui/frontend/src/index.ts:L17–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L17-L29),
  - [jiuwenswarm/channels/tui/frontend/src/index.ts:L206–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L206-L225),
  - [docs/zh/TUI使用指南.md:L39–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L39-L46)
- **closeUi 与 crash（后者仅在未 closed 时）耦合 AppState.stop 完成前端清理** index.ts 的两条退出路径都调用 appState.stop()；该方法通知 stop 订阅器（单个监听器抛错被忽略）、清除计时器与取消监听，并最后 wsClient.disconnect()，因此退出时的连接与定时器清理耦合在 app-state 实现内。
- 来源：[jiuwenswarm/channels/tui/frontend/src/index.ts:L212–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L212-L244),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L733–L766](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L733-L766)
- **断连通知抛错被 catch 吞掉、非法 URL 按本地处理、双窗口同 --session 被 Gateway 拒绝** `closeUi` 内断连通知抛错被 `catch` 吞掉（注释 Best effort only），后续 `screen?.dispose()/appState.stop()` 照常执行，`tui.stop()` 重复失败同样忽略；`isRemoteUrl` 对无法解析的 URL `catch` 返回 `false` 视为本地；文档记载两个窗口同时用同一 `--session <id>` 启动会被 Gateway 以 `SESSION_IN_USE` 拒绝。
- 来源：[jiuwenswarm/channels/tui/frontend/src/index.ts:L100–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L100-L107),
  - [jiuwenswarm/channels/tui/frontend/src/index.ts:L206–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/index.ts#L206-L225),
  - [docs/zh/TUI使用指南.md:L13–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md#L13-L24)
- **仅 "already active in another window" 走有界延迟重试：自愈瞬态占用竞争，代价是启动等待与其余失败直接传播** 设计推断（非作者历史意图）：
- catch 分支仅当错误消息含 "already active in another window"、target 非 null 且 retryIndex 未超出 BOOT_SESSION_IN_USE_RETRY_DELAYS_MS（[100,200,400,800,800,800,800]，共 7 次）时按延迟 await 后重试，否则 throw error 原样传播；收益是启动期瞬态占用竞争可自愈，代价是重试累计等待且其他失败不重试。
- 来源：[jiuwenswarm/channels/tui/frontend/src/app-state.ts:L98–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L98-L105),
  - [jiuwenswarm/channels/tui/frontend/src/app-state.ts:L3636–L3647](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/app-state.ts#L3636-L3647)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/feature-depth-tui.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts:L17-L29；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts:L86-L92
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs:L1-L4
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs:L176-L193
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/tests/task-lifecycle-port.test.mjs:L195-L210；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts:L206-L225
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TUI使用指南.md:L39-L46；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts:L100-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TUI使用指南.md:L13-L24；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts:L202-L244
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L733-L766；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/index.ts:L212-L244
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L98-L105；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/app-state.ts:L3636-L3647
- 源页字段（feature）：tui
- 入口（entry_points）：jiuwenswarm/channels/tui/frontend/src/index.ts
- 源页字段（source_globs）：jiuwenswarm/channels/tui/frontend/src/index.ts；jiuwenswarm/channels/tui/*
