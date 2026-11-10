---
name: benchmark-scope-1
description: "vLLM-Omni Benchmark 口径第 1 部分：探索 / smoke / sweep 三阶段表、Benchmark 口径矩阵模板与必填约束、HunyuanImage3 AR-only 指标（TTFC、TPOT、e2e latency、stage_0_gen_ms）、2026-06-01 PR #3938 full it2i 反例（shared_memory_connector 口径、ttfc_count=0）与指标 availability gate、报告模板"
metadata:
  scope: 只收定口径的三阶段、口径矩阵、AR-only 指标定义和 full it2i 跑通与指标采到的区分；scope lock 四元组、candidate PR 来源、结果命名和 shared TTS runner 归 benchmark-scope-2，证据是否可复用归 evidence-gate，完整 pipeline 的 connector 检查归 full-pipeline-benchmark
---
# vLLM-Omni Benchmark 口径（1/2）

## 关键事实

- 拆分说明：本页是源页 `benchmark-scope.md` 的第 1/2 部分；第 2 部分 [[benchmark-scope-2]]
- 源页：`knowledge/repos/vllm-omni/benchmark/guides/benchmark-scope.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#3767；#3938；PR #5957；benchmarks/tts/bench_tts.py；benchmarks/tts/model_configs.yaml

### 5. Benchmark 必须先定口径：探索 / smoke / sweep 三段不能混跑

#### Benchmark 口径矩阵

- 任何性能报告前先填这张矩阵；没填或没跑完对应阶段，不准出性能表：

```markdown
| ID | Purpose | Version | Path | Endpoint / API | Input Source | Requests | Concurrency | Metrics | Allowed Conclusion |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |
| S0 | startup smoke | main | AR-only | /v1/chat/completions | fixed prompt + fixed image | 1 | 1 | health + first chunk | serving path usable |
| B1 | perf sweep | main/pr3938 | AR-only | /v1/chat/completions | same fixed prompt + image | 10/16 | 1,2,4 | TTFC/TPOT/e2e | AR-only online serving speedup |
```

- 必填约束：
  - Path 必须写清 `AR-only` / `DiT-only` / `full AR+DiT`。
  - Endpoint 必须和 Path 匹配。AR-only 不用 `/v1/images/edits`；full image editing 才用 `/v1/images/edits`。
  - 如果没有 dataset，只能写固定 prompt + 固定 image 的 microbenchmark，不能叫 dataset benchmark。
  - 如果只跑 smoke，结果只能叫 smoke，不写 speedup。
  - 如果模型服务没 health、server PID 已退出、或第一条 request 没有目标 chunk，不能进入 sweep。

#### AR-only HunyuanImage3 口径

- AR-only 的主要指标是：
  - `TTFC`：client POST 到首个 streamed text/content delta。
  - `TPOT`：相邻 streamed token/chunk 的平均间隔，必须写明是 client-side chunk 口径还是 server-side token 口径。
  - `e2e latency`：请求完整结束耗时，只用于辅助判断。
  - 如果 endpoint 是 chat completions，`stage_0_gen_ms` 只有在服务端真实输出该字段时才能报告；没有就不要用 client 口径冒充。
- 固定输入推荐写明：
  - prompt 来源：用户指定 / 官方 demo / 自定义 smoke。
  - image 来源：本地文件路径或官方 demo URL，记录 hash/size。
  - generation params：`temperature`、`top_p`、`top_k`、`max_tokens`、stop token、bot_task / template。
  - deploy：GPU mapping、TP、`max_num_seqs`、venv、checkpoint snapshot。

#### 一句话规则

- Benchmark 不是“脚本跑起来就开始计时”。先证明 endpoint 和参数属于当前目标路径，再用一个请求证明 parser 能采到目标指标，最后才跑 sweep；任一阶段失败，报告失败原因，不许把失败等待时间或前置 4xx/argparse 错误包装成性能结果。

#### Full IT2I benchmark 后必须区分“跑通”和“指标采到”

- **新增 availability gate**：

| 指标 | 必须满足 | 不满足时怎么写 |
| --- | --- | --- |
| AR TTFC | `ttfc_count > 0` 或逐条 SSE 出现 `ar_delta` 首包时间 | `unavailable: no ar_delta chunks` |
| AR TPOT | `tpot_count > 0` 且 final chunk 有 token/time metrics | `unavailable: no AR token timing` |
| stage_0_gen_ms | JSON 中 `stage_0_gen_ms_count == completed_requests` | 只报告部分样本，不能算全量 p95/p99 |
| full pipeline result | `completed_requests == num_prompts` 且 `failed_requests == 0` | 先归类失败，不能写 speedup |
| connector 口径 | main/candidate 使用同一 connector/deploy patch | connector 不同则结果不可比 |

- **报告模板**：

```markdown
Config caveat:
- Connector: <rdma/mooncake/shared_memory>; if patched, say "temporary deploy patch applied equally to both versions".
- Streaming metrics: `ttfc_count=<n>`, `tpot_count=<n>`; if zero, TTFC/TPOT unavailable.
- Dataset: random / fixed prompt+image / official fixture; do not call random synthetic prompts an official dataset.
```

- **一句话规则**：benchmark 跑通只说明 workload 可完成；每个指标还要独立证明采样存在。`--stream-ar` 是请求参数，不是 TTFC/TPOT 证据；connector patch 是实验条件，不是实现细节。

## 决策与踩坑

### 5. Benchmark 必须先定口径：探索 / smoke / sweep 三段不能混跑

- **2026-06-01 HunyuanImage3 AR benchmark 反例**：目标是比较 latest main 与 PR #3938 fused rotary 对 HunyuanImage3 AR 的性能影响。#3767 的 benchmark overlay 可以作为测量工具，但被测版本应该是：
  - baseline：`origin/main` + #3767 最小 metrics overlay
  - candidate：`origin/main` + PR #3938 commits + 同一份 metrics overlay
- 用户随后明确“去掉 DiT”，这时 benchmark 口径已经从 full `/v1/images/edits` pipeline 变成 AR-only。正确结论只能来自 AR-only 路径，例如 `/v1/chat/completions` streaming 或 offline AR engine；不能继续用 `/v1/images/edits`，因为这个 endpoint 在当前实现里需要 diffusion stage，AR-only deploy 下会在进入目标模型前失败。
- 这一轮的问题不是单个参数，而是没有把三种阶段分开：

| 阶段 | 目的 | 允许结论 | 禁止行为 |
| --- | --- | --- | --- |
| Endpoint / CLI 探索 | 找到当前代码支持的参数、endpoint、request schema | “这条路径可启动 / 不可启动，原因是 X” | 生成性能数据 |
| 单请求 smoke | 确认请求进入目标路径并返回第一个 streaming chunk / final output | “AR-only online serving 可用，TTFC/TPOT parser 可采样” | 跑 concurrency sweep |
| 正式 benchmark sweep | 对同一 workload 跑 main vs candidate | “在此口径下 mean/p95/p99 和 speedup 是 X” | 中途改 endpoint、prompt、image、seed、template |

#### Full IT2I benchmark 后必须区分“跑通”和“指标采到”

- **2026-06-01 HunyuanImage3 PR #3938 full it2i benchmark 反例 / 修正**：用户最后明确要求 4 卡空闲直接跑 full it2i benchmark。正确执行方式是回到 full `/v1/images/edits` pipeline，使用同一模型 snapshot、同一 prompt/image 生成策略、同一 `origin/main + #3767 overlay` 与 `origin/main + PR #3938 + #3767 overlay`，并跑 concurrency `1,2,4`。
- 这轮最终跑通并保存了结果：

```text
out_dir=<REMOTE_WORK_ROOT>/hy3_ar_bench_20260601_it2i_full
main=1fa8efde445c64e3a3b5256231f0e08703490853
pr3938=8ca9e072f3784d4c6244cb32982d4e1a7bccc4bb
endpoint=/v1/images/edits
task=it2i
num_prompts=10
warmup=1
steps=8
concurrency=1,2,4
deploy_connector=shared_memory_connector
```

- 但这次又暴露了两个容易把结果说错的点：
  1. **默认 deploy connector 是口径变量**：`hunyuan_image_3_moe.yaml` 默认 `rdma_connector` / `MooncakeTransferEngineConnector`，这台 venv/机器没有 Mooncake，full pipeline 在 DiT KV receive 阶段报 `Mooncake not available`。改用同 YAML 中已有的 `shared_memory_connector` 后可以跑通。这个改动没有改 repo，但必须写进 benchmark 口径；
     - 否则别人会误以为结果代表默认 RDMA/Mooncake 配置。
  2. **`--stream-ar` 不等于采到 AR TTFC/TPOT**：最终 JSON 里所有 run 都是 `ttfc_count=0`、`tpot_count=0`，即 endpoint 没有吐 `ar_delta` 计时 chunk。可以报告 `stage_0_gen_ms`，不能报告 AR TTFC / AR TPOT。
- 这轮可引用的结论只能是：
  - full it2i 在 shared-memory connector 口径下，main 与 PR #3938 都 10/10 成功。
  - `stage_0_gen_ms` 是主要 AR-stage server-side 指标。
  - PR #3938 在 c1 基本持平，但 c2/c4 回退；不能说有稳定性能提升。
  - AR TTFC / TPOT unavailable，原因是 `ttfc_count=0` / `tpot_count=0`。
