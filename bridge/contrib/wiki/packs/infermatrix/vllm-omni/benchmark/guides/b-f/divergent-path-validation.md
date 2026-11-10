---
name: divergent-path-validation
description: 分叉执行路径验证：为已有功能新增第二条执行路径（step-wise / graph / cache / batching / serving / offline）时的 Normal-vs-New Path Parity Matrix（Ingress、Owner helper、Consumer map、Consumer default、Unsupported delta、State transfer、非默认与默认 case）和 parity test 要求
metadata:
  scope: 只收新增分叉路径时 normal path parity 的矩阵与测试要求；合批语义约束归 dynamic-batching-validation，性能与精度证据等级归 performance-evidence-1
---
# 分叉执行路径验证

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/divergent-path-validation.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-07-10；updated: 2026-07-10

### 分叉执行路径验证：normal path parity 是硬门槛

- **触发条件**：
  - 为已有功能新增第二条执行路径：step-wise / graph / cache / batching / serving / offline / benchmark / staged pipeline。
  - 新路径声称复用 normal path 语义，或 reviewer 问“为什么这条路径和 forward/request path 不一致”。
- **必须先列 Normal-vs-New Path Parity Matrix**，再说“已复查”：

| 项 | 要求 |
| --- | --- |
| Ingress | normal path 和新路径分别从哪里拿 request / sampling / extra_args / prompt dict / multimodal payload / KV payload |
| Owner helper | 哪个单一 helper 负责 parse / normalize / validate；如果两边各写一份，先重构再测 |
| Consumer map | 字段流向哪些 consumer：tokenizer/model、system prompt、scheduler、cache、backend、postprocess |
| Consumer default | 每个 consumer 的默认值是否相同；不同则必须拆变量并测默认 case |
| Unsupported delta | 新路径不支持哪些 normal path 能力；必须早炸或显式 no-op，不能静默跳过 |
| State transfer | staged / connector / cache payload 在新路径进入 owner 前是否已 attach 到 state |
| Non-default case | 至少一个非默认字段值，例如 custom task、custom system prompt、KV reuse、image/multimodal payload |
| Default case | 至少一个缺省字段值，证明默认值没有被新路径改成另一个 consumer 的默认 |

- **测试要求**：
  - 每个新增分叉路径至少有一个 parity test：同一 request 字段同时驱动 normal path 和新路径，断言进入最终 consumer 的值一致。
  - 只测默认请求是无效复查；默认 smoke 只能证明 plumbing。
  - 如果字段有多个 consumer，要断言每个 consumer 的值，而不是只断言一个 normalized 中间变量。
  - 对 staged / connector / KV / cache payload，测试必须证明 payload 在 owner `prepare/forward` 前已经进入 request-local state；不能只测 owner 里的 extraction helper。
  - 如果本地 pytest 因环境缺依赖跑不起来，不能把 `ruff` / `py_compile` 当语义验证；必须换 CI-like 环境、远端，或写不依赖全 pytest fixture 的最小同路径 smoke。
- **一句话规则**：新路径验证的目标不是“能进入新函数”，而是“normal path 的每个用户语义字段，在新路径进入最终 consumer 时仍是同一个语义”。
