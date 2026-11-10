---
name: feature-context-usage-indicator-1
description: 上下文占用指示器 ContextUsageIndicator（上）：环形触发器、悬浮提示与明细弹层的交互与可访问性，无 props 的快照读取与服务端 get_context_usage_event 数据契约，VIEWPORT_GAP 等弹层常量与 null 字段降级显示
metadata:
  scope: 只收交互与展示行为、API 与数据契约、可调常量与降级显示三段；data-testid 验证挂点、快照构造容错与前后端数据流归 feature-context-usage-indicator-2，逐点实现证据归 feature-depth-context-usage-indicator
---
# 上下文占用指示器（ContextUsageIndicator：环形触发器/悬浮提示/明细弹层）（1/2）

## 现状

- 拆分说明：本页是源页 `feature-context-usage-indicator.md` 的第 1/2 部分；第 2 部分 [[feature-context-usage-indicator-2]]
- **支持的交互与展示行为**
- 触发按钮显示 12px SVG 环形进度（`getContextRingPercent` 换算 occupancy_rate，null 时不画值弧）；hover 或键盘聚焦显示悬浮提示（占用率/已用/上限，可选 KV cache 命中率行）；点击打开明细弹层，含汇总指标、按类别的分段条形 breakdown 与类别 token 列表，类别顺序为已知 key 优先、未知类别追加并以原 category 名与次级色显示。
  - 明细支持 Escape 关闭并还原焦点、外点关闭，切换会话或快照消失时自动关闭（ContextUsageIndicator.tsx:76-77、98-107、121-140、152-165、203-215、273-304）。可访问性上使用 `aria-haspopup="dialog"`、`aria-expanded`、`aria-describedby`、role=tooltip/dialog 等（186-189、223-251）。
- Sources /
  - 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L152–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L152-L165),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L121–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L121-L140),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L273–L304](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L273-L304)
- **API 与数据契约**
- 前端入口是 React 组件 `ContextUsageIndicator()`，无 props：它从 `chatStore.activeSessionId` 和 `sessionStore.runtimes[id].contextUsageSnapshot` 读取数据，仅在 mode 为 `agent` 或 `team` 且快照存在时渲染（tsx:62-66、142）。
  - 消费的快照字段为 `context_window.occupancy_rate/input_tokens/limit_tokens`、`session_kv_cache_hit_rate` 与 `parts` 分类明细（tsx:145-157）。服务端侧 `get_context_usage_event(session_id, *, request_id)` 返回 `dict | None`：agent-core 缺少 `build_context_usage_snapshot` 或会话 context 未加载时返回 None；
  - 快照构造阶段的异常被捕获并降级为 None（interface_deep.py:18649-18701），但适配器创建/逐出与 context 查找发生在该保护之外。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L62–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L62-L77),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142–L157](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L142-L157),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18649–L18701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L18649-L18701)
- **可调常量与降级显示**
- 组件内没有外部配置项，弹层几何由模块常量控制：`VIEWPORT_GAP=8`、`TOOLTIP_GAP=5`、`TOOLTIP_ALIGN_OFFSET=3`、`DETAIL_GAP=7`（tsx:19-22）。显示降级分两类：occupancy_rate、input_tokens、limit_tokens 为 null 时显示 `chat.contextUsage.notReported` 文案（tsx:147-150）；
  - KV cache 命中率为 null 时不显示对应行——tooltip 与明细中的该行仅在 `displayCacheRate !== null` 时渲染（tsx:151、233-238、306-311）。未知类别（无 category 定义）以原始 category 名作为标签、使用 `var(--color-text-secondary)` 颜色追加在已知类别之后（tsx:157-164）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L19–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L19-L22),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L144–L164](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L144-L164),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L233–L238](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L233-L238)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-context-usage-indicator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L152-L165
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L121-L140
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L273-L304
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L62-L77
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142-L157
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18649-L18701
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L19-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L144-L164
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L233-L238
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L182-L201
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L218-L265
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18666-L18701
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142-L165
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L218-L245
- 源页字段（feature）：context-usage-indicator
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.css；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.css；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/server/utils/stream_utils.py
