---
name: 2026-05-20-remote-validation-018
description: "2026-05-20 错题：把 #3743 复现结果评论到 GitHub issue 时 connector _add_comment_to_issue 返回 403 Blocked；先在本地备好最终 Markdown 正文，失败一次即停止重试"
metadata:
  scope: 只收 2026-05-20 GitHub connector 可能无评论权限这一起事故及先准备可粘贴正文的解法；gh CLI keyring 失效归 2026-05-18-remote-validation-009，issue 复现本身归 2026-05-20-remote-validation-016
---
# 2026-05-20 — GitHub connector 可能无评论权限，先准备可粘贴正文

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/workflow-validation/2026-05-20-remote-validation-018.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-20-remote-validation-018`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：GitHub connector 可能无评论权限，先准备可粘贴正文
- 影响范围：repos/vllm-omni/remote
- **症状**：准备把 #3743 复现结果评论到 GitHub issue 时，connector 调用 `_add_comment_to_issue` 返回 `403 Blocked`。如果没有预先整理好 Markdown 正文，用户会再次等待我重写一遍。
- **根因**：把“能读 issue”误当成“能写 issue comment”；GitHub App/token 权限可能只读或被仓库策略拦截。
- **解法**：
  1. 调用写评论前，先在本地形成最终 Markdown 正文，保证 API 失败也能直接给用户粘贴。
  2. API 返回 403/blocked 后，不要重试多次；立即报告权限问题，并返回可复制正文。
  3. 评论内容必须区分“实测”与“caveat”：环境不一致、脚本不一致、endpoint fallback、关键配置如 `max_inflight`。
- **硬规则**：GitHub 写操作失败一次即停止重试；给用户完整 Markdown，不再消耗回合。
