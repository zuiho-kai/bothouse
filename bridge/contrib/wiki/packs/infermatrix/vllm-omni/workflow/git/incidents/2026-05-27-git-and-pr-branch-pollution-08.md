---
name: 2026-05-27-git-and-pr-branch-pollution-08
description: "2026-05-27 错题：PR #3734 rebase 解决 prefix_cache.py / gpu_ar_model_runner.py 冲突后，prefix cache 开启且 requires_full_prefix_cached_hidden_states=False 时 hidden_states_cpu 为 None，_resolve_req_hidden_states 切 None[start:end]；补 needs_scheduled_hidden_payload 分支与状态矩阵"
metadata:
  scope: "只收 2026-05-27 PR #3734 rebase 后漏掉 tail-only prefix-cache 状态矩阵这一起事故；双 owner sub-agent 放到事后归 2026-05-27-git-and-pr-branch-pollution-09，参数 docstring 与 helper 命名归 2026-05-19-git-and-pr-branch-pollution-07"
---
# 2026-05-27 — PR #3734 rebase 后漏掉 tail-only prefix-cache 状态矩阵

## 关键事实

- 源页：`knowledge/repos/vllm-omni/git/incidents/2026-05-27-git-and-pr-branch-pollution-08.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-27-git-and-pr-branch-pollution-08`
- 归属：`repos/vllm-omni/git`
- 状态：已验证
- 搜索词：PR #3734 rebase 后漏掉 tail-only prefix-cache 状态矩阵
- 影响范围：repos/vllm-omni/git
- **症状**：把 PR #3734 rebase 到最新 main 并解决 `prefix_cache.py` / `gpu_ar_model_runner.py` 冲突后，两个 owner-framed sub-agent 都抓到同一个问题：`prefix cache enabled + requires_full_prefix_cached_hidden_states=False` 时，runner 不做 full-prefix hidden merge，但 downstream/pooler 仍需要本 step scheduled-token hidden payload。
  - 冲突解决后的代码只在 `self.omni_prefix_cache is None` 时准备 `hidden_states_cpu`，导致 `combined_hidden_states=None` 后 `_resolve_req_hidden_states()` 会切 `None[start:end]`。模块 owner 定 P0，项目 owner 定 P1。
- **根因**：冲突解决只把 main 的 deferred mm cache 逻辑和 PR 的 hidden-state CPU staging fast path 合并到默认路径，没重新列状态矩阵。HunyuanImage3 profiling 覆盖的是 full-prefix hidden path；Qwen3-TTS 这类 `requires_full_prefix_cached_hidden_states=False` tail-only 模型没有进测试矩阵。
  - ruff / py_compile / diff clean 都只能证明语法和格式，不能证明 feature-flag 组合语义。
- **解法**：在 GPU runner 里增加 `needs_scheduled_hidden_payload` 分支：prefix cache 开启但模型 opt-out full-prefix merge 时，仍复用 execute_model 阶段的 `staged_hidden_states_cpu` 给 pooler payload 切分；如果缺 staged tensor 就早炸。同时补 `hidden_states_cpu` dtype fail-fast、merge-path contract docstring、tail-only prefix-cache 回归测试。
- **怎么避免**：
  1. 改 runner / prefix cache / pooler payload / shared execution state 后，rebase/cherry-pick 冲突解决必须重审状态矩阵：cache on/off、prefix hit/miss、feature flag true/false（如 `requires_full_prefix_cached_hidden_states`）、downstream req all/subset、last/non-last PP rank、staged CPU tensor None/fallback、
     - deferred mm keys。
  2. owner audit prompt 不能只问“看有没有问题”；project owner 查 repo integration/state ownership，module owner 查具体 contract/edge cases。两个结果里任一 P0/P1 必须先修再 push。
  3. 性能 PR 的验证不能只覆盖 profiling workload 的默认模型路径；如果改动跨 runner/cache/payload owner，至少给非默认 feature flag 加一个 owner-boundary unit/smoke，或在 PR 里明确该分支不适用。
