---
name: feature-depth-context-usage-indicator
description: 上下文占用指示器实现深读：渲染前 mode/会话/快照守卫与 null 字段显示未上报、get_context_usage 文档字符串、mode 缺省 agent 与 snapshot 缺省 null、快照构建异常记 warning 返回 None 不影响 /compact、stream_utils 回填旧版 Core 载荷的 session_kv_cache_hit_rate、contextUsageDom 测试断言
metadata:
  scope: 只收 ContextUsageIndicator 与服务端快照的实现级证据与设计推断；组件交互展示、常量与前后端数据流总览归 feature-context-usage-indicator-1、feature-context-usage-indicator-2
---
# 上下文占用指示器（环形/悬浮提示/明细弹层）：实现深读

## 现状

- [[feature-context-usage-indicator-1]]、[[feature-context-usage-indicator-2]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **渲染前按 mode/会话/快照守卫，null 字段降级为“未上报”** 组件从 useSessionStore 按 activeSessionId 读取 mode 与 contextUsageSnapshot；当 mode 不是 'agent' 或 'team'、无 activeSessionId 或无 snapshot 时直接 return null（L142）。
  - 否则解构 snapshot.context_window，occupancy_rate/input_tokens/limit_tokens 为 null 时显示 t('chat.contextUsage.notReported')，ringPercent 仅在 rate 非 null 时计算（L144–L151）。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L62–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L62-L78),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142–L158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L142-L158)
- **get_context_usage(session_id) 异步返回上下文占用统计字典** JiuWenSwarm.get_context_usage 是 async 方法，入参 session_id（会话ID），返回包含上下文窗口总量与当前占用量、系统提示词/对话消息/工具定义各自 token 消耗及占用百分比的字典；具体统计字段由实现填充，所示行仅为文档字符串。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface.py:L5084–L5096](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface.py#L5084-L5096)
- **mode 缺省回退 'agent'，snapshot 缺省 null（runtimes 查找按会话）** 组件用 `state.runtimes[activeSessionId ?? '']?.mode ?? 'agent'` 读取模式，无会话运行时时按 'agent' 处理；`contextUsageSnapshot ?? null` 缺省为 null，而 null snapshot 使组件整体不渲染（L65–L66 与 L142 守卫）。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L64–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L64-L78),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L142-L148)
- **快照构建抛异常时记 warning 并返回 None，不影响 /compact** get_context_usage_event 的 try 块包裹 build_snapshot，except Exception 时 logger.warning("manual context usage snapshot failed", exc_info=True) 并返回 None，注释明确 usage telemetry 不得使 /compact 失败；build_snapshot 不可调用时同样返回 None（debug 日志）。
  - 前端悬浮层对 displayCacheRate 为 null 时跳过缓存命中率行。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18674–L18701](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L18674-L18701),
  - [jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L233–L238](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx#L233-L238)
- **服务端回填旧版 Core 载荷以保持前端协议版本容错** 设计推断（非作者历史意图）：
- stream_utils 在 usage_payload 顶层缺少 session_kv_cache_hit_rate 时，若嵌套 kv_cache.session 是 dict 则回填其 weighted_hit_rate，注释明示目的是让前端协议版本容错；收益是旧载荷仍可展示，代价是服务端需维护兼容分支。此为推断标注：收益/代价由注释与实现推断。
- 来源：[jiuwenswarm/server/utils/stream_utils.py:L128–L140](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/utils/stream_utils.py#L128-L140)
- **contextUsageDom.test.mjs 挂载真实组件并断言 tooltip/明细 DOM 更新** 测试 contextUsageDom.test.mjs 通过 receiveContextUsage 注入快照后，断言 trigger aria-label 含 50%、tooltip 文案含 50%/88.3% 且不含其他来源数值、明细含 4 个类别与 4 个分段、后续快照更新 metric 为 120% 与分段宽度 12.3%，并验证 Escape 关闭且焦点还原、关闭按钮与外点 pointerdown 关闭。这是已有的自动化运行时测试，此处仅描述未执行。
- 来源：[jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs:L1–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs#L1-L17),
  - [jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs:L32–L80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs#L32-L80),
  - [jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs:L139–L195](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs#L139-L195)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-context-usage-indicator.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L62-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142-L158
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L64-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L142-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18674-L18701
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx:L233-L238
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface.py:L5084-L5096；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/utils/stream_utils.py:L128-L140
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs:L1-L17；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs:L32-L80
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/contextUsageDom.test.mjs:L139-L195
- 源页字段（feature）：context-usage-indicator
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.css；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.css；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ContextUsageIndicator.tsx；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/server/utils/stream_utils.py
