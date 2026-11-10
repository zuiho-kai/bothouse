---
name: 2026-05-27-git-and-pr-branch-pollution-09
description: "2026-05-27 错题：PR #3734 rebase 后才拉模块 owner 与项目 owner 两个 sub-agent，抓到 P0/P1 后返工；改为形成方案/写代码前就开双 owner review，仅纯 typo 与无行为文档改动可跳过"
metadata:
  scope: 只收 2026-05-27 双 owner sub-agent 放到事后这一起事故；rebase 后漏状态矩阵的具体缺陷归 2026-05-27-git-and-pr-branch-pollution-08，漏主动 sub-agent review 归 2026-05-19-git-and-pr-branch-pollution-05
---
# 2026-05-27 — 双 owner sub-agent 放到事后，导致方案阶段漏问题

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-27-git-and-pr-branch-pollution-09.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-27-git-and-pr-branch-pollution-09`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：双 owner sub-agent 放到事后，导致方案阶段漏问题
- 影响范围：repos/vllm-omni/git
- **症状**：PR #3734 rebase 后确实拉了两个 sub-agent，但时间点是在冲突解决和本地验证之后、准备 push 之前。sub-agent 抓到 P0/P1 后还要返工改方案、补测试、amend commit。用户指出核心问题是“想怎么修改的时候就必须提前拉两个 sub agent 去以项目 owner 和模块 owner 角度思考怎么改，每次事后有点笨”。
- **根因**：把 sub-agent 当成 pre-push audit，而不是 design-time gate。等 patch 写完再问“有没有问题”，只能抓已经写出来的缺陷；真正该早发现的是 owner 边界、状态矩阵、测试矩阵和最小方案形状。
- **解法**：把双 owner review 前移到“形成修改方案 / 写代码前”：module owner 先审模块 contract、state matrix、edge cases、测试；omni project owner 先审 repo ownership、API surface、PR evidence、跨 pipeline/backends 影响。事后 reviewer-lens 仍保留，但不能替代动手前的方案审核。
- **怎么避免**：
  1. 非平凡业务改动开始想方案时就开两个 sub-agent，prompt 明确要求“propose/review intended change before implementation”，不要传一个已写 patch 让它事后找 bug。
  2. 两个 owner 任一返回 P0/P1，必须先改计划，再动手写代码；不能把“后面 push 前再修”当流程。
  3. 可跳过范围只限纯 typo、格式、无行为文档改动；runner / prefix cache / shared state / pipeline / public API / 新模型 / batching / streaming 默认不能跳。
