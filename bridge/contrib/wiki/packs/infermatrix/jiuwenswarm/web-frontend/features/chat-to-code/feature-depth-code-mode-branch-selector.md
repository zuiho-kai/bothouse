---
name: feature-depth-code-mode-branch-selector
description: 分支选择器实现深读：挂载时 loadStatus 与非 Git 目录的初始化按钮、props 签名与默认值、CodeEnvironmentPanel 注入 liveRepo/isProcessing 的组合方式、liveRepo 仅在已有 status 时合并的取舍、可关闭 alert 错误块与空仓库禁用创建分支
metadata:
  scope: 只收 CodeBranchSelector 的实现级证据与设计推断；组件整体职责、gitClient 操作契约与错误码映射归 feature-code-mode-branch-selector
---
# 代码模式分支选择器（初始化/切换/创建分支）：实现深读

## 现状

- [[feature-code-mode-branch-selector]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **挂载时加载状态；仅在 project 存在、work_mode='code' 且非默认项目时渲染** 组件挂载后 useEffect 调用 loadStatus()（依赖 [loadStatus]）；若 !project、project.work_mode !== 'code' 或 project.is_default 则整个组件返回 null。当目录不是 Git 仓库时渲染 data-variant='init' 的“初始化 Git”按钮，点击触发 initializeGit()，disabled 条件为 disabled || operating。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L80–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L80-L82),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L192–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L192-L207)
- **props 契约：compact/disabled/variant/liveRepo 均有默认值** 签名 { project, compact = false, disabled = false, variant = 'default', liveRepo = null }。调用方 CodeEnvironmentPanel 传入 compact、variant="environment"、disabled={isProcessing}、liveRepo={diffWatch.summary?.repo ??
  - null}，即处理期间禁用、用 diffWatch 的仓库摘要实时同步分支状态。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L36–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L36-L37),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L47–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx#L47-L49)
- **默认 compact=false、disabled=false、variant='default'、liveRepo=null** 四个可选 prop 均有默认值；compact 追加 code-branch--compact 类，variant==='environment' 追加 code-branch--environment 类；disabled 与内部 operating 共同禁用初始化按钮。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L36–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L36-L36),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L195–L204](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L195-L204)
- **被 CodeEnvironmentPanel 组合：liveRepo 来自 diffWatch，uses useWorkspaceStore 的 loadProjects** CodeEnvironmentPanel 从 './CodeBranchSelector' 导入并在分支行渲染它，liveRepo 取自 diffWatch.summary?.repo，disabled 取 isProcessing，因此选择器的实时仓库状态与 diff 监听耦合；组件自身还从 useWorkspaceStore 取 loadProjects。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L4–L6](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx#L4-L6),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L47–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx#L47-L49),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L48–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L48-L48)
- **liveRepo 同步避免重新请求，但仅在已有 status 时合并** 设计推断（非作者历史意图）：
- 当 liveRepo 存在且 project.work_mode === 'code' 且非默认项目时，用 liveRepo 的 is_git/repo_root/branch/head/transient 覆盖本地 status.repo。收益：父面板的 diffWatch 摘要可直接驱动分支显示，无需再次 loadStatus；代价（推理）：若 previous 为 null（状态尚未加载成功），该 effect 不填充 status，初始状态仍依赖 loadStatus 的结果。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L84–L97](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L84-L97)
- **错误以可关闭的 alert 呈现；空仓库（isUnbornHead）时禁用创建分支按钮** 当 error 非空时，菜单内渲染 role='alert' 的错误块（含文案与关闭按钮，点击将 error 置为 null）；当 isUnbornHead 为真时，创建分支按钮因 branchWritesBlocked || isUnbornHead 被禁用，并显示提示“空仓库需要完成首次提交后才能创建其他分支”。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L262–L270](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L262-L270),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L277–L285](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L277-L285)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-code-mode-branch-selector.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L36-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L195-L204
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L4-L6
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L47-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L48-L48
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L80-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L192-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L36-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L84-L97
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L262-L270
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L277-L285
- 源页字段（feature）：code-mode-branch-selector
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx；jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx
