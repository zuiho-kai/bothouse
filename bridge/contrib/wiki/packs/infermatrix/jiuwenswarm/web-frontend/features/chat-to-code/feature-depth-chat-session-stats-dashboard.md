---
name: feature-depth-chat-session-stats-dashboard
description: 会话统计栏实现深读：renderTokenCounter 仅在 contextWindow>0 时估算已用 tokens、updateTokenBar 无参数更新与 DOM 缺失提前返回、contextUsagePercent 优先于 tokens 比值、pct 为 null 时宽度 0% 并移除 visible、6% 最小柱高取舍、JetBrains 文档记载的未执行手工核对
metadata:
  scope: 只收 chat.html 中 token 计数器、token 条与使用百分比的实现级证据，另含最小柱高取舍与文档记载的手工验收；统计栏与迷你图的整体渲染入口和显示指标归 feature-chat-session-stats-dashboard
---
# Chat Session Stats Bar and Per-Turn Mini Charts：实现深读

## 现状

- [[feature-chat-session-stats-dashboard]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **renderTokenCounter callback: only when state.contextWindow > 0, derives pct and estimated used tokens** 调用 renderTokenCounter(total) 时先记录 state.lastTokenTotal；若 #token-counter 元素不存在直接返回；
  - 仅当 state.contextWindow > 0 时计算 pct=contextUsagePct()，若 ctxUsed<=0 且 pct!=null 则用 Math.round(state.contextWindow*pct/100) 估算已用 tokens。
- 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L3398–L3407](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L3398-L3407)
- **updateTokenBar: no-argument DOM updater reading token/state fields, early-return when bar elements absent** updateTokenBar() takes no arguments and reads total = state.hostMetrics.sessionTokens || state.sessionStats.totalTokens, plus state.contextWindow,
  - state.contextUsagePercent and state.contextTokensUsed; it requires elements with ids 'token-bar-wrap' and 'token-bar-fill' and returns without side effects if either is missing (line 4361).
- 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4348–L4361](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4348-L4361)
- **Usage percent precedence: state.contextUsagePercent (non-null) wins over contextTokensUsed/contextWindow ratio** 若 state.contextUsagePercent != null 则直接使用该百分比；否则当 state.contextTokensUsed > 0 且 limit(=state.contextWindow) > 0 时计算比值；两者都不满足返回 null。未展示这些 state 字段的默认值或赋值来源。
- 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L3391–L3396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L3391-L3396)
- **Stats display depends on state.contextWindow/contextTokensUsed and a token-counter DOM element** renderTokenCounter 依赖全局 state 的 contextWindow、contextTokensUsed、contextUsagePercent 以及 id 为 token-counter 的 DOM 元素；元素缺失时静默返回（3400–3401 行），因此宿主未渲染该元素则整段显示不生效。
- 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L3398–L3407](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L3398-L3407)
- **updateTokenBar: null pct branch sets width 0% and removes 'visible'; missing DOM nodes cause plain early return** When state.contextUsagePercent is null and not (state.contextTokensUsed > 0 and state.contextWindow > 0),
  - pct becomes null and the shown branch sets fill.style.width = '0%' and removes the 'visible' class from the wrap; separately, if either DOM element is absent the function returns before any style change.
- 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4352–L4364](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4352-L4364)
- **6% 最小柱高保证零值轮可见但牺牲严格比例** bars() 对每柱高度取 Math.max(6, Math.round(v / maxVal * 100))，且归一化分母 maxTok/maxDur 由 Math.max(...,1) 保证至少为 1；收益是数值为 0 或极小的轮次仍有 6% 高度可见，代价是低于 6% 的柱不再与数值严格成比例。
- 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4503–L4516](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4503-L4516)
- **Documented manual check (NOT EXECUTED): stats bar appears after first turn; chart toggle and hover details after two turns** 文档中的人工验收步骤（本轮未执行）：
- JetBrains 插件指南记载（未执行）：统计栏在第一轮完成后出现并显示轮数/错误/Token 等指标；两轮或更多后条形图图标切换迷你图，悬停条形可查看该轮详情。此为文档记载的手工核对步骤，非自动化断言。
- 来源：[docs/zh/ide/jetbrains/JetBrains插件指南.md:L139–L155](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ide/jetbrains/JetBrains%E6%8F%92%E4%BB%B6%E6%8C%87%E5%8D%97.md#L139-L155)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-chat-session-stats-dashboard.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L3398-L3407；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L3391-L3396
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4348-L4361；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4352-L4364
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ide/jetbrains/JetBrains插件指南.md:L139-L155；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4503-L4516
- 源页字段（feature）：chat-session-stats-dashboard
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/shared-webview/chat.html
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/shared-webview/chat.html
