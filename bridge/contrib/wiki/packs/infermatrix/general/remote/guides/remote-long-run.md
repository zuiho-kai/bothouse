---
name: remote-long-run
description: 远端长测与 profiler gate：Configuration Scope Lock 与四层生效证据、有成功脚本先复用再谈自写 runner、profiler 只解释热点不替代 steady-state latency、profiler 报告模板
metadata:
  scope: 只收远端配置验证类长测的开跑前置条件、benchmark 入口复用顺序和 profiler 使用规则及对应反例；serving 启动 gate、watchdog 和清理归 serving-failfast-cleanup
---
# Plan & Validation · 远端长测与 profiler gate

## 关键事实

- 源页：`knowledge/general/remote/guides/remote-long-run.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, remote；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 远端长测配置验证：先证明字段进真实消费点，再跑完整 pytest

- 这类任务开跑前必须写 Configuration Scope Lock；没有这四行，不准启动长测：

```markdown
Configuration Scope Lock
- Version under test: <PR / commit>
- Config variable under test: <field + stage + value>
- Execution path: <pytest / endpoint / offline script>
- Effective evidence: <generated config -> normalized args -> runtime config -> worker log>
```

- 完整 accuracy / benchmark 前必须先拿到四层生效证据：

```text
generated config/YAML:     <field>=<value>
normalized engine args:   <field>=<value>
runtime model/vLLM config:<field>=<value>
worker/backend log:       actual backend/operator selected
```

- 任一层缺失或不一致，立即停止本轮，不准继续把完整 pytest 跑完。失败后下一次改动前必须写三行：

```text
失败信号：<exact log line>
当前假设：<why this failed>
下一次本质差异：<why the next attempt is not parameter tweaking>
```

- 设备和 cleanup 也是长测前置条件，不是失败后再补：
  - 非连续 `CUDA_VISIBLE_DEVICES` 必须显式写 stage devices，并打印 `stage -> physical GPUs`。不能假设框架会按自己理解 remap。
  - pytest / benchmark cleanup 如果按进程名扫描整个节点，必须先改成本轮已记录且验证归属的 PID/PGID；共享节点上不能靠“跑完再看”。
  - 10 分钟没有出现 scope lock 里的关键证据，先汇报卡点；20 分钟仍在改脚本，停下复盘，不继续试下一版。
- **一句话规则**：配置验证类长测的第一交付物是“字段确实进了真实消费点”，不是完整指标表。生效链路不闭合时，继续长跑只是在烧 GPU。

### 有成功脚本就先复用，禁止先手写等价 runner

- 以后 benchmark 有已有脚本时，执行顺序固定：

1. **复跑原脚本 1-request smoke**：证明当前机器、venv、worktree、模型 snapshot 仍可用。
2. **外包计时优先**：用 shell `/usr/bin/time`、日志 grep、重复调用原脚本，先拿可复现单请求数据。
3. **最小 patch 原脚本**：如需同一 engine 内 warmup+N 次，复制原脚本为临时文件，只在原结构中加入循环/计时，保留原 prompt build、sampling params、Omni kwargs。
4. **最后才自写 runner**：必须先和原脚本做 1-request parity，对齐 vLLM version、deploy YAML、sampling params、stop token、输出文本、stage init log。

- 禁止：
  - 看到原脚本能跑还重新实现 prompt / sampling / engine 初始化。
  - 把自写 runner 的初始化失败归因成模型/显存问题，除非原脚本同口径也失败。
  - 为了“更方便统计”引入新的 engine kwargs、profiler flag、`max_tokens`、deploy YAML 差异。
- **一句话规则**：benchmark 的第一目标是复用已证明能打到目标路径的入口；统计便利性排第二。已有脚本能跑，就不要先写“等价”脚本。

### Profiler 只解释热点，不能污染初始化或替代 steady-state latency

- 这轮 profiler 暴露三条规则：

1. **Profiler 不准改 engine 初始化语义**
   `enable_ar_profiler=True` 不是 torch profiler 必需条件，反而导致 READY 前失败。正确做法是传 `profiler_config`，等 engine READY 后调用 `start_profile(stages=[0])` / `stop_profile(stages=[0])`。任何新增 engine kwarg 必须先读源码确认它影响初始化还是只影响输出指标。
2. **长耗时 engine 前必须校验 workload required inputs**
   img2img 漏传 `--image-path` 时，脚本在 engine 初始化后才报 `ValueError: --image-path required for img2img`，浪费一轮模型加载。benchmark / profiler wrapper 必须在创建 `Omni(...)` 前校验 `image_path`、deploy YAML、model snapshot、prompt/sampling 等必需输入。
3. **Profiler artifact 要做 availability gate**
   `ops_rank*.xlsx` 存在不代表 CUDA 算子表可用；这次 xlsx 的 `self_cuda_time_total_us` 为空，最终 top10 是从 `trace_rank*.json` 的 `kernel` / `gpu_memcpy` / `gpu_memset` events 聚合得到的。报告必须写明 top10 来源，不能把 CPU-only xlsx 当 GPU op top10。

- Profiler 报告模板：

```markdown
Benchmark result:
- source: <summary.json>
- profiler: disabled
- conclusion: latency / stage time

Profiler result:
- source: <trace json or xlsx>
- profiler overhead: yes/no
- allowed conclusion: operator hotspot only
- xlsx cuda availability: available/unavailable
```

## 决策与踩坑

### 远端长测配置验证：2026-06-04 HunyuanImage3 Stage 0 SDPA 反例 / 修正

- **2026-06-04 HunyuanImage3 Stage 0 SDPA 反例 / 修正**：用户只要求在第 0 阶段重跑 `mm_encoder_attn_backend=TORCH_SDPA` 并打印确认生效。
  - 错误路线是先用 wrapper import pytest module 后 monkeypatch `_DEPLOY_CONFIG`，但 pytest 会重新 import 测试模块，wrapper 里的值不能证明真实 pytest 消费到了配置。
  - 第二轮又在 `CUDA_VISIBLE_DEVICES=2,3,5,6` 这种非连续物理卡上没显式写 stage devices，导致 stage 映射重叠、浪费一轮模型启动。

### 有成功脚本就先复用：2026-06-02 HunyuanImage3 AR-only TP2 反例 / 修正

- **2026-06-02 HunyuanImage3 AR-only TP2 反例 / 修正**：历史日志里已经有成功路径：

```text
examples/offline_inference/hunyuan_image3/end2end.py
deploy=/tmp/hy3_ar_only_tp2_offline_smoke.yaml
modality=img2img
bot_task=think_recaption
TP=2
```

- 错误做法是为了批量统计 latency 先手写 `/tmp/hy3_ar_offline_bench.py`，复制 prompt 构造和 `Omni.generate` 逻辑。
  - 结果引入了额外变量：venv/vLLM 包解析差异、`enable_ar_profiler` 默认值、sampling params / `max_tokens` / stop token 细节、初始化 memory gate 行为。
  - 连续失败都发生在 engine READY 前，而原始 `end2end.py` 复跑同一 TP2 smoke 成功，说明问题不是 AR 路径坏了，是自写 runner 没有做到 parity。

### Profiler：2026-06-02 HunyuanImage3 AR-only TP2 profiler 反例 / 修正

- **2026-06-02 HunyuanImage3 AR-only TP2 profiler 反例 / 修正**：最终有效性能口径是：

```text
version=origin/main + PR #3767 metrics overlay
path=HunyuanImage3 AR-only offline img2img
tp=2
latency_summary=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_minpatch/summary.json
profile_report=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260602_main3767_aronly_tp2_profile_rpc_img/report.md
```

- 性能结论来自无 profiler 的 10-run summary：

```text
e2e latency mean=7.776s, p95=7.914s
stage_0_gen_ms mean=7758.9ms, p95=7892.4ms
```

- 算子 top10 来自 profiler 单请求 trace；profiler main request 的 `stage_0_gen_ms=10430.6ms` 只用于热点分析，不能替代 steady-state latency。
