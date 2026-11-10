---
name: sigma-schedules
description: "规则 DIFF-4j：distilled/DMD2 的 continuous sigma boundaries（base_schedule 从 (0,1] 严格递减到 0.0，区间数 len(boundaries)-1 为 step count）不得与 DMD2Config.denoising_timesteps 的 scheduler integer timesteps 混同；from_metadata() 的 absent/null/empty 语义，shifted_sigmas() 尚缺有限性验收（PR #5991）"
metadata:
  scope: 只收 DMD2SigmaSchedule 的 continuous sigma schedule 一条规则（DIFF-4j）；step 执行合同归 step-and-batching
---
# Diffusion distilled sigma schedule 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/sigma-schedules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion, scheduler；created: 2026-09-02；updated: 2026-09-05
- 来源（sources）：PR #5991；PR #6714；vllm_omni/diffusion/models/dmd2/config.py；vllm_omni/diffusion/models/dmd2/mixin.py；vllm_omni/diffusion/sched/sigma_schedule.py；tests/diffusion/sched/test_dmd2_sigma_schedule.py
- 置信度（confidence）：high
- [DIFF-4j] continuous sigma boundaries 不得与 scheduler integer timesteps 混同
  - 触发：新增 distilled/DMD2 checkpoint schedule metadata、变更 sigma shift 或把 `DMD2SigmaSchedule` 接入新 pipeline。
  - 强制：continuous `base_schedule` 至少两个有限数，严格从有限 `(0,1]` 首点递减到 0.0；先拒绝非有限值，再逐对验证相邻位置严格单调。区间数 `len(boundaries)-1` 才是 request/cache/denoise step count，solver 保留全 boundary list。
  - 强制：`from_metadata()` 的 absent key 与 explicit null 都因 `metadata.get()` 返回 `None` 而保留 legacy schedule；explicit empty list 是 malformed，不得静默 fallback。一个 base schedule 可独立应用多个 modality shift，但不等于 `DMD2Config.denoising_timesteps` 的 scheduler integer timesteps。
  - 验收：覆盖长度、端点、单调、NaN/inf positions、absent/null/empty metadata、interval count 及不同 shift 值。`shifted_sigmas()` 目标实现只在 float 转换前检 `shift_scale<=0`；NaN/+inf 可通过并产生非有限输出，尚缺有限性验收。^[PR #5991]

## 决策与踩坑

- [DIFF-4j] 禁止：把共享 utility 存在解读为 `DMD2PipelineMixin` 已接入。目标 pin 中 mixin 仍替换 `DMD2EulerScheduler`，未消费该 continuous schedule class；新接入者必须自行定义 schedule resolution 与 request sanitization 合同。
