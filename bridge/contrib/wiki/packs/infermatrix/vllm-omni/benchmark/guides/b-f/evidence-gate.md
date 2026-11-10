---
name: evidence-gate
description: "vLLM-Omni Benchmark 证据门禁：远端 benchmark / accuracy / profiling 的 scope lock 必填模板、PR Spec Gate（PR 或规格锚定）、L2/L4 模型看护 split gate、旧 artifact 三分类（config-only、completed-wrong-scope、completed-scope-aligned）、交付前 result gate，以及 LTX2.3 T2V（PR #4464，e2e_latency_ms=6014.19）两个反例"
metadata:
  scope: 只收判定 artifact 和结果是否能作为当前请求证据的门禁与模板；benchmark 口径和 candidate 选择归 benchmark-scope-1 与 benchmark-scope-2，证据等级归 performance-evidence-1，可审计规则归 benchmark-rules
---
# vLLM-Omni Benchmark 证据门禁

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/evidence-gate.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#4464

### 0. 远端 benchmark / accuracy 证据 gate：先判定 artifact 是否有效

- 任何远端 benchmark、accuracy、profiling 或 PR Test Result 更新，都不能只看“目录存在 / pytest status=0 / benchmark 跑完”。开跑前写 scope lock；复用旧 artifact 前先分类；交付前做 result gate。

#### Scope lock 必填

```text
Request target:
- PR / issue / branch:
- Head SHA under test:
- Remote host:
- Worktree:
- Python / venv:
- vLLM / vLLM-Omni version:
- Model snapshot / HF env:
- CUDA_VISIBLE_DEVICES and GPU ownership:

Execution path:
- Endpoint / offline API:
- Deploy config path or inline config:
- Required path flags, e.g. step_execution / max_num_seqs / backend:
- Workload: resolution, frames, steps, prompt count, max concurrency, seed/defaults:

Evidence output:
- Run dir:
- Result JSON:
- Log file:
- Pass/fail criterion:
```

- 没有这张 scope lock，不准把结果写进 PR body / docs / reviewer comment。

#### PR / 规格锚定 gate

- 用户给出 PR / issue / “这个规格” / “按这个配置” 时，先锚定该对象的 source of truth。未完成这张表，不准回答性能数字，也不准启动新 benchmark：

```text
PR Spec Gate:
- Target object: PR / issue / config path:
- Source of truth read: config + runner/client + result JSON/artifact:
- PR head / tested SHA:
- vLLM / dependency version:
- Model repo or local snapshot:
- Pipeline/class and endpoint:
- Workload: resolution, frames/fps, steps, prompt, negative prompt:
- Request contract: num-prompts, warmup, request-rate/max-concurrency:
- Runtime contract: eager/compile, GPU, HF/cache env:
- Metric fields and units:
- Valid answer scope: strict / workload-aligned only / smoke only:
```

- 规则：
  - PR body 可以当索引，不能当唯一 source of truth；正式回答前至少确认 config 和 runner/client 对同一指标的含义。
  - 如果用户已经指定“#xxxx 这个规格”，先答该规格的已记录数值；只有该 PR 没有 artifact 或 artifact provenance 不足时，才说需要补跑。
  - 搜本地/远端历史产物只能用于 provenance，不得覆盖用户指定的 PR/spec anchor。
  - 性能数字必须引用字段名和单位，例如 `e2e_latency_ms` 是 ms，`throughput_qps` 是 requests/s；不要把 pytest wall time、stage gen time、trace profiling duration 混成 e2e/qps。

#### L2/L4 模型看护 split gate

- 模型功能、精度、性能用例拆 L2/L4 前，先写这张表：

```text
Model Guard Split:
- L2 purpose: CPU/mock functional contract only:
- L2 forbidden path: real model load, runner/stage init, CUDA device init, real HF snapshot download:
- L2 assertions: request schema, batch semantics, output count, shape, dtype, metadata, error handling:
- L4 purpose: real-weight accuracy/performance/profiling:
- L4 assertions: accuracy threshold, e2e_latency_ms, throughput_qps, memory, stage/profiler artifacts:
- Shared fixtures: prompt/config names only; no L4 runtime dependency in L2:
```

- 规则：
  - mock 权重不等于 CPU-only；只有测试不进入 runner/stage/device 初始化，才算 CPU 功能 guard。
  - L2 不报性能、不报精度、不用真实模型 cache；L2 的成功结论只能是功能 contract / shape guard。
  - L4 必须使用固定 prompt 和真实权重，性能 guard 的 prompt、resolution、frames、steps、concurrency、request count 一旦变更，旧 baseline 作废。
  - L2 review 里要主动说明“这看护了什么”和“没有看护什么”；避免 reviewer 把 mock test 误解成真实精度/性能覆盖。

#### 旧 artifact 分类

- 复用旧目录前先标注它属于哪一类：

| 分类 | 判定 | 允许用途 |
| --- | --- | --- |
| `config-only` | 只有 config JSON / script / scope，没有 result JSON 和完成日志 | 只能当配置参考 |
| `completed-wrong-scope` | status=0 但 SHA / venv / deploy / backend / workload / path 不匹配当前请求 | 标为 invalid，不得发布指标 |
| `completed-scope-aligned` | scope lock、日志、result JSON、completed/failed 都匹配当前请求 | 可作为证据 |

- 目录名、PR body 旧表格和历史摘要都只能当线索，不能直接当证据。

#### Result gate

- 交付前至少确认：

```text
git head / PR head == run_scope head
result JSON exists and is from current run dir
completed_requests == num_prompts
failed_requests == 0
backend/deploy path was actually parsed in startup log
target path flags were effective, not only present in a generated config
GPU/process cleanup checked after run
```

- 如果中途发现跑错 workload、跑错 deploy、跑错 head、或只是 client concurrency 未命中 server grouped path，旧结果必须写成 `invalid for current request`，不能“转换格式”继续使用。
- 一句话规则：远端验证的单位不是一次 pytest，而是一条可追溯证据链：`request -> scope lock -> live env -> startup log -> result JSON -> cleanup`。

## 决策与踩坑

### 0. 远端 benchmark / accuracy 证据 gate：先判定 artifact 是否有效

#### PR / 规格锚定 gate

- **LTX2.3 T2V 反例**：用户问 PR #4464 规格下的 `e2e_latency_ms` / `throughput_qps`。
  - 正确动作是先锚定 PR #4464 的 L4 benchmark 规格：`/v1/videos`、`512x384`、`25 frames`、`20 steps`、`max_concurrency=1`、`3 successful requests`、`vllm==0.23.0`、PR head `6372f0dee3bd2aa446480f8a7ad101ba4bc34be1`，再回答 `e2e_latency_ms=6014.19`、`throughput_qps=0.1663`。错误动作是先搜本地/远端残留 artifact，再把“没找到产物”当成规格答案。

#### L2/L4 模型看护 split gate

- **LTX2.3 T2V 反例**：旧 L2 mock 仍走 `OmniRunner` / stage 初始化，默认 runtime device 可以触发 CUDA path；它只能说明权重是 mock，不说明测试不依赖卡。正确 L2 是直接测试 mock pipeline / request / output contract，验证 prompt batch、negative prompt、shape、dtype、metadata；L4 才跑真实权重 accuracy 和 performance。
