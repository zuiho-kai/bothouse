---
name: ming-flash-omni-architecture
description: Ming-flash-omni 架构：thinker（BailingMoeV2 MoE、M-RoPE、Whisper 风格音频编码）、自足的 Qwen2+CFM+AudioVAE talker、MingImagePipeline 派生自 ZImagePipeline、omni 文本桥与 image hidden 桥的区别、请求级 CFG 伴随请求、拓扑与子 config 键、功能面验证入口与未决项
metadata:
  scope: 只收 Ming-flash-omni 的模型结构、跨 stage 桥、数据流与验证入口；名称别名、registry 与 deploy 差异归 ming-flash-omni-overview
---
# Ming-flash-omni 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;拓扑/命名速览见 [[ming-flash-omni-overview]]（index）。

### 模型专有部分与共享模块的边界

- thinker：BailingMoeV2 MoE 基座（多路由 gate `_unpack_multi_routing`、视频感知 M-RoPE `MingVideoRopeMRotaryEmbedding`）+ Whisper 风格音频编码器 + Qwen 系视觉塔 + 双 projector。
- talker：**自足的 Qwen2 LLM + CFM + AudioVAE**,与 thinker 不共享 backbone（`tokenizer_subdir="talker/llm"` 自带 tokenizer）;CFM 求解器有 CUDA-graph 池（`CFMGraphExecutorPool`）;声音克隆仅 preset（`voice_name` 默认 "DB30",`VoicePresetRegistry`+`SpkembExtractor`）; 尾静音修剪等后处理在 `talker_module.py`。
- imagegen：`MingImagePipeline(ZImagePipeline)`——z_image 的派生; `MingConditionEncoder` 把 thinker hidden 映到 DiT 条件;ByT5 字形编码器 + T5 block mapper 做图内文字渲染;`ref_x` 参考 latent 拼接实现 img2img。
- 共享：`common/ming/` 四块与 ming_tts 家族共用——`audio_vae.py`、`audio_dsp.py`、`dit.py`、`fm.py`; [[diffusion-overview]]（Diffusion 组件）。

### 配置、checkpoint 和兼容范围

- 拓扑↔子 config 键：omni/thinker_only 读 `llm_config`,tts 读 `talker_config`,image 读 `thinker_config`（stage 0）+ `image_gen_config`（stage 1）——image 为何不同 pin 上无解释（未决）。
- checkpoint 合同：四份 YAML 都不 pin ID;示例目标见 index;仅 CUDA 验证（`platforms: {}`）;talker-only 拓扑期望的 checkpoint 布局仅由 `tokenizer_subdir="talker/llm"` 暗示,未决。
- 两种截然不同的跨 stage 桥（评审混淆高发区）:
  - **omni 拓扑走"文本桥"**：thinker 的 detokenized 文本交给 talker 重新分词——**不传 hidden states**（对照 Qwen2.5-Omni 式 talker）。
  - **image 拓扑走"hidden 桥"**：`thinker2imagegen` 从 `final_hidden_states` 里按尾部 `<imagePatch>` 位置切片——锚定末尾 `<image_end>`（默认 id 157159）回走 `num_query_tokens`（256,id 157157）并做**尾签名校验**,防止误切 ref-image/理解用 patch 块;校验失败才退化到全 patch 位置并告警。
- CFG 是**请求级**实现：负向 prompt 变成 `__cfg_text` 后缀的伴随引擎请求, 其 hidden 成为 DiT 的负条件（`expand_cfg_prompts`,可选;无负向即 Ming 默认零负向,此时无伴随请求）——不在 diffusion 循环内;**当伴随请求被派生时** stage0 需要 `max_num_seqs≥2`（image YAML 因此设 2）。

### 从输入到输出的主要流程

1. 多模态输入经 BailingMM2 processor（含 Transformers 5.x AutoVideoProcessor guard）进 thinker。
2. omni:thinker 文本（final）→ `thinker2talker_token_only` 打包文本+ voice 预设参数 → talker 内部生成音频（stage 采样 `max_tokens: 1`, talker 不做 AR token 解码,音频在模型内部产出）。
3. image:thinker 纯 prefill（`max_tokens: 1`,不 detokenize）→ hidden 切片 + 可选 ByT5 字形文本（引号内容自动抽取,带 remove/delete/erase 意图过滤;`extra_body.byte5_text` 显式覆盖）→ 经 deploy 声明的 SharedMemoryConnector（64 KiB 阈值,edge 0→1）交给 MingImagePipeline 去噪 → `[B,3,H,W]`→PIL。
4. tts/thinker_only:各自单 stage 直出。

### 怎样验证功能、精度和性能

- pin 上只有**功能面**验证入口;无精度基线或性能 gate 证据,相关结论需另行实测。
- e2e：`tests/e2e/{offline_inference,online_serving}/test_ming_flash_omni_expansion.py`（覆盖多拓扑）;talker 单测 `tests/model_executor/models/ming_flash_omni/test_talker_{cfm,modules}.py`; 示例 `examples/{offline_inference,online_serving}/ming_flash_omni/` 与 `.../text_to_speech/ming_flash_omni_tts/`。
- 已知未决：image 拓扑为何读 `thinker_config` 而非 `llm_config`;talker-only 拓扑期望的 checkpoint 布局（仅由 `tokenizer_subdir` 暗示）;serve 目标仓的官方来源。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ming-flash-omni/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/ming_flash_omni/pipeline.py；vllm_omni/model_executor/models/ming_flash_omni/talker_module.py；vllm_omni/diffusion/models/ming_flash_omni/pipeline_ming_imagegen.py；vllm_omni/model_executor/stage_input_processors/ming_flash_omni.py
