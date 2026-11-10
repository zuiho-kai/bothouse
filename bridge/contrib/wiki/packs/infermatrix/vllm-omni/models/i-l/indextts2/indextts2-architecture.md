---
name: indextts2-architecture
description: "IndexTTS2 架构：GPT-2 talker（wav2vec2、RepCodec、CAMPPlus、Qwen 情感模型都在预处理路径内、非独立 stage）、S2Mel decoder（CFM + DiT + BigVGAN 与双 CUDA-graph 系统）、哑 tokenizer extras、stage-1 hf_overrides（diffusion_steps: 12 与 docstring 25 步不一致）、talker2s2mel_full_payload 全载荷合同、非流式的结构性根因与功能面验证入口"
metadata:
  scope: 只收专有部分与共享边界、配置与兼容、输入到输出流程与验证入口；名称与 registry 速览归 indextts2-overview，request-end latent 交付规则归 indextts2-rules
---
# IndexTTS2 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;入口/变体速览见 [[indextts2-overview]]（index）。

### 模型专有部分与共享模块的边界

- talker（stage 0）：GPT-2 AR 于 vLLM 原生 PagedAttention（`gpt2.GPT2Block` + `support_torch_compile`）;条件栈全在 talker 预处理路径内运行——wav2vec2、MaskGCT 语义 codec（RepCodec）、CAMPPlus 说话人嵌入、Qwen 情感模型（`trust_remote_code`,余弦匹配情感向量）——**不是独立 stage**;说话人特征走共享 speaker cache。
- S2Mel decoder（stage 1）：家族内声学栈 `s2mel/modules/`（`CFM` 流匹配 + `DiT` + gpt-fast 风格 Transformer + BigVGAN）;BigVGAN 懒加载并剥 weight-norm;**双 CUDA-graph 系统**——`CUDAGraphDiTRunner`（按形状捕获 DiT）与 `CUDAGraphBigVGANWrapper`（vocoder）。
- 共享：[[configuration-architecture]]（Config 组件）、SharedMemoryConnector（`codec_streaming: false`）。

### 配置、checkpoint 和兼容范围

- checkpoint `IndexTeam/IndexTTS-2`;引擎侧 tokenizer 是**哑的**（`skip_tokenizer_init` + `gpt2` 名字,pipeline `extras` 与 YAML 双处设定）——动 vLLM tokenizer 管线的 PR 必须保住这组 extras,真实 BPE 在 `IndexTTS2Tokenizer`。
- stage-1 的扩散步数、bf16 双开关、DiT/vocoder CUDA graph 开关与 capture/compile 尺寸表都经 `hf_overrides` 下发：`diffusion_steps: 12`（与 docstring 的"25 Euler steps"不一致——无 YAML 时的代码默认未验证, pin 上记为未决）。

### 从输入到输出的主要流程

1. 文本经家族 BPE/前端;参考音频在 talker 预处理路径内过 wav2vec2 特征提取与 MaskGCT/RepCodec 语义量化,fbank→CAMPPlus 出说话人嵌入,Qwen 情感模型出情感向量;prompt 由 `prompt_utils.py` 构建。
2. talker AR 出 mel 码 + hidden-state latent;stop token 8193 既是采样停止又被 SIP `_strip_stop_token` 在进 stage 1 前剥掉（对齐官方 v2 行为）。
3. `talker2s2mel_full_payload`（在 moss/fish/cosyvoice3/indextts2 四家对比中唯一只用 full-payload 合同的）把整段 mel 码 + latent 打成一个载荷;`_build_s2mel_additional_information` 是 stage-1 张量合同的单一事实源;`talker2s2mel_token_only` 只做消费侧占位分配。
4. S2Mel:流匹配 → mel → BigVGAN → 波形;非流式是**结构性**的（S2Mel 需要全序列）,不是没写完的流式。

### 怎样验证功能、精度和性能

- pin 上只有**功能面**验证入口;无精度基线或性能 gate 证据,相关结论需另行实测。
- e2e：`tests/e2e/{offline_inference,online_serving}/test_indextts2_expansion.py`; SIP 合同 `tests/model_executor/stage_input_processors/test_indextts2.py`（参考音频资产 `tests/assets/indextts2/ref_audio.wav`）;示例 `examples/{offline_inference,online_serving}/text_to_speech/indextts2/`;
  - recipe `recipes/IndexTeam/IndexTTS-2.md`。
- 已知未决：无 YAML 时 diffusion 步数的代码默认;stage-1 sampling 块实际消费面;`s2mel_vocoder_compile_shapes` 与 `capture_sizes` 的交互（仅从命名推断）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/indextts2/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/indextts2/indextts2_talker.py；vllm_omni/model_executor/models/indextts2/indextts2_s2mel_decoder.py；vllm_omni/model_executor/stage_input_processors/indextts2.py；vllm_omni/deploy/indextts2.yaml
