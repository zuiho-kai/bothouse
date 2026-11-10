---
name: higgs-audio-architecture
description: Higgs-Audio 架构：v2 talker（LlamaModel + DualFFN）与 v3 talker（Qwen3Model + 融合多 codebook 嵌入）的专有部分，共享 RVQ + Boson DAC codec，v2 / v3 prompt 形态与 -100 参考音频槽，de-delay 归 stage processor、v3 用 torch.where 而非 clamp 清特殊码，v3 流式窗口数学（L=25、H=4、Q=8）
metadata:
  scope: 只收 Higgs-Audio 的模块边界、prompt / checkpoint 兼容范围、Talker 到 Code2Wav 的流程和测试入口；谱系命名与 deploy 差异速览归 higgs-audio-overview，必须执行的合同归 higgs-audio-rules
---
# Higgs-Audio 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;谱系/命名速览见 [[higgs-audio-overview]]（index）。

### 模型专有部分与共享模块的边界

- v2 专有：`higgs_audio_v2_talker.py`（复用 vLLM `LlamaModel`;DualFFN 按 `audio_token_mask` 路由;独立 `audio_lm_head: Linear(hidden, 8×1026)`; `_apply_audio_mode_bias` 在音频 ramp 完成时强制 audio-eos——这就是 stop token 128012 的来源）。
- v3 专有：`higgs_audio_v3_talker.py`（复用 vLLM `Qwen3Model`;融合多 codebook 嵌入/头,offset 查找+求和;批量 GPU delay 状态机;pinned staging + CUDA event 异步回读;本地 MLP CUDA graph 路径 + FlashInfer wrapper 解包）。
- 共享 codec 内核：`higgs_audio_decoder.py`（RVQ + Boson DAC,v3 直接 import v2 的类）;codes `[B,8,T]` → RVQ 求和 → DAC 反卷积 → 24 kHz PCM（25 fps × 960 hop）。
- 共享框架面：[[configuration-architecture]]（Config 组件）、SharedMemoryConnector、`serving_speech.py`。

### 配置、checkpoint 和兼容范围

- checkpoint（文档/示例记载,deploy YAML 均不 pin）：v2 `bosonai/higgs-audio-v2-generation-3B-base`,v3 `bosonai/higgs-audio-v3-tts-4b`。
- prompt 形态不同：v2 走上游 HF processor——支持零样本 + 浅层声音克隆（`build_voice_clone_prompt`,字节级一致的 system prompt）,但 `ref_audio_in_system_message`/多说话人/`profile:`/长文分块被显式拒绝 4xx;v3 用 `<|tts|>/<|ref_text|>/<|ref_audio|>/<|text|>/<|audio|>` 模板。V3 prompt builder 内部以 `-100` 表示参考音频 embedding 槽；
  - 进入 vLLM 前 tokenizer adapter 将它们换成非 audio-continuation 的 `<|tts|>` 词表 ID，并把绝对槽位置随 reference codes 一起传递。talker 在 transformer layers 前按这些位置（包括 chunked prefill 的局部 span）注入 delay 编码后的融合 embedding；绕过 engine validation 的旧内部调用仍可使用 `-100` fallback。具体必须执行的合同见 [[higgs-audio-rules]]（HIGGS-2a）。
- v3 config 从 checkpoint tokenizer 解析特殊 token 与 eos（缺失即 raise）。
- 采样注意：v2 YAML 注释记载 greedy 会塌缩 codebook argmax，因此 v2 profile 启用 sampling；#6422 不改变也不重新证明 v2。V3 则显式消费 vLLM 的 per-request `torch.Generator`，将一个 request 对齐到八个 contiguous codebook rows，并以 request ID 保存/恢复 decode-delay state；具体 reorder、finish 与 slot-reuse 合同见 [[higgs-audio-rules]]（HIGGS-1a）。

### 从输入到输出的主要流程

1. Talker 以 delay-pattern 布局逐行出码;**去 delay 是 stage processor 的事, 不是模型的事**（`stage_input_processors/higgs_audio_{v2,v3}.py`）。
2. 特殊码清理是**真实音质 bug 类别**：v2 sync 用 `clamp(0,1023)` 并去首尾帧 `[:, 1:-1]`;v3 刻意改为 **de-delay 之后 `torch.where(越界→0)`,只去尾帧** ——因为 clamp 把 EOC 1025 变成合法码 1023,解码出可闻伪音。评审这段勿把 where"简化"回 clamp。
3. 流式机制分代：v2 只有 chunk + 左上下文;v3 额外引入右扣留与首块 TTFA 快路。v3 窗口数学（async_chunk,Q=8 个 codebook）：N 行原始码出 `N−Q+1` 个 de-delay 帧;发射边界 `target_emit = total − H`（末次 H=0）; 窗口覆盖 AR 行 `[emitted−L, target_emit+H+Q−1)`;Stage 1 掐头 `L×hop`、去尾 `H×hop`（L=左上下文 25,H=右扣留 4;`initial_codec_chunk_frames` 走 TTFA 快路）。
4. Code2Wav 是**无 KV、纯 prompt 的 LLM_GENERATION stage**,吃 codebook-major 扁平 token 流;`forward_chunk` 负责流式重叠修剪。

### 怎样验证功能、精度和性能

- 单元：`tests/model_executor/models/higgs_audio_v3/test_higgs_audio_v3.py`（无 GPU,AC-1..10: config/prompt/融合模块/delay/stage processor/registry）。
- e2e：v2 `tests/e2e/{offline_inference,online_serving}/test_higgs_audio_v2_expansion.py`; v3 `tests/e2e/online_serving/test_higgs_audio_v3.py`;perf `tests/dfx/perf/tests/test_higgs_audio_v3.json`;示例 `examples/{offline_inference,online_serving}/text_to_speech/higgs_audio_v{2,3}/`。
- 已知未决：v2 YAML `async_chunk: false` 却配 `codec_streaming: true` 的运行期交互未追清;stage-1 注释"250-frame cap"疑似陈旧（实际 max_tokens 1024）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/higgs-audio/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-05
- 来源（sources）：PR #6422；PR #7065；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_talker.py；vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_tokenizer.py；vllm_omni/worker/gpu_model_runner.py
  - vllm_omni/model_executor/stage_input_processors/higgs_audio_v2.py；vllm_omni/model_executor/stage_input_processors/higgs_audio_v3.py；vllm_omni/deploy/README_higgs_audio_v3.md
