---
name: rules-duplex-1
description: "MiniCPM-o 4.5 native duplex 规则（上）：MCPMO-DUPLEX-TILE-1a camera token 预算对齐 image processor 的 tile（PR #8462）、MCPMO-4b session update 拒绝不可重建的上下文（PR #6318）、MCPMO-4c Talker 按 generate_chunk 预算终止、MCPMO-4d auto-response silence continuation 硬上限、MCPMO-4e shipping profile 共服 chat 与 duplex"
metadata:
  scope: 只收 MCPMO-DUPLEX-TILE-1a 与 MCPMO-4b 至 4e；MCPMO-4f 至 4j 归 rules-duplex-2，turn closure 归 rules-duplex-turn-closure
---
# MiniCPM-o 4.5 native duplex 规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-duplex.md` 的第 1/2 部分；第 2 部分 [[rules-duplex-2]]
- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-duplex.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #6318；PR #6346；PR #6404；PR #6458；PR #6619；PR #6630；PR #6678；PR #6626；PR #6767；PR #6821；vllm_omni/deploy/minicpmo_4_5.yaml；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_omni_tts.py；vllm_omni/model_executor/stage_input_processors/minicpmo_4_5_omni.py
  - tests/model_executor/models/minicpmo_4_5/test_talker_batching.py；vllm_omni/deploy/minicpmo_4_5_2gpu.yaml；vllm_omni/deploy/minicpmo_4_5_3gpu.yaml；vllm_omni/deploy/minicpmo_4_5_8x4090.yaml；examples/online_serving/minicpmo/realtime_duplex_demo.py
  - vllm_omni/experimental/fullduplex/client.py；vllm_omni/model_executor/models/minicpmo_4_5/duplex/adapter.py；vllm_omni/model_executor/models/minicpmo_4_5/duplex/session.py；vllm_omni/model_executor/models/minicpmo_4_5/duplex/stage0.py；vllm_omni/entrypoints/duplex/realtime_input.py
  - vllm_omni/entrypoints/duplex/runtime_adapter.py；vllm_omni/entrypoints/duplex/runtime_bridge.py；vllm_omni/entrypoints/duplex/serving.py；vllm_omni/entrypoints/duplex/session_runner.py；vllm_omni/experimental/fullduplex/video_stacking.py；tests/config/test_config_factory.py
  - tests/engine/duplex/test_duplex_deploy_config.py；tests/e2e/online_serving/helpers/minicpmo_4_5_duplex.py；tests/e2e/online_serving/test_minicpmo_4_5_duplex_expansion.py；tests/entrypoints/openai_api/test_duplex_handler.py；tests/examples/test_minicpmo_realtime_duplex_simple_demo.py
  - PR #6529；vllm_omni/entrypoints/duplex/protocol.py；vllm_omni/entrypoints/duplex/realtime_state.py；tests/entrypoints/openai/test_duplex_protocol.py；PR #6799；PR #7416；PR #8462；PR #8007
- 置信度（confidence）：high
- [MCPMO-DUPLEX-TILE-1a] camera token 预算必须与真正 image processor 的 tile 一致
  - 触发：修改 native duplex vision tile、first-append prompt reservation 或 processor lookup。
  - 强制：从 Stage 0 实际 checkpoint 的 image-processor config 读取正整数 `scale_resolution`，以平方作为 tile pixels；使用 `ImageProcessingMixin.get_image_processor_dict(..., local_files_only=True)` 的查找顺序，nested `processor_config.json.image_processor` 优先，否则读取 `preprocessor_config.json`。
    - 不从受 `hf_overrides` 影响的 `hf_config.slice_config/image_size` 推断 processor tile。
  - 强制：无可读 processor config、非法 side 或 bool 时保留 `None`，继续 sliced-count reservation；不访问网络补取。一个 append 的 vision token count 只计算一次，first-unit 分支复用它；独立 audio budget 与公开 `duplex_scheduler_token_budget` 合同保持一致。
  - 验收：processor/config tile 故意不一致、nested config 优先、非法/缺失本地配置、首 append 仅一次 base-frame decode 和 audio budget 不变；500×500 的已切片 pair 在 processor side448/config side560 时仍保留264 tokens，而不是132。^[PR #8462]
- [MCPMO-4b] native duplex session update 必须如实拒绝不可重建的上下文
  - 触发：运行中更新 MiniCPM-o native duplex 的 `instructions`/native-mode。
  - 强制：MiniCPM-o 的 changed `instructions` 由 runtime adapter 返回 `instructions_update_unsupported`，不能 ACK 成 `session.updated`；serving 层也在 native context 已锁时拒绝 changed instructions。`native_context_locked` 仅在真实 native append 成功后设置，buffered、deferred 或失败 append 不锁。
    - 若创建时已给出 `minicpmo45_native_duplex`，后续改变该值返回 `native_duplex_mode_update_unsupported`。共享 helper 保持“值改变即错误”的 adapter 边界一致；PersonaPlex 的对应 persona/voice 合同见 [[personaplex-rules-1]]（PPLEX-1c；源锚点 #pplex-1c-persona-与-voice-在-session-创建后不可变）。
  - 若以后改为允许任何会影响 `prefill_slots` 或 first-append context-token reservation 的更新，必须先重算并验证派生 reservation，再 ACK 并原子提交；资源不足时不得留下部分 mutation。这是现有拒绝行为所保留的安全边界，不是本提交新增的可变配置能力。
  - 验收：覆盖 post-lock changed/unchanged instructions、短 buffer 后 update 再 commit与 mode flip；拒绝时不发 runtime `session.update` signal，而 commit 仍可 flush 已缓冲音频。重建 first-append token/prefill reservation 后允许变更是 PR body 提到的后续 GPU-validated 工作，非本提交已实现语义。 ^[PR #6318]
- [MCPMO-4c] native duplex Talker 必须按 generate_chunk 预算终止
  - 触发：修改 MiniCPM-o native duplex Talker 的 `generate_chunk`、codec EOS 或请求级音频状态。
  - 强制：每个 native duplex 请求按一次 chunk 的 26 个采样管理状态；adapter 只在 duplex runtime config 将 Talker `min_tokens` 设为 0，保留 chat YAML 的 whole-utterance floor；turn 边界 `min_tokens=0`，中间 chunk `min_tokens=max_tokens=26`，已转发 25 帧后强制下一个采样为 EOS，仅把非 EOS code 交给 Code2Wav。
  - 验收：覆盖 prefill 边界元数据、step 24/25 的 mask/force EOS、runtime Stage 1 `min_tokens=0`、chat sampling control、simplex 不误触发以及多请求 delta/finished 对齐。^[PR #6346] ^[PR #6619]
- [MCPMO-4d] auto-response silence continuation 必须有硬性终止与所有权 fence
  - 触发：修改 MiniCPM-o native duplex auto-response 的 silence continuation、`force_listen`、LISTEN 事件或 response close。
  - 强制：auto-response 以 64 个 one-second continuation unit 为上限，普通 response 保持 8 个单位上限；前 63 个 auto payload 保持既有语义，第 64 个请求 `force_listen`。边界 LISTEN 不得再走 non-terminal auto reschedule，而必须结束当前 response 并保留 resumable Stage-0 request；
    - 模型忽略提示时，下一次 continuation 尝试不得 append，而发出 `response.listen` 与恰好一个 `response.done`。fallback 在跨 `send_json` await 前后必须同时验证 epoch 和 active response owner，防止 barge-in 打开的新 response 被旧 response 的终止路径关闭。
  - 验收：覆盖 64 次 append、最后一次 `force_listen`、第 65 次无 append 且仅一次 terminal protocol pair、边界 model LISTEN 的 terminal path，以及 LISTEN send 期间 barge-in/new epoch 不被 stale fallback 关闭。单元覆盖证明协议与 race fence；PR 的 H800 lifecycle run 混合了其他改动且有 `audio_clipped` artifact，不作为音频质量或性能证据。^[PR #6630]
  - 已知边界：terminalization 保留 data-plane request，而 `active_response_id is None` 时不走 model-turn owner guard；同一 request/turn 的 late SPEAK 仍可能新建第二个 response。该 reviewer nit 在本提交中未修复，不能把“恰好一个 `response.done`”外推成后续迟到事件也被永久抑制；若补齐，需显式拒绝 bound 后的 late SPEAK 并覆盖回归。^[PR #6630]
- [MCPMO-4e] shipping profile 必须共服 chat 与 native duplex
  - 触发：修改任一 `minicpmo_4_5*.yaml`、duplex session placement 或 Stage 1 Talker 默认/运行时采样参数。
  - 强制：所有 shipping profile 设置 `session_mode=duplex`；shipping profile 省略 `active_stream_window`，默认 0 的 unlimited path 见 MCPMO-4j。PR #8007 合并的 default profile 将 `duplex_session.max_sessions` 与 Stage 0/1/2 `max_num_seqs` 提升至 16，2gpu/3gpu profile 仍为 4；
    - 8×4090 的 stage capacity 与 default session capacity 保持 1。replica overlay 从 base 继承这些字段。YAML 保留 chat 的 Stage 1 `min_tokens=50`，native duplex adapter 只在 session runtime config 覆盖为 0；AR stage 保留默认 async scheduler。
    - default Talker 的 KV budget 为 4 GiB，因为 physical KV preemption 后的增量 full-attention replay 尚不支持，不能仅增加 admission 而忽略实际 KV 容量。^[PR #6767] ^[PR #7416] ^[PR #8007]
  - 验收：展开四份 base profile 及三个 replica overlay，断言全部 duplex-enabled、窗口与各 profile 的 session/stage capacity 正确；同一 server 分别验证 `/v1/realtime?duplex=1` 和 chat，前者 Stage 1 看到 `min_tokens=0`、后者仍看到 `50`。删除旧 overlay 是部署文件名迁移，外部显式引用必须同步更新。
    - PR #6767 的 L20X concurrency=4 观察只证明该精确 profile/workload 的 first-packet admission，不构成通用吞吐、延迟或硬件保证。^[PR #6458] ^[PR #6619] ^[PR #6767]
  - admission/expiry E2E probe 必须从实际启动的 deploy YAML 经 `load_deploy_config(...).duplex_session.max_sessions` 取得 admission limit，不能保留硬编码容量或在 test helper 重做 YAML merge/default/validation；这样 base-config overlay 与未声明 `duplex_session` 时的 server 语义保持一致。
    - CPU 守卫至少覆盖 shipping base 的显式容量、未声明字段的 default，及一个从 base 继承容量的 overlay；live probe 再验证在该 limit 后收到 capacity error。^[PR #6678]

## 决策与踩坑

- [MCPMO-DUPLEX-TILE-1a] 禁止：用 config.json 的较大 tile 缩减真实 processor 的 sliced token 预算；把 missing config 视为零 vision tokens；为相同 append 重复 decode base frame。
- [MCPMO-4b] 禁止：在 Stage0 已用旧 context 初始化后 ACK 变更；buffer/defer/reject append 提前锁定；用 mode flip 绕过锁。
- [MCPMO-4c] 禁止：只依赖 YAML `max_tokens` 维持 turn 边界；改变 chat 的 whole-utterance Talker floor；在中间 chunk 永久屏蔽 EOS；把终止采样再次作为普通 codec frame 输出。
- [MCPMO-4d] 禁止：让 auto-response 因 `force_listen` 仅为 logit hint 而无限续跑；在已达边界后继续 append；清除 resumable request；或在 await 后未复核 session/response 所有权即结束 response。
- [MCPMO-4e] 禁止：恢复独立 `minicpmo_4_5_duplex.yaml`；在 replica overlay 重复并漂移 session 配置；为 duplex 全局关闭 async scheduling；或把 runtime-only floor 写回 YAML 而改变 chat TTS。
