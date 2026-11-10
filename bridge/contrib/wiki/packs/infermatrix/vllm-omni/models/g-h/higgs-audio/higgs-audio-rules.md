---
name: higgs-audio-rules
description: "Higgs-Audio 规则 HIGGS-1a、HIGGS-2a、HIGGS-FIXTURE-1a、HIGGS-3a：V3 codec sampling 与 decode state 按 request 所有，voice-clone 负值 sentinel 换成 <|tts|> filler 并传 audio_placeholder_positions，绕过构造器的 state fixture 显式建依赖，共享 reference-code encode 用 asyncio.shield 屏蔽取消（PR #6422 / #7065 / #8426 / #7076）"
metadata:
  scope: 只收 Higgs-Audio V3 的四条 HIGGS-* 规则与信号表；MRv2 audio state 的 HIGGS-MRV2-* 归 higgs-audio-rules-mrv2-audio，谱系结构与流式窗口归 higgs-audio-architecture
---
# Higgs-Audio 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/higgs-audio/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-05；updated: 2026-10-06
- 来源（sources）：PR #8426；PR #6422；PR #7065；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_talker.py；vllm_omni/model_executor/models/higgs_audio_v3/higgs_audio_v3_tokenizer.py；vllm_omni/worker/gpu_model_runner.py
  - tests/entrypoints/openai_api/test_serving_speech.py；tests/model_executor/models/higgs_audio_v3/test_higgs_audio_v3.py；tests/e2e/online_serving/test_higgs_audio_v3.py；PR #7076
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| request RNG/decode state | `HIGGS-1a` |
| voice-clone sentinel、placeholder positions 或 chunked prefill | `HIGGS-2a` |

### [HIGGS-1a] V3 codec sampling 与 decode state 必须按 request 所有

- 触发：Higgs-Audio V3 seeded sampling、八 codebook flatten/compaction、GPU decode delay 或 replacement request。
- 强制：每个 logical request 的八个 contiguous codebook rows 必须在一次 multinomial 中使用该 request row 的 `SamplingMetadata.generators[req_idx]`；generator 由 vLLM request lifecycle 提供，talker 不按 request ID 另建 RNG。`has_codes`、last codes、delay/EOC countdown 与 done state 必须由 request ID 映射到 pool row；
  - reorder/condense 前保存旧 row、再恢复新顺序。finished ID 先释放映射，slot 复用时重新初始化；即使 `previous_req_ids == req_ids`，当前 ID 缺 pool entry 也必须重同步。
- 验收：覆盖同 seed 单独/带邻居 batch、异 seed、reorder/condense 连续性、finish、distinct-ID slot reuse 与 same-ID replacement，并验证 runner 把 live `input_batch.req_ids` 传入 decode metadata。ROCm 配置测试只证明 V3 Stage 0 的 `TRITON_ATTN` overlay/collection；作者报告的单次 MI300X case 不构成通用确定性、音质、吞吐或跨平台支持。^[PR #6422]

### [HIGGS-2a] voice-clone 占位语义必须在词表校验边界外显并保持位置对应

- 触发：修改 Higgs-Audio V3 的 voice-clone prompt、`ref_audio` metadata、engine token validation、prefill/chunked-prefill embedding substitution，或 offline/online prompt producer。
- 必须：仅在模型本地 `build_prompt` 中保留负值 sentinel；每个提交给 vLLM 的 token ID 必须属于 tokenizer vocabulary。adapter 必须同时把 sentinel 替换为不触发 audio-continuation sampler 状态的有效 filler（当前为 `<|tts|>`），并记录按 prompt 顺序排列的绝对 `audio_placeholder_positions`。
  - online serving 与 offline example 都必须传递这些位置和 delay-pattern reference codes；talker 必须在 transformer layers 前按每个 request span 的 absolute positions 选择对应 code rows，因而 full 与 chunked prefill 都能注入正确 embedding。仅供绕过 engine validation 的 legacy internal caller 保留 `-100` substitution fallback。
- 验收：prompt smoke 断言 engine IDs 全部非负、每个 placeholder filler 为 `tts_id` 且不为 `audio_id`，并保留 position metadata；单元测试分别证明完整 prefill、只含 reference span 一部分的 chunked prefill 和 legacy `-100` caller 注入正确 code rows；serving smoke 证明相同路径重写时 cache salt 仍变化。
  - H100 voice-clone E2E 未在该 PR 的 lanes 运行，不能把 unit coverage 宣称为 end-to-end 证据。^[PR #7065]

### [HIGGS-FIXTURE-1a] 绕过构造器的 state fixture 须显式建立被测路径依赖

- 触发：修改 Higgs V3 `make_state`、以 `object.__new__` 构造的 model state，或被该替身调用的 `add_request`/eager-MTP 路径。
- 强制：根据实际被测调用初始化 fixture 的全部依赖；绕过构造器时显式创建 `_stream_pos` 和与该 state 绑定的 `EagerMTPState(state)`，不能假设正常 `__init__` 已执行。
- 验收：运行 `tests/model_executor/models/higgs_audio_v3/test_mrv2_state.py` 的 CPU case，并让真实被测方法访问这些依赖；初始化缺失时回归应失败。^[PR #8426]

### [HIGGS-3a] 共享 reference-code encode 必须屏蔽请求取消并以 task 身份退休

- 触发：修改 Higgs-Audio V3 `_resolve_higgs_audio_v3_ref_codes`、artifact-keyed inflight map。
- 强制：同一 `artifact_key` 的 cold encode 只创建一个共享 `asyncio.Task`；creator 与 waiter 都必须 `await asyncio.shield(task)`，请求取消不得取消共享 encode。inflight 条目只能在 task `done_callback` 里用 identity guard 弹出；未取消任务须 `t.exception()` 消费失败以免 “exception never retrieved”。成功路径仍 clone 后返回，cache 写入保持既有合同。
- 验收：确定性 CPU 回归覆盖 creator+waiter 取消后幸存者仍从同一 encode 完成、全取消后失败路径无 loop exception handler 且 inflight 清空；与 MOSS single-flight 生命周期对齐但不改 cache key/容量/API。^[PR #7076]

## 决策与踩坑

- [HIGGS-1a] 禁止：共享/global RNG、把一个 generator 按八行独立重采样、按临时 batch row 保存 decode state，或把 finished callback 描述成会清零 tensor（fresh allocation 才初始化）。`transcript_expected_text` 只是在 control-token request 与 spoken reference 不同的测试 helper 中覆盖 assertion，默认取 `input`；它不是 OpenAI request 字段或 runtime 模型语义。
- [HIGGS-2a] 禁止：把负 sentinel 直接送过共享 token validation；用 `<|audio|>` 或任何会触发采样 continuation 语义的 filler；按当前 chunk 的局部索引、token identity 或未对齐的 code row 猜测参考音频位置；只修 online serving 而遗漏 offline producer；删除 legacy fallback 却未迁移其 internal caller。
- [HIGGS-FIXTURE-1a] 禁止：只设置模型/runner mock 就直接访问未建立的 eager state；用作者旧树的 CI 通过排除后续组合树上的 fixture 失配；把 PR 的待运行测试计划说成已通过。
- [HIGGS-3a] 禁止：直接 `await task` 让 caller cancellation 传入共享 flight；在 creator 的 `finally` 里按请求退出撤销 inflight（会让仍在跑的 task 失位并可能重复 encode）。
