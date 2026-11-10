---
name: feature-context-usage-indicator-2
description: 上下文占用指示器（下）：data-testid 验证挂点与未包含直接测试文件的说明、快照构造异常降级为 None 与缺失字段显示降级的兼容性取舍、前后端职责划分与数据流（该节在页内出现两个版本）
metadata:
  scope: 只收验证挂点、容错降级与取舍、前后端职责划分与数据流（两个版本）三部分；交互展示、数据契约与常量归 feature-context-usage-indicator-1，逐点实现证据归 feature-depth-context-usage-indicator
---
# 上下文占用指示器（ContextUsageIndicator：环形触发器/悬浮提示/明细弹层）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-context-usage-indicator.md` 的第 2/2 部分；第 1 部分 [[feature-context-usage-indicator-1]]
- **验证：data-testid 挂点与组件级可测状态**
- 该组件为 UI 测试提供了四个稳定的 `data-testid` 挂点：`chat-panel-context-usage-trigger`（触发按钮）、`chat-panel-context-usage-tooltip`（悬浮提示）、`chat-panel-context-usage-detail`（明细弹层）与 `chat-panel-context-usage-close`（关闭按钮），配合受控的 hover/focus 状态和 `detailSessionId` 生命周期（Escape 关闭并还原焦点、外点关闭、切换会话或快照消失时重置）可作为组件测试的断言入口。
  - 在本次展示的输入中未包含直接针对 ContextUsageIndicator 的测试文件；展示的 Python 测试（如 test_subagent_runtime_integration.py、test_task_rail.py）覆盖的是同一 JiuWenSwarmDeepAdapter 的其他职责。
- Sources /
  - 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L182–L201](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L182-L201),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L218–L265](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L218-L265)
- **容错降级与兼容性取舍**
- 服务端将快照构造视为尽力而为：agent-core 缺少 `build_context_usage_snapshot`（滚动升级兼容）或会话 context 未加载时返回 None；快照构造抛出的异常被捕获降级为 None，注释明确 usage 遥测不得导致 /compact 失败（interface_deep.py:18674-18701）。
  - 前端对缺失字段做显示降级：occupancy_rate/input_tokens/limit_tokens 为 null 时显示 notReported 文案，KV cache 命中率为 null 时省略对应行（ContextUsageIndicator.tsx:142-151, 233-238, 306-311）。
- Sources / 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18666–L18701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L18666-L18701),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L142-L151),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L233–L238](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L233-L238)
- **前后端职责划分与数据流**
- 数据流分两段。前端 `ContextUsageIndicator()` 是无 props 的纯消费组件：从 `chatStore.activeSessionId` 与 `sessionStore.runtimes[id].contextUsageSnapshot` 取数，仅在 mode 为 agent/team 且快照存在时渲染，快照的 `context_window`、`session_kv_cache_hit_rate` 与 `parts` 直接驱动环形弧长、悬浮提示与明细弹层（含按类别分段的 breakdown），
  - 弹层通过 createPortal 挂到 document.body 并基于触发按钮的 getBoundingClientRect 定位（tsx:62-77、142-165、218-245）。服务端侧 `JiuWenSwarmDeepAdapter.get_context_usage_event` 负责产出快照：非会话作用域适配器先委托/复用按会话适配器并在结束后逐出空闲适配器；
  - 会话作用域路径从 `react_agent.context_engine.get_context(session_id)` 取上下文，调用 agent-core 的 `build_context_usage_snapshot`（phase="post_compact"）并经 `normalize_context_usage_payload` 归一化返回，异常保护仅覆盖快照构造与归一化这一段（interface_deep.py:18649-18701）。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L62–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L62-L77),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L142-L165),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L218–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L218-L245),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18649–L18701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L18649-L18701)
- **前后端职责划分与数据流**
- 前端 `ContextUsageIndicator()` 是无 props 的纯消费组件：从 `chatStore.activeSessionId` 与 `sessionStore.runtimes[id].contextUsageSnapshot` 取数，仅在 mode 为 agent/team 且快照存在时渲染，快照的 `context_window`、`session_kv_cache_hit_rate` 与 `parts` 驱动环形弧长、悬浮提示与明细弹层，
  - 弹层经 createPortal 挂到 document.body 并按触发按钮的 getBoundingClientRect 定位。服务端 `JiuWenSwarmDeepAdapter.get_context_usage_event` 负责产出快照：非会话作用域适配器先委托按会话适配器并在结束后逐出空闲适配器；
  - 会话作用域路径从 `react_agent.context_engine.get_context(session_id)` 取上下文，调用 agent-core 的 `build_context_usage_snapshot`（phase="post_compact"）并经 `normalize_context_usage_payload` 归一化返回。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L62–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L62-L77),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L142-L165),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L218–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L218-L245),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18649–L18701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L18649-L18701)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-context-usage-indicator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
