---
name: 2026-05-19-git-and-pr-branch-pollution-07
description: "2026-05-19 错题：PR #3734 prefix-cache CPU staging dedup 经 code check 抓到两个 P2 品味问题：update_omni_tensor_prefix_cache 新增 hidden_states_cpu 参数缺 docstring contract、generic helper _get_merged_tensors 参数名泄漏 hidden-state caller 语义"
metadata:
  scope: "只收 2026-05-19 PR #3734 新增参数 docstring contract 与 helper 命名这一起事故；PR #3734 rebase 后漏状态矩阵归 2026-05-27-git-and-pr-branch-pollution-08，public API 缺文档归 2026-05-19-git-and-pr-branch-pollution-06"
---
# 2026-05-19 — PR #3734 code check 抓到参数 contract 和 helper 命名品味问题

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-19-git-and-pr-branch-pollution-07.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-git-and-pr-branch-pollution-07`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：PR #3734 code check 抓到参数 contract 和 helper 命名品味问题
- 影响范围：repos/vllm-omni/git
- **症状**：PR #3734 prefix-cache CPU staging dedup 经过 code check 后没有 P0/P1 正确性问题，但有两个 P2 品味问题：(1) `update_omni_tensor_prefix_cache(..., hidden_states_cpu=...)` 新增 optional 参数后，Args docstring 没写 CPU / contiguous / 覆盖 token 长度 / layout contract；
  - (2) generic `_get_merged_tensors` helper 的参数名叫 `hidden_states_cpu`，泄漏了 hidden-state caller 语义。
- **根因**：实现时把注意力放在 hot path 行为和兼容 fallback 上，没把“新增内部参数”当 API surface 审；命名从 profiling 语境出发，没有回到 helper 所在抽象层级检查。
- **解法**：把两条规则补进 `code_taste.md` / `reviewer_lens_audit.md` / `CLAUDE.md` F10：新增参数必须同步 docstring contract；generic helper 命名不能泄漏 caller-specific 语义。
- **怎么避免**：
  1. 任意方法新增参数（包括 internal optional fast path）都要补 docstring contract：ownership、device、contiguous、shape/layout、覆盖长度、`None` fallback。
  2. helper 命名前先问“这个 helper 是 generic 还是 caller-specific”：generic helper 用 `tensor_cpu` / `staged_cpu_tensor` 这类抽象层级名字，专用 helper 才用 `hidden_states_cpu`。
  3. push 前 diff 自审加两项：新增参数 docstring 是否同步；helper 名字是否需要在 PR comment 里额外解释。如果需要解释，优先改代码表达。
