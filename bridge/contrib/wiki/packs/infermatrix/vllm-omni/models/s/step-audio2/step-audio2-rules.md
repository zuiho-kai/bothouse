---
name: step-audio2-rules
description: "Step-Audio2 设备边界与流式性能规则：STEPA2-1a 流式 token 设备常驻与 clone 所有权、STEPA2-1b ragged audio-feature 长度一次 host 同步、性能证据的可用边界（D2H 计数与 L20X A/B）、STEPA2-2a 音频输入与重采样复用共享 runtime（PR #6467）、STEPA2-2b DiT TRT 独占临时文件后原子发布（PR #6957）"
metadata:
  scope: 只收 STEPA2-1a、1b、2a、2b 与性能证据边界及开头的信号表；入口速览归 step-audio2-overview，stage 交接与流式状态归 step-audio2-architecture
---
# Step-Audio2 设备边界与流式性能规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/step-audio2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-09-02；updated: 2026-09-05
- 来源（sources）：PR #5067；vllm_omni/model_executor/models/step_audio2/step_audio2_thinker.py；vllm_omni/model_executor/models/step_audio2/step_audio2_token2wav.py；vllm_omni/model_executor/models/step_audio2/step_audio2_dit_trt.py
  - tests/model_executor/models/step_audio2/test_step_audio2_token2wav_async_chunk.py；tests/model_executor/models/step_audio2/test_step_audio2_dit_trt.py；tests/platforms/npu/test_step_audio2_token2wav.py；PR #6467；PR #6957

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| streaming token ownership 或 ragged audio features | `STEPA2-1a`、`STEPA2-1b` |
| shared audio runtime 或 DiT TensorRT plan publication | `STEPA2-2a`、`STEPA2-2b` |

- 以下规则在 `main @ 12a5f6fb` 复核；主要约束 Step-Audio2 的 thinker/token2wav 路径。共享 `Token2Wav` core 的 blast radius 在下文显式列出，runtime 的通用规则仍归组件 owner。

### [STEPA2-1a] 流式 token 的设备常驻与所有权

- 触发：修改 `_forward_async_chunk`、`stream_chunk_for`、设备/dtype 转换或 `_StreamState` 生命周期。
- 必须：外层用 `numel()` 判空，非空 tensor 保持为 tensor 传到 `stream_chunk_for`；内层整形为 `[1, T]`、转到 core device/`int32` 后无条件 `clone()`。`clone` 是所有权边界：`.to()` 在已匹配 device/dtype 时可返回别名，外部 `inference_chunk` 不得污染调用方 `input_ids`。列表入口仍需兼容 MiniCPM-o 等现有 caller。
- 不得声称“零拷贝/零传输”：设备已匹配时仍有 clone 分配，设备不同时仍有一次设备传输，最终 waveform 仍通过 `detach().cpu().contiguous()` 回到 host。该变更只移除 Step-Audio2 token 的 D2H Python list 再 H2D 往返。
- 验收：添加真实 tensor 分支测试，让 fake `inference_chunk` 就地改写参数并证明 caller tensor 未变；覆盖 device/dtype/shape、list 兼容、空 EOF、last/error 后状态重置。CPU 外的 CUDA/NPU/XPU 结论需各平台证据，不得从通用 `.to()` 推导已验证。

### [STEPA2-1b] ragged audio-feature 长度只做一次 host 同步

- 触发：修改 thinker `_process_audio_input` 中 encoder 输出的 ragged 切片。
- 必须：encoder 后先将整批 `audio_feature_lens.tolist()` 一次转为 Python 整数，再按原 batch 顺序切片；长度、数量和空 batch 语义不变。该代码位于 multimodal-encoder 的 eager prefill 路径，不得移入 decode CUDA graph。
- 边界：`.tolist()` 仍是一次 host 同步；CUDA/XPU/NPU 上都不应表述为 “无同步”，CPU 上则没有 accelerator 同步问题。本次无测试改动，现有 async-chunk 测试也未证明 tensor 参数、设备常驻或非别名。

### 性能证据的可用边界

- PR 作者报告 ASR 8 并发 D2H 计数 `17→2`、transcript 字节相同，但未给 vLLM/vLLM-Omni SHA、计数脚本、原始产物或硬件；只可用于支持“同步次数方向下降”，不可作通用输出等价或性能基线。
- reviewer 在 L20X、vLLM 0.26、TP2、默认 async YAML 上做的精确 A/B 为 3 次/组，中位数 `2.87 s` 与 `2.88 s`、输出同为 `316844 B`；它支持该情景下“未见回归、未见可测加速”。TTS 不走 thinker audio-input 分支，且 `max_num_seqs=1` 无 batch 压力，因此不能验证 `audio_feature_lens.tolist()` 改动或并发收益。
- blast radius：thinker 改动仅 Step-Audio2；`stream_chunk_for` core 也被 MiniCPM-o 4.5/NPU wrapper 使用。MiniCPM 显式传 list，继续走旧分支；Step-Audio2 NPU wrapper 转发 tensor 并继承新分支。评审共享 core 时不得把两者当作同样的性能受益方。

### [STEPA2-2a] ：音频输入与重采样必须复用共享 runtime

- 触发：修改 Step-Audio2 thinker/token2wav 的音频读取、mel filter 或 16/24 kHz 重采样路径，或调整其音频依赖。
- 强制：音频读取统一调用 `load_audio(..., sr=None, mono=True)`，mel filter 统一调用 `mel_filter_bank`；16 kHz 的 s3tokenizer/说话人分支和 24 kHz flow-mel 分支都必须从原始 waveform 分别经 `AudioResampler` 生成，保留真实 sample rate 与单声道语义。
- 验收：静态检查 Step-Audio2 runtime 不再依赖 `librosa`/`soundfile`；覆盖非 16/24 kHz 输入，断言两个目标采样率都由同一原始音频独立生成、mel shape/数值和 token2wav 推理结果正常，并运行 `pytest tests/e2e/online_serving/test_step_audio2_expansion.py --run-level 'advanced_model'`。 ^[PR #6467]

### [STEPA2-2b] DiT TRT 构建必须独占临时文件后原子发布

- 触发：修改 `step_audio2_dit_trt.py` 的 ONNX export、TRT plan 序列化、缓存发布或共享 `Code2Wav` 的 DiT/Campplus TRT wiring。
- 强制：共享 `_publish_atomically` 在 destination 同目录以 `<dest>.tmp.<pid>.<uuidhex>` 独占 `xb` 创建临时文件；writer 写完，stream flush/close 后才 `os.replace`。并发成功者均发布完整 artifact，最终允许 last-writer-wins。名字碰撞须在 writer 前抛出且不得删除 foreign tmp；writer、权限处理或 replace 任一失败必须保留已有 destination、只删除本调用拥有的 tmp、重抛原异常；cleanup 异常只写日志。
  - ONNX path writer 在 umask 移除 owner write 时必须记录 mode、临时补 owner-write，并在发布前恢复；plan 的 stream writer 不做 `fstat`/`fchmod`。
- 边界：这不是 fsync 或目录持久化合同，不提供锁、内容校验或 ONNX/plan 成对事务。共享 helper 位于 Step-Audio2 并不代表其 pipeline 已启用 TRT：此 pin 的显式 consumer 是 MiniCPM-o Code2Wav；不得把该 wiring 或 TRT 支持归因给 Step-Audio2 用户。
- 验收：运行 `python -m pytest -q tests/model_executor/models/step_audio2/test_step_audio2_dit_trt.py`；CPU 测试必须覆盖同进程并发、foreign-name collision、writer/fstat/replace failure、cleanup failure 与 restrictive umask 的 ONNX mode 恢复，并断言 plan 无 `fstat`/`fchmod`。
  - 更广的 Step-Audio2 测试收集在该 PR 环境因 optional `s3tokenizer` 缺失而无法完成，不能误报为完整 suite 已通过。 ^[PR #6957]

## 决策与踩坑

- [STEPA2-2a] 禁止：在目标运行时重新导入 `librosa` 或 `soundfile`，通过 try/except 在两套解码实现间兜底，或把已经 16 kHz 的结果再次作为 24 kHz 重采样输入；不得据此声称 onnxruntime/s3tokenizer 等其他依赖已移除。
