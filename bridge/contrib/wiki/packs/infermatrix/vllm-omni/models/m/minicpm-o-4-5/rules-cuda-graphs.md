---
name: rules-cuda-graphs
description: "MiniCPM-o 4.5 Code2Wav CUDA graph 规则：MCPMO-1d HiFT graph 只捕获 pre-iSTFT 子图并限界 shape cache（PR #5869、PR #8443）、MCPMO-1e legacy step-level CFM DiT graph 按 shape 整代退休（PR #6082、PR #6587）、MCPMO-1k 显式 CFM 帧桶时 padding 不得进入有效输出与 cache（PR #7416、PR #8007）"
metadata:
  scope: 只收 MCPMO-1d/1e/1k；Whole-Euler 与 resident slot 归 rules-resident-graphs，输入 encoder graph 归 rules-encoder-graphs，NPUGraph 归 rules-code2wav-runtime
---
# MiniCPM-o 4.5 Code2Wav CUDA graph 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-cuda-graphs.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/models/minicpmo_4_5/batched_token2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/cuda_graph_wrapper.py；tests/model_executor/models/minicpmo_4_5/test_cfm_graph_capture_gating.py
  - tests/model_executor/models/minicpmo_4_5/test_cuda_graph_wrapper.py；PR #5869；PR #6082；PR #6587；PR #7416；PR #8007；PR #8443；PR #8222
- 置信度（confidence）：high
- [MCPMO-1d] HiFT graph 只捕获稳定 pre-iSTFT 子图并限界 shape cache
  - 触发：`enable_hift_graph`、capture batch/chunk 配置、HiFT inference 分段或 streaming cache shape。
  - 强制：只在 parameter device 为 CUDA 时启用；非 CUDA 回 eager。capture bucket 由 codec chunk、left context、Flow lookahead、token→mel ratio 与 mel/source cache 推导；新版在首个 forward 的预捕阶段准备 uncached/cached、initial 和配置的 exact shape；
    - 只有合法 capture buckets 的缺失 graph 可 lazy capture（默认上限 8），未知 final shape、超限或无法容纳 batch 时回 eager。active stream capture 中禁止嵌套 capture/replay并回 eager；静态输入先清零再复制真实 batch，输出 slice 后 clone。
  - 强制：graph 只覆盖 `_inference_pre_istft`；ISTFT 与 waveform clamp 留在 graph 外的 `_finalize_decode`；MiniCPM 显式 cached ISTFT 的首 shape 仍检查 NOLA，后续复用合同见 MCPMO-MRV2-1d。HiFT window/harmonic IDs 必须是随 module device 移动的 non-persistent buffers。开关独立于 stage `enforce_eager`；四份 bundled MiniCPM-o deploy 默认开启。
  - 验收：CUDA test 比较 cached/uncached graph 与 eager，CPU/mock 覆盖 lazy capture/limit fallback，deploy test 固定默认开关；另测非 CUDA disable、invalid config、unsupported batch、nested capture 和 variable final chunk。static input/output 与 lazy graph map 为无锁可变状态；并发 replay/capture 需先证明被上层串行化或增加互斥与重叠调用测试。
    - PR 的单 A800 profile 约 30→5 ms/chunk、250→43 ms/request，只绑定部分 graph、单 prompt/commit `8fa28d88`，无 repeats/端到端质量，不能泛化为稳定 speedup。^[PR #5869] ^[PR #8443] ^[PR #8222]
- [MCPMO-1e] legacy step-level CFM DiT Graph 必须按 shape 整代退休并保持 eager parity
  - 触发：修改 MiniCPM-o 4.5 Code2Wav legacy step-level CFM DiT estimator 的 `blocks_forward_chunk` graph target、按 shape 捕获/重放、cache retirement 或 eager fallback；Whole-Euler 的完整 solver capture 另见 MCPMO-GRAPH-1a/1b。
  - 强制：仅在 CUDA 且显式启用时捕获 `estimator.blocks_forward_chunk`；`t_embedder`、`torch.cat`、`expand`、buffer 准备和 10-step Euler loop 保持 eager。graph key 必须包含所有输入的 shape、dtype 和 device；`cnn_cache=None` 与 `att_cache=None` 转为 graph 可接受的零值时，必须保持与 eager `[None] * depth` 的首 chunk 数值语义，重放结果和 cache 输出需 clone。
  - 强制：`cfm_max_graphs` 是一代的有界容量。满载遇到新 shape 时，先同步，再只对本 wrapper 拥有的全部 `CUDAGraph` 调用 `reset()` 并清空 cache，随后捕获新一代的首图；绝不可逐 entry/LRU eviction。不得进行 process-wide cuBLAS workspace 清理或 `empty_cache()`：HiFT 等共享 global graph pool 的存活图不属于 CFM 的退休范围。`max_graphs <= 0` 必须禁用捕获并 eager。
  - 强制：warmup 或 capture 发生异常时，在该 wrapper 的剩余生命周期内保持禁用并退休其自有 generation；不能在可能脏的 capture stream/allocator 状态继续捕获。无法由 key 重建的 dtype 仅标记该 shape eager，不得禁用其他可捕获 shape；capture admission 不得依赖 device free-memory。维护固定字段的 calls/hits/captures/flushes/eager 累计 telemetry。
  - 验收：CUDA 测试覆盖 uncached/cached shape 的 graph/eager 数值 parity、`None` cache parity、lazy capture、整代 flush 后 HiFT replay parity、capture/warmup failure 后不再 capture、unsupported dtype shape-local eager 与 `max_graphs <= 0` eager；
    - CPU/mock 覆盖 active capture/non-CUDA、free-memory 非 gating、telemetry 和 inert non-CUDA memory reporting，并确认 deploy 配置值实际到达 estimator。^[PR #6082] ^[PR #6587]
- [MCPMO-1k] 显式启用 CFM 帧桶时，padding 不得进入有效输出与 cache
  - 触发：修改 MiniCPM-o 4.5 Code2Wav 的 CFM decode chunk、`cfm_graph_bucket_frames`、reference-audio 长度，或 attention/CNN cache 边界。
  - 强制：显式开启 `cfm_graph_bucket_frames > 1` 且 graph 路径适用时，把 mel 帧 pad 到桶的倍数，输出裁回有效帧；profile 的 bucket 设置要与实际 graph 路径核对。Whole-Euler 部署允许默认 0、不做旧版 frame padding；不得继续要求所有 CFM profile 固定为 16。`bucket_frames <= 1`、graphs 已禁用、ragged valid-lengths，或 pad 会越过 decoder noise capacity 时不 pad。
  - 强制：padded 列必须被真实 `attn_mask` 排除；零 key 仍会计入 softmax 分母。成为下一 chunk 的 key 或左上下文之前，清零 attention cache 的 padded 列，以及各 block CNN cache 中来自 padding 的尾部。speaker 向量会铺满每一帧，清零必须作用在 clone 上。conditioning pad 复制最后一帧有效值。
    - reference audio 先转 mono、抗混叠重采样到 24 kHz，再按 `ref_audio_max_seconds`（默认 6s）截断或补零，使各请求共享一个 L0；默认 prompt 走同一路径，`soundfile` 的 `(samples, channels)` 先转置。
  - 验收：覆盖 pad/trim、noise overflow 不 pad、attn_mask 与 cache 清零、reference 归一化后的单一 L0，以及 shipping profile 的真实 bucket 设置；Whole-Euler 另检查同 query bucket 中不同有效长度的 recurrent parity。^[PR #7416] ^[PR #8007]
- Whole-Euler、resident slot 的总预算及新版 exact HiFT/flow-encoder 预捕见 [[rules-resident-graphs]]（resident graph 合同）；输入 encoder 的资格与 terminal failure 见 [[rules-encoder-graphs]]（encoder graph 合同）。

## 决策与踩坑

- [MCPMO-1d] 禁止：无 connector 配置、非正 chunk、负 left context、source/mel cache 不整除时静默 capture；不核对新版 exact initial/continuation 配置就将 `initial_codec_chunk_frames` 当已预捕（旧版仅 lazy capture，新版预捕合同见 MCPMO-GRAPH-1e）；把 lazy graph limit 说成总显存上界，因为启动 graphs、global pool、static tensors 与其他 graph owners 仍驻留。
  - active-capture 分支虽绕过 nested replay，却调用完整 eager decode（native ISTFT 或 cached envelope 首次 miss 仍可能 NOLA sync）；未做真实 outer-graph 测试前，不能把日志中的 “fallback” 当成可捕获保证。custom `capture_batch_sizes` 也尚未校验正数/去重。
- [MCPMO-1e] 禁止：捕获整个 `_estimator_step` 或手写替代 graph target；使用无界 shape cache、逐图 eviction、跨 owner 的 process-wide cleanup，或在 nested capture 中重放；捕获失败后伪装成功；把 CFM graph 的配置、性能或 parity 结论外推到 HiFT、encoder、TRT 或其他模型。
- [MCPMO-1k] 禁止：在已选择 frame bucketing 的路径中让任意有效长度另成 graph key；只清零 `x`/`mu`/`cond` 而留下非零 speaker 列；把桶化 parity 外推到 HiFT、TRT 或其他模型。
