---
name: 2026-05-19-git-and-pr-branch-pollution-03
description: 2026-05-19 错题：用户要 PR 描述时先给了自由格式 Summary / Changes / Tests，未读 .github/PULL_REQUEST_TEMPLATE.md，应为 Purpose / Test Plan / Test Result
metadata:
  scope: 只收 2026-05-19 PR 描述没按 vLLM-Omni 模板写这一起事故；PR 描述渲染失败与 Test Plan 不可复现归 2026-05-20-git-and-pr-branch-pollution-04，分支污染归 2026-04-30-git-and-pr-branch-pollution-01
---
# 2026-05-19 — PR 描述没按 vLLM-Omni 模板写

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-19-git-and-pr-branch-pollution-03.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-git-and-pr-branch-pollution-03`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：PR 描述没按 vLLM-Omni 模板写
- 影响范围：repos/vllm-omni/git
- **症状**：用户要求“给我 PR 描述”，我先给了自由格式 `Summary / Changes / Tests`，用户指出“要符合 vllmomni 格式”。仓库实际有 `.github/PULL_REQUEST_TEMPLATE.md`，固定为 `Purpose / Test Plan / Test Result`。
- **根因**：没有先读 PR template，把通用 GitHub PR 格式套到了 vLLM-Omni。PR 描述是仓库公共接口的一部分，格式必须以仓库模板为准。
- **解法**：写 PR 描述前先读：

```bash
cat .github/PULL_REQUEST_TEMPLATE.md
```

- 输出只保留模板要求的主体：

```markdown
 ## Purpose

 ## Test Plan

 ## Test Result
```

- **怎么避免**：
  1. 任何“给我 PR 描述 / 开 PR / yeet”请求，先读 `.github/PULL_REQUEST_TEMPLATE.md`，没有模板才用通用格式。
  2. vLLM-Omni PR 描述必须用 `Purpose / Test Plan / Test Result`，不要用 `Summary / Changes / Tests`。
  3. Test Result 里贴具体命令和结果；远端验证要写节点/目录/venv，但不要写无关流水账。
