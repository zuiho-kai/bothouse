---
name: ar-graph-online-2026-06-09-no-profiler
description: 2026-06-09 HunyuanImage3 AR graph 无 profiler online 对照：timestep_mask.sum().item() patch 对 baseline 吞吐 65.65 到 68.76 tok/s（+4.7%）、TTFT/TPOT/ITL 表，及来回 checkout 打掉 AOT cache 的坑
metadata:
  scope: 只收 2026-06-09 no-profiler baseline/patch 同机对照的口径、结果表、结论和下一步追法；带 profiler 的 patch trace 对照归 ar-graph-online-2026-06-09-timestep-patch，tail gap 后续追踪归 ar-graph-online-2026-06-10-tail-gap
---
# AR Graph No-Profiler 对照

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/results/ar-graph-online-2026-06-09-no-profiler.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### AR graph no-profiler patch 对照（2026-06-09）

- 用户指出正确定量口径应先看不带 profiler 的 online benchmark。补跑同机同脚本 no-profiler 对照：
  - baseline artifact：`/tmp/hy3_ar_gap_noprofile_baseline_20260609_080810/`
  - patch artifact：`/tmp/hy3_ar_gap_noprofile_patch_20260609_081248/`
  - GPU：`CUDA_VISIBLE_DEVICES=2,3`
  - deploy：`hunyuan_image3_ar`，`enforce_eager: false`，TP=2，`devices: "0,1"`
  - benchmark：warmup `num_prompts=1`，target `num_prompts=5`，`random-mm`，`1024x1024x1 image`，`random_input_len=256`，`random_output_len=512`，`max_concurrency=1`，`ignore_eos`
  - 远端只临时 checkout 单文件 patch；跑完后已恢复 `hunyuan_image3.py`，GPU2/3 回到 `4 MiB`
- 结果：

| Metric | Baseline | Patch | Delta |
|---|---:|---:|---:|
| Startup wall | `126s` | `126s` | flat |
| Model loading | `38.51s` | `41.35s` | noise / IO |
| torch.compile | `14.29s` | `14.76s` | both recompiled |
| Graph capture | `10s` | `9s` | flat |
| Engine init | `115.20s` | `115.30s` | flat |
| Benchmark duration | `20.08s` | `19.17s` | `-4.5%` |
| Output throughput | `65.65 tok/s` | `68.76 tok/s` | `+4.7%` |
| Mean TTFT | `765.88ms` | `651.06ms` | `-15.0%` |
| Mean TPOT | `14.06ms` | `13.77ms` | `-2.1%` |
| Mean ITL | `6.35ms` | `6.22ms` | `-2.0%` |
| P99 ITL | `7.74ms` | `7.65ms` | `-1.2%` |

- 结论更新：
  - `timestep_mask.sum().item()` patch 在真实 no-profiler 路径上也有小幅收益：吞吐约 `+4.7%`，TPOT/ITL 约 `2%` 改善。它不是纯 trace artifact。
  - 收益不大，和 trace 结论一致：它消掉的是每步 scalar sync 的中位 idle，但 tail gap 仍在 `cudaGraphLaunch` / graph replay 提交处。
  - 两次启动都约 `126s`，并且日志都出现 “Source code has changed since the last compilation. Recompiling the model.”。这解释了本轮启动没有接近理想 `~90s`：baseline/patch 来回 checkout 改源文件会打掉 AOT cache 命中。稳定 benchmark 不要在同一个 worktree 上频繁来回改源码；应固定两个 worktree/两个 cache key，或服务复用后只重启必要对照。

## 待办

### AR graph no-profiler patch 对照（2026-06-09）

- 下一步追法：
  1. 不再围绕短 `Memcpy DtoD` 做主优化；它每步总量只有百微秒量级，主要是 gap 边界信号。
  2. 用 patch 版本继续抓带 stack trace 的小窗口，只看 p90/p99 大 gap：把每个大 gap 前后的 CPU 栈和 `cudaGraphLaunch` duration 拉出来，确认是 graph replay 提交慢、CPU 调度被阻塞，还是某个 replay 前准备逻辑仍在同步。
  3. 再做一个“服务不重启”的复用测法：同一 server 连续 warmup + target 3 轮，排除 engine 冷启动、compile cache、首次 JIT 对请求吞吐的影响。
  4. 如果要继续写代码，优先级是把 graph replay 前的同步点做 census：搜索 decode path 里的 `.item()`、`.tolist()`、`nonzero`、`cudaStreamSynchronize`、`cudaEventSynchronize`，逐个用 trace parent-chain 证明是否落在 step gap 内；没有 trace 证据的不改。
