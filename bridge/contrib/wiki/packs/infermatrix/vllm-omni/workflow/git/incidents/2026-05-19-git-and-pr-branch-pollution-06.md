---
name: 2026-05-19-git-and-pr-branch-pollution-06
description: "2026-05-19 错题：PR #3723 新增 /v1/images/edits 的 stream 表单参数与 SSE chunk schema，缺 docs 被 reviewer hsliuustc0106 requested changes；补 docs/serving/image_edit_api.md 并把 docs surface 纳入 Surface area audit"
metadata:
  scope: 只收 2026-05-19 新 public API 字段 stream 缺文档被 reviewer block 这一起事故；漏主动 sub-agent review 归 2026-05-19-git-and-pr-branch-pollution-05，新增内部参数 docstring 与 helper 命名归 2026-05-19-git-and-pr-branch-pollution-07
---
# 2026-05-19 — 新 public API 字段 stream 缺文档被 reviewer block

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-19-git-and-pr-branch-pollution-06.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-git-and-pr-branch-pollution-06`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：新 public API 字段 stream 缺文档被 reviewer block
- 影响范围：repos/vllm-omni/git
- **症状**：PR #3723 新增 `/v1/images/edits` 的 `stream` 表单参数和 SSE chunk schema，reviewer `hsliuustc0106` requested changes：`stream` 是新的 public API field，必须补文档说明 streaming response format、`ar_delta`、final image、`[DONE]` 以及何时使用。
- **根因**：我把“代码 + 测试 + PR 描述”当成交付闭环，漏了 public API 的 docs surface。`code_taste.md` 已经写了 API 面规则，但我当时只用它看代码形状（helper 复用、edge cases），没有把“新增 API field 必须同步 docs”列成硬卡点；sub-agent review prompt 也没有要求检查 documentation surface，所以它抓到了行为问题但没抓 docs 缺口。
- **解法**：补 `docs/serving/image_edit_api.md`：参数表新增 `stream`，新增 streaming response format 小节，写清只支持多阶段 HunyuanImage3 IT2I AR+DiT、SSE 顺序 `ar_delta` → `image` → `[DONE]`、error chunk 格式和 curl 示例；同时修该页原有未闭合 code fence/表格行，避免新增文档渲染失败。PR body 的 Test Plan/Result 同步写入 docs check。
- **怎么避免**：
  1. 任何新增 public API 字段 / CLI 参数 / config key / SSE chunk schema / OpenAI-compatible 参数，提交前必须 `rg` 对应 docs，并同步文档；没有文档页也要在 PR 里明确说明为什么不需要。
  2. reviewer-lens 的 Surface area audit 要包括 docs surface：新增 knob 是否有用户语义、默认值、适用条件、响应格式和错误格式文档。
  3. PR 描述的 Test Plan 不能只列代码测试；public API 变更必须列 documentation coverage，Test Result 至少有 `git diff --check` 或 mkdocs/markdown 渲染检查。
