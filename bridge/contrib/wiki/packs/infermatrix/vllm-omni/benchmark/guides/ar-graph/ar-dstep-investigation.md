---
name: ar-dstep-investigation
description: HunyuanImage3 AR graph d-step 性能分析的下次执行模板：Scope Lock 模板、30 分钟诊断漏斗（启动 / trace 质量 / step 内 gap / step 间 gap / input-prep）、低开销 JSONL probe 环境变量与必写字段、何时导正式 torch trace、结论证据等级写法、8 条加速规则，以及 timestep_mask.sum().item() 同步点已证明已解决与仍未解决的 tail gap
metadata:
  scope: 只收 d-step 空闲类任务的执行顺序模板和 10 小时分析的结论边界；逐类 gap 的归因分类规则归 ar-graph-gap-analysis，AR graph serving 与 profiling 的运行步骤归 ar-graph-profiling-1
---
# HunyuanImage3 AR D-Step 调查

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/ar-dstep-investigation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### HunyuanImage3 AR graph d-step 性能分析：10 小时 goal 的下次执行模板

- **触发条件**：用户给 Perfetto/Chrome trace 截图，指出 HunyuanImage3 AR graph decode step 里 GPU 空闲、短 memcpy、`cudaMemcpyAsync -> HtoD` 中间空白，要求判断能不能优化。
- 这类任务不要先导 1GB torch trace，也不要先改代码。先按 30 分钟内可收敛的诊断漏斗推进。

##### 0. 先写 Scope Lock

```text
Performance Analysis Scope
- mode: HunyuanImage3 AR-only graph online
- server: vllm serve + hunyuan_image3_ar + enforce_eager=false
- endpoint: /v1/chat/completions
- workload: num_prompts / request_rate / max_concurrency / input_len / output_len / image bucket / extra_body
- target symptom: step-internal idle | inter-step idle | startup delay | profiler export delay
- current evidence: screenshot | existing trace | no-profiler benchmark | profiler trace
- success criteria: root-cause class + proof window + next optimization candidate
```

- 如果 scope 里 `target symptom` 写不清，禁止开长跑。先问自己：用户看到的是启动慢、请求慢、step 内 GPU 空、step 间 GPU 空，还是 trace 导出慢。

##### 1. 第一阶段只用现成 artifact 或轻量 probe

- 前 30 分钟目标不是“生成完整 trace”，而是判断问题属于哪一类：
  1. **启动问题**：看 `weight loading`、`torch.compile`、`graph capture`、`engine init`、`API startup`。`VLLM_CACHE_ROOT` cold/hot 必须记录。
  2. **trace 质量问题**：看 event_count、rank0/rank1、pid/tid、python stack、aten、CUDA runtime/kernel、NCCL。文件存在不等于可分析。
  3. **step 内 gap**：按 decode step window 统计全局 GPU busy/idle，过滤 worker 主线程，定位 `_prepare_inputs`、`cudaGraphLaunch`、`set_forward_context`、mm-prefix metadata。
  4. **step 间 gap**：按 rank0/rank1 绝对时间对齐，查 `sample_tokens`、async output、RPC dequeue/enqueue、parent/core phase。
  5. **input-prep 周期性长耗时**：先用低开销 JSONL probe，不先开 full torch profiler。
- 推荐先跑：

```bash
PROFILE_NUM_PROMPTS=10 \
STOP_PROFILE_ENABLED=0 \
AR_DECODE_DIAG_MIN_MS=0.5 \
AR_DECODE_DIAG_WRAP_TENSOR_ITEM=1 \
AR_DECODE_DIAG_ITEM_STACK_MS=50 \
PYTHONPATH=/tmp/ar_diag_probe:$PYTHONPATH \
<serve + bench run>
```

- probe 必须同时写：
  - `perf_counter_ns`
  - `time.time_ns` / `wall_ns`
  - rank / pid / tid
  - phase name
  - path split，例如 `cuda_graph.wrapper_call path=no_graph|capture|replay`
  - slow `.item()` stack
- 只写 `perf_counter_ns` 会导致无法按 `/start_profile`、`bench_start`、`bench_end` 精确裁剪窗口。

##### 2. 再决定是否导正式 torch trace

- 只有轻量 probe 证明存在目标窗口后，才导完整 trace：

```text
warmup outside profiler
start_profile
target request or fixed bench window
stop_profile
trace quality gate
resource cleanup
```

- 不要默认 profile 全 10 prompts。如果用户关心单条请求，profile 一条 target request；如果问题只在 `num_prompts=10` 复现，先用 no-profiler + low-overhead probe 定位，再决定是否接受大 trace 成本。

##### 3. 结论必须按证据等级写

- 允许写：
  - “同一窗口中，全局 GPU idle、worker 主线程 stack、parent/core phase 三者对齐，因此候选是 X。”
  - “`torch.Tensor.item` 慢记录全部命中 `hunyuan_image3.py` 的 `timestep_mask.sum().item()`，单次约 198-205ms，属于 CPU 读 GPU scalar 的同步点。”
  - “patch 后 `Tensor.item >50ms` 从 18 降到 0，证明这个同步点是真实来源之一，但剩余 `_execute_mm_encoder` / graph launch tail 是另一类问题。”

##### 4. 下次加速规则

1. 先复用现成 trace / artifact，不重跑 GPU。
2. 重跑前锁 workload：`num_prompts`、`extra_body`、输入长度、输出长度、多模态 bucket。
3. 先低开销 probe，后 full trace。
4. 先 no-profiler benchmark，后 profiler 归因。
5. 先 main-thread-only / rank-aligned / wall-clock-window 过滤，后看截图。
6. instrumentation 先无 GPU import gate；`sitecustomize.py` 只能有一个入口，多个 probe 必须合并成 env flag。
7. 任何诊断补丁都必须有反向控制组：no-probe、async-on/no-waitall、async-off 或 patch-on/off，不能单轮定因。
8. 10 分钟内没有进入目标证据层，就停下汇报 blocker；不要用“还在跑”替代进展。

##### 5. 这次真正解决了什么

- 这次 10 小时分析最终只证明并解决了一类问题：
  - 已证明：`embed_input_ids()` 里的 `timestep_mask.sum().item()` 是一类真实 CPU-GPU 同步点。
  - 已解决：改成 GPU `torch.where(...)` 后，`Tensor.item >50ms` 从 `18` 降到 `0`，相关总耗时从 `50.25s` 降到 `0.36s`，no-profiler 端到端吞吐约 `+4%`。
  - 未解决：所有 d-step tail gap。剩余问题仍可能在 `cudaGraphLaunch` / graph replay 边界、mm-prefix metadata、input-prep 等待、async output / sampling / TP phase skew。
- 因此下次不要把“GPU 空闲”当成一个问题整体优化。必须先分桶，再逐桶证明。

## 决策与踩坑

### HunyuanImage3 AR graph d-step 性能分析：10 小时 goal 的下次执行模板

##### 3. 结论必须按证据等级写

- 禁止写：
  - “看起来在等 copy。”
  - “GPU 停了，所以是图慢。”
  - “单请求不复现，所以问题不存在。”
  - “启动有 JIT warning，所以 d-step gap 是 JIT。”
  - “trace 上后台线程长条很宽，所以后台线程是根因。”

##### 5. 这次真正解决了什么

- **禁止重犯**：
  - 不准再引入 PR3938，除非用户明确要求对比 PR3938。
  - 不准把 profiler 单请求 latency 当 steady-state 结果。
  - 不准从 `/v1/images/edits` 或 serving endpoint 重新探索 AR-only；本 runbook 的路径是 offline AR-only。
  - 不准因 4 卡可用就改成 TP4；用户已明确 TP2 就行，除非用户重新指定。
  - 不准把 graph mode 的一次性 compile/init 时间混进 per-request latency；报告必须分开 init cost 和 steady-state latency。
  - 不准把 eager profiler 的 top10 复用成 graph top10；graph/eager 各自需要对应模式的 profiler trace。
