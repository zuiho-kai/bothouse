---
name: feature-code-mode-branch-selector
description: 代码模式分支选择器 CodeBranchSelector：五个 props 与 gitClient 初始化/切换/创建分支操作契约、WebError 码到中文文案映射、仅 code 模式非默认项目渲染、status/probe 与 liveRepo 双通道数据流、写操作禁用条件、data-testid 验证入口与设计推断
metadata:
  scope: 只收 CodeBranchSelector 的现状说明与设计取舍（契约、配置面、数据流、行为与验证入口）；挂载加载、props 默认值、CodeEnvironmentPanel 组合、liveRepo 合并取舍与空仓库禁用创建的逐点证据归 feature-depth-code-mode-branch-selector
---
# 代码模式分支选择器（CodeBranchSelector）

## 现状

- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 组件仅对 `work_mode === 'code'` 且非默认项目渲染（否则返回 null），把代码模式分支能力与其他项目隔离；这是从 props 判断得出的边界。选择双通道数据（主动 status/probe + liveRepo 增量覆写）换取环境面板实时性，但 currentBranch 有三级回退（liveRepo → status → project.git.branch），可能短暂显示陈旧值（推断）。错误处理以文案映射为主，全部操作共用一个 error 状态，不重试。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L128–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L128-L131),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L192–L192](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L192-L192)
- **验证入口**
- 组件自身源码中布满 `data-testid` 锚点（如 `code-mode-branch-selector`、`code-mode-branch-trigger` 带 `data-variant='init'|'switch'`、`code-mode-branch-menu`、`code-mode-branch-create-hint`、`code-mode-create-branch-dialog` 系列），并使用 `role='menu'`/`menuitemradio`/`aria-checked` 等可访问性语义，为 UI 测试与交互验证提供了钩子。
  - 本输入未包含对应测试文件，无法核实实际测试覆盖。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L195–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L195-L247),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L307–L331](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L307-L331)
- **公共入口与操作契约**
- 组件导出为 `CodeBranchSelector`，接收 `project`、`compact`、`disabled`、`variant`（'default' | 'environment'）与 `liveRepo` 五个 props；当 `project` 缺失、`work_mode !== 'code'` 或 `is_default` 时返回 null（不渲染）。
  - 三个写操作——初始化（`gitClient.init(project_id, 'main')`）、切换分支（`gitClient.switchBranch`）、创建分支（`gitClient.createBranch`，起点为当前分支）——成功后更新本地 status 并调用 `loadProjects()`；只读的 status/probe 加载成功路径不调用 `loadProjects()`。
  - 错误经 `getErrorMessage` 将 `WebError.code`（如 WORKTREE_DIRTY、GIT_TRANSIENT_STATE、BRANCH_NOT_FOUND、BRANCH_ALREADY_EXISTS、GIT_NOT_FOUND）映射为中文文案，但 `NOT_GIT_REPOSITORY` 例外：加载失败时它转入 notGit 状态而非错误提示。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L10–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L10-L34),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L55–L78](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L55-L78),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L138–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L138-L190)
- **可配置项与固定行为**
- 配置面由五个 props 构成，其中 `project` 直接决定行为：非 code 模式或默认项目既不加载状态也不渲染；`compact`/`variant` 仅切换样式类。`disabled` 并非简单透传：触发按钮将其与 `operating`（初始化按钮）或 `operating || loading || !status`（切换按钮）合并后作为 disabled。初始化分支名硬编码为 `'main'`（`gitClient.init(project.project_id, 'main')`），不接受用户配置。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L10–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L10-L16),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L197–L226](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L197-L226),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L138–L146](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L138-L146)
- **渲染边界与双通道状态数据流**
- 组件只对 `work_mode === 'code'` 且非默认（`is_default`）的项目工作：满足条件才在 `loadStatus` 中发起请求，否则清空状态，且渲染层直接返回 null。状态加载按 `project.git` 的已知程度分流：`git.status === 'ready'` 或 `git.enabled` 时调用 `gitClient.status`，否则先调用 `gitClient.probe`。
  - 组件另有第二数据通道：`liveRepo`（由环境面板的 diffWatch 注入）在守卫通过后（liveRepo 与 project 存在、code 模式且非默认项目）更新 `notGit`，并仅在已有 status 时把 `repo.is_git/repo_root/branch/head/transient` 与 `branches.current` 合并进去，不整体替换状态。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L55–L67](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L55-L67),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L192–L192](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L192-L192),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L84–L105](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L84-L105)
- **支持的功能行为**
- 组件覆盖三项 Git 分支操作：目录非 Git 仓库时提供“初始化 Git”按钮（调用 gitClient.init(project_id, 'main') 并刷新项目列表）；在下拉菜单中选中本地分支时调用 gitClient.switchBranch 切换——但当所选分支即当前分支（branch === currentBranch）时仅关闭菜单直接返回，不发起请求；通过“创建并检出新分支”对话框以当前分支为起点调用 gitClient.createBranch。操作成功后更新本地 status 并调用 loadProjects()。
  - 写操作入口有条件禁用：仓库处于 transient（合并/变基）或 detached HEAD 时切换与创建按钮禁用（branchWritesBlocked），空仓库（unborn HEAD，有分支名但无 head）时创建入口禁用并提示需先完成首次提交。组件被 CodeEnvironmentPanel 以 variant="environment"、compact 模式嵌入，并注入 diffWatch 的 liveRepo 以增量更新分支显示；liveRepo 不可用时 currentBranch 回退到 status 或 project.git.branch。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L128–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L128-L131),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L138–L190](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L138-L190),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L243–L285](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx#L243-L285),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L47–L56](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx#L47-L56)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-code-mode-branch-selector.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L128-L131
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L192-L192
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L195-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L307-L331
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L10-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L55-L78
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L138-L190
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L10-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L197-L226
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L138-L146
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L55-L67
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L84-L105
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx:L243-L285
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx:L47-L56
- 源页字段（feature）：code-mode-branch-selector
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeBranchSelector.tsx；jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeEnvironmentPanel.tsx
