---
name: rules-encoder-graphs
description: "MiniCPM-o 4.5 输入 encoder CUDA graph 合同：MCPMO-ENCODER-1a exact-shape SigLIP/Whisper 图的 packed batch 与输出所有权（PR #8332）、1b 接纳预算与 capture 失败、1c streaming audio 独立 startup graph、1d 增量 fbank 精确 parity、1e duplex candidate sampling 逐行 RNG、1f packed vision lazy manager（PR #8430）"
metadata:
  scope: 只收 MCPMO-ENCODER-1a 至 1f；Code2Wav 的 resident 与 continuation 图归 rules-resident-graphs，HiFT 与 CFM graph 归 rules-cuda-graphs
---
# MiniCPM-o 4.5 输入 encoder CUDA graph 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-encoder-graphs.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-09
- 来源（sources）：PR #8332；vllm_omni/model_executor/models/minicpmo_4_5/encoder_cuda_graph.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_llm.py；PR #8430
- 置信度（confidence）：high
- [MCPMO-ENCODER-1a] exact-shape 输入图必须保留 packed batch、mask 与输出所有权
  - 触发：修改 `encoder_cuda_graph.py` 中 MiniCPM-o SigLIP 或 stateless Whisper/APM 的 exact-shape CUDA graph adapter。
  - 强制：通过 upstream `SupportsEncoderCudaGraph` / `EncoderCudaGraphManager` 执行已完成 packing 的完整本地 batch，把它作为一个不可拆的 manager item；只 copy runner configuration，不改原配置或再做 manager-level DP。key 包含 CUDA stream 与所有输入的 shape/dtype/device；每次 replay 更新静态输入与 mask，返回输出 clone。
  - 强制：vision 只捕获 transformer stack；position/mask 的 host decisions 留在外面。audio 只捕获 stateless encoder、projection 与 pooling。CPU、training、grad/autocast、nested capture、padded FlashAttention vision、FP16 Whisper overflow guard、请求 intermediate audio layer 保持 eager；
    - stateful streaming audio 不进入本 stateless adapter，专用路径见 MCPMO-ENCODER-1c；`enforce_eager` 优先禁用。
  - 验收：变更同 shape 的内容/mask并保留前次 embedding，检查当前结果与历史值；比较 vision/audio eager parity，覆盖各 eager 资格与多 stream buffer 隔离。CUDA 图的实际 capture/replay 由 CUDA 测试验证，CPU eager 测试只证明自身分支。^[PR #8332]
- [MCPMO-ENCODER-1b] 输入图接纳预算与 capture 失败必须分别处理
  - 触发：修改 `encoder_cuda_graph.py` stateless input encoder graph 的 admission、pool sharing、显存门限或失败恢复。
  - 强制：默认同 shape/stream 第二次调用才 capture，每 encoder 最多 4 图，admission history 也有界；`max_graphs=0` 禁用，不 eviction/自动重捕。默认 1 GiB free-memory floor 只阻止新 capture，低于 floor 时已存在图继续 replay。门限不是显存预留或 fit 保证。
  - 强制：同 encoder/device/replay stream 的 graphs 可共享 pool/capture stream；新 capture 等待旧 replay 及输出 clone 完成，随后 replay stream 等待 capture stream。不同 encoder 与 replay stream 隔离 mutable buffers；共享 pool 上的 graphs 不得并发。
  - 强制：capture 异常原样传播并把该实例置为 terminal failed；后续调用拒绝继续 CUDA eager 或 retry capture，需重启 worker，可显式禁用 encoder graphs 后恢复。
  - 验收：一次性 shape 不耗尽 capture slots；容量满、配置零与显存 floor 各自计数；低显存仍重放旧图；注入 capture failure 后第二次调用不再 capture/eager；晚 capture 后任意顺序重放仍保留前次输出与 stream/encoder 隔离。性能证据需绑定最终 admission policy、exact head 与 workload，不能直接沿用较早 head 的数值。^[PR #8332]
- Code2Wav 的 resident attention 与 stateful continuation 图见 [[rules-resident-graphs]]（Whole-Euler 合同）。
- [MCPMO-ENCODER-1c] streaming audio 使用独立 startup graph 与逐行 KV
  - 触发：修改 MiniCPM-o streaming_audio_encoder_graph.py、duplex build_audio_cuda_graph 或 mel/KV replay。
  - 强制：权重加载后由 build_audio_cuda_graph 探测真实 steady unit，再调用独立 StreamingAudioGraphEncoder 预捕 batch/cache buckets；它直接使用 torch.cuda.CUDAGraph。首次/非 steady unit、超出 cache bucket、未启用或不合资格走原 eager；startup capture 失败不安装 wrapper，保持 eager。replay 按每行 past offset 更新 mask、position 与 KV，输出 clone 后逐行 commit cache；
    - pinned H2D 按实际开关启用。
  - 验收：比较跨块、不同 past、reset/overflow、非 steady 与部分 batch 的 eager parity及 retained output，验证 startup idempotence/失败不安装 wrapper；真实 CUDA capture/replay 单独报告。 ^[PR #8430]
- [MCPMO-ENCODER-1d] 增量 fbank 必须重算窗口边缘并保持 exact parity
  - 触发：修改 IncrementalFbank、流式窗口裁剪或 frame cache。
  - 强制：缓存可复用的内部帧，按 upstream extractor 重算右边缘，滑窗后同时重算新左边缘；每块输出与完整窗口提取逐位相同。
  - 验收：使用真实 StreamingMelProcessorExact oracle，随机 chunk 跨至少两次窗口滑动，torch.equal 比较增量结果与完整提取；缺模型缓存时明确 skip。 ^[PR #8430]
- [MCPMO-ENCODER-1e] duplex candidate sampling 保留逐行 RNG 且不读取 device scalar
  - 触发：修改 native duplex batched candidate selection、deferred sampling 或 fused residual LayerNorm。
  - 强制：候选采样在 GPU 上执行，逐行保持 token 和 generator state 与逐请求 reference 一致；deferred 模式保留相同 RNG 消耗。fused residual 与 LayerNorm 分别对独立 oracle 验数值。
  - 验收：覆盖多行、ties 分布、deferred/non-deferred 对照和禁止 host reads 的 dispatch guard；CPU 与实际可用 CUDA 分别报告覆盖。 ^[PR #8430]
- [MCPMO-ENCODER-1f] packed vision 使用 lazy manager、独立 bucket 与 eager failure
  - 触发：修改 vision_fused.py 的 VisionGraphEncoder、_PackedVisionAdapter 或 manager cache。
  - 强制：packed SigLIP+resampler 仅同 grid chunk 进入 _PackedVisionAdapter/EncoderCudaGraphManager，key 为 height/width/batch bucket；pixel 尾部补零并把输出裁回实际 count，adapter clone 输出。当前同 key 第三次 encode 才 capture；最多 16 managers，LRU eviction 时 clear。capture 中、超 bucket 或 capture 失败返回未接纳，让 caller eager；
    - 失败 key 记录后不重复 capture。
  - 验收：覆盖新内容/不同 grid/count、padding 清零、第三次调用 admission、LRU clear、failed-key eager 与输出所有权；真实 CUDA 数值和 memory lifetime 另验证。 ^[PR #8430]

## 决策与踩坑

- [MCPMO-ENCODER-1a] 禁止：用 padding 扩大 exact-shape 接纳范围；把下一次 replay 可覆盖的输出 buffer 直接保留为历史 embedding；将 Code2Wav continuation cache 当作 stateless input。
- [MCPMO-ENCODER-1b] 禁止：把 warmup/capacity/memory miss 与可能污染 CUDA context 的 capture 异常合并为普通 eager fallback；把共享 pool 当成允许并行 replay 的保证。
- [MCPMO-ENCODER-1c] 禁止：把此有状态 wrapper 当作 stateless EncoderCudaGraphManager adapter，或复用 stateless adapter 的 terminal-failure policy；假定 pin_memory 已消除所有 runtime host allocation。
- [MCPMO-ENCODER-1d] 禁止：只对未滑窗的短样本比较；缺 upstream processor 时用自制近似 oracle 宣称等价。
- [MCPMO-ENCODER-1e] 禁止：在采样热路径通过 item/float/bool 同步 device scalar；用 shape smoke 代替 ties、RNG state 和数值比较。
- [MCPMO-ENCODER-1f] 禁止：把此 padding/bucket/LRU 策略与 encoder_cuda_graph.py 的 exact-shape/无 eviction adapter 混用，或把 vision capture failure 改说成整个 worker terminal failure。
