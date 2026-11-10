---
name: grouped-dit-benchmark
description: "Hunyuan step-batching benchmark 口径：2026-06-15 PR #4041 反例（把 client max-concurrency 2/4/8 误当 grouped batch，deploy 仍是 max_num_seqs=1）、Hunyuan Step Benchmark Scope 模板、grouped batch N 的判定（step_execution=true 且 max_num_seqs>=N 且日志无降级）、backend 记录（TORCH_SDPA 与 FLASH_ATTN）、启动日志核对与 provenance gate"
metadata:
  scope: 只收证明 HunyuanImage3 DiT step-batching 真正命中 grouped DiT 的 benchmark 口径规则；合批语义验证矩阵归 dynamic-batching-validation，通用 scope lock 与旧 artifact 分类归 evidence-gate
---
# Hunyuan Step-Batching Benchmark

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/grouped-dit-benchmark.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#4041

### Hunyuan step-batching benchmark：batch 口径必须证明命中 grouped DiT

- 口径规则：
  - `max-concurrency=N` 只说明 client 同时发 N 个请求；只有 server deploy 同时满足 `step_execution=true` 且 `max_num_seqs>=N`，并且日志没有降级，才可以把该行称为 grouped batch N。
  - baseline 可以是 `max_num_seqs=1`，但表格列名必须写成 baseline concurrent serving / E2E duration，不得叫 grouped baseline。
  - grouped PR 结果必须记录 backend。Hunyuan grouped DiT 若按设计走 `TORCH_SDPA`，不要把 `FLASH_ATTN` baseline 和 `TORCH_SDPA` grouped 的差异藏进实现细节。
  - benchmark harness 已经合入时优先复用现有 benchmark 入口和 PR body 现有表格格式；不要手写等价 runner 或先跑一组不能填表的数据。
  - 启动后先扫服务日志确认：`step_execution=true` 生效、`max_num_seqs` 生效、没有 fallback 到 `max_num_seqs=1`、没有 config 校验 warning 被忽略。确认前不进入 2/4/8 sweep。
  - 结果写入 PR/body/docs 前做 provenance gate：baseline SHA、PR SHA、vLLM 版本、workload、result JSON、artifact 目录必须属于同一轮，且每行 `completed_requests == num_prompts`、`failed_requests == 0`。
- 一句话规则：Hunyuan step benchmark 的 batch 不是 client concurrency 字段，而是服务端实际把同 shape requests 合进同一个 DiT step 的证据链。

## 决策与踩坑

### Hunyuan step-batching benchmark：batch 口径必须证明命中 grouped DiT

- **2026-06-15 PR #4041 反例**：用户要的是 PR body 当前口径里的 HunyuanImage3 512x512、50 steps、batch 2/4/8、vLLM 0.23.0 baseline / grouped 对照。我先跑成旧/default workload，又把 `max-concurrency=2/4/8` 误当 grouped batch；实际 deploy 仍是 `max_num_seqs=1`，只是在 client 侧并发请求，不是 grouped DiT。
  - 后面又因为 inline JSON / deploy config 投递错误、`sequence_parallel_size` 不匹配、漏 `step_execution: true`，多跑了几轮无效配置。
- 同类性能 PR 开跑前必须先写并核对这张 scope lock：

```markdown
Hunyuan Step Benchmark Scope
- PR/body format to update:
- Version under test:
- vLLM version:
- vLLM-Omni checkout/version:
- Execution path: HunyuanImage3 DiT step execution
- Image size:
- Denoise steps:
- Client requests / prompts:
- Client max-concurrency:
- Server grouped capacity: step_execution=<true/false>, max_num_seqs=<n>
- Attention backend:
- Valid grouped evidence: startup log shows no fallback; per-row completed/failed; result JSON path
```
