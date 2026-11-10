---
name: ar-only-tp2-benchmark-runbook
description: "HunyuanImage3 AR-only / TP2 远端 benchmark runbook（2026-06-02，main + PR #3767 metrics overlay）：Scope Lock 模板、远端 host/worktree/venv/模型路径、已有 artifacts、eager 与 graph 10-run 结果（e2e 7.776s 对 1.460s）、profiler 单请求热点口径与下次执行顺序"
metadata:
  scope: 只收 2026-06-02 这套 AR-only TP2 benchmark 的固定口径、远端事实、历史结果与复跑步骤；当前 d-step 调查机制归 ar-dstep-investigation，2026-06-08 的 graph online profiling 归 ar-graph-online-profiling-2026-06-08
---
# HunyuanImage3 AR-only TP2 benchmark runbook

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hunyuan-image3/history/ar-only-tp2-benchmark-runbook.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter
- **何时来翻**：只在明确要复用 2026-06-02 HunyuanImage3 AR-only / TP2 / PR #3767 metrics overlay 远端 benchmark 结果或刷新同一口径时读。当前机制见 [[ar-dstep-investigation]]（AR d-step 调查）。

### 适用场景

- 用户要求跑 HunyuanImage3 AR 部分性能，尤其是“远程 main + benchmark PR #3767 / AR-only / TP2 / 前 10 算子 / 端到端开销”。这套经验已经实测可用，下次先复用，除非远端路径或 HEAD 已明确失效。

### Scope Lock 固定模板

```text
Version under test: origin/main
Measurement patch/tooling: PR #3767 minimal metrics overlay
Execution path: HunyuanImage3 AR-only offline img2img
Valid metrics: e2e latency, stage_0_gen_ms, profiler top GPU kernels
```

### 已知可用远端事实

```text
host=root@<REMOTE_HOST> -p 31342
node=dedicated-developjob-4gpu-n7d58-5497984b6d-5z8tk
worktree=<REMOTE_WORK_ROOT>/wt-hy3-ar-bench-main
head=1fa8efde445c64e3a3b5256231f0e08703490853
venv=<OTHER_USER_ROOT>/vllm-omni-022/.venv
python=<OTHER_USER_ROOT>/vllm-omni-022/.venv/bin/python
model=/root/.cache/huggingface/hub/models--tencent--HunyuanImage-3.0-Instruct/snapshots/2ec2c78bee7d4b94157341fba86c4c2c7b1858b2
deploy=/tmp/hy3_ar_only_tp2_orig_smoke.yaml
input_image=/tmp/hy3_input_0_0.png
devices=0,1
tp=2
```

### 已知有效 artifacts

```text
steady_summary=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_minpatch/summary.json
profile_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/report.md
profile_dir=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img
trace_dir=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/profiler/20260602-035218_hy3_ar_stage0
top_gpu_kernels=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/top_gpu_kernels.json
graph_summary=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_minpatch/summary.json
graph_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_minpatch/report.md
graph_profile_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_profile/report.md
graph_profile_top_gpu_kernels=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_profile/top_gpu_kernels.json
```

### 已知有效结果

```text
steady 10-run, profiler disabled:
  e2e latency mean=7.776s, p95=7.914s, p99=7.927s
  stage_0_gen_ms mean=7758.9ms, p95=7892.4ms, p99=7910.3ms

profiler single main request:
  latency=10.452s
  stage_0_gen_ms=10430.6ms
  caveat=profiler overhead, hotspot only

graph mode 10-run, profiler disabled, deploy enforce_eager=false:
  e2e latency mean=1.460s, p95=1.505s, p99=1.532s
  stage_0_gen_ms mean=1441.1ms, p95=1485.1ms, p99=1510.7ms
  speedup vs eager mean: e2e +81.22%, stage_0 +81.43%
  init caveat: torch.compile 66.10s; AsyncOmniEngine init 163.74s

graph profiler single main request:
  latency=1.647s
  stage_0_gen_ms=1628.6ms
  caveat=profiler overhead, warmed compile/cache, hotspot only
  top kernels source=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_graph_profile/top_gpu_kernels.json
```

### 下次执行顺序

1. 只做快速有效性检查，不做全盘 discovery：

   ```bash
   ssh -p 31342 root@<REMOTE_HOST> '
   git -C <REMOTE_WORK_ROOT>/wt-hy3-ar-bench-main rev-parse HEAD
   test -x <OTHER_USER_ROOT>/vllm-omni-022/.venv/bin/python
   test -f /tmp/hy3_ar_only_tp2_orig_smoke.yaml
   test -f /tmp/hy3_input_0_0.png
   test -d /root/.cache/huggingface/hub/models--tencent--HunyuanImage-3.0-Instruct/snapshots/2ec2c78bee7d4b94157341fba86c4c2c7b1858b2
   nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv,noheader,nounits
   '
   ```

2. 若只要复述历史结果，直接读 `steady_summary` / `profile_report`，不要重跑。
3. 若要刷新结果，复用 `<REMOTE_WORK_ROOT>/wt-hy3-ar-bench-main/examples/offline_inference/hunyuan_image3/end2end_bench_minpatch_tmp.py` 或从原 `end2end.py` 复制最小 patch；禁止手写 `/tmp/hy3_ar_offline_bench.py` 类新 runner。
4. profiler 刷新时，使用 `end2end_bench_profile_rpc_tmp.py` 这种 READY 后 `start_profile/stop_profile` 方式；不要加 `enable_ar_profiler=True`。
5. img2img 必须传 `--image-path /tmp/hy3_input_0_0.png`，并在启动前 `test -f`。
6. `ops_rank*.xlsx` CUDA 列为空时，直接解析 `trace_rank*.json` 的 `kernel/gpu_memcpy/gpu_memset` events，复用 `top_gpu_kernels.json` 的口径。
7. 结束必须清理本次 PID 并确认 GPU 回空闲；不要 kill 非本次进程。
8. 用户说“图模式 / graph mode”时，复用 graph artifact；需要刷新时只复制 deploy 并把 `enforce_eager: true` 改成 `false`，其他参数沿用 runbook。图模式结果必须同时区分两类 artifact：无 profiler 10-run summary 负责端到端 / stage0 steady-state latency，profiler single-run trace 负责前 10 GPU kernel/op 热点；只交付 latency 不交付 top10 是不完整结果。
