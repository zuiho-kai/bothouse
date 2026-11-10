---
name: rules-attention-1
description: Diffusion attention 规则（1/3）DIFF-1ad、DIFF-1ac、DIFF-1f、DIFF-1g：CUDA backend 显式承诺与 auto 回退（Blackwell FA4、cuDNN、FlashInfer、TRTLLM）、FastH3 VSA 的 H3 packed document/tile/SP 合同、--fa-deterministic 只对 local dense FA 生效、NPU packed mask-free 的 model opt-in 与 backend fallback（npu_attn_varlen、Laser input_scale）
metadata:
  scope: 只收 DIFF-1ad、DIFF-1ac、DIFF-1f、DIFF-1g；TRTLLM packed-padding、RainFusion、SP mask 与 masked varlen（DIFF-1m、1h、1k、4v、1n）归 rules-attention-2，DIFF-1z 及其后归 rules-attention-3，execution-path capability 归 rules-attention-contracts
---
# Diffusion attention 规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules-attention.md` 的第 1/3 部分；第 2 部分 [[rules-attention-2]]；第 3 部分 [[rules-attention-3]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-attention.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-09-22
- 来源（sources）：PR #5543；PR #5866；PR #5887；PR #5891；PR #5897；PR #5997；PR #6000；PR #6037；PR #6518；PR #6563；PR #6724；PR #6909；docs/design/feature/skip_softmax.md；docs/user_guide/diffusion/attention_backends.md；docs/user_guide/diffusion/attention_backends/trtllm.md
  - docs/user_guide/diffusion/attention_backends/fastvideo_vsa.md；docs/user_guide/diffusion/attention_backends/rainfusion.md；vllm_omni/config/omni_config.py；vllm_omni/config/stage_config.py；vllm_omni/diffusion/attention/backends/abstract.py
  - vllm_omni/diffusion/attention/backends/fastvideo_vsa.py；vllm_omni/diffusion/attention/backends/flash_attn.py；vllm_omni/diffusion/attention/backends/rainfusion_attn.py；vllm_omni/diffusion/attention/parallel/ulysses.py；vllm_omni/diffusion/diffusion_kv/paged_attention_adapter.py
  - vllm_omni/diffusion/models/minimax_h3/denoise_loop.py；vllm_omni/diffusion/models/minimax_h3/packed_sequence.py；vllm_omni/diffusion/data.py；vllm_omni/engine/arg_utils.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/entrypoints/cli/serve.py；vllm_omni/platforms/cuda/platform.py
  - vllm_omni/platforms/npu/platform.py；tests/config/test_omni_config.py；tests/diffusion/attention/test_fastvideo_vsa.py；tests/diffusion/attention/test_flash_attn.py；tests/diffusion/attention/test_attention_config.py；tests/diffusion/attention/test_piecewise_attn.py
  - tests/diffusion/attention/test_rainfusion_plan.py；tests/diffusion/attention/test_ulysses_uaa.py；tests/diffusion/diffusion_kv/test_paged_attention_adapter.py；tests/diffusion/models/minimax_h3/test_minimax_h3_packing.py；tests/diffusion/cache/test_teacache_extractors.py；PR #5500
  - vllm_omni/diffusion/models/ltx2/ltx2_transformer.py；PR #6070；vllm_omni/diffusion/attention/backends/cudnn_attn.py；PR #5614；PR #5194；vllm_omni/diffusion/models/hidream_o1_image/hidream_o1_image_transformer.py；vllm_omni/diffusion/models/hidream_o1_image/pipeline_hidream_o1_image.py
  - PR #6181；vllm_omni/diffusion/cache/teacache/extractors.py；vllm_omni/diffusion/models/longcat_image/pipeline_longcat_image.py；vllm_omni/diffusion/models/longcat_image/pipeline_longcat_image_edit.py；PR #5717；PR #6871；PR #7185；PR #7324；PR #7047；PR #5691
- 置信度（confidence）：high
- [DIFF-1ad] CUDA backend 选择必须区分显式承诺与自动回退
  - 触发：修改 CUDA platform selector、`FLASH_ATTN`/`FLASHINFER_ATTN`/`CUDNN_ATTN`/TRTLLM、SP auto-pad 或 paged dispatch。
  - 强制：显式 backend 必须运行或以可操作错误失败，auto 才可回退。Blackwell 的 `FLASH_ATTN` 仅可用 `flash_attn.cute` FA4；显式缺 FA4 报错，auto 继续选择。cuDNN、FlashInfer、Sage、TRTLLM 都须按实际 head-size/所需 symbol 验证（SM10x TRTLLM probe 真正 API），不得以 import 代替能力。
  - 强制：mask/SP pad 按已解析的 per-role `AttentionSpec` 能力判断，FlashInfer CuTe 不接受 custom mask；未知 `head_size=-1` 的 capability query 不得触发大小校验。formal paged 走 native backend，profiling 才可 dense/SDPA fallback。
  - 验收：覆盖 Blackwell FA4 缺失与可用、显式失败/auto fallback、CuTe mask、per-role SP pad、未知 head sentinel、真实 wrapper/TRTLLM symbol 及无 FA4 的 paged path。^[PR #5543]
- [DIFF-1ac] FastH3 VSA 必须保留 H3 packed document、tile 和 SP 合同
  - 触发：修改 `FASTVIDEO_VSA` 的 MiniMax-H3 route、`vsa_h3_prefix_segments`/`VideoTokenLayout`、FastVideo 64-token kernel、compression gate，或 Ulysses attention all-to-all。
  - 强制：H3 metadata 表示一个 packed `[text | condition | audio | video]` document；prefix segment RLE 的 sum 必须等于 target-video start，video grid 必须完整覆盖 query rows。prefix 以不跨 modality 边界的 64-token tiles 切分，target video 以 `(4,4,4)` tiles 切分；
    - prefix query dense，video query 保留所有 prefix tiles 加 top-k video tiles。tile partition、non-pad index 与 untile 必须恢复原 row 顺序；native SM100a path 只为 even block-partner requirement 增加 transport-only partner，并在返回前移除。
  - 强制：compression gate 跟随 Q/K/V 的 Ulysses sequence-to-head all-to-all，使 local head shard 拥有完整 document；仅 local 或 pure Ulysses 可进入 H3 VSA，Ring 与 AllGather SP 必须在 admission 拒绝。H3 route 有意不走 generic `min_seq_len` 或 `disable_when_sp_active` fallback gates；不能把这些 knobs 当作 H3 sparse admission 的实际保护。
  - 验收：测试覆盖 segment-pure prefix、3-D video tiling、prefix-dense/top-k map、odd partner、gate blending、packed-padding zero restore 和 pure-Ulysses gate resharing；真实 VSA 还须固定 checkpoint、kernel build、GPU、topology、request shape 与 top-k。
    - PR #6909 的 B300 Triton 与独立 B200 native SM100a observations 仅限所报 8×GPU、USP8/Ring1、four-step、1344×768/24 FPS、top-k 64 workload，不构成广泛性能或 support claim；两条路均依赖外部 `fastvideo-kernel`。
  - 证据缺口：multi-request layout error 会被 `fallback_on_error` 吞掉并运行 dense SDPA；尚无 continuous-batching proof。^[PR #6909]
- [DIFF-1f] deterministic flag 只对构造时选定的 local dense FA 生效
  - 触发：修改 `--fa-deterministic`、diffusion config projection 或 local `FLASH_ATTN` dispatch。
  - 强制：direct CLI 经 engine args/AsyncOmniEngine 传播到 `OmniDiffusionConfig`，attention impl 在构造时捕获；true 只在 dense unmasked `flash_attn_func` 传 `deterministic=True`，false 必须省略 kwarg 保留 library default。structured deploy 必须由 `_DiffusionConfigProjection` 显式拥有字段。
  - 验收：direct CLI 与 structured/deploy config 分别做 true/false 端到端传播；dense true/false 精确断言 kwarg，每条 non-dense path 断言不传且只警告一次，构造后改 config 不得被误认为立即生效。目标 pin 已将 `fa_deterministic` 加入 `_DiffusionConfigProjection`，因此 `from_kwargs` 不再过滤且派生 config/stage-engine field set 会分类该字段；
    - PR 引用/运行的既有 classification test 只断言字段分类集合与 projection dataclass 一致，没有以 non-default true 证明 structured/deploy→ `OmniDiffusionConfig`→backend 的值传播，也没有重跑 Qwen accuracy。^[PR #5887] ^[PR #5897]
- [DIFF-1g] NPU packed mask-free 是 model opt-in + backend fallback 双合同
  - 触发：修改 `supports_packed_mask_free`、NPU `FLASH_ATTN`、packed cu/max metadata、`npu_attn_varlen`、`laser_input_scale` 或 MindIE-SD backend selection。
  - 强制：base backend capability 默认 false；`FlashAttentionBackend` 只在 CUDA/NPU 报 true，XPU 仍读 mask。NPU 新分支还必须由每次 forward 的 `extra["npu_attn_varlen"]` 显式 opt in；未设置的 Wan/Cosmos 等 caller 保持原 masked `attention_forward`。quantized KV 在 `forward_npu` 更早转入 `forward_fa_quant_npu`，不消费这套 mask-free metadata。
    - 显式选择 NPU `FLASH_ATTN` 且 MindIE-SD 存在时，platform 必须在首次 custom-op registry snapshot 前 eager import 它。^[PR #5891]
  - 强制：默认 opt-in 路径用 MindIE-SD TND varlen，host list 传累计 end offsets；只有 env 精确等于 `ascend_laser_attention` 才改走 prefix K/V slice。resolver 只接受 non-causal、batch=1、四个 packed key 齐全、Q/K cu shape 相同且至多两 documents、Python-int max length 在 bounds 内，以及 `[real,pad]` 中 real 不短于 pad；无 padding 的单 document 也接受。
    - Q/K/V 从 BSND squeeze batch 不复制；Laser 保留 full Q、只裁 K/V，padding-row output 必须由下游忽略。
  - 强制：packed branch 拒绝 metadata 时，如果 caller 因 capability 没构造 mask，backend 必须用合法 `valid_kv_length` 重建 prefix mask；缺失、非 int 或越界立即报错，不能对 padding 做 unmasked attention。重建路径仍会扩展 quadratic `full_qk`，所以是 correctness fallback，不是 memory fast path。
    - Laser 可消费数值型 `input_scale>1`：Q/K/V 同除、softmax scale 乘平方、output 再乘回；absent/invalid scale 不缩放。模型只应给有硬件数值证据的 exact power-of-two factor。
  - 验收：CPU/mock 覆盖 resolver 接受/拒绝矩阵、env dispatch、default caller masked path、fallback mask/fail-closed、host lists、Laser layout/slice/scaling；真实 NPU 再与 masked FP32/BF16 reference 对照。target tests 覆盖前者但 mock kernel 不证明 MindIE 数值；NPU SDPA 的同类 `full_qk` churn 未改。
    - capability 是 classmethod，所有非 `AttentionBackend` duck-typed doubles/plugins 也须兼容；repo 内 TeaCache `FakeBackend` 已镜像 abstract default，显式返回 false 并恢复 masked-path extractor coverage。
    - 该修复只改 test double，没有给 production consumer 加 default-safe access，也没有证明 third-party registry override 或未继承 base class 的 backend 完成了 capability census；这些实现仍须继承合同或显式实现 method。^[PR #5891] ^[PR #5997]

## 决策与踩坑

- [DIFF-1ad] 禁止：显式 backend 在不兼容时静默替换为 MATH/SDPA/native；从相等维度猜 BHS/BSH layout，或把 import 成功、CPU contract test、早期 B300 smoke 外推为跨硬件功能、质量或性能支持。
- [DIFF-1ac] 禁止：让 prefix tile 跨 `[text|condition|audio]` boundary、把 video top-k 施加到 prefix keys、把 odd partner 留给输出 untile，或把 Ring/AllGather partial document 交给 block-sparse kernel。不得将 H3 route 的 CUDA error 之后的 dense fallback 描述为 sparse execution。
- [DIFF-1f] 禁止：把该 flag 描述成全 FlashAttention、跨平台或运行时动态 toggle。piecewise、packed-varlen、masked-varlen、dense-varlen fallback 以及 XPU/NPU path 不消费 kwarg，启用时只能 warning once。
- [DIFF-1g] 禁止：把任意 `MINDIE_SD_FA_TYPE` 当作 honored selection；target 对除 exact Laser string 外的合法值、typo 和垃圾值都静默走 TND varlen。不得从 capability=true 推断任意 packed layout安全：resolver 只检查 cu tensor shape、不读其 offset values，真实 producer 必须另证 `[0,used,total]` 内容。
