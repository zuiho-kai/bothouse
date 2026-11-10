---
name: sana-video-rules
description: "SANA-Video 规则：SANA-1a native TP/CFG 只支持 {1,2} 矩阵与 TP2×CFG2 layout（PR #5861）、SANA-1b Cache-DiT 与 offload 仅单 rank 组合并拒绝 distributed layerwise（PR #5882）、SANA-1c Cache-DiT refresh 按 request 有效 step 数且回退 50"
metadata:
  scope: 只收 SANA-1a、1b、1c 及开头的 PR 描述信号表；名称、checkpoint 与流程概述归 sana-video-overview，模块边界与验证归 sana-video-architecture
---
# SANA-Video 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sana-video/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #5861；PR #5882；vllm_omni/diffusion/models/sana_video/pipeline_sana_video.py；vllm_omni/diffusion/models/sana_video/pipeline_sana_video_i2v.py；vllm_omni/diffusion/models/sana_video/transformer_sana_video.py；tests/diffusion/models/sana_video/
  - tests/diffusion/models/sana_video/test_cache_offload.py；tests/diffusion/test_diffusion_model_runner.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| TP/CFG topology | `SANA-1a` |
| Cache-DiT/offload 或 request refresh steps | `SANA-1b`、`SANA-1c` |

### [SANA-1a] native SANA Video 只支持 TP/CFG 的 {1,2} 矩阵

- 触发：native SANA Video TP/CFG、transformer layout、I2V 或 Diffusers adapter topology 变更。
- 强制：TP/CFG 各只 `{1,2}`，TP2×CFG2 valid；SP/text-encoder TP/PP/HSDP load 前 reject，Diffusers adapter reject native TP/CFG。TP 用 QKV column/output row、distributed RMSNorm global sumsq/local weights，GLUMB packed `[value;gate]` 每 segment slice 后 local chunk2/reduction。CFG1 batch neg/pos 后 slice；
  - CFG2 mixin branch gather/combine FP32。uninitialized group serial，initialized broken group errors propagate；I2V first frame/mask 不变。
- 验收：CPU topology/layout 与 tiny multiprocess TP/CFG matrix；A800 数字仅该环境观察。^[PR #5861]

### [SANA-1b] native SANA 的 Cache-DiT 与 offload 只在单 rank 路径组合

- 触发：native T2V/I2V 的 cache backend、CPU/layerwise offload、Transformer block metadata 或加载设备变更。
- 强制：两种 native pipeline 只接受 `none` 或 `cache_dit` backend；Cache-DiT、model CPU offload、layerwise CPU offload（含 distributed layerwise）任一启用时均要求 TP=CFG=SP=1，并在加载任何 checkpoint component 前 reject。`cache_dit` 与 distributed layerwise offload 必须 reject：per-rank cache skip 会使 weight AllGather 失步。
  - Transformer 以 `transformer_blocks` 的 ordinary layerwise block list 声明 Cache-DiT `ForwardPattern.Pattern_3`；loader 按 `torch.get_default_device()` 放置 component，runtime residency 由 offloader 而非 pipeline 强制 runtime device。若 cache skip 使正常 prefetch 未发生，下一 block 的 hook 自行 materialize；
  - disable/异常 cleanup 必须移除 hooks 与 cache/offload state。
- 验收：`test_cache_offload.py` CPU/mock 覆盖 adapter pattern、backend/parallel admission 在 component load 前失败、loader device、cache-skip 后 hook materialization 与 disable cleanup；tiny common harness 覆盖 Cache-DiT、两种 offload 及两个组合。
  - 作者报告单张 A800 的真实权重 T2V/I2V 480p/720p 19/19 matrix（distributed layerwise 仅单 rank）和 Cache-DiT/offload 指标；这些数值与 CPU/mock 不能外推到多 rank 或其他硬件。^[PR #5882]

### [SANA-1c] Cache-DiT refresh 使用 request 的有效 step 数

- 触发：native SANA sampling defaults、custom `timesteps`/`sigmas`，或 shared cache refresh 修改。
- 强制：每 request refresh 的优先级固定为显式 `num_inference_steps`、`len(timesteps)`、`len(sigmas)`、pipeline `default_num_inference_steps`；SANA T2V 与 I2V 的最后 fallback 都是 50。合并后的 shared source 有意保留显式 number 优先于 custom schedule 的顺序，不能把较早 review 讨论中的 schedule-first 建议误记为最终合同。
- 验收：`tests/diffusion/test_diffusion_model_runner.py` 覆盖 explicit、timesteps、sigmas 和 default 的 refresh chain；`test_cache_offload.py` 覆盖 native 50-step contract。^[PR #5882]

## 决策与踩坑

- [SANA-1a] native SANA Video 只支持 TP/CFG 的 {1,2} 矩阵
  - 禁止：TP>2/CFG>2；不得把本规则的 native TP/CFG `{1,2}` 矩阵外推为 cache/offload 的支持范围。
- [SANA-1b] 禁止：TeaCache 或其他 backend、Cache-DiT + distributed layerwise offload、以及任何 TP/CFG/SP>1 的 cache/offload 组合；不得把单 rank distributed-layerwise admission 当作多 rank 验证，也不得称 native T2V/I2V 的 TeaCache 或 step execution 已支持/验证。
- [SANA-1c] 禁止：在 request omit steps 时沿用上一个 request 的 cache state；不得把 50 当作 custom schedule 的长度，或声称 TeaCache/step execution 通过此 fallback 获得支持。
