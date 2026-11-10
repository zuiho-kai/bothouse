---
name: voxtral-tts-rules
description: "Voxtral-TTS hot-path 规则：VOXTTS-1a variable-output full graph 与 inner acoustic graph 分层（supports_cudagraph_full=False）、VOXTTS-1b 合并 host sync 保留 device/empty 语义、VOXTTS-1c per-request CFG metadata 与 batch 严格对齐，以及 PR #5175 的性能证据边界"
metadata:
  scope: 只收 VOXTTS-1a、1b、1c、性能证据边界及开头的信号表；名称、registry 与 deploy 要点归 voxtral-tts-overview
---
# Voxtral-TTS hot-path 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/voxtral-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-09-02；updated: 2026-09-02
- 来源（sources）：PR #5175；vllm_omni/model_executor/models/voxtral_tts/cuda_graph_acoustic_transformer_wrapper.py；vllm_omni/model_executor/models/voxtral_tts/voxtral_tts.py；vllm_omni/model_executor/models/voxtral_tts/voxtral_tts_audio_generation.py
  - vllm_omni/model_executor/models/voxtral_tts/voxtral_tts_audio_tokenizer.py；tests/model_executor/models/voxtral_tts/test_cuda_graph_acoustic_transformer.py
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| graph layering、host sync 或 per-request CFG metadata | `VOXTTS-1a`–`VOXTTS-1c` |

- 只有 `VOXTTS-数字字母` 是可审计规则 ID。

### [VOXTTS-1a] variable-output full graph 与 inner acoustic graph 分层

- 触发：Voxtral stage-0 FlowMatching、stage-1 tokenizer decode、`supports_cudagraph_full`、inner capture/replay、`--enforce-eager` 或 batch bucket。
- 强制：stage-1 `audio_tokenizer.forward()` 返回 runtime-length per-request list，故 `supports_cudagraph_full=False`，不能让 FULL wrapper 冻结 capture-time 长度；默认 YAML 已令 stage-1 eager，此 opt-out 主要约束其他配置/未来 override。stage-0 inner wrapper 只捕获固定 bucket 的 greedy semantic argmax + CFG Euler ODE；
  - enforce-eager、未 warm、超出/缺 bucket，或 outer stream 正在 capture 时均走 eager `compute_mm_logits`，禁止 nested graph replay。
- 强制：replay 前清零/pad static input，逐 request 写 CFG、其余填 1.2，并原位生成 fresh noise；输出 clone 后裁到真实 batch。ODE 把 step-invariant `llm_projection` 提出循环；time projection 与 dt 在 eager path 按 dtype lazy cache，graph path 按 capture device/dtype 预生成。
- 验收：固定 weights/input/noise/CFG 对比 eager/graph codes 与 EOS；覆盖 exact/padded/oversize bucket、fresh noise、per-request CFG、outer-capture fallback、stage-1 动态输出和 cache invalidation。target synthetic test只随 pre-projected velocity signature 更新；
  - 没有新增上述 opt-out/fallback、invalidation 或真实 checkpoint 数值 parity 回归。^[PR #5175]

### [VOXTTS-1b] 合并 host sync 仍须保留 device/empty 语义

- 触发：packed header、EOA cutting point、chunk padding、waveform logging、ALiBi/fake-EOS cache。
- 强制：CUDA `input_ids` 整体 D2H 一次并从 CPU view 读每项 header，token slice 仍取原 tensor；这替代逐 request 两次 `.item()`，但也复制 payload，且 `is_cuda` guard 不覆盖 XPU。EOA 在 device 为每项求 `(any,argmax)` 后一次 stacked D2H；无 EOA 用原长度。chunks 用 `pad_sequence` 批量 decode 并按原长裁回。
- 强制：ALiBi 是随 module device 的 non-persistent contiguous FP32 buffer；SDPA 只转 query dtype。fake-EOS 常量按 device cache。waveform 已无条件 detach/copy CPU 后，WARNING gate 才决定是否做 CPU min/max；这不消除 waveform D2H，通常 WARNING 开启时仍执行 reductions。
- 验收：多 request 覆盖 EOA 首/中/末/缺失、零长度、空列表和变长 chunks，对比旧实现的 exact cutting/output；FlashAttention/SDPA 检查 dtype/device。用 profiler 分离 D2H/H2D 与 kernel，不用 wall-clock 单独归因。^[PR #5175]

### [VOXTTS-1c] per-request CFG metadata 与 batch 严格对齐

- 触发：`sampling_extra_args`、`cfg_alpha` 或 graph static CFG buffer。
- 强制：metadata 规范为恰好 B 项；缺 list、缺项、`None` 或缺 key 均逐 request 填 default，额外项 fail closed；传入 eager/graph 的 tensor 必须为 `(B,)`。
- 验收：覆盖 missing/empty/short/None/missing-key/exact/overlong，并在 B>1 断言独立 CFG。target 仍只遍历已提供项；review 指出的错误广播/失败未修复且无回归测试。^[PR #5175]

### 性能证据边界

- 作者 A/B 使用 RTX 6000 Ada、vLLM 0.25、全局 `--enforce-eager` 和可变的 `main`，未给 checkpoint/prompt/request count/raw artifact；它不验证任何 graph 改动。reviewer 的 exact-base L20X + vLLM 0.26、默认 YAML、本地 snapshot、每 leg 两个 server/各 13 warm requests，以输出 bytes 归一后只支持约 3% 的方向性改善。
  - 两组都无 profiler、逐优化 ablation 或质量 parity，不可泛化吞吐/延迟数字，也不能把 raw latency 用于变长音频比较。^[PR #5175]

## 决策与踩坑

- [VOXTTS-1a] 禁止：把 stage-1 opt-out 说成整族禁用 CUDA graph；把 mutable static buffers 当并发安全；weights/module device 改变后继续复用旧 schedule。当前 cache 只以 dtype 为 key，不含 device/weight generation，也不是 registered buffer；单-device 串行 runner 不证明 module move、hot weight update 或同实例并发安全。
- [VOXTTS-1b] 禁止：宣称完全无 host sync，或把 Voxtral-local 优化外推为共享 TTS runtime。EOA 新路径在检查 `has` 前总调用 `argmax`；零长度 codes 会抛错，而旧路径进入显式 empty-result 分支，所以不能声称严格等价。
- [VOXTTS-1c] 禁止：短 list 的 `(1,)` 向 B>1 广播、空 list shape mismatch、或对 `None` 直接 `.get`。
