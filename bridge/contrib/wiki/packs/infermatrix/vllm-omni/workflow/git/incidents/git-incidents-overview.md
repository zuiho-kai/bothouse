---
name: git-incidents-overview
description: vLLM-Omni Git 与 PR 错题分流表：2026-04-30 至 2026-05-29 共 10 起（分支污染与 cherry-pick hash、PR 模板、sub-agent review、public API 文档、worktree 规则、PR 描述渲染、rebase 状态矩阵、图片证据 head 绑定）与各页对照
metadata:
  scope: 只收 git/incidents 目录的错题标题与链接对照表；各起事故正文归表中所指的 2026-0x-xx-git-and-pr-branch-pollution-nn 页，指南归 git-overview
---
# vLLM-Omni Git 与 PR 错题

## 现状

| 错题 | 查看哪里 |
|---|---|
| 2026-04-30 — feature/hunyuan-t2t-sdpa-fa 分支污染 + cherry-pick 后 hash 失效 | [[2026-04-30-git-and-pr-branch-pollution-01]]（2026-04-30-git-and-pr-branch-pollution-01） |
| 2026-05-19 — PR 描述没按 vLLM-Omni 模板写 | [[2026-05-19-git-and-pr-branch-pollution-03]]（2026-05-19-git-and-pr-branch-pollution-03） |
| 2026-05-19 — 业务代码写完后漏主动 sub-agent review | [[2026-05-19-git-and-pr-branch-pollution-05]]（2026-05-19-git-and-pr-branch-pollution-05） |
| 2026-05-19 — 新 public API 字段 stream 缺文档被 reviewer block | [[2026-05-19-git-and-pr-branch-pollution-06]]（2026-05-19-git-and-pr-branch-pollution-06） |
| 2026-05-19 — PR #3734 code check 抓到参数 contract 和 helper 命名品味问题 | [[2026-05-19-git-and-pr-branch-pollution-07]]（2026-05-19-git-and-pr-branch-pollution-07） |
| 2026-05-20 — 违反 worktree 规则，在主仓工作区直接 apply_patch | [[2026-05-20-git-and-pr-branch-pollution-02]]（2026-05-20-git-and-pr-branch-pollution-02） |
| 2026-05-20 — PR #3766 描述渲染失败、图片裂、Test Plan 不可复现 | [[2026-05-20-git-and-pr-branch-pollution-04]]（2026-05-20-git-and-pr-branch-pollution-04） |
| 2026-05-27 — PR #3734 rebase 后漏掉 tail-only prefix-cache 状态矩阵 | [[2026-05-27-git-and-pr-branch-pollution-08]]（2026-05-27-git-and-pr-branch-pollution-08） |
| 2026-05-27 — 双 owner sub-agent 放到事后，导致方案阶段漏问题 | [[2026-05-27-git-and-pr-branch-pollution-09]]（2026-05-27-git-and-pr-branch-pollution-09） |
| 2026-05-29 — PR #3626 图片证据复用旧 head，且公开评论泄露内部 artifact path | [[2026-05-29-git-and-pr-branch-pollution-10]]（2026-05-29-git-and-pr-branch-pollution-10） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/_index.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
