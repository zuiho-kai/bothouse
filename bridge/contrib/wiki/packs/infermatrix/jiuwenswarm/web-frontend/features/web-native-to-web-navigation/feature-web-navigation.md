---
name: feature-web-navigation
description: Web 页面与功能入口功能概览：导航与会话状态分离的职责边界、shouldPreviewModelSetupGuide 等五个符号入口、配置查证路由、设计取舍、数据流关联（web-chat、models、applications）与验证步骤
metadata:
  scope: 只收页首说明与六节摘要；导航事件、隐藏规则与回退等实现细节归 feature-depth-web-navigation
---
# Web 页面与功能入口 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-web-navigation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/App.tsx；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/页面概览.md
- 源页字段（feature）：web-navigation
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/App.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/*；jiuwenswarm/channels/web/frontend/src/hooks/useAdaptiveTooltip.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/ChannelsModule.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/SettingsChannelsPanel.css；jiuwenswarm/channels/web/frontend/src/components/ui/FormDrawer/FormDrawer.css；jiuwenswarm/channels/web/frontend/src/components/ui/FormDrawer/FormDrawer.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ui/Input/Input.css；jiuwenswarm/channels/web/frontend/src/components/ui/Input/Input.tsx；jiuwenswarm/channels/web/frontend/src/components/ui/Textarea/Textarea.css
  - jiuwenswarm/channels/web/frontend/src/components/ui/Textarea/Textarea.tsx；jiuwenswarm/channels/web/frontend/index.html；jiuwenswarm/channels/web/frontend/src/hooks/useFullscreenPanel.ts；jiuwenswarm/channels/web/frontend/src/hooks/useHorizontalScrollEdges.ts
  - jiuwenswarm/channels/web/frontend/src/components/ui/Toast/Toast.css；jiuwenswarm/channels/web/frontend/src/components/ui/Toast/Toast.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/registry/accessPolicy.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/registry/openSourceDefinition.ts；jiuwenswarm/channels/web/frontend/src/components/ui/InfoCard/InfoCard.tsx；jiuwenswarm/channels/web/frontend/src/components/ui/PageCard/PageCard.css
  - jiuwenswarm/channels/web/frontend/src/components/ui/PageCard/PageCard.tsx；jiuwenswarm/channels/web/frontend/src/components/ui/PageToolbarSearch/PageToolbarSearch.tsx；jiuwenswarm/channels/web/frontend/src/components/PersonalContext/Intro.tsx
  - jiuwenswarm/channels/web/frontend/src/components/PersonalContext/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ui/Select/Select.css；jiuwenswarm/channels/web/frontend/src/components/ui/Select/Select.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingItemRenderer.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingRow.css；jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingRow.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingsConfirmDialog.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/components/SettingsSection.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/settingsNavigation.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/services/createSettingsRequestRouter.ts；jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsSaveQueue.ts；jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsServicesProvider.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsSourceProvider.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/services/SettingsUnsavedChangesRegistry.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/services/useSettingsFormDialogClose.ts；jiuwenswarm/channels/web/frontend/src/features/settings/services/useUnsavedChanges.ts；jiuwenswarm/channels/web/frontend/src/components/ToolPanel/index.tsx
  - jiuwenswarm/channels/web/frontend/src/main.tsx；jiuwenswarm/channels/web/frontend/src/multi-session/routing/route.ts；jiuwenswarm/channels/web/frontend/src/multi-session/routing/useChatRoute.ts；jiuwenswarm/channels/web/frontend/src/components/SessionSidebar/SessionSidebar.css
  - jiuwenswarm/channels/web/frontend/src/components/SessionSidebar/index.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/channelAdapters.ts；jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelConfigDialog.tsx
  - jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/components/ChannelListSection.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/modules/channels/useSettingsChannelsController.ts
  - jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPage.css；jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPage.tsx；jiuwenswarm/channels/web/frontend/src/features/settings/SettingsPageLayout.tsx
  - jiuwenswarm/channels/web/frontend/src/features/singleAgentPanelState.ts；jiuwenswarm/channels/web/frontend/src/features/teamPanelState.ts；jiuwenswarm/channels/web/frontend/src/features/teamPanelStateNormalize.ts
  - jiuwenswarm/channels/web/frontend/src/components/ui/Toast/toastStore.ts；jiuwenswarm/channels/web/frontend/src/index.css
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 页面把对话、智能体、技能、任务和配置入口连接起来。导航状态与运行中会话状态分别维护，切换视图不等同于取消后台任务。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/App.tsx:L1–L4153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1-L4153)；
  - [docs/zh/页面概览.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B5%E9%9D%A2%E6%A6%82%E8%A7%88.md#L1-L149)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `shouldPreviewModelSetupGuide`；`normalizeConfigBoolean`；`getWorkContextForSession`；`clearTeamRuntimeState`；`waitForNextPaint`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/App.tsx:L1–L4153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1-L4153)；
  - [docs/zh/页面概览.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B5%E9%9D%A2%E6%A6%82%E8%A7%88.md#L1-L149)。

### 配置入口与生效条件

- 配置与启用条件的权威入口是下列功能文档和实现的调用方。本页提供查证路由：先确认当前宿主、会话或运行模式，再检查文档中的操作条件与实现消费的输入；不把 UI 文案、文件名或方法名猜作可写配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/App.tsx:L1–L4153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1-L4153)；
  - [docs/zh/页面概览.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B5%E9%9D%A2%E6%A6%82%E8%A7%88.md#L1-L149)。

### 设计取舍

- **设计推断**：图标导航将对话、任务、配置与扩展页面集中在一个宿主中，减少入口分散；代价是导航状态必须与会话运行状态协调。某页面可见只能证明 UI 入口存在，模型、频道或插件是否已准备好仍由对应服务决定。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/App.tsx:L1–L4153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1-L4153)；
  - [docs/zh/页面概览.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B5%E9%9D%A2%E6%A6%82%E8%A7%88.md#L1-L149)。

### 数据流与关联功能

- 页面把对话、智能体、技能、任务和配置入口连接起来。导航状态与运行中会话状态分别维护，切换视图不等同于取消后台任务。 联调时结合[[feature-web-chat-1]]、[[feature-web-chat-2]]（Web 对话与流式状态）、[[feature-models]]（模型平台与 API 配置）、[[feature-applications]]（Application Plugin 与前端贡献）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/App.tsx:L1–L4153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1-L4153)；
  - [docs/zh/页面概览.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B5%E9%9D%A2%E6%A6%82%E8%A7%88.md#L1-L149)。

### 怎样验证

- 逐个导航入口检查页面挂载、返回对话后的会话状态与任务状态；验证配置保存的响应和对应服务采用新配置的时机。对禁用插件检查入口可见性与运行时调用的拒绝行为。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/App.tsx:L1–L4153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/App.tsx#L1-L4153)；
  - [docs/zh/页面概览.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A1%B5%E9%9D%A2%E6%A6%82%E8%A7%88.md#L1-L149)。
