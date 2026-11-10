---
name: feature-depth-web-navigation
description: Web 页面与功能入口实现深读：jiuwen:nav 与设置模块导航窗口事件契约、导航项隐藏规则与默认 chat 入口、功能关闭时回退 chat、App 的 ErrorBoundary 结构、AssetPublishHost 的全局事件与 sessionStorage 耦合、historyPrepending 复位取舍、sessionEventGate 测试
metadata:
  scope: 收 App.tsx 导航与宿主装配的七个 facet 深读，来源另含 index.tsx；职责边界、符号入口与验收建议归 feature-web-navigation
---
# Web 页面与功能入口：实现深读

## 现状

- [[feature-web-navigation]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **jiuwen:nav 与设置模块导航事件的窗口事件契约** 外部代码可向 window 派发 CustomEvent('jiuwen:nav')，detail 为 MainNavKey 时监听器调用 setActiveNav 切换主导航；detail 为假值时被忽略。SETTINGS_MODULE_NAVIGATION_EVENT 的监听器则不做该判空：收到事件即把 detail 存入 requestedSettingsModuleId 并切到 'settings'，因此调用方必须提供合法的 SettingsModuleTarget。
- 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L484–L501](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L484-L501)
- **导航项隐藏规则与默认入口** activeNav 默认为 'chat'（useState 初始值）。
  - hiddenNavItems 的取值顺序：先取 getHiddenNavItemsForPlatform(frontendPlatform) 作为基础，再按 rsiFeatureEnabled 追加 'experiments'、按 FEATURE_PERSONAL_CONTEXT_UI 追加 'personalContext'/'personalContextSettings'，masterEnabled 为 false 时仅隐藏 'personalContext'（保留设置页入口以便打开总开关）。
- 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L397–L397](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L397-L397),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L858–L870](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L858-L870)
- **功能关闭时的导航回退** 若 activeNav 停在被功能开关禁用的页面（如 FEATURE_APP_UPDATER_UI 为 false 时的 'updatepanel'、RSI 关闭时的 'experiments'、个人上下文总开关关闭时的 'personalContext'），effect 会把 activeNav 重置为 'chat'，避免渲染不可用入口。
- 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L466–L482](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L466-L482),
  - [jiuwenswarm/channels/web/frontend/src/App.tsx:L872–L876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L872-L876)
- **App 入口组件在单一 ErrorBoundary 内渲染 AppContent、DesktopTextEditContextMenu 与 AssetPublishHost** App 组件以 settingsPageDefinition 与 resolveSettingsRequest 两个 props 被调用,返回一棵 ErrorBoundary 包裹的元素树:DesktopTextEditContextMenu、原样转发这两个 props 的 AppContent,以及不接收 props 的 AssetPublishHost。
- 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L4134–L4151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L4134-L4151)
- **App 在 ErrorBoundary 内挂载无 props 的 AssetPublishHost，发布抽屉入口耦合全局事件与 sessionStorage** App 渲染单个不接收 props 的 AssetPublishHost；
  - 宿主 useEffect 在 window 上监听 'asset-publish-open'，把 event.detail 设为 selection 打开抽屉，并在 'oauth-callback-complete' 后从 sessionStorage 的 PUBLISH_RESTORE_KEY 恢复（仅当 kind 属于 skill/agent_template/agent_group/plugin/mcp 且 local_id 为 string，异常时移除该键）。因此打开入口不经 App 的 props。
- 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L4134–L4151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L4134-L4151),
  - [jiuwenswarm/channels/web/frontend/src/components/AssetPublishDrawer/index.tsx:L876–L913](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AssetPublishDrawer/index.tsx#L876-L913)
- **依赖 [sessionId] 的 effect 复位 historyPrepending 保住批次可揭示,代价是需前台 re-arm 输入意图闩** 设计推断（非作者历史意图）：
- 收益:该 effect 执行 setHistoryPrepending(false),注释指出若把后台预取当可见 prepend,再次访问的 Session 会因顶部边界门保持禁用而无法揭示已到达批次;成本:他处使用时保持挂载的 Session sessionId 不变,还需 rearmInputIntent 在页面回前台时重置输入意图闩。
- 来源：[jiuwenswarm/channels/web/frontend/src/App.tsx:L560–L579](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L560-L579)
- **sessionEventGate 用例断言挂起会话的事件此刻不送达** node:test 用例调用 createSessionEventGate 并 suspend('session-a'),随后派发 session-a 的 chat.delta/chat.tool_call 与 session-b 的 chat.delta,断言此刻仅送达 ['other session'];该断言只覆盖 gate 助手的输出。
- 来源：[jiuwenswarm/channels/web/frontend/tests/sessionEventGate.test.mjs:L19–L31](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/sessionEventGate.test.mjs#L19-L31)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-web-navigation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L397-L397；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L858-L870
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L466-L482；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L872-L876
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L484-L501；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L4134-L4151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx:L560-L579；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/sessionEventGate.test.mjs:L19-L31
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/AssetPublishDrawer/index.tsx:L876-L913
- 源页字段（feature）：web-navigation
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/App.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/*
