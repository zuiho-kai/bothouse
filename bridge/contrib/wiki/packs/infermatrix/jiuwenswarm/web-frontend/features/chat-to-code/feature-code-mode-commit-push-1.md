---
name: feature-code-mode-commit-push-1
description: 代码模式提交/推送对话框 CodeCommitPushControl（上）：props 与 gitClient/gitPublishState 依赖，远程名、includeUnstaged、setUpstream、提交信息与分支名长度等表单默认值，提交/提交并推送/仅推送三种操作与禁用守卫
metadata:
  scope: 只收组件接口与依赖、表单默认值、支持的操作与守卫三段；data-testid 测试挂载点、两阶段提交失败恢复、关闭守卫不对称与数据流归 feature-code-mode-commit-push-2，Escape 关闭等逐点实现证据归 feature-depth-code-mode-commit-push
---
# 代码模式提交/推送对话框（CodeCommitPushControl）（1/2）

## 现状

- 拆分说明：本页是源页 `feature-code-mode-commit-push.md` 的第 1/2 部分；第 2 部分 [[feature-code-mode-commit-push-2]]
- **组件接口与依赖的后端调用**
- `CodeCommitPushControl` 是一个 React 函数组件，props 包括 `project`、`branch`、`hasChanges`、`filesChanged`、`isGit`、`transient`、`isProcessing`、`variant`（`environment` 或 `review`，决定触发按钮样式）和成功回调 `onSuccess`。
  - 它不直接访问网络层，而是通过 `gitClient` 的 `status`、`commit`、`push`、`createBranch` 方法完成全部 Git 操作，从 `gitPublishState` 复用 `GitPublishOperation` 类型、`defaultCommitMessage`、`gitPublishErrorMessage` 与 `remoteNames`。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L10–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L10-L20),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L73–L74](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L73-L74),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L139–L142](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L139-L142),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L162–L174](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L162-L174)
- **表单默认值与交互选项**
- 可配置项均为对话框内表单状态：远程仓库名默认取 `remoteNames(...)[0]`；`includeUnstaged`（提交时是否 stageAll）默认 true；`setUpstream` 默认根据 `status.repo.upstream` 是否存在决定，选择非当前分支时自动置 true。提交信息留空时回退到 `defaultCommitMessage(filesChanged)` 生成的默认消息，输入框 `maxLength=200` 并显示计数；新分支名输入 `maxLength=255`。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L46–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L46-L51),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L79–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L79-L82),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L119–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L119-L119),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L356–L361](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L356-L361)
- **支持的操作与守卫条件**
- 支持三种操作：仅提交、提交并推送、仅推送；提交时可勾选包含未暂存更改（透传为 `stageAll`），推送时可勾选设置上游分支。对话框内可新建并检出分支（unborn HEAD 或仓库处于 transient Git 操作时禁用该入口）。触发按钮在 `isProcessing`、非 Git 仓库或 `transient` 时禁用，并以 `title` 说明原因；提交按钮要求操作含提交时工作区有改动、含推送时已选分支和非空远程。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L121–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L121-L131),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L278–L291](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L278-L291),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L365–L388](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L365-L388)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-code-mode-commit-push.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L10-L20
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L73-L74
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L139-L142
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L162-L174
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L46-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L79-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L119-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L356-L361
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L121-L131
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L278-L291
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L365-L388
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L198-L205
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L243-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L374-L384
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L407-L420
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L181-L189
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L95-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L228-L233
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L63-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L153-L180
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L133-L145
- 源页字段（feature）：code-mode-commit-push
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx
