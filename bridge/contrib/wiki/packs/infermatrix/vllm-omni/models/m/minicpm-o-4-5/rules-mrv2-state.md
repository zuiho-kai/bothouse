---
name: rules-mrv2-state
description: "MiniCPM-o 4.5 MRv2 turn 与输出状态合同：MCPMO-MRV2-1a turn Thinker 的 row ledger 来自 replay 后的 live batch、1b Talker device sampling 的 codec window 与 EOS、1c 共享 async/batched hooks 保护 V1 请求与输出所有权、1d cached ISTFT 的 shape 限定优化（PR #8222）"
metadata:
  scope: 只收 MCPMO-MRV2-1a 至 1d；native V1 duplex 归 rules-duplex-1 与 rules-duplex-2，Whole-Euler 归 rules-resident-graphs，输入 encoder 图归 rules-encoder-graphs
---
# MiniCPM-o 4.5 MRv2 turn 与输出状态合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-mrv2-state.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8222；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_tts.py；vllm_omni/worker_v2/omni_sampler.py
- 置信度（confidence）：high
- [MCPMO-MRV2-1a] MRv2 turn Thinker 的 row ledger 必须来自 replay 后的 live batch
  - 触发：MiniCPM MRv2 Thinker、FULL graph output、stage handoff 或 runner profile selection。
  - 强制：MRv2 Thinker 仅支持 turn，`async_chunk=false` 保留完整 llm2tts payload；native duplex Thinker/Talker 使用 V1 session runtime，显式拒绝 MRv2 duplex。MRv2 Thinker 保留 native multimodal encoder/cache，不声明会绕过它的 custom preprocess；仍保留真实 token IDs。
  - 强制：FULL graph forward 只返回 tensor；在 replay 后的 output adapter 从当前 `input_batch.input_ids/positions` 重建 latent row ledger，不能复用 warmup 的 Python metadata。profile 选择仍显式：generic turn MRv2 的 Thinker/Talker/codec 容量16/8/8，H200 turn profile16/16/8且 Talker KV4GiB；V1 default 不自动迁移成 V2。
  - 验收：两个不同 live batch 重放同图，核对 latent token/position identities；验证完整 handoff、native multimodal embeddings、profile capacities、duplex refusal 与 V1 selection。真实 turn、V1 duplex 和质量/性能分别绑定各自 exact head 与执行路径。^[PR #8222]
- [MCPMO-MRV2-1b] Talker device sampling 必须保留 codec window、EOS 与请求 slot
  - 触发：MiniCPM MRv2 sampler、codec history、EOS、length cap 或 `codes.audio` 输出。
  - 强制：经 `ModelState.custom_sampler` 注册 `OmniSampler` adapter，委托原 sampler 的 request state 与 staged writes，不修改 sampler 的 `__class__` 或另起 sampling hook。16-code frequency window 只取当前 request slot 在 prompt 之后的有效输出；保留 upstream min_tokens、temperature/top-k/top-p、seeded sampling 与频率/存在惩罚。
  - 强制：`codes.audio` 对应本步 decode 的输入 codec ID，而非本步刚采样的下一 ID；`meta.codec_frame_valid` 排除 prefill、EOS 与 empty/finished rows，bridge 在 CPU snapshot 后只取有效 rows。empty condition、已读 EOS 或有效 token limit 的 forced-EOS mask 只消费一次，作用在 sampling 结果，sampled/rejected counts 保留 upstream 合同。
  - 验收：窗口频率、prompt exclusion、非默认 sampling controls、slot reordering、empty、EOS、length cap、validity mask 与 counts；标准 sampling 不被重复执行。component parity 不等同完整波形或 speech-quality 等价。^[PR #8222]
- [MCPMO-MRV2-1c] 共享 async/batched hooks 必须同时保护 V1 请求与输出所有权
  - 触发：MiniCPM `use_async_omni_output`、batched Talker preprocess、pinned codec upload 或 model-owned CPU snapshot finalizer。
  - 强制：这些共享 hooks 也会影响默认 V1 turn/native duplex；V1 live one-token rows 先批量 embedding，codec ID 的 pinned host copy 在 Talker forward 前排队，按 request ID 与 row 保存；等对应 event 后才消费值。finished rows 保留 shape-correct zero/empty delta，request release 清理 pending IDs 与 audio state。
    - connector codec 输入上传也保留 pinned ownership。
  - 强制：graph output 在 copy stream 上获得 CPU-owned snapshot，D2H 完成后才执行 multimodal finalizer。已经按 request 分区的 `RequestOutputSnapshot` 不重复 generic partition，仍验证 inter-stage/client list 长度等于 batch；`OmniSamplingOutput` 的 payload、hidden-state 与 ownership flags 区分 `None`（保留）和空 dict（替换）。
  - 验收：默认 V1 scalar/batched 路径比较 embedding、logits、sampled IDs、delta、finished flags 和 request state；pinned async snapshot 与同步 CPU 数据比较并检查独立 storage。native V1 duplex 的 interruption/resume 与 whole-model音频质量另行验收。^[PR #8222]
- [MCPMO-MRV2-1d] cached ISTFT 必须是显式 shared API 的 shape 限定优化
  - 触发：MiniCPM Code2Wav 启用 shared HiFT cached ISTFT 或修改 overlap-envelope cache。
  - 强制：消费 HiFT 的 `enable_cached_istft()` API，不从外部写 private flag；shared HiFT 未 opt-in 时保持原 `torch.istft`。仅对三维 one-sided spectrum、一维 n_fft 长度 window 使用等价的 center/unnormalized/no-explicit-length 算法；其余走 native path。
  - 强制：overlap envelope 按 frame count、n_fft/hop、window device/dtype/storage identity 缓存；第一次 shape 仍检查 NOLA，后续同一不变 window 可复用。window 内容发生 mutation 时必须让旧 envelope 失效，`data_ptr()` 本身不是内容未变的保证。
  - 验收：未 opt-in 的 shared native control、目标 shape 的 cached/native waveform parity、首 shape NOLA 与复用后的 CUDA同步行为；TF32 正常/异常恢复另见 MCPMO-GRAPH-1d。^[PR #8222]
- Code2Wav 的后续 Whole-Euler/slots 演进见 [[rules-resident-graphs]]（resident graph 合同）；输入 encoder 的独立 stateless graph 合同见 [[rules-encoder-graphs]]（encoder graphs）。

## 决策与踩坑

- [MCPMO-MRV2-1a] 禁止：把 MRv2 turn 的功能 probe 外推为 duplex MRv2、interruption 或 speech-quality 验收；将已移除的 experimental Flow 路径的历史性能数字作为当前 mainline codec 收益。
- [MCPMO-MRV2-1b] 禁止：用全 prompt repetition penalty 替换 codec window；request compaction 后读错 slot history；输出 EOS/prefill 作为 audio code；在热路径逐行同步 sampled ID 到 host。
- [MCPMO-MRV2-1c] 禁止：只跑 MRv2 YAML 就宣布默认 V1 未改变；返回可被下次 replay 覆写的 output views；在 finalizer 重采样、错位分区或等本步 forward 时偷偷增加同步；保留已结束请求的 codec delta。
- [MCPMO-MRV2-1d] 禁止：把该有限 ISTFT 合同推广到其他 window/length/normalization；让模型 consumer 暗改共享 vocoder 默认；将单个 CUDA component 的 bitwise parity 外推为端到端质量。
