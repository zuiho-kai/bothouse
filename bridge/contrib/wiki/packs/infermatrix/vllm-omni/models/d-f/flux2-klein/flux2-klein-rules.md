---
name: flux2-klein-rules
description: "FLUX.2-Klein 规则 FLUXK-1a：final-layout HWR 用版本化 flux2-klein-dit contract 恢复可立即使用的 BF16 transformer，constructor 先建六项 packed Q/K/V mapping，restore validator 的检查项与已测范围（4B、BF16、TP1/DP1/SP1 no-AllGather DLO，PR #6651）"
metadata:
  scope: 只收 FLUXK-1a 一条规则及其信号表；FLUX.2-Klein 的结构与 registry 归 flux2-klein-overview，FLUX.2 的 FP8 规则归 flux2-rules
---
# FLUX.2-Klein 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/flux2-klein/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：PR #6651；vllm_omni/diffusion/models/flux2_klein/flux2_klein_transformer.py；tests/diffusion/model_loader/test_final_layout_host_weights.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| final-layout HWR、packed weights 或 warm restore validation | `FLUXK-1a` |

- 只有 `FLUXK-数字字母` 是可审计规则 ID。共享 artifact、lease 和 DLO transport 约束见 [[rules-checkpoint-loading-2]]（Diffusion checkpoint rules；源锚点 #diff-2z-final-layout-hwr-只能接入-eligible-no-allgather-dlo） 与 [[host-weight-runtime-rules]]（Host Weight Runtime rules）。

### [FLUXK-1a] final-layout HWR 必须恢复可立即使用的 BF16 Klein transformer

- 触发：修改 `Flux2Transformer2DModel` 的 HWR contract、constructor state、packed weight loading、restore validation，或声称扩展 Klein 的 HWR scope。
- 强制：使用版本化 `flux2-klein-dit` final-layout contract；constructor 在任何普通 `load_weights()` 之前建立六项 packed Q/K/V mapping。restore validator 必须同时检查 double-stream 与 single-stream block stacks、核心模块、CPU materialization、连续 strided BF16 parameters，以及 persistent loader-owned `beta`/`eps` buffers；
  - warm restore 只接管 transformer，text encoder 与 VAE 继续 ordinary loading。
- 验收：reduced transformer 覆盖两类 block、six-map packed QKV、persistent buffers、publication → exact restore 的值和 storage-pointer equality，以及每种 invalid restore invariant 的拒绝；loader 覆盖 required miss 在 ordinary loading/publication 前失败。实际模型证据目前仅为 4B、BF16、default format、non-HSDP、TP1/DP1/SP1 no-AllGather DLO；
  - TP2/SP 与 9B 仍未测量，不能由同一 class 或 identity mechanics 外推。^[PR #6651]

## 决策与踩坑

- [FLUXK-1a] 禁止：依赖 `load_weights()` 重建 warm-hit 所需 mapping；接受 meta/non-CPU、非 BF16、非连续参数或 non-persistent `beta`/`eps`；把 FLUX.2-klein-9B、FLUX.2-dev、online FP8、HSDP、LoRA/adapted weights、non-default load format 或 AllGather 写成此验证过的 contract scope。
