---
name: aura-omni-rules
description: "Aura-Omni 规则 AURA-1a 至 AURA-1i 与 Direct 代码入口表（PR #7633）：四段组合管线与 async_chunk 默认 / duplex 分叉、Stage1 投影不消费 TTS、投影后仍 stash stage metrics、barge-in 清 cancel fence 并 abort 旧 draining TTS、SessionHistory 入史三 case 与默认裁剪 45／30／999、silent stop id 与 checkpoint 家族一致、history 单一写入者、prompt_mm pad 对齐、VLLM_AURA_* 进 inventory"
metadata:
  scope: 只收 AURA-1a 至 AURA-1i 及其代码入口表；名称、部署分叉和 reviewer 陷阱归 aura-omni-overview，共享 duplex session 规则归 rules-session-lifecycle
---
# Aura-Omni 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/aura-omni/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor, serving；created: 2026-09-23；updated: 2026-09-23
- 来源（sources）：PR #7633；vllm_omni/model_executor/models/aura_omni/duplex/plugin.py；vllm_omni/model_executor/models/aura_omni/duplex/history.py；vllm_omni/model_executor/models/aura_omni/duplex/data_plane.py；vllm_omni/model_executor/models/aura_omni/duplex/capabilities.py
  - vllm_omni/model_executor/models/aura_omni/pipeline.py；vllm_omni/model_executor/stage_input_processors/aura_omni.py；vllm_omni/engine/duplex/session/runner.py；vllm_omni/config/environment_variable_inventory.py；vllm_omni/deploy/aura_omni.yaml
  - examples/online_serving/aura_omni/aura_omni_duplex_smoke.yaml；docs/user_guide/examples/online_serving/aura_omni.md；tests/engine/duplex/test_session_runner.py；tests/model_executor/stage_input_processors/test_aura_omni.py
  - tests/model_executor/stage_input_processors/test_aura_omni_duplex_history.py；tests/model_executor/models/aura_omni/duplex/test_aura_plugin_contract.py；tests/config/test_environment_variables.py
- 置信度（confidence）：high
- 只有 `AURA-<数字字母>` 是可审计规则 ID。共享 duplex serving 见 [[rules-session-lifecycle]]（Serving session lifecycle）；Stage2–3 async codec／decoder 合同见 [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Qwen3-TTS Q3TTS-3a…），**本页不重写 codec**。
- AURA-1e 因 Omni 尚未接线 Native 同名旋钮，单独视为 medium 证据强度。

### Direct 代码快速入口

| PR / 审查信号 | 规则 | 第一批源码 |
|---|---|---|
| 四段拓扑、`async_chunk`、默认 vs duplex yaml | AURA-1a | `pipeline.py::AURA_OMNI_PIPELINE`；`deploy/aura_omni.yaml`；`examples/online_serving/aura_omni/aura_omni_duplex_smoke.yaml` |
| Stage1 投影不消费 TTS | AURA-1b | `duplex/plugin.py::{project_intermediate_output,decide_output}` |
| 投影后仍 stash Stage1 metrics | AURA-1c | `engine/duplex/session/runner.py::{on_stage_output,_stash_stage_metrics}`；`tests/engine/duplex/test_session_runner.py::test_projected_stage1_metrics_reach_the_spoken_audio_event` |
| barge-in fence／draining abort | AURA-1d | `runner.py` barge-in／`older_abort_ids`；`duplex/capabilities.py` |
| 入史三 case／裁剪 default／断线清 store | AURA-1e | `duplex/history.py::{begin_user_turn,commit_turn,prune,render_prefix}`；`duplex/history.py::drop_session_history`；`tests/.../test_aura_omni_duplex_history.py` |
| silent stop id 家族 | AURA-1f | `duplex/plugin.py::AURA_SILENT_TOKEN_ID` |
| history 单一写入者 | AURA-1g | `plugin.py::commit_model_context`；`aura_omni.py::asr2aura`（只 `begin_user_turn`） |
| `prompt_mm` pad 与 video 对齐 | AURA-1h | `aura_omni.py::asr2aura`／`_aura_prompt`；`history.py::render_prefix`／`retained_videos` |
| `VLLM_AURA_*` inventory | AURA-1i | `environment_variable_inventory.py`；`tests/config/test_environment_variables.py` |

### [AURA-1a] 四段组合管线不得把 AURA 当成单 stage 模型

- 触发：注册、部署或审查 `aura_omni` / AURA 语音助手入口。
- 强制：拓扑为 Stage0 Qwen3-ASR → Stage1 AURA Thinker → Stage2 Talker → Stage3 Code2Wav。家族桥 `asr2aura`／`aura2tts`；尾段复用 qwen3_tts。Realtime duplex 入口 `/v1/realtime?duplex=1` + `AuraDuplexPlugin`。
- 强制：`deploy/aura_omni.yaml` 默认 **`async_chunk: false`**。Duplex 必须用 `aura_omni_duplex_smoke.yaml`（或等价）且 **`async_chunk: true`**。
  - Stage2→3 async delta／decoder 生命周期合同跟 [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Q3TTS-3a）／[[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Q3TTS-3b），本规则不另写 codec。
- 注意：`AURA_OMNI_PIPELINE.model_arch="Qwen3ASRForConditionalGeneration"` **不在** Omni `_OMNI_MODELS`，依赖上游 vLLM 模型表合并；Stage1 `AuraQwen3VLForConditionalGeneration` 才在 Omni 表内（仍成立，非已过时）。
- 验收：in-tree — pipeline／deploy 展开四段；duplex smoke yaml 含 `async_chunk: true`。**未证明** — 本条不宣称 AURA duplex 音质或 GPU E2E 已绿（MiniCPM duplex E2E 不证明 AURA）。^[PR #7633]

### [AURA-1b] Stage1 中间投影不得消费 TTS 路径

- 触发：修改 `project_intermediate_output`、`decide_output`、或 runner 对 projected stage 的消费／截断。
- 强制：Stage1 `project_intermediate_output=True`：文本可投影到 WS，**不 consume、不截短** Stage2／3。Silent 走 `decide_output`。
- 验收：in-tree — `tests/model_executor/models/aura_omni/duplex/test_aura_plugin_contract.py`（投影／silent 决策）。**未证明** — 实权重多轮音质。^[PR #7633]

### [AURA-1c] 投影的 Stage1 仍必须 stash engine stage metrics

- 触发：修改 `on_stage_output`／`_stash_stage_metrics`，或 Stage1 TTFT／TPOT 报表路径。
- 强制：`project and not consume` 时仍 `_stash_stage_metrics`。
- 验收：in-tree — `test_projected_stage1_metrics_reach_the_spoken_audio_event`。^[PR #7633]

### [AURA-1d] barge-in 必须清理 cancel fence，并仍 abort 旧 draining TTS

- 触发：修改 AURA／共享 runner 上与 AURA concurrent turn 相关的 barge-in、`cancel_fence`、`abort_ids`、资源释放。
- 强制：当前 cancel fence 完整 cleanup（`abort=True` 弹 `request_states`）；draining 旧 Stage2／3 仍 abort；资源释放只用 **`older_abort_ids`**（不在本次 `cancelled_ids` 内），避免误 release 新 turn。
- 验收：in-tree — duplex session runner barge-in／stale-epoch 相关 CPU 测试。**未证明** — 多模型 draining 交互若红 MiniCPM step，应开 serving 规则，不扩写本 ID。^[PR #7633]

### [AURA-1e] SessionHistory 入史三 case + Native 默认裁剪（medium）

- 触发：修改 `history.py`、`commit_model_context`、vision-follow／proactive 入史，或暴露 history 长度旋钮。
- 强制（commit 三 case，互斥）：
  1. 空 transcript + **有 clip** + silent → **入账**，占 video 名额；
  2. 空 transcript + **无 clip** + silent → **整轮不入**；
  3. **prune 后**（video 已剥、user 仍空、assistant silent／空）→ 才 **成对删除**。成对删除是 prune 后果，不是 commit「silent VF 不入史」。
- 强制：两帧→一轮 video、单一 `<|video_pad|>`。
- 强制：裁剪 **默认** 对齐 Native `MAX_VIDEO_ROUNDS`／`NUM_VIDEO_ROUNDS_TO_REMOVE`／`MAX_ROUNDS_CONVERSATIONS`（默认 45／30／999）。数字是 default。Omni 字段已有、**旋钮尚未接线**；日后接线必须镜像同名语义。
- 强制：断线／close 调用 `drop_session_history(session_id)` 清 `_STORE`。
- 验收：in-tree — `test_aura_omni_duplex_history.py`、plugin contract 的 history／`drop_session_history`。**未证明** — env／config 旋钮接线（尚未实现）。^[PR #7633]

### [AURA-1f] `<|silent|>` stop id 必须与 checkpoint 家族一致

- 触发：配置 silent／stop token，或 v1↔v2 checkpoint 混用。
- 强制：duplex plugin **v1** `AURA_SILENT_TOKEN_ID = 151669`（companion 如 `151645`）；AURA_v2 streaming 用另一套（公开约定 `248070`／`248046`），不得把 v1 常量抄到 v2 serve。
- 验收：in-tree — plugin stop／silent 检测单测。**未证明** — 全权重矩阵。^[PR #7633]

### [AURA-1g] SessionHistory 单一写入者

- 触发：修改 `commit_model_context`、`aura2tts`、`aura_tts_partial`、或任何 Stage1 history commit。
- 强制：仅 `AuraDuplexPlugin.commit_model_context` → `commit_turn` 写 assistant。`asr2aura` 只 `begin_user_turn`；`aura2tts`／sentence-TTS partial **禁止**再 commit（含已删的 `commit_duplex_stage1_history`）。
- 验收：in-tree — history／plugin contract 角色交替。^[PR #7633]

### [AURA-1h] `prompt_mm` 的当前 user pad 数必须与当前 clip 对齐

- 触发：修改 `asr2aura` 的 `history_prefix`／`prompt_mm`／`multi_modal_data["video"]`，或 `render_prefix` 的 pad 布局。
- 强制：`history_prefix` 已为每个仍带像素的历史 clip 写一个 `<|video_pad|>`。传给 `_aura_prompt` 的 `prompt_mm` 对**当前 user 串**只带当前 clip（有则 `[current]`，无则去掉 video）→ 当前串只再加 **一个** pad。引擎侧 `multi_modal_data["video"]` 可为 `retained + current`，但不得把全列表双计进当前 user 字串 pad。
- 验收：in-tree — `test_aura_omni*`／duplex history 覆盖「有 prior 时当前串仍单 pad」。^[PR #7633]

### [AURA-1i] 新增 `VLLM_AURA_*` 必须进入 inventory 与 snapshot 计数

- 触发：引入或重命名 AURA 专用环境变量（如 `VLLM_AURA_SENTENCE_TTS*`）。
- 强制：登记 `environment_variable_inventory` 模型内化集，并同步 `tests/config/test_environment_variables.py` 分类计数。
- 验收：in-tree — inventory／snapshot 计数测试绿。^[PR #7633]

## 决策与踩坑

- [AURA-1a] 禁止：单 stage 化 AURA；把 MiniCPM native duplex／Code2Wav window／`generate_chunk=26` 合同抄进本页；自写一套 Stage2–3 codec 规则替代 Q3TTS。
- [AURA-1b] 禁止：投影即 consume；listening 误开 spoken audio turn。
- [AURA-1c] 禁止：只在纯 pass-through stash；把 Stage0 指标标成 Stage1。
- [AURA-1d] 禁止：`release_resources_for_request_ids(全部 abort_ids)`；去掉 draining abort；把本条写成 MiniCPM native duplex／共享 serving 的通用修法（共享 lifecycle 进 serving 组件页）。
- [AURA-1e] 禁止：把「成对丢弃」写成 commit 硬核；把 45／30 写成不可配置合同；每帧独立 history 轮。
- [AURA-1f] 禁止：错 id → silent 不 stop → pad 到 `max_tokens`。
- [AURA-1g] 禁止：`[user, assistant, assistant]`；partial 入史。
- [AURA-1h] 禁止：`pad 个数 ≠ 当前应绑定 video 项` → 错位／crash。
- [AURA-1i] 禁止：只读 env 不登记。
