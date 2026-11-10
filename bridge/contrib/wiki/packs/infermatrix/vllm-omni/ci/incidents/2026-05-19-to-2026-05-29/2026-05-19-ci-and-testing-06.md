---
name: 2026-05-19-ci-and-testing-06
description: "2026-05-19 CI 错题 inc-2026-05-19-ci-and-testing-06，审 PR #3723（/v1/images/edits stream=true）时 happy path 通过，却漏了 EngineDeadError 被 generic except 吃掉、ErrorResponse 降成 ValueError 丢 400 状态码、ar_delta 不满足 append 三类协议坏路径"
metadata:
  scope: "只收 2026-05-19 PR #3723 streaming image edit review 漏审协议坏路径这一起错题及新增 streaming API 面的坏路径测试提醒；同一 PR 的 reviewer feedback 复盘归 2026-05-21-ci-and-testing-05，交付流程复盘归 2026-05-19-ci-and-testing-08"
---
# 2026-05-19 — PR #3723 streaming image edit review 漏掉协议坏路径

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/incidents/2026-05-19-ci-and-testing-06.md`（InferMatrixCopilot@ecfb84d0）；源页无 frontmatter

## 决策与踩坑

- 编号：`inc-2026-05-19-ci-and-testing-06`
- 归属：`repos/vllm-omni/ci`
- 状态：已验证
- 搜索词：PR #3723 streaming image edit review 漏掉协议坏路径
- 影响范围：repos/vllm-omni/ci
- **症状**：审 `vllm-project/vllm-omni#3723`（`/v1/images/edits stream=true`）时，happy path 测试和 lint 基本过，但 code review 抓到三类协议/坏路径问题：(1) 新 SSE generator 用 generic `except Exception` 吃掉 `EngineDeadError`，不像已有 chat streaming 那样 `terminate_if_errored`；
  - (2) `ErrorResponse` 在 streaming preparation 中被转成 `ValueError(prepared.message)`，400 类用户错误在 SSE error chunk 里丢状态码并默认变 500；
  - (3) `ar_delta` replacement 分支 emit 的不是 appendable delta，客户端拼接会得到 `draftfinal answer`，测试却把这个行为固化。
- **根因**：把“能把 stage-0 AR 文本和最终图按 SSE 流出来”当成“streaming endpoint 做完了”，没有把新 endpoint 当成 public protocol surface 审。review/test 主要覆盖了文本、图、DONE、单阶段拒绝，没沿着已有 streaming 实现逐项对齐 `normal chunk / structured validation error / EngineDeadError / generic exception / DONE / client append semantics`。
- **解法**：review 时要求 PR 修三点：EngineDeadError 分支按既有 streaming 语义触发 server shutdown；structured `ErrorResponse` 不得降级成裸字符串异常，SSE error chunk 保留 status/type/code；`ar_delta` 必须满足 append invariant，若要支持 replacement 就改协议字段（例如 full text/reset）而不是继续叫 delta。
- **对未来的提醒**：新增 `stream` 参数、SSE schema、WebSocket message、OpenAI-compatible chunk 等 API 面时，不能只跑 happy path。必须先 diff 仓库已有 streaming endpoint 的异常处理，再写坏路径测试：`EngineDeadError` 是否触发 shutdown、400 是否仍是 400、`[DONE]` 是否只在正确时机发、客户端按协议拼接后是否得到正确最终状态。凡是字段名叫 `delta`，测试必须模拟客户端 append；如果 append 不成立，字段名/协议就错了。
