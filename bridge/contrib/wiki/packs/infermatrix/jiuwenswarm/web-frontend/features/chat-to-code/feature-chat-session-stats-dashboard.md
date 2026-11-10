---
name: feature-chat-session-stats-dashboard
description: IDE Webview（chat.html）会话统计栏与每轮迷你图：renderStatsBar/renderMiniCharts/toggleCharts 的渲染入口，由 state.sessionStats 驱动的展示层与 clearMessages 重置，totalTurns>=2 显示开关，6% 最小柱高归一化，统计指标芯片与 outcome 柱色，以及所示片段内无测试的说明
metadata:
  scope: 只收 chat.html 统计栏与迷你图的现状说明（入口、状态驱动、显示开关、柱高归一化、展示指标、验证手段）；renderTokenCounter 与 updateTokenBar 的 token 计数器细节、contextUsagePercent 优先级与 JetBrains 手工验收步骤归 feature-depth-chat-session-stats-dashboard
---
# IDE Webview 会话统计栏与每轮迷你图（chat.html）

## 现状

- **无所示验证入口**
- 所提供的行范围内不包含任何测试或验证代码，无法从该片段确认统计栏与迷你图的测试覆盖情况。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4453–L4524](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4453-L4524)
- **渲染入口与生命周期**
- 该片段的入口是三个页面内函数：`renderStatsBar` 将拼好的 HTML 字符串直接赋给容器的 `innerHTML` 并加 `visible` class；`renderMiniCharts` 同样直接写 `innerHTML`（不足 2 轮时直接 return）；`toggleCharts` 翻转 `state.chartsCollapsed` 并重渲染。它们直接操作 DOM，不返回值，片段中也未展示对外错误契约。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4475–L4489](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4475-L4489),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4492–L4524](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4492-L4524)
- **状态驱动的纯渲染层**
- 统计栏与迷你图是从 `state.sessionStats`（含 `turnTokens`、`turnDurations`、`ttfts`、`outcomes` 等数组）和 `state.todoStats` 读取数据渲染的展示层；数据如何写入这些 state 的路径未在片段中展示。`clearMessages` 承担重置职责：将 `sessionStats`、`todoStats` 归零、清空 `mini-charts` 容器并把 `chartsCollapsed` 置回 true。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4495–L4521](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4495-L4521),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4602–L4628](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4602-L4628)
- **运行时 state 控制的显示开关**
- 所示片段不含外部配置项；显示行为由 state 决定。图表折叠按钮仅在 `s.totalTurns >= 2` 时渲染，`renderMiniCharts` 在 `totalTurns < 2` 时直接返回；`clearMessages` 结束时把 `chartsCollapsed` 重置为 true。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4475–L4477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4475-L4477),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4494–L4496](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4494-L4496),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4626–L4628](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4626-L4628)
- **所示片段中的验证手段**
- 所示 4453–4759 行范围内没有测试或断言代码，统计栏与迷你图的正确性在该片段内仅由运行时守卫体现：折叠按钮仅在 `s.totalTurns >= 2` 时渲染（L4475–L4477），`renderMiniCharts` 在 `totalTurns < 2` 时直接返回（L4494–L4496）。`clearMessages` 中列出了对 `sessionStats` 各数组、`todoStats`、`mini-charts` 容器与 `chartsCollapsed` 的逐项重置操作，可作为新会话时清空展示的对照清单。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4475–L4477](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4475-L4477),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4494–L4496](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4494-L4496),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4602–L4628](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4602-L4628)
- **归一化最小柱高与纯字符串渲染**
- 柱高按各轮值相对该序列最大值（Math.max(...values, 1)，分母至少为 1）归一化为百分比，且 Math.max(6, ...) 强制最小 6% 高度，避免零值柱在视觉上不可见。迷你图通过字符串拼接生成 HTML 并整体赋给 innerHTML（该片段另定义了 escapeHtml 但此处未调用）；每个 data-tip 仅在柱状图为 Duration（非 Tokens）且该轮 ttft 非空时才附带 First token 时长。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4503–L4516](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4503-L4516),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4517–L4521](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4517-L4521),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4691–L4697](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4691-L4697)
- **统计栏与迷你图展示的行为范围**
- 统计栏在首轮完成后（totalTurns >= 1）显示会话级指标：Turns、Errors（仅在有错误时出现）、Tokens、LLM calls、Avg duration、Avg first token，以及条件出现的 Ctx Size（依赖 m.contextBytes 或 m.promptEstimatedTokens 非零）、Cost 与 TODO 进度（✓/◐/☐）芯片。
  - Tokens 数值优先取宿主提供的 m.sessionTokens，但其为 0 或缺省时回退到本地累计的 s.totalTokens（`m.sessionTokens || s.totalTokens`，真值判断）。迷你图提供 Tokens/turn 与 Duration/turn 两组柱状图：每柱高度为 Math.max(6, Math.round(v / maxVal * 100))，即先对相对百分比取整再强制最小 6% 高度，分母 maxVal 由序列最大值与 1 取最大（Math.max(...values, 1)）保证下界；
  - 柱色按该轮 outcome 映射，未知 outcome 用灰色 #6b7280。
- Sources / 来源：[jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4437–L4466](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4437-L4466),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4451–L4451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4451-L4451),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4503–L4516](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4503-L4516),
  - [jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4517–L4521](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/ide/packages/shared-webview/chat.html#L4517-L4521)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-chat-session-stats-dashboard.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4453-L4524；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4475-L4489
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4492-L4524；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4495-L4521
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4602-L4628；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4475-L4477
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4494-L4496；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4626-L4628
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4503-L4516；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4517-L4521
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4691-L4697；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4437-L4466
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/ide/packages/shared-webview/chat.html:L4451-L4451
- 源页字段（feature）：chat-session-stats-dashboard
- 入口（entry_points）：jiuwenswarm/channels/ide/packages/shared-webview/chat.html
- 源页字段（source_globs）：jiuwenswarm/channels/ide/packages/shared-webview/chat.html
