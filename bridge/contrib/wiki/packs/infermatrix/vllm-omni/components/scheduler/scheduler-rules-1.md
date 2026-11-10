---
name: scheduler-rules-1
description: Scheduler 规则第 1 部分：Direct 代码快速入口表（PR 描述信号 → 规则组 → 首批源码），SCHED-1a prefix cache required keys 与 512 MiB cap（test_qwen3_omni mix 用例 tensor 6 vs 9）、SCHED-1b passthrough 逐请求边界、SCHED-2a max_num_batched_tokens < 256 挂 GPU、SCHED-3a rebase 对照 live upstream 调度接口与 vLLM 0.28 defer_block_free
metadata:
  scope: 只收快速入口表与 SCHED-1a、1b、2a、3a；SCHED-4a 起的 side-stream、logprobs、async-chunk、KV transfer、stale output 规则归 scheduler-rules-2，SCHED-1c 与 SCHED-6a2 归 rules-shared-lifecycle，SCHED-5g 归 rules-release-queues
---
# Scheduler 规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 1/2 部分；第 2 部分 [[scheduler-rules-2]]
- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-07-16；updated: 2026-10-06
- 来源（sources）：PR #8459；PR #8259；PR #5957；PR #5976；tests/core/sched/test_omni_ar_scheduler_stale_drain.py；tests/core/sched/test_omni_ar_scheduler_streaming.py；vllm-omni-rebase-agent@122a9468:agent/skills/fix-talker-truncated-prefill-prefix-cache-key-cap/SKILL.md
  - vllm-omni-rebase-agent@122a9468:agent/skills/gpu-hang-low-max-num-batched-tokens/SKILL.md；vllm_omni/worker/gpu_ar_model_runner.py；vllm_omni/core/prefix_cache.py；vllm_omni/utils/mm_outputs.py；vllm_omni/core/sched/omni_ar_scheduler.py；vllm_omni/core/sched/omni_generation_scheduler.py
  - vllm_omni/core/sched/omni_scheduler_mixin.py；vllm_omni/core/sched/omni_scheduling_coordinator.py；vllm_omni/core/sched/output.py；tests/core/test_prefix_cache.py；tests/core/test_prefix_cache_async_write.py；tests/core/sched/test_omni_scheduler_mixin_shared.py
  - tests/core/sched/test_omni_scheduler_mixin_timeouts.py；tests/distributed/omni_connectors/test_chunk_transfer_adapter.py；tests/utils/test_mm_outputs.py；tests/entrypoints/test_omni_new_request_data.py；PR #4106；PR #5310；PR #5461；PR #4795；PR #5842；PR #6021；PR #6033；PR #6089；PR #6149
  - PR #6360；PR #6406；PR #6150；PR #6619；PR #6680；PR #6626；PR #6529；tests/core/sched/test_omni_ar_scheduler_aborted_queue_sweep.py；tests/core/sched/test_omni_scheduler_streaming_input_counter.py；tests/core/sched/test_omni_sched_deferred_free_fence.py；PR #6831
  - tests/e2e/online_serving/test_nemotron_voicechat_duplex.py
- 只有 `SCHED-数字字母` 是可审计规则 ID。运营 runbook 以 rebase-agent 仓库为准，本页是知识树沉淀快照（2026-07-16，agent @122a9468；skills 工作树含未提交遥测更新，快照以工作树为准）。

### Direct 代码快速入口

- PR 描述先命中下表，再打开对应规则组和首批源码；changed files 强制校验并补齐是否还跨到 Distributed、Serving 或 Model Executor，描述与 diff 冲突时以后者为准。

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| prefix cache、truncated prefill、mm key、deferred/passthrough payload | SCHED-1a/1b | `core/prefix_cache.py::OmniTensorPrefixCache`；`utils/mm_outputs.py::{build_mm_cpu,to_payload_element}`；`worker/gpu_ar_model_runner.py::_deferred_prefix_cache_mm_keys` |
| `max_num_batched_tokens`、prefill throttle、低预算 GPU hang | SCHED-2a | `core/sched/omni_ar_scheduler.py::OmniARScheduler.schedule`；`core/sched/omni_generation_scheduler.py::OmniGenerationScheduler.schedule`；触发它的 deploy/test 配置 |
| vLLM bump、scheduler rebase、KV connector stats | SCHED-3a | 两个 scheduler 的 `schedule` / `update_from_output` 与 live upstream `vllm/v1/core/sched/` |
| side-stream D2H、pinned host tensor、源 buffer 复用 | SCHED-4a/4b | `worker/gpu_ar_model_runner.py::_copy_tensor_payload_to_cpu`、`_get_or_create_omni_payload_copy_stream`；`core/prefix_cache.py` 的 async copy 路径 |
| sampled-token logprobs、spec decode trim、request-local output error | SCHED-5a | `core/sched/omni_ar_scheduler.py::_slice_sampled_logprobs`、`update_from_output` |
| stateful async chunk、full-payload input、KV cleanup | SCHED-5b/5c | `core/sched/omni_generation_scheduler.py`、`omni_scheduling_coordinator.py`、`omni_ar_scheduler.py::_free_request` |
| KV extraction wait、connector acknowledgement、partial interval cleanup | SCHED-5h | `core/sched/omni_ar_scheduler.py::{_free_request,update_from_output}` → scheduler stats → orchestrator metrics |
| consumed chunk validation failure、receive ledger、live request termination | SCHED-5i | `core/sched/omni_scheduler_mixin.py::_process_chunk_receive_failures` → `chunk_transfer_adapter.py` |
| async stop、streaming update、scheduled/async stale token fence、abort queue/counter drift | SCHED-6a/6f | `core/sched/omni_ar_scheduler.py::{_handle_stopped_request,update_from_output}` → scheduler mixin abort sweep/counter resync → streaming/stale tests |

- 若描述只写模型症状，先从模型 owner 找到 payload producer/consumer；只有实际断点落在调度、prefix cache 或 copy lifetime 时才把 Scheduler 加为 owner。

### [SCHED-1a] prefix cache 的关键 key 必须显式声明，禁止抬 cap 或关缓存

- skill 元数据：`fix-talker-truncated-prefill-prefix-cache-key-cap`，modules=[worker_runner, model_executor]，status=active，run_count=54，2026-06-10 创建 / 07-11 最后使用。
- 症状：`tests/e2e/online_serving/test_qwen3_omni.py::test_mix_to_text_audio_001[default]` 失败；stage-1（`StageEngineCoreProc_stage1_replica0`）死于 `RuntimeError: The size of tensor a (6) must match the size of tensor b (9) at non-singleton dimension 0`，
  - 位置 `vllm_omni/model_executor/models/qwen3_omni/qwen3_omni.py::_get_talker_assistant_parts`（`input_embeds = assistant_text_hidden + assistant_codec_hidden`）。因 OmniServer fixture 是 session 级、stage-1 已死，同文件其余用例随即全部 `EngineDeadError`，watchdog 杀 pytest（rc=143）。
  - shape 解码：`assistant_codec_hidden` 恒为 9 行；`assistant_text_hidden`==6（0 + 4 pad + 1 BOS + 1 zero-fill）意味着 `thinker_embed[im_start_index:segment_end_index]` 为**空**——stage-0 发来的 `embed.prefill` 远短于 prompt。
- 诊断（跨 stage 截断通用配方）：
  1. 在 stage-0 日志 `grep "Skipping mm prefix cache key"` —— 命中 `hidden_states.layer_0` / `hidden_states.layer_24`（embeddings 层与 accept_hidden_layer 层）即适用本规则。
  2. payload 遥测 `grep "_send_single_request"`：健康时 mix 测试所有请求 ~21–22 MB；损坏时首个请求 ~21 MB（cache miss），随后同 prompt 请求骤降 ~1.4 MB（prefix 命中、只剩后缀行）。
  3. 先归因再调试：与**上一次通过的 run** 同一测试日志对比（`rebase_logs/runs/<prev-run>/tests/00_omni_qwen3-omni_test.log`）；核对 vLLM 版本行 `Initializing a V1 LLM engine (vX.Y...+g<sha>)` 是否一致——一致则回归在 vllm-omni 树（合入的 origin/main 或模块 agent 提交）而**不是** vLLM bump；`git log -S"<告警文本>" --all` 快速定位引入提交。
- 根因链（首见于 vllm-omni #3689 / `57227dc7`）：测试用 `--stage-overrides` 强制打开 stage-0/1 的 prefix caching；qwen3-omni thinker 把逐 token `hidden_states.layer_0`（embeddings）与 `hidden_states.layer_{accept_hidden_layer}` 打进 thinker→talker payload；prefix 命中时只执行后缀 token，前缀行必须从 `OmniTensorPrefixCache` 重建；
  - #3689 加了逐 key 512 MiB cap（`_MAX_MM_CACHE_BYTES_PER_KEY`，为 qwen3-tts 类模型设的 OOM 防线）——大 KV cache 下（如 L20X 682,896 token → 2048 维 bf16 每 key 2667.6 MiB）两个 layer key 被 **静默丢弃**，prefix 命中的请求带着截断的 `embed.prefill` 在 talker 侧爆 shape。
- 修法（skill 的 4 处小改，模型声明豁免，沿既有 `requires_full_prefix_cached_hidden_states` / `deferred_prefix_cache_mm_keys` 模式）：
  1. `vllm_omni/core/prefix_cache.py` —— `OmniTensorPrefixCache.__init__` 增 `required_mm_cache_keys: set[str] | None`；`maybe_init_missing_mm_cache_keys` 中该集合内的 key 绕过 cap（改打 `warning_once` 报实际 MiB，而不是跳过）。
  2. `vllm_omni/worker/gpu_model_runner.py` —— `initialize_metadata_builders` 构造 cache 时传 `required_mm_cache_keys=set(getattr(getattr(self, "model", None), "required_prefix_cache_mm_keys", ()) or ())`。
  3. `qwen3_omni.py` thinker 分支 `__init__`：声明 `self.required_prefix_cache_mm_keys = {"hidden_states.layer_0"}`，再取 `accept_layer = getattr(talker_config, "accept_hidden_layer", None)`，仅当 `accept_layer is not None` 时加 `f"hidden_states.layer_{int(accept_layer)}"`。
  4. `tests/core/test_prefix_cache.py` —— 单测把 cap monkeypatch 到 1 字节，断言 required key 仍被缓存、可选超大 key 被跳过。
  - key 命名：`flatten_payload`（`vllm_omni/data_entry_keys.py`）把 `{"hidden_states": {"layers": {N: t}}}` 展平成 `"hidden_states.layer_N"`，**声明展平后的名字**。
  - main @5c390096 现状：布尔合同 `requires_full_prefix_cached_hidden_states`（`gpu_ar_model_runner.py:603`，qwen3_tts/higgs_v3 talker 显式 False）与集合 `deferred_prefix_cache_mm_keys`（:692/:730，模型声明如 `qwen3_tts_talker.py:321` `{"codes.audio"}`）已在；
    - skill 的 `required_*` 命名在该提交尚未出现——按 skill 的 Watch Out，该修复属 vllm-omni upstream，需提/跟 upstream PR。
- 验证：`python -m pytest tests/core/test_prefix_cache.py -q` 全过；`CUDA_VISIBLE_DEVICES=0,1 python -m pytest -s -v tests/e2e/online_serving/test_qwen3_omni.py -m 'core_model' --run-level 'core_model'` → 4 passed；
  - stage-0 日志出现 `... exceeds the 512.0 MiB cap ... but is required for downstream-stage correctness; allocating it on CPU anyway`，且 `_send_single_request` 对**所有** mix 请求都 ~21 MB（不只是第一个）。
- Watch out：下游 stage 消费**全 prompt 逐 token** mm 输出的模型，在 stage-0 可能开 prefix caching 时都必须声明 required keys —— Qwen2.5-omni 今天不用 layer-capture 机制，机制变了要复查；绕过 cap 的缓存住在主机内存（本例每 key ~2.6 GiB）——TB 级内存的 CI 主机可承受，小内存主机要标注。^[SK-fix-talker-truncated-prefill-prefix-cache-key-cap]

### [SCHED-1b] prefix-cache passthrough 必须保留逐请求边界与载荷语义

- 触发：修改 `build_mm_cpu`、`to_payload_element`、prefix-cache merge/deferred payload，或 runner 对 combined multimodal output 的拆包。
- 强制：token-aligned tensor（首维等于本步 scheduled token 总数）按每个请求的 `start:end` 切片；非 token-aligned tensor 给每个请求完整独立 clone；prefix-cache merge 中的 list（如 `codes.ref`）保持整表并逐请求 clone，直到 runner 用**原 batch index** `_unwrap_lists`。D2H 后每个嵌套 tensor leaf 必须在 CPU、detached、contiguous，并保持 dtype/shape/value；
  - dict/list 与非 tensor leaf 的结构和值不变。
- 生命周期：abort/discard 必须删除 staged chunks，之后的 commit 是 no-op；同 req-id 重用从空状态开始，不能混入旧 chunk。
- 验收：mixed hit/miss + 不等 scheduled length 同时覆盖 1-D/2-D token-aligned、多个非对齐 shape、per-request tensor list 和 int32/int8 metadata；修改一请求结果不影响其他请求或源值。另测 discard→late commit、discard→req-id reuse。^[PR #5310]

### [SCHED-2a] 极小 max_num_batched_tokens 与并发 prefill 会挂死 GPU

- skill 元数据：`gpu-hang-low-max-num-batched-tokens`，modules=[online_serving, worker_runner]，status=active，run_count=38，2026-06-18 创建 / 07-11 最后使用。
- 触发：启动约 2s 后 GPU hang，NVIDIA watchdog 杀进程，日志只有 `Received cancellation signal, interrupting`（无 Python 栈）；条件为并发请求 ≥5 且 `max_num_batched_tokens < 256`（如 64）。
- 机制：upstream 调度器新增 `throttle_prefills` 后与极小 token 预算交互不良。
- 修法：小批路径测试用适中小值——`tests/e2e/online_serving/test_qwen3_omni_expansion.py` 的 `get_batch_token_config`，两个 stage 一起改：`updates={"stages": {0: {"max_num_batched_tokens": 512}, 1: {"max_num_batched_tokens": 512}}}`，并注释"64 过小会挂 GPU；调度器再变需重估"。
- 验证边界：完整验证需  2×H100；skill 落盘时无卡，实际验证为 import 检查（已确认无语法错误）——这是 **纯测试配置改动**，不碰产品代码。

### [SCHED-3a] rebase 前必须对照 live upstream 调度接口

- 触发：对齐 upstream vLLM 版本（rebase/分支合并）涉及 `vllm/v1/core/sched/`。
- 强制：对照 live upstream 源码核对本组件继承的接口（`schedule`/`update_from_output`/异步调度、kv-connector 统计等挂点）是否有签名、时序或语义变化，逐条登记后再改代码；曾发生 `kv_connector_stats` 提取时序在上游更新后错位、需要移到 `_update_from_kv_xfer_finished` 之后的案例（omni_ar_scheduler.py 与 omni_generation_scheduler.py 都要改）。
  - base `NewRequestData` 重包必须按 live dataclass 字段无损复制后再附 Omni payload；共享 mixin 只集中机械 lifecycle，AR/generation 的 admission、cached-payload 和 synthetic-abort 等差异用调用参数保留为显式本地策略。
- 验收：枚举 live `NewRequestData.__dataclass_fields__` 逐字段断言 identity/equality，覆盖 Omni fast path 不重建与 generation fallback；AR/generation 分别验证 pending-input、queue restore、finished-set/abort policy。直接调用 scheduler 方法的轻量 stub 必须继承 mixin 或显式绑定本次方法真实依赖，使断言确实到达目标分支。 ^[PR #5461]
- vLLM 0.28 的具体补充：当 `defer_block_free` 启用时，AR 与 generation scheduler 都必须在每个非空 schedule step 推进 `sched_step_seq`，并在 `update_from_output()` 的开头推进 `processed_step_seq`、调用 `_drain_deferred_frees()`；generation fast path 的推进必须早于 `_update_after_schedule` 的 `last_sched_seq` 标记。
  - EC connector 完成请求时先调用 `request_finished(request)`，将 delayed-free 合入 block 生命周期，并把 `ec_transfer_params` 经 `OmniEngineCoreOutput` 传给 output processor。prefill stats 必须在 request 尚在 KV cache manager 中时以 `estimate_cached_tokens()` finalize，随后在所有 `RequestOutput` 路径保留 `num_cache_creation_tokens`。
  - 这些是 upstream 0.28 合同，不是 optional compatibility shim；同时覆盖 AR/generation 两条 override 路径和 hook-order 测试。^[PR #6606]

## 决策与踩坑

- [SCHED-1a] 禁止：全局抬高/删除逐 key cap（那是别的模型的 OOM 防线）；在测试或 deploy 配置里关 prefix caching 掩盖正确性 bug；在 talker 侧容忍短 embed（payload 早已错了）。
- [SCHED-1b] 禁止：把所有 passthrough tensor 一律按 token 切；在 merge 阶段提前按 downstream subset index 拆 list；用 float staging buffer 改写 int metadata；把本规则解释为后续 W2 优化已经实现——`f24a6165` 只增加当前行为的 characterization tests。
- [SCHED-2a] 禁止：把挂死当模型/驱动 bug 直接重试；用超大预算掩盖小批路径不测。^[SK-gpu-hang-low-max-num-batched-tokens]
- [SCHED-3a] 禁止：只跑单测绿灯就认定调度语义未变；不能用缺少真实 mixin helper 的 `SimpleNamespace`/`object.__new__` stub 绕过共享调用链，也不能手列一份会随 upstream schema 漂移的 base output/request 字段。
