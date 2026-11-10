---
name: ming-flash-omni-overview
description: "Ming-flash-omni（BailingMM2，main @ 33dd9a5a 复核）目录入口：蚂蚁 inclusionAI 全模态、BailingMM2NativeForConditionalGeneration 别名路由、AR registry 四入口与 MingImagePipeline、与 Ming-Omni-TTS 是两个家族且 stage 名 ming_tts 被复用、四个 pipeline key、四份 deploy 显存布局与 hf_config_name 不一致、MingFlashOmniTTSAdapter 的 serving 消歧（PR #5746、PR #5843）"
metadata:
  scope: 只收 Ming-flash-omni 的名称别名、registry 与 pipeline key、配置差异和 serving 消歧；数据流与跨 stage 桥归 ming-flash-omni-architecture，另一家族归 ming-omni-tts-overview
---
# Ming-flash-omni

## 现状

- 以下事实在 `main @ 33dd9a5a` 复核。

### 名称与范围

- 蚂蚁/inclusionAI Ming 系全模态（文/图/视频/音频理解;文本、语音、图像输出）。HF 侧名字是 **BailingMM2**:野生 config.json 写 `BailingMM2NativeForConditionalGeneration` / model_type `bailingmm_moe_v2_lite`——registry 别名 + `hf_architectures` + `diffusion/data.py` 特判三处共同把它路由到本家族。
  - 在线示例 serve 目标 `Jonathan1909/Ming-flash-omni-2.0`（疑似个人 namespace,树内未记载官方仓来源,YAML 不 pin）。
- AR registry 四入口：复合类 `MingFlashOmniForConditionalGeneration`、thinker `MingFlashOmniThinkerForConditionalGeneration`、talker `MingFlashOmniTalkerForConditionalGeneration`,以及 `BailingMM2NativeForConditionalGeneration`（**解析到复合类的别名**）;
  - diffusion registry `MingImagePipeline`（`pipeline_ming_imagegen.py`, 类继承自 `ZImagePipeline`——见 [[z-image-overview]]（z-image））。
- **与 [[ming-omni-tts-overview]]（ming-omni-tts） 是两个家族**：`ming_tts` registry 入口属于后者,但共享 `model_executor/models/common/ming/`（AudioVAE/DSP/DiT/FM）; **stage 名 `ming_tts` 在本家族 stage 1 被复用**——serving 按 arch 消歧, stage-key 路由的常驻 footgun。
- pipeline key 四个：`ming_flash_omni`（thinker+talker,文本+音频双 final）/`ming_flash_omni_tts`（仅 talker）/ `ming_flash_omni_thinker_only`（仅 thinker）/ `ming_flash_omni_image`（thinker latent → MingImagePipeline DIFFUSION）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）、[[configuration-architecture]]（Config 组件）。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 文本桥 vs hidden 桥、CFG 伴随、ByT5 字形路径 | [[ming-flash-omni-architecture]]（architecture） | 数据流与 reviewer 陷阱 |
| speech API 的 detection/adapter union | [[rules-engine-lifecycle-1]]（Serving SERV-5e；源锚点 #serv-5e-tts-detection-从-adapter-metadata-的有序并集派生） | `ming_tts` 消歧、请求校验和 prompt delegation |

### 配置与 checkpoint 差异

- 四份 deploy 全 `trust_remote_code`、`async_chunk: false`、仅 CUDA 验证。显存布局差异大:omni（TP4 + talker 共卡 GPU3 0.74/0.18,80 GB 卡验证）/tts（单卡 0.8）/ thinker_only（TP4 0.9）/ image（TP4 + DiT 独占 GPU4, `max_num_seqs: 2` 给 CFG 伴随请求留位,stage0 `max_tokens: 1` 纯 prefill）。
- 已知不一致（pin 上如实记录）：stage-0 `hf_config_name` 在 omni/thinker_only 是 `llm_config`,在 image 拓扑却是 `thinker_config`, 代码无解释;`fuse_allreduce_rms: false`（flashinfer 版本不匹配的 workaround）。
- extra-body 面（注册在 arch key `MingImagePipeline`）: `{height,width,steps,cfg,seed,byte5_text,negative_prompt}`。

### 什么时候查这里

- 审查 ming_flash_omni 任一拓扑、BailingMM2 名字路由或 serving 消歧。talker-only speech 已由 `MingFlashOmniTTSAdapter(stage_keys={"ming_tts"})` 负责请求校验和 prompt 构建；它继续调用 server 上的 `_build_ming_flash_omni_prompt()`，是提取而非 prompt 合同改写。检测端的同名 legacy detector 已移除，`LEGACY_TTS_DETECTORS=()`；
  - `ming_tts` stage key 由 adapter 自身检测，其默认 priority 100 先于 Ming dense architecture fallback 的 200。不要把模型分支重新塞回共享 dispatcher。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ming-flash-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Ming-flash-omni（BailingMM2,4 拓扑全模态）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-03
- 来源（sources）：vllm_omni/model_executor/models/ming_flash_omni/；vllm_omni/diffusion/models/ming_flash_omni/；vllm_omni/model_executor/stage_input_processors/ming_flash_omni.py；vllm_omni/entrypoints/openai/tts_adapters/__init__.py；vllm_omni/entrypoints/openai/tts_adapters/ming_flash_omni_tts.py
  - tools/pre_commit/check_tts_adapter.py；PR #5746；PR #5843
