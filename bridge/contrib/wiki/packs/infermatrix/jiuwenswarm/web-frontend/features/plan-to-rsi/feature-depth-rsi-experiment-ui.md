---
name: feature-depth-rsi-experiment-ui
description: RSI 实验页实现深读：RsiPage 挂载拉取列表并选中第一个实验、CreateExperimentDialog 的 open/onClose/onCreated 契约、表单初始默认值与按分支守卫的校验、配置回显按场景裁剪字段的取舍、useRsiEvents 仅在 enabled 时订阅三类 RSI 事件
metadata:
  scope: 只收 RSI 实验页前端的实现级证据与设计推断；前后端契约、特性开关、三分支表单整体与单测入口归 feature-rsi-experiment-ui
---
# RSI 自我改进实验页（创建/列表/配置回显）：实现深读

## 现状

- [[feature-rsi-experiment-ui]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **RsiPage 挂载时拉取列表并自动选中第一个实验** RsiPage 挂载后调用 rsiStore 的 loadList 拉取实验列表；当列表加载完成、未选中且 list.length > 0 时通过 selectTask 选中 list[0].task_id，页面根据 selectedTaskId 是否存在切换 RsiRail+RsiDetail 或 RsiIntroduction 布局。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L28–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L28-L41),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L58–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L58-L76)
- **CreateExperimentDialog 的 props 契约为 { open, onClose, onCreated }，父组件用回调把新任务写入列表并选中** CreateExperimentDialog 接收 open/onClose/onCreated 三个 props（CreateExperimentDialog.tsx:105）。
  - RsiPage 以 createOpen 状态控制打开、onCreated 传 handleCreated：该回调对新建项调用 upsertListItem 后再 selectTask(item.task_id)，onClose 时将 createOpen 置回 false。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L105–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L105-L112),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L50–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L50-L56),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L78–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L78-L78)
- **创建表单初始默认值：scenario='HARNESS'、artifactType='PAPER'、evaluationMethod='agent'、maxIterations=2** useState(defaultForm) 以 defaultForm 作为惰性初始化器生成初始 FormState：name/optimizer/tester/datasetFile/optimizationInstruction/artifactPath/webProxy 均为空字符串，scenario 默认 HARNESS，maxIterations 默认 2。
  - 所示片段未显示对话框每次打开时重置表单的逻辑。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L89–L107](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L89-L107)
- **按分支守卫的表单校验：HARNESS 需数据集与 tester，PAPER 需指令或路径之一，PROGRAM 必须有路径** useMemo 在每次表单字段变化时重算 validationErrors：name 与 optimizer 必填；branch==='HARNESS' 时 datasetFile、tester 必填；branch==='PAPER' 时 optimizationInstruction 与 artifactPath 至少其一；branch==='PROGRAM' 时 artifactPath 必填。
  - 有错误时 hasValidationErrors 为真（所示片段未包含提交按钮的禁用分支）。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L114–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx#L114-L132)
- **配置回显按场景条件裁剪字段换取简洁，代价是信息受守卫限制** 设计推断（非作者历史意图）：
- 推断：ConfigInfoDialog 仅在对应守卫成立时展示字段（如 HARNESS 才显示 tester/input_file，isPaper 才显示 optimization_instruction 与 web_proxy 的已配置/未配置状态，isProgram 不显示 max_iterations），减少了无关字段，但用户在这些条件外看不到相应配置。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx:L39–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx#L39-L65)
- **useRsiEvents 仅在 enabled 时订阅 webClient 三类 RSI 事件并回写 rsiStore** 回调将 payload 经 normalize* 归一后按真值守卫调用 store 的 applyStatusChanged/applyProgress/applyTreeDelta；effect 返回的清理函数依次注销三个监听。RsiPage 挂载期间以 useRsiEvents(true) 开启订阅。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts:L17–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts#L17-L41),
  - [jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L28–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx#L28-L34)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-rsi-experiment-ui.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L28-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L58-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx:L39-L65
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L105-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L50-L56；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L78-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L89-L107
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx:L114-L132
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts:L17-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx:L28-L34
- 源页字段（feature）：rsi-experiment-ui
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/rsi/RsiPage.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/ConfigInfoDialog.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/CreateExperimentDialog.tsx
  - jiuwenswarm/agents/harness/common/rsi/artifact_adapter.py；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiDetail.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiRail.tsx；jiuwenswarm/channels/web/frontend/src/features/rsi/rsiStore.ts
  - jiuwenswarm/channels/web/frontend/src/features/rsi/featureConfig.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/types.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/styles/rsi.css；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiIntroduction.tsx
  - jiuwenswarm/channels/web/frontend/src/features/rsi/mockData.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/rsiPresentation.ts；jiuwenswarm/channels/web/frontend/src/features/rsi/components/RsiSelectedInfo.tsx；jiuwenswarm/agents/harness/common/rsi/paper_provider.py
  - jiuwenswarm/agents/harness/common/rsi/projector.py；jiuwenswarm/channels/web/frontend/src/features/rsi/useRsiEvents.ts
