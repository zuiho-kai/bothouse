---
name: indextts-2-5-rules
description: "IndexTTS 2.5 规则 ITTS25-1a 至 ITTS25-1d：native bundle / config 与两 stage topology fail fast（placeholder span 精确相等、禁止 chunked prefill）、frontend / voice / emotion / speed 单一请求语义（speed [0.5,2.0]，duration_factor=1/speed）、性能与质量证据边界、S2Mel batching 的逐请求长度 / seed / FP32 Euler 数值策略（PR #5957）"
metadata:
  scope: 只收 ITTS25-1a 至 ITTS25-1d 的触发、强制、禁止与验收；两 stage 数据流与 conditioning 分界归 indextts-2-5-architecture，request-end device buffer 的共享生命周期由 rules-bridge-batch-1 的 EXEC-1g 定义，不在此页
---
# IndexTTS 2.5 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/indextts-2-5/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-09-02；updated: 2026-09-04
- 来源（sources）：PR #5957；vllm_omni/deploy/indextts2_5.yaml；vllm_omni/model_executor/models/indextts2/；vllm_omni/model_executor/stage_input_processors/indextts2.py；vllm_omni/entrypoints/openai/tts_adapters/indextts2.py；tests/model_executor/models/indextts2/
  - tests/entrypoints/openai_api/test_tts_adapter.py；tests/entrypoints/openai_api/test_serving_speech.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| bundle/topology、frontend/voice、证据边界或 S2Mel batching | `ITTS25-1a`–`ITTS25-1d` |

### [ITTS25-1a] native bundle/config 与两 stage topology 必须 fail fast

- 触发：修改 registry、pipeline、deploy、bundle discovery、tokenizer-free init 或 latent policy。
- 强制：缺 HF `config.json` 的 synthetic config 只允许本地 `indextts2_5` bundle，且 bundle 内 tokenizer、codec、S2Mel/vocoder assets 完整；Stage 0 使用 token-only renderer/TRITON attention，Stage 1 消费完整 request-end payload。默认 code-only，不得静默启用无官方 reference 的 GPT-latent variant。
- 验收：registry/config/deploy 双向一致；缺失/错误 bundle、policy、shape 明确失败；code-only 从 completed output token IDs 构造 mel codes，latent 模式要求同长非空 tensor；seed/conditioning 保留到 Stage 1。
  - placeholder span 必须与 embedding 精确相等，不得 pad/truncate：2.5 为 3 个 conditioning prefix + 与 Talker 共用 lang/normalization/tokenizer/wrapper 过滤的输出（含 start/stop）+ 1 个 `start_mel`；2.x 旧路径为 34 个 prefix。该精确合同下禁止 chunked prefill。

### [ITTS25-1b] frontend、voice、emotion 与 speed 必须只有一份请求语义

- 触发：修改 tokenizer/text normalization、language、conditioning cache、voice/emotion 或 `speed`。
- 强制：官方语言为 zh/en/ja/es/ar，`zhen` 只是混合中英 frontend mode；cache salt 包含 text、voice、emotion、lang 与 normalization。HTTP native speed 范围 `[0.5,2.0]`，adapter 写 `duration_factor=1/speed`，audio encoder 保持 1.0，避免二次 resample；model/S2Mel 用共享 bounds 做 direct-library final guard。
  - 发音标记 `<word|pronunciation>` 与标点清理顺序属于 tokenizer ABI；必需的 WeText/日语 frontend 依赖缺失时必须给出可操作的 optional-extra 错误，不得静默降级为未规范化文本。只有明确允许的 optional Spanish normalizer 可 raw fallback。
- 验收：raw/SSE/non-streaming duration 一致且越界 400 后 engine 健康；WebSocket 仍显式要求 speed=1；language/normalization 冲突改变 cache key，而 speed 不进入 conditioning salt；三种 emotion owner 与 uploaded voice 都覆盖。
- request-end device buffer 的共享生命周期只由 [[rules-bridge-batch-1]]（EXEC-1g；源锚点 #exec-1g-request-end-payload-延迟-d2h-必须先取得-device-snapshot） 定义，本 owner 只声明 IndexTTS 2.5 是显式 request-end consumer。

### [ITTS25-1c] 性能与质量证据必须保留可复核边界

- 触发：引用 latency、VRAM、speed ratio、ASR、MPS/XPU 或 production-ready。
- 强制：结论只绑定 immutable bundle/source、标准两-stage deploy、固定请求/seed、真实 device identity（至少 capability/SM/HBM）、warmup/repeats、all-process memory、latency/RTF 与可复核 audio/quality artifact；设备 label 与 runtime 属性冲突时不得擅自选 SKU。
- 验收：没有可运行、同输入的 native 2.5 baseline 时明确标记 comparison unavailable；短期 profiler/ASR smoke 不能替代 native-vs-Omni、多语种质量、长期泄漏或 AMD 运行证据。^[PR #5957]

### [ITTS25-1d] S2Mel batching 保持逐请求长度、seed 与数值策略

- 触发：修改 S2Mel CFM grouping、WaveNet ragged path、CFG unpadding、noise seed、precision、compile/graph 或 vocoder 交付。
- 强制：保留每请求 code/ref 长度和 `duration_factor`，按 CFM 总长度稳定排序并在 `s2mel_cfm_batch_size` 内分组；低于 WaveNet `ragged_min_length` 的 row 必须 singleton。变长 attention 的 row-major unpad index 按“全部 conditional，再全部 unconditional”CFG 顺序复用，WaveNet 在每个 logical boundary 重建 right reflection；最后恢复原请求顺序、逐条 crop mel，再单独调 BigVGAN。
- 强制：seeded noise 按请求拥有且不受 batch/reorder 影响；全部 unseeded 时保留全局 RNG 语义。CFM Euler state 始终 FP32，只有 estimator Linear/Conv1d 路径可 BF16。
- 验收：mixed-length/mixed-seed 的 batched 输出与逐条结果对齐；覆盖 singleton 门、CFG index 顺序、边界 reflection、原顺序/crop、全-unseeded RNG 和 eager/compile 数值容差。标准 deploy 使用 25 steps、CFG 0.7、CFM batch 4、DiT compile on/graph off。^[PR #5957]

## 决策与踩坑

- [ITTS25-1a] 禁止：把 model-scoped missing-config fallback 扩展给其他 loader error；用 public asset 替代缺文件；对 mel/latent 长度取 min 静默截断，或把 CFM 拆成 async chunks。
- [ITTS25-1b] 禁止：无 reference/named voice 时合成；把 `zhen` 当独立模型语言或把 recipe 中 `yue` 示例当官方支持；HTTP native speed 后再次编码变速；声称 WebSocket 已有 adapter-aware speed parity。
- [ITTS25-1c] 禁止：把约 59.8 GiB configured footprint说成 weight requirement；从十次无增长推出长期无泄漏；把 Whisper 单句匹配当通用多语种/voice quality，或声称有 authoritative native 2.5 baseline。
- [ITTS25-1d] 禁止：用 batch max 污染短样本、在 reorder 后交换 seed、对已给 seed 退回全局 RNG，或同时开 DiT compile 和 CUDA graph；graph 只能用于 full-mask shape。
