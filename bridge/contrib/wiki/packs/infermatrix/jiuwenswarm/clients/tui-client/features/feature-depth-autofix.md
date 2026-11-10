---
name: feature-depth-autofix
description: /autofix-pr 实现深读：PrWatchDeps.sendMessage 离线契约、--interval 解析与 10 秒下限、setInterval 轮询加 isBusy 跳过、tick 守卫与 12 轮熔断、文档化人工验收
metadata:
  scope: 收 autofix-pr.ts 与 autofix-pr.watch.ts 的实现深读，来源另含 autofix-pr.status.ts；功能概览归 feature-autofix，TUI 整体实现深读归 feature-depth-tui
---
# 已有 PR 自动修复：实现深读

## 现状

- [[feature-autofix]]（功能概览） · [[tui-client-overview]]（owner 入口）
- **PrWatchDeps.sendMessage 的离线契约** 注入的 sendMessage: (prompt: string) => string | null 返回 requestId，离线时返回 null；调用方 PrWatchController.runRound 据此决定是否计入轮数——null 不算一轮，由下一次已连接的 tick 重试。宿主必须遵守该契约，否则轮数保险丝会被离线期间虚假消耗。
- 来源：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L24–L40](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L24-L40),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L140–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L140-L147)
- **--interval 的解析、下限与默认值** 命令侧用正则 (^|\s)--interval[=\s]+([\d.]+) 解析分钟数（支持小数），换算为毫秒后 Math.max(10_000, …)，即下限 10 秒；未提供时 intervalMs 为 undefined，PrWatchController 构造函数回退 DEFAULT_WATCH_INTERVAL_MS = 10 * 60_000（10 分钟），maxRounds 回退 DEFAULT_WATCH_MAX_ROUNDS = 12。
- 来源：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L61–L68](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts#L61-L68),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L21–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L21-L22),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L64–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L64-L69)
- **setInterval 轮询 + isBusy 跳过，而非事件钩防重叠** 设计推断（非作者历史意图）：
- 源码注释明示选择「Deliberately simple」：用 setInterval 轮询，靠 ticking 标志与 deps.isBusy() 在忙碌时跳过本轮，而非接入回合结束事件。收益是纯客户端实现、无需后端/agentserver 配合；代价是轮次节奏受 interval 粒度限制，忙碌或离线期间检查被顺延（此代价分析为推断）。
- 来源：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L5–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L5-L19),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L102–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L102-L110)
- **start() 首轮后按 intervalMs 轮询；tick 仅在已连接且空闲时查状态，随后停止、熔断或再跑一轮** start() 在 timer 为空且未 stopped 时先 runRound()，再 setInterval 每 intervalMs 调 tick()；tick() 需 !stopped、!ticking、isConnected() 且 !isBusy() 才 await checkStatus，shouldStop 即 stop(reason)，roundsRun≥maxRounds 熔断，否则 runRound()。
- 来源：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L73–L138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L73-L138),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.status.ts:L179–L189](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.status.ts#L179-L189)
- **watch.ts 导入 status 的 checkPrStatus 与 prompts 的 buildAutofixPrPrompt；未注入 checkStatus 时回落真实实现** 构造器里 maxRounds = config.maxRounds ?? DEFAULT_WATCH_MAX_ROUNDS、checkStatus = deps.checkStatus ?? checkPrStatus、语言默认 "zh"；tick 的停止判断耦合返回值的 shouldStop，每轮发送则完全经注入的 deps.sendMessage 完成。
- 来源：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1–L3](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L1-L3),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L66–L69](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L66-L69),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L140–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L140-L146)
- **tick 守卫分支：状态检查抛错仅结束本轮，不停止 watch 等下一 tick 重试** tick() 在 stopped、ticking、!isConnected() 或 isBusy() 时直接 return。checkStatus 抛异常被 catch 后仅 return，finally 清除 ticking，不调用 stop()，下个 interval 重试；
  - status.shouldStop 才以 reason 停止，roundsRun ≥ maxRounds 触发保险丝停止，否则 runRound()，其仅在 sendMessage 返回 requestId 时计轮（null 不计）。
- 来源：[jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L88–L100](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L88-L100),
  - [jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L102–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts#L102-L147)
- **/autofix-pr --watch 的文档化人工验收（未执行）** 文档中的人工验收步骤（本轮未执行）：
- 文档化步骤（本轮未执行）：在 Code 模式、已跟踪文件无未提交改动且能定位到开放 PR 的前提下运行 /autofix-pr --watch（或 /autofix-pr <PR号> --watch）。文档预期可观察结果：立即先跑一轮且完整显示在会话里；上一轮仍在跑时复查直接跳过；WebSocket 断线时不硬发，掉线那次不计入轮数；--stop 停止。此处不宣称修复或 CI 已通过。
- 来源：[docs/zh/自动修复PR.md:L115–L130](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L115-L130),
  - [docs/zh/自动修复PR.md:L150–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E4%BF%AE%E5%A4%8DPR.md#L150-L154)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/tui-client/feature-depth-autofix.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L24-L40
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L140-L147
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts:L61-L68
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L21-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L64-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L5-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L102-L110
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L1-L3
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L66-L69
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L140-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L73-L138
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.status.ts:L179-L189
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L88-L100
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts:L102-L147；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动修复PR.md:L115-L130
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动修复PR.md:L150-L154
- 源页字段（feature）：autofix
- 入口（entry_points）：jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr.watch.ts
- 源页字段（source_globs）：jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/autofix-pr*.ts
