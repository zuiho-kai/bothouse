---
name: rules-request-batch
description: "Diffusion 规则 DIFF-6b：pipeline 显式声明 supports_request_batch=True 才可融合 DiffusionRequestBatch，generator/seed 与 latents 逐请求 collate，输出经 split_diffusion_output_by_request 按 num_outputs_per_prompt 拆成 list（PR #7033，SDXL opt-in）"
metadata:
  scope: 只收 pipeline 侧 request batch opt-in、逐请求随机性与结果拆分这一条规则；provided 标志进入 RequestBatchSamplingParamsKey（DIFF-2ad）与 batch compatibility identity（DIFF-2j）归 rules-component-lifecycle
---
# Diffusion request batch 的 pipeline 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-request-batch.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7033
- 置信度（confidence）：high
- [DIFF-6b] request batch 显式 opt-in、逐请求随机性与结果拆分
  - 触发：修改 pipeline supports_request_batch 或将旧单请求 forward 迁入 DiffusionRequestBatch。
  - 强制：pipeline 显式声明 supports_request_batch=True；只有 RequestBatchSamplingParamsKey 保证相同的字段才从 sampling_params_list[0] 读取。generator/seed 与 latents 用 request collators 逐请求组合，输出通过 split_diffusion_output_by_request 按 num_outputs_per_prompt 返回 list，单请求亦同。
  - 验收：不同 seed/latents 的两请求对照各自 oracle，检查 shared-field compatibility gate、每请求多输出顺序、单请求 list 与 output metadata；真实 SDXL 质量另验证。 ^[PR #7033]

## 决策与踩坑

- [DIFF-6b] 禁止：把第一请求 generator/latents 广播到整批；把 batch 维直接交给上层而不按请求拆分，或从 SDXL opt-in 推断所有 pipeline 支持融合。
