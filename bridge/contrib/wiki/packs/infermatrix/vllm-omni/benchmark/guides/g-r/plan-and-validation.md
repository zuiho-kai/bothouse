---
name: plan-and-validation
description: Plan / Validation 旧总入口：按任务类型（写 plan 与功能验证、产品对标与 roadmap、benchmark 口径、远端长测、AR graph profiling、开发前 mini spec）路由到专题页的对照表，以及八条硬规则摘要（先 trace lifecycle、真实 e2e、锁 benchmark 四元组、PR 规格锚定、L2/L4 证据边界、复用既有脚本、先写 mini spec）
metadata:
  scope: 只收旧 plan/validation 入口的路由表和硬规则摘要；benchmark 口径正文归 benchmark-scope-1，证据门禁归 evidence-gate，指南清单归 benchmark-guides-overview，跨仓库的 planning / review 指南在 general 包
---
# Plan / Validation 入口

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/plan-and-validation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10
- 本文件只保留路由。日常先按任务类型打开对应专题页；不要整篇读历史 runbook。
- （以下为原表格，按行改写为条目）
- 任务：写 plan、判断 feature 是否可用、选择 e2e vs fake/unit
  - 读这个：实现与功能验证（源链接 `../../../../general/planning/guides/implementation-validation.md`）
- 任务：产品对标、最低 parity、产品书、roadmap、版本目标拆分
  - 读这个：product_loop_planning.md（源链接 `../../../../general/planning/guides/product-loop-planning.md`）
- 任务：benchmark 口径、探索/smoke/sweep 区分、scope lock、结果命名
  - 读这个：[[benchmark-scope-1]]、[[benchmark-scope-2]]（benchmark scope）
- 任务：远端长测配置验证、复用既有脚本、profiler 不污染 steady-state
  - 读这个：remote_long_run.md（源链接 `../../../../general/remote/guides/remote-long-run.md`）
- 任务：AR graph / profiling 诊断机制、d-step 分析、PR 远端验证闸门
  - 读这个：[[benchmark-guides-overview]]（benchmark guides）
- 任务：新模型 / execution path / public 字段 / multimodal payload / perf PR 开发前 mini spec
  - 读这个：mini_spec.md（源链接 `../../../../general/planning/guides/mini-spec.md`），review/merge 前再读 reviewer_lens_audit.md（源链接 `../../../../general/review/guides/reviewer-lens-audit.md`）；
    - mini-spec appendix 和 design gates 在 reviewer_lens_gates.md（源链接 `../../../../general/review/guides/reviewer-lens-gates.md`）
- 硬规则摘要：
  - Plan 阶段先 trace lifecycle，再给方案。
  - 产品对标 / parity / roadmap 先写用户可感知闭环，再拆 atomic issue / PR / sub-agent。
  - 功能验证默认打真实 e2e 路径；fake/unit 不能证明全栈可用。
  - Benchmark 先锁被测版本、测量补丁、被测路径、有效指标。
  - 用户给出 PR 或“这个规格”时，先读该 PR/config/runner/result JSON 锁 source of truth，再回答或开跑。
  - L2/L4 拆分先定义证据边界：L2 CPU/mock 功能 shape guard，L4 真实权重 accuracy/perf/profiling。
  - 已有成功脚本或 runbook 时先复用，禁止从零手写等价 runner。
  - 非平凡模型适配、execution path、public 字段或 perf PR，开发前先写 mini spec；不能把后续 review 当第一道语义检查。
