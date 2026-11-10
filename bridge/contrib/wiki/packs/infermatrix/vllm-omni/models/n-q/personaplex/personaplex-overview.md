---
name: personaplex-overview
description: PersonaPlex（nvidia/personaplex-7b-v1，Moshi-based full-duplex S2S，pin e788ef6e experimental）目录入口：PersonaPlexTalkerForConditionalGeneration 与 PersonaPlexCode2Wav 的 registry、pipeline key personaplex、空 config.json 经 _ARCH_TO_MODEL_TYPE 回填 model_type、staged pipeline 与 /v1/realtime?duplex=1 unified path 的区分
metadata:
  scope: 只收 PersonaPlex 的名称、注册入口、两个入口的区分和目录路由；stage 与 frame 状态归 personaplex-architecture，PPLEX-1a 到 PPLEX-3b、PPLEX-1d、PPLEX-1e 及 PR 规则归 personaplex-rules-1、personaplex-rules-2，PPLEX-4a 到 PPLEX-4c 归 rules-live-graphs，PPLEX-HOIST-1a 与 PPLEX-CODEC-DELTA-1a 归 rules-streaming-state
---
# PersonaPlex

## 现状

### 名称、注册与范围

- 正式模型 `nvidia/personaplex-7b-v1`，是 Moshi-based full-duplex S2S；目标 pin `e788ef6e` 的实现标为 experimental。
- AR registry 新增 `PersonaPlexTalkerForConditionalGeneration` 和 `PersonaPlexCode2Wav`，都位于 `model_executor/models/personaplex/`；pipeline registry key 是 `personaplex`，默认 deploy 是 `personaplex.yaml`。
- checkpoint 的 `config.json` 为空；`engine/arg_utils.py::_ARCH_TO_MODEL_TYPE` 必须从上述 architecture 回填 `model_type=personaplex`，再注册本地 `PersonaPlexConfig`。
- 两个入口必须区分：标准 omni engine 的 talker→code2wav staged pipeline，以及 `/v1/realtime?duplex=1` unified engine path；`personaplex/serving/` 的 standalone server 只是兼容面，不能证明 unified path 可用。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| stage、frame、codec/session 状态和 serving 边界 | [[personaplex-architecture]]（architecture） |
| frame accounting、de-delay、lease、greedy/config 门禁、Mimi codebook prefix与vectorized prefill | [[personaplex-rules-1]]、[[personaplex-rules-2]]（rules） |

### 什么时候查这里

- 审查 PersonaPlex registry/config、Mimi codec、async-chunk handoff、duplex admission、session cleanup 或 WebSocket reconnect。
- 共享 full-duplex 生命周期转到 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving rules），共享 runner hook/config projection 转到 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor rules）。
- [[rules-live-graphs]]（PersonaPlex live append 与 Mimi graph 合同）。
- [[rules-streaming-state]]（PersonaPlex streaming 表与 codec 输入合同）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/personaplex/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, model-executor；created: 2026-09-02；updated: 2026-10-06
- 来源（sources）：PR #4771；vllm_omni/model_executor/models/personaplex/；vllm_omni/model_executor/models/personaplex/duplex/；vllm_omni/deploy/personaplex.yaml
- 置信度（confidence）：high
