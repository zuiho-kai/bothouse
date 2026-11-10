---
name: benchmark-contract
description: 性能测试基本合同：开跑前固定的口径清单、探索/smoke/正式结果不混用、对比前确认同一件事、证据属于同一轮、异常先查请求链路、发布前最低检查
metadata:
  scope: 只收通用性能测试的口径、结果分类、对比条件和证据合同；某个模型的 baseline、仓库专有配置字段和远端机器实况不收
---
# 性能测试基本合同

## 关键事实

- 源页：`knowledge/general/benchmark/guides/benchmark-contract.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: general, benchmark；created: 2026-07-10；updated: 2026-07-10；sources: 无

### 开跑前先写清楚

- 任何准备发布或比较的性能测试，都必须先固定：
  - 被测仓库和 commit；
  - 模型或 checkpoint；
  - 实际运行入口；
  - 输入尺寸、帧数、步数、prompt 和 seed；
  - 请求数、并发和请求速率；
  - eager、compile 或 graph 模式；
  - warmup 次数；
  - GPU、软件版本和关键环境变量；
  - 指标名称和计算方式。
- 缺少其中任何会改变结果的一项，只能先补查，不能先跑再解释。

### 三种结果不能混用

1. **探索结果**：只用于发现命令、参数和可能的瓶颈。
2. **Smoke**：只证明路径能够运行。
3. **正式结果**：固定口径、完成 warmup、保存原始结果和日志，可用于对比或发布。

### 对比前先确认是不是同一件事

- 严格对比要求模型、pipeline、请求路径、默认参数和 workload 都一致。

### 证据必须属于同一轮

- 结论、仓库 commit、配置、请求、服务日志和结果文件必须互相对应。
- 指标没有采到时写 unavailable，不能用 `0`、fallback 或其他指标补位。

### 异常时先查请求链路

- 结果异常时先沿“配置 → runner → 请求对象 → payload → server log → result”证明关键字段真的传到了被测路径，再讨论过滤、丢弃首条或放宽 baseline。

### 发布前最低检查

- 当前 commit 和结果一致；
- warmup 和正式请求 workload 一致；
- 成功数、失败数和 unavailable 指标明确；
- 原始结果和日志仍可定位；
- 结论没有超过证据能支持的范围。

## 决策与踩坑

- （三种结果不能混用）探索和 smoke 不能写成正式性能结论。
- （对比前先确认是不是同一件事）只对齐分辨率、帧数和步数时，只能说“工作负载相近”，不能把差异归因于框架实现。
- （证据必须属于同一轮）旧 PR 表格、目录名和历史摘要只能当线索。
- （证据必须属于同一轮）Benchmark 数字和 profiler trace 是两类证据，不能互相替代。
