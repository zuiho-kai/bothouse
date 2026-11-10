---
name: minicpm-o-4-5-rules-3
description: "MiniCPM-o 4.5 规则（三）：MCPMO-4d async chunk 快照替换清理旧音频（PR #6406）、5a accuracy 与 duplex perf 证据绑定协议硬件和实际 gate（PR #5524、PR #6079）、5b online serving CI 区分 chunk 模式与 duplex fixture（PR #6056、PR #6828）、2e audio_feature_lens 的 ragged 切片维（PR #7071）、2f audio_embeds 注册为 audio（PR #5730）、2g structured content 无分隔符拼接（PR #7344）、3f Thinker forward 返回裸 hidden_states（PR #7517）"
metadata:
  scope: 只收 MCPMO-4d/5a/5b/2e/2f/2g/3f；快速入口与 MCPMO-1a 至 2b 归 minicpm-o-4-5-rules-1，MCPMO-2c 至 4a 归 minicpm-o-4-5-rules-2，duplex 其余规则归 rules-duplex-1 与 rules-duplex-2
---
# MiniCPM-o 4.5 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[minicpm-o-4-5-rules-1]]；第 2 部分 [[minicpm-o-4-5-rules-2]]
- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-07-20；updated: 2026-09-22
- [MCPMO-4d] async chunk 快照替换必须清理旧音频
  - 触发：MiniCPM-o 4.5 native duplex 遇到重复 `turn_end` 或新的 Code2Wav async segment。
  - 强制：`tts2code2wav_async_chunk` 对重复终端边界发送 ready empty replacement；Code2Wav payload 声明替换 marker；当前 `codes.ref` 等 sibling 可继续使用，上一段 `codes.audio` 必须丢弃。
  - 验收：覆盖 terminal→empty duplicate、audio+ref、scheduled-new/cached runner、prompt replacement 和 `OmniNPUModelRunner` 继承路径；断言旧 audio 消失且边界被标记为 ready。 ^[PR #6406]
- [MCPMO-5a] accuracy 与 duplex perf 证据必须绑定协议、硬件和实际 gate
  - 触发：修改 MiniCPM-o 4.5 Daily-Omni、Seed-TTS、realtime duplex 数据集/客户端、benchmark 配置或 CI lane。Daily-Omni 合同是 `minicpm-interleave`、temperature 0、文本输出、512 tokens，使用 TTS template 与 1 FPS/最多 128 帧 media 配置，准确率下限 0.78；simplex Seed-TTS 同时请求 text+audio，WER 上限 0.05。
    - duplex Seed-TTS 走 `openai-realtime-tts`，每 session 四轮、50 prompts，并要求每轮恰好一个音频 response。
  - 强制：多轮数据只把连续有效 row 按 `turns_per_session` 分组，沿用首行 reference audio/text；多轮必须使用 realtime backend，在同一 session 依次发送 item/response create 并做 playback ACK。客户端按轮从共同 measurement origin 单调记录首 text TTFT、首 audio TTFP、逐轮请求起点到末音频的 RTF；PCM 与这些 metrics 必须展开回逐轮 WER 样本。
    - `native_duplex=False` 必须显式走 chat fallback，且在构造 `ChatCompletionRequest` 前移除 `minicpmo45_native_duplex`。
  - 证据边界：accuracy case 标为 H100 或 A3、每 case 一卡，但 nightly 可为第二张卡上的 WER evaluator 分配两卡资源；资源 allocation 不等于模型 stage 用卡数。最终 simplex/duplex perf 是单卡 H100，baseline 只有 H100 bucket，runner 只检查完成数，duplex 再检查四轮 audio count；没有性能阈值 consumer，故 baseline、TTFT/TTFP/RTF 只构成测量 artifact，不能证明回归或 A3 性能。
    - ready 的 trimmed simplex config 仅保留 concurrency 1/4 与 prompts 10/40；CUDA `h100_1`、NPU `a3_npu_2` 都运行同一 JSON，但 JSON 的 case cardinality 是一张卡且只含 H100 baseline。该 config 与 runner 没有 threshold consumer；因此 “ready gate” 只表示请求完成 gate 已接线，不是性能 regression threshold，也不能单凭配置存在声称 H100/A3 实测通过。
  - 验收：固定上述 collection、阈值、逐轮 cardinality 与 fallback；分别故障注入缺轮、重复音频、非单调时间和错误 backend。PR 报告的 Daily-Omni 78.53%、Seed-TTS WER 0.0332/0.0255 只能绑定其日志环境：数据/模型 revision 未固定，Daily 首次受损坏 decord 失败后重跑，kernel warmup 另有未提交 patch，证据脚本还吞掉 step failure，且把版本号写作 commit。
    - 因而不能从这些数字声称 merge target 的可复现质量/性能通过。^[PR #5524] ^[PR #6079]
- [MCPMO-5b] online serving CI 必须显式区分 chunk 模式与 duplex fixture 语义
  - 触发：修改 MiniCPM-o 4.5 online serving、expansion、native duplex 测试或其 deploy helper。
  - 强制：core online suite 显式启动 `--async-chunk`，并把 bounded sampling 保持在 fixture-local 派生配置；expansion suite 以两个独立 parametrization 覆盖 `--no-async-chunk` 与 `--async-chunk`。不得用 deploy 默认值或参数 ID 猜实际模式。
    - audio→text+audio case 若要稳定验证 TTS，必须显式请求 text/audio modalities、`use_tts_template=True`、`enable_thinking=False` 并断言目标关键词。
  - 对 `test_image_to_text_audio_001` 的 content-consistency oracle，test-local `_CI_DEPLOY` 只把 Stage-1 Talker `temperature` 设为 `0.0`；shipping deploy/runtime 保持不变。该设置不证明 deterministic audio、所有 flake 已消除或生产 sampling 修复；已放弃的 production sampling-mask 工作不属于本合同。^[PR #6828] ^[issue #6815]
  - duplex fixture 保留 Talker `max_model_len=4096`，但不覆盖三个 stage 的 KV sizing，不另造 eager-only server；protocol smoke 与 response tests 使用同一 server config。response-required 多轮测试每轮重放同一 active-speech window，避免较短的 mid-utterance slice 合法地产生 LISTEN。
    - reference audio 先接受本地 checkpoint 目录（包括绝对 `MODEL` 路径），不存在时才从本地 HF cache 解析。
  - 验收：至少收集 core async、expansion sync/async、duplex protocol 与 advanced session cases，并记录实际执行结果及硬件；local checkpoint 与 cache fallback 各一例。changed tests、marker 或 parametrization 只能证明 collection 意图；没有实际 runtime 结果时，不能声称 CUDA/NPU、音频质量或 flake 已闭环。^[PR #6056]
    - `duplex_camera_frames()` 必须解包 `_video_frames_from_file()` 的 `(base_frames, stacked_frames)`，只返回 flat base-frame list；这是 CPU fixture input-shape contract，不改变 runtime camera stacking、H100 E2E 或模型行为。^[PR #6757]
  - soft-interrupt 的 `response-required` artifact oracle 把“commit 前 response 后的 LISTEN”锚定为 `input_audio_buffer.committed` **严格之前**最后一个 `response.done`，并要求该 LISTEN 严格落在两者之间；不能用全局最后一个 done，因为 follow-up 可在 commit 后继续 drain residual model unit。
    - `listen_after_last_done` 仍独立锚定全局最后一个 done，故 residual fixture 还必须在该 late done 后有 LISTEN。`model-policy` 模式仅要求 commit 前已创建的完成 audio response，不采用该完整 sandwich。验收用事件序列 `r1.done → LISTEN → r2.created → … → commit → r2.done → LISTEN`，断言 `ok` 与两个 listen predicates；
    - 这只是 summarizer/test oracle，未改变 ACK、runtime interrupt、barge-in detection 或生产响应时序。A100 的已知失败仍是 `enough_responses=false`（barge-in 漏检），不是本 PR 修复范围；H100-class 测试计划也不是跨硬件实时性证明。^[PR #6772] ^[Issue #6716]
- 共享 bridge/batch 规则见 [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（Model Executor rules）；公开入口完整性见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails）。
- [MCPMO-2e] audio_feature_lens 的切片维必须允许跨样本 ragged
  - 触发：修改 `MiniCPMOAudioFeatureInputs.audio_feature_lens` 的 `TensorShape`、encoder batch 合批，或 `get_audio_hidden_states`/`get_audio_embedding_streaming` 对 per-audio lens 的消费。
  - 强制：`audio_feature_lens` 声明 `TensorShape("bn", "s", dynamic_dims={"s"})`，允许同一 encoder batch 内不同音频有不同 slice 数（如 >30s 与 ≤30s）；消费侧继续 `hstack` + 按 `len(audio_feature_lens_raw[i])` 逐音频处理。仅放松 `"s"`；`"bn"` 与其他非动态维仍严格校验。
  - 验收：直接构造混合 slice 数（如 3 vs 2）与同 slice 数两例，断言均可构造且不改变既有同长路径。^[PR #7071]
- [MCPMO-2f] `audio_embeds` 必须注册为 audio，并以嵌入条数定 placeholder
  - 触发：修改 MiniCPM-o 4.5 的 `MiniCPMOAudioEmbeddingItems`、`_get_prompt_updates`，或 OpenAI `audio_embeds` 内容部分。
  - 强制：embedding items 的 `modality` 必须是 `"audio"`（不得从 image 类 copy 成 `"image"`）。单条 `audio_embeds` 张量为 `(s, h)` 时，placeholder 长度取 `len(single_audio_embeds)` / 前导维 `s`，再经 `get_audio_len_by_num_chunks`；不得 `sum(map(len, …))` 把 hidden size 累进 token 数。
  - 验收：modality 断言为 audio；经真实 `_get_prompt_updates` 覆盖 1s/3s/30s 与不同 `h`，placeholder 只随 `s` 变化。^[PR #5730]
- [MCPMO-2g] MiniCPM-o structured content 必须无分隔符拼接，对齐 native omni chat
  - 触发：修改 MiniCPM-o 4.5 chat template、online serving `--chat-template`、image/audio/video 多模态 content parts，或 `minicpmo45_native.jinja` 打包。
  - 强制：structured content 按 native `chat(omni_mode=True)` 直接拼接 text/media parts，不插入额外换行/分隔符；显式 text 空白保留。模板须作为 package data 发布，online/recipe 显式启用并设 `chat-template-content-format=openai`；image→speech 一致性用例保持 image-first。
  - 验收：CPU 模板回归覆盖 structured parts；online image-to-text-audio 一致性在目标硬件通过。^[PR #7344]
- [MCPMO-3f] Thinker forward 必须返回裸 hidden_states tensor
  - 触发：修改 `MiniCPMO45OmniLLMForConditionalGeneration.forward`、Omni wrapper 的 shape 归一化，或 AR/`GPUModelRunner` 对 thinker 输出的消费。
  - 强制：thinker `forward` 只返回裸 `hidden_states` `torch.Tensor`；`inputs_embeds is None` 时只构建一次 embeddings。wrapper 仅当 `ndim==3 and shape[0]==1` 时 squeeze batch 维，得到 `(seq_len, H)`，并保留 2D `(1, H)` decode 行。
  - 验收：断言返回类型/值、单次 embedding 构建，以及 `(1,H)/(N,H)/(1,1,H)/(1,N,H)` 归一化。^[PR #7517]

## 决策与踩坑

- [MCPMO-4d] 禁止：重复边界返回未就绪的 control-only 更新；让旧 terminal audio 与新 snapshot merge/replay；把该模型的替换语义外推给未 opt-in 模型。
- [MCPMO-5a] 禁止：把结果 artifact 中存在 baseline 描述成 active performance gate；把 PR 的“双卡”文字覆盖到最终单卡 lane/YAML；或从 H100 bucket 外推 A3 的性能与阈值。
- [MCPMO-5b] 禁止：把删除测试专用 KV cap 解释成生产 deploy 资源变更；把移除 assertion 的 JSON failure message 解释成行为放宽；或在输入与 oracle 已改变后声称复现并修复原始 mixed-input audio-similarity 故障。
- [MCPMO-2e] 禁止：因 list 内 lens 长度不一致在 schema 层抛 `inconsistent shapes` 并拖垮 Stage-0 engine；把 ragged 误当成非法输入。
- [MCPMO-2f] 禁止：以 `modality="image"` 注册 audio embedding；让 `(10, 4096)` 请求约 40960 个 placeholder 并撞 `max_model_len`。
- [MCPMO-2g] 禁止：依赖通用 string-content 渲染在 media 与 text 间加换行；只改测试不改 shipping template/package data。
- [MCPMO-3f] 禁止：返回 `(text_inputs_embeds, hidden_states)` tuple；用 `added_batch_dim` 误 squeeze 单 token 的 `(1, H)`；让 runner 用 `[0]` 把 embeddings 当最终 hidden 算 logits。
