---
name: aura-omni-overview
description: "Aura-Omni（pipeline key aura_omni，ASR → AURA Thinker → Talker → Code2Wav 四段，PR #7633 合入后复核）：名称、源码与部署，Reviewer 陷阱（deploy 默认 async_chunk false 而 duplex 必须 true、Talker stop 2150、顶层 model_arch 不在 _OMNI_MODELS、silent id v1 151669 与 v2 不同、入史与成对删除、报表暖机不是合同），什么时候查、不放什么、目录内容"
metadata:
  scope: 只收 Aura-Omni 的名称、部署分叉、reviewer 陷阱和目录路由；可审计硬门禁 AURA-1a 至 AURA-1i 归 aura-omni-rules，尾段 Talker / Code2Wav 的入口归 qwen3-tts-overview
---
# Aura-Omni

## 现状

- 事实在合入 [PR #7633](https://github.com/vllm-project/vllm-omni/pull/7633)（merge `62b15142bdab8c80eb83473f65e51774d1a2521b`，2026-09-21）后的 upstream `main` 复核。硬门禁在同目录 `rules.md`（见下表）；本页留名称、部署分叉与 reviewer 陷阱。

### 名称、源码与部署

- 正式名称 Aura-Omni（AURA 语音助手管线）；pipeline key `aura_omni`。
- Stage1 AR：`AuraQwen3VLForConditionalGeneration`（在 Omni `_OMNI_MODELS`）。
- 源码：`model_executor/models/aura_omni/`（`pipeline.py`、`qwen3_vl.py` shim、**`duplex/`**）；桥 `stage_input_processors/aura_omni.py`。
- 共享 owner：[[qwen3-tts-overview]]（Qwen3-TTS）（尾段 Talker／Code2Wav）、[[model-executor-overview]]（Model Executor）、[[serving-overview]]（Serving）、[[configuration-overview]]（Configuration）。

### Reviewer 陷阱（先读再改）

- **`async_chunk` 分叉**：`deploy/aura_omni.yaml` 默认 **`false`**（非 duplex）。Realtime duplex 用 `examples/online_serving/aura_omni/aura_omni_duplex_smoke.yaml`（或等价）且必须 **`true`**，否则 Stage2→3 codec 交不出去。详情跟 [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Q3TTS-3a），不要在本页重写 codec。
- **Talker stop `2150`** 仍属 TTS 家族（duplex smoke Stage2 `stop_token_ids`）；改 stop／humming 边界先查 [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（qwen3-tts rules）。
- **Pipeline 顶层 arch**：`AURA_OMNI_PIPELINE.model_arch="Qwen3ASRForConditionalGeneration"` **不在** Omni `_OMNI_MODELS`，靠上游 vLLM 模型表合并——**仍成立**，不是已删除的过时警告。Stage1 才是 `AuraQwen3VLForConditionalGeneration`。
- **Stage2→3**：默认 SharedMemoryConnector 码流；合同在 Q3TTS，不在本页展开。
- **Silent id**：duplex plugin 钉 **v1** `151669`（companion `151645`）；AURA_v2 streaming 另一套（如 `248070`／`248046`）——混用会 pad 到 `max_tokens`（AURA-1f）。
- **History**：空字+有 clip+silent **会入史**；成对删除只在 **prune 剥 video 之后**（AURA-1e）。勿倒推成「silent VF 永不入史」。
- **报表暖机**：OmniInteract／同类 streaming 量测前跑完整 `0001` session、报表排除 `0001`，是 **bench／运维约定**，**不是** upstream API 合同，也不是本目录 RULE（无 in-tree CI job 强制）。勿写成「#7633 已证明暖机语义」。

### 结构（一句话）

- 四段：ASR → AURA Thinker → Talker → Code2Wav；duplex 经 `/v1/realtime?duplex=1`。`qwen3_vl.py` 为 checkpoint config／processor shim。用户文档：`docs/user_guide/examples/online_serving/aura_omni.md`。

### 什么时候查这里

- 审查 AURA 拓扑、duplex plugin、Stage1 投影／metrics、AURA barge-in fence、SessionHistory 入史／sole-writer／`prompt_mm`、silent 家族、`VLLM_AURA_*` env、默认 yaml vs duplex `async_chunk`。
- 尾段 codec／async chunk／decoder → [[qwen3-tts-overview]]（qwen3-tts）。
- 共享 duplex session lifecycle → [[serving-overview]]（serving）。

### 不放什么

- 本机绝对路径、GPU 编号、演示端口、私有 handoff 长文。
- MiniCPM native duplex／Code2Wav window／`generate_chunk`／1030ms video 合同（[[minicpm-o-4-5-overview]]（minicpm-o-4-5））。
- Qwen3-TTS Stage2–3 codec 合同正文（只 link Q3TTS）。
- OmniInteract 操作 runbook／报表步骤（非 RULE；见上文「报表暖机」一句）。
- 共享 Realtime serving（wire defaults、`session.update` ACK 等）→ `components/serving`。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 可审计硬门禁 | [[aura-omni-rules]]（rules） | `AURA-1a` … `AURA-1i` |
| Talker／Code2Wav／async chunk | [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（qwen3-tts rules） | `Q3TTS-3*` |
| 新模型注册清单 | [[adding-a-model]]（adding-a-model） | 配置组件 |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/aura-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Aura-Omni（4-stage 语音助手组合管线）；type: index；tags: vllm-omni, models, model-executor, serving；created: 2026-07-21；updated: 2026-09-23
- 来源（sources）：PR #7633；vllm_omni/model_executor/models/aura_omni/；vllm_omni/model_executor/models/aura_omni/duplex/；vllm_omni/model_executor/stage_input_processors/aura_omni.py；vllm_omni/deploy/aura_omni.yaml；vllm_omni/config/pipeline_registry.py
  - examples/online_serving/aura_omni/aura_omni_duplex_smoke.yaml；docs/user_guide/examples/online_serving/aura_omni.md；tests/model_executor/stage_input_processors/test_aura_omni_duplex_history.py；tests/engine/duplex/test_session_runner.py
- 置信度（confidence）：high
