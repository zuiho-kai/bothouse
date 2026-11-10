---
name: 2026-05-08-ci-and-testing-16
description: "2026-05-08 CI 错题 inc-2026-05-08-ci-and-testing-16，测 PR #3055 时把 --gebench-t2i-only 这个 DiT-only 定位 flag 误读成测试盲点，劝用户跑 PR scope 外的 IT2I trajectory（首个 commit 8ee36c49 已写明边界）"
metadata:
  scope: "只收 2026-05-08 把 PR #3055 scope 内的功能门当成覆盖盲点的错题与读首个 commit message 等五条提醒；该 PR 的测试入口错题归 2026-05-08-ci-and-testing-15"
---
# 2026-05-08 — 把 PR scope 内的"功能门"误读成"测试盲点"，建议跑 PR scope 外的路径

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-08-ci-and-testing-16.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-08-ci-and-testing-16`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：把 PR scope 内的"功能门"误读成"测试盲点"，建议跑 PR scope 外的路径
- 影响范围：repos/vllm-omni/ci
- **症状**：测 PR #3055 时，`--gebench-t2i-only` flag 让 type3/type4 trajectory 只生成 frame0。我把这个观察包装成"测试只 cover 第 1 帧，缺了 logic/cons/goal 三个核心维度，应该去掉这个 flag 跑全 6 帧 trajectory"，劝用户重跑 IT2I 路径。用户怒：「我要 --dit-only」「智力太差，记一下」
- **根因**：PR #3055 第一个 commit `8ee36c49` 已经写明：
  - `pipeline_registry.py: register HUNYUAN_IMAGE3_DIT_ONLY as default for HF model_type "hunyuan_image_3_moe"`
  - `pipeline.py: DIT_ONLY topology (pure T2I path, no AR stage)`
  - `gbench.py: add --t2i-only flag (skips IT2I edits in generate and evaluate; type1/2/5 are out of scope until the AR->DiT bridge lands)` 整个 PR 就是 **DiT-only 单图测试**——`--gebench-t2i-only` 不是"偷懒少测"的开关，是**这条 PR 的核心定位 flag**。
    - 我读了 commit message 还把它定性成"覆盖盲点"建议跑 trajectory，等于劝用户做 PR-scope-out 的 IT2I 测试，那条路在这个 PR 里**根本没接通**（pipeline 是 DIT_ONLY topology，server 没起 AR stage，跑 trajectory 必失败或 silently fallback）。
- **解法**：保留 `--gebench-t2i-only`，按 PR scope 跑 DiT-only 单图，调步数解决质量问题
- **对未来的提醒**：
  1. 测一条 PR 之前先读它的**首个 commit message**——那里通常写明 PR scope 边界（"X out of scope until Y lands"），任何越界建议都是错的，哪怕看起来"更全面"
  2. PR 自带的 flag 命名往往**就是 PR 定位的快捷读法**：`--gebench-t2i-only` 字面就是"只测 T2I"——这不是限制，是 PR 边界。flag 名字像"only/skip/disable"开头时不要本能地想"我帮你打开它跑全套"
  3. PR scope 内的"测试覆盖不全"是**已知主动决策**（commit body 一般会写"defer to next PR"），不是 reviewer 该补的盲点
  4. 用户说"再跑一次看看"默认按**同 scope、改一个变量**重跑（这次：step 数 28→50），不要顺手把另一个变量也改了——一次只动一个
  5. 这条出现的二级错误：开始 grep DIT_ONLY 想"探查能不能强行跑 IT2I 拓扑"——已经在 PR-scope-out 路上又加挡。看到 commit message 写 scope 边界后**应该立刻停手回到 scope 内**，不是研究怎么破墙
