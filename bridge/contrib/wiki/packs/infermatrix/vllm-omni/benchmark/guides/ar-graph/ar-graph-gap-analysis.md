---
name: ar-graph-gap-analysis
description: HunyuanImage3 AR graph online d-step 空洞归因规则：2026-06-11 反例（80-100ms GPU 空闲不是 copy 慢）、GPU / Worker / Cross-rank / Parent-core / Workload / 反证边界六层同窗分类、补充分类规则（step 内与 step 间 gap、argmax、async output、shm_broadcast、TP phase skew、probe 时间戳对齐、wait-all 与 async-off 控制组、JIT warning、main-thread-only 过滤、mm-prefix tolist、慢 .item() 栈）
metadata:
  scope: 只收 d-step GPU 空洞的证据分类与归因规则及其 2026-06-11 实测依据；执行顺序模板归 ar-dstep-investigation，serving 与 profiler 运行步骤归 ar-graph-profiling-1，历史结果数字归 ar-graph-online-2026-06-10-tail-gap 等结果页
---
# HunyuanImage3 AR Graph Gap 分析

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/ar-graph-gap-analysis.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### HunyuanImage3 AR graph online profiling：d-step 空洞不能先入为主归因

- 补充分类规则：
  - 先区分 **step 内 gap** 和 **step 间 gap**。step 内 `cudaGraphLaunch/replay` 卡住，和 step 间 `sample_tokens/RPC/output` 卡住，是两类证据，不准混用。
  - UI 上 `cudaMemcpyAsync -> HtoD` 中间空白只说明这段窗口 GPU 空闲；必须重新匹配 HtoD 对应的 CPU `cudaMemcpyAsync`，不能把整段空白算成 copy 耗时。
  - 如果 inter-step gap 覆盖 `sample_tokens -> Sampler.forward -> greedy_sample/aten::argmax`，要同时看 argmax GPU kernel 时长；若 kernel 只有微秒级而 CPU op 跨几十毫秒，归类为 sampling/runtime sync 等待，不是 GPU 算不动。
  - `aten::argmax` 长条还要继续拆内部事件：如果同线程只有微秒级 `cudaLaunchKernel/cudaMemsetAsync`，没有长 `cudaEventSynchronize/cudaStreamSynchronize`，不要写“argmax kernel 慢”；应写 host-side PyTorch/C++ wait 或线程调度等待，并继续用低开销 probe 定位。
  - `execute_model_outer` 是 wrapper，不是 root cause。必须继续拆到 `compute_logits`、`LogitsProcessor._gather_logits`、`tensor_model_parallel_all_gather`、`c10d::_allgather_base_`、`cudaGraphLaunch/replay` 等内层；若 peer rank 同时在 sample/RPC，优先按 TP phase skew / collective wait 分析。
  - 低开销 probe 不要用通用 method wrapper 包 `Sampler.greedy_sample`；它是 staticmethod，错误包装会多传 `self` 并在启动期 `determine_available_memory` 触发 `TypeError`。包 `Sampler.sample`、Hunyuan `sample/compute_logits`、LogitsProcessor 和 output wait 点即可。
  - 如果 gap 覆盖 `AsyncModelRunnerOutput.get_output()` / `cudaEventSynchronize`，优先检查 sampled-token async D2H copy 和 output enqueue；这类会出现在 async output 线程，不一定在 worker 主线程。
  - Hunyuan AR `_sample()` 每步会先调用 `InputBatch.update_async_output_token_ids()`；vLLM `AsyncGPUModelRunnerOutput` 会在 async copy stream 上把 sampled ids D2H 并 record event，`get_output()` 和 `update_async_output_token_ids()` 都可能同步这个 event。
    - 这个链路能解释 trace 里的 async output `cudaEventSynchronize` / sample 前等待，但是否是根因必须看它是否和该 gap 的 GPU idle 同窗口对齐。
  - 如果 gap 覆盖 `shm_broadcast.dequeue/acquire_read`，只能说明 worker 在等下一条 RPC；必须用 parent/core probe 才能区分 parent scheduler 慢、response drain 慢、还是 shared-memory delivery 慢。
  - 一个 trace 同时可能有 TP-wide gap 和 rank-local gap。报告必须按 peer overlap 分桶；不准用 `idx=463` 这种 rank-local sample gap 解释所有 gap，也不准用 rank0 output enqueue 解释所有 gap。
  - 如果同步 gap 的 rank0/rank1 primary 组合是 `sample_tokens` / `logits_all_gather`、`worker_rpc_dequeue` / `sample_tokens`、或 `output_enqueue` / `sample_tokens`，优先按 TP phase skew / control-plane skew 追，不要把它写成某个单点 kernel 或 memcpy 慢。
    - 下一轮 probe 必须同时覆盖 `LogitsProcessor._gather_logits`、`Sampler.sample`、async output `get_output`、parent `future.result/response_mq.dequeue` 和 `rpc_broadcast_mq.enqueue`。
  - parent/core probe 和 torch trace 不能直接按原始时间戳比较。probe 用 `perf_counter_ns`，torch trace 用 profiler `ts`；必须先用同一 worker 中双方都有的事件（如 `compute_logits`、`LogitsProcessor.*`）求 `trace_us - perf_counter_us` offset，并且 probe 记录要先按 `/start_profile` 到请求结束的 wall-clock 窗口过滤。
    - 健康 run 验证过 offset spread 可低到 `~12-24us`，可用于同窗归因。
  - 如果源码里 `execute_model`/`sample_tokens` 使用 `unique_reply_rank=output_rank`，而 trace 同窗显示 output rank 已进 `sample_tokens`、peer rank 还在 `execute_model/_gather_logits`，要把 root-cause candidate 写成“parent 提前推进造成 TP phase skew”。
    - 若实际启用了 async scheduling / batch queue，注意 `step_with_batch_queue()` 会在 `execute_model(non_block=True)` 后立即 enqueue `sample_tokens(non_block=True)`，不等 execute future。最终 proof 是诊断性地让 `execute_model(non_block=True)` 在返回 future 前等所有 TP rank response，同时保持返回 output_rank 结果；若同步 gap 显著下降，候选成立。
  - 诊断探针和诊断补丁如果都靠 `sitecustomize.py` 注入，必须合成一个入口并用 env flag 开关；`PYTHONPATH` 只能让一个目录里的 `sitecustomize.py` 生效，两个文件分开会导致实际只加载其中一个。
    - 开跑前先做无 GPU import gate：`AR_PARENT_PROBE_LOG=/tmp/x.jsonl AR_WAIT_ALL_EXECUTE_MODEL=1 PYTHONPATH=/tmp/probe python -c "import sitecustomize; ..."`，确认 wrapper 标记和 probe log 都存在，再启动模型。
  - `AR_WAIT_ALL_EXECUTE_MODEL=1` 只能验证“execute 后 TP response 没等齐”这一种假设；它会改变 execute 响应语义和调度形态，不能当生产等价实验。`async_scheduling: false` 也只能作为控制组：若 async-off 为 0 gap，还必须跑 async-on/no-waitall 的同 workload 控制。
    - 2026-06-11 的严格控制显示：wait-all 后 rank0/rank1 仍有 `86/83` 个 >10ms GPU-idle gap，async-off 为 `0`，但 async-on/no-waitall/warm、async-on/no-waitall/no-warm、async-on/no-waitall/no-probe 也都是 `0`。因此不能把该轮结果写成“async scheduling 已证明是根因”；
    - 只能写“旧 bad trace 需要额外条件，必须用同一复现窗口的 GPU idle + worker stack + parent phase + cross-rank overlap 归因”。
  - `vllm bench serve` 的 `Starting initial single prompt test run...` 不能直接当作已发请求；`ready_check_timeout_sec=0` 会打印 `Skipping endpoint ready check.` 并跳过该请求。profile 里到底有几个请求，以 `serve.log` 的 `/v1/chat/completions` 和 `stage-0 add request` 为准，不准从 bench 提示文本或 generated-token 计数反推。
  - JIT warning 不是根因证据。2026-06-11 healthy no-probe run 和旧 bad run 都有 `_compute_slot_mapping_kernel`、`kernel_unified_attention`、`fused_moe_kernel` 三个 inference JIT warning，但 healthy run 两个 rank 都是 `0` 个 >10ms inter-step gap。JIT/compile 只能作为 startup/runtime-state 信号；
    - 要证明它污染 d-step，必须把 in-window compile/JIT 事件和 per-step gap cadence 对齐。
  - 不要只按某个 annotation stream 的 inter-step gap 定义问题。2026-06-11 复查 old bad trace 后发现：主 tid `17` 的 decode step 本身 p50 约 `96ms`，但 step 内全局 GPU work p50 只有 `~7ms`；另一个 annotation tid `2478` 则显示 `~5.9ms` 短 step 加 `~91.9ms` gap。clean run 的 tid `17` step p50 约 `8.5ms`、GPU work p50 `~6ms`。
    - 因此这类现象要先算“step duration + step 内 GPU work 覆盖 + idle ratio”，再说是 step 内 host/control wait 还是 step 间 gap；不准继续把它简化成 HtoD copy 慢或单纯 inter-step 空白。
  - 做 torch profiler idle-source 分类时，必须先做 worker main-thread-only 过滤。后台线程（usage reporter、tqdm monitor、death-pipe monitor、async-output loop）的长条只能作上下文，不能当根因。
    - 2026-06-11 old bad rank0 用 `pid=1271230 tid=1271230` 过滤后仍有 `248` 个 step-internal idle region，p50 `82.150ms`，主线程 primary 为 `execute_model_outer=105`、`prepare_inputs=77`、`cuda_graph_launch=55`；clean/delay120 对照只在 `step0` 有一个长 idle。因此后续结论要写“worker 主线程在 host/control path 卡住”，而不是“trace 上有后台线程长条”。
  - `unified_attention_with_output/create_reduce_ret` 在 torch profiler 里可能是很宽的 pybind wrapper，不能直接写成 attention kernel 慢。
    - 2026-06-11 逐 step timeline 证明：一类大空洞实际在 `_build_attention_metadata -> extract_embeds_range -> ranges.tolist()`，一类在 `set_forward_context/create_forward_context` 归属下但平台 hook 为空，另一类在 `cudaGraphLaunch`；必须继续拆到 `_prepare_inputs`、mm-prefix metadata、forward_context、CUDA graph replay 四个具体点。
    - mm-prefix 路径尤其要查 `gpu_model_runner.py:2444-2470` 是否每 step 重建，以及 `multimodal/inputs.py:179` 的 `tolist()` 是否同步 GPU tensor。
  - 低开销 JSONL 诊断必须同时写 `perf_counter_ns` 和 `time.time_ns`。只写 perf counter 会导致无法按 `/start_profile`、`bench_start`、`bench_end` 精确过滤，只能分簇猜窗口。2026-06-11 已修 `ar_decode_step_diag_sitecustomize.py` 加 `wall_ns`；后续 profile/probe 对齐优先用 wall clock 先裁剪，再用 trace/probe anchor 求 offset。
  - Hunyuan AR graph online 的 d-step 空洞不要先导 900MB-1GB torch trace。2026-06-11 对照证明：单请求不复现，`num_prompts=10` 才复现长 host/control region；`/start_profile` 不是必要条件但会放大耗时。
    - 下一次先用 `ar_decode_step_diag_sitecustomize.py` path-split probe 跑 `PROFILE_NUM_PROMPTS=10 STOP_PROFILE_ENABLED=0 AR_DECODE_DIAG_MIN_MS=0.5`，确认 `cuda_graph.wrapper_call path=no_graph/capture/replay` 和 `worker.synchronize_input_prep.total` 后，再决定是否导完整 trace。
    - 长 `wrapper_call` 不能直接写成 slow CUDA graph replay；已捕获 replay 路径 max 只有毫秒级，长耗时主要落在 `no_graph`/`capture` 和周期性 input-prep sync。
  - 如果 Hunyuan AR graph online 的 input-prep 周期性长空洞复现，必须加慢 `.item()` 栈采样：`AR_DECODE_DIAG_WRAP_TENSOR_ITEM=1 AR_DECODE_DIAG_ITEM_STACK_MS=50`。
    - 2026-06-11 的 np3 栈证明显示，请求窗口内 `torch.Tensor.item` 慢记录全部命中 `<REMOTE_WORK_ROOT>/vllm-omni/vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py:2011` 的 `n_timestep = int(timestep_mask.sum().item())`，单次约 `198-205ms`，属于 CUDA scalar sync；
    - 这类结论必须有 stack proof，不能只凭 Perfetto 的 `cudaMemcpyAsync -> HtoD` 空白判断。
  - 追 Hunyuan AR input-prep 时要把“CPU scalar sync”和“MM encoder GPU work”分开。2026-06-11 的 `AR_DECODE_DIAG_PATCH_TIMESTEP_WHERE=1` 归因实验把 `torch.Tensor.item >50ms` 从 `18` 降到 `0`，`worker.synchronize_input_prep.total >50ms` 从 `40` 降到 `22`，证明 `<timestep>` 的 `.item()` 是一类真实空洞来源；
    - 但剩余 `_execute_mm_encoder ~290ms/request/rank` 经 `AR_DECODE_DIAG_SPLIT_EMBED_MM=1` 拆分后不是 `patch_embed/time_embed/sep_embed` 慢，更像异步 GPU encoder 工作完成等待，不能写成同一类 GPU idle。
- **一句话规则**：d-step 空洞的正确交付不是“看起来在等 X”，而是“这个 gap 的 GPU idle、worker stack、parent phase 三者在同一时间窗口对齐”。
- **当前判断边界**：启动慢和 d-step 空闲要分开写。冷 cache / 编译 / JIT 可能解释启动 15 分钟或 profile artifact 变大，但如果 warm trace 里仍有每步空洞，根因必须继续追 request-internal control-plane / sampling / async-output / TP phase skew，不能回退到“首次启动慢”。

## 决策与踩坑

### HunyuanImage3 AR graph online profiling：d-step 空洞不能先入为主归因

- **2026-06-11 反例**：AR graph online trace 里每个 d-step 之间出现 `80-100ms` GPU 空闲，UI 上看起来像 `cudaMemcpyAsync` 到后续 HtoD copy 中间空白。实际逐事件检查后：
  - 这不是单个 copy 慢：后续 HtoD 对应的 CPU `cudaMemcpyAsync` 只早约 `54us`，中间是约 `78ms` 全局 GPU idle。
  - 也不能直接归因成冷缓存 / 等图 / profiler overhead：隔离 `VLLM_CACHE_ROOT` 会拉长启动和 TTFT，但没有复现每步 `80ms` 空洞；用户提供的其他已 warm trace 也有同类现象。冷 compile/cache 只能解释启动慢或污染某些旧 artifact，不能解释稳定复现的 d-step 空闲。
  - 坏 trace 中部分 gap 同时覆盖 rank0 `async_output_busy_loop -> enqueue_output -> shm_broadcast.enqueue -> notify -> zmq.send`，部分 gap 覆盖 worker `shm_broadcast.dequeue/acquire_read` 或 `sample_tokens -> Sampler.forward -> greedy_sample/argmax`。
  - 单请求健康 run 只能作为负证据，不能当作问题消失：`hy3_ar_probe_enhanced_20260611_065813` 在 `num_prompts=1` 下 rank0/rank1 都没有 `>10ms && idle>90%` 的 inter-step gap，bench 也正常（TTFT 约 `925ms`，TPOT 约 `14.7ms`）。
    - 但最早 CLI 是 `--num-prompts 10`，且用户已有其他 warm trace 显示同类现象，所以复现/否定前必须先对齐 `num_prompts`、`extra_body`、输入长度、输出长度、profile 窗口和对方 trace 的 workload。
  - `num_prompts=10` 无 profiler 的健康 run 也只能作为负证据：`hy3_ar_noprof_np10_20260611_071832` 10/10 成功，Mean TPOT 约 `15.5ms`，Mean ITL 约 `6.7ms`。这说明普通 online graph workload 不必然复现旧 d-step 空洞；下次若要抓正证据，应先 warm 无 profiler 请求，再只 profile 一个后续请求，不要默认 profile 全 10 prompts。
- 以后追这类问题，先按同一个时间窗口做三层分类，不能凭肉眼截图下结论：
  1. GPU 层：合并 `kernel/gpu_memcpy/gpu_memset`，确认空白是否为全局 GPU idle，而不是单 stream artifact。
  2. Worker 层：列出 gap 内 worker 主线程和 async output 线程的 innermost CPU stack，区分 `sample_tokens`、`enqueue_output/zmq.send`、`shm_broadcast.dequeue/acquire_read`。
  3. Cross-rank 层：TP trace 必须用绝对 `ts` 对齐 rank0/rank1 的 inter-step gap，统计 peer overlap，而不是用各 trace 的相对时间肉眼比。若 >=50% gap 同步，说明至少存在 TP-wide synchronized idle；若不同步，优先查 rank-local output/RPC/sampling。
  4. Parent/core 层：同窗口加低开销 parent probe，覆盖 `schedule`、`rpc_broadcast_mq.enqueue`、`future.result/response_mq.dequeue`、`update_from_output`。只有 parent 阶段和 worker gap 对齐后，才允许写 root cause。
  5. Workload 层：复现实验必须记录并对齐 `num_prompts`、`request_rate`、`max_concurrency`、`extra_body`、随机输入/输出长度和多模态 bucket。单请求不复现不能推翻多请求 trace 的现象。
  6. 反证边界：健康 warm run 只能证明“该条件下不复现”，不能推翻用户/他人已经抓到的同类 trace。要否定某个根因，必须拿同一个复现窗口的 GPU idle、worker stack、parent phase 证据，而不是换 workload 后说没有看到。
