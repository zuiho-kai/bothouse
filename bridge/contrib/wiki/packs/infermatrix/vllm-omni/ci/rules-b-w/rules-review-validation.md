---
name: rules-review-validation
description: "CI 选择器与质量验证规则 VOMNI-CI-1a、VOMNI-CI-1b：Buildkite 选择器改动须以 base/head collection diff 闭合到实际收集集合，平台专有 golden/阈值须来自同一硬件 case（PR #5695、PR #5696、PR #5436）"
metadata:
  scope: 只收 review 时验证 CI 选择器改动和平台专有质量 oracle 的两条规则；质量阈值来源（DIFF-3a）归 diffusion 组件规则，硬件 lane 收集规则 OMNI-CI-1a 归 ci-rules-2
---
# CI 选择器与质量验证规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/rules-review-validation.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-09-22；updated: 2026-09-22
- 来源（sources）：PR #5695；PR #5696；PR #5436
- [VOMNI-CI-1a] 选择器改动必须闭合到实际收集的测试集合
  - 触发：新增、拆分、收窄或移动 Buildkite step，或修改 path、label、pytest `-m`、hardware marker、队列、卡数及非默认目标分支。
  - 强制：冻结 PR 的真实 target base；分别在 base/head 收集测试，并把 `path/label → pytest selector → test marker → hardware/queue/card count` 逐项对齐；每个被移除的平台或测试都必须有明确归类。
  - 验收：保存 base/head 的 collection diff，head 中每个选中测试都能到达匹配的 runner，每个掉测都有 `moved`、`intentionally removed` 或 `still covered elsewhere` 结论，并用实际 target branch 跑一次选择器 smoke。 ^[PR #5695] ^[PR #5696]
- [VOMNI-CI-1b] 平台专有质量 oracle 必须来自同一硬件 case
  - 触发：按 CUDA/ROCm/NPU 或具体硬件选择 golden、评分器、阈值或质量 job。
  - 强制：golden provenance、测试输入、模型 revision、执行参数、marker、队列和实际硬件属于同一个 case；平台分支必须显式选择 oracle，未命中的平台保持原合同。
  - 验收：目标 CI runner 产出的 artifact 可复现提交 golden 的 digest 和评分，目标平台命中专属 oracle，至少一个未改平台 control 仍选择原 oracle；阈值证据同时满足 [[diffusion-rules-3]]（DIFF-3a；源锚点 #diff-3a-质量阈值必须由完全相同的测试-case-产生）。^[PR #5436]

## 决策与踩坑

- [VOMNI-CI-1a] 禁止：从文件名推断收集集合；在 `main` 上验证一个目标为 release/challenge 分支的 diff；把未解释的掉测、平台移除或 label 变化当作纯 CI 重排。
- [VOMNI-CI-1b] 禁止：用另一硬件的本地输出生成 golden；用无法解释的阈值放宽吸收平台漂移；修改一个平台时顺带改变其他平台的 baseline。
