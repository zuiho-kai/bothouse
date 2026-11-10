---
name: feature-depth-code-mode-commit-push
description: 提交/推送对话框实现深读：Escape 关闭守卫与分支创建区收起、createBranch 成功后 onSuccess 的 promise 拒绝被抑制、defaultCommitMessage 规则与远程名回退 origin、gitClient 与 gitPublishState 具名导入、createBranch 被拒时错误归一并保持面板打开、关闭/取消按钮在提交或建分支期间禁用
metadata:
  scope: 只收 CodeCommitPushControl 的实现级证据与设计推断；组件职责、表单默认值、三种操作与数据流总览归 feature-code-mode-commit-push-1、feature-code-mode-commit-push-2
---
# 提交/推送对话框（commit、push、commit_push）：实现深读

## 现状

- [[feature-code-mode-commit-push-1]]、[[feature-code-mode-commit-push-2]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **打开对话框后按 Escape 关闭（非提交中且非建分支中）** 对话框 open 时注册 document keydown 回调：按 Escape 且不在 submitting/creatingBranch 时，若分支创建区已展开则先收起并清空 branchDraft，否则 setOpen(false) 关闭整个对话框。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L95–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L95-L108)
- **createBranch 回调契约：成功后调用 onSuccess()，仅抑制其异步拒绝** createBranch 守卫为 status、非空 trim 后分支名且未在 creatingBranch/submitting；成功路径调用 gitClient.createBranch(project.project_id, nextBranch)，随后同步调用 onSuccess()，其返回 promise 的拒绝被 .catch(() => undefined) 抑制；同步抛出的异常落入外层 catch 设为 error。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L133–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L133-L151),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L10–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L10-L18)
- **默认提交信息按 filesChanged 生成，远程名缺省回退 'origin'** message 为空白时用 defaultCommitMessage(filesChanged)：≤0 为 'Update project files'，1 为 'Update 1 file'，否则 'Update N files'；remoteNames 在无远程分支名时返回 ['origin']。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts:L5–L13](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts#L5-L13),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L117–L119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L117-L119)
- **组件依赖 gitClient 与 gitPublishState 的具名导出** 组件从 './gitClient' 导入 gitClient，从 './gitPublishState' 导入 defaultCommitMessage、gitPublishErrorMessage、remoteNames 与类型 GitPublishOperation；createBranch 回调内部 await gitClient.createBranch(project.project_id, nextBranch)。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L1–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L1-L8),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L133–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L133-L148)
- **createBranch 被拒时：错误经 gitPublishErrorMessage 归一，分支面板保持打开** 若 gitClient.createBranch 抛出 nextError，catch 分支用 gitPublishErrorMessage(nextError, '创建分支失败，请重试。') 写入 error；因 setBranchCreateOpen(false) 仅在 await 成功后执行，新建分支面板保持打开，finally 将 creatingBranch 复位为 false。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L139–L150](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L139-L150),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts:L29–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts#L29-L34)
- **关闭与取消按钮在 submitting 或 creatingBranch 期间被禁用（仅限这两个按钮）** 设计推断（非作者历史意图）：
- 对话框头部关闭按钮（L247）和底部取消按钮（L414）的 disabled 守卫均为 submitting || creatingBranch，即等待期间这两条 UI 关闭路径被阻塞；推断这是以牺牲等待期的可取消性换取避免在提交/建分支中途关闭对话框。该证据不覆盖 Escape 或遮罩点击等其他关闭路径，也不证明两标志在 awaited 调用结束后必被复位。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L245–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L245-L250),
  - [jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L413–L421](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx#L413-L421)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-code-mode-commit-push.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L95-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts:L5-L13
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L117-L119
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L133-L151
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L10-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L1-L8
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L133-L148
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L139-L150
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/gitPublishState.ts:L29-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L245-L250
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx:L413-L421
- 源页字段（feature）：code-mode-commit-push
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/code-mode/CodeCommitPushControl.tsx
