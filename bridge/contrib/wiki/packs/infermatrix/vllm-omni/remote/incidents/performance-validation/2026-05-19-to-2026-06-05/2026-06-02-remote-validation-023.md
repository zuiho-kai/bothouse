---
name: 2026-06-02-remote-validation-023
description: 2026-06-02 错题：HunyuanImage3 AR-only TP2 profiler 加 enable_ar_profiler kwarg 导致 StageEngineCoreProc 在 READY 前死亡，img2img 漏传 --image-path 到初始化后才报错，ops_rank xlsx 的 CUDA 列为空须改从 trace json 聚合 top10，且 profiler 单请求不替代 steady-state latency
metadata:
  scope: 只收 2026-06-02 AR profiler 初始化语义、必需输入校验与 profiler 产物可用性这几个问题；已有成功脚本被手写 runner 取代归 2026-06-02-remote-validation-022，可复用 runbook 归 2026-06-02-remote-validation-024
---
# 2026-06-02 — HunyuanImage3 AR profiler 不能改初始化语义，参数校验必须在启动前完成

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-02-remote-validation-023.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-02-remote-validation-023`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：HunyuanImage3 AR profiler 不能改初始化语义，参数校验必须在启动前完成
- 影响范围：repos/vllm-omni/remote
- **背景**：用户要求远程 `origin/main + #3767 overlay` 跑 HunyuanImage3 AR-only TP2 性能，并要 AR 阶段前 10 GPU 算子耗时和端到端开销。最终有效结果：

```text
latency_out=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_minpatch/summary.json
profile_out=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/report.md
path=AR-only offline img2img
tp=2
devices=0,1
input_image=/tmp/hy3_input_0_0.png
latency_mean=7.776s
stage_0_gen_ms_mean=7758.9ms
```

- **遇到的问题**：
  1. **把 profiler 开关当普通指标开关，污染初始化路径** 我在最小 patch 脚本里加入：

     ```python
     omni_kwargs["enable_ar_profiler"] = True
     ```

     - 结果 engine 在 READY 前失败：

     ```text
     RuntimeError: StageEngineCoreProc died during READY
     ```

     - 后来读源码确认 `enable_ar_profiler` 只影响 AR metrics merge，不是 torch profiler 必需条件。正确 profiler 方式是：只传 `profiler_config` 创建 worker profiler，然后在 engine READY 后调用 `omni.start_profile(stages=[0])` / `omni.stop_profile(stages=[0])`。
  2. **img2img 必需参数漏传，且校验发生在 engine 初始化后** 一轮 profiler relaunch 没传 `--image-path`，脚本花一分多钟完成 engine 初始化后才报：

     ```text
     ValueError: --image-path required for img2img, got: None
     ```

     - 这类 required input 应该在启动 engine 前 fail-fast。benchmark 脚本启动前也必须把原成功命令里的 input 参数完整复用，不允许只复制模型/deploy 参数。
  3. **`ops_rank*.xlsx` 存在不等于 CUDA 算子表可用** profiler 生成了 `ops_rank0.xlsx` / `ops_rank1.xlsx`，但表中 `self_cuda_time_total_us` 为空。最终有效 top10 是从 `trace_rank*.json` 的 `kernel` / `gpu_memcpy` / `gpu_memset` 事件聚合得到的，并额外保存：

     ```text
     <REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/top_gpu_kernels.json
     ```

  4. **profiler 单请求不能替代 steady-state latency** profiler main 请求 `stage_0_gen_ms=10430.6ms`，高于 10-run steady mean `7758.9ms`，这是 profiler overhead。最终报告必须分开：
     - 性能结论：用无 profiler 10-run summary。
     - 算子分布：用 profiler 单请求 trace。
- **硬规则**：
  1. HunyuanImage3 AR profiler 优先复用已成功 `end2end.py`，只做最小 patch；禁止为了 profiler 重写 runner。
  2. Torch profiler 只在 engine READY 后通过 `start_profile/stop_profile` 启停；不要随手打开会改变 engine 初始化行为的 profiling/metrics kwarg。任何新增 kwarg 必须读源码确认作用域。
  3. 启动长耗时 engine 前，先 fail-fast 校验 workload required inputs：`--image-path`、model snapshot、deploy YAML、prompt/sampling 参数、offline HF env。参数缺失不能等模型加载完才报。
  4. profiler artifact 要做 availability gate：
     - `ops_rank*.xlsx` 的 CUDA 列非空，才用 xlsx 聚合。
     - xlsx CUDA 列为空时，解析 `trace_rank*.json` 的 GPU kernel/mem events。
     - 不能把 CPU-only xlsx 表说成 GPU 算子 top10。
  5. 报告里必须拆开 steady-state benchmark 与 profiler trace：profiler run 只解释热点，不给最终 latency 结论。
- **正确处理模板**：

```text
Profiler scope:
- benchmark summary without profiler:
- profiler run:
- profiler overhead caveat:
- artifact availability:
  - xlsx cuda fields: available/unavailable
  - trace json: available/unavailable
- top10 source: xlsx/trace-json
```
