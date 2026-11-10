---
name: ar-graph-online-2026-06-09-timestep-patch
description: 2026-06-09 timestep_mask.sum().item() patch（commit 8bc0bcc9e，改用 torch.where）带 profiler 对照：aten::item 约 1.6s / 512 calls 消失，step GPU idle p50 从约 1.5ms 降到约 50us，tail gap p90 仍 3-4ms
metadata:
  scope: 只收该 patch 的改动代码、远端验证、请求指标和 baseline/patch trace 对照表及结论；baseline trace 的完整分析归 ar-graph-online-2026-06-09-trace，无 profiler 定量归 ar-graph-online-2026-06-09-no-profiler
---
# timestep_mask.sum().item() Patch 对照

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/results/ar-graph-online-2026-06-09-timestep-patch.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

### `timestep_mask.sum().item()` patch 对照（2026-06-09）

- 本地分支：`D:\vllm-omni\wt-ar-step-gap-opt-main`，commit `8bc0bcc9e [Perf] Avoid timestep mask scalar sync`。
- 改动：

```python
timestep_mask = input_ids == self._timestep_token_id
timestep_input = torch.zeros((1,), device=inputs_embeds.device, dtype=inputs_embeds.dtype)
timestep_embed = self._timestep_encode(timestep_input).to(inputs_embeds.dtype)
inputs_embeds = torch.where(timestep_mask.unsqueeze(-1), timestep_embed, inputs_embeds)
```

- 远端验证：
  - artifact：`/tmp/hy3_ar_gap_profile_20260609_064355/`
  - 同一 dirty serving worktree，仅临时 checkout 单文件 patch；跑完后已 `git checkout HEAD -- vllm_omni/model_executor/models/hunyuan_image3/hunyuan_image3.py` 还原。
  - 输出 parity：warmup / target 都生成 `294` tokens。
  - 资源释放：结束后四张 GPU 均回到 `4 MiB`。
- 请求指标：

| Window | Benchmark duration | TTFT | TPOT | Output throughput | Notes |
|---|---:|---:|---:|---:|---|
| warmup outside profiler | `4.03s` | `790.75ms` | `11.05ms` | `72.96 tok/s` | 可近似看 no-profile 请求 |
| target inside profiler | `5.08s` | `336.47ms` | `16.19ms` | `57.87 tok/s` | profiler window trace 明显更重，p99 ITL `47.26ms` |

- trace 对照：

| Metric | Baseline rank0 | Patch rank0 | Baseline rank1 | Patch rank1 |
|---|---:|---:|---:|---:|
| `aten::item/_local_scalar_dense` | `~1.60s / 512 calls` | not present in key events | `~1.69s / 512 calls` | not present in key events |
| outer step width p50 | `6.900ms` | `4.593ms` | `6.988ms` | `4.562ms` |
| GPU busy p50 | `5.344ms` | `4.486ms` | `5.448ms` | `4.478ms` |
| GPU idle p50 | `1.558ms` | `56.9us` | `1.542ms` | `47.9us` |
| GPU idle p90 | `1.631ms` | `3.949ms` | `1.576ms` | `3.662ms` |
| `cudaGraphLaunch` overlap | `672.940ms` | `671.170ms` | `665.505ms` | `691.184ms` |

- 结论：
  - patch 有效消除了每步 `timestep_mask.sum().item()` 造成的 scalar sync，step idle 中位数从 `~1.5ms` 降到 `~50us`。
  - patch 没解决 tail gap：p90 仍是 `3-4ms`，剩余大头集中在 `cudaGraphLaunch` / graph replay 提交阶段，最大 gap 仍常出现在 `Memcpy DtoD` 后、下一段 `rms_norm` kernel 前。
  - target profiler 指标反而变差，不能直接说明生产性能倒退；warmup/no-profile 请求略好，但需要再做无 profiler 多轮 bench 才能定量。当前结论只到“同步点定位和中位 idle 改善成立，tail 仍未解决”。
