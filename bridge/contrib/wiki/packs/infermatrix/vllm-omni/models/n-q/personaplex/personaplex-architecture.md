---
name: personaplex-architecture
description: "PersonaPlex 架构（main @ e788ef6e）：Stage 0 Talker（Helium temporal、depformer、post_sample_talker_mtp hook）与 Stage 1 Code2Wav（Mimi 8 codebooks 解为 24 kHz PCM）、80 ms 1920 samples 帧合同与 17 行 token column、/v1/realtime?duplex=1 unified full-duplex path、duplex_session.max_sessions: 2 容量源、supports_barge_in=false、验证边界"
metadata:
  scope: 只收 PersonaPlex 的 stage 拓扑、帧合同、unified full-duplex 数据流与验证边界；入口速览归 personaplex-overview，可执行门禁归 personaplex-rules-1
---
# PersonaPlex 架构

## 现状

- 以下只描述 `main @ e788ef6e`；入口速览见 [[personaplex-overview]]（index），可执行门禁见 [[personaplex-rules-1]]、[[personaplex-rules-2]]（rules）。

### 模型与 staged pipeline

- Stage 0 `PersonaPlexTalkerForConditionalGeneration`（LLM_AR）包含 Helium temporal、depformer 和 input embeddings；每个 80 ms frame 产生 inner-monologue text 与 audio codebooks。runner 的 model-owned `post_sample_talker_mtp` hook 用本步 sampled text 和 temporal hidden state 生成同 frame codec codes。
- Stage 1 `PersonaPlexCode2Wav`（LLM_GENERATION）用 Mimi 把 8 个 active codebooks 解为 24 kHz mono PCM；两 stage 通过 SharedMemoryConnector async-chunk streaming 连接。Stage 1 默认 eager，因为 decoder 的 host→device copy 不能安全 capture。
- 帧合同固定为 24 kHz、1920 samples、80 ms（12.5 Hz）；17 行 token column 是 text 1、agent audio 8、user audio 8。标准 staged 路径最终输出 audio。

### Unified full-duplex path

```text
/v1/realtime?duplex=1
  → session actor / correlated RPC / DuplexControlPlane
  → resumable Stage 0 → Talker → streaming Code2Wav
  → data-plane projector → audio delta + transcript delta
```

- serving adapter 只拥有 PCM reservation、client validation、capability 和 output cursor；runtime extension 只把一帧 append 映射为 scheduler prompt/metadata/token budget。真实 Mimi encode、voice/persona prefill、delayed frame 和 KV 由 model-owned Stage 0 runtime 管理。
- 每个 `(session_id, incarnation)` 有独立 Stage 0 Mimi encoder；每个稳定 Stage 1 request id 有独立 streaming decoder。finish/abort/close 只释放本 session/request 的状态。
- `duplex_session.max_sessions: 2` 是 engine admission 与两 stage codec pool 的唯一容量源，通过 `duplex_max_sessions` 投影到所有 stage；connector extra 不另设容量。
- capability 在该 pin 明确 `supports_barge_in=false`、不支持 session resume、audio truncate 或 rollback。模型原生同时听说不等于可破坏性回滚的 barge-in 合同。

### 验证边界

- target tests 覆盖 config/pipeline、Stage 0/1 state isolation、frame accounting、mixed sessions、capacity rejection/reuse、cleanup、data-plane delta、standalone lease 和 unified runtime；PR 记录一次 collaborator approval。模型仍是 experimental，且 greedy-only；不要把 PR body 的历史性能数字或 standalone server smoke 当作当前环境的保证。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/personaplex/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, model-executor；created: 2026-09-02；updated: 2026-09-06
- 来源（sources）：PR #4771；docs/design/fullduplex-personaplex.md；vllm_omni/model_executor/models/personaplex/pipeline.py；vllm_omni/deploy/personaplex.yaml
- 置信度（confidence）：high
