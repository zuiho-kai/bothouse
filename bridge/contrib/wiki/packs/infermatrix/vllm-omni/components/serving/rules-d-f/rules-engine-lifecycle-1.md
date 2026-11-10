---
name: rules-engine-lifecycle-1
description: Serving engine 生命周期规则第 1 部分：SERV-5r default diffusion stage 合并 model extras、SERV-5a sleep/wake 的 stage/tag 作用域、SERV-5c 共享服务类构造状态、SERV-5d app.state wiring guard、SERV-5e TTS detection 的 adapter 有序并集（LEGACY_TTS_DETECTORS、AST ratchet 27/0），以及 SERV-5g–5l pure-diffusion TTS 短路、AR-Diffusion session、adapter 采样覆盖、min_tokens、TTSCapabilities owner
metadata:
  scope: 只收 SERV-5r、5a、5c、5d、5e 与 SERV-5g–5l；SERV-5n–5q、SERV-6a–6f、SERV-8a、SERV-9a 归 rules-engine-lifecycle-2，SERV-5f 故障隔离归 rules-fault-isolation，SERV-5t 归 rules-abort-lifecycle，SERV-5b、5m 归 rules-sleep-control，规则组总表归 serving-rules-1
---
# Serving engine 生命周期规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-engine-lifecycle.md` 的第 1/2 部分；第 2 部分 [[rules-engine-lifecycle-2]]
- 源页：`knowledge/repos/vllm-omni/components/serving/rules-engine-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-03；updated: 2026-09-05
- 来源（sources）：PR #4834；PR #4905；PR #4912；PR #5221；Issue #4855；PR #5277；PR #5682；PR #5713；PR #5746；PR #5843；PR #5957；PR #6008；PR #6084；PR #6138；PR #6202；PR #6484；vllm_omni/engine/async_omni_engine.py；vllm_omni/engine/membership_controller.py；vllm_omni/engine/messages.py
  - vllm_omni/engine/orchestrator.py；vllm_omni/engine/stage_pool.py；vllm_omni/engine/stage_init_utils.py；vllm_omni/engine/stage_engine_startup.py；vllm_omni/engine/stage_runtime.py；vllm_omni/entrypoints/async_omni.py；vllm_omni/entrypoints/omni_base.py
  - vllm_omni/entrypoints/openai/api_server.py；vllm_omni/diffusion/inline_stage_diffusion_client.py；vllm_omni/diffusion/stage_diffusion_client.py；tests/engine/test_membership_controller.py；tests/engine/test_orchestrator_event_driven.py；tests/engine/test_async_omni_engine_stage_init.py
  - tests/engine/test_single_stage_mode.py；tests/entrypoints/test_omni_base_profiler.py；PR #6121；PR #6214；vllm_omni/engine/stage_runtime.py；PR #5676；PR #6525；Issue #6435；PR #5491；PR #6033；PR #5272；PR #6186；PR #6241；vllm_omni/entrypoints/openai/tts_adapters/moss_tts.py；PR #6346；PR #6581
  - tests/entrypoints/test_omni_sleep_mode.py；PR #4092；vllm_omni/worker/base.py；PR #6564；tests/engine/test_orchestrator.py；tests/entrypoints/openai_api/test_qwen3_omni_realtime_websocket.py；PR #6189；tests/entrypoints/test_async_omni_diffusion_config.py；PR #6367
  - vllm_omni/outputs/output_processor.py；tests/engine/test_async_omni_engine_abort_ack.py；tests/entrypoints/test_async_omni_pause_sleep_routing.py
- 置信度（confidence）：high
- 本页收纳 `SERV-5a`–`SERV-5e`、`SERV-5g`–`SERV-5r`、`SERV-6a`–`SERV-6f`、`SERV-8a` 与 `SERV-9a`。触发条件与其余审查组见 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving 共享规则） 的 Direct 代码快速入口；请求输入侧的合同留在该页，故障隔离见 [[rules-fault-isolation]]（fault isolation 规则）。

### Engine 生命周期合同

- [SERV-5r] default diffusion stage 必须保留并按显式性合并 model extras
  - 触发：修改 `AsyncOmniEngine` default diffusion stage fallback、promoted top-level model option、`stage_overrides` 或 local/unregistered Diffusers checkpoint 启动。
  - 强制：先保留 caller `extras`，只有 explicit non-`None` top-level promoted option 才覆盖同名 extra，其余键保持 caller value 或 builtin default；stage-0 `extras` override 必须合并进 default fallback 的输入。registered stage 保持既有 complete override mapping，不得因修复 fallback 改写其语义。
  - 验收：覆盖 caller-only extras、explicit top-level precedence、stage-0 extras 在 default fallback 的 end-to-end resolution，以及 registered path 不回归。^[PR #6189]
- [SERV-5a] sleep/wake 状态必须保留 stage 和 tag 作用域
  - 触发：sleep/wake 接受 `stage_ids`、resource tags 或 partial wake。
  - 强制：状态 key 与公开操作的 stage/tag 作用域一致；只有全部必需 stage/tag 已 warm 才放行 generation。
  - 验收：sleep 两个 stage、只 wake 一个时 generation 仍拒绝，随后 wake 另一个才放行。^[PR #4834]
- [SERV-5c] 共享服务类重构必须闭合全部构造状态
  - 触发：移动 model-specific capability 到 adapter、增加 factory/`__new__` 快路径，或让同一 serving class 同时承载普通、无对应 stage、diffusion-only 等实例。
  - 强制：列出每个生产构造入口及其必有/可选属性；所有公共 caller 通过统一 accessor 或显式 `None` 状态访问 optional capability，startup warmup 与 request route 使用同一状态合同。
  - 验收：至少覆盖普通 adapter、无 adapter 和 bypass-`__init__` factory 三类实例，并实际调用 startup warmup、voice list/upload 与对应 request route；每条路径保持重构前的成功或结构化错误合同，不得出现 `AttributeError`。 ^[PR #6138]
- [SERV-5d] 应用 wiring guard 检查可用性而非属性名
  - 触发：assembled app 的 route/middleware 依赖 `app.state` handler 或 factory wiring。
  - 强制：mandatory state 同时检查属性存在且非 `None`；guard 测试通过 assembled app/公开 handler 观察行为，并覆盖应用实际暴露的方法和 middleware inner-app 调用。
  - 验收：把 handler 置空、移除 route/method、绕过 inner app 三类 mutation 均使 guard 失败；正常 app 的 HEAD/OPTIONS census 与必需 state key 完整。 ^[PR #6202]
- [SERV-5e] TTS detection 从 adapter metadata 的有序并集派生
  - 触发：增加/迁移 TTS adapter，修改 `stage_keys`、`model_archs`、stage discovery、检测顺序或 speech-capable deployment topology。
  - 强制：adapter 与显式 `LEGACY_TTS_DETECTORS` 构成完整 detector 并集；按 `(detect_priority, name)` 确定性排序，等优先级 detector 不得重叠。stage-key 候选、仅靠 architecture 定位的 AR entry stage、最终 model type 都从该并集派生；非集合规则覆写 `matches()`，拓扑能力覆写 `stage_serves_speech()`，不要回填 `serving_speech.py` 分支。
  - 边界：VoxCPM2 talker architecture 是高优先级权威匹配；Ming flash adapter 的 `ming_tts` stage-key 以默认 priority 100 先于 Ming dense 的 architecture fallback priority 200；CoVo 的通用 `fused_thinker_talker` 还需 architecture 确认；Audex omni 还需同部署的 `audex_code2wav`。
    - 纯 diffusion 的 `for_diffusion()` 直接绕过 adapter detection，当前 `DiffusionTTSAdapter` 没有生产 subclass。
  - 验收：冻结旧 ladder 作为 oracle，覆盖 in-tree pipeline stage、adapter 声明 architecture、stage 集合等价、entry-arch 范围、无歧义/稳定顺序和 topology guard。`LegacyDetector` 只能缩减；AST ratchet 中超过 branch/legacy budget 失败，等于上限静默通过，少于上限则通过并显示收紧 reminder；下降本身不能让该 pre-commit hook 红灯，但未同步更新的 exact-equality pytest 仍会失败。
    - 在人工调低 constant 前存在可回增 slack，table dispatch 也是已固定的漏检形态，不能把 pre-commit 通过解释为不可绕过。`omnivoice_generator` 未被 pipeline 发出，是保留兼容事实而非可达性证据。^[PR #5682]
  - adapter 提取保持共享 dispatcher 单一：Ming Flash 的 `validate()` 原样拒绝空 input、过长/非字符串 instructions、`task_type`/`language`/`x_vector_only_mode`/`initial_codec_chunk_frames`、`ref_audio`/`ref_text` 和非正 `max_new_tokens`；
    - `build()` 继续委托 server 的 `_build_ming_flash_omni_prompt()`，并返回空 `tts_params` 与固定 model type。公开校验和 generation preparation 都必须经 `resolve_adapter()`，不要把同一分支加回 `serving_speech.py`。`LEGACY_TTS_DETECTORS` 当前为空，branch/legacy AST ratchet 是 27/0；
    - Ming Flash 只由 adapter 的 `ming_tts` stage key 检测，且 legacy 名不得同时注册 adapter。验收仍须证明 `ming_tts` stage key 与 Ming dense architecture fallback 的消歧不变。^[PR #5746] ^[PR #5843] ^[PR #6008]
  - 证据：CPU oracle/ratchet suite 支撑检测等价；L20X VoxCPM2 只证明 architecture path 到达 warmup，随后因基线同样复现的 vLLM skew 退出，未证明成功 speech endpoint/audio E2E。

### Full-duplex 与 CFG companion 生命周期

- [SERV-5g] pure-diffusion TTS 必须在 AR adapter 解析前短路
  - 触发：speech serving 同时支持普通 AR TTS 与 pure-diffusion TTS，且 diffusion factory 通过 `for_diffusion()`/`__new__` 绕过常规 `__init__`，发生 adapter 解析或 native speed handling 变更。
  - 强制：在读取 adapter 或 `_adapter` 状态前先检查在两种构造路径上都可用的 `_diffusion_mode`；pure-diffusion 路径必须直接返回 `None` 并保持专用 speech 编码路径，普通 AR 实例继续通过 `resolve_adapter()` 使用既有 adapter-native speed 行为。
  - 验收：用 `OmniOpenAIServingSpeech.for_diffusion()` 构造实例，提交公开 `create_speech()` 请求并断言成功的 `200`/`audio/wav` 响应；以 mock 断言 diffusion speed 请求返回原值且 `resolve_adapter()` 未被调用，同时验证普通 AR 实例仍解析并使用其 adapter，所有路径不得出现 `AttributeError`。^[PR #6121]
- [SERV-5h] 自定义 AR-Diffusion engine 与 worker-local session lifecycle 必须保持一致
  - 触发：默认 stage 构造路径接入自定义 diffusion engine backend，或新增 worker-local AR session 的 reset/close lifecycle RPC 与副本限制。
  - 强制：`load_and_resolve_stage_configs()` 在没有 deploy config 时也必须保留显式 `engine_backend`；runner 选择由选中的 engine/platform owner 负责，不重复注入 `diffusion_model_runner_cls`。session reset、close 和失败清理由选定 stage 的 collective RPC 到达实际 worker，并在所有 worker 支持后才确认成功；在 session-affine routing 尚未实现前，AR stage 必须保持单副本。
  - 验收：从真实 default-stage fallback 测试显式断言 `engine_backend` 进入最终 `engine_args`；用选定 stage ID 验证 reset/close RPC、unsupported worker 结果和失败重试；用两副本配置确认初始化前拒绝或证明持续 session affinity，并回归普通 diffusion engine 的既有 runner 选择。^[PR #5491]
- [SERV-5i] TTS 模型专属采样覆盖必须归 adapter 所有
  - 触发：新增或迁移 TTS 模型专属 sampling 参数、`max_new_tokens`、动态 token 限制、stop token 或 Audex CFG/TTA 参数。
  - 强制：在已注册 adapter 的 `apply_sampling_overrides(sampling_params_list, request, prompt, request_id)` 中实现模型行为；`serving_speech` 仅负责合并 `extra_params`、调用 adapter override，再处理 `seed`。通用 `max_new_tokens` 必须通过共享 helper 深拷贝参数，模型特例保留各自的动态 token、CFG/TTA、stop-token 与 `+1` 语义；最终 detector 必须能解析到注册 adapter。
  - 验收：覆盖 adapter registry/detection 无歧义、`extra_params -> apply_sampling_overrides -> seed` 顺序、无与有 `max_new_tokens`、CosyVoice3/GLM-TTS 动态边界、Ming stop token、Audex request-id/CFG/TTA 以及共享默认参数不变；测试必须检查传给 engine 的实际 sampling 参数。 ^[PR #5272]
- [SERV-5j] TTS adapter 必须承载模型专属请求合同与采样覆盖
  - 触发：speech endpoint 接入没有 speaker/reference-audio 的 text-to-music 模型，或模型的必填字段、采样控制和普通 TTS 合同不同。
  - 强制：注册 adapter 并由 adapter metadata 完成 detection；adapter 负责 `validate()`、prompt/token-id 构造和 `apply_sampling_overrides()`，明确 `input` lyrics、`instructions` caption、固定 sampling、长度上限及被拒绝的 TTS 字段，shared serving 只负责公共 dispatch。
  - 验收：通过真实 adapter detection 和 `/v1/audio/speech` 请求覆盖缺失/空 lyrics、缺失/空 caption、unsupported fields、长度边界、tokenizer 校验与非流式输出，并断言送入 engine 的实际 prompt、sampling 参数和 model type。 ^[PR #6186]
- [SERV-5k] stage request 的 min_tokens 必须受剩余上下文约束
  - 触发：orchestrator 用 `SamplingParams` 构造 stage request，且 prompt 已占用部分 `max_model_len`。
  - 强制：clone 参数后计算 `remaining=max_model_len-len(prompt_token_ids)`；`max_tokens is None` 时设为 `remaining`，并将 `min_tokens` 限制为 `max(0, remaining)`，不得改写调用方对象。
  - 验收：覆盖剩余 46、50、0 token 的请求，断言最终 request 参数、原始参数不变，并回归普通 stage 的默认 max-token 行为。 ^[PR #6346]
- [SERV-5l] TTS 静态能力与运行时 voice 必须分属 owner
  - 触发：TTS serving 提取或迁移 built-in speakers、precomputed profiles、supported languages、codec frame rate，或修改 voice upload/list/delete 与 embedding 校验。
  - 强制：adapter 初始化时一次性加载 `TTSCapabilities` 快照；静态模型能力归 adapter，`supported_speakers` 与 `supported_languages` 使用 `frozenset`，`precomputed_speakers` 保存 profile metadata，server 只拥有 `uploaded_speakers`，可用 speakers 由两者并集派生且上传集合独立维护。
  - 验收：构造相关 adapter，断言能力在初始化后进入 snapshot、集合类型正确且内置/预计算/上传 voice 的并集完整；删除与 built-in 同名的上传 voice 后内置 voice 仍存在，并验证无 adapter 的 diffusion 路径不会触发 adapter 属性错误或专属维度校验。^[PR #6138]

## 决策与踩坑

- [SERV-5r] 禁止：以 builtin default 覆盖 caller-only extra；让 unregistered/local checkpoint 忽略 stage-0 extras；只修 registered config 路径或只断言 helper dict 而不覆盖 fallback resolution。
- [SERV-5a] 禁止：用一个全局 tag set 表示多 stage 状态；唤醒一个 stage 后清掉其他 stage 的 sleeping 状态或把后续定向 wake 当成 already warm。
- [SERV-5c] 禁止：只测试目标 adapter 的正常构造；在 factory 实例上直接读取未初始化属性；用旧的 model-type early return 掩盖无 adapter 状态。
- [SERV-5d] 禁止：`hasattr` 接受显式 `None`；测试绑定可搬迁私有 symbol/单 router；用恒真断言证明 wiring。
- [SERV-5g] 禁止：在 diffusion 实例上无条件解析 AR-stage TTS adapter、读取仅由 `__init__` 设置的 `_adapter`，或把 pure-diffusion 请求重新路由到 AR adapter 路径；只覆盖普通构造器而不覆盖 bypass-`__init__` factory。
- [SERV-5h] 禁止：丢弃 `engine_backend` 使 AR 请求静默回退普通 `DiffusionEngine`；通过默认 stage 额外注入 runner class 覆盖 engine-owned 选择；只修改客户端状态而不调用 worker lifecycle；以 request-ID 级 affinity 或 round-robin 路由承载 worker-local session；将清理失败当作已关闭并允许立即复用 session ID。
- [SERV-5i] 禁止：把新的 model-type 分支或采样 mutation 加回 `serving_speech.py`；让 adapter 直接污染 engine 的共享默认 sampling 参数；保留没有 adapter 支撑的 legacy detector，或用只验证 dispatch 到达的测试替代最终 `SamplingParams` 结果断言。
- [SERV-5j] 禁止：在 `serving_speech.py` 增加 model-type 分支；静默忽略 `voice`、reference audio、temperature 或 `stream` 等不支持字段；把无 speaker 模型套用普通 TTS 的 voice 或 temperature 语义。
- [SERV-5k] 禁止：只在 `max_tokens=None` 时处理 `min_tokens`；让 `check_stop` 因过大的最小 token 数永远早退；用静默 fallback 掩盖上下文已满。
- [SERV-5l] 禁止：让 server 保存或修改静态能力；把上传 voice 合并进 built-in speaker 集合后在删除时 `discard`，或把 frozen dataclass 误解为内部 profile mapping 的深层不可变；在共享 serving 中恢复 model-type capability 分支。
