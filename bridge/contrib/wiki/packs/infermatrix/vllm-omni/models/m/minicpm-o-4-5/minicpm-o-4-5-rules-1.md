---
name: minicpm-o-4-5-rules-1
description: "MiniCPM-o 4.5 规则（一）：MCPMO 编号说明、代码快速入口与完整代码路由表，以及 MCPMO-1a trust_remote_code 服从用户选择、1b TTS 依赖显式声明（PR #3642）、1c Code2Wav TensorRT 的 CUDA-only 可逆替换与原子发布（PR #5638、PR #6957）、2a registry 的 4.5 版本判定、2b audio chunk mask 向量化（PR #5382）"
metadata:
  scope: 只收快速入口与路由表及 MCPMO-1a/1b/1c/2a/2b；MCPMO-2c 至 3d 与 4a 归 minicpm-o-4-5-rules-2，MCPMO-4d、5a、5b、2e、2f、2g、3f 归 minicpm-o-4-5-rules-3，专题规则归 rules-code2wav-runtime、rules-cuda-graphs、rules-duplex-1 与 rules-code2wav-batching
---
# MiniCPM-o 4.5 规则（1/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/3 部分；第 2 部分 [[minicpm-o-4-5-rules-2]]；第 3 部分 [[minicpm-o-4-5-rules-3]]
- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-07-20；updated: 2026-09-22
- 来源（sources）：PR #3642；PR #5165；PR #5382；PR #5524；PR #5638；PR #5792；PR #5869；PR #6056；PR #6154；PR #6170；PR #6318；PR #6828；tests/dfx/perf/tests/test_minicpmo_4_5.json；tests/dfx/perf/tests/test_minicpmo_4_5_duplex_seed_tts.json；tests/e2e/accuracy/minicpmo_4_5/test_minicpmo_4_5.py
  - tests/e2e/online_serving/helpers/minicpmo_4_5_duplex.py；tests/e2e/online_serving/test_minicpmo_realtime_duplex_drivers.py；tests/e2e/online_serving/test_minicpmo_4_5.py；tests/e2e/online_serving/test_minicpmo_4_5_duplex.py；tests/e2e/online_serving/test_minicpmo_4_5_expansion.py
  - tests/e2e/online_serving/run_minicpmo_realtime_duplex_soft_interrupt.py；vllm_omni/benchmarks/data_modules/seed_tts_dataset.py；vllm_omni/benchmarks/data_modules/seed_tts_eval.py；vllm_omni/benchmarks/patch/patch.py；vllm_omni/deploy/minicpmo_4_5.yaml
  - vllm_omni/experimental/fullduplex/client.py；vllm_omni/entrypoints/duplex/chat_fallback.py；vllm_omni/entrypoints/duplex/realtime_input.py；vllm_omni/entrypoints/duplex/session_runner.py；vllm_omni/entrypoints/duplex/serving.py；vllm_omni/entrypoints/duplex/vad.py
  - vllm_omni/model_executor/models/minicpmo_4_5/duplex/adapter.py；vllm_omni/model_executor/models/cosyvoice3/code2wav_core/hifigan.py；vllm_omni/model_executor/models/minicpmo_4_5/batched_token2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/cuda_graph_wrapper.py
  - vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_code2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_llm.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_tts.py；vllm_omni/model_executor/stage_input_processors/minicpmo_4_5_omni.py
  - tests/model_executor/models/minicpmo_4_5/test_audio_chunk_mask.py；tests/model_executor/models/minicpmo_4_5/test_cfm_graph_capture_gating.py；tests/model_executor/models/minicpmo_4_5/test_code2wav_batching.py；tests/model_executor/models/minicpmo_4_5/test_cuda_graph_wrapper.py
  - tests/model_executor/models/minicpmo_4_5/test_pipeline.py；tests/model_executor/models/minicpmo_4_5/test_talker_batching.py；tests/model_executor/models/minicpmo_4_5/test_vision_flash_attention.py；PR #6082；PR #5604；PR #6274；PR #6346；PR #6397；PR #6406；PR #6458；PR #6587；PR #6619
  - PR #6757；PR #6529；PR #6772；vllm_omni/entrypoints/duplex/protocol.py；PR #7071；PR #5730；PR #7344；PR #7517
- 置信度（confidence）：high
- 只有 `MCPMO-数字字母` 是可审计规则 ID。
- 相关专题：[[rules-code2wav-runtime]]（MiniCPM-o 4.5 Code2Wav 运行时合同）（`MCPMO-1f`, `MCPMO-1g`, `MCPMO-1h`, `MCPMO-1i`）。

### Direct 代码快速入口

| PR 描述信号 | 规则入口 |
|---|---|
| version/registry、processor、remote code | `MCPMO-1a`、`MCPMO-2a` |
| Whisper/APM 或 SigLIP attention | `MCPMO-2b`、`MCPMO-2c` |
| audio_feature_lens ragged slices、encoder batch TensorShape、`audio_embeds` 注册与 placeholder | `MCPMO-2e`、`MCPMO-2f` |

- （以下为原表格，按行改写为条目）
- PR 描述信号：TTS/Code2Wav/TRT、CUDA Graph
  - 规则入口：`MCPMO-1b`–`MCPMO-1e`；[[rules-cuda-graphs]]（CUDA graphs）
- PR 描述信号：batch、runtime info、reference-audio handoff
  - 规则入口：`MCPMO-3a`–`MCPMO-3e`；[[rules-code2wav-batching]]（Code2Wav batching）
- PR 描述信号：native duplex、sampling budget、shipping profile、playback ACK、Talker full-attention rollover
  - 规则入口：`MCPMO-4a`–`MCPMO-4i`；[[rules-duplex-1]]、[[rules-duplex-2]]（duplex）
- （以下为原表格，按行改写为条目）
- PR 描述信号：accuracy/performance/online-serving evidence
  - 规则入口：`MCPMO-5a`、`MCPMO-5b`

### 完整代码路由

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| MiniCPM-o 4.5、`minicpmo_4_5`、版本识别 | MCPMO-2a | `config/pipeline_registry.py::OMNI_PIPELINES["minicpmo_4_5"]` → `model_executor/models/minicpmo_4_5/pipeline.py`；`model_executor/models/registry.py::_OMNI_MODELS` |
| Whisper/APM、chunk attention mask、left context/lookahead | MCPMO-2b | `minicpmo_4_5_omni_llm.py::{get_audio_hidden_states,subsequent_chunk_mask}` → audio encoder；row-by-row oracle test |
| SigLIP、FlashAttention、padding/unpad metadata、varlen vision | MCPMO-2c | `SiglipEncoder.forward` → `SiglipEncoderLayer` → `SiglipFlashAttention2._upad_input` |
| tokenizer/processor、`trust_remote_code` | MCPMO-1a | pipeline/config factory → `model_executor/models/minicpmo_4_5/` loader |
| TTS extra、backend 初始化、空音频 | MCPMO-1b | `minicpmo_4_5_omni_tts.py::MiniCPMO45OmniTTSForConditionalGeneration`、`minicpmo_4_5_token2wav.py::MiniCPMO45Token2wav` |
| Code2Wav TensorRT、DiT/Campplus、engine cache/profile | MCPMO-1c | `minicpmo_4_5_code2wav.py::MiniCPMO45Code2Wav` → `batched_token2wav.py::BatchedToken2Wav._estimator_step`；共享实现 `step_audio2/step_audio2_dit_trt.py` |
| HiFT CUDA Graph、chunk bucket、lazy capture、iSTFT | [[rules-cuda-graphs]]（`MCPMO-1d`；源锚点 #mcpmo-1e-legacy-step-level-cfm-dit-graph-必须按-shape-整代退休并保持-eager-parity） | `cuda_graph_wrapper.py::HiFTGraphWrapper` → `BatchedToken2Wav._hift_inference` → shared `HiFTGenerator` |
| CFM DiT CUDA Graph、shape cache、generation retirement、eager fallback | [[rules-cuda-graphs]]（`MCPMO-1e`；源锚点 #mcpmo-1e-legacy-step-level-cfm-dit-graph-必须按-shape-整代退休并保持-eager-parity） | `cuda_graph_wrapper.py::CFMGraphWrapper` → `BatchedToken2Wav._estimator_step` |
| batch、`runtime_info`、stage handoff | MCPMO-3a/3b | `stage_input_processors/minicpmo_4_5_omni.py` → `minicpmo_4_5_omni.py::MiniCPMO45OmniForConditionalGeneration` → TTS/code2wav |
| Seed-TTS、chat `ref_audio`、runtime-ref、Code2Wav handoff | [[rules-code2wav-batching]]（MCPMO-3e；源锚点 #mcpmo-3e-minicpm-o-45-reference-audio-必须经过私有-prompt-到-code2wav-handoff） | serving chat MediaConnector → original prompt private key → `llm2tts` buffer → Code2Wav |
| Talker codec sampling、repetition penalty、request RNG/compaction | MCPMO-3c | `minicpmo_4_5_omni_tts.py::{make_omni_output,_sample_audio_codes,_apply_batched_repetition_penalty}` → `test_talker_batching.py` |
| native duplex、Stage0 resume、LISTEN/SPEAK、server VAD | MCPMO-4a | `experimental/fullduplex/{minicpmo45,openai}/` → stage input processor |
| instructions/native-mode update、first-append reservation、context lock | [[rules-duplex-1]]（`MCPMO-4b`；源锚点 #mcpmo-4b-native-duplex-session-update-必须如实拒绝不可重建的上下文） | `experimental/fullduplex/minicpmo45/{adapter,session}.py` → runtime adapter/session runner |
| duplex Talker chunk、runtime `min_tokens`、chat sampling isolation | [[rules-duplex-1]]（`MCPMO-4c`；源锚点 #mcpmo-4c-native-duplex-talker-必须按-generate_chunk-预算终止） | `experimental/fullduplex/minicpmo45/adapter.py` → stage 1 sampling → Talker `generate_chunk` |
| shipping YAML、duplex/chat 共服、session capacity、async scheduler | [[rules-duplex-1]]（`MCPMO-4e`；源锚点 #mcpmo-4e-shipping-profile-必须共服-chat-与-native-duplex） | `deploy/minicpmo_4_5*.yaml` → config merge → realtime/chat entrypoints |
| playback ACK、response-owned assistant history、下一 input 后的 late ACK | [[rules-duplex-2]]（`MCPMO-4h`；源锚点 #mcpmo-4h-responseplayback-history-必须由回答它的-input-commit-所有） | `experimental/fullduplex/openai/{protocol,serving}.py` → response snapshot / conversation item lifecycle |

### [MCPMO-1a] trust_remote_code 服从用户选择

- 触发：API/CLI server 为 MiniCPM-o 加载 tokenizer、processor、config 或模型代码。
- 强制：只使用 CLI/配置解析后的 `trust_remote_code` 值，并沿所有入口传递。
- 验收：false 路径不执行 remote code，true 路径按显式授权加载；offline/online 语义一致。 ^[PR #3642]

### [MCPMO-1b] TTS 依赖显式声明，初始化失败不得伪装为空音频

- 触发：可选 TTS extra、音频 backend 或模型初始化异常。
- 强制：缺包使用明确 extra/import 错误；只有确认为 ImportError 的可选能力才可按合同降级，其他初始化失败立即向上抛出。
- 验收：缺 extra、坏配置和 backend 初始化失败分别得到可诊断错误；正常路径返回非空且格式正确的音频。 ^[PR #3642]

### [MCPMO-1c] Code2Wav TensorRT 是 CUDA-only 的显式可逆替换

- 触发：`token2wav_trt` / `MINICPMO_TOKEN2WAV_TRT=1`，或修改 Code2Wav 的 DiT、Campplus、ONNX/TRT engine cache 与 optimization profile。
- 强制：各平台先构造树内 `MiniCPMO45Token2wav`；仅 CUDA 开关同时启用 DiT estimator 与 Campplus TRT，关闭/非 CUDA 保留 torch。DiT 只替换 `_estimator_step`，encoder/HiFT 仍为 torch 且 engine 用调用者 CUDA stream。dtype ONNX export 深拷贝再 cast、不改 live estimator；
  - plan key 含 depth、dtype、max-batch、SM、TRT version，profile 覆盖 CFG `2B`、chunk 3000、cache 1000，越界报可操作错误；Campplus 是本地资产 `[T,80]` → `[1,192]` fp32。
- 强制：共享 `_publish_atomically` 用同目录 `<dest>.tmp.<pid>.<uuidhex>` 独占 `xb`；writer 写入、flush/close 后 `os.replace`，并发成功完整且 last-writer-wins。collision 在 writer 前失败且不删 foreign tmp；任何失败保留 destination、只删 owned tmp、重抛原异常，cleanup 仅日志。ONNX path writer 在 umask 移除 owner-write 时记录 mode、补写权限并在发布前恢复；
  - plan stream 不作 `fstat`/`fchmod`。无 fsync/目录持久化、锁、内容校验或 ONNX/plan 成对事务。
- 验收：覆盖开关/非 CUDA、torch/TRT parity、cache/SM/profile 边界；运行 `python -m pytest -q tests/model_executor/models/step_audio2/test_step_audio2_dit_trt.py` 覆盖 CPU 并发、collision、writer/fstat/replace/cleanup failure 与 restrictive umask。MiniCPM wiring 的自动化验证仍须补证。 ^[PR #5638] ^[PR #6957]

### [MCPMO-2a] registry 使用 4.5 config/version predicate

- 触发：pipeline auto-detection 看到通用 `MiniCPMO` architecture。
- 强制：结合 4.5 专有 architecture/config 字段判定；旧 1.0/2.6 不得落入 4.5 pipeline。
- 验收：4.5、旧版和无版本字段 fixture 分别命中 4.5、旧 pipeline 或明确失败。 ^[PR #3642]

### [MCPMO-2b] audio chunk mask 向量化必须保持逐行边界语义

- 触发：修改 Whisper/APM `subsequent_chunk_mask`、chunk size、left-context 或 lookahead。
- 强制：对每个 query row，end 保持 `min((row // chunk_size + 1) * chunk_size + num_lookhead, size)`；`num_left_chunks < 0` 从 key 0 开始，否则 start 保持 `max((row // chunk_size - num_left_chunks) * chunk_size, 0)`。可用 query/key index broadcast 一次构造 dense bool `[T,T]` mask，但不得改变 caller 与 padding mask 的 OR/取反语义。
- 验收：row-by-row oracle 覆盖 size 0、chunk 边界两侧、无限/有限/零 left context 与 lookahead，并在真实 caller 组合 padding mask。目标提交的 CPU 参数化测试覆盖 216 组纯 mask parity，但不覆盖 CUDA kernel 数、完整 audio embedding 或 serving。
  - PR 的 CUDA timing/bitwise embedding 证据来自 `ee33954dff27da317be597449a6c1b5a5df4052b`，不是 merge target `9235b0ae` 的复测，因而只能作为外部局部性能证据。^[PR #5382]

## 决策与踩坑

- [MCPMO-1a] 禁止：模型特例无条件设置 `True`，绕过用户的安全选择。
- [MCPMO-1b] 禁止：catch-all 后返回空 waveform，让请求看似成功。
- [MCPMO-1c] 禁止：把 shared helper 解释成 Step-Audio2 TRT；当前显式 consumer 只有 MiniCPM-o Code2Wav，也不得把讨论中的通用 vocoder backend 当作已实现。
- [MCPMO-2a] 禁止：仅用 architecture 集合相交。
- [MCPMO-2b] 禁止：把移除 O(T) Python row loop 描述成移除 O(T²) mask storage/attention；把 reviewer 建议的 `@staticmethod` 当成已合并（目标仍保留 instance-method interface）；或声称所有 TTFT case 都改善。PR 自己记录短输入/较大 batch 的 scheduler noise 会淹没局部节省。
