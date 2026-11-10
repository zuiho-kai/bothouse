---
name: ar-graph-online-2026-06-10-tail-gap
description: 2026-06-10 HunyuanImage3 AR graph tail gap 追踪：短 Memcpy DtoD 只是边界信号、空白由 cudaGraphLaunch 覆盖的 gap/launch 分位数表，排除 PIECEWISE 与 disable_custom_all_reduce，机制模型和不能切 input_ids 的原因
metadata:
  scope: 只收 2026-06-10 这轮 launch cadence 分析的脚本、证据表、解释、已排除配置、机制模型和下一步；baseline trace 细节归 ar-graph-online-2026-06-09-trace，PR 证据写法归 ar-graph-online-2026-06-12-evidence
---
# AR Graph Tail Gap 追踪

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/results/ar-graph-online-2026-06-10-tail-gap.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### AR graph tail gap 继续追踪（2026-06-10）

- 新增只读分析脚本：
  - `.scratch/analyze_ar_launch_cadence_stream.py`
  - patch trace 输出：`.scratch/ar_launch_cadence_stream_patch_20260610.txt`
  - baseline trace 输出：`.scratch/ar_launch_cadence_stream_baseline_20260610.txt`
- 这轮追踪回答“用户看到的每个 decode step 中 3 次短 memory copy 后 GPU 空闲，到底是不是 copy 本身导致”。结论是：短 `Memcpy DtoD` 是 graph replay 前的边界信号，不是主耗时本体；真正覆盖空白的是 `cudaGraphLaunch`。
- 关键证据：

| Trace | Rank | gap p50 | gap p90 | gap p99 | `gap>=1ms` steps | launch p50 | launch p90 | launch p99 | launch sum |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 0 | `1.415ms` | `1.470ms` | `3.392ms` | `489/511` | `1.216ms` | `1.250ms` | `3.192ms` | `672.940ms` |
| baseline | 1 | `1.400ms` | `1.429ms` | `3.338ms` | `489/511` | `1.205ms` | `1.231ms` | `3.142ms` | `665.505ms` |
| patch | 0 | `1.4us` | `1.427ms` | `3.127ms` | `118/511` | `1.217ms` | `1.277ms` | `3.036ms` | `671.170ms` |
| patch | 1 | `0.3us` | `1.411ms` | `2.960ms` | `122/511` | `1.233ms` | `1.677ms` | `3.041ms` | `691.184ms` |

- 解释：
  - baseline 里几乎每步都是 `>=1ms` gap，是 `timestep_mask.sum().item()` 把 graph replay 前的等待变成常态。
  - patch 后慢 gap 数从 `489/511` 降到约 `120/511`，说明 scalar sync 已经被消掉；剩下的 p90/p99 tail 不是 patch 新引入的。
  - patch 里 `gap>=1ms` 的总 gap 基本由 launch 覆盖：
    - rank0：`gap_sum=184.456ms`，`launch_sum=171.808ms`
    - rank1：`gap_sum=189.324ms`，`launch_sum=182.378ms`
  - 所有 top slow rows 都是同一个 GPU 边界：`Memcpy DtoD (Device -> Device)` 后，下一段 `triton_red_fused_rms_norm_0` 前。
  - 慢 step index 的 diff 以 `3` 居多，但 `mod3` 不集中到单一余数；不能写成“每第 3 个 AR token 触发特殊逻辑”。更准确说法是：慢 launch 在一串 decode step 中高频、跨 rank 同步出现，且不是 Hunyuan sampler 的 ratio/special-token 分支。
- 已排除的替代配置：
  1. `CUDAGRAPH_MODE=PIECEWISE`
     - artifact：`/tmp/hy3_ar_gap_noprofile_patch_piecewise_20260609_162328`
     - target 生成 `1511` tokens（不是 FULL patch 的 `1318`），吞吐 `59.90 tok/s`，慢于 patch/FULL 的 `68.76 tok/s`
     - 启动更慢：`torch.compile 48.78s`，engine init `157.97s`
     - 结论：PIECEWISE 在这条 AR online path 上不是可替换优化，且输出长度不对齐。
  2. `disable_custom_all_reduce: true`
     - artifact：`/tmp/hy3_ar_gap_noprofile_patch_disable_custom_ar_20260609_163343`
     - target 生成 `1318` tokens，对齐 patch/FULL
     - 吞吐 `65.81 tok/s`，慢于 patch/FULL 的 `68.76 tok/s`
     - 结论：禁用 custom all-reduce 不是收益项；它可以排除 custom AR 是主要生产优化方向，但仍可再抓一次 trace 验证 tail 是否变化。
- 当前最可信的机制模型：
  1. HunyuanImage3 AR comprehension deploy 没有 `has_preprocess`，decode 固定走 multimodal model 的 `inputs_embeds` 路径。
  2. 每步 `_preprocess` 先用 `embed_input_ids` 算 embedding，再 copy 到 graph static buffer。
  3. copy 本身只有百微秒级，但 copy 完之后必须 CPU 发起 `cudaGraphLaunch`，这段 launch 在部分 step 里变成 `1.4-3.8ms`，GPU 就空着等第一段 graph kernel（通常是 `rms_norm`）开始。
  4. 直接把 decode-only 强切 text-only `input_ids` 路径已实测破坏输出（只生成 3 tokens），所以不能靠绕过 MM embedding contract 硬省 copy。
- 为什么不能“一行切 input_ids”：
  - upstream vLLM 对 prompt-embeds 路径已经写了同类 TODO：理想优化是“双编译 CUDA graph，一份 `input_ids`，一份 `inputs_embeds`”。
  - 当前 `CUDAGraphWrapper.concrete_cudagraph_entries` 只按 `BatchDescriptor` 缓存；`BatchDescriptor` 来自 token/req/lora/shape，不包含 `input_ids` vs `inputs_embeds` 这种输入模式。
  - capture 时虽然记录了 tensor input addresses，但 replay 不会因为输入语义变化自动换图；debug 模式才会 assert 地址一致。
  - 因此，粗暴 runtime 切到 `input_ids` 可能复用原先 `inputs_embeds` FULL graph entry，语义不成立。正确探索方向是扩展 graph key / 双 wrapper / 双 runtime path，而不是绕过 `_preprocess`。
- 不要继续投入的方向：
  - 不要围绕那几次短 DtoD copy 本身做主优化；trace 已经显示主空白不在 copy duration。
  - 不要把 PIECEWISE 当生产替代；它更慢且输出不对齐。
  - 不要只看 profiler target 的 TPOT 下结论；正式性能结论用 no-profiler target，多轮重复后再写。

## 待办

### AR graph tail gap 继续追踪（2026-06-10）

- 下一步只做两类事：
  1. **低风险可合并**：保留 `timestep_mask.sum().item()` patch。它有输出 parity，no-profiler 吞吐 `+4.7%`，是目前唯一干净收益。
  2. **探索性优化**：研究“multimodal decode-only 双图 / input_ids graph”是否能语义等价地把 embedding 放回 graph。最低验证门槛是同一 prompt 下 token 数、前几十个 token、TTFT/TPOT 都对齐；否则不进 benchmark。
