---
name: dynin-omni-architecture
description: Dynin-Omni 架构（main @ 5d44868e）：树内 stage 分发壳与远程代码装载机制、vLLM 采样器不参与 stage 0 采样（compute_logits 返回 None）、按请求任务路由与 DetokTarget / detok_id、图像 / 音频词表偏移与 codebook 默认 8192 / 4096、全载荷面必须嵌套 codes.audio + meta.finished（平铺 key 被静默丢弃的挂死 footgun）、runtime_info_json 以 uint8 张量过 IPC、验证入口与已知未决
metadata:
  scope: 只收 Dynin-Omni 的模块边界、任务路由、跨 stage 交接合同和验证现状；入口路径与三份 deploy 的差异归 dynin-omni-overview
---
# Dynin-Omni 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;入口速览见 [[dynin-omni-overview]]（index）;语义验收方法见 [[model-validation]]（model-validation）,stage 配置语义见 [[configuration-architecture]]（Config 组件）。

### 模型专有部分与共享模块的边界

- 树内专有：stage 分发壳（`dynin_omni.py`,按 `model_stage` + `STAGE_ALIAS` 路由到三个实现）、远程代码装载机制（`dynin_omni_common.py`：snapshot 下载、远程模块 import、OmegaConf 推理配置定位）、三个 stage 实现（token2text 1640 行——**唯一经 vLLM 进程持 LM 权重的 stage**; token2image/token2audio 是 detokenizer,各自懒加载 MAGVITv2 / EMOVA 解码模型）。
- 远程侧（checkpoint 内,树外）：LLaDA 系 LM、`t2i_generate`/`mmu_generate*` 等采样函数、MAGVITv2、EMOVA speech tokenizer——**vLLM 采样器不参与 stage 0 采样**（`compute_logits` 返回 None,生成在远程函数内完成）。
- 共享：worker-connector 全载荷面。
- 家族局部（非共享模块）：零嵌入 stage 行为在 `dynin_omni_common.py`/`DyninOmniStageBase` 内实现（`build_zero_input_embeddings`,token id 有意义、embedding 无意义, `requires_raw_input_tokens=True`）——不是仓库级共享设施。

### 配置、checkpoint 和兼容范围

- checkpoint 合同：`snu-aidas/Dynin-Omni`（examples 记载,YAML 不 pin）; DYNIN 的 OmegaConf 推理配置从本地目录或 HF 仓解析（`resolve_dynin_infer_sources`,各组件带 `local_files_only` 旗标）; `trust_remote_code: true` 是硬要求（multiconnector YAML 的 false 是未解例外,见 index）。
- 任务路由是**按请求**的（t2t/i2t/s2t/v2t/t2i/i2i/t2s/s2s…）：stage 0 按任务选 prompting + 远程 generate 函数;stage 1/2 按 `DetokTarget`（`detok_id`）决定解码或原样透传——t2t 请求也会流过三个 stage,只是后两级透传。
- 词表偏移在 detok 时做算术:图像 id 减 `image_vocab_offset`（回退 `text_vocab_size+num_new_special_tokens`）后 clamp 到可配 `codebook_size`（默认 8192）;音频 id 减 `audio_vocab_offset` 或 `t2s_vocab_start`,过滤到可配 `audio_codebook_size`（默认 4096）——**偏移来自 runtime info（无硬编码）;codebook 大小可被 runtime info 覆盖,但有硬编码默认 8192/4096**。

### 从输入到输出的主要流程

1. stage 0 远程 generate 完成后产出**完整 token 载荷**（非分块流式;默认与 CI deploy 都置 `async_chunk: false`,YAML 注释注明全载荷交接依赖 worker-connector 数据面;multiconnector YAML 的取值本调查未确认）。`_build_full_payload` 从 `pooling_output` 里抽取 `token_ids`/`runtime_info_json`——**这些字段在 stage 0 forward 内的精确产出位未逐行追**（消费侧合同已验证,生产侧代码位保持未决）。
2. 跨 stage 交接（`stage_input_processors/dynin_omni.py`）双数据面：
   - 全载荷面（worker-connector,生产侧）:`_build_full_payload` **必须嵌套** `codes.audio` + `meta.finished`——**平铺 key 会被调度元数据抽取器静默丢弃**（文档化的挂死 footgun;producer 找不到 token 时返回 None 并警告 "consumer wait gate may hang"）。
   - 同步桥面（消费侧）:`_bridge_tokens` → `token2text_to_token2image` / `token2image_to_token2audio` 从 `multimodal_output` 抽 token+`detok_id` 并合并 additional_information;另有 `*_token_only` 占位 prompt 生成器（零占位镜像 token 数）。
   - 结构化元数据以 **JSON 序列化进 uint8 张量**（`runtime_info_json`）过纯张量 IPC——生产侧 `_build_full_payload` 与消费侧都参与编解码, plain-dict 兜底。
3. stage 1/2：`detok_id` 匹配才解码（MAGVITv2 → CHW 图像; `<|speech_N|>` 单元串 → EMOVA → wav,decode API 面向文件,无 `output_wav_file` 时走临时 WAV）;detok 模型按 (path, local_files_only) 懒缓存。
4. 各 stage 输出走 `OmniOutput.multimodal_outputs`（不是 logits/detokenize）, 改 stage 输出必须保持 `token_ids` + `detok_id` 合同。

### 怎样验证功能、精度和性能

- pin 上只有**功能面**验证入口;无精度基线或性能 gate 证据,相关结论需另行实测。
- e2e：`tests/e2e/{offline_inference,online_serving}/test_dynin_omni_expansion.py`（离线 e2e 用 `dynin_omni_ci.yaml` 级配置）;单测 `tests/model_executor/models/dynin_omni/test_dynin_omni_token2audio.py`; 示例 `examples/offline_inference/dynin_omni/end2end.py`（--task 驱动）。
- 已知未决：stage 0 forward 内 `runtime_info_json`/`token_ids` 的精确产出位未逐行追;stage 源码 docstring 的 Stage-2/3 标号与 pipeline 0 基索引差一（散文式 1 基标号,读代码时勿被误导）;multiconnector YAML 的 `trust_remote_code: false` 矛盾未解。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dynin-omni/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/model_executor/models/dynin_omni/dynin_omni_common.py；vllm_omni/model_executor/models/dynin_omni/dynin_omni_token2text.py；vllm_omni/model_executor/models/dynin_omni/dynin_omni_token2image.py；vllm_omni/model_executor/models/dynin_omni/dynin_omni_token2audio.py
  - vllm_omni/model_executor/models/dynin_omni/pipeline.py；vllm_omni/model_executor/stage_input_processors/dynin_omni.py
