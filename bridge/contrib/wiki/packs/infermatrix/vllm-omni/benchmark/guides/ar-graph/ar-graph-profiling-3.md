---
name: ar-graph-profiling-3
description: AR graph serve / profiling 状态机第 3 部分：Graph mode profiling 先纯 graph 再包请求窗口——启动前 ninja / vllm gate、READY 证据、同轮 provenance gate 模板、start_profile / stop_profile 请求窗口命令、正式 profiler_config 示例（默认不加 max_iterations）、bounded smoke trace 不能当正式 trace
metadata:
  scope: 只收 enforce_eager=false 图模式下的 serve 与 online profiler 采集机制；2026-06-08 的具体远端参数和指标归 ar-graph-online-profiling-2026-06-08，通用 gate 归 ar-graph-profiling-1，状态机与 artifact 顺序归 ar-graph-profiling-2
---
# Remote Debug · AR graph serve / profiling 状态机（3/3）

## 关键事实

- 拆分说明：本页是源页 `ar-graph-profiling.md` 的第 3/3 部分；第 1 部分 [[ar-graph-profiling-1]]；第 2 部分 [[ar-graph-profiling-2]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/ar-graph-profiling.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### AR graph serve / profiling 必须按状态机推进

#### Graph mode profiling：先纯 graph，再包请求窗口

- 2026-06-08 HunyuanImage3 AR graph serve / profiler 的具体远端参数、artifact、错误签名和指标已经下沉到 [[ar-graph-online-profiling-2026-06-08]]（archive/hunyuan/ar_graph_online_profiling_20260608.md）。本页只保留机制。
- 用户说“图模式 / graph mode / enforce_eager=false”时，先跑最小变量，不要直接上 profiler：
  1. 纯 graph serve：只改 graph 开关和必要启动参数。
  2. 启动前 gate：`command -v ninja`、`ninja --version`、`command -v vllm`，并记录 `PATH`、`VLLM_CACHE_ROOT`、chat template 绝对路径。
  3. READY 阶段证据：device mapping、`enforce_eager=False`、compile/cache 日志、graph capture finished、orchestrator ready、`/health`。
  4. 失败时先切 worker root cause，不把所有 `READY` 前失败都写成 timeout。
  5. 1 request smoke 过后再 10 request benchmark；smoke 指标和正式 benchmark 指标分开报。
- 图模式 trace 还要做同轮 provenance gate，避免把 eager trace 和 graph benchmark 混成一个结论：

```text
run dir: <same directory for server log, request json, trace>
mode evidence:
  - server command/log has no --enforce-eager
  - server log has "Model runner: transformer compiled with torch.compile"
request evidence:
  - target request json/log status 200
  - target workload matches user scope
trace evidence:
  - trace_rank*.json(.gz) mtime is after /start_profile and before/after /stop_profile export log
  - profiler_out_* exists when torch profiler writes one
  - event_count / category summary confirms aten + CUDA runtime/kernel
cleanup evidence:
  - actual server PID/PGID gone, not only outer shell PGID
  - GPU memory released or remaining owner identified
```

- 如果任一项缺失，不能说“开图 profiling 已完成”。只能分别说清楚：graph benchmark 是否完成、trace 是否存在、trace 是否属于 graph mode、资源是否释放。
- 只有纯 graph 路径可用后，才跑 online profiler。正式 trace 的采集窗口必须包住目标请求，不是 worker iteration 截断窗口：

```bash
# 1. serve 已经 /health=200，且日志有 Profiler endpoints are enabled
curl -fsS -X POST http://127.0.0.1:8091/start_profile \
  -H 'Content-Type: application/json' \
  -d '{"stages":[0]}'

# 2. 发目标 workload 请求：必须是用户要分析的真实请求
# AR chat: /v1/chat/completions + openai-chat-omni
# t2i / it2i: 用对应真实 /v1/images/* 或用户指定脚本，不要拿 random-mm smoke 代替
<run target request/bench>

# 3. 目标请求完成后立刻 stop
curl -fsS -X POST http://127.0.0.1:8091/stop_profile \
  -H 'Content-Type: application/json' \
  -d '{"stages":[0]}'
```

- 正式 profiler config 默认不要加 `max_iterations`，除非用户明确接受“只采样前 N 个 worker step”。示例：

```yaml
profiler_config:
  profiler: torch
  torch_profiler_dir: /tmp/<run>/torch_profile
  torch_profiler_use_gzip: false
  torch_profiler_record_shapes: false
  torch_profiler_with_memory: false
  torch_profiler_with_stack: true
  torch_profiler_with_flops: false
  torch_profiler_dump_cuda_time_total: false
  ignore_frontend: true
```

- 如果正式 trace 太大/worker 死亡，先报告“完整请求窗口采集失败”和服务端 root cause；再和用户确认是否降级为 bounded sample。不要自行改短请求或加 `max_iterations` 后把结果当正式 trace。
- bounded smoke trace 只能证明 profiler endpoint、rank trace、导出逻辑可用；不能交付为正式性能 trace，也不能拿它解释完整请求窗口。正式 trace 验收要按 event 维度，而不是按“有文件”验收：原始 trace size、event_count、category_top、pid/tid_count、rank 覆盖、CUDA runtime/kernel/NCCL/vLLM/Omni category 都要列出来。
- `/stop_profile` 返回成功也不等于资源释放；必须按本页 artifact / resource 顺序清 PGID、查残留 worker PID、复查端口和 GPU。
