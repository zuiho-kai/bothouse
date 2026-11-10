---
name: ar-graph-online-2026-06-09-trace
description: 2026-06-09 HunyuanImage3 AR graph online 有效 profiler trace：产物路径、启动与请求口径、511 个 decode step 的 width/busy/idle 分位数、aten::item 来自 embed_input_ids 的 timestep_mask.sum().item()、优化边界
metadata:
  scope: 只收 warmup 后抓的 baseline trace 的产物、口径、trace 结论和当时的优化边界；patch 后的 trace 对照归 ar-graph-online-2026-06-09-timestep-patch，cudaGraphLaunch tail gap 追踪归 ar-graph-online-2026-06-10-tail-gap
---
# AR Graph Online Profiling Trace

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/results/ar-graph-online-2026-06-09-trace.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### AR graph online profiling 有效 trace（2026-06-09）

- 本轮重新按 online 正确口径抓 trace：先启动 `vllm serve`，先跑 warmup 请求，warmup 完成后调用 profiler start，请求完成后 stop profiler，最后释放本轮进程组。
- 产物：
  - 远端目录：`/tmp/hy3_ar_gap_profile_20260609_044200/`
  - trace：`profiler/20260609-044408_stage0_rank0_1780980248/trace_rank0.json.gz`（约 95 MB gz）、`profiler/20260609-044408_stage0_rank1_1780980248/trace_rank1.json.gz`（约 92 MB gz）
  - 分析汇总：`ar_gap_trace_analysis.txt`、`ar_gap_key_events_rank0.txt`
  - 资源释放：结束后 `GPU0=0 MiB, GPU1=0 MiB, GPU2=4 MiB, GPU3=4 MiB`
- 启动与请求口径：
  - `Model loading took 78.71 GiB memory and 40.23s`
  - `torch.compile took 3.55s`
  - `Graph capturing finished in 8s`
  - `AsyncOmniEngine initialized in 89.72s`
  - warmup 请求在 profiler 外：生成 `294` tokens，`TTFT=821.81ms`，`TPOT=11.28ms`，`output throughput=71.24 tok/s`
  - target 请求在 profiler 内：生成 `294` tokens，`TTFT=347.40ms`，`TPOT=13.71ms`，`output throughput=67.34 tok/s`
- trace 结论：
  - rank0/rank1 都有约 `5.0M` trace events，`kernel` 约 `520k`，`gpu_memcpy` 约 `7,845`。
  - 口径修正：不能把 `gpu_user_annotation` 当 GPU busy；它只是 NVTX 范围，算进去会把 step 内空白抹掉。真实 GPU busy 只统计 `kernel/gpu_memcpy/gpu_memset`。
  - 以外层 `execute_context_0(0)_generation_1(1)` user annotation 作为 decode step window：rank0/rank1 都有 `511` 个 outer generation steps。
  - rank0：outer step `width p50=6.900ms`、`gpu_busy p50=5.344ms`、`gpu_idle p50=1.558ms`、`gpu_idle p90=1.631ms`。
  - rank1：outer step `width p50=6.988ms`、`gpu_busy p50=5.448ms`、`gpu_idle p50=1.542ms`、`gpu_idle p90=1.576ms`。
  - 每个 step 里 memcpy 很多但很短：rank0 `count p50=56`、`memcpy time p50=152.2us`；rank1 `count p50=57`、`memcpy time p50=141.7us`。因此用户看到的短 copy 是 gap 前后的伴随事件，不是主耗时本体。
  - 最大 step 内 GPU 空白常出现在 `Memcpy DtoD` 之后、下一个 `triton_red_fused_rms_norm_0` 之前：rank0 最大 `4.892ms`，rank1 最大 `4.207ms`。
  - rank0 step 132 细查：`Memcpy DtoD` 在 `+4.921ms` 结束，下一段 `rms_norm` kernel 到 `+9.814ms` 才开始；中间 CPU 侧有 `aten::item/_local_scalar_dense` 同步，以及 `cudaGraphLaunch` / `torch/cuda/graphs.py: replay`。
  - CPU overlap 大头：
    - rank0：`cudaEventSynchronize 2.585s`、`aten::item 1.600s`、`aten::_local_scalar_dense 1.599s`、`cudaStreamSynchronize 1.590s`、`cudaGraphLaunch 672.940ms`。
    - rank1：`aten::item 1.692s`、`aten::_local_scalar_dense 1.691s`、`cudaStreamSynchronize 1.682s`、`cudaGraphLaunch 665.505ms`。
  - key parent-chain 追踪修正：`aten::item` 的父栈不是 sampler，而是 `vllm_omni/worker/gpu_model_runner.py:1437 _preprocess -> hunyuan_image3.py:1994 embed_input_ids`，具体代码是 `timestep_mask.sum().item()`。这个每个 decode step 都会读 GPU scalar 回 CPU。
  - `aten::copy_` 虽然有上万次，但 rank0 step overlap 只有 `96.043ms`，rank1 只有 `90.338ms`。优化 copy 只能拿小头；优先级低于移除 `timestep_mask.sum().item()` 和确认 `cudaGraphLaunch` overhead。
- 当前优化边界：
  1. 不要再改 decode 输入契约。直接把 HunyuanImage3 AR decode 从 MM embedding path 切成 text-only `input_ids` 已实测破坏输出。
  2. 第一优先级是消除 `embed_input_ids` 里的 `timestep_mask.sum().item()`。推荐最小改法：无条件构造 `timestep_emb(0)`，用 GPU `torch.where(timestep_mask.unsqueeze(-1), timestep_embed, inputs_embeds)` 做替换，避免 CPU 分支读 GPU scalar。
  3. 第二优先级是确认 `cudaGraphLaunch` 为什么每 step 累计约 `1.3ms` 平均 CPU runtime，且大 gap 里 kernel 到 graph launch 结束才开始。需要对比 patch 后 trace，分清是 `.item()` 同步拖住 graph launch，还是 graph replay 本身仍有独立提交开销。
  4. 任何改法必须保留 294-token 输出 parity，再看 TTFT/TPOT 和 step idle。远端本轮尝试验证 patch 时 GPU 被 `/rebase/vllm-omni/tests` 的他人进程占满，未跑成；远端单文件已还原。
