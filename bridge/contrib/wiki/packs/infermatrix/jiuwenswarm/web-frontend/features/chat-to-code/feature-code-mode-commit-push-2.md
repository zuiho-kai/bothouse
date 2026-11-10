---
name: feature-code-mode-commit-push-2
description: 代码模式提交/推送对话框（下）：data-testid 测试挂载点、commit 成功而 push 失败时保留 hash 并切回 push 的失败恢复与 Escape/遮罩关闭守卫不对称、打开到 onSuccess 与 3 秒成功 toast 的数据控制流
metadata:
  scope: 只收测试挂载点、两阶段提交失败恢复与关闭守卫、组件职责与数据控制流三段；props、表单默认值与操作守卫归 feature-code-mode-commit-push-1，逐点实现证据归 feature-depth-code-mode-commit-push
---
# 代码模式提交/推送对话框（CodeCommitPushControl）（2/2）

## 现状

- 拆分说明：本页是源页 `feature-code-mode-commit-push.md` 的第 2/2 部分；第 1 部分 [[feature-code-mode-commit-push-1]]
- **测试挂载点**
- Inference / 设计推断（非作者历史意图）：
- 组件暴露了密集的 `data-testid` 钩子，覆盖触发按钮（`code-mode-publish-trigger`，带 `data-variant`）、对话框本身、加载态、分支选择/新建、远程选择、提交信息、三种操作单选（`code-mode-publish-operation` 带 `data-variant`）、选项复选框、错误区和提交按钮，以及成功 toast（`code-mode-publish-toast`）。这些命名稳定的选择器即为端到端/组件测试的入口；本次输入未包含对应测试文件，具体用例无法确认。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L198–L205](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L198-L205),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L243–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L243-L247),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L374–L384](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L374-L384),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L407–L420](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L407-L420)
- **两阶段提交的失败恢复与关闭守卫的不对称**
- Inference / 设计推断（非作者历史意图）：
- commit 与 push 在前端拆成两次串行请求而非单一后端操作：当 `commit_push` 中提交成功而推送失败时，组件保留已提交的 hash，仍触发 `onSuccess` 刷新，把操作切回 `push` 并显示「提交已成功（hash），但推送失败」的错误，让用户只需重试推送（推断：以多次往返换取部分失败的可恢复性）。
  - 关闭守卫存在不对称：Escape 处理在 `submitting` 或 `creatingBranch` 时阻止关闭（建分支面板打开时 Escape 仅收起该面板），但遮罩点击关闭只检查 `submitting`，因此 `creatingBranch` 期间仍可能通过点击遮罩关闭对话框。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L181–L189](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L181-L189),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L95–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L95-L108),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L228–L233](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L228-L233)
- **组件职责与数据/控制流**
- `CodeCommitPushControl` 是一个自管理打开状态的 React 展示组件：对话框的 `open` 由内部 `useState` 维护，外部只通过 props 传入 `project`、`branch`、`hasChanges`、`isGit`、`transient`、`isProcessing`、`variant` 等上下文和 `onSuccess` 回调，不接收打开/关闭控制。
  - 数据流为：打开时（`open` 变为 true 的 effect）调用 `gitClient.status(project.project_id)` 拉取仓库状态，并据此初始化分支、远程、`setUpstream` 与默认操作类型（脏工作区且非 detached HEAD 时为 `commit_push`，detached 时为 `commit`，干净时为 `push`）；
  - 提交时按所选操作条件执行——含提交则先 `gitClient.commit`（透传 `stageAll`），含推送则 `gitClient.push`（远程、分支、`setUpstream`），成功路径为先调用 `onSuccess`，再关闭对话框并设置 3 秒自动消失的成功 toast（通过 `createPortal` 挂到 `document.body`）。新建分支是独立子流程，调 `gitClient.createBranch` 后用返回的 `status`/`branch` 就地刷新表单状态。
- Sources / 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L10–L20](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L10-L20),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L63–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L63-L82),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L153–L180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L153-L180),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L133–L145](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L133-L145)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-code-mode-commit-push.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
