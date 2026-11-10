---
name: ar-graph-online-profiling-2026-06-08
description: "2026-06-08 HunyuanImage3 AR graph（enforce_eager: false）online serve 与 /start_profile profiler 的远端结果：最小 graph perf（10/10 成功、10.19 tok/s、TTFT 2980.83ms）、耗时长的五个原因（相对 chat template 路径、PATH 缺 ninja 等）、serve 与 deploy_config 模板、profiler 须带 profiler: torch、正式 trace 1.2GB/rank 与显存残留教训"
metadata:
  scope: 只收 2026-06-08 这一轮远端 graph serve 与 online profiler 的具体结果、路径与错误签名；当前机制归 ar-graph-profiling-1、ar-graph-profiling-2、ar-graph-profiling-3，2026-06-02 的 AR-only TP2 benchmark 归 ar-only-tp2-benchmark-runbook
---
# HunyuanImage3 AR graph online profiling · 2026-06-08

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/ar-graph-online-profiling-2026-06-08.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
- **何时来翻**：只在需要复用 2026-06-08 HunyuanImage3 AR graph serve / online profiler 的具体远端结果、artifact、路径或错误签名时读。当前机制见 [[ar-graph-profiling-1]]、[[ar-graph-profiling-2]]、[[ar-graph-profiling-3]]（AR graph profiling）。

### 最小 graph perf 结果

- 本轮用户要求的是最小图模式 AR perf：`hunyuan_image3_ar` + `enforce_eager: false` + `vllm serve` + `vllm bench serve` 打 `/v1/chat/completions`。最终跑通结果：

```text
remote: root@<REMOTE_HOST> -p 31342
serve out: /tmp/hy3_ar_graph_normal_retry_ninja_20260608_072328
local artifact: artifacts/hy3_ar_graph_normal_retry_ninja_20260608_072328_bundle.tar.gz
bench: 10/10 success, duration 236.21s, output throughput 10.19 tok/s, mean TTFT 2980.83ms, mean TPOT 96.57ms
```

- 这次耗时长的真实原因不是 `enforce_eager: false` 配置复杂，而是排查过程违反了单变量原则：
  1. 相对 chat template 路径先把服务挡在入口外；HunyuanImage3 AR serve 一律用绝对路径：`<REMOTE_WORK_ROOT>/vllm-omni/hunyuan_image3_i2t.jinja`。
  2. profiler 和 graph startup 混跑污染判断；正确顺序是纯 graph serve health + 1 request smoke + 10 request bench，profiling 另起一轮。
  3. 旧 torch compile cache 会制造假信号；每轮 graph 调试要显式设置或记录 `VLLM_CACHE_ROOT`。
  4. timeout 只能解决等待窗口，不能掩盖真实 worker traceback。
  5. 最终 blocker 是 PATH 不是包缺失；`ninja` 包已安装在 `<REMOTE_WORK_ROOT>/.venv`，但 serve 进程 PATH 没有 `<REMOTE_WORK_ROOT>/.venv/bin`。
- 启动前 gate：

```bash
export PATH=<REMOTE_WORK_ROOT>/.venv/bin:$PATH
command -v ninja
ninja --version
```

- 最小稳定 graph serve 模板：

```bash
export PATH=<REMOTE_WORK_ROOT>/.venv/bin:$PATH
export CUDA_VISIBLE_DEVICES=2,3
export VLLM_ALLREDUCE_USE_FLASHINFER=0
export VLLM_CACHE_ROOT=/tmp/<run>/vllm_cache

<REMOTE_WORK_ROOT>/.venv/bin/vllm serve tencent/HunyuanImage-3.0-Instruct \
  --omni \
  --port 8091 \
  --trust-remote-code \
  --deploy-config /tmp/<run>/deploy_config.yaml \
  --chat-template <REMOTE_WORK_ROOT>/vllm-omni/hunyuan_image3_i2t.jinja \
  --chat-template-content-format openai \
  --moe-backend triton \
  --compilation-config '{"pass_config":{"fuse_allreduce_rms":false}}'
```

- `deploy_config.yaml` 里只用这个 graph 开关：

```yaml
pipeline: hunyuan_image3_ar
async_chunk: false

stages:
  - stage_id: 0
    is_comprehension: true
    final_output: true
    final_output_type: text
    max_num_seqs: 128
    gpu_memory_utilization: 0.9
    trust_remote_code: true
    enforce_eager: false
    enable_prefix_caching: false
    max_num_batched_tokens: 32768
    devices: "0,1"
    tensor_parallel_size: 2
```

- graph serve ready 的阶段证据按这个顺序看：

```text
Stage 0 logical-to-physical device mapping: 0->2, 1->3
enforce_eager=False
CompilationMode.VLLM_COMPILE
Using cache directory: ... for vLLM's torch.compile
torch.compile took ...
Initial profiling/warmup run took ...
Graph capturing finished ...
init engine (profile, create kv cache, warmup model) took ...
[AsyncOmniEngine] Orchestrator ready with 1 stages
Application startup complete
GET /health ... 200 OK
```

- 如果失败，先切真实 worker root cause，不要只看外层 `StageEngineCoreProc died during READY`：

```bash
grep -n "WorkerProc hit an exception\|FileNotFoundError\|IndexError\|RuntimeError: Worker failed" "$OUT/serve.log"
sed -n '<worker-error-start>,<worker-error-end>p' "$OUT/serve.log"
```

- 执行纪律：
  1. 用户说“图模式就是改 `enforce_eager: false`”时，先按这个最小变量跑通，不要先引入 profiler。
  2. 启动前 gate 必须加 `command -v ninja`、`ninja --version`、`command -v vllm`，并把输出落到 `$OUT/ninja_path.txt` / `$OUT/scope.txt`。
  3. 第一次冷启动编译慢是正常现象；命中 AOT cache 后 `torch.compile` 应明显缩短。本轮从 `660.79s` 降到 `38.69s`。
  4. bench 前先 1 request smoke；smoke 过了再跑正式 10 requests。同一轮不要把 smoke 指标和正式指标混报。
  5. 结束必须打包 `$OUT`、拉本地、杀本轮 PGID、查端口和 GPU。最终汇报必须包含本地 artifact 路径和资源释放证据。

### Online profiler 结论

- 本轮在 `hunyuan_image3_ar` + `enforce_eager: false` + `vllm serve` 路径上验证了 vLLM/Omni 自带 `/start_profile` / `/stop_profile`。结论：
  1. `profiler_config` 必须在 AR stage YAML 里显式带 `profiler: torch`；少这个字段会在 `VllmConfig` 校验时报：`torch_profiler_dir is only applicable when profiler is set to 'torch'`。
  2. graph serve 本身仍然要先等 READY：本轮 profiler-capable graph serve ready 约 18-20 分钟，其中权重加载约 430s、AOT cache load 后 `torch.compile` 约 40s、CUDA graph capture 约 100-125s。
  3. 正式 trace 的采集窗口是请求窗口，不是 worker iteration 截断窗口。
  4. `max_iterations` / 短 output 只能用于 plumbing smoke，证明 profiler endpoint、rank trace、导出逻辑可用；不能交付为正式性能 trace。
- 这轮 bounded smoke artifact 是 `trace_rank0.json` / `trace_rank1.json`，各约 140MB，约 51 万 events，包含 `python_function`、`cpu_op`/`aten::`、CUDA kernel、NCCL。它只证明 plumbing，不符合用户预期的 900MB-1GB 正式请求 trace。`stacks_cpu/cuda_rank*.txt` 为空不能单独判失败；要读 Chrome trace 的 event category 和 name。
  - 交付前必须保存 `trace_quality_summary.json`。
- 正式 online trace 重跑补充：
  1. **graph cache 是启动口径的一部分**：不要为了每轮输出整洁就随手把 `VLLM_CACHE_ROOT` 指到新的 `$OUT/vllm_cache`。本轮因此触发 cold compile，日志显示 `torch.compile took 628.31 s`，而此前复用 cache 的图模式启动里 compile 约 38 秒。
  2. **stop_profile 返回不等于资源释放**：本轮 `/stop_profile` 成功导出 1.2GB/rank trace 后，`kill -TERM -$server_pgid` 只让 API server 退出，GPU2/3 仍残留本轮 Worker_TP0/TP1 约 137GB 显存。释放规则必须是：先 kill 本轮 PGID，再查 `nvidia-smi --query-compute-apps`；若仍有本轮日志里的 worker PID，占用 GPU2/3，按 PID 精确清掉并复查端口/GPU。
  3. **正式 trace 质量摘要要按 event 维度验收**：本轮合格 trace 为 `trace_rank0.json=1242319241 bytes`、`trace_rank1.json=1231842274 bytes`，分别约 421.9 万 / 417.8 万 events，包含 `python_function`、`cpu_op`/`aten::`、CUDA runtime/kernel、NCCL、vLLM/Omni 事件。
     - 交付时必须同时给原始 trace size、event_count、category_top、pid/tid_count 和本地 artifact 路径。
