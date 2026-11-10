---
name: performance-evidence-2
description: "性能与精度证据第 2 部分：Prometheus / 仪表盘 metric 的证据边界（PR #6150 denoise_step_latency_ms 在 profiler-off 下可能为零）、2026-05-21 HunyuanImage3 DiT grouped batching 反例（DiT-only smoke 1.078x 对 Official IT2I e2e 1.029x）、Performance Comparison 正确模板与自检问题、benchmark 程序验收（计时边界、nearest-rank 分位数、失败语义、隔离证据、结果完整性，PR #5052）"
metadata:
  scope: 只收 metric 证据边界、grouped batching 性能表反例和 benchmark 测量器自身的验收要求；Evidence Matrix 模板与 PR 测试写法归 performance-evidence-1，合批语义验证归 dynamic-batching-validation
---
# 性能与精度证据（2/2）

## 关键事实

- 拆分说明：本页是源页 `performance-evidence.md` 的第 2/2 部分；第 1 部分 [[performance-evidence-1]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/performance-evidence.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-20

### 仪表盘 metric 的证据边界

- Prometheus family 的实现、unit test 或 scrape 成功只证明测量路径的 wiring；不证明吞吐、latency 改善、显存收益、图像质量或模型质量。将新的 image/diffusion service metrics 写入性能或评估结论前，Evidence Matrix 还必须锁定 collector 是否由 `--log-stats` 启用、profile 开关、metric 的时间边界、缺失 versus 实测零、Prometheus query/window 和与 request/result artifact 的对应关系。
- 尤其不要把 `stage_gen_time`、scheduler/request queue wait、service request time、forward denoise time 或 `*_per_step` 当作同一个量：前者可包括 queue/async wait，纯 forward 又可能在 profiler off 时 unavailable。PR #6150 留有一个未解决的 inline review：默认 profiler-off 路径的 benchmark-side `denoise_step_latency_ms` 可能显示为零。
  - 因此该字段在修复或明确标记 unavailable 前不能用于比较、回归阈值或“无 denoise 耗时”的结论。^[Issue #5811] ^[PR #6150]
- **正确模板**：

```markdown
### Performance Comparison

Input: <official fixture / user input>
Requests: <N>
Timing scope: `omni.generate(...)` only; model init excluded.
Only changed knobs: <baseline knobs> vs <grouped knobs>.

| Mode | max_num_seqs | diffusion_batch_size | Elapsed | Throughput |
| --- | ---: | ---: | ---: | ---: |
```

- **自检问题**：
  - 这组数字来自哪个脚本？
  - 这组输入是不是用户要求的“官方输入”？
  - request 数和 batch knobs 是否与结论一致？
  - 这是 DiT-only 还是 full AR-to-DiT？
  - 表格标题有没有把 smoke 写成 e2e？

### Benchmark 程序本身也必须验收

- 性能脚本能打印数字，不等于数字和 PASS/FAIL 判定可信。新增或修改 benchmark 时，先用小型确定性输入验收测量器，再投入昂贵环境。^[PR #5052]
- **计时边界**：warmup、compile、首次连接和模型初始化必须位于正式 wall-clock 起点之前；若目标就是 cold-start，必须单独命名指标，不能混进 steady-state throughput。
- **分位数**：小样本使用 nearest-rank 或成熟统计实现。`int(q*n)-1` 会把两样本 p90 错算成最小值；测试至少覆盖 1、2 和奇偶样本数。
- **失败语义**：零成功、请求异常或隔离校验失败必须非零退出。打印错误后返回 0 会让 CI 和外层脚本把坏数据归档成成功结果。
- **隔离证据**：replica/data-parallel 请求使用不同输入和 seed，各自与单副本 baseline 对齐，并要求完整 key-set equality。相同 prompt/seed/hash 只能证明结果相同，不能证明请求没有串线；结果是 baseline 真子集也不能通过。
- **结果完整性**：报告请求总数、成功数、失败数、结果 key 集和统计样本数；任何一项与计划矩阵不一致都先失败，不计算漂亮的 percentile。
- 最小验收应故意注入一次请求失败、一个缺失结果 key、两样本 p90 和一次 timed warmup，证明脚本分别拒绝前三者并把 warmup 排除在正式窗口外。完整 grouped/replica 语义还要结合 [[dynamic-batching-validation]]（dynamic batching validation） 和 [[evidence-gate]]（evidence gate）。

## 决策与踩坑

### 仪表盘 metric 的证据边界

- **2026-05-21 HunyuanImage3 DiT grouped batching 反例**：
- 我先把 DiT-only 英文 prompt 的性能表写成 PR 主性能结论：

```text
DiT-only smoke: 51.118s -> 47.426s, speedup=1.078x
```

- 用户要求官方提示词后才发现这不是 official IT2I full pipeline 口径。重新用官方 IT2I prompt + Tencent demo input images + 两个 request + 同样 seed/steps/guidance 跑 baseline/grouped，结果变成：

```text
Official IT2I e2e: 188.042s -> 182.690s, speedup=1.029x
```

- 这两组数据都真实，但能支撑的结论不同。前者只能证明 DiT-only grouped path 在临时 prompt 上能跑且有收益；后者才是官方输入 full IT2I grouped batching 的性能证据。
