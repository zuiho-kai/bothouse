---
name: rules-cache-kernels
description: "MammothModa2 规则：MAMMO-TEACACHE-1a TeaCache residual 对应完整 joint transformer 输入与 positive/negative CFG branch 隔离（PR #5357）、MAMMO-QKROPE-1a fused QK norm/RoPE 只消费 adjacent-pair tables（PR #7969）"
metadata:
  scope: 只收 TeaCache 与 fused QK RoPE 两条规则；AR vocabulary 与 AR→DiT bridge 归 mammoth-moda2-rules，step 调度归 rules-step-runtime，image route 归 rules-image-serving
---
# MammothModa2 TeaCache 与 QK RoPE 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mammoth-moda2/rules-cache-kernels.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #5357；PR #7969
- 置信度（confidence）：high
- [MAMMO-TEACACHE-1a] cache residual 必须对应完整 joint transformer 输入和真实 CFG branch
  - 触发：修改 Mammoth TeaCache backend/extractor、DiT refiners、postprocess 或 conditional/unconditional 调用。
  - 强制：通过共享 hooks backend 将 TeaCache 安装到 `gen_transformer`，并保持 runtime 的 `transformer` alias 指向该 DiT。Extractor 复用模型 input validation、embedding preparation 与 refiners，再以各 row 的有效 text/image spans 构建 joint hidden states 和 mask；第一 transformer layer 的 norm1 modulation input 驱动 cache decision。
    - 复用 residual 后仍执行原 norm_out 和 image-span unpatchify。正/负 CFG 调用显式传 `teacache_branch=positive/negative`，hook 验证 branch 值并优先使用该 hint，不能依赖固定交替次数推断间歇性 uncond。
  - 验收：对照无 hook forward 核对 extractor 的 joint sequence、modulated input 和 postprocess；交错正负与跳过 uncond 的序列证明 branch 隔离，错误 branch 显式失败；backend 注册和 request/cache reset 必须走生产 runtime，质量仅按固定输入/seed/steps/threshold复核。^[PR #5357]
- [MAMMO-QKROPE-1a] fused QK norm/RoPE 只消费模型保证的 adjacent-pair tables
  - 触发：修改 Mammoth `AttnProcessor`、`_apply_qk_norm_rope`、rotary table packing 或 shared fused operator接入。
  - 强制：只有模型的 `RotaryPosEmbedReal` producer 保证相邻 lanes 重复时才 opt in fusion；检查 Q/K norm epsilon、batch/sequence/head width、CUDA kernel support 和 cos/sin shape/device/dtype。每 forward 为 context/noise/joint 三种 tables 各准备一次 packed FP32 table，由对应 layers 复用；
    - 显式 `None` 表示 support/token gate 已选择 eager，不能在每层再次选择。保留 Q/K 不同 head counts 的 GQA layout；embedding-only `_prepare_embeddings` 返回值保持原语义。
  - 验收：模型-produced repeated-pair 与普通 independent-lane tables 分别核对 fused/eager 和 fallback；覆盖 GQA、prepared-None、shape/device/dtype 错误与 token threshold，并断言每种 table 只准备一次。^[PR #7969]

## 决策与踩坑

- [MAMMO-TEACACHE-1a] 禁止：把 text/image refiner 或 VAE 输出作为 transformer residual缓存；让正负 branch 共用 residual；将 1024×1024、50-step full-compute traces 拟合的 coefficients 和默认 threshold 0.075 当成其他尺寸、schedule、task 的质量保证。
- [MAMMO-QKROPE-1a] 禁止：将通用独立 even/odd lanes 的四通道 RoPE 当成 adjacent-pair table；取消平台、dtype、geometry 或 token gate；将一次 RTX 4090 crossover 或 fused-kernel parity 外推为所有模型/平台速度和端到端质量保证。
