---
name: 2026-06-02-remote-validation-021
description: "2026-06-02 错题：用户要测 origin/main + PR #3767 benchmark overlay 的 HunyuanImage3 AR 部分，却被脑补成 main vs PR #3938 的 full it2i 对比（scope hallucination）；含 Benchmark Scope Lock 四元组、旧 plan 作废规则与正确处理模板"
metadata:
  scope: 只收 2026-06-02 benchmark 需求被自造 candidate PR 脑补这一起事故；同一 benchmark 的 full it2i 结果口径问题归 2026-06-01-remote-validation-020，AR-only 手写 runner 归 2026-06-02-remote-validation-022
---
# 2026-06-02 — Benchmark 需求被脑补成 PR3938 对比，属于 scope hallucination

## 关键事实

- 源页：`knowledge/repos/vllm-omni/remote/incidents/performance-validation/2026-06-02-remote-validation-021.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-06-02-remote-validation-021`
- 归属：`repos/vllm-omni/remote`
- 状态：已验证
- 搜索词：Benchmark 需求被脑补成 PR3938 对比，属于 scope hallucination
- 影响范围：repos/vllm-omni/remote
- **症状**：用户原始需求是“跑一下远程 main 版本的 HunyuanImage3 AR 部分的性能极限，然后用 benchmark PR #3767”。正确口径应是 `origin/main + #3767 最小 benchmark overlay`，只测 HunyuanImage3 AR。实际执行中，我把“相关 PR / benchmark”脑补成 `main vs PR #3938` 性能对比，并继续绕到 full `/v1/images/edits` it2i benchmark，最后产出 `main/pr3938` 表。
  - 用户追问“这个 pr3938 哪来的”后才暴露该 candidate 是我自造的，不是用户需求。
- **根因**：
  1. 把 #3767 的角色看错：#3767 是 benchmark / metrics overlay，是测量工具；不是被测性能改动。
  2. 把 PR #3938 的标题当成需求证据：标题像 AR 性能优化，不代表用户要求测它。
  3. 用户后续说“去掉 DiT”后，没有清空旧 plan，仍沿 full it2i / candidate comparison 惯性执行。
  4. benchmark 表生成前没有写四元组，也没有把旧结果标成 `invalid for current request`。
- **硬规则**：
  1. 远端 benchmark 开跑前必须写 `Benchmark Scope Lock`：

     ```text
     Version under test:
     Measurement patch/tooling:
     Execution path:
     Valid metrics:
     ```

  2. candidate PR 必须来自用户显式要求或已确认 plan；不能因为 PR 标题、历史上下文、或“相关 PR”措辞自行加入。
  3. benchmark PR / metrics overlay 默认只是尺子；除非用户明确说测该 PR 本身，否则不进入 `Version under test`。
  4. 用户改 scope 后旧 plan 立即作废；尤其“去掉 DiT”会废弃 full `/v1/images/edits` 口径，“跑 main”会废弃 `main vs candidate` 口径。
  5. 已经跑出的旧数据如果不匹配当前四元组，只能放到 “not applicable / invalid for current request” 区域，不能继续解释成当前需求的结果。
- **正确处理模板**：

```text
Current request:
- Version under test: origin/main
- Measurement patch/tooling: PR #3767 minimal benchmark overlay
- Execution path: HunyuanImage3 AR-only
- Valid metrics: AR stage latency/throughput and operator topN; full it2i e2e is out of scope

Invalid previous result:
- main vs pr3938 full it2i shared-memory table: real data, wrong scope; do not use for this request
```
